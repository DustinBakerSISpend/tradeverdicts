const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const tradesPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trades.json');
const reportPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'phantom-team-final-fix-report.json');

const targetIds = new Set([
  'RAI-1987-0207',
  'DEN-2001-04-21-0266',
  'CLE-2004-0330',
  'MIN-2010-04-23-0230',
  'RAI-2012-0348',
  'DAL-2014-0312',
  'CLE-2017-0407',
  'CAR-2017-0059',
  'BUF-2018-0305',
  'ATL-2019-0276',
  'RAI-2019-0389',
  'IND-2024-0385',
  'NYJ-2024-0307',
  'PIT-2026-0396'
]);

const trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));

const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];

const report = [];

for (const trade of trades) {
  if (!targetIds.has(trade.id)) continue;

  const validTeams = uniq(
    (trade.perspectives || []).flatMap(p => [p.primaryTeam, p.partnerTeam])
  );

  if (validTeams.length < 2) {
    report.push({ id: trade.id, skipped: true, reason: 'Not enough valid perspective teams' });
    continue;
  }

  report.push({
    id: trade.id,
    slug: trade.slug,
    oldTeams: trade.teams,
    oldSourceTeams: trade.sourceTeams,
    newTeams: validTeams,
    newSourceTeams: validTeams
  });

  if (APPLY) {
    trade.teams = validTeams;
    trade.sourceTeams = validTeams;
  }
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + '\n');
}

console.log(APPLY ? 'APPLY MODE' : 'DRY RUN MODE');
console.log('Targeted records:', report.length);
console.log('Report:', reportPath);

report.forEach(x => {
  console.log(`${x.id} | ${x.oldTeams?.join(', ') || 'SKIPPED'} -> ${x.newTeams?.join(', ') || x.reason}`);
});
