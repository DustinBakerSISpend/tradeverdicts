const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const tradesPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trades.json');
const reportPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'no-perspective-summary-fix-report.json');

const fixes = {
  'WAS-1966-0100': 'Washington acquired cash from San Francisco 49ers. The available record does not show enough durable separation to force a win/loss label, leaving both sides near even with conservative historical confidence.',
  'WAS-1967-0118': 'Washington acquired cash from Indianapolis Colts. The cost and downstream value favored Indianapolis, leaving Washington with the weaker side of a low-scale historical transaction.',
  'DEN-1968-10-17-0049': 'Denver acquired cash from Las Vegas Raiders. This remains a low-scale transaction built around cash, conditional terms, or incomplete compensation, so the fairest public treatment is an even trade.',
  'WAS-1973-0195': 'Washington acquired an undisclosed draft pick from Minnesota Vikings. The cost and downstream value favored Minnesota, leaving Washington with the weaker side of the exchange.',
  'WAS-1975-0222': 'Washington acquired an undisclosed draft pick from San Francisco 49ers. The cost and downstream value favored San Francisco, leaving Washington with the weaker side of the exchange.',
  'IND-1988-0266': 'Indianapolis acquired a 1989 conditional twelfth-round pick that was not exercised from Pittsburgh Steelers for Ken Woodard. The incomplete compensation keeps the grade conservative, but the remaining record favors Indianapolis.',
  'LAC-2014-0359': 'The Chargers acquired the 2014 2nd round pick used on Jeremiah Attaochu from Philadelphia Eagles for the 2014 2nd round pick used on Jordan Matthews. The remaining record supports an even trade rather than a directional verdict.',
  'DAL-2019-0328': 'Dallas acquired 2019 5th round pick Michael Jackson and 2019 7th round pick Mike Weber from Philadelphia Eagles for 2019 5th round pick Clayton Thorson and 2019 7th round pick Javon Patterson. The remaining record supports an even trade.'
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
    verdict: trade.verdict,
    oldSummary: trade.summary,
    newSummary: fixes[trade.id]
  });

  if (APPLY) {
    trade.summary = fixes[trade.id];
  }
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + '\n');
}

console.log(APPLY ? 'APPLY MODE' : 'DRY RUN MODE');
console.log('Summaries targeted:', report.length);
console.log('Report:', reportPath);

report.forEach(x => {
  console.log(`${x.id} | ${x.oldSummary} -> ${x.newSummary}`);
});
