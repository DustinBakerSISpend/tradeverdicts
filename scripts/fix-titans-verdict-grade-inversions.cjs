const fs = require('fs');

const path = 'src/data/nfl/trades.json';
const APPLY = process.argv.includes('--apply');

const GRADE_POINTS = {
  'A+': 13, 'A': 12, 'A-': 11,
  'B+': 10, 'B': 9, 'B-': 8,
  'C+': 7, 'C': 6, 'C-': 5,
  'D+': 4, 'D': 3, 'D-': 2,
  'F': 1,
};

const TEAM_LABELS = {
  'tennessee-titans': 'Tennessee Titans',
};

function label(team) {
  return TEAM_LABELS[team] || team.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

const trades = JSON.parse(fs.readFileSync(path, 'utf8'));
const review = JSON.parse(fs.readFileSync('src/data/nfl/titans-verdict-grade-review.json', 'utf8'));

const targetIds = new Set(review.rows.map(x => x.id));
const changes = [];

for (const trade of trades) {
  if (!targetIds.has(trade.id)) continue;
  if (!(trade.teams || []).includes('tennessee-titans')) continue;

  const graded = (trade.teams || [])
    .map(team => ({
      team,
      grade: String(trade.grades?.[team] || '').trim(),
      points: GRADE_POINTS[String(trade.grades?.[team] || '').trim()] || null,
    }))
    .filter(x => x.points !== null)
    .sort((a, b) => b.points - a.points);

  if (graded.length < 2) continue;
  if (graded[0].points === graded[1].points) continue;
  if (graded[0].team !== 'tennessee-titans') continue;

  const nextVerdict = `${label(graded[0].team)} Win`;

  changes.push({
    id: trade.id,
    from: trade.verdict,
    to: nextVerdict,
    grades: trade.grades,
  });

  if (APPLY) {
    trade.verdict = nextVerdict;
  }
}

fs.writeFileSync(
  'src/data/nfl/titans-verdict-grade-fix-report.json',
  JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', changed: changes.length, changes }, null, 2) + '\n'
);

if (APPLY) {
  fs.writeFileSync(path, JSON.stringify(trades, null, 2) + '\n');
}

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} ${changes.length} Titans verdict fixes`);
for (const c of changes) console.log(`${c.id} | ${c.from} -> ${c.to}`);
