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

function verdictWinner(verdict, teams) {
  const v = clean(verdict).toLowerCase();

  if (!v || v.includes('even')) return null;

  for (const team of teams || []) {
    const readable = team.replace(/-/g, ' ').toLowerCase();
    const shortReadable = readable
      .replace('minnesota ', '')
      .replace('philadelphia ', '')
      .replace('indianapolis ', '')
      .replace('arizona ', '')
      .replace('tennessee ', '')
      .replace('new york ', '')
      .replace('los angeles ', '')
      .replace('las vegas ', '')
      .replace('san francisco ', '')
      .replace('kansas city ', '')
      .replace('tampa bay ', '');

    if (v.includes(readable) && v.includes('win')) return team;
    if (v.includes(shortReadable) && v.includes('win')) return team;
  }

  return null;
}

const issues = [];

for (const t of trades) {
  const teams = t.teams || [];
  if (teams.length < 2) continue;

  const winner = verdictWinner(t.verdict, teams);
  if (!winner) continue;

  const winnerGrade = clean(t.grades?.[winner]);
  const winnerPoints = GRADE_POINTS[winnerGrade];

  if (!winnerPoints) continue;

  const opponentGrades = teams
    .filter(team => team !== winner)
    .map(team => ({
      team,
      grade: clean(t.grades?.[team]),
      points: GRADE_POINTS[clean(t.grades?.[team])] || null,
    }))
    .filter(x => x.points !== null);

  if (!opponentGrades.length) continue;

  const bestOpponent = opponentGrades.sort((a, b) => b.points - a.points)[0];

  if (winnerPoints <= bestOpponent.points) {
    issues.push({
      id: t.id,
      slug: t.slug,
      tradeDate: t.tradeDate || t.date,
      verdict: t.verdict,
      winner,
      winnerGrade,
      opponent: bestOpponent.team,
      opponentGrade: bestOpponent.grade,
      summary: t.summary || '',
    });
  }
}

fs.writeFileSync(
  'src/data/nfl/verdict-grade-consistency-audit.json',
  JSON.stringify({ count: issues.length, issues }, null, 2) + '\n'
);

console.log(`verdict/grade consistency issues: ${issues.length}`);
for (const x of issues.slice(0, 80)) {
  console.log(`${x.id} | ${x.verdict} | ${x.winner} ${x.winnerGrade} vs ${x.opponent} ${x.opponentGrade} | ${x.slug}`);
}
