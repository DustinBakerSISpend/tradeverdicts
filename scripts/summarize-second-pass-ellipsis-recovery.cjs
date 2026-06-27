const fs = require("fs");
const path = require("path");

const reportPath = path.join(process.cwd(), "audits", "ellipsis-asset-recovery-dry-run.json");

if (!fs.existsSync(reportPath)) {
  console.error(`Missing report: ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

console.log("");
console.log("SECOND-PASS ELLIPSIS RECOVERY DRY-RUN SUMMARY");
console.log("=".repeat(80));
console.log(`active ellipsis asset rows: ${report.totalActiveEllipsisAssetRows}`);
console.log(`planned safe replacements: ${report.plannedReplacementCount}`);
console.log(`trades touched if applied: ${report.plannedTradeCount}`);
console.log(`ambiguous: ${report.ambiguousCount}`);
console.log(`no candidate: ${report.noCandidateCount}`);
console.log(`weak prefix: ${report.weakPrefixCount}`);
console.log(`Report: ${reportPath}`);

console.log("");
console.log("First 10 planned replacements:");
for (const row of (report.planned || []).slice(0, 10)) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.date} | ${row.team}[${row.assetIndex}]`);
  console.log(`BEFORE: ${row.before}`);
  console.log(`AFTER : ${row.after}`);
  console.log(`source: ${row.sourceExamples && row.sourceExamples[0] ? row.sourceExamples[0].slug : "none"}`);
}

console.log("");
console.log("First 10 unresolved examples:");
const unresolved = [
  ...(report.noCandidate || []).map(r => ({ ...r, unresolvedType: "noCandidate" })),
  ...(report.weakPrefix || []).map(r => ({ ...r, unresolvedType: "weakPrefix" })),
  ...(report.ambiguous || []).map(r => ({ ...r, unresolvedType: "ambiguous" }))
];

for (const row of unresolved.slice(0, 10)) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.date} | ${row.team}[${row.assetIndex}]`);
  console.log(`type: ${row.unresolvedType}`);
  console.log(`asset: ${row.asset}`);
  console.log(`reason: ${row.reason || (row.candidateCount ? `${row.candidateCount} candidates` : "unresolved")}`);
}
