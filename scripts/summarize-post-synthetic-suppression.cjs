const fs = require("fs");
const path = require("path");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

const apply = readJson(path.join(process.cwd(), "audits", "suppress-synthetic-one-pick-aggregates-apply-report.json"));
const asset = readJson(path.join(process.cwd(), "audits", "asset-line-duplicates-report.json"));
const cluster = readJson(path.join(process.cwd(), "audits", "likely-blended-one-pick-clusters-inspection.json"));
const multi = readJson(path.join(process.cwd(), "audits", "multi-team-asset-contamination-inspection.json"));

const targetSlugs = [
  "2019-2nd-round-pick-38th-overall-cody-ford-las-vegas-raiders-2019",
  "2022-5th-round-pick-175th-overall-los-angeles-st-louis-rams-2022",
  "2023-7th-round-pick-230th-overall-nick-broeker-and-2024-6th-round-pick-200th-ove"
];

console.log("");
console.log("COMPACT POST-SYNTHETIC SUPPRESSION SUMMARY");
console.log("=".repeat(80));

if (apply) {
  console.log("");
  console.log("Apply report:");
  console.log(`- mode: ${apply.mode}`);
  console.log(`- appliedCount: ${apply.appliedCount}`);
  console.log(`- errors: ${(apply.errors || []).length}`);
}

console.log("");
console.log("Target status:");
for (const slug of targetSlugs) {
  const trade = trades.find(t => slugOf(t) === slug);
  console.log(`- ${slug}: suppressed=${trade ? JSON.stringify(trade.suppressed) : "MISSING"} publishStatus=${trade ? JSON.stringify(trade.publishStatus) : "MISSING"}`);
}

if (cluster) {
  const rows = cluster.clusters || [];
  const counts = {};
  const activeCounts = {};

  for (const row of rows) {
    counts[row.classification] = (counts[row.classification] || 0) + 1;

    const trade = trades.find(t => slugOf(t) === row.slug);
    const isSuppressed = trade && trade.suppressed === true;

    if (!isSuppressed) {
      activeCounts[row.classification] = (activeCounts[row.classification] || 0) + 1;
    }
  }

  console.log("");
  console.log("Likely blended one-pick cluster counts:");
  console.log(`- total clusters: ${rows.length}`);
  for (const [k, v] of Object.entries(counts)) {
    console.log(`- ${k}: ${v}`);
  }

  console.log("");
  console.log("Active unsuppressed cluster counts:");
  for (const [k, v] of Object.entries(activeCounts)) {
    console.log(`- ${k}: ${v}`);
  }
}

if (asset) {
  console.log("");
  console.log("Asset audit counts:");
  for (const [k, v] of Object.entries(asset.counts || {})) {
    console.log(`- ${k}: ${v}`);
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
