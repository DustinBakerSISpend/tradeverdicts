#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { createPrivateNbaQueryService } from "../../src/lib/nba/private-query-service.mjs";

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

const index = buildPrivateQueryIndex({ trades, players, teams });
const service = createPrivateNbaQueryService(index, teams);

assert(index.counts.canonicalTrades === trades.length, "Trade-count indexing failed.");
assert(index.counts.players === players.length, "Player-count indexing failed.");
assert(index.counts.representedTeams > 0, "No represented teams were indexed.");
assert(index.counts.uniqueTradeDates > 0, "No trade dates were indexed.");
assert(
  index.counts.teamTradeMemberships === trades.reduce(
    (sum, trade) => sum + (trade.teams?.length ?? 0),
    0,
  ),
  "Team-membership indexing failed.",
);
assert(
  index.counts.playerTradeReferences === players.reduce(
    (sum, player) => sum + (player.sourceReferences?.length ?? 0),
    0,
  ),
  "Player-reference indexing failed.",
);
assert(index.counts.playerIdentityKeys >= players.length, "Player identity-key indexing failed.");
assert(index.counts.ambiguousExactIdentityKeys === 0, "Exact identity keys must be unambiguous.");

const rui = service.getTradeBySourceTradeId("WAS-2023-0016");
const ayton = service.getTradeBySourceTradeId("WAS-2026-0026");
assert(rui.status === "unique" && rui.trade.perspectiveTeams.length === 2, "Rui shared trade lookup failed.");
assert(ayton.status === "unique" && ayton.trade.perspectiveTeams.length === 2, "Ayton shared trade lookup failed.");

const aj = service.resolvePlayerIdentity("A.J. Johnson");
const ish = service.resolvePlayerIdentity("Ishmael Smith");
const christian = service.resolvePlayerIdentity("Christian");
assert(aj.status === "unique" && aj.player.name === "AJ Johnson", "AJ alias failed.");
assert(ish.status === "unique" && ish.player.name === "Ish Smith", "Ish alias failed.");
assert(christian.status === "not_found", "Excluded annotation resolved as an alias.");

const jones = service.searchPlayers("Jones");
assert(jones.status === "ambiguous" && jones.players.length >= 3, "Jones ambiguity behavior failed.");
assert(service.getTradesByPlayerIdentity("Dillon Jones").count >= 3, "Dillon Jones trade count failed.");
assert(service.getTradesByDate("2025-02-06").count >= 3, "Date query failed.");
assert(service.getTradesByDate("1999-01-01").status === "not_found", "Zero-result date behavior failed.");
assert(service.getTradesByTeam("WAS").count >= 27, "Team abbreviation query failed.");
assert(service.getTradesByTeam("Los Angeles Lakers").count >= 2, "Team-name query failed.");

for (const trade of trades) {
  assert(
    trade.publishStatus === "private" &&
    trade.reviewStatus === "manual-review" &&
    trade.indexEligible === false &&
    trade.adEligible === false &&
    trade.publicationReady === false,
    `${trade.sourceTradeId}: trade privacy failure.`,
  );
}
for (const player of players) {
  assert(
    player.publishStatus === "private" &&
    player.indexEligible === false &&
    player.adEligible === false &&
    player.publicationReady === false,
    `${player.name}: player privacy failure.`,
  );
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "2O",
  ...index.counts,
  ruiPerspectiveTeams: rui.trade.perspectiveTeams.length,
  aytonPerspectiveTeams: ayton.trade.perspectiveTeams.length,
  ambiguousJonesPlayers: jones.players.length,
  zeroResultBehavior: "PASS",
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  teamRegistrySha256: sha256(teamBytes),
  repositoryWrites: false,
  canonicalStoreWrites: false,
  playerStoreWrites: false,
  routesCreated: false,
}, null, 2));
