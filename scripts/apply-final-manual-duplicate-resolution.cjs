const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "final-manual-duplicate-resolution-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "final-manual-duplicate-resolution-apply-report.json");

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

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function fixSummarySpacing(summary) {
  return String(summary || "")
    .replace(/\)\.The\b/g, "). The")
    .replace(/\band2020\b/g, "and 2020")
    .replace(/\)\.([A-Z])/g, "). $1")
    .replace(/\s+/g, " ")
    .trim();
}

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan mode is not dry-run.");
if (!Array.isArray(plan.planned)) errors.push("Plan has no planned array.");
if ((plan.errorCount || 0) !== 0) errors.push(`Plan has errors: ${plan.errorCount}`);
if ((plan.plannedSuppressionCount || 0) !== 3) errors.push(`Expected 3 planned suppressions, found ${plan.plannedSuppressionCount}`);

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

  if (!String(row.reason || "").trim()) {
    errors.push(`Missing reason for ${row.suppressSlug}`);
  }

  for (const repair of row.keeperAssetRepairs || []) {
    if (!repair.changed) continue;

    const current = keeper.assetsReceived?.[repair.team]?.[repair.assetIndex]?.asset;

    if (current !== repair.before) {
      errors.push(`${row.keeperSlug}: asset repair before mismatch at ${repair.team}[${repair.assetIndex}]`);
    }

    if (!repair.after || String(repair.after).includes("...")) {
      errors.push(`${row.keeperSlug}: invalid asset repair after at ${repair.team}[${repair.assetIndex}]`);
    }
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
  console.error("FINAL MANUAL DUPLICATE RESOLUTION APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const row of plan.planned || []) {
  const keeper = find(row.keeperSlug);
  const suppress = find(row.suppressSlug);

  const assetRepairsApplied = [];

  for (const repair of row.keeperAssetRepairs || []) {
    if (!repair.changed) continue;

    keeper.assetsReceived[repair.team][repair.assetIndex].asset = repair.after;

    assetRepairsApplied.push({
      team: repair.team,
      assetIndex: repair.assetIndex,
      before: repair.before,
      after: repair.after
    });
  }

  const keeperSummaryBefore = keeper.summary || null;
  const keeperSummaryAfter = keeper.summary ? fixSummarySpacing(keeper.summary) : null;

  if (keeperSummaryAfter && keeperSummaryAfter !== keeper.summary) {
    keeper.summary = keeperSummaryAfter;
  }

  const suppressBefore = {
    suppressed: suppress.suppressed ?? null,
    publishStatus: suppress.publishStatus || null,
    qaNotes: suppress.qaNotes || null
  };

  suppress.suppressed = true;

  const note = `Suppressed final same-signature duplicate after manual duplicate resolution; covered by ${row.keeperSlug}. Reason: ${row.reason}`;

  if (suppress.qaNotes && !String(suppress.qaNotes).includes("final same-signature duplicate")) {
    suppress.qaNotes = `${suppress.qaNotes} ${note}`;
  } else if (!suppress.qaNotes) {
    suppress.qaNotes = note;
  }

  if (keeper.qaNotes && !String(keeper.qaNotes).includes("Retained as keeper for final same-signature duplicate")) {
    keeper.qaNotes = `${keeper.qaNotes} Retained as keeper for final same-signature duplicate over ${row.suppressSlug}.`;
  } else if (!keeper.qaNotes) {
    keeper.qaNotes = `Retained as keeper for final same-signature duplicate over ${row.suppressSlug}.`;
  }

  applied.push({
    type: row.type,
    keeperSlug: row.keeperSlug,
    suppressSlug: row.suppressSlug,
    suppressId: suppress.id || null,
    tradeDate: dateOf(suppress),
    reason: row.reason,
    assetRepairsApplied,
    keeperSummaryBefore,
    keeperSummaryAfter,
    keeperSummaryChanged: keeperSummaryBefore !== keeperSummaryAfter,
    suppressBefore,
    suppressAfter: {
      suppressed: suppress.suppressed,
      publishStatus: suppress.publishStatus || null,
      qaNotes: suppress.qaNotes || null
    }
  });
}

const postErrors = [];

for (const row of applied) {
  const keeper = find(row.keeperSlug);
  const suppress = find(row.suppressSlug);

  if (!keeper || keeper.suppressed === true) {
    postErrors.push(`${row.keeperSlug}: keeper missing or suppressed`);
  }

  if (!suppress || suppress.suppressed !== true) {
    postErrors.push(`${row.suppressSlug}: suppress candidate not suppressed`);
  }

  if (!String(suppress.qaNotes || "").includes(row.keeperSlug)) {
    postErrors.push(`${row.suppressSlug}: qaNotes does not reference keeper`);
  }

  if (keeper.summary && (keeper.summary.includes(").The") || keeper.summary.includes("and2020"))) {
    postErrors.push(`${row.keeperSlug}: keeper summary spacing glitch remains`);
  }
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  dataPath,
  planPath,
  appliedResolutionCount: applied.length,
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
console.log("FINAL MANUAL DUPLICATE RESOLUTION APPLY");
console.log("=".repeat(80));
console.log(`Applied resolutions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const row of applied) {
  console.log("-".repeat(80));
  console.log(`KEEP     : ${row.keeperSlug}`);
  console.log(`SUPPRESS : ${row.suppressSlug} | ${row.suppressId} | ${row.tradeDate}`);
  console.log(`asset repairs: ${row.assetRepairsApplied.length}`);
  console.log(`keeper summary changed: ${row.keeperSummaryChanged}`);
  console.log(`reason=${row.reason}`);
}
