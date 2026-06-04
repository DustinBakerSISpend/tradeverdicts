const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "team-alias-normalization-report.json");

const TEAM_ALIAS_MAP = {
  "49ers": "san-francisco-49ers",
  niners: "san-francisco-49ers",
  "san-francisco": "san-francisco-49ers",

  bears: "chicago-bears",
  bengals: "cincinnati-bengals",
  bills: "buffalo-bills",
  broncos: "denver-broncos",
  browns: "cleveland-browns",
  buccaneers: "tampa-bay-buccaneers",
  bucs: "tampa-bay-buccaneers",
  cardinals: "arizona-cardinals",
  chargers: "los-angeles-chargers",
  chiefs: "kansas-city-chiefs",
  colts: "indianapolis-colts",
  commanders: "washington-commanders",
  cowboys: "dallas-cowboys",
  dolphins: "miami-dolphins",
  eagles: "philadelphia-eagles",
  falcons: "atlanta-falcons",
  giants: "new-york-giants",
  jaguars: "jacksonville-jaguars",
  jets: "new-york-jets",
  lions: "detroit-lions",
  packers: "green-bay-packers",
  panthers: "carolina-panthers",
  patriots: "new-england-patriots",
  raiders: "las-vegas-raiders",
  rams: "los-angeles-rams",
  ravens: "baltimore-ravens",
  saints: "new-orleans-saints",
  seahawks: "seattle-seahawks",
  steelers: "pittsburgh-steelers",
  texans: "houston-texans",
  titans: "tennessee-titans",
  vikings: "minnesota-vikings",

  "washington-redskins": "washington-commanders",
  redskins: "washington-commanders",
  "washington-football-team": "washington-commanders",
  washington: "washington-commanders",

  "st-louis-rams": "los-angeles-rams",
  "oakland-raiders": "las-vegas-raiders",
  "san-diego-chargers": "los-angeles-chargers",
};

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function toSlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTeamSlug(value) {
  const slug = toSlug(value);
  return TEAM_ALIAS_MAP[slug] || slug;
}

function normalizeTeamArray(teams = []) {
  return Array.from(new Set((teams || []).map(normalizeTeamSlug).filter(Boolean))).sort();
}

function normalizeAssetMap(assetMap = {}) {
  const normalized = {};

  for (const [team, assets] of Object.entries(assetMap || {})) {
    const normalizedTeam = normalizeTeamSlug(team);

    if (!normalized[normalizedTeam]) normalized[normalizedTeam] = [];
    normalized[normalizedTeam].push(...(Array.isArray(assets) ? assets : []));
  }

  return normalized;
}

function normalizeGrades(grades = {}) {
  const normalized = {};

  for (const [team, grade] of Object.entries(grades || {})) {
    const normalizedTeam = normalizeTeamSlug(team);
    normalized[normalizedTeam] = grade;
  }

  return normalized;
}

function normalizePerspectives(perspectives = []) {
  return (perspectives || []).map((perspective) => ({
    ...perspective,
    sourceTeam: normalizeTeamSlug(perspective.sourceTeam),
    primaryTeam: normalizeTeamSlug(perspective.primaryTeam),
    partnerTeam: normalizeTeamSlug(perspective.partnerTeam),
  }));
}

function normalizeKey(key) {
  if (!key) return "";

  const parts = String(key).split("|");

  return parts
    .map((part) => {
      const slug = toSlug(part);
      return TEAM_ALIAS_MAP[slug] || part;
    })
    .join("|");
}

function rebuildDateTeamsKey(trade) {
  const tradeDate = clean(trade.tradeDate || trade.date);
  const teams = normalizeTeamArray(trade.teams || []);
  return `${tradeDate}|${teams.join("|")}`;
}

function main() {
  if (!fs.existsSync(TRADES_FILE)) {
    console.error(`Could not find trades file: ${TRADES_FILE}`);
    process.exit(1);
  }

  const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

  if (!Array.isArray(trades)) {
    console.error("trades.json is not an array.");
    process.exit(1);
  }

  const report = [];
  let changedTrades = 0;

  const normalizedTrades = trades.map((trade) => {
    const before = {
      slug: trade.slug,
      teams: trade.teams,
      dateTeamsKey: trade.dateTeamsKey,
      canonicalKey: trade.canonicalKey,
      sourceTeams: trade.sourceTeams,
      gradeTeams: Object.keys(trade.grades || {}),
      assetTeams: Object.keys(trade.assetsReceived || {}),
    };

    const next = {
      ...trade,
      teams: normalizeTeamArray(trade.teams || []),
      assetsReceived: normalizeAssetMap(trade.assetsReceived || {}),
      grades: normalizeGrades(trade.grades || {}),
      sourceTeams: normalizeTeamArray(trade.sourceTeams || []),
      perspectives: normalizePerspectives(trade.perspectives || []),
    };

    next.dateTeamsKey = rebuildDateTeamsKey(next);
    next.canonicalKey = normalizeKey(next.canonicalKey);

    const after = {
      slug: next.slug,
      teams: next.teams,
      dateTeamsKey: next.dateTeamsKey,
      canonicalKey: next.canonicalKey,
      sourceTeams: next.sourceTeams,
      gradeTeams: Object.keys(next.grades || {}),
      assetTeams: Object.keys(next.assetsReceived || {}),
    };

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changedTrades++;
      report.push({ slug: trade.slug, before, after });
    }

    return next;
  });

  fs.writeFileSync(TRADES_FILE, JSON.stringify(normalizedTrades, null, 2));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log(`Normalized team aliases.`);
  console.log(`Trades scanned: ${trades.length}`);
  console.log(`Trades changed: ${changedTrades}`);
  console.log(`Saved trades to ${TRADES_FILE}`);
  console.log(`Saved report to ${REPORT_FILE}`);
}

main();