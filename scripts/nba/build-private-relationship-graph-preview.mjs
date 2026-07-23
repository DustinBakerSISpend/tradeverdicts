#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const args = parseArgs(process.argv);
for (const required of [
  "trades-json",
  "players-json",
  "teams-json",
  "output-json",
  "player-links-csv",
  "team-links-csv",
]) {
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

const expectedCounts = {
  teamNodes: 25,
  tradeNodes: 27,
  playerNodes: 67,
  totalNodes: 119,
  teamTradeEdges: 66,
  playerTradeReferenceEdges: 90,
  totalEdges: 156,
  directPlayerEdges: 70,
  draftRightsEdges: 14,
  draftOutcomeEdges: 6,
  referencedTradeNodes: 27,
  referencedPlayerNodes: 67,
  missingPlayerReferences: 0,
  extraPlayerReferences: 0,
  invalidPlayerReferences: 0,
  duplicateReferenceOwnership: 0,
  invalidTradeTeams: 0,
  orphanPlayerRecords: 0,
  orphanTradeRecords: 0,
};

if (JSON.stringify(graph.counts) !== JSON.stringify(expectedCounts)) {
  throw new Error(`Unexpected relationship-graph counts:\n${JSON.stringify(graph.counts, null, 2)}`);
}

const output = {
  mode: "DRY_RUN_PRIVATE_RELATIONSHIP_GRAPH_PREVIEW_ONLY",
  phase: "2N",
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  teamRegistrySha256: sha256(teamBytes),
  counts: graph.counts,
  nodes: graph.nodes,
  edges: graph.edges,
  indexes: graph.indexes,
  issues: graph.issues,
  repositoryWrites: false,
  canonicalStoreWrites: false,
  playerStoreWrites: false,
  routeCreation: false,
  buildPerformed: false,
  pushPerformed: false,
  deployPerformed: false,
};

await mkdir(path.dirname(args["output-json"]), { recursive: true });
await mkdir(path.dirname(args["player-links-csv"]), { recursive: true });
await mkdir(path.dirname(args["team-links-csv"]), { recursive: true });

await writeFile(args["output-json"], `${JSON.stringify(output, null, 2)}\n`, "utf8");

const playerHeaders = [
  "Edge ID",
  "Player ID",
  "Player",
  "Canonical Trade ID",
  "Source Trade ID",
  "Asset ID",
  "Reference Type",
  "Trade Date",
  "Display Text",
];
const playerRows = graph.edges.playerTradeReference.map((edge) => [
  edge.edgeId,
  edge.playerId,
  edge.playerName,
  edge.canonicalTradeId,
  edge.sourceTradeId,
  edge.assetId,
  edge.referenceType,
  edge.tradeDate,
  edge.displayText,
]);
await writeFile(
  args["player-links-csv"],
  `${[playerHeaders, ...playerRows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
  "utf8",
);

const teamHeaders = [
  "Edge ID",
  "Team",
  "Canonical Trade ID",
  "Source Trade ID",
  "Trade Date",
];
const teamRows = graph.edges.teamTrade.map((edge) => [
  edge.edgeId,
  edge.teamSlug,
  edge.canonicalTradeId,
  edge.sourceTradeId,
  edge.tradeDate,
]);
await writeFile(
  args["team-links-csv"],
  `${[teamHeaders, ...teamRows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
  "utf8",
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2N",
  ...graph.counts,
  repositoryWrites: false,
  canonicalStoreWrites: false,
  playerStoreWrites: false,
}, null, 2));
