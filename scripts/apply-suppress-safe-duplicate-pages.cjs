const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "safe-duplicate-page-suppression-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "safe-duplicate-page-suppression-apply-report.json");

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

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan mode is not dry-run.");
if (!Array.isArray(plan.planned)) errors.push("Plan has no planned array.");
if ((plan.conflictCount || 0) !== 0) errors.push(`Plan has conflicts: ${plan.conflictCount}`);
if ((plan.plannedSuppressionCount || 0) !== 10) errors.push(`Expected 10 planned suppressions, found ${plan.plannedSuppressionCount}`);

for (const row of plan.planned || []) {
  const keeperSlug = row.keeper && row.keeper.slug;
  const suppressSlug = row.suppress && row.suppress.slug;

  const keeperMatches = trades.filter(t => slugOf(t) === keeperSlug);
  const suppressMatches = trades.filter(t => slugOf(t) === suppressSlug);

  if (keeperMatches.length !== 1) {
    errors.push(`${keeperSlug}: expected exactly one keeper match, found ${keeperMatches.length}`);
    continue;
  }

  if (suppressMatches.length !== 1) {
    errors.push(`${suppressSlug}: expected exactly one suppress match, found ${suppressMatches.length}`);
    continue;
  }

  const keeper = keeperMatches[0];
  const suppress = suppressMatches[0];

  if (keeper.suppressed === true) {
    errors.push(`${keeperSlug}: keeper is already suppressed`);
  }

  if (suppress.suppressed === true) {
    errors.push(`${suppressSlug}: suppress candidate already suppressed`);
  }

  if (row.suppress.publishStatus === "publish" && row.keeper.publishStatus !== "publish") {
    errors.push(`${suppressSlug}: would suppress publish page without publish keeper`);
  }

  if (!row.reason || !String(row.reason).trim()) {
    errors.push(`${suppressSlug}: missing suppression reason`);
  }

  if ((row.sharedSignatureCount || 0) < 4) {
    errors.push(`${suppressSlug}: sharedSignatureCount below safe threshold`);
  }

  if (assetsFlat(keeper).length === 0) {
    errors.push(`${keeperSlug}: keeper has no assets`);
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
  console.error("SAFE DUPLICATE-PAGE SUPPRESSION APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const row of plan.planned || []) {
  const keeperSlug = row.keeper.slug;
  const suppressSlug = row.suppress.slug;
  const trade = trades.find(t => slugOf(t) === suppressSlug);

  const before = {
    suppressed: trade.suppressed ?? null,
    publishStatus: trade.publishStatus || null,
    qaNotes: trade.qaNotes || null
  };

  trade.suppressed = true;

  const note = `Suppressed duplicate trade page after safe duplicate-page audit; covered by ${keeperSlug}. Reason: ${row.reason}.`;

  if (trade.qaNotes && !String(trade.qaNotes).includes(note)) {
    trade.qaNotes = `${trade.qaNotes} ${note}`;
  } else if (!trade.qaNotes) {
    trade.qaNotes = note;
  }

  applied.push({
    suppressSlug,
    keeperSlug,
    id: trade.id || null,
    tradeDate: trade.tradeDate || trade.date || null,
    before,
    after: {
      suppressed: trade.suppressed,
      publishStatus: trade.publishStatus || null,
      qaNotes: trade.qaNotes || null
    },
    score: row.score,
    sharedSignatureCount: row.sharedSignatureCount,
    reason: row.reason
  });
}

const postErrors = [];

for (const row of applied) {
  const suppress = trades.find(t => slugOf(t) === row.suppressSlug);
  const keeper = trades.find(t => slugOf(t) === row.keeperSlug);

  if (!suppress || suppress.suppressed !== true) {
    postErrors.push(`${row.suppressSlug}: suppression did not apply`);
  }

  if (!keeper || keeper.suppressed === true) {
    postErrors.push(`${row.keeperSlug}: keeper missing or suppressed`);
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
console.log("SAFE DUPLICATE-PAGE SUPPRESSION APPLY");
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
