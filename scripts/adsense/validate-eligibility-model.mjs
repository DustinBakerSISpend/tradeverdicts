import fs from "node:fs";
import path from "node:path";
import {
  createEligibilityContext,
  getTradeEligibility,
  STATIC_INDEXABLE_PATHS,
} from "../../src/utils/eligibility.js";
import {
  getPublicPlayerRecords,
  getPublicTrades,
} from "../../src/utils/publicRecords.js";
import {
  createPlayerEligibilityContext,
  getPlayerEligibility,
} from "../../src/utils/playerEligibility.js";
import { MARQUEE_TRADE_SLUGS } from "../../src/utils/marqueeTradeSlugs.js";
import { ADS_SERVING_ENABLED } from "../../src/config/ads.js";

const repo = process.cwd();
const outputPath = process.argv[2];

if (!outputPath) {
  throw new Error("An output JSON path is required.");
}

const readJson = (relativePath) =>
  JSON.parse(
    fs
      .readFileSync(path.join(repo, relativePath), "utf8")
      .replace(/^\uFEFF/, "")
  );

const trades = readJson("src/data/nfl/trades.json");
const players = readJson("src/data/nfl/players.json");

const context = createEligibilityContext(trades);
const rows = trades.map((trade) => ({
  trade,
  eligibility: getTradeEligibility(trade, context),
}));

const publicTrades = getPublicTrades(trades);
const publicPlayers = getPublicPlayerRecords(
  players,
  publicTrades
);
const playerContext = createPlayerEligibilityContext(
  publicPlayers,
  publicTrades,
  context
);

const playerRows = publicPlayers.map((player) => ({
  player,
  eligibility: getPlayerEligibility(
    player,
    publicTrades,
    playerContext
  ),
}));

const errors = [];
const warnings = [];
const tradeSlugSet = new Set(
  trades.map((trade) => trade.slug).filter(Boolean)
);
const uniqueMarqueeSlugs = new Set(MARQUEE_TRADE_SLUGS);

if (MARQUEE_TRADE_SLUGS.length !== 52) {
  errors.push(
    `Expected 52 marquee slugs; found ${MARQUEE_TRADE_SLUGS.length}.`
  );
}

if (uniqueMarqueeSlugs.size !== 52) {
  errors.push(
    `Expected 52 unique marquee slugs; found ${uniqueMarqueeSlugs.size}.`
  );
}

const missingMarqueeSlugs = MARQUEE_TRADE_SLUGS.filter(
  (slug) => !tradeSlugSet.has(slug)
);

if (missingMarqueeSlugs.length > 0) {
  errors.push(
    `Missing ${missingMarqueeSlugs.length} marquee trade records.`
  );
}

for (const { trade, eligibility } of rows) {
  if (eligibility.adEligible && !eligibility.indexEligible) {
    errors.push(`${trade.slug}: adEligible without indexEligible.`);
  }

  if (eligibility.indexEligible && !eligibility.publicRoute) {
    errors.push(`${trade.slug}: indexEligible without publicRoute.`);
  }

  if (
    eligibility.indexEligible &&
    eligibility.classification !== "editorial-verdict"
  ) {
    errors.push(
      `${trade.slug}: non-editorial classification is indexEligible.`
    );
  }

  if (
    eligibility.marquee &&
    eligibility.classification !== "editorial-verdict"
  ) {
    errors.push(
      `${trade.slug}: marquee record is not editorial-verdict.`
    );
  }
}

for (const { player, eligibility } of playerRows) {
  if (eligibility.adEligible && !eligibility.indexEligible) {
    errors.push(`${player.slug}: adEligible without indexEligible.`);
  }

  if (eligibility.indexEligible && !eligibility.publicRoute) {
    errors.push(`${player.slug}: indexEligible without publicRoute.`);
  }

  if (
    eligibility.indexEligible &&
    ![
      "editorial-player-aggregation",
      "historical-player-aggregation",
    ].includes(eligibility.classification)
  ) {
    errors.push(
      `${player.slug}: unsupported player classification is indexEligible.`
    );
  }

  if (
    eligibility.indexEligible &&
    eligibility.metrics.relationshipCount < 2
  ) {
    errors.push(
      `${player.slug}: one-trade player profile is indexEligible.`
    );
  }

  if (
    eligibility.rolloutWave === "wave-1" &&
    eligibility.metrics.eligibleTradeCount < 1
  ) {
    errors.push(
      `${player.slug}: Wave 1 player has no editorial trade.`
    );
  }

  if (
    eligibility.rolloutWave === "wave-2" &&
    (
      eligibility.metrics.eligibleTradeCount !== 0 ||
      eligibility.metrics.sharedTradeSignature ||
      eligibility.metrics.valueTier === "two-trade-narrow"
    )
  ) {
    errors.push(
      `${player.slug}: Wave 2 player violates value policy.`
    );
  }

  if (
    eligibility.indexEligible &&
    eligibility.metrics.manualReviewTradeCount > 0
  ) {
    errors.push(
      `${player.slug}: manual-review player is indexEligible.`
    );
  }
}

const marqueeRows = rows.filter(
  ({ eligibility }) => eligibility.marquee
);

if (marqueeRows.length !== 52) {
  errors.push(
    `Expected 52 classified marquee rows; found ${marqueeRows.length}.`
  );
}

const eligiblePlayerRows = playerRows.filter(
  ({ eligibility }) => eligibility.indexEligible
);
const adEligiblePlayerRows = playerRows.filter(
  ({ eligibility }) => eligibility.adEligible
);
const eligiblePlayerSlugSet = new Set(
  eligiblePlayerRows.map(({ player }) => player.slug)
);
const adEligiblePlayerSlugSet = new Set(
  adEligiblePlayerRows.map(({ player }) => player.slug)
);

if (
  eligiblePlayerRows.length !==
  adEligiblePlayerRows.length
) {
  errors.push(
    `Player index/ad eligibility counts diverge: ` +
    `${eligiblePlayerRows.length} index eligible vs ` +
    `${adEligiblePlayerRows.length} ad eligible.`
  );
}
if (
  [...eligiblePlayerSlugSet].some(
    (slug) =>
      !adEligiblePlayerSlugSet.has(slug)
  ) ||
  [...adEligiblePlayerSlugSet].some(
    (slug) =>
      !eligiblePlayerSlugSet.has(slug)
  )
) {
  errors.push(
    "Player index/ad eligibility sets diverge."
  );
}

const countBy = (collection, property) =>
  Object.fromEntries(
    [
      ...new Set(
        collection.map(({ eligibility }) =>
          eligibility[property]
        )
      ),
    ]
      .sort()
      .map((value) => [
        String(value),
        collection.filter(
          ({ eligibility }) =>
            eligibility[property] === value
        ).length,
      ])
  );

const reasonCounts = new Map();

for (const { eligibility } of rows) {
  for (const reason of eligibility.reasonCodes) {
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }
}

const indexEligibleTradeCount = rows.filter(
  ({ eligibility }) => eligibility.indexEligible
).length;
const indexEligiblePlayerCount = eligiblePlayerRows.length;

const report = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASSED" : "FAILED",
  adsServingEnabled: ADS_SERVING_ENABLED,
  marquee: {
    expected: 52,
    configured: MARQUEE_TRADE_SLUGS.length,
    unique: uniqueMarqueeSlugs.size,
    matched: marqueeRows.length,
    missingSlugs: missingMarqueeSlugs,
  },
  trades: {
    total: rows.length,
    classificationCounts: countBy(rows, "classification"),
    publicRouteCount: rows.filter(
      ({ eligibility }) => eligibility.publicRoute
    ).length,
    indexEligibleCount: indexEligibleTradeCount,
    adEligibleCount: rows.filter(
      ({ eligibility }) => eligibility.adEligible
    ).length,
    manualRouteReviewCount: rows.filter(
      ({ eligibility }) =>
        eligibility.validationStatus ===
        "manual-route-review-required"
    ).length,
  },
  players: {
    totalRecords: players.length,
    publicRouteCount: playerRows.length,
    classificationCounts: countBy(
      playerRows,
      "classification"
    ),
    rolloutWaveCounts: countBy(
      playerRows,
      "rolloutWave"
    ),
    indexEligibleCount: indexEligiblePlayerCount,
    adEligibleCount: playerRows.filter(
      ({ eligibility }) => eligibility.adEligible
    ).length,
    heldRouteCount:
      playerRows.length - indexEligiblePlayerCount,
  },
  sitemapPlan: {
    staticIndexablePaths: STATIC_INDEXABLE_PATHS,
    indexableTradeRouteCount: indexEligibleTradeCount,
    indexablePlayerRouteCount: indexEligiblePlayerCount,
    plannedHtmlUrlCount:
      STATIC_INDEXABLE_PATHS.length +
      indexEligibleTradeCount +
      indexEligiblePlayerCount,
  },
  reasonCounts: Object.fromEntries(
    [...reasonCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )
  ),
  errors,
  warnings,
  notes: [
    "Public trade and player route closure is preserved in this batch.",
    `Exactly ${
      playerRows.filter(
        ({ eligibility }) =>
          eligibility.rolloutWave === "wave-1"
      ).length
    } Wave 1 and ${
      playerRows.filter(
        ({ eligibility }) =>
          eligibility.rolloutWave === "wave-2"
      ).length
    } Wave 2 player profiles are index and ad eligible.`,
    `The remaining ${
      playerRows.length - indexEligiblePlayerCount
    } public player routes remain noindex and ad-free pending later review.`,
    "Team detail pages remain noindex and ad-free until their remediation phase.",
    "No advertising can load while ADS_SERVING_ENABLED is false.",
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);

if (errors.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
