const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const clusterPath = path.join(process.cwd(), "audits", "likely-blended-one-pick-clusters-inspection.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "suppress-synthetic-one-pick-aggregates-dry-run.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(clusterPath)) {
  console.error(`Missing cluster inspection: ${clusterPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];
const clusterReport = JSON.parse(fs.readFileSync(clusterPath, "utf8"));

if (!Array.isArray(trades) || trades.length === 0) {
  console.error("Could not find trades array.");
  process.exit(1);
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function appendQaNote(existing, note) {
  const text = String(existing || "").trim();
  if (!text) return note;
  if (text.includes(note)) return text;
  return `${text} | ${note}`;
}

const targetSlugs = [
  "2019-2nd-round-pick-38th-overall-cody-ford-las-vegas-raiders-2019",
  "2022-5th-round-pick-175th-overall-los-angeles-st-louis-rams-2022",
  "2023-7th-round-pick-230th-overall-nick-broeker-and-2024-6th-round-pick-200th-ove"
];

const suppressionNote = "Suppressed synthetic aggregate covered elsewhere after one-pick cluster audit; underlying pick assets retained on standalone trade pages.";

const clustersBySlug = new Map((clusterReport.clusters || []).map(row => [row.slug, row]));
const planned = [];
const errors = [];

for (const slug of targetSlugs) {
  const matches = trades.filter(t => slugOf(t) === slug);
  const cluster = clustersBySlug.get(slug);

  if (matches.length !== 1) {
    errors.push({
      slug,
      reason: `Expected exactly 1 trade match, found ${matches.length}`
    });
    continue;
  }

  if (!cluster) {
    errors.push({
      slug,
      reason: "Missing from likely blended one-pick cluster report"
    });
    continue;
  }

  if (cluster.classification !== "likely-synthetic-aggregate-covered-elsewhere") {
    errors.push({
      slug,
      reason: `Unexpected classification: ${cluster.classification}`
    });
    continue;
  }

  if (cluster.coveredCount !== cluster.assetCount) {
    errors.push({
      slug,
      reason: `Expected all assets covered elsewhere, found ${cluster.coveredCount}/${cluster.assetCount}`
    });
    continue;
  }

  const before = clone(matches[0]);
  const after = clone(matches[0]);

  after.suppressed = true;
  after.qaNotes = appendQaNote(after.qaNotes, suppressionNote);

  planned.push({
    slug,
    id: before.id || null,
    tradeDate: before.tradeDate || before.date || null,
    reason: "Synthetic aggregate one-pick cluster; every asset has exact or pick-key coverage elsewhere.",
    before: {
      publishStatus: before.publishStatus || null,
      suppressed: before.suppressed ?? null,
      teams: before.teams || null,
      assetsReceived: before.assetsReceived || null,
      grades: before.grades || null,
      verdict: before.verdict || null,
      qaNotes: before.qaNotes || null
    },
    after: {
      publishStatus: after.publishStatus || null,
      suppressed: after.suppressed ?? null,
      teams: after.teams || null,
      assetsReceived: after.assetsReceived || null,
      grades: after.grades || null,
      verdict: after.verdict || null,
      qaNotes: after.qaNotes || null
    },
    coverage: {
      assetCount: cluster.assetCount,
      coveredCount: cluster.coveredCount,
      classification: cluster.classification,
      assetCoverage: cluster.assetCoverage
    }
  });
}

const report = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  dataPath,
  clusterPath,
  targetCount: targetSlugs.length,
  plannedCount: planned.length,
  errors,
  planned
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("SYNTHETIC ONE-PICK AGGREGATE SUPPRESSION DRY RUN");
console.log("=".repeat(80));
console.log(`Targets: ${targetSlugs.length}`);
console.log(`Planned suppressions: ${planned.length}`);
console.log(`Errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

if (errors.length) {
  console.log("");
  console.log("ERRORS:");
  for (const error of errors) {
    console.log(`- ${error.slug}: ${error.reason}`);
  }
  process.exit(1);
}

for (const row of planned) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  console.log(row.reason);
  console.log(`coverage: ${row.coverage.coveredCount}/${row.coverage.assetCount}`);
  console.log("");
  console.log("BEFORE:");
  console.log(`publishStatus=${JSON.stringify(row.before.publishStatus)} suppressed=${JSON.stringify(row.before.suppressed)}`);
  console.log(`teams=${JSON.stringify(row.before.teams)}`);
  console.log(`verdict=${JSON.stringify(row.before.verdict)} grades=${JSON.stringify(row.before.grades)}`);
  console.log(`qaNotes=${JSON.stringify(row.before.qaNotes)}`);
  console.log("");
  console.log("AFTER:");
  console.log(`publishStatus=${JSON.stringify(row.after.publishStatus)} suppressed=${JSON.stringify(row.after.suppressed)}`);
  console.log(`teams=${JSON.stringify(row.after.teams)}`);
  console.log(`verdict=${JSON.stringify(row.after.verdict)} grades=${JSON.stringify(row.after.grades)}`);
  console.log(`qaNotes=${JSON.stringify(row.after.qaNotes)}`);
}
