const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "active-public-contamination-summary.json");

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

function sortedUnique(xs) {
  return [...new Set((xs || []).filter(Boolean).map(String))].sort();
}

function assetKeys(t) {
  return sortedUnique(keysOf(t.assetsReceived));
}

function gradeKeys(t) {
  return sortedUnique(keysOf(t.grades));
}

function assetsFlat(t) {
  const rows = [];

  for (const team of assetKeys(t)) {
    const assets = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];
    for (const [index, item] of assets.entries()) {
      rows.push({
        team,
        index,
        type: item && item.type ? item.type : null,
        asset: item && item.asset ? item.asset : ""
      });
    }
  }

  return rows;
}

function isPickOnlyOneAssetCluster(t) {
  const keys = assetKeys(t);
  if (keys.length <= 2) return false;

  return keys.every(team => {
    const rows = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];
    return rows.length === 1 && rows.every(item => item && item.type === "pick");
  });
}

function mismatchInfo(t) {
  const teams = sortedUnique(t.teams || []);
  const keys = assetKeys(t);

  return {
    teams,
    assetKeys: keys,
    assetKeysNotInTeams: keys.filter(k => !teams.includes(k)),
    teamsWithoutAssetKeys: teams.filter(k => !keys.includes(k))
  };
}

function shapeOf(t) {
  const mm = mismatchInfo(t);
  const teams = mm.teams;
  const keys = mm.assetKeys;

  const hasMismatch = mm.assetKeysNotInTeams.length > 0 || mm.teamsWithoutAssetKeys.length > 0;

  if (hasMismatch && (teams.length <= 2 && keys.length <= 2)) {
    return "teams/assetsReceived key mismatch";
  }

  if (hasMismatch && teams.length > 2 && keys.length <= 2) {
    return "teams/assetsReceived key mismatch";
  }

  if (isPickOnlyOneAssetCluster(t)) {
    return "likely blended one-pick trade cluster";
  }

  if (teams.length > 2 || keys.length > 2) {
    return "multi-team asset cluster";
  }

  if (hasMismatch) {
    return "teams/assetsReceived key mismatch";
  }

  return "clean";
}

function isSuspicious(t) {
  return shapeOf(t) !== "clean";
}

function compact(t) {
  const mm = mismatchInfo(t);
  const shape = shapeOf(t);

  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    season: t.season || null,
    suppressed: t.suppressed === true,
    publishStatus: t.publishStatus || null,
    shape,
    teams: mm.teams,
    assetKeys: mm.assetKeys,
    gradeKeys: gradeKeys(t),
    teamsWithoutAssetKeys: mm.teamsWithoutAssetKeys,
    assetKeysNotInTeams: mm.assetKeysNotInTeams,
    verdict: t.verdict || null,
    grades: t.grades || null,
    tier: t.tier || null,
    confidence: t.confidence || null,
    assets: assetsFlat(t),
    qaNotes: t.qaNotes || null,
    summary: t.summary || null
  };
}

const suspiciousAll = trades.filter(isSuspicious).map(compact);
const suspiciousSuppressed = suspiciousAll.filter(row => row.suppressed);
const suspiciousActive = suspiciousAll.filter(row => !row.suppressed);

function countsBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const value = row[key] || "(missing)";
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function printCounts(title, counts) {
  console.log(title);
  const entries = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    console.log("- none");
    return;
  }
  for (const [k, v] of entries) console.log(`- ${k}: ${v}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  suppressedTradeCount: trades.filter(t => t.suppressed === true).length,
  suspiciousAllCount: suspiciousAll.length,
  suspiciousSuppressedCount: suspiciousSuppressed.length,
  suspiciousActiveCount: suspiciousActive.length,
  counts: {
    allByShape: countsBy(suspiciousAll, "shape"),
    suppressedByShape: countsBy(suspiciousSuppressed, "shape"),
    activeByShape: countsBy(suspiciousActive, "shape"),
    activeByPublishStatus: countsBy(suspiciousActive, "publishStatus")
  },
  suspiciousActive,
  suspiciousSuppressed
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("ACTIVE PUBLIC CONTAMINATION SUMMARY");
console.log("=".repeat(80));
console.log(`Trades scanned: ${trades.length}`);
console.log(`Suppressed trades total: ${report.suppressedTradeCount}`);
console.log(`Suspicious all: ${report.suspiciousAllCount}`);
console.log(`Suspicious suppressed: ${report.suspiciousSuppressedCount}`);
console.log(`Suspicious active/unsuppressed: ${report.suspiciousActiveCount}`);
console.log(`Report: ${outPath}`);

console.log("");
printCounts("All suspicious by shape:", report.counts.allByShape);

console.log("");
printCounts("Suppressed suspicious by shape:", report.counts.suppressedByShape);

console.log("");
printCounts("Active suspicious by shape:", report.counts.activeByShape);

console.log("");
printCounts("Active suspicious by publishStatus:", report.counts.activeByPublishStatus);

console.log("");
console.log("Active suspicious records:");
for (const row of suspiciousActive) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  console.log(`shape=${row.shape} | publishStatus=${row.publishStatus} | suppressed=${row.suppressed}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`assetKeys=${JSON.stringify(row.assetKeys)}`);
  console.log(`teamsWithoutAssetKeys=${JSON.stringify(row.teamsWithoutAssetKeys)}`);
  console.log(`assetKeysNotInTeams=${JSON.stringify(row.assetKeysNotInTeams)}`);
  console.log(`verdict=${JSON.stringify(row.verdict)} | grades=${JSON.stringify(row.grades)}`);
  console.log("assets:");
  for (const asset of row.assets) {
    console.log(`  ${asset.team}: [${asset.type || "?"}] ${asset.asset}`);
  }
}
