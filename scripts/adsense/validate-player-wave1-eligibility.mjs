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
const allEligibleRows = rows.filter(
  (row) => row.indexEligible
);
const allAdEligibleRows = rows.filter(
  (row) => row.adEligible
);

const errors = [];

if (rows.length !== 6778) {
  errors.push(`Expected 6,778 public player routes; found ${rows.length}.`);
}
const eligibleSlugSet = new Set(
  allEligibleRows.map((row) => row.slug)
);
const adEligibleSlugSet = new Set(
  allAdEligibleRows.map((row) => row.slug)
);

if (
  allEligibleRows.length !==
  allAdEligibleRows.length
) {
  errors.push(
    `Player index/ad eligibility counts diverge: ` +
    `${allEligibleRows.length} index eligible vs ` +
    `${allAdEligibleRows.length} ad eligible.`
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
  allEligibleRows.length
) {
  errors.push(
    `Eligible player wave partition does not close: ` +
    `${wave1Rows.length} Wave 1 + ` +
    `${wave2Rows.length} Wave 2 != ` +
    `${allEligibleRows.length} eligible routes.`
  );
}
if (new Set(wave1Rows.map((row) => row.slug)).size !== wave1Rows.length) {
  errors.push("Wave 1 player slugs are not unique.");
}

for (const row of wave1Rows) {
  if (!row.publicRoute || !row.indexEligible || !row.adEligible) {
    errors.push(`${row.slug}: Wave 1 eligibility closure failed.`);
  }
  if (row.metrics.relationshipCount < 2) {
    errors.push(`${row.slug}: Wave 1 player has fewer than two trades.`);
  }
  if (row.metrics.eligibleTradeCount < 1) {
    errors.push(`${row.slug}: Wave 1 player lacks an editorial trade.`);
  }
  if (row.metrics.manualReviewTradeCount > 0) {
    errors.push(`${row.slug}: Wave 1 player has a manual-review trade.`);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASSED" : "FAILED",
  counts: {
    publicPlayerRoutes: rows.length,
    wave1PlayerRoutes: wave1Rows.length,
    wave2PlayerRoutes: wave2Rows.length,
    totalIndexEligiblePlayerRoutes: allEligibleRows.length,
    totalAdEligiblePlayerRoutes: rows.filter((row) => row.adEligible).length,
    heldPlayerRoutes: rows.filter((row) => !row.indexEligible).length,
  },
  policy: {
    wave1RequiresMultipleTrades: true,
    wave1RequiresEditorialTrade: true,
    wave1RejectsManualReviewTrades: true,
    adsServingEnabled: false,
  },
  errors,
};

fs.writeFileSync(
  outputPath,
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);

const csvPath = path.join(
  path.dirname(outputPath),
  "01-wave-1-player-routes.csv"
);
const columns = [
  "name",
  "slug",
  "classification",
  "rolloutWave",
  "indexEligible",
  "adEligible",
  "relatedTradeSlugs",
];
const lines = [columns.map(csvEscape).join(",")];

for (const row of wave1Rows.sort(
  (a, b) =>
    String(a.name).localeCompare(String(b.name)) ||
    String(a.slug).localeCompare(String(b.slug))
)) {
  lines.push(
    columns.map((column) => csvEscape(row[column])).join(",")
  );
}

fs.writeFileSync(csvPath, `${lines.join("\n")}\n`, "utf8");

if (errors.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
