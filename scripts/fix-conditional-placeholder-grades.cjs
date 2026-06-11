const fs = require('fs');

const path = 'src/data/nfl/trades.json';

const TARGETS = [
  'DEN-1969-08-25-0055',
  'DEN-1976-08-09-0146',
  'DEN-1986-05-19-0198',
  'DEN-1988-07-29-0212',
  'DEN-1988-08-01-0214',
  'DEN-1989-08-21-0220',
];

const trades = JSON.parse(fs.readFileSync(path, 'utf8'));
const changes = [];

for (const trade of trades) {
  if (!TARGETS.includes(trade.id)) continue;

  trade.grades = trade.grades || {};

  for (const team of trade.teams || []) {
    const current = String(trade.grades[team] || '').trim();
    if (!current) {
      trade.grades[team] = 'C';
      changes.push({ id: trade.id, team, from: current, to: 'C' });
    }
  }
}

fs.writeFileSync(path, JSON.stringify(trades, null, 2) + '\n');
fs.writeFileSync(
  'src/data/nfl/conditional-placeholder-grade-fix-report.json',
  JSON.stringify({ changed: changes.length, changes }, null, 2) + '\n'
);

console.log(`fixed ${changes.length} blank conditional placeholder grades`);
for (const c of changes) console.log(`${c.id} | ${c.team} -> C`);
