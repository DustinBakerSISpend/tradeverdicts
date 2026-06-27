const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "repair-seahawks-49ers-review-needed-dry-run.json");

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

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function assetKeys(t) {
  return t.assetsReceived && typeof t.assetsReceived === "object" && !Array.isArray(t.assetsReceived)
    ? Object.keys(t.assetsReceived)
    : [];
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const targetSlugs = [
  "review-needed-review-needed-2000",
  "review-needed-review-needed-2001",
  "review-needed-review-needed-2007",
  "review-needed-review-needed-2017"
];

const planned = [];
const errors = [];

for (const slug of targetSlugs) {
  const matches = trades.filter(t => slugOf(t) === slug);

  if (matches.length !== 1) {
    errors.push({
      slug,
      reason: `Expected exactly 1 match, found ${matches.length}`
    });
    continue;
  }

  const trade = matches[0];
  const teams = Array.isArray(trade.teams) ? trade.teams : [];
  const keys = assetKeys(trade);

  if (!teams.includes("unknown-team")) {
    errors.push({
      slug,
      reason: "Expected teams to include unknown-team"
    });
  }

  if (keys.includes("unknown-team")) {
    errors.push({
      slug,
      reason: "Unexpected assetsReceived.unknown-team exists; this is not the simple placeholder shape"
    });
  }

  if (!teams.includes("seattle-seahawks") || !teams.includes("san-francisco-49ers")) {
    errors.push({
      slug,
      reason: "Expected Seahawks and 49ers in teams"
    });
  }

  if (!keys.includes("seattle-seahawks") || !keys.includes("san-francisco-49ers")) {
    errors.push({
      slug,
      reason: "Expected Seahawks and 49ers asset keys"
    });
  }

  const before = clone(trade);

  const after = clone(trade);
  after.teams = teams.filter(team => team !== "unknown-team");

  let removedReviewNeededAssets = [];

  for (const team of Object.keys(after.assetsReceived || {})) {
    const assets = Array.isArray(after.assetsReceived[team]) ? after.assetsReceived[team] : [];
    const kept = [];

    for (const item of assets) {
      if (normalize(item && item.asset) === "review needed") {
        removedReviewNeededAssets.push({
          team,
          item
        });
      } else {
        kept.push(item);
      }
    }

    after.assetsReceived[team] = kept;
  }

  if (removedReviewNeededAssets.length !== 1) {
    errors.push({
      slug,
      reason: `Expected exactly 1 REVIEW NEEDED asset removal, found ${removedReviewNeededAssets.length}`
    });
  }

  const afterAssetKeys = assetKeys(after);
  const afterTeams = Array.isArray(after.teams) ? after.teams : [];

  const afterTeamsWithoutAssets = afterTeams.filter(team => !afterAssetKeys.includes(team));
  const afterAssetsWithoutTeams = afterAssetKeys.filter(team => !afterTeams.includes(team));

  if (afterTeamsWithoutAssets.length || afterAssetsWithoutTeams.length) {
    errors.push({
      slug,
      reason: "After-state would still have team/assetsReceived mismatch",
      afterTeamsWithoutAssets,
      afterAssetsWithoutTeams
    });
  }

  planned.push({
    slug,
    id: trade.id || null,
    tradeDate: trade.tradeDate || trade.date || null,
    before: {
      teams: before.teams,
      assetsReceived: before.assetsReceived,
      grades: before.grades,
      verdict: before.verdict,
      summary: before.summary,
      partnerSummary: before.partnerSummary
    },
    after: {
      teams: after.teams,
      assetsReceived: after.assetsReceived,
      grades: after.grades,
      verdict: after.verdict,
      summary: after.summary,
      partnerSummary: after.partnerSummary
    },
    removedTeams: teams.filter(team => !after.teams.includes(team)),
    removedReviewNeededAssets
  });
}

const report = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  dataPath,
  targetCount: targetSlugs.length,
  plannedCount: planned.length,
  errors,
  planned
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("SEAHAWKS/49ERS REVIEW NEEDED PLACEHOLDER REPAIR DRY RUN");
console.log("=".repeat(80));
console.log(`Targets: ${targetSlugs.length}`);
console.log(`Planned repairs: ${planned.length}`);
console.log(`Errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

if (errors.length) {
  console.log("");
  console.log("ERRORS:");
  for (const error of errors) {
    console.log(`- ${error.slug}: ${error.reason}`);
    if (error.afterTeamsWithoutAssets) console.log(`  afterTeamsWithoutAssets=${JSON.stringify(error.afterTeamsWithoutAssets)}`);
    if (error.afterAssetsWithoutTeams) console.log(`  afterAssetsWithoutTeams=${JSON.stringify(error.afterAssetsWithoutTeams)}`);
  }
  process.exit(1);
}

for (const row of planned) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  console.log(`removed teams: ${JSON.stringify(row.removedTeams)}`);
  console.log(`removed REVIEW NEEDED assets: ${JSON.stringify(row.removedReviewNeededAssets)}`);
  console.log("");
  console.log("BEFORE teams/assets:");
  console.log(`teams=${JSON.stringify(row.before.teams)}`);
  console.dir(row.before.assetsReceived, { depth: null });
  console.log("");
  console.log("AFTER teams/assets:");
  console.log(`teams=${JSON.stringify(row.after.teams)}`);
  console.dir(row.after.assetsReceived, { depth: null });
}
