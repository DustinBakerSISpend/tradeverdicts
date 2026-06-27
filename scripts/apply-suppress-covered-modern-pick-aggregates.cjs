const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "suppress-covered-modern-pick-aggregates-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "suppress-covered-modern-pick-aggregates-apply-report.json");

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
if ((plan.plannedSuppressionCount || 0) !== 2) errors.push(`Expected 2 planned suppressions, found ${plan.plannedSuppressionCount}`);
if ((plan.errorCount || 0) !== 0) errors.push(`Plan has errors: ${plan.errorCount}`);

for (const row of plan.planned || []) {
  const trade = find(row.slug);

  if (!trade) {
    errors.push(`Missing trade: ${row.slug}`);
    continue;
  }

  if (trade.suppressed === true) {
    errors.push(`Already suppressed: ${row.slug}`);
  }

  if ((row.uncoveredPickSigCount || 0) !== 0) {
    errors.push(`Uncovered pick signatures remain: ${row.slug}`);
  }

  if (!Array.isArray(row.teams) || row.teams.length <= 2) {
    errors.push(`Not a multi-team aggregate: ${row.slug}`);
  }
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("COVERED MODERN PICK AGGREGATES APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const row of plan.planned || []) {
  const trade = find(row.slug);

  const before = {
    suppressed: trade.suppressed ?? null,
    publishStatus: trade.publishStatus || null,
    teams: trade.teams || null,
    assetsReceived: trade.assetsReceived || null,
    summary: trade.summary || null,
    qaNotes: trade.qaNotes || null
  };

  trade.suppressed = true;

  const note = `Suppressed covered modern multi-team pick aggregate; all exact pick signatures appeared on other active pages. Reason: ${row.reason}`;

  trade.qaNotes = trade.qaNotes ? `${trade.qaNotes} ${note}` : note;

  applied.push({
    slug: row.slug,
    id: trade.id || null,
    tradeDate: dateOf(trade),
    before,
    after: {
      suppressed: trade.suppressed,
      publishStatus: trade.publishStatus || null,
      qaNotes: trade.qaNotes || null
    },
    pickSigCount: row.pickSigCount,
    uncoveredPickSigCount: row.uncoveredPickSigCount,
    reason: row.reason
  });
}

const postErrors = [];

for (const row of applied) {
  const trade = find(row.slug);

  if (!trade || trade.suppressed !== true) {
    postErrors.push(`Suppression failed: ${row.slug}`);
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
console.log("SUPPRESS COVERED MODERN PICK AGGREGATES APPLY");
console.log("=".repeat(80));
console.log(`Applied suppressions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const row of applied) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate}`);
  console.log(`pickSigs=${row.pickSigCount} uncovered=${row.uncoveredPickSigCount}`);
}
