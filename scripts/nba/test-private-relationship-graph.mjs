#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildPrivateRelationshipGraph } from "../../src/lib/nba/build-private-relationship-graph.mjs";

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
const graph = buildPrivateRelationshipGraph({ trades, players, teams });

assert(graph.counts.teamNodes === 25, "Expected 25 represented teams.");
assert(graph.counts.tradeNodes === 27, "Expected 27 trade nodes.");
assert(graph.counts.playerNodes === 67, "Expected 67 player nodes.");
assert(graph.counts.totalNodes === 119, "Expected 119 total nodes.");
assert(graph.counts.teamTradeEdges === 66, "Expected 66 team-trade edges.");
assert(graph.counts.playerTradeReferenceEdges === 90, "Expected 90 player-reference edges.");
assert(graph.counts.totalEdges === 156, "Expected 156 total edges.");
assert(graph.counts.directPlayerEdges === 70, "Expected 70 direct-player edges.");
assert(graph.counts.draftRightsEdges === 14, "Expected 14 draft-rights edges.");
assert(graph.counts.draftOutcomeEdges === 6, "Expected six draft-outcome edges.");
assert(graph.counts.referencedTradeNodes === 27, "Every trade must have a player reference.");
assert(graph.counts.referencedPlayerNodes === 67, "Every player must have a trade reference.");
assert(graph.counts.missingPlayerReferences === 0, "A canonical player reference is missing.");
assert(graph.counts.extraPlayerReferences === 0, "An extra player-store reference exists.");
assert(graph.counts.invalidPlayerReferences === 0, "A player reference is invalid.");
assert(graph.counts.duplicateReferenceOwnership === 0, "A reference belongs to multiple players.");
assert(graph.counts.invalidTradeTeams === 0, "A trade contains an unknown team.");
assert(graph.counts.orphanPlayerRecords === 0, "An orphan player record exists.");
assert(graph.counts.orphanTradeRecords === 0, "An orphan trade record exists.");

for (const player of players) {
  assert(
    graph.indexes.playerToTrades[player.id]?.length > 0,
    `${player.name}: player-to-trade index is empty.`,
  );
}
for (const trade of trades) {
  assert(
    graph.indexes.tradeToPlayers[trade.id]?.length > 0,
    `${trade.sourceTradeId}: trade-to-player index is empty.`,
  );
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "2N",
  ...graph.counts,
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  teamRegistrySha256: sha256(teamBytes),
  repositoryWrites: false,
  canonicalStoreWrites: false,
  playerStoreWrites: false,
}, null, 2));
