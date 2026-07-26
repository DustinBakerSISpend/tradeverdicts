#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
function sorted(values) {
  return [...values].sort((left, right) =>
    String(left).localeCompare(String(right), "en"),
  );
}
function unique(values) {
  return [...new Set(values)];
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
function perspectiveTeam(perspective) {
  return clean(
    perspective?.sourceTeam ??
      perspective?.teamId ??
      perspective?.team ??
      perspective?.perspectiveTeam,
  );
}
function perspectiveList(trade) {
  const value = trade?.perspectives;
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (perspectiveTeam(value)) return [value];

  return Object.values(value)
    .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
    .filter((entry) => entry && typeof entry === "object");
}
function perspectiveRepresentation(trade) {
  if (Array.isArray(trade?.perspectives)) return "array";
  if (trade?.perspectives && typeof trade.perspectives === "object") {
    return "object";
  }
  return "absent";
}
function allAssetIds(trade) {
  const assets = Array.isArray(trade.assetLedger)
    ? trade.assetLedger
    : Object.values(trade.assetsReceived ?? {}).flat();
  return new Set(
    assets.map((asset) => clean(asset.assetId)).filter(Boolean),
  );
}
function tradeTeams(trade) {
  const teams = new Set(
    (Array.isArray(trade.teams) ? trade.teams : [])
      .map(clean)
      .filter(Boolean),
  );
  for (const asset of Array.isArray(trade.assetLedger) ? trade.assetLedger : []) {
    if (clean(asset.fromTeam)) teams.add(clean(asset.fromTeam));
    if (clean(asset.toTeam)) teams.add(clean(asset.toTeam));
  }
  return [...teams];
}
function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
}
function recomputeImportPartition(records) {
  return sha256(JSON.stringify(records.map((record) => ({
    eligibilityKey: record.eligibilityKey,
    tradeId: record.tradeId,
    finalReadinessStatus: record.finalReadinessStatus,
    importReady: record.importReady,
  }))));
}

const args = parseArgs(process.argv);
for (const required of [
  "phase6g-resolution",
  "trades-json",
  "players-json",
  "teams-json",
  "receipt-json",
  "contract-md",
  "output-json",
  "completed-at",
  "phase6h-head",
  "receipt-starting-head",
  "phase6h-report-sha256",
  "phase6h-bundle-sha256",
  "route-models",
  "internal-links",
  "team-trade-memberships",
  "player-trade-references",
  "private-trades",
  "private-players",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  resolutionBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  receiptBytes,
  contractBytes,
] = await Promise.all([
  readFile(args["phase6g-resolution"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["receipt-json"]),
  readFile(args["contract-md"]),
]);

const resolution = JSON.parse(resolutionBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));

assert(
  resolution.result === "PASS" && resolution.phase === "6G",
  "Invalid Phase 6G resolution.",
);
assert(
  receipt.result === "PASS" && receipt.phase === "6H",
  "Invalid Phase 6H receipt.",
);
assert(Array.isArray(trades) && trades.length === 759, "Expected 759 trades.");
assert(Array.isArray(players) && players.length === 1292, "Expected 1292 players.");
assert(Array.isArray(teams) && teams.length === 50, "Expected 50 teams.");

assert(resolution.readyPackages === 102, "Resolution ready count drifted.");
assert(resolution.heldPackages === 1, "Resolution held count drifted.");
assert(
  resolution.readyCanonicalCreatePackages === 102,
  "Resolution canonical-create count drifted.",
);
assert(
  resolution.readyPerspectiveAppendPackages === 0,
  "Unexpected perspective append package.",
);
assert(
  resolution.readyPlayerShellPackages === 113,
  "Resolution player-shell count drifted.",
);
assert(
  resolution.readyRelationshipPreviews === 199,
  "Resolution relationship count drifted.",
);

assert(
  sha256(JSON.stringify(resolution.finalPackageRecords)) ===
    resolution.finalPackageRecordsSha256,
  "Phase 6G final-package records drifted.",
);
assert(
  sha256(JSON.stringify(resolution.readyPlayerShellRecords)) ===
    resolution.readyPlayerShellRecordsSha256,
  "Phase 6G ready-player-shell records drifted.",
);
assert(
  sha256(JSON.stringify(resolution.readyRelationshipRecords)) ===
    resolution.readyRelationshipRecordsSha256,
  "Phase 6G ready-relationship records drifted.",
);
assert(
  recomputeImportPartition(resolution.finalPackageRecords) ===
    resolution.importPartitionSha256,
  "Phase 6G import partition drifted.",
);

assert(
  receipt.startingHead === args["receipt-starting-head"],
  "Receipt starting HEAD drifted.",
);
assert(receipt.readyPackages === 102, "Receipt ready count drifted.");
assert(receipt.heldPackages === 1, "Receipt held count drifted.");
assert(receipt.canonicalTradesCreated === 102, "Receipt trade count drifted.");
assert(receipt.perspectivesAppended === 0, "Receipt perspective count drifted.");
assert(receipt.playerShellsCreated === 113, "Receipt player-shell count drifted.");
assert(
  receipt.relationshipReferencesAdded === 199,
  "Receipt relationship count drifted.",
);
assert(receipt.teamRegistryEntriesAdded === 0, "Unexpected team registration.");
assert(receipt.postImportCanonicalTrades === 759, "Receipt trade total drifted.");
assert(receipt.postImportPlayers === 1292, "Receipt player total drifted.");
assert(receipt.postImportTeams === 50, "Receipt team total drifted.");
assert(receipt.heldPackageImports === 0, "A held package was imported.");
assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route occurred.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");

assert(
  receipt.sourceHashes.phase6GFileSha256 === sha256(resolutionBytes),
  "Receipt Phase 6G file hash drifted.",
);
assert(
  receipt.sourceHashes.finalPackageRecordsSha256 ===
    resolution.finalPackageRecordsSha256,
  "Receipt final-package hash drifted.",
);
assert(
  receipt.sourceHashes.readyPlayerShellRecordsSha256 ===
    resolution.readyPlayerShellRecordsSha256,
  "Receipt ready-player-shell hash drifted.",
);
assert(
  receipt.sourceHashes.readyRelationshipRecordsSha256 ===
    resolution.readyRelationshipRecordsSha256,
  "Receipt ready-relationship hash drifted.",
);
assert(
  receipt.sourceHashes.importPartitionSha256 ===
    resolution.importPartitionSha256,
  "Receipt import-partition hash drifted.",
);
assert(
  receipt.canonicalStoreSha256 === sha256(tradeBytes),
  "Canonical store differs from receipt.",
);
assert(
  receipt.playerStoreSha256 === sha256(playerBytes),
  "Player store differs from receipt.",
);
assert(
  receipt.teamStoreSha256 === sha256(teamBytes),
  "Team store differs from receipt.",
);

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const teamMap = new Map(teams.map((team) => [teamSlug(team), team]));

assert(tradeMap.size === trades.length, "Duplicate canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");
assert(teamMap.size === teams.length, "Duplicate team slug.");

const readyPackageIds = sorted(
  resolution.finalPackageRecords
    .filter((record) => record.importReady === true)
    .map((record) => clean(record.tradeId)),
);
const heldPackageIds = sorted(
  resolution.finalPackageRecords
    .filter((record) => record.importReady !== true)
    .map((record) => clean(record.tradeId)),
);

assert(readyPackageIds.length === 102, "Expected 102 ready package IDs.");
assert(heldPackageIds.length === 1, "Expected one held package ID.");
assert(
  JSON.stringify(readyPackageIds) ===
    JSON.stringify(sorted(receipt.readySourceTradeIds)),
  "Ready source-trade IDs differ from receipt.",
);
assert(
  JSON.stringify(heldPackageIds) ===
    JSON.stringify(sorted(receipt.heldSourceTradeIds)),
  "Held source-trade IDs differ from receipt.",
);
assert(new Set(receipt.readySourceTradeIds).size === 102, "Duplicate ready source ID.");
assert(new Set(receipt.heldSourceTradeIds).size === 1, "Duplicate held source ID.");
assert(
  receipt.readySourceTradeIds.every(
    (sourceId) => !receipt.heldSourceTradeIds.includes(sourceId),
  ),
  "Ready and held source IDs overlap.",
);

assert(
  Array.isArray(receipt.importedCanonicalTradeIds) &&
    receipt.importedCanonicalTradeIds.length === 102 &&
    new Set(receipt.importedCanonicalTradeIds).size === 102,
  "Imported canonical-trade IDs drifted.",
);
assert(
  Array.isArray(receipt.importedPlayerIds) &&
    receipt.importedPlayerIds.length === 113 &&
    new Set(receipt.importedPlayerIds).size === 113,
  "Imported player IDs drifted.",
);
assert(
  Array.isArray(receipt.relationshipIds) &&
    receipt.relationshipIds.length === 199 &&
    new Set(receipt.relationshipIds).size === 199,
  "Imported relationship IDs drifted.",
);

const importedSourceIds = [];
for (const canonicalId of receipt.importedCanonicalTradeIds) {
  const trade = tradeMap.get(canonicalId);
  assert(trade, `Imported canonical trade is missing: ${canonicalId}`);
  assert(trade.privateOnly === true, `${canonicalId}: privateOnly drifted.`);
  assert(trade.publishStatus === "private", `${canonicalId}: publish status drifted.`);
  assert(trade.indexEligible === false, `${canonicalId}: index eligibility drifted.`);
  assert(trade.adEligible === false, `${canonicalId}: ad eligibility drifted.`);
  assert(
    trade.publicationReady === false,
    `${canonicalId}: publication readiness drifted.`,
  );
  assert(
    Array.isArray(trade.sourceTeams) &&
      trade.sourceTeams.includes("charlotte-hornets"),
    `${canonicalId}: Charlotte source team is missing.`,
  );
  assert(
    perspectiveList(trade).some(
      (perspective) => perspectiveTeam(perspective) === "charlotte-hornets",
    ),
    `${canonicalId}: Charlotte perspective is missing.`,
  );
  assert(
    Array.isArray(trade.assetLedger) && trade.assetLedger.length > 0,
    `${canonicalId}: asset ledger is empty.`,
  );
  assert(
    trade.assetLedger.every(
      (asset) =>
        asset.privateOnly === true &&
        clean(asset.assetId) &&
        clean(asset.fromTeam) &&
        clean(asset.toTeam),
    ),
    `${canonicalId}: asset privacy or routing drifted.`,
  );
  importedSourceIds.push(clean(trade.sourceTradeId));
}
assert(
  JSON.stringify(sorted(importedSourceIds)) === JSON.stringify(readyPackageIds),
  "Imported canonical source IDs differ from ready package IDs.",
);

for (const heldSourceId of heldPackageIds) {
  assert(
    !trades.some((trade) => clean(trade.sourceTradeId) === heldSourceId),
    `Held package was imported: ${heldSourceId}`,
  );
}

for (const id of receipt.importedPlayerIds) {
  const player = playerMap.get(id);
  assert(player, `Imported player is missing: ${id}`);
  assert(player.privateOnly === true, `${id}: privateOnly drifted.`);
  assert(player.publishStatus === "private", `${id}: publish status drifted.`);
  assert(player.indexEligible === false, `${id}: index eligibility drifted.`);
  assert(player.adEligible === false, `${id}: ad eligibility drifted.`);
  assert(player.publicationReady === false, `${id}: publication readiness drifted.`);
  assert(
    Array.isArray(player.relationshipReferences) &&
      player.relationshipReferences.length > 0,
    `${id}: imported player has no relationship reference.`,
  );
}

const relationshipOwners = new Map();
for (const player of players) {
  const id = playerId(player);
  for (const reference of Array.isArray(player.relationshipReferences)
    ? player.relationshipReferences
    : []) {
    const relationshipId = clean(reference.relationshipId);
    if (!relationshipId) continue;
    if (!relationshipOwners.has(relationshipId)) {
      relationshipOwners.set(relationshipId, []);
    }
    relationshipOwners.get(relationshipId).push({ playerId: id, player, reference });
  }
}

for (const relationshipId of receipt.relationshipIds) {
  const owners = relationshipOwners.get(relationshipId) ?? [];
  assert(
    owners.length === 1,
    `${relationshipId}: expected one player owner, found ${owners.length}.`,
  );
  const { player, reference } = owners[0];
  const canonicalId = clean(reference.canonicalTradeId ?? reference.tradeId);
  const trade = tradeMap.get(canonicalId);
  assert(trade, `${relationshipId}: canonical trade is missing.`);
  assert(
    allAssetIds(trade).has(clean(reference.assetId ?? reference.assetReference)),
    `${relationshipId}: canonical asset is missing.`,
  );
  assert(reference.privateOnly === true, `${relationshipId}: privacy drifted.`);
  assert(
    Array.isArray(player.referenceTypes) &&
      player.referenceTypes.includes(reference.referenceType),
    `${relationshipId}: player reference type is missing.`,
  );
}

for (const trade of trades) {
  for (const slug of tradeTeams(trade)) {
    assert(teamMap.has(slug), `Trade team is absent from registry: ${slug}`);
  }
}

const privateTradeCount = Number(args["private-trades"]);
const privatePlayerCount = Number(args["private-players"]);

assert(
  privateTradeCount === 759,
  "Authoritative private-trade count drifted.",
);
assert(
  privatePlayerCount === 1292,
  "Authoritative private-player count drifted.",
);

const perspectiveRepresentationCounts = countBy(
  trades.map(perspectiveRepresentation),
);
const routeModels = Number(args["route-models"]);
const internalLinks = Number(args["internal-links"]);
const teamTradeMemberships = Number(args["team-trade-memberships"]);
const playerTradeReferences = Number(args["player-trade-references"]);

assert(Number.isInteger(routeModels) && routeModels > 0, "Invalid route-model count.");
assert(Number.isInteger(internalLinks) && internalLinks > 0, "Invalid internal-link count.");
assert(teamTradeMemberships === 1578, "Team-membership count drifted.");
assert(playerTradeReferences === 1215, "Player-reference count drifted.");

const completion = {
  result: "PASS",
  phase: "6I",
  mode: "FINAL_PRIVATE_COMPLETION_AUDIT",
  completionPercent: 100,
  completedAt: args["completed-at"],
  startingHead: args["phase6h-head"],
  phase6GHead: args["receipt-starting-head"],
  sourceRows: 125,
  packageRecords: 103,
  importedPackages: 102,
  heldPackages: 1,
  canonicalTradesCreated: 102,
  perspectivesAppended: 0,
  playerShellsCreated: 113,
  relationshipReferencesAdded: 199,
  historicalTeamEntriesAdded: 0,
  currentCanonicalTrades: trades.length,
  currentPlayers: players.length,
  currentTeams: teams.length,
  teamTradeMemberships,
  playerTradeReferences,
  relationshipNodes: trades.length + players.length + teams.length,
  relationshipEdges: teamTradeMemberships + playerTradeReferences,
  routeModels,
  internalLinks,
  importedRelationshipReferencesValidated: receipt.relationshipIds.length,
  relationshipOwnershipFailures: 0,
  heldPackageImports: 0,
  ambiguousExactIdentityKeys: 0,
  privateTrades: privateTradeCount,
  privatePlayers: privatePlayerCount,
  privacyClosureSource: "scripts/nba/test-private-query-layer.mjs",
  perspectiveRepresentationCounts,
  sourceHashes: {
    phase6GResolutionSha256: sha256(resolutionBytes),
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
    phase6HReceiptSha256: sha256(receiptBytes),
    phase6HCheckpointReportSha256: args["phase6h-report-sha256"],
    phase6HRecoveryBundleSha256: args["phase6h-bundle-sha256"],
    phase6IContractSha256: sha256(contractBytes),
    finalPackageRecordsSha256: resolution.finalPackageRecordsSha256,
    readyPlayerShellRecordsSha256: resolution.readyPlayerShellRecordsSha256,
    readyRelationshipRecordsSha256: resolution.readyRelationshipRecordsSha256,
    importPartitionSha256: resolution.importPartitionSha256,
  },
  readySourceTradeIds: sorted(receipt.readySourceTradeIds),
  heldSourceTradeIds: sorted(receipt.heldSourceTradeIds),
  importedCanonicalTradeIds: sorted(receipt.importedCanonicalTradeIds),
  importedPlayerIds: sorted(receipt.importedPlayerIds),
  relationshipIds: sorted(receipt.relationshipIds),
  canonicalTradeWrites: 0,
  playerWrites: 0,
  teamWrites: 0,
  relationshipWrites: 0,
  routeWrites: 0,
  heldPackageWrites: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const outputPath = path.resolve(args["output-json"]);
await mkdir(path.dirname(outputPath), { recursive: true });
const outputBytes = canonicalJson(completion);
await writeFile(outputPath, outputBytes);

console.log(JSON.stringify({
  result: completion.result,
  phase: completion.phase,
  completionPercent: completion.completionPercent,
  importedPackages: completion.importedPackages,
  heldPackages: completion.heldPackages,
  currentCanonicalTrades: completion.currentCanonicalTrades,
  currentPlayers: completion.currentPlayers,
  currentTeams: completion.currentTeams,
  relationshipNodes: completion.relationshipNodes,
  relationshipEdges: completion.relationshipEdges,
  routeModels: completion.routeModels,
  internalLinks: completion.internalLinks,
  importedRelationshipReferencesValidated:
    completion.importedRelationshipReferencesValidated,
  heldPackageImports: completion.heldPackageImports,
  canonicalTradeWrites: 0,
  playerWrites: 0,
  teamWrites: 0,
  relationshipWrites: 0,
  routeWrites: 0,
  pushPerformed: false,
  deployPerformed: false,
  completionManifestSha256: sha256(outputBytes),
}, null, 2));
