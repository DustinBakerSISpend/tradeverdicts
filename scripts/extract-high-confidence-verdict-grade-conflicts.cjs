const fs = require("fs");

const trades = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"))
  .filter(t => !t.suppressed && t.publishStatus !== "hold-conflict");

const gradeValue = {
  "A+":12,"A":11,"A-":10,"B+":9,"B":8,"B-":7,"C+":6,"C":5,"C-":4,"D+":3,"D":2,"D-":1,"F":0
};

function verdictFromGrades(t) {
  const grades = t.grades || {};
  const entries = Object.entries(grades).filter(([team,g]) => gradeValue[g] !== undefined);
  if (entries.length < 2) return null;
  const sorted = entries.map(([team,g]) => ({team,grade:g,value:gradeValue[g]})).sort((a,b)=>b.value-a.value);
  const gap = sorted[0].value - sorted[1].value;
  if (gap < 2) return null;
  return { winner: sorted[0].team, winnerGrade: sorted[0].grade, loser: sorted[1].team, loserGrade: sorted[1].grade, gap };
}

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

for (const t of trades) {
  const ps = Array.isArray(t.perspectives) ? t.perspectives : [];
  if (ps.length < 2) continue;

  const keys = [...new Set(ps.map(p => verdictKey(p.verdict, t.teams)).filter(Boolean))];
  const nonEven = [...new Set(keys.filter(k => k !== "even"))];

  if (nonEven.length < 2) continue;

  const gradeVerdict = verdictFromGrades(t);
  if (!gradeVerdict) continue;

  rows.push({
    slug: t.slug,
    date: t.tradeDate,
    topVerdict: t.verdict,
    perspectiveKeys: keys.join(" | "),
    gradeWinner: gradeVerdict.winner,
    winnerGrade: gradeVerdict.winnerGrade,
    loser: gradeVerdict.loser,
    loserGrade: gradeVerdict.loserGrade,
    gap: gradeVerdict.gap
  });
}

rows.sort((a,b)=>b.gap-a.gap || a.date.localeCompare(b.date));

console.log("highConfidenceGradeResolvedConflicts", rows.length);
console.table(rows.slice(0,50));
fs.writeFileSync("src/data/nfl/high-confidence-verdict-grade-conflicts.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  count: rows.length,
  rows
}, null, 2));
