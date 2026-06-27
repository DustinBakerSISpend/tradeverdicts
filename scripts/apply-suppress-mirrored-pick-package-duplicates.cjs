const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "mirrored-pick-package-duplicate-suppression-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "mirrored-pick-package-duplicate-suppression-apply-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan is not dry-run mode.");
if ((plan.plannedSuppressionCount || 0) !== 22) errors.push(`Expected 22 planned suppressions, found ${plan.plannedSuppressionCount}`);
if ((plan.errorCount || 0) !== 0) errors.push(`Plan has errors: ${plan.errorCount}`);
if ((plan.blockedCount || 0) !== 0) errors.push(`Plan has blocked rows: ${plan.blockedCount}`);

for (const row of plan.planned || []) {
  const keeper = find(row.keeperSlug);
  const suppress = find(row.suppressSlug);

  if (!keeper) {
    errors.push(`Missing keeper: ${row.keeperSlug}`);
    continue;
  }

  if (!suppress) {
    errors.push(`Missing suppress candidate: ${row.suppressSlug}`);
    continue;
  }

  if (keeper.suppressed === true) errors.push(`Keeper already suppressed: ${row.keeperSlug}`);
  if (suppress.suppressed === true) errors.push(`Suppress candidate already suppressed: ${row.suppressSlug}`);

  if (dateOf(keeper) !== dateOf(suppress)) {
    errors.push(`Date mismatch: ${row.keeperSlug} vs ${row.suppressSlug}`);
  }

  if (!Array.isArray(row.pickSigs) || row.pickSigs.length < 2) {
    errors.push(`Weak pick signature package: ${row.suppressSlug}`);
  }

  if (!String(row.reason || "").includes("Same date, same teams")) {
    errors.push(`Unexpected reason text: ${row.suppressSlug}`);
  }
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("MIRRORED PICK-PACKAGE DUPLICATE APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const row of plan.planned || []) {
  const keeper = find(row.keeperSlug);
  const suppress = find(row.suppressSlug);

  const before = {
    suppressed: suppress.suppressed ?? null,
    publishStatus: suppress.publishStatus || null,
    teams: suppress.teams || null,
    assetsReceived: suppress.assetsReceived || null,
    summary: suppress.summary || null,
    qaNotes: suppress.qaNotes || null
  };

  suppress.suppressed = true;

  const suppressNote = `Suppressed mirrored pick-package duplicate; same date, teams, and full pick-signature package as ${row.keeperSlug}. Retained stronger keeper page. Pick signatures: ${(row.pickSigs || []).join(", ")}.`;

  suppress.qaNotes = suppress.qaNotes ? `${suppress.qaNotes} ${suppressNote}` : suppressNote;

  const keeperNote = `Retained as mirrored pick-package duplicate keeper over ${row.suppressSlug}.`;

  if (keeper.qaNotes && !String(keeper.qaNotes).includes(`over ${row.suppressSlug}`)) {
    keeper.qaNotes = `${keeper.qaNotes} ${keeperNote}`;
  } else if (!keeper.qaNotes) {
    keeper.qaNotes = keeperNote;
  }

  applied.push({
    keeperSlug: row.keeperSlug,
    keeperId: keeper.id || null,
    suppressSlug: row.suppressSlug,
    suppressId: suppress.id || null,
    tradeDate: dateOf(suppress),
    teams: row.teams,
    pickSigs: row.pickSigs,
    keeperSummaryScore: row.keeperSummaryScore,
    suppressSummaryScore: row.suppressSummaryScore,
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
  const keeper = find(row.keeperSlug);
  const suppress = find(row.suppressSlug);

  if (!keeper || keeper.suppressed === true) {
    postErrors.push(`Keeper missing or suppressed: ${row.keeperSlug}`);
  }

  if (!suppress || suppress.suppressed !== true) {
    postErrors.push(`Suppression failed: ${row.suppressSlug}`);
  }

  if (!String(suppress.qaNotes || "").includes(row.keeperSlug)) {
    postErrors.push(`Suppress qaNotes missing keeper reference: ${row.suppressSlug}`);
  }
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
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

fs.writeFileSync(dataPath, JSON.stringify(Array.isArray(raw) ? trades : raw, null, 2) + "\n");

console.log("");
console.log("MIRRORED PICK-PACKAGE DUPLICATE SUPPRESSION APPLY");
console.log("=".repeat(80));
console.log(`Applied suppressions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const row of applied) {
  console.log("-".repeat(80));
  console.log(`KEEP     : ${row.keeperSlug} | ${row.keeperId}`);
  console.log(`SUPPRESS : ${row.suppressSlug} | ${row.suppressId}`);
  console.log(`date=${row.tradeDate}`);
  console.log(`pickSigs=${JSON.stringify(row.pickSigs)}`);
}
