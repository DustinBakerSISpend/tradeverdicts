const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const dupPath = path.join(process.cwd(), "audits", "trade-page-duplicate-candidates.json");
const outPath = path.join(process.cwd(), "audits", "top-trade-page-duplicate-inspection.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing data file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(dupPath)) {
  console.error(`Missing duplicate candidate report: ${dupPath}`);
  process.exit(1);
}

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const dupReport = JSON.parse(fs.readFileSync(dupPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || t.transactionDate || null;
}

function keysOf(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
}

function assetsFlat(t) {
  const rows = [];

  for (const team of keysOf(t.assetsReceived)) {
    const assets = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];

    assets.forEach((item, index) => {
      rows.push({
        team,
        index,
        type: item && item.type ? item.type : null,
        asset: item && item.asset ? item.asset : ""
      });
    });
  }

  return rows;
}

function qualityScore(t) {
  let score = 0;

  if (t.publishStatus === "publish") score += 12;
  if (t.publishStatus === "ready") score += 8;
  if (t.publishStatus === "provisional") score += 2;
  if (t.publishStatus === "hold-conflict") score -= 5;
  if (t.suppressed === true) score -= 100;

  const slug = slugOf(t);
  if (/review-needed|unknown|undisclosed|unspecified|cash|past-considerations|subsequently-traded|draft-pick-trade/.test(slug)) score -= 4;
  if (/^[a-z0-9-]+-\d{4}$/.test(slug)) score += 1;

  const assets = assetsFlat(t);
  score += Math.min(assets.length, 8);

  for (const row of assets) {
    if (String(row.asset || "").includes("unavailable from source data")) score -= 2;
    if (String(row.asset || "").includes("REVIEW NEEDED")) score -= 8;
    if (String(row.asset || "").includes("...")) score -= 10;
  }

  if (Array.isArray(t.perspectives) && t.perspectives.length) score += 3;
  if (t.summary && !String(t.summary).includes("unavailable")) score += 1;
  if (t.partnerSummary && !String(t.partnerSummary).includes("unavailable")) score += 1;
  if (t.qaNotes) score -= 1;

  return score;
}

function compactTrade(t) {
  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    season: t.season || null,
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    teams: t.teams || null,
    assetKeys: keysOf(t.assetsReceived).sort(),
    verdict: t.verdict || null,
    grades: t.grades || null,
    tier: t.tier || null,
    confidence: t.confidence || null,
    qualityScore: qualityScore(t),
    assetCount: assetsFlat(t).length,
    assetsReceived: t.assetsReceived || null,
    perspectives: t.perspectives || null,
    summary: t.summary || null,
    partnerSummary: t.partnerSummary || null,
    analysis: t.analysis || null,
    qaNotes: t.qaNotes || null
  };
}

function classifyPair(row, aTrade, bTrade) {
  const aQ = qualityScore(aTrade);
  const bQ = qualityScore(bTrade);

  let likelyKeeper = null;
  let likelySuppress = null;
  let confidence = "medium";
  let reason = [];

  if (row.sameDate && row.sameTeamSet && row.sharedSignatureCount >= 4) {
    reason.push("same date, same team set, and at least four shared asset/pick signatures");
    confidence = "high";
  }

  if (aTrade.publishStatus === "publish" && bTrade.publishStatus !== "publish") {
    likelyKeeper = slugOf(aTrade);
    likelySuppress = slugOf(bTrade);
    reason.push("A is publish while B is not");
  } else if (bTrade.publishStatus === "publish" && aTrade.publishStatus !== "publish") {
    likelyKeeper = slugOf(bTrade);
    likelySuppress = slugOf(aTrade);
    reason.push("B is publish while A is not");
  } else if (aQ !== bQ) {
    likelyKeeper = aQ > bQ ? slugOf(aTrade) : slugOf(bTrade);
    likelySuppress = aQ > bQ ? slugOf(bTrade) : slugOf(aTrade);
    reason.push(`quality score favors ${likelyKeeper}`);
  } else {
    likelyKeeper = null;
    likelySuppress = null;
    reason.push("quality score tie; needs manual choice");
  }

  if (/hold-conflict/.test(String(aTrade.publishStatus)) || /hold-conflict/.test(String(bTrade.publishStatus))) {
    confidence = "medium";
    reason.push("one side is hold-conflict, so inspect before suppressing");
  }

  return {
    likelyKeeper,
    likelySuppress,
    confidence,
    reason
  };
}

const rows = [];

for (const row of (dupReport.rows || []).slice(0, 20)) {
  const aTrade = trades.find(t => slugOf(t) === row.a.slug);
  const bTrade = trades.find(t => slugOf(t) === row.b.slug);

  if (!aTrade || !bTrade) continue;

  rows.push({
    score: row.score,
    sameDate: row.sameDate,
    sameTeamSet: row.sameTeamSet,
    sharedSignatureCount: row.sharedSignatureCount,
    sharedTeamCount: row.sharedTeamCount,
    sharedSignatures: row.sharedSignatures,
    sharedTeams: row.sharedTeams,
    classification: classifyPair(row, aTrade, bTrade),
    a: compactTrade(aTrade),
    b: compactTrade(bTrade)
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  dupPath,
  inspectedPairCount: rows.length,
  rows
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("TOP TRADE-PAGE DUPLICATE INSPECTION");
console.log("=".repeat(80));
console.log(`Inspected pairs: ${rows.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Compact recommendations:");
for (const row of rows) {
  console.log("-".repeat(80));
  console.log(`score=${row.score} sameDate=${row.sameDate} sameTeamSet=${row.sameTeamSet} sharedSigs=${row.sharedSignatureCount}`);
  console.log(`A: ${row.a.slug} | ${row.a.id} | status=${row.a.publishStatus} | q=${row.a.qualityScore}`);
  console.log(`B: ${row.b.slug} | ${row.b.id} | status=${row.b.publishStatus} | q=${row.b.qualityScore}`);
  console.log(`confidence=${row.classification.confidence}`);
  console.log(`likelyKeeper=${row.classification.likelyKeeper || "(manual)"}`);
  console.log(`likelySuppress=${row.classification.likelySuppress || "(manual)"}`);
  console.log(`reason=${row.classification.reason.join("; ")}`);
  console.log(`sharedSignatures=${JSON.stringify(row.sharedSignatures.slice(0, 8))}`);
}

console.log("");
console.log("First pair full detail:");
if (rows[0]) {
  console.log("");
  console.log("A assetsReceived:");
  console.dir(rows[0].a.assetsReceived, { depth: null });

  console.log("");
  console.log("B assetsReceived:");
  console.dir(rows[0].b.assetsReceived, { depth: null });

  console.log("");
  console.log("A summary:");
  console.log(rows[0].a.summary || "(none)");

  console.log("");
  console.log("B summary:");
  console.log(rows[0].b.summary || "(none)");

  console.log("");
  console.log("A qaNotes:");
  console.log(rows[0].a.qaNotes || "(none)");

  console.log("");
  console.log("B qaNotes:");
  console.log(rows[0].b.qaNotes || "(none)");
}
