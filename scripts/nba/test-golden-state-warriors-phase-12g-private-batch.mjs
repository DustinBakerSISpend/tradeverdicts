#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrivateRelationshipGraph } from "../../src/lib/nba/build-private-relationship-graph.mjs";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";
import { createNbaTeamRegistry } from "../../src/lib/nba/team-registry.mjs";
import { validateCanonicalNbaTrade } from "../../src/lib/nba/validate-canonical-trade.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function clean(value) { return String(value ?? "").trim(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function uniqueSorted(values) { return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "en")); }
function tradeId(trade) { return clean(trade.id ?? trade.tradeId); }
function playerId(player) { return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id); }
function perspectiveSourceIds(trade) {
  if (Array.isArray(trade.perspectives)) {
    return trade.perspectives.map((p) => clean(p?.sourceTradeId)).filter(Boolean);
  }
  return Object.values(trade.perspectives ?? {}).flatMap((p) => {
    const explicit = clean(p?.sourceTradeId);
    if (explicit) return [explicit];
    const submission = clean(p?.sourceSubmissionId);
    const match = submission.match(/(GSW-\d{4}-\d{4})$/u);
    return match ? [match[1]] : [];
  });
}
function sourcePerspectiveCount(trade, team) {
  if (Array.isArray(trade.perspectives)) {
    return trade.perspectives.filter((p) => clean(p?.sourceTeam ?? p?.teamId ?? p?.team ?? p?.perspectiveTeam) === team).length;
  }
  return trade.perspectives && typeof trade.perspectives === "object" && Object.prototype.hasOwnProperty.call(trade.perspectives, team) ? 1 : 0;
}
function immutableTradeProjection(trade) {
  return {
    id: trade.id,
    tradeId: trade.tradeId,
    sourceTradeId: trade.sourceTradeId,
    canonicalKey: trade.canonicalKey,
    slug: trade.slug,
    league: trade.league,
    tradeDate: trade.tradeDate,
    date: trade.date,
    seasonLabel: trade.seasonLabel,
    season: trade.season,
    teams: trade.teams,
    assetLedger: trade.assetLedger,
    assetsReceived: trade.assetsReceived,
    assetsSent: trade.assetsSent,
    assetsSentByTeam: trade.assetsSentByTeam,
    createdAt: trade.createdAt,
  };
}
function canonicalIdForSource(sourceId) {
  const match = clean(sourceId).match(/^GSW-(\d{4})-(\d{4})$/u);
  assert(match, `Invalid source Trade ID ${sourceId}`);
  return `nba-trade-gsw-${match[1]}-${match[2]}`;
}

const args = parseArgs(process.argv);
for (const required of [
  "records-json", "partition-json", "player-shells-csv", "relationships-csv", "dependency-seeds-csv",
  "receipt-json", "trades-json", "players-json", "teams-json", "contract-md", "output-json",
  "expected-records-sha256", "expected-partition-sha256", "expected-player-shells-sha256",
  "expected-relationships-sha256", "expected-dependency-seeds-sha256", "expected-contract-sha256",
  "expected-canonical-store-sha256", "expected-player-store-sha256", "expected-team-store-sha256",
  "expected-receipt-sha256",
]) assert(args[required], `Missing --${required}`);

const [recordsBytes, partitionBytes, shellBytes, relationshipBytes, dependencyBytes, receiptBytes, tradeBytes, playerBytes, teamBytes, contractBytes] = await Promise.all([
  readFile(args["records-json"]), readFile(args["partition-json"]), readFile(args["player-shells-csv"]),
  readFile(args["relationships-csv"]), readFile(args["dependency-seeds-csv"]), readFile(args["receipt-json"]),
  readFile(args["trades-json"]), readFile(args["players-json"]), readFile(args["teams-json"]), readFile(args["contract-md"]),
]);
const records = JSON.parse(recordsBytes.toString("utf8"));
const partition = JSON.parse(partitionBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

for (const [actual, expected, label] of [
  [sha256(recordsBytes), args["expected-records-sha256"], "records"],
  [sha256(partitionBytes), args["expected-partition-sha256"], "partition"],
  [sha256(shellBytes), args["expected-player-shells-sha256"], "player shells"],
  [sha256(relationshipBytes), args["expected-relationships-sha256"], "relationships"],
  [sha256(dependencyBytes), args["expected-dependency-seeds-sha256"], "dependency seeds"],
  [sha256(contractBytes), args["expected-contract-sha256"], "contract"],
  [sha256(tradeBytes), args["expected-canonical-store-sha256"], "canonical store"],
  [sha256(playerBytes), args["expected-player-store-sha256"], "player store"],
  [sha256(teamBytes), args["expected-team-store-sha256"], "team store"],
  [sha256(receiptBytes), args["expected-receipt-sha256"], "receipt"],
]) assert(actual === expected, `${label} hash drifted: ${actual} !== ${expected}.`);

assert(records.result === "PASS" && records.records.length === 221, "Invalid reconciled records.");
assert(partition.result === "PASS" && partition.phase === "12F", "Invalid Phase 12F partition.");
assert(receipt.result === "PASS" && receipt.phase === "12G", "Invalid Phase 12G receipt.");
assert(Array.isArray(trades) && trades.length === 1716, "Expected 1,716 trades.");
assert(Array.isArray(players) && players.length === 2566, "Expected 2,566 players.");
assert(Array.isArray(teams) && teams.length === 52, "Expected 52 teams.");

for (const [actual, expected, label] of [
  [receipt.readyPackages, 199, "ready packages"],
  [receipt.heldPackages, 16, "held packages"],
  [receipt.linkedOrVoidedExclusions, 6, "linked/voided exclusions"],
  [receipt.canonicalTradesCreated, 149, "canonical creates"],
  [receipt.perspectivesAppended, 50, "perspective appends"],
  [receipt.dateCollisionDistinctCreates, 20, "same-date distinct creates"],
  [receipt.frozenPlayerShellProposals, 177, "frozen shell proposals"],
  [receipt.playerShellsCreated, 164, "created player shells"],
  [receipt.heldOnlyPlayerShellsDeferred, 13, "deferred player shells"],
  [receipt.relationshipReferencesAdded, 479, "relationship references"],
  [receipt.matchedExistingAssetReferences, 471, "matched asset references"],
  [receipt.syntheticPerspectiveAssetReferences, 8, "synthetic perspective references"],
  [receipt.sourceReferencesAdded, 415, "source references"],
  [receipt.postImportCanonicalTrades, 1716, "post-import trades"],
  [receipt.postImportPlayers, 2566, "post-import players"],
  [receipt.postImportTeams, 52, "post-import teams"],
  [receipt.teamRegistryEntriesAdded, 0, "team registrations"],
  [receipt.repositoryDataWrites, 3, "repository data writes"],
  [receipt.automaticIdentityMerges, 0, "automatic identity merges"],
  [receipt.automaticCanonicalMerges, 0, "automatic canonical merges"],
  [receipt.automaticPlayerCreates, 0, "automatic player creates"],
  [receipt.automaticRoutes, 0, "automatic routes"],
  [receipt.automaticTeamRegistrations, 0, "automatic team registrations"],
  [receipt.heldPackageImports, 0, "held imports"],
]) assert(actual === expected, `Receipt ${label} drifted: ${actual} !== ${expected}.`);
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(receipt.pushPerformed === false, "A push was recorded.");
assert(receipt.deployPerformed === false, "A deployment was recorded.");
assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Receipt canonical hash drifted.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Receipt player hash drifted.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Receipt team hash drifted.");

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
assert(tradeMap.size === trades.length, "Duplicate canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");
assert(new Set(trades.map((trade) => trade.slug)).size === trades.length, "Duplicate canonical trade slug.");
assert(new Set(players.map((player) => player.slug)).size === players.length, "Duplicate player slug.");

const registry = createNbaTeamRegistry(teams);
const invalidNewTrades = [];
for (const canonicalId of receipt.importedCanonicalTradeIds) {
  const trade = tradeMap.get(canonicalId);
  assert(trade, `Created canonical trade is missing: ${canonicalId}`);
  const result = validateCanonicalNbaTrade(trade, registry);
  if (!result.valid) invalidNewTrades.push({ canonicalId, errors: result.errors });
}
assert(invalidNewTrades.length === 0, `Created canonical validation failed: ${JSON.stringify(invalidNewTrades.slice(0, 5))}`);

for (const packageRecord of partition.finalReadyPackages) {
  const sourceId = clean(packageRecord.tradeId);
  const targetId = packageRecord.importAction === "canonical-create" ? canonicalIdForSource(sourceId) : clean(packageRecord.canonicalId);
  const trade = tradeMap.get(targetId);
  assert(trade, `${sourceId}: final target trade is missing.`);
  assert(sourcePerspectiveCount(trade, "golden-state-warriors") === 1, `${sourceId}: Golden State perspective count drifted.`);
  assert(trade.publishStatus === "private", `${sourceId}: trade is not private.`);
  assert(trade.indexEligible === false && trade.adEligible === false && trade.publicationReady === false, `${sourceId}: trade exposure flags drifted.`);
}
for (const [canonicalId, expectedHash] of Object.entries(receipt.protectedAppendProjectionHashes)) {
  const trade = tradeMap.get(canonicalId);
  assert(trade, `Protected append target is missing: ${canonicalId}`);
  assert(sha256(canonicalJson(immutableTradeProjection(trade))) === expectedHash, `${canonicalId}: protected append fields drifted.`);
}
const forbiddenSourceIds = uniqueSorted([...receipt.heldSourceTradeIds, ...receipt.linkedOrVoidedExcludedSourceTradeIds]);
for (const sourceId of forbiddenSourceIds) {
  assert(!trades.some((trade) => clean(trade.sourceTradeId) === sourceId), `${sourceId}: forbidden standalone import exists.`);
  assert(!trades.some((trade) => perspectiveSourceIds(trade).includes(sourceId)), `${sourceId}: forbidden perspective import exists.`);
}
for (const playerIdValue of receipt.importedPlayerIds) {
  const player = playerMap.get(playerIdValue);
  assert(player, `Imported player is missing: ${playerIdValue}`);
  assert(player.privateOnly === true && player.publishStatus === "private", `${playerIdValue}: player is not private.`);
  assert(player.indexEligible === false && player.adEligible === false && player.publicationReady === false, `${playerIdValue}: player exposure flags drifted.`);
}
for (const playerIdValue of receipt.deferredPlayerIds) {
  assert(!playerMap.has(playerIdValue), `Held-only player shell was imported: ${playerIdValue}`);
}
const relationshipOwner = new Map();
for (const player of players) {
  for (const reference of player.relationshipReferences ?? []) {
    const id = clean(reference.relationshipId);
    if (!id) continue;
    assert(!relationshipOwner.has(id), `Relationship ID is owned by multiple players: ${id}`);
    relationshipOwner.set(id, player.id);
  }
}
assert(receipt.relationshipIds.length === 479, "Receipt relationship ID set drifted.");
for (const id of receipt.relationshipIds) assert(relationshipOwner.has(id), `Frozen relationship is missing: ${id}`);

const graph = buildPrivateRelationshipGraph({ trades, players, teams });
assert(graph.counts.extraPlayerReferences === 0, "Extra source references exist.");
assert(graph.counts.invalidPlayerReferences === 0, "Invalid source references exist.");
assert(graph.counts.duplicateReferenceOwnership === 0, "Duplicate source-reference ownership exists.");
assert(graph.counts.invalidTradeTeams === 0, "Unknown trade-team memberships exist.");
const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });
assert(query.counts.canonicalTrades === 1716 && query.counts.players === 2566, "Private-query counts drifted.");
assert(query.counts.privateTrades === 1716 && query.counts.privatePlayers === 2566, "Private-query exposure drifted.");
assert(query.counts.playerTradeReferences === 1630, "Private-query player-reference count drifted.");
assert(routes.counts.routeModels === 4338, "Private route-model count drifted.");
assert(routes.counts.duplicatePaths === 0 && routes.counts.brokenLinks === 0, "Private route integrity failed.");
assert(routes.counts.privacyViolations === 0 && routes.counts.routeCreatedModels === 0, "Private route exposure failed.");

const result = {
  result: "PASS",
  phase: "12G",
  mode: "GUARDED_PRIVATE_IMPORT_AUDIT",
  counts: {
    canonicalTrades: trades.length,
    players: players.length,
    teams: teams.length,
    readyPackages: receipt.readyPackages,
    heldPackages: receipt.heldPackages,
    canonicalTradesCreated: receipt.canonicalTradesCreated,
    perspectivesAppended: receipt.perspectivesAppended,
    playerShellsCreated: receipt.playerShellsCreated,
    deferredPlayerShells: receipt.heldOnlyPlayerShellsDeferred,
    relationshipReferencesAdded: receipt.relationshipReferencesAdded,
    sourceReferencesAdded: receipt.sourceReferencesAdded,
    privateQueryPlayerReferences: query.counts.playerTradeReferences,
    routeModels: routes.counts.routeModels,
    internalLinks: routes.counts.internalLinks,
  },
  hashes: {
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
    receiptSha256: sha256(receiptBytes),
  },
  safety: {
    heldPackageImports: 0,
    automaticCanonicalMerges: 0,
    automaticIdentityMerges: 0,
    automaticRoutes: 0,
    teamRegistryWrites: 0,
    publicationAuthorized: false,
    pushPerformed: false,
    deployPerformed: false,
  },
};
await mkdir(path.dirname(path.resolve(args["output-json"])), { recursive: true });
await writeFile(args["output-json"], canonicalJson(result));
console.log(JSON.stringify(result, null, 2));
