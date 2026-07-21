import fs from "node:fs";
import path from "node:path";
import {
  createEligibilityContext,
} from "../../src/utils/eligibility.js";
import {
  getPublicPlayerRecords,
  getPublicTrades,
} from "../../src/utils/publicRecords.js";
import {
  createPlayerEligibilityContext,
  getPlayerEligibility,
} from "../../src/utils/playerEligibility.js";

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

const csvEscape = (value) => {
  const text = Array.isArray(value)
    ? value.join("|")
    : value === null || value === undefined
      ? ""
      : String(value);

  return `"${text.replace(/"/g, '""')}"`;
};

const writeCsv = (filename, rows, columns) => {
  const lines = [columns.map(csvEscape).join(",")];

  for (const row of rows) {
    lines.push(
      columns.map((column) => csvEscape(row[column])).join(",")
    );
  }

  fs.writeFileSync(
    path.join(path.dirname(outputPath), filename),
    `${lines.join("\n")}\n`,
    "utf8"
  );
};

const trades = readJson("src/data/nfl/trades.json");
const players = readJson("src/data/nfl/players.json");
const publicTrades = getPublicTrades(trades);
const publicPlayers = getPublicPlayerRecords(players, publicTrades);
const tradeContext = createEligibilityContext(trades);
const playerContext = createPlayerEligibilityContext(
  publicPlayers,
  publicTrades,
  tradeContext
);

const rows = publicPlayers.map((player) => ({
  name: player.name,
  slug: player.slug,
  ...getPlayerEligibility(
    player,
    publicTrades,
    playerContext
  ),
}));

const wave1Rows = rows.filter(
  (row) => row.rolloutWave === "wave-1"
);
const wave2Rows = rows.filter(
  (row) => row.rolloutWave === "wave-2"
);
const reviewRows = rows.filter(
  (row) => row.rolloutWave === "wave-2-review"
);
const eligibleRows = rows.filter(
  (row) => row.indexEligible
);
const adEligibleRows = rows.filter(
  (row) => row.adEligible
);

const errors = [];

const eligibleSlugSet = new Set(
  eligibleRows.map((row) => row.slug)
);
const adEligibleSlugSet = new Set(
  adEligibleRows.map((row) => row.slug)
);

if (
  eligibleRows.length !==
  adEligibleRows.length
) {
  errors.push(
    `Player index/ad eligibility counts diverge: ` +
    `${eligibleRows.length} index eligible vs ` +
    `${adEligibleRows.length} ad eligible.`
  );
}
if (
  [...eligibleSlugSet].some(
    (slug) =>
      !adEligibleSlugSet.has(slug)
  ) ||
  [...adEligibleSlugSet].some(
    (slug) =>
      !eligibleSlugSet.has(slug)
  )
) {
  errors.push(
    "Player index/ad eligibility sets diverge."
  );
}
if (
  wave1Rows.length + wave2Rows.length !==
  eligibleRows.length
) {
  errors.push(
    `Eligible player wave partition does not close: ` +
    `${wave1Rows.length} Wave 1 + ` +
    `${wave2Rows.length} Wave 2 != ` +
    `${eligibleRows.length} eligible routes.`
  );
}
if (new Set(wave2Rows.map((row) => row.slug)).size !== wave2Rows.length) {
  errors.push("Wave 2 player slugs are not unique.");
}

for (const row of wave2Rows) {
  if (!row.publicRoute || !row.indexEligible || !row.adEligible) {
    errors.push(`${row.slug}: Wave 2 eligibility closure failed.`);
  }
  if (row.metrics.relationshipCount < 2) {
    errors.push(`${row.slug}: Wave 2 player has fewer than two trades.`);
  }
  if (row.metrics.eligibleTradeCount !== 0) {
    errors.push(`${row.slug}: Wave 2 player unexpectedly has an editorial trade.`);
  }
  if (row.metrics.manualReviewTradeCount !== 0) {
    errors.push(`${row.slug}: Wave 2 player has a manual-review trade.`);
  }
  if (row.metrics.sharedTradeSignature) {
    errors.push(`${row.slug}: shared-signature player entered Wave 2.`);
  }
  if (row.metrics.valueTier === "two-trade-narrow") {
    errors.push(`${row.slug}: narrow two-trade player entered Wave 2.`);
  }
}

for (const row of reviewRows) {
  if (row.indexEligible || row.adEligible) {
    errors.push(`${row.slug}: Wave 2 review route became eligible.`);
  }
  if (
    !row.metrics.sharedTradeSignature &&
    row.metrics.valueTier !== "two-trade-narrow"
  ) {
    errors.push(`${row.slug}: review route lacks a hold reason.`);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASSED" : "FAILED",
  counts: {
    publicPlayerRoutes: rows.length,
    wave1EligibleRoutes: wave1Rows.length,
    wave2EligibleRoutes: wave2Rows.length,
    wave2ReviewRoutes: reviewRows.length,
    totalEligiblePlayerRoutes: eligibleRows.length,
    heldPlayerRoutes: rows.filter((row) => !row.indexEligible).length,
    sharedSignatureReviewRoutes: reviewRows.filter(
      (row) => row.metrics.sharedTradeSignature
    ).length,
    narrowTwoTradeReviewRoutes: reviewRows.filter(
      (row) => row.metrics.valueTier === "two-trade-narrow"
    ).length,
  },
  policy: {
    requiresUniqueTradeSignature: true,
    rejectsNarrowTwoTradeProfiles: true,
    requiresNoManualReviewTrades: true,
    actualAdsServingEnabled: false,
  },
  errors,
};

fs.writeFileSync(
  outputPath,
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);

const columns = [
  "name",
  "slug",
  "classification",
  "validationStatus",
  "rolloutWave",
  "indexEligible",
  "adEligible",
  "relatedTradeSlugs",
];

writeCsv(
  "01-wave-2-eligible-player-routes.csv",
  wave2Rows.sort((a, b) => a.name.localeCompare(b.name)),
  columns
);

writeCsv(
  "02-wave-2-held-review-routes.csv",
  reviewRows.sort((a, b) => a.name.localeCompare(b.name)),
  [
    ...columns,
    "metrics",
  ]
);

if (errors.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
