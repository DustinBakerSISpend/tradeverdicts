const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const tradesPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trades.json');
const reportPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'no-perspective-verdict-fix-report.json');

const fixes = {
  'DAL-2019-0328': 'Even Trade',
  'LAC-2014-0359': 'Even Trade',
  'IND-1988-0266': 'Indianapolis Colts Win',
  'WAS-1975-0222': 'San Francisco 49ers Win',
  'WAS-1973-0195': 'Minnesota Vikings Win',
  'DEN-1968-10-17-0049': 'Even Trade',
  'WAS-1967-0118': 'Indianapolis Colts Win',
  'WAS-1966-0100': 'Even Trade'
};

const trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));

const report = [];

for (const trade of trades) {
  if (!fixes[trade.id]) continue;

  report.push({
    id: trade.id,
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    teams: trade.teams,
    grades: trade.grades,
    oldVerdict: trade.verdict,
    newVerdict: fixes[trade.id]
  });

  if (APPLY) {
    trade.verdict = fixes[trade.id];
  }
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + '\n');
}

console.log(APPLY ? 'APPLY MODE' : 'DRY RUN MODE');
console.log('Verdicts targeted:', report.length);
console.log('Report:', reportPath);

report.forEach(x => {
  console.log(`${x.id} | ${x.oldVerdict} -> ${x.newVerdict}`);
});
