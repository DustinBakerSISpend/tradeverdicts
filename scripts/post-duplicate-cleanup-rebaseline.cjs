const fs = require("fs");
const path = require("path");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const auditDir = path.join(process.cwd(), "audits");

const active = readJson(path.join(auditDir, "active-public-contamination-summary.json"));
const classified = readJson(path.join(auditDir, "active-suspicious-next-action-classification.json"));
const ellipsis = readJson(path.join(auditDir, "ellipsis-truncation-audit.json"));
const dupPlan = readJson(path.join(auditDir, "safe-duplicate-page-suppression-dry-run.json"));
const dupCandidates = readJson(path.join(auditDir, "trade-page-duplicate-candidates.json"));

console.log("");
console.log("POST-DUPLICATE-CLEANUP REBASELINE");
console.log("=".repeat(80));

if (ellipsis) {
  console.log("");
  console.log("Ellipsis:");
  console.log(`- total with ellipsis: ${ellipsis.counts?.totalTradesWithEllipsis ?? 0}`);
  console.log(`- active unsuppressed with ellipsis: ${ellipsis.counts?.activeUnsuppressed ?? 0}`);
}

if (dupPlan) {
  console.log("");
  console.log("High-confidence duplicate suppression lane:");
  console.log(`- planned suppressions: ${dupPlan.plannedSuppressionCount ?? "?"}`);
  console.log(`- conflicts: ${dupPlan.conflictCount ?? "?"}`);
  console.log(`- blocked: ${dupPlan.blockedCount ?? "?"}`);
}

if (dupCandidates) {
  console.log("");
  console.log("Broad duplicate/overlap candidate audit:");
  console.log(`- active trades scanned: ${dupCandidates.activeTradeCount ?? "?"}`);
  console.log(`- candidate pairs: ${dupCandidates.candidatePairCount ?? "?"}`);
  console.log(`- returned pairs: ${dupCandidates.returnedPairCount ?? "?"}`);
}

if (active) {
  console.log("");
  console.log("Active public contamination:");
  console.log(`- suspicious suppressed: ${active.counts?.suspiciousSuppressed ?? "?"}`);
  console.log(`- suspicious active/unsuppressed: ${active.counts?.suspiciousActive ?? active.suspiciousActive?.length ?? "?"}`);

  console.log("");
  console.log("Active suspicious by shape:");
  const byShape = active.counts?.activeByShape || active.counts?.suspiciousActiveByShape || {};
  for (const [k, v] of Object.entries(byShape).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`- ${k}: ${v}`);
  }

  console.log("");
  console.log("First 20 active suspicious:");
  for (const row of (active.suspiciousActive || []).slice(0, 20)) {
    console.log(`- ${row.slug} | ${row.id || ""} | ${row.tradeDate || ""} | ${row.shape || ""} | status=${row.publishStatus || ""}`);
  }
}

if (classified) {
  console.log("");
  console.log("Active suspicious by next-action bucket:");
  for (const [k, v] of Object.entries(classified.countsByBucket || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`- ${k}: ${v}`);
  }

  console.log("");
  console.log("Top classified rows:");
  for (const row of (classified.rows || classified.classified || []).slice(0, 20)) {
    console.log(`- ${row.bucket || row.nextActionBucket || "?"} | ${row.slug || ""} | ${row.id || ""} | ${row.tradeDate || ""}`);
  }
}

console.log("");
console.log("Git diff:");
