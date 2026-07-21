import fs from "node:fs";
import path from "node:path";
import {
  getExplicitPlayerTradeSlugs,
  getPublicPlayerRecords,
  getPublicTrades,
  getRelatedPublicTrades,
  isPublicPlayerRecord,
} from "../../src/utils/publicRecords.js";

const repo = process.cwd();
const outputFolder = process.argv[2];

if (!outputFolder) {
  throw new Error("Output folder is required.");
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
    path.join(outputFolder, filename),
    `${lines.join("\n")}\n`,
    "utf8"
  );
};

const unique = (values) => [...new Set(values)];
const players = readJson("src/data/nfl/players.json");
const trades = readJson("src/data/nfl/trades.json");
const publicTrades = getPublicTrades(trades);
const publicTradeSlugSet = new Set(
  publicTrades.map((trade) => trade.slug).filter(Boolean)
);

const publicAssetBlobs = publicTrades.map((trade) => ({
  slug: trade.slug,
  blob: JSON.stringify(trade.assetsReceived || {}).toLowerCase(),
}));

const getOldFallbackMatches = (player) => {
  const playerName = String(player?.name || "")
    .trim()
    .toLowerCase();

  if (!playerName) return [];

  return publicAssetBlobs
    .filter((trade) => trade.blob.includes(playerName))
    .map((trade) => trade.slug);
};

const transactionLanguageRe =
  /\b(?:did not convey|no asset listed|raw source|player(?:\(s\))? to be named later|cash considerations|future considerations|conditional pick|draft pick|rights to|compensation)\b/i;

const pseudoNameRe =
  /^(?:undisclosed|unknown|not clearly specified|not conveyed|no consideration|player(?:\(s\))? to be named later)/i;

const validSlugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const rows = players.map((player) => {
  const name = String(player?.name || "").trim();
  const slug = String(player?.slug || "").trim();
  const explicitSlugs = getExplicitPlayerTradeSlugs(player);
  const exactPublicSlugs = explicitSlugs.filter(
    (tradeSlug) => publicTradeSlugSet.has(tradeSlug)
  );

  const oldFallbackSlugs = getOldFallbackMatches(player);
  const exactSet = new Set(exactPublicSlugs);
  const fallbackOnlySlugs = oldFallbackSlugs.filter(
    (tradeSlug) => !exactSet.has(tradeSlug)
  );

  const openParentheses = (name.match(/\(/g) || []).length;
  const closeParentheses = (name.match(/\)/g) || []).length;
  const tokenCount = name.split(/\s+/).filter(Boolean).length;

  const malformedReasons = [];

  if (!name) malformedReasons.push("missing-name");
  if (!slug || !validSlugRe.test(slug)) {
    malformedReasons.push("invalid-slug");
  }
  if (/^\d+$/.test(name)) malformedReasons.push("numeric-name");
  if (pseudoNameRe.test(name)) {
    malformedReasons.push("pseudo-player-name");
  }
  if (transactionLanguageRe.test(name)) {
    malformedReasons.push("transaction-language-name");
  }
  if (tokenCount === 1) malformedReasons.push("one-token-name");
  if (openParentheses !== closeParentheses) {
    malformedReasons.push("unbalanced-parentheses");
  }

  return {
    name,
    slug,
    sourcePublicRecord: isPublicPlayerRecord(player),
    exactPublicTradeCount: exactPublicSlugs.length,
    exactPublicTradeSlugs: exactPublicSlugs,
    oldSubstringMatchCount: oldFallbackSlugs.length,
    fallbackOnlyCount: fallbackOnlySlugs.length,
    sampleFallbackOnlySlugs: fallbackOnlySlugs.slice(0, 20),
    malformedReasons: unique(malformedReasons),
  };
});

const exactPublicPlayers = getPublicPlayerRecords(
  players,
  publicTrades
);

const watchNames = ["Ja", "Nick", "Micah"];

const watchRows = rows.filter((row) =>
  watchNames.includes(row.name)
);

const errors = [];

for (const watchName of watchNames) {
  const matches = watchRows.filter((row) => row.name === watchName);

  if (matches.length !== 1) {
    errors.push(
      `${watchName}: expected one player record, found ${matches.length}.`
    );
    continue;
  }

  if (matches[0].exactPublicTradeCount !== 1) {
    errors.push(
      `${watchName}: expected one exact public trade, found ${matches[0].exactPublicTradeCount}.`
    );
  }
}

for (const player of exactPublicPlayers) {
  const related = getRelatedPublicTrades(player, publicTrades);
  const explicitSet = new Set(
    getExplicitPlayerTradeSlugs(player)
  );

  const unexpected = related.filter(
    (trade) => !explicitSet.has(trade.slug)
  );

  if (unexpected.length > 0) {
    errors.push(
      `${player.slug}: ${unexpected.length} non-explicit related trades remain.`
    );
  }
}

const publicPlayerSlugs = new Set(
  exactPublicPlayers.map((player) => player.slug)
);

const noExactPublicRelationship = rows.filter(
  (row) =>
    row.sourcePublicRecord &&
    row.exactPublicTradeCount === 0
);

const malformedQueue = rows.filter(
  (row) => row.malformedReasons.length > 0
);

const fallbackRiskQueue = rows
  .filter((row) => row.fallbackOnlyCount > 0)
  .sort(
    (a, b) =>
      b.fallbackOnlyCount - a.fallbackOnlyCount ||
      a.name.localeCompare(b.name)
  );

const implausibleQueue = rows
  .filter(
    (row) =>
      row.oldSubstringMatchCount >= 10 ||
      row.fallbackOnlyCount >= 5
  )
  .sort(
    (a, b) =>
      b.oldSubstringMatchCount - a.oldSubstringMatchCount ||
      a.name.localeCompare(b.name)
  );

const summary = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASSED" : "FAILED",
  policy: {
    relationshipSource:
      "Only explicit player.tradeSlugs values may establish player-trade relationships.",
    forbiddenFallback:
      "Serialized trade JSON substring matching is prohibited.",
    dataMutation:
      "No players.json or trades.json records were changed in this batch.",
  },
  counts: {
    playerRecords: players.length,
    publicTrades: publicTrades.length,
    exactPublicPlayerRoutes: exactPublicPlayers.length,
    sourcePublicPlayersWithNoExactPublicRelationship:
      noExactPublicRelationship.length,
    playersWithFallbackOnlyMatches: fallbackRiskQueue.length,
    totalFallbackOnlyAssociations: fallbackRiskQueue.reduce(
      (sum, row) => sum + row.fallbackOnlyCount,
      0
    ),
    malformedCandidateRecords: malformedQueue.length,
    implausibleOldRelationshipRecords: implausibleQueue.length,
    oneExactPublicTrade: rows.filter(
      (row) =>
        publicPlayerSlugs.has(row.slug) &&
        row.exactPublicTradeCount === 1
    ).length,
    multipleExactPublicTrades: rows.filter(
      (row) =>
        publicPlayerSlugs.has(row.slug) &&
        row.exactPublicTradeCount > 1
    ).length,
  },
  watchNames: watchRows,
  errors,
  notes: [
    "Malformed-name candidates are reported but not automatically suppressed in this batch.",
    "All player detail pages remain noindex and ad-free from Phase 2.",
    "Player page redesign remains a separate Phase 4 batch.",
  ],
};

fs.mkdirSync(outputFolder, { recursive: true });

fs.writeFileSync(
  path.join(outputFolder, "00-player-relationship-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);

writeCsv(
  "01-malformed-player-review.csv",
  malformedQueue,
  [
    "name",
    "slug",
    "sourcePublicRecord",
    "exactPublicTradeCount",
    "exactPublicTradeSlugs",
    "oldSubstringMatchCount",
    "fallbackOnlyCount",
    "malformedReasons",
  ]
);

writeCsv(
  "02-fallback-only-risk.csv",
  fallbackRiskQueue,
  [
    "name",
    "slug",
    "sourcePublicRecord",
    "exactPublicTradeCount",
    "exactPublicTradeSlugs",
    "oldSubstringMatchCount",
    "fallbackOnlyCount",
    "sampleFallbackOnlySlugs",
    "malformedReasons",
  ]
);

writeCsv(
  "03-implausible-old-relationship-counts.csv",
  implausibleQueue,
  [
    "name",
    "slug",
    "sourcePublicRecord",
    "exactPublicTradeCount",
    "oldSubstringMatchCount",
    "fallbackOnlyCount",
    "sampleFallbackOnlySlugs",
    "malformedReasons",
  ]
);

writeCsv(
  "04-no-exact-public-relationship.csv",
  noExactPublicRelationship,
  [
    "name",
    "slug",
    "sourcePublicRecord",
    "exactPublicTradeCount",
    "oldSubstringMatchCount",
    "fallbackOnlyCount",
    "sampleFallbackOnlySlugs",
    "malformedReasons",
  ]
);

writeCsv(
  "05-watch-names.csv",
  watchRows,
  [
    "name",
    "slug",
    "exactPublicTradeCount",
    "exactPublicTradeSlugs",
    "oldSubstringMatchCount",
    "fallbackOnlyCount",
    "sampleFallbackOnlySlugs",
  ]
);

const source = fs.readFileSync(
  path.join(repo, "src/utils/publicRecords.js"),
  "utf8"
);

if (
  source.includes("JSON.stringify(trade.assetsReceived") ||
  source.includes(".includes(playerName)")
) {
  errors.push(
    "Forbidden serialized substring matching remains in publicRecords.js."
  );
}

if (errors.length > 0) {
  summary.status = "FAILED";
  summary.errors = errors;

  fs.writeFileSync(
    path.join(outputFolder, "00-player-relationship-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );

  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));