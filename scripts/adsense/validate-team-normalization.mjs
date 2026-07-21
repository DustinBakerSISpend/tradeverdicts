import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.cwd();

const readJson = (relativePath) =>
  JSON.parse(
    fs
      .readFileSync(path.join(repo, relativePath), "utf8")
      .replace(/^\uFEFF/, "")
  );

const readSource = (relativePath) =>
  fs.readFileSync(path.join(repo, relativePath), "utf8");

const registry = await import(
  pathToFileURL(
    path.join(repo, "src", "utils", "teamRegistry.js")
  ).href
);

const publicRecords = await import(
  pathToFileURL(
    path.join(repo, "src", "utils", "publicRecords.js")
  ).href
);

const teamStatsModule = await import(
  pathToFileURL(
    path.join(repo, "src", "utils", "teamStats.js")
  ).href
);

const {
  COMPOSITE_TEAM_VALUES,
  CURRENT_NFL_TEAMS,
  CURRENT_NFL_TEAM_SLUGS,
  DEFUNCT_NFL_TEAMS,
  LINEAGE_TEAM_ALIASES,
  MALFORMED_TEAM_VALUES,
  SOURCE_ONLY_QUARANTINE_TEAM_VALUES,
  getCanonicalFranchiseSlug,
  getCurrentFranchiseSlugsForTrade,
  getPublicTeamRouteSlugs,
  getTeamArchiveSourceSlugs,
  getTeamArchiveTrades,
  getTeamRouteSlug,
  getTeamValueClassification,
  normalizeTradeForCurrentFranchises,
} = registry;

const { getPublicTrades } = publicRecords;
const { getTeamStats } = teamStatsModule;

const trades = readJson("src/data/nfl/trades.json");
const publicTrades = getPublicTrades(trades);
const publicRawValues = new Set(
  publicTrades.flatMap((trade) =>
    Array.isArray(trade.teams) ? trade.teams : []
  )
);
const rawValues = new Set();

for (const trade of trades) {
  for (const value of [
    ...(Array.isArray(trade.teams) ? trade.teams : []),
    ...Object.keys(trade.grades || {}),
    ...Object.keys(trade.assetsReceived || {}),
  ]) {
    const slug = String(value || "").trim();
    if (slug) rawValues.add(slug);
  }
}

const routeSlugs = getPublicTeamRouteSlugs(publicTrades);
const routeSlugSet = new Set(routeSlugs);
const errors = [];
const expect = (condition, message) => {
  if (!condition) errors.push(message);
};

expect(trades.length === 5391, `Expected 5,391 trades; found ${trades.length}.`);
expect(publicTrades.length === 4991, `Expected 4,991 public trades; found ${publicTrades.length}.`);
expect(rawValues.size === 81, `Expected 81 raw team values; found ${rawValues.size}.`);
expect(publicRawValues.size === 65, `Expected 65 public raw team values; found ${publicRawValues.size}.`);
expect(CURRENT_NFL_TEAMS.length === 32, "Expected 32 current teams.");
expect(CURRENT_NFL_TEAM_SLUGS.length === 32, "Expected 32 current slugs.");
expect(LINEAGE_TEAM_ALIASES.length === 2, "Expected 2 lineage aliases.");
expect(DEFUNCT_NFL_TEAMS.length === 14, "Expected 14 defunct archives.");
expect(COMPOSITE_TEAM_VALUES.length === 7, "Expected 7 composite values.");
expect(MALFORMED_TEAM_VALUES.length === 13, "Expected 13 malformed values.");
expect(SOURCE_ONLY_QUARANTINE_TEAM_VALUES.length === 13, "Expected 13 quarantine values.");
expect(routeSlugs.length === 63, `Expected 63 normalized routes; found ${routeSlugs.length}.`);

for (const value of rawValues) {
  expect(
    getTeamValueClassification(value) !== "unclassified",
    `Unclassified team value: ${value}`
  );
}

expect(
  getCanonicalFranchiseSlug("houston-oilers") === "tennessee-titans",
  "Houston Oilers lineage mapping failed."
);
expect(
  getCanonicalFranchiseSlug("boston-washington-braves") === "washington-commanders",
  "Boston/Washington Braves lineage mapping failed."
);
expect(!routeSlugSet.has("houston-oilers"), "Houston Oilers alias route is still generated.");
expect(!routeSlugSet.has("boston-washington-braves"), "Boston Braves alias route is still generated.");

for (const slug of CURRENT_NFL_TEAM_SLUGS) {
  expect(routeSlugSet.has(slug), `Missing current route: ${slug}`);
}

for (const value of publicRawValues) {
  expect(Boolean(getTeamRouteSlug(value)), `Public team value has no route policy: ${value}`);
}

for (const value of SOURCE_ONLY_QUARANTINE_TEAM_VALUES) {
  expect(getTeamRouteSlug(value) === null, `Quarantine value became routable: ${value}`);
  expect(!publicRawValues.has(value), `Quarantine value became public: ${value}`);
}

const oilersTrades = getTeamArchiveTrades(publicTrades, "tennessee-titans")
  .filter((trade) => trade.teams?.includes("houston-oilers"));
const bravesTrades = getTeamArchiveTrades(publicTrades, "washington-commanders")
  .filter((trade) => trade.teams?.includes("boston-washington-braves"));

expect(oilersTrades.length === 1, `Expected one Oilers lineage trade; found ${oilersTrades.length}.`);
expect(bravesTrades.length === 1, `Expected one Braves lineage trade; found ${bravesTrades.length}.`);
expect(
  getTeamArchiveSourceSlugs("tennessee-titans").includes("houston-oilers"),
  "Titans archive does not include Houston Oilers."
);
expect(
  getTeamArchiveSourceSlugs("washington-commanders").includes("boston-washington-braves"),
  "Commanders archive does not include Boston/Washington Braves."
);

const directTitans = publicTrades.filter((trade) =>
  trade.teams?.includes("tennessee-titans")
).length;
const directCommanders = publicTrades.filter((trade) =>
  trade.teams?.includes("washington-commanders")
).length;

expect(
  getTeamStats(publicTrades, "tennessee-titans").total ===
    directTitans + oilersTrades.length,
  "Titans statistics do not aggregate Oilers history."
);
expect(
  getTeamStats(publicTrades, "washington-commanders").total ===
    directCommanders + bravesTrades.length,
  "Commanders statistics do not aggregate Braves history."
);

for (const trade of publicTrades) {
  const currentTeams = getCurrentFranchiseSlugsForTrade(trade);
  const normalized = normalizeTradeForCurrentFranchises(trade);

  expect(
    JSON.stringify(currentTeams) === JSON.stringify(normalized.teams),
    `Normalized current-team list mismatch: ${trade.slug}`
  );

  for (const team of normalized.teams) {
    expect(
      CURRENT_NFL_TEAM_SLUGS.includes(team),
      `Non-current normalized team: ${trade.slug} -> ${team}`
    );
  }
}

const sourceChecks = [
  ["src/pages/teams/index.astro", "CURRENT_NFL_TEAMS"],
  ["src/pages/teams/[team].astro", "getPublicTeamRouteSlugs"],
  ["src/pages/teams/[team].astro", "getTeamArchiveTrades"],
  ["src/pages/team-to-team-trade-history.astro", "CURRENT_NFL_TEAMS"],
  ["src/pages/api/team-trade-history.json.js", "normalizeTradeForCurrentFranchises"],
  ["src/pages/trades/[slug].astro", "getTeamRouteSlug"],
  ["src/pages/search.astro", '["boston braves", "washington commanders"]'],
  ["src/pages/search.astro", "if (base.includes(c))"],
];

for (const [file, token] of sourceChecks) {
  expect(readSource(file).includes(token), `${file} is missing ${token}`);
}

expect(
  !readSource("src/pages/teams/index.astro").includes("const NFL_TEAMS = ["),
  "Team directory still has a duplicate registry."
);
expect(
  !readSource("src/pages/team-to-team-trade-history.astro").includes("const teamOptions = ["),
  "Team-history page still has a duplicate registry."
);
expect(
  !readSource("src/pages/api/team-trade-history.json.js").includes("CURRENT_TEAM_SET"),
  "Team-history API still discards aliases with exact matching."
);

const redirects = readSource("public/_redirects").split(/\r?\n/);
for (const redirect of [
  "/teams/houston-oilers/ /teams/tennessee-titans/ 301",
  "/teams/boston-washington-braves/ /teams/washington-commanders/ 301",
]) {
  expect(
    redirects.filter((line) => line.trim() === redirect).length === 1,
    `Expected exactly one redirect: ${redirect}`
  );
}

if (errors.length > 0) {
  console.error(JSON.stringify({ status: "FAILED", errors }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "PASSED",
      counts: {
        tradeRecords: trades.length,
        publicTrades: publicTrades.length,
        rawTeamValues: rawValues.size,
        publicRawTeamValues: publicRawValues.size,
        normalizedTeamRoutes: routeSlugs.length,
        currentFranchiseRoutes: CURRENT_NFL_TEAMS.length,
        lineageAliases: LINEAGE_TEAM_ALIASES.length,
        defunctHistoricalRoutes: DEFUNCT_NFL_TEAMS.length,
        compositeReviewValues: COMPOSITE_TEAM_VALUES.length,
        malformedReviewValues: MALFORMED_TEAM_VALUES.length,
        sourceOnlyQuarantineValues: SOURCE_ONLY_QUARANTINE_TEAM_VALUES.length,
        titansLineageTrades: oilersTrades.length,
        commandersLineageTrades: bravesTrades.length,
      },
    },
    null,
    2
  )
);
