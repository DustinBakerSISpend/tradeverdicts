const fs = require("fs");
const path = require("path");

const auditPath = path.join(process.cwd(), "audits", "audit-unknown-partner-near-date-duplicates.json");
const outPath = path.join(process.cwd(), "audits", "unknown-partner-near-date-summary.json");

const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));

const knownSlugs = new Set([
  "cardinals-1983-07-19-unknown-partner-al-baker-bubba-baker-unknown-not-disclosed",
  "mike-dawson-arizona-st-louis-cardinals-1983-07-18"
]);

function componentHasKnown(c) {
  return (c.members || []).some(m => knownSlugs.has(m.slug));
}

function shortMember(m) {
  return {
    slug: m.slug,
    id: m.id,
    tradeDate: m.tradeDate,
    teams: m.teams,
    nonUnknownTeams: m.nonUnknownTeams,
    status: m.publishStatus,
    suppressed: m.suppressed,
    unknownish: m.unknownish,
    players: m.playerNames,
    picks: m.pickSigs,
    score: m.score,
    assetsReceived: m.assetsReceived,
    summary: m.summary
  };
}

const knownComponents = (audit.components || []).filter(componentHasKnown);
const multiRecordComponents = (audit.components || []).filter(c => (c.size || 0) >= 3);
const highComponents = (audit.components || []).filter(c => c.topConfidence === "high" || c.topConfidence === "known");

const compact = {
  generatedAt: new Date().toISOString(),
  sourceAudit: auditPath,
  activeRowsWithDates: audit.activeRowsWithDates,
  unknownishRows: audit.unknownishRows,
  pairCount: audit.pairCount,
  byConfidence: audit.byConfidence,
  componentCount: audit.componentCount,
  knownComponents: knownComponents.map(c => ({
    size: c.size,
    topConfidence: c.topConfidence,
    hasKnownSlug: c.hasKnownSlug,
    keeper: c.keeper,
    suppressCandidates: c.suppressCandidates,
    members: (c.members || []).map(shortMember),
    pairs: c.pairs
  })),
  multiRecordComponents: multiRecordComponents.map(c => ({
    size: c.size,
    topConfidence: c.topConfidence,
    hasKnownSlug: c.hasKnownSlug,
    keeper: c.keeper,
    suppressCandidates: c.suppressCandidates,
    members: (c.members || []).map(m => ({
      slug: m.slug,
      id: m.id,
      tradeDate: m.tradeDate,
      status: m.publishStatus,
      unknownish: m.unknownish,
      players: m.playerNames,
      picks: m.pickSigs,
      score: m.score
    }))
  })),
  highComponentSummary: highComponents.slice(0, 50).map(c => ({
    size: c.size,
    topConfidence: c.topConfidence,
    hasKnownSlug: c.hasKnownSlug,
    keeper: c.keeper,
    suppressCandidates: c.suppressCandidates,
    members: (c.members || []).map(m => ({
      slug: m.slug,
      id: m.id,
      tradeDate: m.tradeDate,
      status: m.publishStatus,
      unknownish: m.unknownish,
      players: m.playerNames,
      picks: m.pickSigs,
      score: m.score
    }))
  }))
};

fs.writeFileSync(outPath, JSON.stringify(compact, null, 2));

console.log("");
console.log("UNKNOWN-PARTNER NEAR-DATE SUMMARY");
console.log("=".repeat(80));
console.log(`active rows with dates: ${audit.activeRowsWithDates}`);
console.log(`unknownish rows: ${audit.unknownishRows}`);
console.log(`candidate pairs: ${audit.pairCount}`);
console.log(`by confidence: ${JSON.stringify(audit.byConfidence)}`);
console.log(`components: ${audit.componentCount}`);
console.log(`known components: ${knownComponents.length}`);
console.log(`multi-record components: ${multiRecordComponents.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("KNOWN BAKER/DAWSON COMPONENT:");
for (const c of knownComponents) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`component size=${c.size} confidence=${c.topConfidence}`);
  console.log(`KEEPER: ${c.keeper?.slug} | ${c.keeper?.id} | score=${c.keeper?.score}`);
  console.log("SUPPRESS CANDIDATES:");
  for (const s of c.suppressCandidates || []) {
    console.log(`- ${s.slug} | ${s.id} | score=${s.score} | unknownish=${s.unknownish}`);
  }

  console.log("");
  console.log("MEMBERS:");
  for (const m of c.members || []) {
    console.log("-".repeat(80));
    console.log(`${m.slug} | ${m.id} | ${m.tradeDate} | status=${m.publishStatus} | suppressed=${m.suppressed} | unknownish=${m.unknownish} | score=${m.score}`);
    console.log(`teams=${JSON.stringify(m.teams)}`);
    console.log(`nonUnknownTeams=${JSON.stringify(m.nonUnknownTeams)}`);
    console.log(`players=${JSON.stringify(m.playerNames)}`);
    console.log(`picks=${JSON.stringify(m.pickSigs)}`);
    console.log("assetsReceived:");
    console.dir(m.assetsReceived, { depth: null });
    console.log("summary:");
    console.log(m.summary || "(none)");
  }

  console.log("");
  console.log("PAIRS:");
  for (const p of c.pairs || []) {
    console.log(`- ${p.classification} | confidence=${p.confidence} | dayDiff=${p.dayDiff} | teamOverlap=${JSON.stringify(p.teamOverlap)} | playerOverlap=${JSON.stringify(p.playerOverlap)}`);
    console.log(`  KEEP=${p.recommendedKeeper.slug}`);
    console.log(`  SUPPRESS=${p.recommendedSuppress.slug}`);
  }
}

console.log("");
console.log("OTHER MULTI-RECORD COMPONENTS:");
for (const c of multiRecordComponents.filter(c => !componentHasKnown(c)).slice(0, 20)) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`component size=${c.size} confidence=${c.topConfidence} known=${c.hasKnownSlug}`);
  console.log(`KEEPER: ${c.keeper?.slug} | ${c.keeper?.id} | score=${c.keeper?.score}`);
  console.log(`SUPPRESS: ${(c.suppressCandidates || []).map(s => `${s.slug} | ${s.id}`).join(" || ")}`);
  for (const m of c.members || []) {
    console.log(`- ${m.slug} | ${m.id} | ${m.tradeDate} | status=${m.publishStatus} | unknownish=${m.unknownish} | players=${JSON.stringify(m.playerNames)} | score=${m.score}`);
  }
}
