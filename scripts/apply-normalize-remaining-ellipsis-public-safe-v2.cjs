const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "ellipsis-public-safe-normalization-v2-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "ellipsis-public-safe-normalization-v2-apply-report.json");

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

function parenCount(s, ch) {
  return (String(s || "").match(new RegExp(`\\${ch}`, "g")) || []).length;
}

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan mode is not dry-run.");
if (!Array.isArray(plan.planned)) errors.push("Plan has no planned array.");
if ((plan.blockedCount || 0) !== 0) errors.push(`Plan has blocked rows: ${plan.blockedCount}`);

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

  if (!String(row.after || "").includes("unavailable from source data")) {
    errors.push(`${row.slug}: after-state lacks transparent unavailable-source note`);
    continue;
  }

  if (parenCount(row.after, "(") !== parenCount(row.after, ")")) {
    errors.push(`${row.slug}: after-state has unbalanced parentheses`);
    continue;
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
  console.error("V2 PUBLIC-SAFE ELLIPSIS NORMALIZATION APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors.slice(0, 50)) console.error(`- ${error}`);
  if (errors.length > 50) console.error(`...and ${errors.length - 50} more`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const row of plan.planned || []) {
  const trade = trades.find(t => slugOf(t) === row.slug);
  trade.assetsReceived[row.team][row.assetIndex].asset = row.after;

  applied.push({
    slug: row.slug,
    id: trade.id || null,
    tradeDate: trade.tradeDate || trade.date || null,
    team: row.team,
    assetIndex: row.assetIndex,
    type: row.type || null,
    strategy: row.strategy || null,
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
  for (const error of postErrors.slice(0, 50)) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

const outputText = Array.isArray(raw)
  ? JSON.stringify(trades, null, 2) + "\n"
  : JSON.stringify(raw, null, 2) + "\n";

fs.writeFileSync(dataPath, outputText);

console.log("");
console.log("V2 PUBLIC-SAFE ELLIPSIS NORMALIZATION APPLY");
console.log("=".repeat(80));
console.log(`Applied replacements: ${applied.length}`);
console.log(`Trades touched: ${uniqueTradeCount}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("First 20 applied:");
for (const row of applied.slice(0, 20)) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate} | ${row.team}[${row.assetIndex}] | ${row.strategy}`);
  console.log(`BEFORE: ${row.before}`);
  console.log(`AFTER : ${row.after}`);
}
