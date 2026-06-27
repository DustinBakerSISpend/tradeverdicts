const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "team-key-mismatch-deep-inspection.json");

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

function gradeKeys(t) {
  return t.grades && typeof t.grades === "object" && !Array.isArray(t.grades)
    ? Object.keys(t.grades)
    : [];
}

function arr(x) {
  return Array.isArray(x) ? x : [];
}

function sortedUnique(xs) {
  return [...new Set(xs.filter(Boolean).map(String))].sort();
}

function flattenAssets(t) {
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

function hasReviewNeeded(t) {
  return JSON.stringify(t).toLowerCase().includes("review needed");
}

function perspectiveTeams(t) {
  const rows = Array.isArray(t.perspectives) ? t.perspectives : [];
  const teams = [];

  for (const p of rows) {
    if (p.sourceTeam) teams.push(p.sourceTeam);
    if (p.primaryTeam) teams.push(p.primaryTeam);
    if (p.partnerTeam) teams.push(p.partnerTeam);
  }

  return sortedUnique(teams);
}

function perspectiveIds(t) {
  return Array.isArray(t.perspectives)
    ? t.perspectives.map(p => p.sourceTradeId).filter(Boolean)
    : [];
}

function classify(row) {
  const extraTeams = row.teamsWithoutAssetKeys;
  const assetOnlyKeys = row.assetKeysNotInTeams;
  const extraInGrades = extraTeams.filter(team => row.gradeKeys.includes(team));
  const extraInPerspectives = extraTeams.filter(team => row.perspectiveTeams.includes(team));

  if (row.hasReviewNeeded) {
    return {
      classification: "manual-review-placeholder",
      recommendedAction: "Do not auto-fix. This record contains REVIEW NEEDED text and likely needs either suppression or source-level reconstruction."
    };
  }

  if (
    extraTeams.length === 1 &&
    extraTeams[0] === "unknown-team" &&
    assetOnlyKeys.length === 0 &&
    extraInGrades.length === 0 &&
    extraInPerspectives.length === 0 &&
    row.assetKeys.length >= 2
  ) {
    return {
      classification: "probably-safe-remove-extra-unknown-team",
      recommendedAction: "Potentially safe to remove unknown-team from teams only, because it has no assets, grades, or perspective references."
    };
  }

  if (
    extraTeams.length === 1 &&
    extraTeams[0] === "unknown-team" &&
    assetOnlyKeys.length === 0 &&
    row.assetKeys.length < 2
  ) {
    return {
      classification: "not-safe-single-team-after-removal",
      recommendedAction: "Do not auto-fix. Removing unknown-team would leave fewer than two asset-side teams."
    };
  }

  if (assetOnlyKeys.length || extraTeams.some(team => !["unknown-team"].includes(team))) {
    return {
      classification: "structural-team-slug-contamination",
      recommendedAction: "Do not auto-fix. Team slug contamination or missing real team mapping must be repaired manually."
    };
  }

  return {
    classification: "manual-review",
    recommendedAction: "Do not auto-fix without inspecting the full trade."
  };
}

const mismatchRows = [];

for (const t of trades) {
  const teams = sortedUnique(arr(t.teams));
  const keys = sortedUnique(assetKeys(t));

  const assetKeysNotInTeams = keys.filter(k => !teams.includes(k));
  const teamsWithoutAssetKeys = teams.filter(k => !keys.includes(k));

  if (!assetKeysNotInTeams.length && !teamsWithoutAssetKeys.length) continue;

  const base = {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    season: t.season || null,
    teams,
    assetKeys: keys,
    gradeKeys: sortedUnique(gradeKeys(t)),
    sourceTeams: sortedUnique(arr(t.sourceTeams)),
    perspectiveTeams: perspectiveTeams(t),
    perspectiveIds: perspectiveIds(t),
    assetKeysNotInTeams,
    teamsWithoutAssetKeys,
    verdict: t.verdict || null,
    grades: t.grades || null,
    publishStatus: t.publishStatus || null,
    tier: t.tier || null,
    confidence: t.confidence || null,
    hasReviewNeeded: hasReviewNeeded(t),
    assetsReceived: t.assetsReceived || null,
    assetsFlat: flattenAssets(t),
    summary: t.summary || null,
    partnerSummary: t.partnerSummary || null,
    analysis: t.analysis || null,
    qaNotes: t.qaNotes || null
  };

  mismatchRows.push({
    ...base,
    ...classify(base)
  });
}

const countsByClassification = {};
for (const row of mismatchRows) {
  countsByClassification[row.classification] = (countsByClassification[row.classification] || 0) + 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  mismatchCount: mismatchRows.length,
  countsByClassification,
  mismatchRows
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("TEAM-KEY MISMATCH DEEP INSPECTION");
console.log("=".repeat(80));
console.log(`Trades scanned: ${trades.length}`);
console.log(`Team-key mismatches: ${mismatchRows.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Classification counts:");
for (const [k, v] of Object.entries(countsByClassification)) {
  console.log(`- ${k}: ${v}`);
}

for (const row of mismatchRows) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  console.log(`classification: ${row.classification}`);
  console.log(`recommendedAction: ${row.recommendedAction}`);
  console.log(`teams: ${JSON.stringify(row.teams)}`);
  console.log(`assetKeys: ${JSON.stringify(row.assetKeys)}`);
  console.log(`gradeKeys: ${JSON.stringify(row.gradeKeys)}`);
  console.log(`sourceTeams: ${JSON.stringify(row.sourceTeams)}`);
  console.log(`perspectiveTeams: ${JSON.stringify(row.perspectiveTeams)}`);
  console.log(`perspectiveIds: ${JSON.stringify(row.perspectiveIds)}`);
  console.log(`assetKeysNotInTeams: ${JSON.stringify(row.assetKeysNotInTeams)}`);
  console.log(`teamsWithoutAssetKeys: ${JSON.stringify(row.teamsWithoutAssetKeys)}`);
  console.log(`verdict: ${JSON.stringify(row.verdict)}`);
  console.log(`grades: ${JSON.stringify(row.grades)}`);
  console.log(`publishStatus: ${JSON.stringify(row.publishStatus)} | tier=${JSON.stringify(row.tier)} | confidence=${JSON.stringify(row.confidence)}`);
  console.log(`hasReviewNeeded: ${row.hasReviewNeeded}`);

  console.log("assets:");
  for (const asset of row.assetsFlat) {
    console.log(`  ${asset.team}: [${asset.type || "?"}] ${asset.asset}`);
  }

  if (row.summary) console.log(`summary: ${row.summary}`);
  if (row.partnerSummary) console.log(`partnerSummary: ${row.partnerSummary}`);
  if (row.qaNotes) console.log(`qaNotes: ${row.qaNotes}`);
}
