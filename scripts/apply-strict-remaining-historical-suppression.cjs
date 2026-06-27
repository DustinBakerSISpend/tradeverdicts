const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "strict-remaining-historical-suppression-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "strict-remaining-historical-suppression-apply-report.json");

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

for (const row of plan.planned || []) {
  const trade = find(row.slug);

  if (!trade) {
    errors.push(`Missing trade: ${row.slug}`);
    continue;
  }

  if (trade.suppressed === true) {
    errors.push(`Already suppressed: ${row.slug}`);
  }

  if ((row.uncoveredPlayerCount || 0) !== 0) {
    errors.push(`Uncovered players remain on planned suppression: ${row.slug}`);
  }

  if (!Array.isArray(trade.teams) || trade.teams.length <= 2) {
    errors.push(`No longer a multi-team artifact: ${row.slug}`);
  }
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("STRICT REMAINING HISTORICAL APPLY BLOCKED");
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

  const note = `Suppressed strict-covered historical blended import artifact; all player assets had active same-era coverage. Reason: ${row.reason}`;

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
    reason: row.reason,
    playerCount: row.playerCount,
    uncoveredPlayerCount: row.uncoveredPlayerCount
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
console.log("STRICT REMAINING HISTORICAL SUPPRESSION APPLY");
console.log("=".repeat(80));
console.log(`Applied suppressions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const row of applied) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate}`);
  console.log(`players=${row.playerCount} uncovered=${row.uncoveredPlayerCount}`);
}
