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
  const output = new Set(
    (Array.isArray(trade.teams) ? trade.teams : [])
      .map(clean)
      .filter(Boolean),
  );
  for (const asset of Array.isArray(trade.assetLedger) ? trade.assetLedger : []) {
    if (clean(asset.fromTeam)) output.add(clean(asset.fromTeam));
    if (clean(asset.toTeam)) output.add(clean(asset.toTeam));
  }
  return [...output];
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

const args = parseArgs(process.argv);
for (const required of [
  "phase7g-resolution",
  "trades-json",
  "players-json",
  "teams-json",
  "receipt-json",
  "contract-md",
  "output-json",
  "completed-at",
  "phase7h-head",
  "receipt-starting-head",
  "phase7h-report-sha256",
  "phase7h-bundle-sha256",
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
  readFile(args["phase7g-resolution"]),
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
  resolution.result === "PASS" && resolution.phase === "7G",
  "Invalid Phase 7G resolution.",
);
assert(
  receipt.result === "PASS" && receipt.phase === "7H",
  "Invalid Phase 7H receipt.",
);
assert(Array.isArray(trades) && trades.length === 932, "Expected 932 trades.");
assert(Array.isArray(players) && players.length === 1510, "Expected 1510 players.");
assert(Array.isArray(teams) && teams.length === 52, "Expected 52 teams.");

assert(
  Array.isArray(resolution.finalPackageRecords) &&
    resolution.finalPackageRecords.length === 187,
  "Expected 187 final package records.",
);
assert(
  Array.isArray(resolution.resolutionRecords) &&
    resolution.resolutionRecords.length === 16,
  "Expected 16 identity-resolution records.",
);
assert(
  Array.isArray(resolution.proposedPlayerShells) &&
    resolution.proposedPlayerShells.length === 218,
  "Expected 218 proposed player shells.",
);
assert(
  Array.isArray(resolution.relationshipPreviews) &&
    resolution.relationshipPreviews.length === 349,
  "Expected 349 relationship previews.",
);

assert(resolution.counts.sourceRows === 219, "Resolution source-row count drifted.");
assert(resolution.counts.eligibleInputPackages === 187, "Resolution eligible count drifted.");
assert(resolution.counts.finalReadyPackages === 173, "Resolution ready count drifted.");
assert(resolution.counts.remainingHeldPackages === 14, "Resolution identity-held count drifted.");
assert(resolution.counts.existingHeldRecords === 25, "Resolution prior-held count drifted.");
assert(resolution.counts.excludedRecords === 7, "Resolution excluded count drifted.");
assert(resolution.counts.finalProposedPlayerShells === 218, "Resolution shell count drifted.");
assert(resolution.counts.finalRelationshipPreviewEdges === 349, "Resolution relationship count drifted.");
assert(resolution.counts.resolvedUnsafeOccurrences === 0, "Unexpected unsafe resolution.");
assert(resolution.counts.remainingUnsafeOccurrences === 16, "Resolution unsafe count drifted.");

assert(
  sha256(JSON.stringify(resolution.finalPackageRecords)) ===
    resolution.finalPackageRecordsSha256,
  "Phase 7G final-package records drifted.",
);
assert(
  sha256(JSON.stringify(resolution.resolutionRecords)) ===
    resolution.resolutionRecordsSha256,
  "Phase 7G resolution records drifted.",
);
assert(
  sha256(JSON.stringify(resolution.proposedPlayerShells)) ===
    resolution.proposedPlayerShellsSha256,
  "Phase 7G proposed-player-shell records drifted.",
);
assert(
  sha256(JSON.stringify(resolution.relationshipPreviews)) ===
    resolution.relationshipPreviewsSha256,
  "Phase 7G relationship-preview records drifted.",
);

assert(
  receipt.startingHead === args["receipt-starting-head"],
  "Receipt starting HEAD drifted.",
);
assert(receipt.readyPackages === 173, "Receipt ready count drifted.");
assert(receipt.identityHeldPackages === 14, "Receipt identity-held count drifted.");
assert(receipt.priorHeldRecords === 25, "Receipt prior-held count drifted.");
assert(receipt.excludedRecords === 7, "Receipt excluded count drifted.");
assert(receipt.totalUntouchedSourceRows === 46, "Receipt untouched-row count drifted.");
assert(receipt.canonicalTradesCreated === 173, "Receipt trade count drifted.");
assert(receipt.perspectivesAppended === 0, "Unexpected perspective append.");
assert(receipt.playerShellsCreated === 218, "Receipt player-shell count drifted.");
assert(
  receipt.relationshipReferencesAdded === 349,
  "Receipt relationship count drifted.",
);
assert(receipt.teamRegistryEntriesAdded === 2, "Team registration count drifted.");
assert(receipt.postImportCanonicalTrades === 932, "Receipt trade total drifted.");
assert(receipt.postImportPlayers === 1510, "Receipt player total drifted.");
assert(receipt.postImportTeams === 52, "Receipt team total drifted.");
assert(receipt.heldPackageImports === 0, "A held package was imported.");
assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route occurred.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");

assert(
  receipt.sourceHashes.phase7GFileSha256 === sha256(resolutionBytes),
  "Receipt Phase 7G file hash drifted.",
);
assert(
  receipt.sourceHashes.finalPackageRecordsSha256 ===
    resolution.finalPackageRecordsSha256,
  "Receipt final-package hash drifted.",
);
assert(
  receipt.sourceHashes.resolutionRecordsSha256 ===
    resolution.resolutionRecordsSha256,
  "Receipt resolution-record hash drifted.",
);
assert(
  receipt.sourceHashes.proposedPlayerShellsSha256 ===
    resolution.proposedPlayerShellsSha256,
  "Receipt proposed-shell hash drifted.",
);
assert(
  receipt.sourceHashes.relationshipPreviewsSha256 ===
    resolution.relationshipPreviewsSha256,
  "Receipt relationship-preview hash drifted.",
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

const readySourceIds = sorted(
  resolution.finalPackageRecords
    .filter((record) => record.finalReady === true)
    .map((record) => clean(record.sourceTradeId)),
);
const identityHeldSourceIds = sorted(
  resolution.finalPackageRecords
    .filter((record) => record.finalHeld === true)
    .map((record) => clean(record.sourceTradeId)),
);
const priorHeldSourceIds = sorted(receipt.priorHeldSourceTradeIds ?? []);
const excludedSourceIds = sorted(receipt.excludedSourceTradeIds ?? []);
const untouchedSourceIds = sorted(receipt.untouchedSourceTradeIds ?? []);

assert(readySourceIds.length === 173, "Expected 173 ready source IDs.");
assert(identityHeldSourceIds.length === 14, "Expected 14 identity-held source IDs.");
assert(priorHeldSourceIds.length === 25, "Expected 25 prior-held source IDs.");
assert(excludedSourceIds.length === 7, "Expected seven excluded source IDs.");
assert(untouchedSourceIds.length === 46, "Expected 46 untouched source IDs.");

assert(
  JSON.stringify(readySourceIds) ===
    JSON.stringify(sorted(receipt.readySourceTradeIds)),
  "Ready source-trade IDs differ from receipt.",
);
assert(
  JSON.stringify(identityHeldSourceIds) ===
    JSON.stringify(sorted(receipt.identityHeldSourceTradeIds)),
  "Identity-held source-trade IDs differ from receipt.",
);
assert(
  JSON.stringify(
    sorted([
      ...identityHeldSourceIds,
      ...priorHeldSourceIds,
      ...excludedSourceIds,
    ]),
  ) === JSON.stringify(untouchedSourceIds),
  "Untouched source-trade partition differs from receipt.",
);

assert(new Set(receipt.readySourceTradeIds).size === 173, "Duplicate ready source ID.");
assert(new Set(receipt.identityHeldSourceTradeIds).size === 14, "Duplicate identity-held source ID.");
assert(new Set(priorHeldSourceIds).size === 25, "Duplicate prior-held source ID.");
assert(new Set(excludedSourceIds).size === 7, "Duplicate excluded source ID.");
assert(new Set(untouchedSourceIds).size === 46, "Duplicate untouched source ID.");
assert(
  receipt.readySourceTradeIds.every(
    (sourceId) => !untouchedSourceIds.includes(sourceId),
  ),
  "Ready and untouched source IDs overlap.",
);

assert(
  Array.isArray(receipt.importedCanonicalTradeIds) &&
    receipt.importedCanonicalTradeIds.length === 173 &&
    new Set(receipt.importedCanonicalTradeIds).size === 173,
  "Imported canonical-trade IDs drifted.",
);
assert(
  Array.isArray(receipt.importedPlayerIds) &&
    receipt.importedPlayerIds.length === 218 &&
    new Set(receipt.importedPlayerIds).size === 218,
  "Imported player IDs drifted.",
);
assert(
  Array.isArray(receipt.relationshipIds) &&
    receipt.relationshipIds.length === 349 &&
    new Set(receipt.relationshipIds).size === 349,
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
      trade.sourceTeams.includes("chicago-bulls"),
    `${canonicalId}: Chicago source team is missing.`,
  );
  assert(
    perspectiveList(trade).some(
      (perspective) => perspectiveTeam(perspective) === "chicago-bulls",
    ),
    `${canonicalId}: Chicago perspective is missing.`,
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
  JSON.stringify(sorted(importedSourceIds)) === JSON.stringify(readySourceIds),
  "Imported canonical source IDs differ from ready source IDs.",
);

for (const sourceId of untouchedSourceIds) {
  assert(
    !trades.some((trade) => clean(trade.sourceTradeId) === sourceId),
    `Held or excluded source row was imported: ${sourceId}`,
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

for (const registration of receipt.teamRegistryRegistrations ?? []) {
  const slug = clean(registration.slug);
  const team = teamMap.get(slug);
  assert(team, `Registered historical team is missing: ${slug}`);
  assert(team.privateOnly === true, `${slug}: team privacy drifted.`);
  assert(team.active === false, `${slug}: historical team became active.`);
}
assert(
  (receipt.teamRegistryRegistrations ?? []).length === 2,
  "Receipt team-registration details drifted.",
);

const privateTradeCount = Number(args["private-trades"]);
const privatePlayerCount = Number(args["private-players"]);
const routeModels = Number(args["route-models"]);
const internalLinks = Number(args["internal-links"]);
const teamTradeMemberships = Number(args["team-trade-memberships"]);
const playerTradeReferences = Number(args["player-trade-references"]);

assert(privateTradeCount === 932, "Authoritative private-trade count drifted.");
assert(privatePlayerCount === 1510, "Authoritative private-player count drifted.");
assert(Number.isInteger(routeModels) && routeModels > 2105, "Invalid route-model count.");
assert(Number.isInteger(internalLinks) && internalLinks > 7690, "Invalid internal-link count.");
assert(teamTradeMemberships === 1934, "Team-membership count drifted.");
assert(playerTradeReferences === 1215, "Player-reference count drifted.");

const perspectiveRepresentationCounts = countBy(
  trades.map(perspectiveRepresentation),
);

const completion = {
  result: "PASS",
  phase: "7I",
  mode: "FINAL_PRIVATE_COMPLETION_AUDIT",
  completionPercent: 100,
  completedAt: args["completed-at"],
  startingHead: args["phase7h-head"],
  phase7GHead: args["receipt-starting-head"],
  sourceRows: 219,
  eligiblePackageRecords: 187,
  importedPackages: 173,
  identityHeldPackages: 14,
  priorHeldRecords: 25,
  excludedRecords: 7,
  heldOrReconciliationRecords: 39,
  totalUntouchedSourceRows: 46,
  canonicalTradesCreated: 173,
  perspectivesAppended: 0,
  playerShellsCreated: 218,
  relationshipReferencesAdded: 349,
  historicalTeamEntriesAdded: 2,
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
    phase7GResolutionSha256: sha256(resolutionBytes),
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
    phase7HReceiptSha256: sha256(receiptBytes),
    phase7HCheckpointReportSha256: args["phase7h-report-sha256"],
    phase7HRecoveryBundleSha256: args["phase7h-bundle-sha256"],
    phase7IContractSha256: sha256(contractBytes),
    finalPackageRecordsSha256: resolution.finalPackageRecordsSha256,
    resolutionRecordsSha256: resolution.resolutionRecordsSha256,
    proposedPlayerShellsSha256: resolution.proposedPlayerShellsSha256,
    relationshipPreviewsSha256: resolution.relationshipPreviewsSha256,
    importPartitionSha256: resolution.importPartitionSha256,
  },
  readySourceTradeIds: sorted(receipt.readySourceTradeIds),
  identityHeldSourceTradeIds: sorted(receipt.identityHeldSourceTradeIds),
  priorHeldSourceTradeIds: priorHeldSourceIds,
  excludedSourceTradeIds: excludedSourceIds,
  untouchedSourceTradeIds: untouchedSourceIds,
  importedCanonicalTradeIds: sorted(receipt.importedCanonicalTradeIds),
  importedPlayerIds: sorted(receipt.importedPlayerIds),
  relationshipIds: sorted(receipt.relationshipIds),
  registeredHistoricalTeamSlugs: sorted(
    receipt.registeredHistoricalTeamSlugs ?? [],
  ),
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
  identityHeldPackages: completion.identityHeldPackages,
  priorHeldRecords: completion.priorHeldRecords,
  excludedRecords: completion.excludedRecords,
  totalUntouchedSourceRows: completion.totalUntouchedSourceRows,
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
