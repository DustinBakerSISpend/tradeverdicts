const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "likely-blended-one-pick-clusters-inspection.json");

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

function assetKeys(t) {
  return t.assetsReceived && typeof t.assetsReceived === "object" && !Array.isArray(t.assetsReceived)
    ? Object.keys(t.assetsReceived)
    : [];
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
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12
  };

  const wordHash = /\b((?:19|20)\d{2})\s+([a-z]+)\s+round pick\s*\(#(\d+)/gi;
  while ((m = wordHash.exec(text))) {
    const round = wordToRound[String(m[2]).toLowerCase()];
    if (round) keys.push(`${m[1]}-${round}-${Number(m[3])}`);
  }

  return [...new Set(keys)];
}

function looksLikeGenericUnknownPick(asset) {
  return /\bdraft pick\b/i.test(asset) && (
    /\?\-\?/.test(asset) ||
    /undisclosed/i.test(asset) ||
    !extractPickKeys(asset).length
  );
}

function isLikelyBlendedOnePickCluster(t) {
  const teams = Array.isArray(t.teams) ? t.teams : [];
  const keys = assetKeys(t);
  if (teams.length <= 2 || keys.length <= 2) return false;

  const allOneAsset = keys.every(team => {
    const rows = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];
    return rows.length === 1;
  });

  const allPickOnly = flattenAssets(t).every(a => a.type === "pick");

  return allOneAsset && allPickOnly;
}

const allAssets = trades.flatMap(flattenAssets);

const exactIndex = new Map();
const pickKeyIndex = new Map();

for (const row of allAssets) {
  const norm = normalize(row.asset);
  if (!exactIndex.has(norm)) exactIndex.set(norm, []);
  exactIndex.get(norm).push(row);

  for (const key of extractPickKeys(row.asset)) {
    if (!pickKeyIndex.has(key)) pickKeyIndex.set(key, []);
    pickKeyIndex.get(key).push(row);
  }
}

const clusters = [];

for (const trade of trades) {
  if (!isLikelyBlendedOnePickCluster(trade)) continue;

  const slug = slugOf(trade);
  const assets = flattenAssets(trade);

  const assetCoverage = assets.map(row => {
    const norm = normalize(row.asset);
    const pickKeys = extractPickKeys(row.asset);

    const exactMatchesElsewhere = (exactIndex.get(norm) || [])
      .filter(m => m.slug !== slug)
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
        if (match.slug !== slug) {
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

    const covered =
      exactMatchesElsewhere.length > 0 ||
      pickKeyMatchesElsewhere.length > 0;

    return {
      team: row.team,
      type: row.type,
      asset: row.asset,
      pickKeys,
      genericUnknownPick: looksLikeGenericUnknownPick(row.asset),
      covered,
      exactMatchesElsewhere,
      pickKeyMatchesElsewhere
    };
  });

  const coveredCount = assetCoverage.filter(a => a.covered).length;
  const genericUnknownCount = assetCoverage.filter(a => a.genericUnknownPick).length;
  const uncovered = assetCoverage.filter(a => !a.covered);

  let classification;
  let recommendedAction;

  if (genericUnknownCount > 0) {
    classification = "generic-unknown-pick-cluster";
    recommendedAction = "Do not auto-suppress. Generic/undisclosed picks cannot be confidently tied to standalone pages.";
  } else if (coveredCount === assetCoverage.length) {
    classification = "likely-synthetic-aggregate-covered-elsewhere";
    recommendedAction = "Candidate for suppression after dry-run review because every asset has exact or pick-key coverage elsewhere.";
  } else if (coveredCount >= Math.ceil(assetCoverage.length / 2)) {
    classification = "partially-covered-blended-cluster";
    recommendedAction = "Manual review. Some assets appear covered elsewhere, but not all.";
  } else {
    classification = "needs-research";
    recommendedAction = "Do not auto-fix. Coverage elsewhere is weak.";
  }

  clusters.push({
    slug,
    id: trade.id || null,
    tradeDate: dateOf(trade),
    teams: trade.teams || [],
    assetKeys: assetKeys(trade),
    verdict: trade.verdict || null,
    grades: trade.grades || null,
    publishStatus: trade.publishStatus || null,
    tier: trade.tier || null,
    confidence: trade.confidence || null,
    summary: trade.summary || null,
    partnerSummary: trade.partnerSummary || null,
    qaNotes: trade.qaNotes || null,
    classification,
    recommendedAction,
    assetCount: assetCoverage.length,
    coveredCount,
    uncoveredCount: uncovered.length,
    genericUnknownCount,
    assetCoverage
  });
}

const countsByClassification = {};
for (const row of clusters) {
  countsByClassification[row.classification] = (countsByClassification[row.classification] || 0) + 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  clusterCount: clusters.length,
  countsByClassification,
  clusters
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("LIKELY BLENDED ONE-PICK CLUSTERS INSPECTION");
console.log("=".repeat(80));
console.log(`Trades scanned: ${trades.length}`);
console.log(`Likely blended one-pick clusters: ${clusters.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Classification counts:");
for (const [k, v] of Object.entries(countsByClassification)) {
  console.log(`- ${k}: ${v}`);
}

for (const row of clusters) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  console.log(`classification: ${row.classification}`);
  console.log(`recommendedAction: ${row.recommendedAction}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`assetKeys=${JSON.stringify(row.assetKeys)}`);
  console.log(`verdict=${JSON.stringify(row.verdict)} | grades=${JSON.stringify(row.grades)}`);
  console.log(`assets covered: ${row.coveredCount}/${row.assetCount}; genericUnknown=${row.genericUnknownCount}`);

  for (const asset of row.assetCoverage) {
    console.log(`  - ${asset.team}: ${asset.asset}`);
    console.log(`    pickKeys=${JSON.stringify(asset.pickKeys)} covered=${asset.covered} genericUnknown=${asset.genericUnknownPick}`);

    const bestMatches = [
      ...asset.exactMatchesElsewhere.map(m => ({ kind: "exact", ...m })),
      ...asset.pickKeyMatchesElsewhere.map(m => ({ kind: "pick-key", ...m }))
    ].slice(0, 5);

    for (const match of bestMatches) {
      console.log(`    ${match.kind} => ${match.slug} | ${match.team} | ${match.asset}`);
    }
  }
}
