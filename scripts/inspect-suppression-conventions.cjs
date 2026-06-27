const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "suppression-convention-inspection.json");

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

function compact(t) {
  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    teams: t.teams || null,
    assetKeys: assetKeys(t),
    publishStatus: t.publishStatus || null,
    tier: t.tier || null,
    confidence: t.confidence || null,
    verdict: t.verdict || null,
    grades: t.grades || null,
    suppressed: t.suppressed ?? null,
    hidden: t.hidden ?? null,
    excludeFromBuild: t.excludeFromBuild ?? null,
    noindex: t.noindex ?? null,
    qaNotes: t.qaNotes || null,
    summary: t.summary || null,
    partnerSummary: t.partnerSummary || null,
    assetsReceived: t.assetsReceived || null
  };
}

const publishStatusCounts = {};
const flagCounts = {
  suppressedTrue: 0,
  hiddenTrue: 0,
  excludeFromBuildTrue: 0,
  noindexTrue: 0,
  qaNotesSuppressed: 0,
  qaNotesDuplicate: 0,
  qaNotesSynthetic: 0
};

const suppressionLike = [];

for (const t of trades) {
  const status = t.publishStatus || "(missing)";
  publishStatusCounts[status] = (publishStatusCounts[status] || 0) + 1;

  if (t.suppressed === true) flagCounts.suppressedTrue++;
  if (t.hidden === true) flagCounts.hiddenTrue++;
  if (t.excludeFromBuild === true) flagCounts.excludeFromBuildTrue++;
  if (t.noindex === true) flagCounts.noindexTrue++;

  const notes = String(t.qaNotes || "").toLowerCase();

  if (notes.includes("suppress")) flagCounts.qaNotesSuppressed++;
  if (notes.includes("duplicate")) flagCounts.qaNotesDuplicate++;
  if (notes.includes("synthetic")) flagCounts.qaNotesSynthetic++;

  if (
    t.suppressed === true ||
    t.hidden === true ||
    t.excludeFromBuild === true ||
    t.noindex === true ||
    String(t.publishStatus || "").toLowerCase().includes("hold") ||
    String(t.publishStatus || "").toLowerCase().includes("suppress") ||
    notes.includes("suppress") ||
    notes.includes("duplicate") ||
    notes.includes("synthetic")
  ) {
    suppressionLike.push(compact(t));
  }
}

const candidateSlugs = [
  "2019-2nd-round-pick-38th-overall-cody-ford-las-vegas-raiders-2019",
  "2022-5th-round-pick-175th-overall-los-angeles-st-louis-rams-2022",
  "2023-7th-round-pick-230th-overall-nick-broeker-and-2024-6th-round-pick-200th-ove"
];

const candidates = candidateSlugs.map(slug => {
  const t = trades.find(row => slugOf(row) === slug);
  return t ? compact(t) : { slug, missing: true };
});

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  publishStatusCounts,
  flagCounts,
  suppressionLikeCount: suppressionLike.length,
  suppressionLikeExamples: suppressionLike.slice(0, 80),
  candidates
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("SUPPRESSION CONVENTION INSPECTION");
console.log("=".repeat(80));
console.log(`Trades scanned: ${trades.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("publishStatus counts:");
for (const [status, count] of Object.entries(publishStatusCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`- ${status}: ${count}`);
}

console.log("");
console.log("suppression-like flag counts:");
for (const [k, v] of Object.entries(flagCounts)) {
  console.log(`- ${k}: ${v}`);
}

console.log("");
console.log(`Suppression-like examples: ${suppressionLike.length}`);
for (const row of suppressionLike.slice(0, 25)) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  console.log(`publishStatus=${JSON.stringify(row.publishStatus)} suppressed=${JSON.stringify(row.suppressed)} hidden=${JSON.stringify(row.hidden)} excludeFromBuild=${JSON.stringify(row.excludeFromBuild)} noindex=${JSON.stringify(row.noindex)}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`assetKeys=${JSON.stringify(row.assetKeys)}`);
  console.log(`verdict=${JSON.stringify(row.verdict)} | grades=${JSON.stringify(row.grades)}`);
  console.log(`qaNotes=${JSON.stringify(row.qaNotes)}`);
}

console.log("");
console.log("Candidate suppression targets:");
for (const row of candidates) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  if (row.missing) {
    console.log("MISSING");
    continue;
  }
  console.log(`publishStatus=${JSON.stringify(row.publishStatus)} suppressed=${JSON.stringify(row.suppressed)} hidden=${JSON.stringify(row.hidden)} excludeFromBuild=${JSON.stringify(row.excludeFromBuild)} noindex=${JSON.stringify(row.noindex)}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`assetKeys=${JSON.stringify(row.assetKeys)}`);
  console.log(`verdict=${JSON.stringify(row.verdict)} | grades=${JSON.stringify(row.grades)}`);
  console.log(`qaNotes=${JSON.stringify(row.qaNotes)}`);
  console.log("assetsReceived:");
  console.dir(row.assetsReceived, { depth: null });
}
