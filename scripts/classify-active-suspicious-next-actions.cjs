const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const activePath = path.join(process.cwd(), "audits", "active-public-contamination-summary.json");
const onePickPath = path.join(process.cwd(), "audits", "likely-blended-one-pick-clusters-inspection.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "active-suspicious-next-action-classification.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(activePath)) {
  console.error(`Missing active contamination summary: ${activePath}`);
  console.error("Run scripts\\audit-active-public-contamination.cjs first.");
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];
const activeReport = JSON.parse(fs.readFileSync(activePath, "utf8"));
const onePickReport = fs.existsSync(onePickPath)
  ? JSON.parse(fs.readFileSync(onePickPath, "utf8"))
  : { clusters: [] };

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

function textOf(t) {
  return JSON.stringify(t || "").toLowerCase();
}

function assetTextOf(t) {
  return assetsFlat(t).map(a => a.asset).join(" | ").toLowerCase();
}

function hasFakeTeamSlug(t) {
  const teams = Array.isArray(t.teams) ? t.teams : [];
  return teams.some(team => {
    const s = String(team || "").toLowerCase();
    return (
      s.includes("voided") ||
      s.includes("cancelled") ||
      s.includes("canceled") ||
      s.includes("refused") ||
      s.includes("mutually") ||
      s.includes("after-") ||
      s.split("-").length >= 8
    );
  });
}

function mismatchInfo(t) {
  const teams = sortedUnique(t.teams || []);
  const keys = assetKeys(t);

  return {
    teams,
    assetKeys: keys,
    teamsWithoutAssetKeys: teams.filter(team => !keys.includes(team)),
    assetKeysNotInTeams: keys.filter(team => !teams.includes(team))
  };
}

function isGenericUnknownAsset(asset) {
  const s = String(asset || "").toLowerCase();
  return (
    s.includes("undisclosed") ||
    s.includes("not disclosed") ||
    s.includes("?-?") ||
    s.includes("past considerations") ||
    s.includes("cash") ||
    s.includes("$1 cash")
  );
}

function isSpecificPick(asset) {
  return /\b(19|20)\d{2}\s+\d+(st|nd|rd|th)?\s+round pick\s*\(/i.test(asset) ||
    /\b(19|20)\d{2}\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+round pick\s*\(/i.test(asset);
}

function allAssetsGeneric(t) {
  const assets = assetsFlat(t);
  return assets.length > 0 && assets.every(a => isGenericUnknownAsset(a.asset));
}

function hasMostlyCashOrPastConsiderations(t) {
  const assets = assetsFlat(t);
  if (!assets.length) return false;

  const genericCount = assets.filter(a => isGenericUnknownAsset(a.asset)).length;
  return genericCount / assets.length >= 0.5;
}

function hasSpecificPickChain(t) {
  const assets = assetsFlat(t);
  return assets.filter(a => isSpecificPick(a.asset)).length >= 3;
}

function hasMixedPlayersAndGenericComp(t) {
  const assets = assetsFlat(t);
  const playerCount = assets.filter(a => a.type === "player").length;
  const genericCount = assets.filter(a => isGenericUnknownAsset(a.asset)).length;
  return playerCount > 0 && genericCount > 0;
}

function isModern(t) {
  const d = String(dateOf(t) || "");
  return d >= "2020-01-01";
}

function shapeOf(t) {
  const activeRow = (activeReport.suspiciousActive || []).find(row => row.slug === slugOf(t));
  return activeRow ? activeRow.shape : "unknown";
}

const onePickBySlug = new Map((onePickReport.clusters || []).map(row => [row.slug, row]));

function classify(t) {
  const slug = slugOf(t);
  const shape = shapeOf(t);
  const mm = mismatchInfo(t);
  const onePick = onePickBySlug.get(slug);
  const assetText = assetTextOf(t);

  const features = {
    shape,
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed === true,
    fakeTeamSlug: hasFakeTeamSlug(t),
    teamsWithoutAssetKeys: mm.teamsWithoutAssetKeys,
    assetKeysNotInTeams: mm.assetKeysNotInTeams,
    allAssetsGeneric: allAssetsGeneric(t),
    mostlyCashOrPastConsiderations: hasMostlyCashOrPastConsiderations(t),
    mixedPlayersAndGenericComp: hasMixedPlayersAndGenericComp(t),
    specificPickChain: hasSpecificPickChain(t),
    modern: isModern(t),
    containsReviewedAndRetainedSlug: slug === "reviewed-and-retained-for-public-data-completeness",
    containsReviewNeeded: textOf(t).includes("review needed"),
    onePickClassification: onePick ? onePick.classification : null,
    onePickCoveredCount: onePick ? onePick.coveredCount : null,
    onePickAssetCount: onePick ? onePick.assetCount : null,
    hasUndisclosedOrUnknown: /undisclosed|unknown|\?\-\?|not disclosed/.test(assetText)
  };

  let bucket;
  let recommendedAction;
  let risk;

  if (features.fakeTeamSlug) {
    bucket = "A1 fake-team-slug contamination";
    recommendedAction = "Manual repair or suppress. Team slug contains transaction language, so do not auto-edit assets.";
    risk = "high";
  } else if (shape === "teams/assetsReceived key mismatch") {
    bucket = "A2 team-assets mismatch manual";
    recommendedAction = "Manual repair. Current team list and asset ownership disagree or leave a one-sided record.";
    risk = "high";
  } else if (features.containsReviewedAndRetainedSlug || features.modern && shape === "multi-team asset cluster") {
    bucket = "B1 modern multi-team aggregate";
    recommendedAction = "High-priority manual inspection. Modern multi-team aggregate is likely public-facing bad data.";
    risk = "high";
  } else if (shape === "likely blended one-pick trade cluster" && onePick) {
    if (onePick.classification === "generic-unknown-pick-cluster") {
      bucket = "C1 generic unknown one-pick cluster";
      recommendedAction = "Likely low-value/manual. Consider suppression only after confirming it is synthetic and not a real multi-team record.";
      risk = "medium";
    } else if (onePick.classification === "needs-research") {
      bucket = "C2 one-pick needs research";
      recommendedAction = "Do not auto-fix. Needs source reconstruction or manual suppression decision.";
      risk = "medium";
    } else if (onePick.classification === "partially-covered-blended-cluster") {
      bucket = "C3 partially covered one-pick cluster";
      recommendedAction = "Manual review. Some assets are covered elsewhere; unresolved assets prevent safe suppression.";
      risk = "medium";
    } else {
      bucket = "C4 one-pick other";
      recommendedAction = "Manual review.";
      risk = "medium";
    }
  } else if (features.allAssetsGeneric) {
    bucket = "D1 all generic/cash/undisclosed";
    recommendedAction = "Possible suppression candidate, but review first because old historical cash/undisclosed records may be intentional.";
    risk = "medium";
  } else if (features.mixedPlayersAndGenericComp) {
    bucket = "D2 historical mixed players plus generic compensation";
    recommendedAction = "Manual review. Likely stitched historical rows; do not auto-suppress unless covered elsewhere.";
    risk = "medium";
  } else if (features.specificPickChain) {
    bucket = "D3 multi-team specific pick chain";
    recommendedAction = "Manual review. May be a draft-chain aggregate; needs coverage check before suppressing.";
    risk = "medium";
  } else {
    bucket = "E manual review remainder";
    recommendedAction = "Manual review.";
    risk = "medium";
  }

  return {
    bucket,
    recommendedAction,
    risk,
    features
  };
}

const activeSlugs = (activeReport.suspiciousActive || []).map(row => row.slug);
const activeTrades = activeSlugs
  .map(slug => trades.find(t => slugOf(t) === slug))
  .filter(Boolean);

const rows = activeTrades.map(t => {
  const classification = classify(t);
  const mm = mismatchInfo(t);

  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    season: t.season || null,
    bucket: classification.bucket,
    recommendedAction: classification.recommendedAction,
    risk: classification.risk,
    publishStatus: t.publishStatus || null,
    shape: classification.features.shape,
    suppressed: t.suppressed === true,
    teams: mm.teams,
    assetKeys: mm.assetKeys,
    gradeKeys: gradeKeys(t),
    teamsWithoutAssetKeys: mm.teamsWithoutAssetKeys,
    assetKeysNotInTeams: mm.assetKeysNotInTeams,
    verdict: t.verdict || null,
    grades: t.grades || null,
    tier: t.tier || null,
    confidence: t.confidence || null,
    features: classification.features,
    assets: assetsFlat(t),
    summary: t.summary || null,
    partnerSummary: t.partnerSummary || null,
    qaNotes: t.qaNotes || null
  };
});

const countsByBucket = {};
const countsByRisk = {};
const countsByShape = {};
const countsByPublishStatus = {};

for (const row of rows) {
  countsByBucket[row.bucket] = (countsByBucket[row.bucket] || 0) + 1;
  countsByRisk[row.risk] = (countsByRisk[row.risk] || 0) + 1;
  countsByShape[row.shape] = (countsByShape[row.shape] || 0) + 1;
  countsByPublishStatus[row.publishStatus || "(missing)"] = (countsByPublishStatus[row.publishStatus || "(missing)"] || 0) + 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  activePath,
  onePickPath: fs.existsSync(onePickPath) ? onePickPath : null,
  activeSuspiciousCount: rows.length,
  countsByBucket,
  countsByRisk,
  countsByShape,
  countsByPublishStatus,
  rows
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

function printCounts(title, counts) {
  console.log(title);
  const entries = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    console.log("- none");
    return;
  }
  for (const [k, v] of entries) console.log(`- ${k}: ${v}`);
}

console.log("");
console.log("ACTIVE SUSPICIOUS NEXT-ACTION CLASSIFICATION");
console.log("=".repeat(80));
console.log(`Active suspicious records classified: ${rows.length}`);
console.log(`Report: ${outPath}`);

console.log("");
printCounts("Counts by bucket:", countsByBucket);

console.log("");
printCounts("Counts by shape:", countsByShape);

console.log("");
printCounts("Counts by publishStatus:", countsByPublishStatus);

console.log("");
console.log("Records by bucket:");
for (const row of rows.sort((a, b) => a.bucket.localeCompare(b.bucket) || String(a.tradeDate).localeCompare(String(b.tradeDate)))) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  console.log(`bucket=${row.bucket}`);
  console.log(`shape=${row.shape} | publishStatus=${row.publishStatus} | risk=${row.risk}`);
  console.log(`recommendedAction=${row.recommendedAction}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`assetKeys=${JSON.stringify(row.assetKeys)}`);
  console.log(`features=${JSON.stringify(row.features)}`);
  console.log("assets:");
  for (const asset of row.assets) {
    console.log(`  ${asset.team}: [${asset.type || "?"}] ${asset.asset}`);
  }
}
