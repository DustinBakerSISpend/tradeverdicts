const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "suppress-synthetic-one-pick-aggregates-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "suppress-synthetic-one-pick-aggregates-apply-report.json");

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

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan mode is not dry-run.");
if ((plan.errors || []).length !== 0) errors.push("Dry-run plan contains errors.");
if (plan.plannedCount !== 3 || !Array.isArray(plan.planned) || plan.planned.length !== 3) {
  errors.push(`Expected 3 planned suppressions, found plannedCount=${plan.plannedCount}, rows=${Array.isArray(plan.planned) ? plan.planned.length : "not-array"}.`);
}

for (const row of plan.planned || []) {
  const matches = trades.filter(t => slugOf(t) === row.slug);

  if (matches.length !== 1) {
    errors.push(`${row.slug}: expected exactly 1 current trade match, found ${matches.length}`);
    continue;
  }

  const current = matches[0];

  if (current.suppressed === true) {
    errors.push(`${row.slug}: already suppressed before apply; stop and inspect manually`);
  }

  if (!row.after || row.after.suppressed !== true) {
    errors.push(`${row.slug}: bad dry-run after-state; expected suppressed=true`);
  }

  if (!row.after.qaNotes || !String(row.after.qaNotes).includes("Suppressed synthetic aggregate covered elsewhere after one-pick cluster audit")) {
    errors.push(`${row.slug}: dry-run after-state missing suppression QA note`);
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
  console.error("SYNTHETIC ONE-PICK AGGREGATE SUPPRESSION BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const row of plan.planned) {
  const index = trades.findIndex(t => slugOf(t) === row.slug);
  const before = clone(trades[index]);

  trades[index].suppressed = true;
  trades[index].qaNotes = row.after.qaNotes;

  applied.push({
    slug: row.slug,
    id: trades[index].id || null,
    tradeDate: trades[index].tradeDate || trades[index].date || null,
    before: {
      publishStatus: before.publishStatus || null,
      suppressed: before.suppressed ?? null,
      qaNotes: before.qaNotes || null
    },
    after: {
      publishStatus: trades[index].publishStatus || null,
      suppressed: trades[index].suppressed ?? null,
      qaNotes: trades[index].qaNotes || null
    }
  });
}

const postErrors = [];

for (const row of applied) {
  const trade = trades.find(t => slugOf(t) === row.slug);
  if (!trade) {
    postErrors.push(`${row.slug}: missing after apply`);
    continue;
  }

  if (trade.suppressed !== true) {
    postErrors.push(`${row.slug}: suppressed=true not set after apply`);
  }

  if (!String(trade.qaNotes || "").includes("Suppressed synthetic aggregate covered elsewhere after one-pick cluster audit")) {
    postErrors.push(`${row.slug}: suppression QA note missing after apply`);
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
console.log("SYNTHETIC ONE-PICK AGGREGATE SUPPRESSION APPLY");
console.log("=".repeat(80));
console.log(`Applied suppressions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const row of applied) {
  console.log("");
  console.log(`- ${row.slug}`);
  console.log(`  before suppressed: ${JSON.stringify(row.before.suppressed)}`);
  console.log(`  after suppressed: ${JSON.stringify(row.after.suppressed)}`);
}
