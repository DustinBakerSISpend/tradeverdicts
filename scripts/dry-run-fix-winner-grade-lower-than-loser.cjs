const fs = require("fs");

const AUDIT = "src/data/nfl/verdict-grade-consistency-audit.json";
const OUT = "src/data/nfl/verdict-grade-fix-dry-run.json";

const audit = JSON.parse(fs.readFileSync(AUDIT, "utf8"));

function label(team) {
  return String(team || "")
    .split("-")
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : "")
    .join(" ");
}

const rows = [];

for (const r of audit.buckets.winnerGradeLowerThanLoser) {
  rows.push({
    action: "changeTopLevelVerdict",
    slug: r.slug,
    from: r.verdict,
    to: `${label(r.bestOtherTeam)} Win`,
    currentWinner: r.winner,
    currentWinnerGrade: r.winnerGrade,
    bestGradeTeam: r.bestOtherTeam,
    bestGrade: r.bestOtherGrade,
    grades: r.grades,
    reason: "verdict winner has lower grade than another team"
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  changedIfApplied: rows.length,
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log("Wrote", OUT);
console.log("changedIfApplied:", rows.length);
console.table(rows.slice(0,30).map(r => ({
  slug: r.slug,
  from: r.from,
  to: r.to,
  winnerGrade: r.currentWinnerGrade,
  bestGrade: r.bestGrade
})));
