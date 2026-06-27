const fs = require("fs");
const path = require("path");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const splitPath = path.join(process.cwd(), "audits", "obj-zeitler-vernon-split-apply-report.json");
const assetPath = path.join(process.cwd(), "audits", "asset-line-duplicates-report.json");
const multiPath = path.join(process.cwd(), "audits", "multi-team-asset-contamination-inspection.json");
const objInspectPath = path.join(process.cwd(), "audits", "obj-zeitler-vernon-blend-inspection.json");

const split = readJson(splitPath);
const asset = readJson(assetPath);
const multi = readJson(multiPath);
const objInspect = readJson(objInspectPath);

console.log("");
console.log("COMPACT OBJ SPLIT + CURRENT AUDIT SUMMARY");
console.log("=".repeat(80));

if (split) {
  console.log("");
  console.log("OBJ/Zeitler split apply:");
  console.log(`- mode: ${split.mode}`);
  console.log(`- beforeCount: ${split.beforeCount}`);
  console.log(`- afterCount: ${split.afterCount}`);
  console.log(`- updatedSlug: ${split.updatedSlug}`);
  console.log(`- insertedSlug: ${split.insertedSlug}`);
  console.log(`- errors: ${(split.errors || []).length}`);
  console.log(`- warnings: ${(split.warnings || []).length}`);

  if (split.afterObj) {
    console.log("");
    console.log("OBJ after:");
    console.log(`- id: ${split.afterObj.id}`);
    console.log(`- slug: ${split.afterObj.slug}`);
    console.log(`- assetsReceived: ${JSON.stringify(split.afterObj.assetsReceived)}`);
    console.log(`- grades: ${JSON.stringify(split.afterObj.grades)}`);
    console.log(`- verdict: ${JSON.stringify(split.afterObj.verdict)}`);
    console.log(`- perspectives: ${JSON.stringify((split.afterObj.perspectives || []).map(p => p.sourceTradeId))}`);
  }

  if (split.afterZeitler) {
    console.log("");
    console.log("Zeitler/Vernon after:");
    console.log(`- id: ${split.afterZeitler.id}`);
    console.log(`- slug: ${split.afterZeitler.slug}`);
    console.log(`- assetsReceived: ${JSON.stringify(split.afterZeitler.assetsReceived)}`);
    console.log(`- grades: ${JSON.stringify(split.afterZeitler.grades)}`);
    console.log(`- verdict: ${JSON.stringify(split.afterZeitler.verdict)}`);
    console.log(`- perspectives: ${JSON.stringify((split.afterZeitler.perspectives || []).map(p => p.sourceTradeId))}`);
  }
} else {
  console.log("");
  console.log("Missing split apply report.");
}

if (objInspect) {
  console.log("");
  console.log("OBJ inspection counts after split:");
  for (const [k, v] of Object.entries(objInspect.counts || {})) {
    console.log(`- ${k}: ${v}`);
  }

  const sameDate = objInspect.sameDateGiantsBrowns || [];
  console.log("");
  console.log(`Same-date Giants/Browns trades on 2019-03-13: ${sameDate.length}`);
  for (const row of sameDate) {
    console.log(`- ${row.slug} | assets=${JSON.stringify(row.assetsReceived)} | perspectives=${JSON.stringify((row.perspectives || []).map(p => p.sourceTradeId))}`);
  }

  const zeitlerRows = (objInspect.focusedMatches || []).filter(row => row.slug === "kevin-zeitler-olivier-vernon-new-york-giants-2019");
  console.log("");
  console.log(`Standalone Zeitler/Vernon focused matches: ${zeitlerRows.length}`);
  for (const row of zeitlerRows) {
    console.log(`- ${row.slug} | assets=${JSON.stringify(row.assetsReceived)} | grades=${JSON.stringify(row.grades)} | verdict=${JSON.stringify(row.verdict)}`);
  }
} else {
  console.log("");
  console.log("Missing OBJ inspection report.");
}

if (asset) {
  console.log("");
  console.log("Asset audit counts:");
  for (const [k, v] of Object.entries(asset.counts || {})) {
    console.log(`- ${k}: ${v}`);
  }
} else {
  console.log("");
  console.log("Missing asset audit report.");
}

if (multi) {
  console.log("");
  console.log("Multi-team contamination counts:");
  for (const [k, v] of Object.entries(multi.counts || {})) {
    if (typeof v === "object" && v !== null) {
      console.log(`- ${k}:`);
      for (const [kk, vv] of Object.entries(v)) console.log(`  - ${kk}: ${vv}`);
    } else {
      console.log(`- ${k}: ${v}`);
    }
  }
} else {
  console.log("");
  console.log("Missing multi-team inspection report.");
}

console.log("");
console.log("Git diff stat:");
