const fs = require('fs');

const path = 'src/data/nfl/trades.json';

const FIXES = {
  'TEN-2023-0261': { 'arizona-cardinals': 'C' },
  'KC-2024-0286': { 'kansas-city-chiefs': 'C+' },
  'DAL-2025-0347': { 'dallas-cowboys': 'C+' },
  'SEA-2025-04-25-0240': { 'seattle-seahawks': 'B+' },
  'BAL-2025-0109': { 'baltimore-ravens': 'C' },
  'NYJ-2025-0319': { 'new-york-jets': 'C+' },
  'TEN-2025-0275': { 'los-angeles-rams': 'C' },
  'BAL-2025-0113': { 'baltimore-ravens': 'C' },
  'NYJ-2026-0323': { 'new-york-jets': 'C-' },
  'DAL-2026-0357': { 'dallas-cowboys': 'C-' },
  'TEN-2026-0279': { 'buffalo-bills': 'C' },
  'CHI-2026-0509': { 'chicago-bears': 'C' }
};

const APPLY = process.argv.includes('--apply');
const trades = JSON.parse(fs.readFileSync(path, 'utf8'));
const changes = [];

for (const trade of trades) {
  const fixes = FIXES[trade.id];
  if (!fixes) continue;

  trade.grades = trade.grades || {};

  for (const [team, grade] of Object.entries(fixes)) {
    const current = String(trade.grades[team] || '').trim();

    if (!current || current === 'Hold - Provisional') {
      changes.push({ id: trade.id, team, from: current || null, to: grade });
      if (APPLY) trade.grades[team] = grade;
    }
  }
}

const report = {
  mode: APPLY ? 'apply' : 'dry-run',
  changed: changes.length,
  changes
};

fs.writeFileSync(
  'src/data/nfl/titans-partner-provisional-grade-fix-report.json',
  JSON.stringify(report, null, 2) + '\n'
);

if (APPLY) {
  fs.writeFileSync(path, JSON.stringify(trades, null, 2) + '\n');
}

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} ${changes.length} Titans partner provisional grade fixes`);
for (const c of changes) console.log(`${c.id} | ${c.team}: ${c.from || '(blank)'} -> ${c.to}`);
