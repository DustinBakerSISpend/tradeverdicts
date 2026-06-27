const fs = require("fs");
const path = require("path");

const reportPath = path.join(process.cwd(), "audits", "ellipsis-truncation-audit.json");

if (!fs.existsSync(reportPath)) {
  console.error(`Missing report: ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const rows = report.rows || [];
const active = rows.filter(r => r.suppressed !== true);
const suppressed = rows.filter(r => r.suppressed === true);

const activeAssetRows = active.filter(r =>
  (r.ellipsisFields || []).some(f => String(f.field || "").startsWith("assetsReceived."))
);

const activeNonAssetRows = active.filter(r =>
  !(r.ellipsisFields || []).some(f => String(f.field || "").startsWith("assetsReceived."))
);

console.log("");
console.log("TINY ELLIPSIS SUMMARY");
console.log("=".repeat(50));
console.log(`total with ellipsis: ${rows.length}`);
console.log(`active unsuppressed: ${active.length}`);
console.log(`suppressed: ${suppressed.length}`);
console.log(`active asset-field ellipsis: ${activeAssetRows.length}`);
console.log(`active non-asset-only ellipsis: ${activeNonAssetRows.length}`);

console.log("");
console.log("Top active asset-field ellipsis slugs:");
for (const row of activeAssetRows.slice(0, 10)) {
  console.log(`- ${row.slug} | ${row.id} | ${row.tradeDate} | status=${row.publishStatus}`);
}

console.log("");
console.log("Top active non-asset-only ellipsis slugs:");
for (const row of activeNonAssetRows.slice(0, 10)) {
  console.log(`- ${row.slug} | ${row.id} | ${row.tradeDate} | status=${row.publishStatus}`);
}
