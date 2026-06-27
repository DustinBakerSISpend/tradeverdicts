const fs = require("fs");
const path = require("path");

const auditPath = path.join(process.cwd(), "audits", "audit-unknown-partner-near-date-duplicates.json");

const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));

const knownSlugs = new Set([
  "cardinals-1983-07-19-unknown-partner-al-baker-bubba-baker-unknown-not-disclosed",
  "mike-dawson-arizona-st-louis-cardinals-1983-07-18"
]);

function hasKnown(c) {
  return (c.members || []).some(m => knownSlugs.has(m.slug));
}

const comps = (audit.components || []).filter(hasKnown);

console.log("");
console.log("UNKNOWN-PARTNER BAKER/DAWSON TINY SUMMARY");
console.log("=".repeat(80));
console.log(`candidate pairs: ${audit.pairCount}`);
console.log(`by confidence: ${JSON.stringify(audit.byConfidence)}`);
console.log(`components: ${audit.componentCount}`);
console.log(`known components: ${comps.length}`);

for (const c of comps) {
  console.log("-".repeat(80));
  console.log(`component size: ${c.size}`);
  console.log(`confidence: ${c.topConfidence}`);
  console.log(`keeper: ${c.keeper?.slug} | ${c.keeper?.id} | score=${c.keeper?.score}`);
  console.log("suppress candidates:");
  for (const s of c.suppressCandidates || []) {
    console.log(`- ${s.slug} | ${s.id} | score=${s.score} | unknownish=${s.unknownish}`);
  }
  console.log("members:");
  for (const m of c.members || []) {
    console.log(`- ${m.slug} | ${m.id} | ${m.tradeDate} | status=${m.publishStatus} | unknownish=${m.unknownish} | score=${m.score}`);
    console.log(`  teams=${JSON.stringify(m.teams)}`);
    console.log(`  players=${JSON.stringify(m.playerNames)}`);
    console.log(`  picks=${JSON.stringify(m.pickSigs)}`);
  }
  console.log("pairs:");
  for (const p of c.pairs || []) {
    console.log(`- ${p.confidence} | dayDiff=${p.dayDiff} | playerOverlap=${JSON.stringify(p.playerOverlap)} | teamOverlap=${JSON.stringify(p.teamOverlap)}`);
    console.log(`  keep=${p.recommendedKeeper.slug}`);
    console.log(`  suppress=${p.recommendedSuppress.slug}`);
  }
}
