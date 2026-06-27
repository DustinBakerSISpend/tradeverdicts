const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "ellipsis-same-trade-text-recovery-strict-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "ellipsis-same-trade-text-recovery-strict-apply-report.json");

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

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan mode is not dry-run.");
if (!Array.isArray(plan.planned)) errors.push("Plan has no planned array.");

if ((plan.planned || []).length !== 4) {
  errors.push(`Expected exactly 4 strict planned replacements, found ${(plan.planned || []).length}`);
}

for (const row of plan.planned || []) {
  const matches = trades
    .map((t, index) => ({ t, index }))
    .filter(x => slugOf(x.t) === row.slug);

  if (matches.length !== 1) {
    errors.push(`${row.slug}: expected exactly 1 trade match, found ${matches.length}`);
    continue;
  }

  const trade = matches[0].t;
  const assets = trade.assetsReceived && trade.assetsReceived[row.team];

  if (!Array.isArray(assets)) {
    errors.push(`${row.slug}: missing assetsReceived.${row.team}`);
    continue;
  }

  if (!assets[row.assetIndex]) {
    errors.push(`${row.slug}: missing asset index ${row.assetIndex} for ${row.team}`);
    continue;
  }

  const current = assets[row.assetIndex].asset;

  if (current !== row.before) {
    errors.push(`${row.slug}: before-state mismatch at ${row.team}[${row.assetIndex}]`);
    continue;
  }

  if (!String(current || "").includes("...")) {
    errors.push(`${row.slug}: current value no longer contains ellipsis`);
    continue;
  }

  if (String(row.after || "").includes("...")) {
    errors.push(`${row.slug}: after-state still contains ellipsis`);
    continue;
  }

  if (String(row.after || "").endsWith(".")) {
    errors.push(`${row.slug}: after-state ends with clipped-looking period`);
    continue;
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
  console.error("STRICT SAME-TRADE ELLIPSIS RECOVERY APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const row of plan.planned || []) {
  const index = trades.findIndex(t => slugOf(t) === row.slug);
  const trade = trades[index];

  trade.assetsReceived[row.team][row.assetIndex].asset = row.after;

  applied.push({
    slug: row.slug,
    id: trade.id || null,
    tradeDate: trade.tradeDate || trade.date || null,
    team: row.team,
    assetIndex: row.assetIndex,
    before: row.before,
    after: row.after
  });
}

const postErrors = [];

for (const row of applied) {
  const trade = trades.find(t => slugOf(t) === row.slug);
  const current = trade && trade.assetsReceived && trade.assetsReceived[row.team] && trade.assetsReceived[row.team][row.assetIndex]
    ? trade.assetsReceived[row.team][row.assetIndex].asset
    : null;

  if (current !== row.after) {
    postErrors.push(`${row.slug}: post-apply value mismatch at ${row.team}[${row.assetIndex}]`);
  }

  if (String(current || "").includes("...")) {
    postErrors.push(`${row.slug}: post-apply value still contains ellipsis at ${row.team}[${row.assetIndex}]`);
  }
}

const uniqueTradeCount = new Set(applied.map(row => row.slug)).size;

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  dataPath,
  planPath,
  appliedReplacementCount: applied.length,
  appliedTradeCount: uniqueTradeCount,
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
console.log("STRICT SAME-TRADE ELLIPSIS RECOVERY APPLY");
console.log("=".repeat(80));
console.log(`Applied replacements: ${applied.length}`);
console.log(`Trades touched: ${uniqueTradeCount}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const row of applied) {
  console.log("");
  console.log(`- ${row.slug} | ${row.id} | ${row.tradeDate} | ${row.team}[${row.assetIndex}]`);
  console.log(`  BEFORE: ${row.before}`);
  console.log(`  AFTER : ${row.after}`);
}
