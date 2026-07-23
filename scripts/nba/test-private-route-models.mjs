#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const args = parseArgs(process.argv);
for (const required of ["trades-json", "players-json", "teams-json"]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [tradeBytes, playerBytes, teamBytes] = await Promise.all([
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
]);

const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const result = buildPrivateRouteModels({ trades, players, teams });

assert(result.counts.routeModels === 123, "Expected 123 route models.");
assert(result.counts.indexRouteModels === 4, "Expected four index models.");
assert(result.counts.tradeDetailModels === 27, "Expected 27 trade models.");
assert(result.counts.playerDetailModels === 67, "Expected 67 player models.");
assert(result.counts.teamDetailModels === 25, "Expected 25 team models.");
assert(result.counts.internalLinks === 434, "Expected 434 internal links.");
assert(result.counts.indexToDetailLinks === 119, "Expected 119 index-to-detail links.");
assert(result.counts.tradeToTeamLinks === 66, "Expected 66 trade-to-team links.");
assert(result.counts.tradeToPlayerLinks === 90, "Expected 90 trade-to-player links.");
assert(result.counts.playerToTradeLinks === 90, "Expected 90 player-to-trade links.");
assert(result.counts.teamToTradeLinks === 66, "Expected 66 team-to-trade links.");
assert(result.counts.sharedPerspectiveTradeModels === 2, "Expected two shared-perspective trade models.");
assert(result.counts.privateRouteModels === 123, "Every model must be private.");
assert(result.counts.noindexRouteModels === 123, "Every model must be noindex.");
assert(result.counts.adFreeRouteModels === 123, "Every model must be ad-free.");
assert(result.counts.sitemapExcludedRouteModels === 123, "Every model must be sitemap-excluded.");
assert(result.counts.navigationExcludedRouteModels === 123, "Every model must be nav-excluded.");
assert(result.counts.routeCreatedModels === 0, "No routes may be created.");
assert(result.counts.duplicatePaths === 0, "Duplicate route paths exist.");
assert(result.counts.brokenLinks === 0, "Broken internal links exist.");
assert(result.counts.crossNamespaceLinks === 0, "A link leaves the /nba namespace.");
assert(result.counts.selfLinks === 0, "Self-links exist.");
assert(result.counts.privacyViolations === 0, "A route model violates privacy.");
assert(result.counts.incompleteModels === 0, "An incomplete route model exists.");

const paths = new Set(result.models.map((model) => model.path));
assert(paths.has("/nba/"), "NBA root model is missing.");
assert(paths.has("/nba/trades/"), "Trade index model is missing.");
assert(paths.has("/nba/players/"), "Player index model is missing.");
assert(paths.has("/nba/teams/"), "Team index model is missing.");
assert(!paths.has("/nba/players/ishmael-smith/"), "Alias route was incorrectly created.");
assert(!paths.has("/nba/players/a-j-johnson/"), "Punctuation alias route was incorrectly created.");

for (const model of result.models) {
  assert(model.routeModelReady === true, `${model.path}: model is not ready.`);
  assert(model.privacy.routeCreated === false, `${model.path}: route is marked created.`);
  assert(model.privacy.routeCreationAuthorized === false, `${model.path}: route creation is authorized.`);
  assert(model.privacy.publicationReady === false, `${model.path}: model is publication-ready.`);
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "2P",
  ...result.counts,
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  teamRegistrySha256: sha256(teamBytes),
  repositoryWrites: false,
  canonicalStoreWrites: false,
  playerStoreWrites: false,
  routesCreated: false,
}, null, 2));
