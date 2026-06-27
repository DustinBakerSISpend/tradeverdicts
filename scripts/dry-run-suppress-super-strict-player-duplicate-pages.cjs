const fs = require("fs");
const path = require("path");

const srcPath = path.join(process.cwd(), "audits", "suppress-strict-player-duplicate-pages-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "suppress-super-strict-player-duplicate-pages-dry-run.json");

const src = JSON.parse(fs.readFileSync(srcPath, "utf8"));

function goodKeeperStatus(status) {
  return status === "ready" || status === "publish";
}

function badTeamSet(teams) {
  return (teams || []).some(t => {
    const x = String(t || "");
    return x.includes("unknown") || x.includes("not-specified") || x.includes("mutually") || x.includes("cancelled");
  });
}

function isKnownMcGill(p) {
  return (
    p.suppress?.slug === "mike-mcgill-arizona-st-louis-cardinals-1973" &&
    p.keeper?.slug === "cardinals-1973-04-24-houston-oilers-tennessee-titans-jim-tolbert-mike-mcgill-jim-hargrove"
  );
}

const planned = [];
const blocked = [];

for (const p of src.plannedSuppressions || []) {
  const reasons = [];

  if (!isKnownMcGill(p)) {
    if (!goodKeeperStatus(p.keeper?.publishStatus)) reasons.push(`keeper status is ${p.keeper?.publishStatus}`);
    if (badTeamSet(p.teamSet)) reasons.push("bad/unknown team set");
    if ((p.suppress?.pickSigs || []).length > 0) reasons.push("suppress row has pick signatures");
    if ((p.playerOverlap || []).length < 2) reasons.push("fewer than 2 shared player keys");
  }

  if (reasons.length) {
    blocked.push({ ...p, blockedReasons: reasons });
  } else {
    planned.push(p);
  }
}

const output = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  sourceReport: srcPath,
  plannedSuppressionCount: planned.length,
  blockedCount: blocked.length,
  errorCount: 0,
  errors: [],
  plannedSuppressions: planned,
  blocked
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log("");
console.log("SUPPRESS SUPER-STRICT PLAYER DUPLICATE PAGES DRY RUN");
console.log("=".repeat(80));
console.log(`planned suppressions: ${planned.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Planned suppressions:");
for (const p of planned) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${isKnownMcGill(p) ? "KNOWN/SAFE" : "SAFE"} | ${p.reason}`);
  console.log(`date=${p.suppress.tradeDate} | teams=${JSON.stringify(p.teamSet)} | players=${JSON.stringify(p.playerOverlap)}`);
  console.log(`KEEP:     ${p.keeper.slug} | ${p.keeper.id} | status=${p.keeper.publishStatus}`);
  console.log(`SUPPRESS: ${p.suppress.slug} | ${p.suppress.id} | status=${p.suppress.publishStatus}`);
}

console.log("");
console.log("Blocked sample:");
for (const p of blocked.slice(0, 40)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`BLOCKED: ${p.blockedReasons.join("; ")}`);
  console.log(`KEEP:     ${p.keeper.slug} | ${p.keeper.id} | status=${p.keeper.publishStatus}`);
  console.log(`SUPPRESS: ${p.suppress.slug} | ${p.suppress.id} | status=${p.suppress.publishStatus}`);
}
