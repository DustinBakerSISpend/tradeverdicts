const fs = require("fs");
const path = require("path");

const reportPath = path.join(process.cwd(), "audits", "ellipsis-truncation-audit.json");

if (!fs.existsSync(reportPath)) {
  console.error(`Missing report: ${reportPath}`);
  console.error("Run scripts\\audit-ellipsis-truncation.cjs first.");
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const rows = report.rows || [];

const active = rows.filter(r => r.suppressed !== true);
const suppressed = rows.filter(r => r.suppressed === true);

function countBy(rows, getKey) {
  const out = {};
  for (const row of rows) {
    const key = getKey(row) || "(missing)";
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function printCounts(title, counts) {
  console.log("");
  console.log(title);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) {
    console.log("- none");
    return;
  }
  for (const [k, v] of entries) console.log(`- ${k}: ${v}`);
}

const activeByStatus = countBy(active, r => r.publishStatus);
const activeByField = {};
const activeByShapeish = {};

for (const row of active) {
  for (const field of row.ellipsisFields || []) {
    activeByField[field.field] = (activeByField[field.field] || 0) + 1;
  }

  const teamCount = Array.isArray(row.teams) ? row.teams.length : 0;
  const assetKeyCount = Array.isArray(row.assetKeys) ? row.assetKeys.length : 0;

  let bucket = "normal";
  if (teamCount > 2 || assetKeyCount > 2) bucket = "multi-team";
  if (String(row.slug || "").includes("reviewed-and-retained")) bucket = "modern-reviewed-retained";
  if (row.suppressed === true) bucket = "suppressed";

  activeByShapeish[bucket] = (activeByShapeish[bucket] || 0) + 1;
}

console.log("");
console.log("COMPACT ELLIPSIS / TRUNCATION SUMMARY");
console.log("=".repeat(80));
console.log(`Trades scanned: ${report.tradeCount}`);
console.log(`Trades with literal ellipsis: ${rows.length}`);
console.log(`Active unsuppressed with ellipsis: ${active.length}`);
console.log(`Suppressed with ellipsis: ${suppressed.length}`);
console.log(`Report: ${reportPath}`);

printCounts("Active by publishStatus:", activeByStatus);
printCounts("Active by field:", activeByField);
printCounts("Active rough bucket:", activeByShapeish);

console.log("");
console.log("Active unsuppressed records with ellipsis:");
for (const row of active) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  console.log(`publishStatus=${JSON.stringify(row.publishStatus)} suppressed=${JSON.stringify(row.suppressed)}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`assetKeys=${JSON.stringify(row.assetKeys)}`);
  console.log(`ellipsisFieldCount=${row.ellipsisFieldCount}`);

  for (const field of row.ellipsisFields || []) {
    const value = String(field.value || "");
    const preview = value.length > 180 ? value.slice(0, 180) + "..." : value;
    console.log(`  - ${field.field}: ${preview}`);
  }
}

console.log("");
console.log("Suggested priority:");
console.log("1. Fix/suppress active records with ellipsis in assetsReceived.*.asset.");
console.log("2. Ignore suppressed records for tonight unless build exposes them.");
console.log("3. Start with modern/provisional rows before historical ready rows.");
