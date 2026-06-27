const fs = require("fs");
const path = require("path");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const apply = readJson(path.join(process.cwd(), "audits", "repair-seahawks-49ers-review-needed-apply-report.json"));
const asset = readJson(path.join(process.cwd(), "audits", "asset-line-duplicates-report.json"));
const team = readJson(path.join(process.cwd(), "audits", "team-key-mismatch-deep-inspection.json"));
const multi = readJson(path.join(process.cwd(), "audits", "multi-team-asset-contamination-inspection.json"));

console.log("");
console.log("COMPACT POST-SEAHAWKS/49ERS REPAIR SUMMARY");
console.log("=".repeat(80));

if (apply) {
  console.log("");
  console.log("Apply report:");
  console.log(`- mode: ${apply.mode}`);
  console.log(`- appliedCount: ${apply.appliedCount}`);
  console.log(`- errors: ${(apply.errors || []).length}`);
  for (const row of apply.applied || []) {
    console.log(`- ${row.slug}: teams=${JSON.stringify(row.after.teams)}`);
  }
}

if (asset) {
  console.log("");
  console.log("Asset audit counts:");
  for (const [k, v] of Object.entries(asset.counts || {})) {
    console.log(`- ${k}: ${v}`);
  }
}

if (team) {
  console.log("");
  console.log("Team-key mismatch counts:");
  console.log(`- mismatchCount: ${team.mismatchCount}`);
  for (const [k, v] of Object.entries(team.countsByClassification || {})) {
    console.log(`- ${k}: ${v}`);
  }

  console.log("");
  console.log("Remaining team-key mismatches:");
  for (const row of team.mismatchRows || []) {
    console.log(`- ${row.slug} | ${row.classification} | teamsWithoutAssetKeys=${JSON.stringify(row.teamsWithoutAssetKeys)} | assetKeysNotInTeams=${JSON.stringify(row.assetKeysNotInTeams)}`);
  }
}

if (multi) {
  console.log("");
  console.log("Multi-team contamination counts:");
  for (const [k, v] of Object.entries(multi.counts || {})) {
    if (v && typeof v === "object") {
      console.log(`- ${k}:`);
      for (const [kk, vv] of Object.entries(v)) console.log(`  - ${kk}: ${vv}`);
    } else {
      console.log(`- ${k}: ${v}`);
    }
  }
}

console.log("");
console.log("Git diff stat:");
