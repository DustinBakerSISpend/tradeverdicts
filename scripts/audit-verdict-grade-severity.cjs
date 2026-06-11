const fs = require('fs');

const trades = JSON.parse(fs.readFileSync('src/data/nfl/trades.json', 'utf8'));

const GRADE_POINTS = {
  'A+': 13, 'A': 12, 'A-': 11,
  'B+': 10, 'B': 9, 'B-': 8,
  'C+': 7, 'C': 6, 'C-': 5,
  'D+': 4, 'D': 3, 'D-': 2,
  'F': 1,
};

function clean(s) {
  return String(s || '').trim();
}

function readableTeam(slug) {
  return slug.replace(/-/g, ' ');
}

function verdictWinner(verdict, teams) {
  const v = clean(verdict).toLowerCase();
  if (!v || v.includes('even')) return null;

  for (const team of teams || []) {
    const full = readableTeam(team).toLowerCase();
    const nick = full.split(' ').at(-1);
    if (v.includes(full) && v.includes('win')) return team;
    if (v.includes(nick) && v.includes('win')) return team;
  }

  return null;
}

const lowerGrade = [];
const equalGrade = [];

for (const t of trades) {
  const teams = t.teams || [];
  if (teams.length < 2) continue;

  const winner = verdictWinner(t.verdict, teams);
  if (!winner) continue;

  const winnerGrade = clean(t.grades?.[winner]);
  const winnerPoints = GRADE_POINTS[winnerGrade];
  if (!winnerPoints) continue;

  for (const opponent of teams.filter(team => team !== winner)) {
    const opponentGrade = clean(t.grades?.[opponent]);
    const opponentPoints = GRADE_POINTS[opponentGrade];
    if (!opponentPoints) continue;

    const row = {
      id: t.id,
      slug: t.slug,
      tradeDate: t.tradeDate || t.date,
      season: t.season,
      verdict: t.verdict,
      winner,
      winnerGrade,
      opponent,
      opponentGrade,
      gap: opponentPoints - winnerPoints,
      confidence: t.confidence || '',
      publishStatus: t.publishStatus || '',
      summary: t.summary || '',
    };

    if (winnerPoints < opponentPoints) lowerGrade.push(row);
    if (winnerPoints === opponentPoints) equalGrade.push(row);
  }
}

lowerGrade.sort((a, b) => b.gap - a.gap || String(a.tradeDate).localeCompare(String(b.tradeDate)));
equalGrade.sort((a, b) => String(a.tradeDate).localeCompare(String(b.tradeDate)));

const report = {
  lowerGradeCount: lowerGrade.length,
  equalGradeCount: equalGrade.length,
  lowerGrade,
  equalGrade,
};

fs.writeFileSync(
  'src/data/nfl/verdict-grade-severity-audit.json',
  JSON.stringify(report, null, 2) + '\n'
);

console.log(`winner lower-grade issues: ${lowerGrade.length}`);
for (const x of lowerGrade.slice(0, 80)) {
  console.log(`${x.id} | gap ${x.gap} | ${x.verdict} | ${x.winner} ${x.winnerGrade} vs ${x.opponent} ${x.opponentGrade} | ${x.slug}`);
}

console.log(`\nwinner equal-grade issues: ${equalGrade.length}`);
