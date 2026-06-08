const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");

const TEAM_FIXES = {
  "los-angeles-cleveland-st-louis-rams": "los-angeles-rams",
  "washington-redskins-commanders": "washington-commanders",
  "washington-commanders-redskins": "washington-commanders",
  "oakland-los-angeles-las-vegas-raiders": "las-vegas-raiders",
  "houston-oilers": "tennessee-titans",
  "baltimore-colts": "indianapolis-colts",
  "st-louis-rams": "los-angeles-rams",
  "cleveland-rams": "los-angeles-rams",
  "oakland-raiders": "las-vegas-raiders",
  "los-angeles-raiders": "las-vegas-raiders",
  "san-diego-chargers": "los-angeles-chargers",
  "washington-redskins": "washington-commanders",
  "washington-football-team": "washington-commanders",
  "boston-patriots": "new-england-patriots",
  "new-york-titans": "new-york-jets",
  "dallas-texans": "kansas-city-chiefs",
  "phoenix-cardinals": "arizona-cardinals",
  "st-louis-cardinals": "arizona-cardinals",
  "chicago-cardinals": "arizona-cardinals",
  "portsmouth-spartans": "detroit-lions",
  "chicago-staleys": "chicago-bears",
  "decatur-staleys": "chicago-bears",
  "pittsburgh-pirates": "pittsburgh-steelers",
  "tennessee-oilers": "tennessee-titans",
  "unknown": "unknown-team",
  "unknown-partner": "unknown-team",
    "review-needed": "unknown-team",
  "unknown-undisclosed-partner": "unknown-team",
  "unknown-unspecified-partner": "unknown-team",
  "unknown-internal-packers-record": "unknown-team",
  "unknown-multiple-teams": "unknown-team",
  "steeler": "pittsburgh-steelers",
  "pittsburgh-pirates-steelers": "pittsburgh-steelers",
    "oilers": "tennessee-titans",
  "new-york-titans-tennessee-titans": "tennessee-titans",
  "football-team": "washington-commanders",
  "cowboys-when-mike-gaechter-retired": "dallas-cowboys",
};

function fixTeam(value) {
  if (!value) return value;
  return TEAM_FIXES[value] || value;
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort();
}

function remapObjectKeys(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const fixed = fixTeam(key);
    if (!out[fixed]) {
      out[fixed] = value;
    } else if (Array.isArray(out[fixed]) && Array.isArray(value)) {
      out[fixed] = [...out[fixed], ...value];
    } else {
      out[fixed] = value || out[fixed];
    }
  }
  return out;
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));
let changed = 0;

for (const trade of trades) {
  const before = JSON.stringify(trade);

  trade.teams = unique((trade.teams || []).map(fixTeam));
  trade.sourceTeams = unique((trade.sourceTeams || []).map(fixTeam));
  trade.assetsReceived = remapObjectKeys(trade.assetsReceived || {});
  trade.grades = remapObjectKeys(trade.grades || {});

  for (const p of trade.perspectives || []) {
    if (p.sourceTeam) p.sourceTeam = fixTeam(p.sourceTeam);
    if (p.primaryTeam) p.primaryTeam = fixTeam(p.primaryTeam);
    if (p.partnerTeam) p.partnerTeam = fixTeam(p.partnerTeam);
  }

  const after = JSON.stringify(trade);
  if (before !== after) changed++;
}

fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));

console.log(`Fixed team-name variants in ${changed} trades.`);