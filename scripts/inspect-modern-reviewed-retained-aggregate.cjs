const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "modern-reviewed-retained-aggregate-inspection.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];

if (!Array.isArray(trades) || trades.length === 0) {
  console.error("Could not find trades array.");
  process.exit(1);
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || t.transactionDate || null;
}

function keysOf(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
}

function assetKeys(t) {
  return keysOf(t.assetsReceived).sort();
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function flattenAssets(t) {
  const rows = [];

  for (const team of assetKeys(t)) {
    const assets = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];
    for (const [index, item] of assets.entries()) {
      rows.push({
        slug: slugOf(t),
        id: t.id || null,
        date: dateOf(t),
        team,
        index,
        type: item && item.type ? item.type : null,
        asset: item && item.asset ? item.asset : ""
      });
    }
  }

  return rows.filter(r => r.asset);
}

function extractPickKeys(asset) {
  const text = String(asset || "");
  const keys = [];

  const numeric = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)?\s+round pick\s*\((\d+)(?:st|nd|rd|th)?\s+overall/gi;
  let m;
  while ((m = numeric.exec(text))) {
    keys.push(`${m[1]}-${Number(m[2])}-${Number(m[3])}`);
  }

  const wordToRound = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7
  };

  const wordHash = /\b((?:19|20)\d{2})\s+([a-z]+)\s+round pick\s*\(#(\d+)/gi;
  while ((m = wordHash.exec(text))) {
    const round = wordToRound[String(m[2]).toLowerCase()];
    if (round) keys.push(`${m[1]}-${round}-${Number(m[3])}`);
  }

  return [...new Set(keys)];
}

const targetSlug = "reviewed-and-retained-for-public-data-completeness";
const matches = trades.filter(t => slugOf(t) === targetSlug);

const exactIndex = new Map();
const pickKeyIndex = new Map();

for (const trade of trades) {
  for (const row of flattenAssets(trade)) {
    const norm = normalize(row.asset);
    if (!exactIndex.has(norm)) exactIndex.set(norm, []);
    exactIndex.get(norm).push(row);

    for (const key of extractPickKeys(row.asset)) {
      if (!pickKeyIndex.has(key)) pickKeyIndex.set(key, []);
      pickKeyIndex.get(key).push(row);
    }
  }
}

const errors = [];
const inspected = [];

if (matches.length !== 1) {
  errors.push(`Expected exactly one target match for ${targetSlug}; found ${matches.length}`);
}

for (const trade of matches) {
  const assets = flattenAssets(trade);

  const assetCoverage = assets.map(row => {
    const norm = normalize(row.asset);
    const pickKeys = extractPickKeys(row.asset);

    const exactMatchesElsewhere = (exactIndex.get(norm) || [])
      .filter(m => m.slug !== row.slug)
      .map(m => ({
        slug: m.slug,
        id: m.id,
        date: m.date,
        team: m.team,
        asset: m.asset
      }));

    const pickKeyMatchesElsewhere = [];

    for (const key of pickKeys) {
      for (const match of pickKeyIndex.get(key) || []) {
        if (match.slug !== row.slug) {
          pickKeyMatchesElsewhere.push({
            pickKey: key,
            slug: match.slug,
            id: match.id,
            date: match.date,
            team: match.team,
            asset: match.asset
          });
        }
      }
    }

    return {
      team: row.team,
      index: row.index,
      type: row.type,
      asset: row.asset,
      pickKeys,
      exactCoverageCount: exactMatchesElsewhere.length,
      pickKeyCoverageCount: pickKeyMatchesElsewhere.length,
      covered: exactMatchesElsewhere.length > 0 || pickKeyMatchesElsewhere.length > 0,
      exactMatchesElsewhere,
      pickKeyMatchesElsewhere
    };
  });

  inspected.push({
    id: trade.id || null,
    slug: slugOf(trade),
    tradeDate: dateOf(trade),
    season: trade.season || null,
    publishStatus: trade.publishStatus || null,
    suppressed: trade.suppressed ?? null,
    teams: trade.teams || null,
    assetKeys: assetKeys(trade),
    grades: trade.grades || null,
    verdict: trade.verdict || null,
    tier: trade.tier || null,
    confidence: trade.confidence || null,
    summary: trade.summary || null,
    partnerSummary: trade.partnerSummary || null,
    analysis: trade.analysis || null,
    qaNotes: trade.qaNotes || null,
    perspectives: trade.perspectives || null,
    sourceTeams: trade.sourceTeams || null,
    assetsReceived: trade.assetsReceived || null,
    assetCoverage,
    coverage: {
      assetCount: assetCoverage.length,
      coveredCount: assetCoverage.filter(a => a.covered).length,
      uncoveredCount: assetCoverage.filter(a => !a.covered).length,
      allCovered: assetCoverage.length > 0 && assetCoverage.every(a => a.covered)
    }
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  targetSlug,
  matchCount: matches.length,
  errors,
  inspected
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("MODERN REVIEWED/RETAINED AGGREGATE INSPECTION");
console.log("=".repeat(80));
console.log(`Target slug: ${targetSlug}`);
console.log(`Matches: ${matches.length}`);
console.log(`Errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

if (errors.length) {
  console.log("");
  console.log("ERRORS:");
  for (const error of errors) console.log(`- ${error}`);
  process.exit(1);
}

for (const row of inspected) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  console.log(`publishStatus=${JSON.stringify(row.publishStatus)} suppressed=${JSON.stringify(row.suppressed)}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`assetKeys=${JSON.stringify(row.assetKeys)}`);
  console.log(`verdict=${JSON.stringify(row.verdict)} | grades=${JSON.stringify(row.grades)}`);
  console.log(`coverage=${row.coverage.coveredCount}/${row.coverage.assetCount}; allCovered=${row.coverage.allCovered}`);
  console.log(`qaNotes=${JSON.stringify(row.qaNotes)}`);

  console.log("");
  console.log("FULL assetsReceived:");
  console.dir(row.assetsReceived, { depth: null });

  console.log("");
  console.log("Asset coverage:");
  for (const asset of row.assetCoverage) {
    console.log("-".repeat(60));
    console.log(`${asset.team}: [${asset.type || "?"}] ${asset.asset}`);
    console.log(`pickKeys=${JSON.stringify(asset.pickKeys)} covered=${asset.covered} exactCoverage=${asset.exactCoverageCount} pickKeyCoverage=${asset.pickKeyCoverageCount}`);

    const matches = [
      ...asset.exactMatchesElsewhere.map(m => ({ kind: "exact", ...m })),
      ...asset.pickKeyMatchesElsewhere.map(m => ({ kind: "pick-key", ...m }))
    ].slice(0, 8);

    for (const match of matches) {
      console.log(`  ${match.kind} => ${match.slug} | ${match.team} | ${match.asset}`);
    }
  }

  console.log("");
  console.log("Summary:");
  console.log(row.summary || "(none)");

  console.log("");
  console.log("Partner summary:");
  console.log(row.partnerSummary || "(none)");
}
