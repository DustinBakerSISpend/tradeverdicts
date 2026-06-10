const fs = require('fs');
const path = require('path');

const tradesPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trades.json');
const outPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trade-team-key-contamination-audit.json');

const trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));

const arr = (x) => Array.isArray(x) ? x.filter(Boolean) : [];
const keys = (x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).filter(Boolean) : [];
const uniq = (x) => [...new Set(x.filter(Boolean))];

const audit = [];

for (const t of trades) {
  const teams = uniq(arr(t.teams));
  const sourceTeams = uniq(arr(t.sourceTeams));
  const perspectiveTeams = uniq(arr(t.perspectives).flatMap(p => [p.primaryTeam, p.partnerTeam]));
  const assetTeams = uniq(keys(t.assetsReceived));
  const gradeTeams = uniq(keys(t.grades));

  const teamSet = new Set(teams);
  const perspectiveSet = new Set(perspectiveTeams);

  const extraAssetTeams = assetTeams.filter(x => !teamSet.has(x));
  const extraGradeTeams = gradeTeams.filter(x => !teamSet.has(x));
  const teamsNotInPerspectives = perspectiveTeams.length
    ? teams.filter(x => !perspectiveSet.has(x))
    : [];

  if (extraAssetTeams.length || extraGradeTeams.length || teamsNotInPerspectives.length) {
    audit.push({
      id: t.id,
      slug: t.slug,
      tradeDate: t.tradeDate,
      teams,
      sourceTeams,
      perspectiveTeams,
      assetTeams,
      gradeTeams,
      extraAssetTeams,
      extraGradeTeams,
      teamsNotInPerspectives
    });
  }
}

fs.writeFileSync(outPath, JSON.stringify(audit, null, 2) + '\n');

console.log('trade team key contamination records:', audit.length);
console.log('wrote:', outPath);

audit.slice(0, 80).forEach(x => {
  console.log(
    `${x.id} | teams: ${x.teams.join(', ')} | perspectiveTeams: ${x.perspectiveTeams.join(', ')} | extraAssets: ${x.extraAssetTeams.join(', ') || '-'} | extraGrades: ${x.extraGradeTeams.join(', ') || '-'} | teamsNotInPerspectives: ${x.teamsNotInPerspectives.join(', ') || '-'}`
  );
});
