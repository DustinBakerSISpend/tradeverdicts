const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "repair-seahawks-49ers-review-needed-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "repair-seahawks-49ers-review-needed-apply-report.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(planPath)) {
  console.error(`Missing dry-run plan: ${planPath}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : null;
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

if (!Array.isArray(trades)) {
  console.error("Could not find trades array.");
  process.exit(1);
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assetKeys(t) {
  return t.assetsReceived && typeof t.assetsReceived === "object" && !Array.isArray(t.assetsReceived)
    ? Object.keys(t.assetsReceived)
    : [];
}

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") {
  errors.push("Plan mode is not dry-run.");
}

if ((plan.errors || []).length !== 0) {
  errors.push("Dry-run plan contains errors.");
}

if (plan.plannedCount !== 4 || !Array.isArray(plan.planned) || plan.planned.length !== 4) {
  errors.push(`Expected 4 planned repairs, found plannedCount=${plan.plannedCount}, rows=${Array.isArray(plan.planned) ? plan.planned.length : "not-array"}.`);
}

for (const row of plan.planned || []) {
  const slug = row.slug;
  const index = trades.findIndex(t => slugOf(t) === slug);

  if (index === -1) {
    errors.push(`${slug}: trade not found`);
    continue;
  }

  const trade = trades[index];
  const teams = Array.isArray(trade.teams) ? trade.teams : [];
  const keys = assetKeys(trade);

  if (!teams.includes("unknown-team")) {
    errors.push(`${slug}: before-state missing unknown-team`);
  }

  if (keys.includes("unknown-team")) {
    errors.push(`${slug}: before-state has unexpected assetsReceived.unknown-team`);
  }

  const reviewNeededAssets = [];
  for (const team of Object.keys(trade.assetsReceived || {})) {
    const assets = Array.isArray(trade.assetsReceived[team]) ? trade.assetsReceived[team] : [];
    for (const item of assets) {
      if (normalize(item && item.asset) === "review needed") {
        reviewNeededAssets.push({ team, item });
      }
    }
  }

  if (reviewNeededAssets.length !== 1) {
    errors.push(`${slug}: expected exactly 1 REVIEW NEEDED asset, found ${reviewNeededAssets.length}`);
  }

  if (!row.after || !Array.isArray(row.after.teams) || !row.after.assetsReceived) {
    errors.push(`${slug}: bad after-state in plan`);
  }
}

if (errors.length) {
  const blocked = {
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    dataPath,
    planPath,
    errors,
    applied
  };

  fs.writeFileSync(outPath, JSON.stringify(blocked, null, 2));

  console.error("");
  console.error("SEAHAWKS/49ERS REVIEW NEEDED REPAIR BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const row of plan.planned) {
  const index = trades.findIndex(t => slugOf(t) === row.slug);
  const trade = trades[index];
  const before = clone(trade);

  trade.teams = clone(row.after.teams);
  trade.assetsReceived = clone(row.after.assetsReceived);

  applied.push({
    slug: row.slug,
    id: trade.id || null,
    tradeDate: trade.tradeDate || trade.date || null,
    removedTeams: row.removedTeams || [],
    removedReviewNeededAssets: row.removedReviewNeededAssets || [],
    before: {
      teams: before.teams,
      assetsReceived: before.assetsReceived
    },
    after: {
      teams: trade.teams,
      assetsReceived: trade.assetsReceived
    }
  });
}

const postErrors = [];

for (const row of applied) {
  const trade = trades.find(t => slugOf(t) === row.slug);
  const teams = Array.isArray(trade.teams) ? trade.teams : [];
  const keys = assetKeys(trade);

  if (teams.includes("unknown-team")) {
    postErrors.push(`${row.slug}: unknown-team still present after apply`);
  }

  for (const team of Object.keys(trade.assetsReceived || {})) {
    const assets = Array.isArray(trade.assetsReceived[team]) ? trade.assetsReceived[team] : [];
    for (const item of assets) {
      if (normalize(item && item.asset) === "review needed") {
        postErrors.push(`${row.slug}: REVIEW NEEDED asset still present after apply`);
      }
    }
  }

  const teamsWithoutAssets = teams.filter(team => !keys.includes(team));
  const assetsWithoutTeams = keys.filter(team => !teams.includes(team));

  if (teamsWithoutAssets.length || assetsWithoutTeams.length) {
    postErrors.push(`${row.slug}: after-state mismatch teamsWithoutAssets=${JSON.stringify(teamsWithoutAssets)} assetsWithoutTeams=${JSON.stringify(assetsWithoutTeams)}`);
  }
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  dataPath,
  planPath,
  appliedCount: applied.length,
  errors: postErrors,
  applied
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (postErrors.length) {
  console.error("");
  console.error("POST-APPLY VALIDATION FAILED. Data was not written.");
  for (const error of postErrors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

const outputText = Array.isArray(raw)
  ? JSON.stringify(trades, null, 2) + "\n"
  : JSON.stringify(raw, null, 2) + "\n";

fs.writeFileSync(dataPath, outputText);

console.log("");
console.log("SEAHAWKS/49ERS REVIEW NEEDED PLACEHOLDER REPAIR APPLY");
console.log("=".repeat(80));
console.log(`Applied repairs: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const row of applied) {
  console.log("");
  console.log(`- ${row.slug}`);
  console.log(`  removed teams: ${JSON.stringify(row.removedTeams)}`);
  console.log(`  removed REVIEW NEEDED assets: ${JSON.stringify(row.removedReviewNeededAssets)}`);
  console.log(`  after teams: ${JSON.stringify(row.after.teams)}`);
}
