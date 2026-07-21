const freezeRecords = (records) =>
  Object.freeze(
    records.map((record) => Object.freeze({ ...record }))
  );

export const CURRENT_NFL_TEAMS = freezeRecords([
  { name: "Arizona Cardinals", slug: "arizona-cardinals" },
  { name: "Atlanta Falcons", slug: "atlanta-falcons" },
  { name: "Baltimore Ravens", slug: "baltimore-ravens" },
  { name: "Buffalo Bills", slug: "buffalo-bills" },
  { name: "Carolina Panthers", slug: "carolina-panthers" },
  { name: "Chicago Bears", slug: "chicago-bears" },
  { name: "Cincinnati Bengals", slug: "cincinnati-bengals" },
  { name: "Cleveland Browns", slug: "cleveland-browns" },
  { name: "Dallas Cowboys", slug: "dallas-cowboys" },
  { name: "Denver Broncos", slug: "denver-broncos" },
  { name: "Detroit Lions", slug: "detroit-lions" },
  { name: "Green Bay Packers", slug: "green-bay-packers" },
  { name: "Houston Texans", slug: "houston-texans" },
  { name: "Indianapolis Colts", slug: "indianapolis-colts" },
  { name: "Jacksonville Jaguars", slug: "jacksonville-jaguars" },
  { name: "Kansas City Chiefs", slug: "kansas-city-chiefs" },
  { name: "Las Vegas Raiders", slug: "las-vegas-raiders" },
  { name: "Los Angeles Chargers", slug: "los-angeles-chargers" },
  { name: "Los Angeles Rams", slug: "los-angeles-rams" },
  { name: "Miami Dolphins", slug: "miami-dolphins" },
  { name: "Minnesota Vikings", slug: "minnesota-vikings" },
  { name: "New England Patriots", slug: "new-england-patriots" },
  { name: "New Orleans Saints", slug: "new-orleans-saints" },
  { name: "New York Giants", slug: "new-york-giants" },
  { name: "New York Jets", slug: "new-york-jets" },
  { name: "Philadelphia Eagles", slug: "philadelphia-eagles" },
  { name: "Pittsburgh Steelers", slug: "pittsburgh-steelers" },
  { name: "San Francisco 49ers", slug: "san-francisco-49ers" },
  { name: "Seattle Seahawks", slug: "seattle-seahawks" },
  { name: "Tampa Bay Buccaneers", slug: "tampa-bay-buccaneers" },
  { name: "Tennessee Titans", slug: "tennessee-titans" },
  { name: "Washington Commanders", slug: "washington-commanders" },
]);

export const CURRENT_NFL_TEAM_SLUGS = Object.freeze(
  CURRENT_NFL_TEAMS.map((team) => team.slug)
);

export const LINEAGE_TEAM_ALIASES = freezeRecords([
  {
    name: "Houston Oilers",
    slug: "houston-oilers",
    canonicalSlug: "tennessee-titans",
  },
  {
    name: "Boston Braves / Washington Braves",
    slug: "boston-washington-braves",
    canonicalSlug: "washington-commanders",
  },
]);

export const DEFUNCT_NFL_TEAMS = freezeRecords([
  { name: "Brooklyn Dodgers", slug: "brooklyn-dodgers" },
  { name: "New York Yanks", slug: "new-york-yanks" },
  { name: "Cincinnati Reds", slug: "cincinnati-reds" },
  { name: "New York Yankees", slug: "new-york-yankees" },
  { name: "Rock Island Independents", slug: "rock-island-independents" },
  { name: "Boston / New York Yanks", slug: "boston-new-york-yanks" },
  { name: "Boston Yanks", slug: "boston-yanks" },
  { name: "Brooklyn Rockets", slug: "brooklyn-rockets" },
  { name: "Brooklyn Tigers", slug: "brooklyn-tigers" },
  { name: "Edmonton Eskimos (CFL)", slug: "edmonton-eskimos-cfl" },
  { name: "Milwaukee Badgers", slug: "milwaukee-badgers" },
  { name: "New York Bulldogs", slug: "new-york-bulldogs" },
  { name: "Pottsville Maroons", slug: "pottsville-maroons" },
  { name: "Racine Legion", slug: "racine-legion" },
]);

export const COMPOSITE_TEAM_VALUES = Object.freeze([
  "cardinals-cowboys",
  "cardinals-rams",
  "cowboys-giants",
  "indianapolis-baltimore-colts-dallas-cowboys",
  "los-angeles-st-louis-rams-washington-commanders",
  "philadelphia-eagles-baltimore-ravens",
  "philadelphia-eagles-denver-broncos",
]);

export const MALFORMED_TEAM_VALUES = Object.freeze([
  "atlanta-falcons-multi-team",
  "giants-as-player-to-be-named-later-in-earlier-trade-involving-val-joe-walker",
  "lions-as-compensation-for-ken-russell-in-earlier-trade-involving-oliver-spencer-ollie-spencer-after-russell-left-packers-training-camp",
  "miami-dolphins-multi-team",
  "multi-team-new-york-giants-washington-redskins",
  "multi-team-san-diego-chargers-los-angeles-rams",
  "multi-team-st-louis-cardinals-baltimore-colts",
  "multiple-teams-arizona-st-louis-cardinals",
  "multiple-teams-chicago-bears",
  "multiple-teams-los-angeles-chargers",
  "multiple-teams-unknown-multiple-teams",
  "packers-involving-eric-dickerson",
  "rams-to-complete-earlier-3-team-trade-involving-bill-wade-billy-wade-erich-barnes-lindon-crow-john-guzik",
]);

export const SOURCE_ONLY_QUARANTINE_TEAM_VALUES = Object.freeze([
  "bengals-voided-when-kearney-and-jackson-failed-physicals",
  "bills-rams",
  "cardinals-voided-by-vikings",
  "chicago-fire",
  "chiefs-voided",
  "chiefs-voided-when-kelsey-failed-physical-with-chiefs",
  "oilers-voided-when-altie-taylor-failed-physical",
  "packers-voided-after-james-failed-physical",
  "rams-cancelled-when-sears-decided-to-remain-in-school",
  "seahawks-voided-by-browns-when-turner-failed-physical",
  "seahawks-voided-when-wyman-failed-physical",
  "steelers-after-failing-physical",
  "unknown-team",
]);

const currentTeamBySlug = new Map(
  CURRENT_NFL_TEAMS.map((team) => [team.slug, team])
);
const lineageAliasBySlug = new Map(
  LINEAGE_TEAM_ALIASES.map((team) => [team.slug, team])
);
const defunctTeamBySlug = new Map(
  DEFUNCT_NFL_TEAMS.map((team) => [team.slug, team])
);
const compositeTeamSet = new Set(COMPOSITE_TEAM_VALUES);
const malformedTeamSet = new Set(MALFORMED_TEAM_VALUES);
const quarantineTeamSet = new Set(
  SOURCE_ONLY_QUARANTINE_TEAM_VALUES
);

const unique = (values) => [...new Set(values.filter(Boolean))];

export function normalizeTeamSlug(value) {
  return String(value || "").trim().toLowerCase();
}

export function getCanonicalFranchiseSlug(value) {
  const slug = normalizeTeamSlug(value);

  if (currentTeamBySlug.has(slug)) return slug;

  return lineageAliasBySlug.get(slug)?.canonicalSlug || null;
}

export function getTeamValueClassification(value) {
  const slug = normalizeTeamSlug(value);

  if (currentTeamBySlug.has(slug)) {
    return "canonical-current-franchise";
  }

  if (lineageAliasBySlug.has(slug)) {
    return "direct-lineage-alias";
  }

  if (defunctTeamBySlug.has(slug)) {
    return "defunct-franchise-historical-archive";
  }

  if (compositeTeamSet.has(slug)) {
    return "composite-multi-franchise-data-error";
  }

  if (malformedTeamSet.has(slug)) {
    return "malformed-or-contaminated-data-error";
  }

  if (quarantineTeamSet.has(slug)) {
    return "source-only-quarantine";
  }

  return "unclassified";
}

const formatSlug = (slug) =>
  String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((word) => {
      if (word === "49ers") return "49ers";
      if (word === "cfl") return "CFL";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");

export function getTeamDisplayName(value) {
  const slug = normalizeTeamSlug(value);

  return (
    currentTeamBySlug.get(slug)?.name ||
    lineageAliasBySlug.get(slug)?.name ||
    defunctTeamBySlug.get(slug)?.name ||
    formatSlug(slug)
  );
}

export function getTeamArchiveSourceSlugs(routeSlug) {
  const slug = normalizeTeamSlug(routeSlug);

  if (currentTeamBySlug.has(slug)) {
    return Object.freeze([
      slug,
      ...LINEAGE_TEAM_ALIASES
        .filter((alias) => alias.canonicalSlug === slug)
        .map((alias) => alias.slug),
    ]);
  }

  if (
    defunctTeamBySlug.has(slug) ||
    compositeTeamSet.has(slug) ||
    malformedTeamSet.has(slug)
  ) {
    return Object.freeze([slug]);
  }

  return Object.freeze([]);
}

export function getTradeArchiveTeamSlug(trade, routeSlug) {
  const tradeTeams = Array.isArray(trade?.teams)
    ? trade.teams.map(normalizeTeamSlug)
    : [];
  const archiveSourceSlugs = getTeamArchiveSourceSlugs(routeSlug);

  return (
    archiveSourceSlugs.find((slug) => tradeTeams.includes(slug)) ||
    null
  );
}

export function tradeBelongsToTeamArchive(trade, routeSlug) {
  return Boolean(getTradeArchiveTeamSlug(trade, routeSlug));
}

export function getTeamArchiveTrades(trades = [], routeSlug) {
  return trades.filter((trade) =>
    tradeBelongsToTeamArchive(trade, routeSlug)
  );
}

export function getTeamRouteSlug(value) {
  const slug = normalizeTeamSlug(value);
  const canonicalSlug = getCanonicalFranchiseSlug(slug);

  if (canonicalSlug) return canonicalSlug;

  if (
    defunctTeamBySlug.has(slug) ||
    compositeTeamSet.has(slug) ||
    malformedTeamSet.has(slug)
  ) {
    return slug;
  }

  return null;
}

export function getPublicTeamRouteSlugs(publicTrades = []) {
  const routeSlugs = new Set(CURRENT_NFL_TEAM_SLUGS);

  for (const trade of publicTrades) {
    for (const team of Array.isArray(trade?.teams) ? trade.teams : []) {
      const routeSlug = getTeamRouteSlug(team);

      if (routeSlug) routeSlugs.add(routeSlug);
    }
  }

  return [...routeSlugs].sort();
}

export function getCurrentFranchiseSlugsForTrade(trade) {
  return unique(
    (Array.isArray(trade?.teams) ? trade.teams : [])
      .map(getCanonicalFranchiseSlug)
  );
}

export function normalizeTradeForCurrentFranchises(trade) {
  const teams = getCurrentFranchiseSlugsForTrade(trade);
  const grades = {};
  const assetsReceived = {};

  for (const rawTeam of Array.isArray(trade?.teams) ? trade.teams : []) {
    const canonicalSlug = getCanonicalFranchiseSlug(rawTeam);

    if (!canonicalSlug) continue;

    const rawGrade = String(trade?.grades?.[rawTeam] || "").trim();

    if (rawGrade && !grades[canonicalSlug]) {
      grades[canonicalSlug] = rawGrade;
    }

    const rawAssets = Array.isArray(
      trade?.assetsReceived?.[rawTeam]
    )
      ? trade.assetsReceived[rawTeam]
      : [];

    if (rawAssets.length > 0) {
      assetsReceived[canonicalSlug] = [
        ...(assetsReceived[canonicalSlug] || []),
        ...rawAssets,
      ];
    }
  }

  return {
    ...trade,
    teams,
    grades,
    assetsReceived,
  };
}
