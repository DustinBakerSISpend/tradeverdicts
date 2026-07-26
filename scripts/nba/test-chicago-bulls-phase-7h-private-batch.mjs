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
function collectTradeTeams(trades) {
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

const args = parseArgs(process.argv);
for (const required of [
  "receipt-json",
  "phase7g-resolution",
  "trades-json",
  "players-json",
  "teams-json",
]) {
  assert(args[required], `Missing --${required}`);
}

const [receiptBytes, resolutionBytes, tradeBytes, playerBytes, teamBytes] =
  await Promise.all([
    readFile(args["receipt-json"]),
    readFile(args["phase7g-resolution"]),
    readFile(args["trades-json"]),
    readFile(args["players-json"]),
    readFile(args["teams-json"]),
  ]);

const receipt = JSON.parse(receiptBytes.toString("utf8"));
const resolution = JSON.parse(resolutionBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(receipt.result === "PASS" && receipt.phase === "7H", "Invalid Phase 7H receipt.");
assert(resolution.result === "PASS" && resolution.phase === "7G", "Invalid Phase 7G source.");
assert(Array.isArray(trades) && trades.length === 932, "Expected 932 canonical trades.");
assert(Array.isArray(players) && players.length === 1510, "Expected 1,510 players.");
assert(Array.isArray(teams) && teams.length >= 50, "Team store count regressed.");

assert(receipt.readyPackages === 173, "Ready-package count drifted.");
assert(receipt.identityHeldPackages === 14, "Identity-held count drifted.");
assert(receipt.priorHeldRecords === 25, "Prior-held count drifted.");
assert(receipt.excludedRecords === 7, "Excluded count drifted.");
assert(receipt.totalUntouchedSourceRows === 46, "Untouched source-row count drifted.");
assert(receipt.canonicalTradesCreated === 173, "Canonical-create count drifted.");
assert(receipt.perspectivesAppended === 0, "Unexpected perspective append.");
assert(receipt.playerShellsCreated === 218, "Player-shell count drifted.");
assert(receipt.relationshipReferencesAdded === 349, "Relationship count drifted.");
assert(receipt.postImportCanonicalTrades === 932, "Post-import trade count drifted.");
assert(receipt.postImportPlayers === 1510, "Post-import player count drifted.");
assert(receipt.postImportTeams === teams.length, "Post-import team count drifted.");
assert(receipt.repositoryDataWrites === 4, "Repository data-write count drifted.");
assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route occurred.");
assert(receipt.heldPackageImports === 0, "A held package was imported.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");

assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Canonical store hash drifted.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Player store hash drifted.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Team store hash drifted.");
assert(receipt.sourceHashes.finalPackageRecordsSha256 === resolution.finalPackageRecordsSha256, "Final-package source hash drifted.");
assert(receipt.sourceHashes.resolutionRecordsSha256 === resolution.resolutionRecordsSha256, "Resolution source hash drifted.");
assert(receipt.sourceHashes.proposedPlayerShellsSha256 === resolution.proposedPlayerShellsSha256, "Proposed-shell source hash drifted.");
assert(receipt.sourceHashes.relationshipPreviewsSha256 === resolution.relationshipPreviewsSha256, "Relationship source hash drifted.");
assert(receipt.sourceHashes.importPartitionSha256 === resolution.importPartitionSha256, "Import-partition source hash drifted.");

assert(
  receipt.postImportTeamTradeMemberships === countTeamMemberships(trades),
  "Team-membership receipt total drifted.",
);
assert(
  receipt.postImportPlayerTradeReferences === countPlayerTradeReferences(players),
  "Player-reference receipt total drifted.",
);
assert(
  receipt.teamTradeMembershipsAdded ===
    receipt.postImportTeamTradeMemberships - receipt.preImportTeamTradeMemberships,
  "Team-membership delta drifted.",
);
assert(
  receipt.playerTradeReferencesAdded ===
    receipt.postImportPlayerTradeReferences - receipt.preImportPlayerTradeReferences,
  "Player-reference delta drifted.",
);

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const teamSet = new Set(teams.map(teamSlug).filter(Boolean));
assert(tradeMap.size === trades.length, "Duplicate canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");
assert(teamSet.size === teams.length, "Duplicate team slug.");

for (const id of receipt.importedCanonicalTradeIds) {
  const trade = tradeMap.get(id);
  assert(trade, `Imported trade is missing: ${id}`);
  assert(trade.privateOnly === true, `${id}: privateOnly drifted.`);
  assert(trade.publishStatus === "private", `${id}: publish status drifted.`);
  assert(trade.indexEligible === false, `${id}: index eligibility drifted.`);
  assert(trade.adEligible === false, `${id}: ad eligibility drifted.`);
  assert(trade.publicationReady === false, `${id}: publication readiness drifted.`);
  assert(
    Array.isArray(trade.sourceTeams) &&
      trade.sourceTeams.includes("chicago-bulls"),
    `${id}: Chicago source team is missing.`,
  );
  assert(
    Array.isArray(trade.perspectives) &&
      trade.perspectives.some(
        (perspective) => clean(perspective.sourceTeam) === "chicago-bulls",
      ),
    `${id}: Chicago perspective is missing.`,
  );
  assert(
    Array.isArray(trade.assetLedger) && trade.assetLedger.length > 0,
    `${id}: asset ledger is empty.`,
  );
  assert(
    trade.assetLedger.every(
      (asset) =>
        asset.privateOnly === true &&
        clean(asset.assetId) &&
        clean(asset.fromTeam) &&
        clean(asset.toTeam),
    ),
    `${id}: canonical asset privacy or routing drifted.`,
  );
}

for (const sourceTradeId of receipt.untouchedSourceTradeIds) {
  assert(
    !trades.some((trade) => clean(trade.sourceTradeId) === sourceTradeId),
    `Held or excluded source trade was imported: ${sourceTradeId}`,
  );
}

for (const id of receipt.importedPlayerIds) {
  const player = playerMap.get(id);
  assert(player, `Imported player is missing: ${id}`);
  assert(player.privateOnly === true, `${id}: player privacy drifted.`);
  assert(player.publishStatus === "private", `${id}: player publish status drifted.`);
  assert(player.indexEligible === false, `${id}: player index eligibility drifted.`);
  assert(player.adEligible === false, `${id}: player ad eligibility drifted.`);
  assert(player.publicationReady === false, `${id}: player publication readiness drifted.`);
  assert(Array.isArray(player.relationshipReferences), `${id}: relationships are unavailable.`);
}

const allRelationshipIds = new Set(
  players.flatMap((player) =>
    (Array.isArray(player.relationshipReferences)
      ? player.relationshipReferences
      : []
    ).map((reference) => clean(reference.relationshipId)),
  ),
);
for (const relationshipId of receipt.relationshipIds) {
  assert(
    allRelationshipIds.has(relationshipId),
    `Imported relationship reference is missing: ${relationshipId}`,
  );
}

for (const team of collectTradeTeams(trades)) {
  assert(teamSet.has(team), `Trade team is absent from registry: ${team}`);
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "7H",
  readyPackages: receipt.readyPackages,
  identityHeldPackages: receipt.identityHeldPackages,
  priorHeldRecords: receipt.priorHeldRecords,
  excludedRecords: receipt.excludedRecords,
  totalUntouchedSourceRows: receipt.totalUntouchedSourceRows,
  canonicalTradesCreated: receipt.canonicalTradesCreated,
  playerShellsCreated: receipt.playerShellsCreated,
  relationshipReferencesAdded: receipt.relationshipReferencesAdded,
  postImportCanonicalTrades: trades.length,
  postImportPlayers: players.length,
  postImportTeams: teams.length,
  teamRegistryEntriesAdded: receipt.teamRegistryEntriesAdded,
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
}, null, 2));
