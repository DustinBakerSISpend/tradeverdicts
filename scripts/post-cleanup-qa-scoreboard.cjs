const fs = require("fs");
const path = require("path");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const auditDir = path.join(process.cwd(), "audits");

const ellipsis = readJson(path.join(auditDir, "ellipsis-truncation-audit.json"));
const active = readJson(path.join(auditDir, "active-public-contamination-summary.json"));
const classified = readJson(path.join(auditDir, "active-suspicious-next-action-classification.json"));
const dupes = readJson(path.join(auditDir, "asset-line-duplicates-report.json"));
const composite = readJson(path.join(auditDir, "composite-asset-duplicates-strict-dry-run.json"));

console.log("");
console.log("POST-CLEANUP QA SCOREBOARD");
console.log("=".repeat(80));

if (ellipsis) {
  console.log("");
  console.log("Ellipsis / truncation:");
  console.log(`- trades with ellipsis: ${ellipsis.counts?.totalTradesWithEllipsis ?? "?"}`);
  console.log(`- active unsuppressed with ellipsis: ${ellipsis.counts?.activeUnsuppressed ?? "?"}`);
  console.log(`- suppressed with ellipsis: ${ellipsis.counts?.suppressed ?? "?"}`);
}

if (active) {
  console.log("");
  console.log("Active public contamination:");
  console.log(`- suspicious all: ${active.counts?.suspiciousAll ?? active.suspiciousAll?.length ?? "?"}`);
  console.log(`- suspicious suppressed: ${active.counts?.suspiciousSuppressed ?? active.suspiciousSuppressed?.length ?? "?"}`);
  console.log(`- suspicious active/unsuppressed: ${active.counts?.suspiciousActive ?? active.suspiciousActive?.length ?? "?"}`);

  console.log("");
  console.log("Active suspicious by shape:");
  const byShape = active.counts?.activeByShape || active.counts?.suspiciousActiveByShape || {};
  for (const [k, v] of Object.entries(byShape).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`- ${k}: ${v}`);
  }

  console.log("");
  console.log("First 12 active suspicious slugs:");
  for (const row of (active.suspiciousActive || []).slice(0, 12)) {
    console.log(`- ${row.slug} | ${row.id || ""} | ${row.tradeDate || ""} | ${row.shape || ""} | status=${row.publishStatus || ""}`);
  }
}

if (classified) {
  console.log("");
  console.log("Active suspicious by next-action bucket:");
  for (const [k, v] of Object.entries(classified.countsByBucket || {}).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`- ${k}: ${v}`);
  }
}

if (dupes) {
  console.log("");
  console.log("Exact/equivalent duplicate asset audit:");
  console.log(`- duplicate groups: ${dupes.groups?.length ?? dupes.groupCount ?? "?"}`);
  console.log(`- planned removable lines if any: ${dupes.totalRemovableLines ?? dupes.totalRemovedLines ?? "?"}`);
}

if (composite) {
  console.log("");
  console.log("Strict composite duplicate audit:");
  console.log(`- groups: ${composite.groups?.length ?? composite.groupCount ?? "?"}`);
  console.log(`- planned removals: ${composite.totalRemovals ?? composite.plannedRemovalCount ?? "?"}`);
}

console.log("");
console.log("Git status:");
