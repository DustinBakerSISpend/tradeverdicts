const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "blocked-duplicate-equivalence-resolution-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "blocked-duplicate-equivalence-resolution-apply-report.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing data file: ${dataPath}`);
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

function dateOf(t) {
  return t.tradeDate || t.date || t.transactionDate || null;
}

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan mode is not dry-run.");
if (!Array.isArray(plan.planned)) errors.push("Plan has no planned array.");
if ((plan.errorCount || 0) !== 0) errors.push(`Plan has errors: ${plan.errorCount}`);
if ((plan.plannedSuppressionCount || 0) !== 3) errors.push(`Expected 3 planned suppressions, found ${plan.plannedSuppressionCount}`);

for (const row of plan.planned || []) {
  const keeper = trades.find(t => slugOf(t) === row.keeperSlug);
  const suppress = trades.find(t => slugOf(t) === row.suppressSlug);

  if (!keeper) {
    errors.push(`Missing keeper: ${row.keeperSlug}`);
    continue;
  }

  if (!suppress) {
    errors.push(`Missing suppress candidate: ${row.suppressSlug}`);
    continue;
  }

  if (keeper.suppressed === true) {
    errors.push(`Keeper already suppressed: ${row.keeperSlug}`);
  }

  if (suppress.suppressed === true) {
    errors.push(`Suppress candidate already suppressed: ${row.suppressSlug}`);
  }

  if (dateOf(keeper) !== dateOf(suppress)) {
    errors.push(`Date mismatch: ${row.keeperSlug} vs ${row.suppressSlug}`);
  }

  if (row.action !== "suppress-without-merge") {
    errors.push(`Unexpected action for ${row.suppressSlug}: ${row.action}`);
  }

  if (row.confidence !== "high") {
    errors.push(`Non-high confidence for ${row.suppressSlug}: ${row.confidence}`);
  }

  if (!String(row.reason || "").trim()) {
    errors.push(`Missing reason for ${row.suppressSlug}`);
  }
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    dataPath,
    planPath,
    errors
  }, null, 2));

  console.error("");
  console.error("BLOCKED DUPLICATE EQUIVALENCE APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const row of plan.planned || []) {
  const keeper = trades.find(t => slugOf(t) === row.keeperSlug);
  const suppress = trades.find(t => slugOf(t) === row.suppressSlug);

  const before = {
    suppressed: suppress.suppressed ?? null,
    publishStatus: suppress.publishStatus || null,
    qaNotes: suppress.qaNotes || null
  };

  suppress.suppressed = true;

  const note = `Suppressed duplicate trade page after blocked-duplicate equivalence audit; covered by ${row.keeperSlug}. No merge applied because unique strings were lower-confidence equivalents. Reason: ${row.reason}`;

  if (suppress.qaNotes && !String(suppress.qaNotes).includes("blocked-duplicate equivalence audit")) {
    suppress.qaNotes = `${suppress.qaNotes} ${note}`;
  } else if (!suppress.qaNotes) {
    suppress.qaNotes = note;
  }

  applied.push({
    suppressSlug: row.suppressSlug,
    keeperSlug: row.keeperSlug,
    id: suppress.id || null,
    tradeDate: dateOf(suppress),
    before,
    after: {
      suppressed: suppress.suppressed,
      publishStatus: suppress.publishStatus || null,
      qaNotes: suppress.qaNotes || null
    },
    reason: row.reason
  });
}

const postErrors = [];

for (const row of applied) {
  const keeper = trades.find(t => slugOf(t) === row.keeperSlug);
  const suppress = trades.find(t => slugOf(t) === row.suppressSlug);

  if (!keeper || keeper.suppressed === true) {
    postErrors.push(`${row.keeperSlug}: keeper missing or suppressed`);
  }

  if (!suppress || suppress.suppressed !== true) {
    postErrors.push(`${row.suppressSlug}: suppress candidate was not suppressed`);
  }

  if (!String(suppress.qaNotes || "").includes(row.keeperSlug)) {
    postErrors.push(`${row.suppressSlug}: qaNotes does not reference keeper`);
  }
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  dataPath,
  planPath,
  appliedSuppressionCount: applied.length,
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
console.log("BLOCKED DUPLICATE EQUIVALENCE APPLY");
console.log("=".repeat(80));
console.log(`Applied suppressions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const row of applied) {
  console.log("-".repeat(80));
  console.log(`SUPPRESSED: ${row.suppressSlug} | ${row.id} | ${row.tradeDate}`);
  console.log(`KEEPER    : ${row.keeperSlug}`);
  console.log(`reason=${row.reason}`);
}
