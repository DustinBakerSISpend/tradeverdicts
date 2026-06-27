const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const coveragePath = path.join(process.cwd(), "audits", "modern-suspicious-pick-coverage-audit.json");
const outPath = path.join(process.cwd(), "audits", "suppress-covered-modern-pick-aggregates-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const coverage = JSON.parse(fs.readFileSync(coveragePath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const planned = [];
const blocked = [];
const errors = [];

for (const row of coverage.rows || []) {
  const trade = find(row.target.slug);

  if (!trade) {
    errors.push(`Missing trade: ${row.target.slug}`);
    continue;
  }

  if (row.recommendedAction === "candidate-suppress-covered-pick-aggregate") {
    if (trade.suppressed === true) {
      blocked.push({
        slug: row.target.slug,
        reason: "already suppressed"
      });
      continue;
    }

    if ((row.uncoveredPickSigCount || 0) !== 0) {
      blocked.push({
        slug: row.target.slug,
        reason: "uncovered pick signatures remain"
      });
      continue;
    }

    planned.push({
      slug: row.target.slug,
      id: row.target.id,
      tradeDate: row.target.tradeDate,
      publishStatus: row.target.publishStatus,
      teams: row.target.teams,
      pickSigCount: row.pickSigCount,
      uncoveredPickSigCount: row.uncoveredPickSigCount,
      reason: row.reason,
      summary: row.target.summary,
      coverage: row.coverage
    });
  } else {
    blocked.push({
      slug: row.target.slug,
      id: row.target.id,
      tradeDate: row.target.tradeDate,
      recommendedAction: row.recommendedAction,
      pickSigCount: row.pickSigCount,
      uncoveredPickSigCount: row.uncoveredPickSigCount,
      reason: row.reason
    });
  }
}

fs.writeFileSync(outPath, JSON.stringify({
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  plannedSuppressionCount: planned.length,
  blockedCount: blocked.length,
  errorCount: errors.length,
  planned,
  blocked,
  errors
}, null, 2));

console.log("");
console.log("SUPPRESS COVERED MODERN PICK AGGREGATES DRY RUN");
console.log("=".repeat(80));
console.log(`planned suppressions: ${planned.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Planned suppressions:");
for (const row of planned) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate} | status=${row.publishStatus}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`pickSigs=${row.pickSigCount} uncovered=${row.uncoveredPickSigCount}`);
  console.log(`reason=${row.reason}`);
  console.log("summary:");
  console.log(row.summary || "(none)");
}

console.log("");
console.log("Important blocked rows:");
for (const row of blocked.filter(r => r.slug === "reviewed-and-retained-for-public-data-completeness" || r.uncoveredPickSigCount > 0).slice(0, 12)) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id || ""} | ${row.tradeDate || ""}`);
  console.log(`recommendedAction=${row.recommendedAction}`);
  console.log(`pickSigs=${row.pickSigCount} uncovered=${row.uncoveredPickSigCount}`);
  console.log(`reason=${row.reason}`);
}

if (errors.length) {
  console.log("");
  console.log("Errors:");
  for (const error of errors) console.log(`- ${error}`);
}
