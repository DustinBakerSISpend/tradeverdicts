#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseAuditedNbaAssetText } from "../../src/lib/nba/parse-audited-asset-text.mjs";
import { isNonPlayerPlaceholder } from "../../src/lib/nba/preview-player-identity.mjs";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument near ${key}`);
    args[key.slice(2)] = value;
  }
  return args;
}

function assert(value, message) {
  if (!value) throw new Error(message);
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

for (const value of ["trade exception", "traded player exception", "TPE"]) {
  const parsed = parseAuditedNbaAssetText(value);
  assert(parsed.type === "trade_exception", `${value}: must be a trade exception.`);
  assert(!parsed.playerName, `${value}: must not expose a player identity.`);
  assert(isNonPlayerPlaceholder(value) === true, `${value}: identity preview must quarantine it.`);
}

const refusalValues = [
  "Hawks agreed not to exercise their right of first refusal on free agent Billy Paultz",
  "Spurs agreed not to exercise their right of first refusal on free agent Billy Paultz",
  "Knicks agreed to not exercise their right of first refusal on restricted free agent Mike Glenn",
  "Wizards agreed to not exercise their right of first refusal on free agent Gus Williams",
];
for (const value of refusalValues) {
  const parsed = parseAuditedNbaAssetText(value);
  assert(parsed.type === "conditional_asset", `${value}: must be a contractual conditional asset.`);
  assert(!parsed.playerName, `${value}: must not create a player identity.`);
  assert(isNonPlayerPlaceholder(value) === true, `${value}: identity preview must quarantine it.`);
}

const player = parseAuditedNbaAssetText("Dominique Wilkins");
assert(player.type === "player" && player.playerName === "Dominique Wilkins", "Normal player parsing regressed.");

const baselineQuery = buildPrivateQueryIndex({ trades, players, teams });
const baselineRoutes = buildPrivateRouteModels({ trades, players, teams });
assert(baselineQuery.counts.canonicalTrades === trades.length, "Baseline query trade count failed.");
assert(baselineQuery.counts.players === players.length, "Baseline query player count failed.");
assert(baselineRoutes.counts.tradeDetailModels === trades.length, "Baseline trade routes failed.");
assert(baselineRoutes.counts.playerDetailModels === players.length, "Baseline player routes failed.");

const syntheticPlayers = [
  ...players,
  {
    id: "nba-player-scale-proof-one-0000000001",
    league: "nba",
    name: "Scale Proof One",
    normalizedName: "scale proof one",
    slug: "scale-proof-one",
    aliases: [],
    referenceCount: 0,
    sourceTradeCount: 0,
    sourceTradeIds: [],
    canonicalTradeIds: [],
    referenceTypes: [],
    teams: [],
    draftReferences: [],
    sourceReferences: [],
    publishStatus: "private",
    reviewStatus: "identity-imported-links-pending",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  },
  {
    id: "nba-player-scale-proof-two-0000000002",
    league: "nba",
    name: "Scale Proof Two",
    normalizedName: "scale proof two",
    slug: "scale-proof-two",
    aliases: [],
    referenceCount: 0,
    sourceTradeCount: 0,
    sourceTradeIds: [],
    canonicalTradeIds: [],
    referenceTypes: [],
    teams: [],
    draftReferences: [],
    sourceReferences: [],
    publishStatus: "private",
    reviewStatus: "identity-imported-links-pending",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  },
];
const scaleQuery = buildPrivateQueryIndex({ trades, players: syntheticPlayers, teams });
const scaleRoutes = buildPrivateRouteModels({ trades, players: syntheticPlayers, teams });
assert(scaleQuery.counts.players === players.length + 2, "Query layer remains fixed to the pilot player count.");
assert(scaleRoutes.counts.playerDetailModels === players.length + 2, "Route model remains fixed to the pilot player count.");
assert(scaleRoutes.counts.routeModels === baselineRoutes.counts.routeModels + 2, "Route total did not scale by two players.");
assert(scaleRoutes.counts.internalLinks === baselineRoutes.counts.internalLinks + 2, "Player-index links did not scale by two.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "3D2A",
  parserFalseIdentityGuards: 7,
  baselineCanonicalTrades: trades.length,
  baselinePlayers: players.length,
  baselineRouteModels: baselineRoutes.counts.routeModels,
  syntheticPlayers: syntheticPlayers.length,
  syntheticRouteModels: scaleRoutes.counts.routeModels,
  automaticPlayerMerges: 0,
  repositoryDataWrites: 0,
}, null, 2));
