const fs = require("fs");

const trades = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"))
  .filter(t => !t.suppressed && t.publishStatus !== "hold-conflict");

const conflicts = JSON.parse(fs.readFileSync("src/data/nfl/high-confidence-verdict-grade-conflicts.json", "utf8")).rows;

function norm(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }

function verdictKey(v, teams) {
  const x = norm(v);
  if (!x) return "";
  if (x.includes("even")) return "even";
  for (const team of teams || []) {
    const n = norm(team);
    const mascot = n.split(" ").at(-1);
    if (x.includes(n)) return team;
    if (mascot && mascot.length > 3 && x.includes(mascot)) return team;
  }
  return "";
}

const rows = [];

for (const c of conflicts) {
  const t = trades.find(x => x.slug === c.slug);
  if (!t || !Array.isArray(t.perspectives)) continue;

  const gradeWinner = c.gradeWinner;
  const topKey = verdictKey(t.verdict, t.teams);

  const perspectives = t.perspectives.map((p, i) => {
    const key = verdictKey(p.verdict, t.teams);
    return {
      index: i,
      sourceTeam: p.sourceTeam,
      primaryTeam: p.primaryTeam,
      partnerTeam: p.partnerTeam,
      verdict: p.verdict,
      verdictKey: key,
      primaryGrade: p.primaryGrade,
      partnerGrade: p.partnerGrade,
      agreesWithGradeWinner: key === gradeWinner
    };
  });

  rows.push({
    slug: t.slug,
    date: t.tradeDate,
    teams: t.teams,
    topVerdict: t.verdict,
    topKey,
    topAgreesWithGrades: topKey === gradeWinner,
    gradeWinner,
    winnerGrade: c.winnerGrade,
    loser: c.loser,
    loserGrade: c.loserGrade,
    gap: c.gap,
    perspectiveAgreeCount: perspectives.filter(p => p.agreesWithGradeWinner).length,
    perspectiveDisagreeCount: perspectives.filter(p => !p.agreesWithGradeWinner).length,
    agreeingPerspectives: perspectives.filter(p => p.agreesWithGradeWinner),
    disagreeingPerspectives: perspectives.filter(p => !p.agreesWithGradeWinner),
    perspectives
  });
}

const summary = {
  total: rows.length,
  topAgreesWithGrades: rows.filter(r => r.topAgreesWithGrades).length,
  topDisagreesWithGrades: rows.filter(r => !r.topAgreesWithGrades).length,
  onePerspectiveAgrees: rows.filter(r => r.perspectiveAgreeCount === 1).length,
  multiplePerspectivesAgree: rows.filter(r => r.perspectiveAgreeCount > 1).length,
  noPerspectiveAgrees: rows.filter(r => r.perspectiveAgreeCount === 0).length
};

const byAgreeingPerspectiveSourceTeam = {};
const byDisagreeingPerspectiveSourceTeam = {};

for (const r of rows) {
  for (const p of r.agreeingPerspectives) {
    byAgreeingPerspectiveSourceTeam[p.sourceTeam] = (byAgreeingPerspectiveSourceTeam[p.sourceTeam] || 0) + 1;
  }
  for (const p of r.disagreeingPerspectives) {
    byDisagreeingPerspectiveSourceTeam[p.sourceTeam] = (byDisagreeingPerspectiveSourceTeam[p.sourceTeam] || 0) + 1;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  summary,
  byAgreeingPerspectiveSourceTeam,
  byDisagreeingPerspectiveSourceTeam,
  rows
};

fs.writeFileSync("src/data/nfl/perspective-grade-winner-alignment-audit.json", JSON.stringify(report, null, 2));

console.log("Wrote src/data/nfl/perspective-grade-winner-alignment-audit.json");
console.table(summary);
console.log("Top agreeing source teams:");
console.table(Object.entries(byAgreeingPerspectiveSourceTeam).sort((a,b)=>b[1]-a[1]).slice(0,25));
console.log("Top disagreeing source teams:");
console.table(Object.entries(byDisagreeingPerspectiveSourceTeam).sort((a,b)=>b[1]-a[1]).slice(0,25));
console.log("Top 25 rows:");
console.table(rows.slice(0,25).map(r => ({
  slug: r.slug,
  top: r.topKey,
  gradeWinner: r.gradeWinner,
  topOK: r.topAgreesWithGrades,
  agree: r.perspectiveAgreeCount,
  disagree: r.perspectiveDisagreeCount,
  gap: r.gap
})));
