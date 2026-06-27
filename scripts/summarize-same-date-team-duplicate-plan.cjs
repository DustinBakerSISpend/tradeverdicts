const fs = require("fs");
const path = require("path");

const inspectPath = path.join(process.cwd(), "audits", "inspect-same-date-team-trade-duplicate-plan.json");
const outPath = path.join(process.cwd(), "audits", "same-date-team-duplicate-plan-summary.json");

const report = JSON.parse(fs.readFileSync(inspectPath, "utf8"));

function rowLine(r) {
  return {
    classification: r.classification,
    confidence: r.confidence,
    keeper: `${r.keeper?.slug} | ${r.keeper?.id} | status=${r.keeper?.publishStatus}`,
    suppress: `${r.suppress?.slug} | ${r.suppress?.id} | status=${r.suppress?.publishStatus}`,
    suppressPlayers: (r.suppressPlayers || []).map(x => x.asset),
    suppressPicks: r.suppressPicks || [],
    flags: r.flags || []
  };
}

const butchRows = (report.inspected || []).filter(r => {
  const slugs = [r.keeper?.slug, r.suppress?.slug].filter(Boolean);
  return slugs.includes("butch-johnson-houston-oilers-tennessee-titans-1984") ||
         slugs.includes("1985-third-round-pick-82-mike-kelley-c-denver-broncos-1984");
});

const byClassSafe = {};
for (const r of report.safe || []) {
  byClassSafe[r.classification] = (byClassSafe[r.classification] || 0) + 1;
}

const byClassBlocked = {};
for (const r of report.blocked || []) {
  byClassBlocked[r.classification] = (byClassBlocked[r.classification] || 0) + 1;
}

const byFlag = {};
for (const r of report.blocked || []) {
  for (const f of r.flags || []) {
    const key = f.split(":")[0];
    byFlag[key] = (byFlag[key] || 0) + 1;
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  source: inspectPath,
  candidatesConsidered: report.candidatesConsidered,
  dedupedCandidateCount: report.dedupedCandidateCount,
  conflictCount: report.conflictCount,
  inspectedCount: report.inspectedCount,
  safeCount: report.safeCount,
  blockedCount: report.blockedCount,
  safeByClass: byClassSafe,
  blockedByClass: byClassBlocked,
  blockedByFlag: byFlag,
  butchRows: butchRows.map(rowLine),
  blocked: (report.blocked || []).map(rowLine),
  firstSafe: (report.safe || []).slice(0, 40).map(rowLine)
};

fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

console.log("");
console.log("SAME-DATE/TEAM DUPLICATE PLAN SUMMARY");
console.log("=".repeat(80));
console.log(`candidates considered: ${report.candidatesConsidered}`);
console.log(`deduped candidates: ${report.dedupedCandidateCount}`);
console.log(`conflicts: ${report.conflictCount}`);
console.log(`inspected: ${report.inspectedCount}`);
console.log(`safe: ${report.safeCount}`);
console.log(`blocked: ${report.blockedCount}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Safe by class:");
console.log(JSON.stringify(byClassSafe, null, 2));

console.log("");
console.log("Blocked by class:");
console.log(JSON.stringify(byClassBlocked, null, 2));

console.log("");
console.log("Blocked by flag:");
console.log(JSON.stringify(byFlag, null, 2));

console.log("");
console.log("Butch row:");
for (const r of butchRows.map(rowLine)) {
  console.log("-".repeat(80));
  console.log(`KEEP:     ${r.keeper}`);
  console.log(`SUPPRESS: ${r.suppress}`);
  console.log(`flags=${JSON.stringify(r.flags)}`);
  console.log(`suppressPlayers=${JSON.stringify(r.suppressPlayers)}`);
  console.log(`suppressPicks=${JSON.stringify(r.suppressPicks)}`);
}

console.log("");
console.log("Blocked rows:");
for (const r of (report.blocked || []).map(rowLine)) {
  console.log("-".repeat(80));
  console.log(`FLAGS: ${JSON.stringify(r.flags)}`);
  console.log(`KEEP:     ${r.keeper}`);
  console.log(`SUPPRESS: ${r.suppress}`);
  console.log(`suppressPlayers=${JSON.stringify(r.suppressPlayers)}`);
  console.log(`suppressPicks=${JSON.stringify(r.suppressPicks)}`);
}

console.log("");
console.log("First 40 safe rows:");
for (const r of (report.safe || []).slice(0, 40).map(rowLine)) {
  console.log("-".repeat(80));
  console.log(`KEEP:     ${r.keeper}`);
  console.log(`SUPPRESS: ${r.suppress}`);
  console.log(`suppressPlayers=${JSON.stringify(r.suppressPlayers)}`);
  console.log(`suppressPicks=${JSON.stringify(r.suppressPicks)}`);
}
