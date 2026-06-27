const fs = require("fs");
const path = require("path");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const auditPath = path.join(process.cwd(), "audits", "asset-line-duplicates-report.json");
const multiPath = path.join(process.cwd(), "audits", "multi-team-asset-contamination-inspection.json");
const repairPath = path.join(process.cwd(), "audits", "repair-known-multiteam-contamination-apply-report.json");
const knownPath = path.join(process.cwd(), "audits", "known-asset-bug-inspection.json");

const assetAudit = readJson(auditPath);
const multi = readJson(multiPath);
const repair = readJson(repairPath);
const known = readJson(knownPath);

console.log("");
console.log("COMPACT POST-REPAIR SUMMARY");
console.log("=".repeat(70));

if (repair) {
  console.log("");
  console.log("Stephen Sullivan repair:");
  console.log(`- mode: ${repair.mode}`);
  console.log(`- repairedCount: ${repair.repairedCount}`);
  console.log(`- missing: ${(repair.missing || []).length}`);
  console.log(`- errors: ${(repair.errors || []).length}`);

  for (const row of repair.repaired || []) {
    console.log(`- slug: ${row.slug}`);
    console.log(`- removed teams: ${JSON.stringify(row.removedTeams)}`);
    console.log(`- removed asset keys: ${JSON.stringify(row.removedAssetKeys)}`);
    console.log(`- removed grade keys: ${JSON.stringify(row.removedGradeKeys)}`);
    console.log(`- after teams: ${JSON.stringify(row.after.teams)}`);
    console.log(`- after verdict: ${JSON.stringify(row.after.verdict)}`);
  }
} else {
  console.log("Missing repair report.");
}

if (assetAudit) {
  console.log("");
  console.log("Asset audit counts:");
  for (const [k, v] of Object.entries(assetAudit.counts || {})) {
    console.log(`- ${k}: ${v}`);
  }
} else {
  console.log("Missing asset audit report.");
}

if (multi) {
  console.log("");
  console.log("Multi-team contamination counts:");
  for (const [k, v] of Object.entries(multi.counts || {})) {
    if (typeof v === "object") {
      console.log(`- ${k}:`);
      for (const [kk, vv] of Object.entries(v)) console.log(`  - ${kk}: ${vv}`);
    } else {
      console.log(`- ${k}: ${v}`);
    }
  }

  const stephen = (multi.knownMatches || {})["2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020"] || [];
  console.log("");
  console.log("Stephen Sullivan known-match after repair:");
  for (const row of stephen) {
    console.log(`- slug: ${row.slug}`);
    console.log(`- shape: ${row.shape}`);
    console.log(`- teams: ${JSON.stringify(row.teams)}`);
    console.log(`- assetKeys: ${JSON.stringify(row.assetKeys)}`);
    console.log(`- verdict: ${JSON.stringify(row.verdict)}`);
  }
} else {
  console.log("Missing multi-team inspection report.");
}

if (known) {
  const q = "2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020";
  const rows = (known.queryResults || {})[q] || [];
  console.log("");
  console.log("Stephen Sullivan direct inspection:");
  for (const row of rows) {
    console.log(`- teams: ${JSON.stringify(row.teams)}`);
    console.log(`- asset keys: ${JSON.stringify(row.assetsReceivedKeys)}`);
    console.log(`- grades: ${JSON.stringify(row.grades)}`);
    console.log(`- verdict: ${JSON.stringify(row.verdict)}`);
    console.log("- assetsReceived:");
    console.dir(row.assetsReceived, { depth: null });
  }
} else {
  console.log("Missing known inspection report.");
}

console.log("");
console.log("Git diff stat:");
