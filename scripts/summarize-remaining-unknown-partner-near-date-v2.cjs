const fs = require("fs");
const path = require("path");

const auditPath = path.join(process.cwd(), "audits", "audit-unknown-partner-near-date-duplicates-v2.json");

const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));

const bakerDawsonSlugs = new Set([
  "1984-third-round-pick-62-eric-williams-michael-arizona-st-louis-cardinals-1983-0",
  "mike-dawson-arizona-st-louis-cardinals-1983-07-18",
  "cardinals-1983-07-19-unknown-partner-al-baker-bubba-baker-unknown-not-disclosed",
  "not-specified-unknown-partner-1983-07-19"
]);

function hasBakerDawson(c) {
  return (c.members || []).some(m => bakerDawsonSlugs.has(m.slug));
}

const remaining = (audit.components || []).filter(c => !hasBakerDawson(c));

console.log("");
console.log("REMAINING UNKNOWN-PARTNER NEAR-DATE COMPONENTS V2");
console.log("=".repeat(80));
console.log(`original V2 components: ${audit.componentCount}`);
console.log(`remaining after Baker/Dawson: ${remaining.length}`);
console.log(`pair count: ${audit.pairCount}`);
console.log(`by confidence: ${JSON.stringify(audit.byConfidence)}`);

for (const c of remaining) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`component size=${c.size} confidence=${c.topConfidence}`);
  console.log(`KEEPER: ${c.keeper?.slug} | ${c.keeper?.id} | score=${c.keeper?.score}`);
  console.log("SUPPRESS CANDIDATES:");
  for (const s of c.suppressCandidates || []) {
    console.log(`- ${s.slug} | ${s.id} | score=${s.score} | unknownish=${s.unknownish}`);
  }

  console.log("MEMBERS:");
  for (const m of c.members || []) {
    console.log(`- ${m.slug} | ${m.id} | ${m.tradeDate} | status=${m.publishStatus} | unknownish=${m.unknownish} | score=${m.score}`);
    console.log(`  teams=${JSON.stringify(m.teams)}`);
    console.log(`  players=${JSON.stringify(m.playerNames)}`);
    console.log(`  picks=${JSON.stringify(m.pickSigs)}`);
  }

  console.log("PAIRS:");
  for (const p of c.pairs || []) {
    console.log(`- ${p.confidence} | ${p.classification} | dayDiff=${p.dayDiff}`);
    console.log(`  players=${JSON.stringify(p.playerOverlap)} teams=${JSON.stringify(p.teamOverlap)} picks=${JSON.stringify(p.pickOverlap)}`);
    console.log(`  keep=${p.recommendedKeeper.slug}`);
    console.log(`  suppress=${p.recommendedSuppress.slug}`);
  }
}
