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

  "indianapolis-baltimore-colts": "indianapolis-colts",
"las-vegas-oakland-raiders": "las-vegas-raiders",

"phoenix-arizona-cardinals": "arizona-cardinals",
"st-louis-los-angeles-rams": "los-angeles-rams",
"houston-tennessee-oilers": "tennessee-titans",
"tennessee-oilers-titans": "tennessee-titans",
"los-angeles-san-diego-chargers": "los-angeles-chargers",
"oakland-los-angeles-raiders": "las-vegas-raiders",
"baltimore-indianapolis-colts": "indianapolis-colts",
"arizona-cardinals-st-louis-cardinals": "arizona-cardinals",
"arizona-st-louis-cardinals": "arizona-cardinals",
"boston-new-england-patriots": "new-england-patriots",
"new-england-boston-patriots": "new-england-patriots",
"dallas-texans-kansas-city-chiefs": "kansas-city-chiefs",
"kansas-city-chiefs-dallas-texans": "kansas-city-chiefs",
"houston-oilers-tennessee-titans": "tennessee-titans",
"tennessee-titans-houston-oilers": "tennessee-titans",
"indianapolis-colts-baltimore-colts": "indianapolis-colts",
"new-york-jets-titans": "new-york-jets",
"new-york-titans-jets": "new-york-jets",
"los-angeles-chargers-san-diego-chargers": "los-angeles-chargers",
"san-diego-los-angeles-chargers": "los-angeles-chargers",
"los-angeles-rams-st-louis-rams": "los-angeles-rams",
"los-angeles-st-louis-rams": "los-angeles-rams",
"las-vegas-raiders-oakland-raiders": "las-vegas-raiders",
"oakland-las-vegas-raiders": "las-vegas-raiders",
"washington-commanders-football-team": "washington-commanders",

  "st-louis-rams": "los-angeles-rams",
  "los-angeles-raiders": "las-vegas-raiders",
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

function normalizeAssetText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/overall/g, "")
    .replace(/subsequently traded/g, "")
    .replace(/became/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeAssets(a = [], b = []) {
  const merged = [];
  const seen = new Set();

  for (const item of [...(a || []), ...(b || [])]) {
    if (!item || !item.asset) continue;
    const key = `${item.type || ""}|${normalizeAssetText(item.asset)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function normalizeTeamArray(teams = []) {
  return Array.from(new Set((teams || []).map(normalizeTeamSlug).filter(Boolean))).sort();
}

function normalizeAssetMap(assetMap = {}) {
  const normalized = {};

  for (const [team, assets] of Object.entries(assetMap || {})) {
    const normalizedTeam = normalizeTeamSlug(team);
    if (!normalizedTeam) continue;

    normalized[normalizedTeam] = mergeAssets(
      normalized[normalizedTeam] || [],
      Array.isArray(assets) ? assets : []
    );
  }

  return normalized;
}

function gradeRank(value) {
  const ranks = {
    "A+": 13, A: 12, "A-": 11,
    "B+": 10, B: 9, "B-": 8,
    "C+": 7, C: 6, "C-": 5,
    "D+": 4, D: 3, "D-": 2,
    F: 1,
  };

  return ranks[clean(value)] || 0;
}

function normalizeGrades(grades = {}) {
  const normalized = {};

  for (const [team, grade] of Object.entries(grades || {})) {
    const normalizedTeam = normalizeTeamSlug(team);
    if (!normalizedTeam) continue;

    if (!normalized[normalizedTeam]) {
      normalized[normalizedTeam] = grade;
      continue;
    }

    // If two alias grades collapse into one team, keep the stronger/nonblank grade.
    if (gradeRank(grade) > gradeRank(normalized[normalizedTeam])) {
      normalized[normalizedTeam] = grade;
    }
  }

  return normalized;
}

function perspectiveKey(perspective) {
  return [
    clean(perspective.sourceTeam),
    clean(perspective.sourceTradeId),
    clean(perspective.primaryTeam),
    clean(perspective.partnerTeam),
    clean(perspective.primaryGrade),
    clean(perspective.partnerGrade),
    clean(perspective.verdict),
  ].join("|");
}

function normalizePerspectives(perspectives = []) {
  const normalized = [];
  const seen = new Set();

  for (const perspective of perspectives || []) {
    const next = {
      ...perspective,
      sourceTeam: normalizeTeamSlug(perspective.sourceTeam),
      primaryTeam: normalizeTeamSlug(perspective.primaryTeam),
      partnerTeam: normalizeTeamSlug(perspective.partnerTeam),
    };

    const key = perspectiveKey(next);
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(next);
  }

  return normalized;
}

function normalizeKey(key) {
  if (!key) return "";

  return String(key)
    .split("|")
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
      id: trade.id,
      slug: trade.slug,
      teams: trade.teams,
      dateTeamsKey: trade.dateTeamsKey,
      canonicalKey: trade.canonicalKey,
      sourceTeams: trade.sourceTeams,
      gradeTeams: Object.keys(trade.grades || {}),
      assetTeams: Object.keys(trade.assetsReceived || {}),
      perspectiveTeams: (trade.perspectives || []).map((p) => ({
        sourceTeam: p.sourceTeam,
        primaryTeam: p.primaryTeam,
        partnerTeam: p.partnerTeam,
      })),
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
      id: next.id,
      slug: next.slug,
      teams: next.teams,
      dateTeamsKey: next.dateTeamsKey,
      canonicalKey: next.canonicalKey,
      sourceTeams: next.sourceTeams,
      gradeTeams: Object.keys(next.grades || {}),
      assetTeams: Object.keys(next.assetsReceived || {}),
      perspectiveTeams: (next.perspectives || []).map((p) => ({
        sourceTeam: p.sourceTeam,
        primaryTeam: p.primaryTeam,
        partnerTeam: p.partnerTeam,
      })),
    };

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changedTrades++;
      report.push({ id: trade.id, slug: trade.slug, before, after });
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