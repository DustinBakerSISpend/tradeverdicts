const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const tradesPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trades.json');
const reportPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trade-team-key-contamination-fix-report.json');

const trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));

const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];
const keys = (obj) => obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj) : [];

const report = [];

for (const trade of trades) {
  const perspectives = Array.isArray(trade.perspectives) ? trade.perspectives : [];
  if (!perspectives.length) continue;

  const validTeams = uniq(
    perspectives.flatMap(p => [p.primaryTeam, p.partnerTeam])
  );

  if (validTeams.length < 2) continue;

  const validSet = new Set(validTeams);

  const assetKeys = keys(trade.assetsReceived);
  const gradeKeys = keys(trade.grades);

  const removeAssetKeys = assetKeys.filter(k => !validSet.has(k));
  const removeGradeKeys = gradeKeys.filter(k => !validSet.has(k));

  if (!removeAssetKeys.length && !removeGradeKeys.length) continue;

  report.push({
    id: trade.id,
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    teams: trade.teams,
    sourceTeams: trade.sourceTeams,
    validTeams,
    removeAssetKeys,
    removeGradeKeys
  });

  if (APPLY) {
    for (const key of removeAssetKeys) {
      delete trade.assetsReceived[key];
    }

    for (const key of removeGradeKeys) {
      delete trade.grades[key];
    }
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

report.slice(0, 80).forEach(x => {
  console.log(`${x.id} | validTeams: ${x.validTeams.join(', ')} | removeAssets: ${x.removeAssetKeys.join(', ') || '-'} | removeGrades: ${x.removeGradeKeys.join(', ') || '-'}`);
});
