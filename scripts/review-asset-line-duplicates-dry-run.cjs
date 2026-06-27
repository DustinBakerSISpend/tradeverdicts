const fs = require("fs");
const path = require("path");

const reportPath = path.join(process.cwd(), "audits", "asset-line-duplicates-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "asset-line-duplicates-dry-run-review.json");

if (!fs.existsSync(reportPath)) {
  console.error(`Missing dry-run report: ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const changes = Array.isArray(report.changes) ? report.changes : [];

const knownNeedles = [
  "dan-arnold-carolina-panthers-2021",
  "2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020",
  "jabrill-peppers",
  "2014-6th-round-pick-182nd-overall-antone-exum-atlanta-falcons-2014"
];

const groupTypeCounts = {};
const removalByGroupType = {};
const changesBySlug = new Map();

for (const change of changes) {
  if (!changesBySlug.has(change.slug)) changesBySlug.set(change.slug, []);
  changesBySlug.get(change.slug).push(change);

  for (const group of change.groups || []) {
    groupTypeCounts[group.groupType] = (groupTypeCounts[group.groupType] || 0) + 1;
    removalByGroupType[group.groupType] = (removalByGroupType[group.groupType] || 0) + (group.removed || []).length;
  }
}

const knownMatches = {};
for (const needle of knownNeedles) {
  knownMatches[needle] = changes.filter(c => String(c.slug || "").includes(needle));
}

const biggestChanges = [...changes]
  .sort((a, b) => (b.removedCount || 0) - (a.removedCount || 0))
  .slice(0, 25);

const review = {
  generatedAt: new Date().toISOString(),
  sourceReport: reportPath,
  summary: {
    mode: report.mode,
    tradesTouched: report.tradesTouched,
    teamAssetArraysChanged: report.changeCount,
    totalLinesRemoved: report.totalLinesRemoved,
    groupTypeCounts,
    removalByGroupType
  },
  knownMatches,
  biggestChanges
};

fs.writeFileSync(outPath, JSON.stringify(review, null, 2));

console.log("");
console.log("DRY-RUN REVIEW");
console.log("=".repeat(70));
console.log(`Trades touched: ${report.tradesTouched}`);
console.log(`Team asset arrays changed: ${report.changeCount}`);
console.log(`Total asset lines removed: ${report.totalLinesRemoved}`);

console.log("");
console.log("Group type counts:");
for (const [k, v] of Object.entries(groupTypeCounts)) {
  console.log(`- ${k}: ${v} groups, ${removalByGroupType[k]} removed lines`);
}

console.log("");
console.log("Known bad slug impact:");
for (const [needle, matches] of Object.entries(knownMatches)) {
  console.log(`- ${needle}: ${matches.length} planned team-array changes`);
  for (const change of matches) {
    console.log(`  ${change.slug} | ${change.team} | remove ${change.removedCount}`);
    for (const group of change.groups || []) {
      console.log(`    ${group.groupType}`);
      console.log(`    KEEP: ${group.kept.asset}`);
      for (const removed of group.removed || []) {
        console.log(`    DROP: ${removed.asset}`);
      }
    }
  }
}

console.log("");
console.log("Biggest planned changes:");
for (const change of biggestChanges) {
  console.log(`- ${change.slug} | ${change.team} | remove ${change.removedCount}`);
  for (const group of change.groups || []) {
    console.log(`  ${group.groupType}: keep "${group.kept.asset}"`);
    for (const removed of group.removed || []) {
      console.log(`    drop "${removed.asset}"`);
    }
  }
}

console.log("");
console.log(`Wrote review: ${outPath}`);
