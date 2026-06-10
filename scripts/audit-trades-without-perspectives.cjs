const fs = require('fs');
const path = require('path');

const tradesPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trades.json');
const outPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trades-without-perspectives-audit.json');

const trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));

const keys = (obj) =>
  obj && typeof obj === 'object' && !Array.isArray(obj)
    ? Object.keys(obj).filter(Boolean)
    : [];

const audit = trades
  .filter(t => !Array.isArray(t.perspectives) || t.perspectives.length === 0)
  .map(t => {
    const assetTeams = keys(t.assetsReceived);
    const gradeTeams = keys(t.grades);

    return {
      id: t.id,
      slug: t.slug,
      tradeDate: t.tradeDate,
      teams: t.teams || [],
      sourceTeams: t.sourceTeams || [],
      assetTeams,
      gradeTeams,
      assetCount: assetTeams.reduce((sum, team) => sum + ((t.assetsReceived?.[team] || []).length), 0),
      gradeCount: gradeTeams.length
    };
  })
  .sort((a, b) => String(b.tradeDate || '').localeCompare(String(a.tradeDate || '')));

fs.writeFileSync(outPath, JSON.stringify(audit, null, 2) + '\n');

console.log('trades without perspectives:', audit.length);
console.log('wrote:', outPath);

audit.forEach(x => {
  console.log(`${x.id} | ${x.tradeDate} | teams: ${x.teams.join(', ')} | assetTeams: ${x.assetTeams.join(', ') || '-'} | gradeTeams: ${x.gradeTeams.join(', ') || '-'}`);
});
