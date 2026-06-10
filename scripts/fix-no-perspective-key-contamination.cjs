const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const tradesPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trades.json');
const reportPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'no-perspective-key-cleanup-report.json');

const trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));

const keys = (obj) =>
  obj && typeof obj === 'object' && !Array.isArray(obj)
    ? Object.keys(obj).filter(Boolean)
    : [];

const report = [];

for (const trade of trades) {
  const perspectives = Array.isArray(trade.perspectives) ? trade.perspectives : [];
  if (perspectives.length) continue;

  const teams = Array.isArray(trade.teams) ? trade.teams.filter(Boolean) : [];
  if (teams.length < 2) continue;

  const teamSet = new Set(teams);

  const assetKeys = keys(trade.assetsReceived);
  const gradeKeys = keys(trade.grades);

  const removeAssetKeys = assetKeys.filter(k => !teamSet.has(k));
  const removeGradeKeys = gradeKeys.filter(k => !teamSet.has(k));

  if (!removeAssetKeys.length && !removeGradeKeys.length) continue;

  report.push({
    id: trade.id,
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    teams,
    removeAssetKeys,
    removeGradeKeys
  });

  if (APPLY) {
    for (const key of removeAssetKeys) delete trade.assetsReceived[key];
    for (const key of removeGradeKeys) delete trade.grades[key];
  }
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + '\n');
}

console.log(APPLY ? 'APPLY MODE' : 'DRY RUN MODE');
console.log('Trades affected:', report.length);
console.log('Asset keys removed:', report.reduce((sum, x) => sum + x.removeAssetKeys.length, 0));
console.log('Grade keys removed:', report.reduce((sum, x) => sum + x.removeGradeKeys.length, 0));
console.log('Report:', reportPath);

report.forEach(x => {
  console.log(`${x.id} | teams: ${x.teams.join(', ')} | removeAssets: ${x.removeAssetKeys.join(', ') || '-'} | removeGrades: ${x.removeGradeKeys.join(', ') || '-'}`);
});
