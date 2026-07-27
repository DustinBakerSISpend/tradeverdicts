#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error(`Invalid argument near ${key}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
function clean(value) {
  return String(value ?? "").trim();
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function tradeId(trade) {
  return clean(trade.id ?? trade.tradeId);
}
function playerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id);
}
function teamSlug(team) {
  return clean(team.slug ?? team.id ?? team.teamId);
}
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
function uniqueSorted(values) {
  return unique(values).sort((left, right) =>
    String(left).localeCompare(String(right), "en"),
  );
}
function countTeamMemberships(trades) {
  return trades.reduce(
    (sum, trade) => sum + (Array.isArray(trade.teams) ? trade.teams.length : 0),
    0,
  );
}
function countPlayerTradeReferences(players) {
  return players.reduce(
    (sum, player) => sum + (Array.isArray(player.tradeIds) ? player.tradeIds.length : 0),
    0,
  );
}
function collectTradeTeamSlugs(trades) {
  const output = new Set();
  for (const trade of trades) {
    for (const team of Array.isArray(trade.teams) ? trade.teams : []) {
      if (clean(team)) output.add(clean(team));
    }
    for (const asset of Array.isArray(trade.assetLedger) ? trade.assetLedger : []) {
      if (clean(asset.fromTeam)) output.add(clean(asset.fromTeam));
      if (clean(asset.toTeam)) output.add(clean(asset.toTeam));
    }
  }
  return [...output];
}
function expectedRelationshipRole(identityKind) {
  if (identityKind === "draft-outcome-player") return "pick-became-player";
  if (identityKind === "player-rights") return "draft-rights-player";
  return "traded-player";
}
function expectedReferenceType(role) {
  if (role === "pick-became-player") return "draft_outcome";
  if (role === "draft-rights-player") return "draft_rights";
  return "direct_player";
}

const args = parseArgs(process.argv);
for (const required of [
  "receipt-json",
  "phase8g-partition",
  "reviewed-json",
  "trades-json",
  "players-json",
  "teams-json",
  "contract-md",
]) {
  assert(args[required], `Missing --${required}`);
}

const [receiptBytes, partitionBytes, reviewedBytes, tradeBytes, playerBytes, teamBytes, contractBytes] =
  await Promise.all([
    readFile(args["receipt-json"]),
    readFile(args["phase8g-partition"]),
    readFile(args["reviewed-json"]),
    readFile(args["trades-json"]),
    readFile(args["players-json"]),
    readFile(args["teams-json"]),
    readFile(args["contract-md"]),
  ]);

const receipt = JSON.parse(receiptBytes.toString("utf8"));
const partition = JSON.parse(partitionBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(receipt.result === "PASS" && receipt.phase === "8H", "Invalid Phase 8H receipt.");
assert(partition.result === "PASS" && partition.phase === "8G", "Invalid Phase 8G partition.");
assert(reviewed.result === "PASS" && reviewed.phase === "8A", "Invalid Phase 8A reviewed batch.");
assert(sha256(reviewedBytes) === "F5021B4C7021B89BB4697C58B06EA72BF08BA7B784160E8763C15E6FC230A33D", "Reviewed batch file hash drifted.");
assert(Array.isArray(trades) && trades.length === 1082, "Expected 1,082 canonical trades.");
assert(Array.isArray(players) && players.length === 1748, "Expected 1,748 players.");
assert(Array.isArray(teams) && teams.length === 52, "Expected 52 teams.");
assert(contractBytes.length > 0, "Phase 8H contract is empty.");

for (const [actual, expected, label] of [
  [receipt.readyPackages, 150, "ready packages"],
  [receipt.identityHeldPackages, 0, "identity-held packages"],
  [receipt.priorHeldRecords, 44, "prior-held records"],
  [receipt.excludedRecords, 10, "excluded records"],
  [receipt.totalUntouchedSourceRows, 54, "untouched source rows"],
  [receipt.canonicalTradesCreated, 150, "canonical trades created"],
  [receipt.perspectivesAppended, 0, "perspectives appended"],
  [receipt.playerShellsCreated, 238, "player shells created"],
  [receipt.relationshipReferencesAdded, 446, "relationship references added"],
  [receipt.postImportCanonicalTrades, 1082, "post-import trades"],
  [receipt.postImportPlayers, 1748, "post-import players"],
  [receipt.postImportTeams, 52, "post-import teams"],
  [receipt.teamRegistryEntriesAdded, 0, "team registrations"],
  [receipt.teamTradeMembershipsAdded, 317, "team memberships added"],
  [receipt.playerTradeReferencesAdded, 446, "player trade references added"],
  [receipt.repositoryDataWrites, 4, "repository data writes"],
  [receipt.automaticIdentityMerges, 0, "automatic identity merges"],
  [receipt.automaticCanonicalMerges, 0, "automatic canonical merges"],
  [receipt.automaticRoutes, 0, "automatic routes"],
  [receipt.heldPackageImports, 0, "held-package imports"],
]) {
  assert(actual === expected, `Receipt ${label} drifted: ${actual} !== ${expected}.`);
}
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(receipt.pushPerformed === false, "A push was recorded.");
assert(receipt.deployPerformed === false, "A deployment was recorded.");

assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Canonical store hash drifted.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Player store hash drifted.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Team store hash drifted.");
assert(receipt.sourceHashes.phase8GFileSha256 === sha256(partitionBytes), "Partition file hash drifted.");
assert(receipt.sourceHashes.contractSha256 === sha256(contractBytes), "Contract hash drifted.");
assert(receipt.sourceHashes.reviewedBatchSha256 === "F5021B4C7021B89BB4697C58B06EA72BF08BA7B784160E8763C15E6FC230A33D", "Reviewed batch hash drifted.");
assert(receipt.sourceHashes.historicalLineageSha256 === "46A551EB1C33C2450378878DA0074212EAD7DD95513EEB51E8E9E1DD8828F9C3", "Historical lineage hash drifted.");
for (const [receiptValue, partitionValue, label] of [
  [receipt.sourceHashes.finalPackageRecordsSha256, partition.hashes.finalPackageRecordsSha256, "package records"],
  [receipt.sourceHashes.priorHeldRecordsSha256, partition.hashes.priorHeldRecordsSha256, "prior-held records"],
  [receipt.sourceHashes.excludedRecordsSha256, partition.hashes.excludedRecordsSha256, "excluded records"],
  [receipt.sourceHashes.proposedPlayerShellsSha256, partition.hashes.finalProposedPlayerShellsSha256, "player shells"],
  [receipt.sourceHashes.relationshipPreviewsSha256, partition.hashes.finalRelationshipPreviewsSha256, "relationships"],
  [receipt.sourceHashes.importPartitionSha256, partition.hashes.importPartitionSha256, "import partition"],
]) {
  assert(receiptValue === partitionValue, `Frozen ${label} hash drifted.`);
}

assert(receipt.postImportTeamTradeMemberships === countTeamMemberships(trades), "Team-membership total drifted.");
assert(receipt.postImportPlayerTradeReferences === countPlayerTradeReferences(players), "Player-reference total drifted.");
assert(receipt.teamTradeMembershipsAdded === receipt.postImportTeamTradeMemberships - receipt.preImportTeamTradeMemberships, "Team-membership delta drifted.");
assert(receipt.playerTradeReferencesAdded === receipt.postImportPlayerTradeReferences - receipt.preImportPlayerTradeReferences, "Player-reference delta drifted.");

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const teamSet = new Set(teams.map(teamSlug).filter(Boolean));
assert(tradeMap.size === trades.length, "Duplicate canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");
assert(teamSet.size === teams.length, "Duplicate team slug.");

const reviewedById = new Map(reviewed.records.map((record) => [clean(record.sourceTradeId), record]));
assert(reviewedById.size === 204, "Reviewed source-ID uniqueness drifted.");
const expectedReadySourceIds = uniqueSorted(partition.finalReadyPackages.map((item) => clean(item.sourceTradeId)));
const expectedHeldSourceIds = uniqueSorted(partition.priorHeldRecords.map((item) => clean(item.sourceTradeId)));
const expectedExcludedSourceIds = uniqueSorted(partition.excludedRecords.map((item) => clean(item.sourceTradeId)));
const expectedPlayerIds = uniqueSorted(partition.proposedPlayerShells.map((item) => clean(item.proposedPlayerId)));
const expectedRelationshipIds = uniqueSorted(partition.relationshipPreviews.map((item) => clean(item.relationshipEdgeKey)));
assert(JSON.stringify(receipt.readySourceTradeIds) === JSON.stringify(expectedReadySourceIds), "Ready source-ID receipt drifted.");
assert(JSON.stringify(receipt.priorHeldSourceTradeIds) === JSON.stringify(expectedHeldSourceIds), "Held source-ID receipt drifted.");
assert(JSON.stringify(receipt.excludedSourceTradeIds) === JSON.stringify(expectedExcludedSourceIds), "Excluded source-ID receipt drifted.");
assert(JSON.stringify(receipt.importedPlayerIds) === JSON.stringify(expectedPlayerIds), "Imported player-ID receipt drifted.");
assert(JSON.stringify(receipt.relationshipIds) === JSON.stringify(expectedRelationshipIds), "Relationship-ID receipt drifted.");

for (const packageRecord of partition.finalReadyPackages) {
  const sourceTradeId = clean(packageRecord.sourceTradeId);
  const id = `nba-trade-${sourceTradeId.toLowerCase()}`;
  const trade = tradeMap.get(id);
  const source = reviewedById.get(sourceTradeId);
  assert(source, `${id}: reviewed source row is missing.`);
  assert(source.databaseImportAuthorized === true, `${id}: reviewed source is not import-authorized.`);
  assert(source.mergeExclude === false, `${id}: merge-excluded source was imported.`);
  assert(source.researchBeforePublic === false, `${id}: research-held source was imported.`);
  assert(trade, `Imported canonical trade is missing: ${id}`);
  assert(clean(trade.sourceTradeId) === sourceTradeId, `${id}: source ID drifted.`);
  assert(clean(trade.tradeDate) === clean(source.tradeDate), `${id}: trade date drifted.`);
  assert(clean(trade.slug) === clean(source.slug), `${id}: slug drifted.`);
  assert(clean(trade.verdict) === clean(source.verdict), `${id}: verdict drifted.`);
  assert(clean(trade.summary) === clean(source.summary), `${id}: summary drifted.`);
  assert(clean(trade.analysis) === clean(source.analysis), `${id}: analysis drifted.`);
  assert(clean(trade.contentClass) === clean(source.contentClass), `${id}: content class drifted.`);
  const expectedTeams = uniqueSorted(["cleveland-cavaliers", ...source.partnerTeams.map((team) => team === "thunder" ? "oklahoma-city-thunder" : team === "wizards" ? "washington-wizards" : team)]);
  assert(JSON.stringify(trade.teams) === JSON.stringify(expectedTeams), `${id}: participant teams drifted.`);
  const receivedTexts = trade.assetLedger.filter((asset) => asset.direction === "received").map((asset) => clean(asset.displayText));
  const sentTexts = trade.assetLedger.filter((asset) => asset.direction === "sent").map((asset) => clean(asset.displayText));
  assert(JSON.stringify(receivedTexts) === JSON.stringify(source.assetsReceived.map(clean)), `${id}: received assets drifted.`);
  assert(JSON.stringify(sentTexts) === JSON.stringify(source.assetsSent.map(clean)), `${id}: sent assets drifted.`);
  assert(trade.privateOnly === true, `${id}: privateOnly drifted.`);
  assert(trade.publishStatus === "private", `${id}: publish status drifted.`);
  assert(trade.indexEligible === false, `${id}: index eligibility drifted.`);
  assert(trade.adEligible === false, `${id}: ad eligibility drifted.`);
  assert(trade.publicationReady === false, `${id}: publication readiness drifted.`);
  assert(Array.isArray(trade.sourceTeams) && trade.sourceTeams.length === 1 && trade.sourceTeams[0] === "cleveland-cavaliers", `${id}: source-team boundary drifted.`);
  assert(Array.isArray(trade.perspectives) && trade.perspectives.length === 1 && clean(trade.perspectives[0].sourceTeam) === "cleveland-cavaliers", `${id}: Cleveland perspective drifted.`);
  assert(Array.isArray(trade.teams) && trade.teams.includes("cleveland-cavaliers"), `${id}: Cleveland membership is missing.`);
  assert(Array.isArray(trade.assetLedger) && trade.assetLedger.length > 0, `${id}: asset ledger is empty.`);
  const assetIds = new Set();
  for (const asset of trade.assetLedger) {
    assert(clean(asset.assetId), `${id}: asset ID is missing.`);
    assert(!assetIds.has(clean(asset.assetId)), `${id}: duplicate asset ID.`);
    assetIds.add(clean(asset.assetId));
    assert(clean(asset.fromTeam) && clean(asset.toTeam), `${id}: unresolved route edge.`);
    assert(teamSet.has(clean(asset.fromTeam)) && teamSet.has(clean(asset.toTeam)), `${id}: asset uses an unregistered team.`);
    assert(asset.privateOnly === true, `${id}: public asset detected.`);
    assert(asset.routingStatus === "resolved", `${id}: unresolved routing status.`);
  }
}

const importedTrades = receipt.importedCanonicalTradeIds.map((id) => tradeMap.get(id));
assert(importedTrades.filter((trade) => trade.teams.length === 2).length === 133, "Two-team import count drifted.");
assert(importedTrades.filter((trade) => trade.teams.length === 3).length === 17, "Three-team import count drifted.");
assert(importedTrades.filter((trade) => trade.routingRequired === true).length === 17, "Explicit-route import count drifted.");

for (const sourceTradeId of [...expectedHeldSourceIds, ...expectedExcludedSourceIds]) {
  assert(!trades.some((trade) => clean(trade.sourceTradeId) === sourceTradeId), `Held or excluded source row was imported: ${sourceTradeId}`);
}

for (const shell of partition.proposedPlayerShells) {
  const id = clean(shell.proposedPlayerId);
  const player = playerMap.get(id);
  assert(player, `Imported player shell is missing: ${id}`);
  assert(clean(player.displayName) === clean(shell.displayName), `${id}: display name drifted.`);
  assert(player.privateOnly === true, `${id}: player privacy drifted.`);
  assert(player.publishStatus === "private", `${id}: player publish status drifted.`);
  assert(player.indexEligible === false, `${id}: player index eligibility drifted.`);
  assert(player.adEligible === false, `${id}: player ad eligibility drifted.`);
  assert(player.publicationReady === false, `${id}: player publication readiness drifted.`);
}

const relationshipOwners = new Map();
for (const player of players) {
  const owner = playerId(player);
  for (const reference of Array.isArray(player.relationshipReferences) ? player.relationshipReferences : []) {
    const relationshipId = clean(reference.relationshipId);
    if (!relationshipId) continue;
    const list = relationshipOwners.get(relationshipId) ?? [];
    list.push({ owner, reference });
    relationshipOwners.set(relationshipId, list);
  }
}

for (const relationship of partition.relationshipPreviews) {
  const relationshipId = clean(relationship.relationshipEdgeKey);
  const expectedPlayerId = clean(relationship.existingPlayerId || relationship.proposedPlayerId || relationship.targetPlayerKey);
  const owners = relationshipOwners.get(relationshipId) ?? [];
  assert(owners.length === 1, `${relationshipId}: expected exactly one relationship owner, found ${owners.length}.`);
  const { owner, reference } = owners[0];
  assert(owner === expectedPlayerId, `${relationshipId}: relationship owner drifted.`);
  const canonicalTradeId = `nba-trade-${clean(relationship.sourceTradeId).toLowerCase()}`;
  assert(clean(reference.tradeId) === canonicalTradeId, `${relationshipId}: relationship trade drifted.`);
  assert(clean(reference.canonicalTradeId) === canonicalTradeId, `${relationshipId}: canonical trade reference drifted.`);
  assert(clean(reference.sourceTradeId) === clean(relationship.sourceTradeId), `${relationshipId}: source trade reference drifted.`);
  assert(reference.privateOnly === true, `${relationshipId}: public relationship reference detected.`);
  const role = expectedRelationshipRole(clean(relationship.identityKind));
  assert(clean(reference.relationshipRole) === role, `${relationshipId}: relationship role drifted.`);
  assert(clean(reference.referenceType) === expectedReferenceType(role), `${relationshipId}: relationship reference type drifted.`);
  const trade = tradeMap.get(canonicalTradeId);
  assert(trade, `${relationshipId}: canonical trade is missing.`);
  const assets = trade.assetLedger.filter((asset) => clean(asset.assetId) === clean(reference.assetId));
  assert(assets.length === 1, `${relationshipId}: canonical asset target is not unique.`);
  const asset = assets[0];
  assert(clean(asset.playerId) === expectedPlayerId, `${relationshipId}: asset player target drifted.`);
  assert(Array.isArray(asset.playerIds) && asset.playerIds.length === 1 && clean(asset.playerIds[0]) === expectedPlayerId, `${relationshipId}: asset playerIds drifted.`);
  assert(clean(asset.playerRelationshipRole) === role, `${relationshipId}: asset relationship role drifted.`);
  assert(clean(asset.displayText) === clean(relationship.rawAsset), `${relationshipId}: raw asset text drifted.`);
  if (relationship.side === "received") {
    assert(clean(asset.toTeam) === "cleveland-cavaliers", `${relationshipId}: received edge does not terminate at Cleveland.`);
  } else if (relationship.side === "sent") {
    assert(clean(asset.fromTeam) === "cleveland-cavaliers", `${relationshipId}: sent edge does not originate at Cleveland.`);
  } else {
    throw new Error(`${relationshipId}: unsupported relationship side.`);
  }
}

for (const team of collectTradeTeamSlugs(trades)) {
  assert(teamSet.has(team), `Trade team is absent from registry: ${team}`);
}

const importedTradeSet = new Set(receipt.importedCanonicalTradeIds);
assert(importedTradeSet.size === 150, "Imported canonical trade receipt contains duplicates.");
assert(receipt.importedPlayerIds.length === 238, "Imported player receipt contains duplicates or drift.");
assert(receipt.relationshipIds.length === 446, "Relationship receipt contains duplicates or drift.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "8H",
  readyPackages: receipt.readyPackages,
  priorHeldRecords: receipt.priorHeldRecords,
  excludedRecords: receipt.excludedRecords,
  totalUntouchedSourceRows: receipt.totalUntouchedSourceRows,
  canonicalTradesCreated: receipt.canonicalTradesCreated,
  playerShellsCreated: receipt.playerShellsCreated,
  relationshipReferencesAdded: receipt.relationshipReferencesAdded,
  postImportCanonicalTrades: trades.length,
  postImportPlayers: players.length,
  postImportTeams: teams.length,
  teamTradeMembershipsAdded: receipt.teamTradeMembershipsAdded,
  playerTradeReferencesAdded: receipt.playerTradeReferencesAdded,
  canonicalStoreSha256: receipt.canonicalStoreSha256,
  playerStoreSha256: receipt.playerStoreSha256,
  teamStoreSha256: receipt.teamStoreSha256,
  receiptSha256: sha256(canonicalJson(receipt)),
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  automaticRoutes: 0,
  heldPackageImports: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
