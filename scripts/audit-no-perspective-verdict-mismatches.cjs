const fs = require('fs');
const path = require('path');

const tradesPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trades.json');
const outPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'no-perspective-verdict-mismatch-audit.json');

const trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));

const teamDisplay = {
  'arizona-cardinals': ['Arizona Cardinals', 'Cardinals'],
  'atlanta-falcons': ['Atlanta Falcons', 'Falcons'],
  'baltimore-ravens': ['Baltimore Ravens', 'Ravens'],
  'buffalo-bills': ['Buffalo Bills', 'Bills'],
  'carolina-panthers': ['Carolina Panthers', 'Panthers'],
  'chicago-bears': ['Chicago Bears', 'Bears'],
  'cincinnati-bengals': ['Cincinnati Bengals', 'Bengals'],
  'cleveland-browns': ['Cleveland Browns', 'Browns'],
  'dallas-cowboys': ['Dallas Cowboys', 'Cowboys'],
  'denver-broncos': ['Denver Broncos', 'Broncos'],
  'detroit-lions': ['Detroit Lions', 'Lions'],
  'green-bay-packers': ['Green Bay Packers', 'Packers'],
  'houston-texans': ['Houston Texans', 'Texans'],
  'indianapolis-colts': ['Indianapolis Colts', 'Colts'],
  'jacksonville-jaguars': ['Jacksonville Jaguars', 'Jaguars'],
  'kansas-city-chiefs': ['Kansas City Chiefs', 'Chiefs'],
  'las-vegas-raiders': ['Las Vegas Raiders', 'Raiders', 'Oakland Raiders'],
  'los-angeles-chargers': ['Los Angeles Chargers', 'Chargers', 'San Diego Chargers'],
  'los-angeles-rams': ['Los Angeles Rams', 'Rams', 'Los Angeles/St. Louis Rams', 'St. Louis Rams'],
  'miami-dolphins': ['Miami Dolphins', 'Dolphins'],
  'minnesota-vikings': ['Minnesota Vikings', 'Vikings'],
  'new-england-patriots': ['New England Patriots', 'Patriots'],
  'new-orleans-saints': ['New Orleans Saints', 'Saints'],
  'new-york-giants': ['New York Giants', 'Giants'],
  'new-york-jets': ['New York Jets', 'Jets'],
  'philadelphia-eagles': ['Philadelphia Eagles', 'Eagles'],
  'pittsburgh-steelers': ['Pittsburgh Steelers', 'Steelers'],
  'san-francisco-49ers': ['San Francisco 49ers', '49ers'],
  'seattle-seahawks': ['Seattle Seahawks', 'Seahawks'],
  'tampa-bay-buccaneers': ['Tampa Bay Buccaneers', 'Buccaneers'],
  'tennessee-titans': ['Tennessee Titans', 'Titans'],
  'washington-commanders': ['Washington Commanders', 'Commanders', 'Washington Redskins', 'Redskins']
};

const verdictMentionsTeam = (verdict, teams) => {
  if (!verdict) return true;
  if (/even trade/i.test(verdict)) return true;

  return teams.some(team => {
    const names = teamDisplay[team] || [];
    return names.some(name => verdict.toLowerCase().includes(name.toLowerCase()));
  });
};

const audit = trades
  .filter(t => !Array.isArray(t.perspectives) || t.perspectives.length === 0)
  .map(t => ({
    id: t.id,
    slug: t.slug,
    tradeDate: t.tradeDate,
    publishStatus: t.publishStatus,
    verdict: t.verdict,
    teams: t.teams || [],
    assetTeams: Object.keys(t.assetsReceived || {}),
    gradeTeams: Object.keys(t.grades || {}),
    verdictMatchesTeams: verdictMentionsTeam(t.verdict || '', t.teams || [])
  }))
  .filter(x => !x.verdictMatchesTeams)
  .sort((a, b) => String(b.tradeDate || '').localeCompare(String(a.tradeDate || '')));

fs.writeFileSync(outPath, JSON.stringify(audit, null, 2) + '\n');

console.log('no-perspective verdict mismatches:', audit.length);
console.log('wrote:', outPath);

audit.forEach(x => {
  console.log(`${x.id} | ${x.tradeDate} | verdict: ${x.verdict} | teams: ${x.teams.join(', ')}`);
});
