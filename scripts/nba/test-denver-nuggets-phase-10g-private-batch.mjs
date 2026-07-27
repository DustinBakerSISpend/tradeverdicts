#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
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
function tradeId(trade) {
  return clean(trade.id ?? trade.tradeId);
}
function playerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id);
}
function teamSlug(team) {
  return clean(team.slug ?? team.id ?? team.teamId);
}
function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    String(left).localeCompare(String(right), "en"),
  );
}
function sourcePerspectiveCount(trade, team) {
  const perspectives = trade.perspectives;
  if (Array.isArray(perspectives)) {
    return perspectives.filter(
      (perspective) =>
        clean(
          perspective.sourceTeam ??
            perspective.teamId ??
            perspective.team ??
            perspective.perspectiveTeam,
        ) === team,
    ).length;
  }
  if (perspectives && typeof perspectives === "object") {
    return Object.prototype.hasOwnProperty.call(perspectives, team) ? 1 : 0;
  }
  return 0;
}
function denverPerspective(trade) {
  const perspectives = trade.perspectives;
  if (Array.isArray(perspectives)) {
    return (
      perspectives.find(
        (perspective) =>
          clean(
            perspective.sourceTeam ??
              perspective.teamId ??
              perspective.team ??
              perspective.perspectiveTeam,
          ) === "denver-nuggets",
      ) ?? null
    );
  }
  if (perspectives && typeof perspectives === "object") {
    return perspectives["denver-nuggets"] ?? null;
  }
  return null;
}
function countTeamMemberships(trades) {
  return trades.reduce(
    (total, trade) =>
      total + uniqueSorted(Array.isArray(trade.teams) ? trade.teams : []).length,
    0,
  );
}
function countPlayerTradeReferences(players) {
  return players.reduce((total, player) => {
    const references = Array.isArray(player.relationshipReferences)
      ? player.relationshipReferences
      : [];
    return total + references.length;
  }, 0);
}

function correctedPlayerId(value) {
  return clean(value);
}

const args = parseArgs(process.argv);
for (const required of [
  "receipt-json",
  "partition-json",
  "trades-json",
  "players-json",
  "teams-json",
  "contract-md",
  "routing-map-json",
  "expected-routing-map-sha256",
  "expected-canonical-store-sha256",
  "expected-player-store-sha256",
  "expected-team-store-sha256",
  "expected-receipt-sha256",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  receiptBytes,
  partitionBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  contractBytes,
  routingMapBytes,
] = await Promise.all([
  readFile(args["receipt-json"]),
  readFile(args["partition-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["contract-md"]),
  readFile(args["routing-map-json"]),
]);

const receipt = JSON.parse(receiptBytes.toString("utf8"));
const partition = JSON.parse(partitionBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const explicitRoutingMap = JSON.parse(routingMapBytes.toString("utf8"));

assert(receipt.result === "PASS" && receipt.phase === "10G", "Invalid Phase 10G receipt.");
assert(receipt.protocol === "Warp-Freeze Protocol", "Receipt protocol drifted.");
assert(partition.result === "PASS" && partition.phase === "10F", "Invalid Phase 10F partition.");
assert(contractBytes.length > 0, "Phase 10G contract is empty.");
assert(
  explicitRoutingMap.version === 1 &&
    explicitRoutingMap.routes &&
    typeof explicitRoutingMap.routes === "object",
  "Explicit routing map is invalid.",
);
assert(
  sha256(routingMapBytes) === args["expected-routing-map-sha256"],
  "Explicit routing-map hash drifted.",
);
assert(
  receipt.sourceHashes.explicitRoutingMapSha256 === sha256(routingMapBytes),
  "Receipt routing-map hash drifted.",
);
assert(sha256(receiptBytes) === args["expected-receipt-sha256"], "Receipt file hash drifted.");
assert(sha256(tradeBytes) === args["expected-canonical-store-sha256"], "Canonical store hash drifted.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Player store hash drifted.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Team store hash drifted.");

for (const [actual, expected, label] of [
  [receipt.preImportCanonicalTrades, 1197, "pre-import trades"],
  [receipt.preImportPlayers, 1930, "pre-import players"],
  [receipt.preImportTeams, 52, "pre-import teams"],
  [receipt.readyPackages, 225, "ready packages"],
  [receipt.heldPackages, 0, "held packages"],
  [receipt.linkedOrVoidedExclusions, 6, "linked/voided exclusions"],
  [receipt.canonicalTradesCreated, 180, "canonical creates"],
  [receipt.perspectivesAppended, 45, "perspective appends"],
  [receipt.dateCollisionDistinctCreates, 8, "date-collision creates"],
  [receipt.playerShellsCreated, 234, "player shells"],
  [receipt.frozenPlayerShellProposals, 234, "frozen shell proposals"],
  [receipt.frozenShellsResolvedToExistingPlayers, 0, "shells resolved to existing players"],
  [receipt.relationshipReferencesAdded, 632, "relationship references"],
  [receipt.matchedExistingAssetReferences, 615, "matched asset references"],
  [receipt.syntheticPerspectiveAssetReferences, 17, "synthetic perspective references"],
  [receipt.explicitRoutingAssetsApplied, 82, "explicit routing assets"],
  [receipt.postImportCanonicalTrades, 1377, "post-import trades"],
  [receipt.postImportPlayers, 2164, "post-import players"],
  [receipt.postImportTeams, 52, "post-import teams"],
  [receipt.teamTradeMembershipsAdded, 381, "team memberships added"],
  [receipt.playerTradeReferencesAdded, 632, "player references added"],
  [receipt.teamRegistryEntriesAdded, 0, "team registrations"],
  [receipt.repositoryDataWrites, 3, "repository data writes"],
  [receipt.identityCorrections.length, 0, "identity corrections"],
  [receipt.automaticIdentityMerges, 0, "automatic identity merges"],
  [receipt.automaticCanonicalMerges, 0, "automatic canonical merges"],
  [receipt.automaticPlayerCreates, 0, "automatic player creates"],
  [receipt.automaticRoutes, 0, "automatic routes"],
  [receipt.heldPackageImports, 0, "held-package imports"],
]) {
  assert(actual === expected, `Receipt ${label} drifted: ${actual} !== ${expected}.`);
}
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(receipt.pushPerformed === false, "A push was recorded.");
assert(receipt.deployPerformed === false, "A deployment was recorded.");

for (const [receiptValue, partitionValue, label] of [
  [receipt.sourceHashes.phase10FFileSha256, sha256(partitionBytes), "partition file"],
  [receipt.sourceHashes.phase10FInternalPartitionSha256, partition.hashes.finalImportPartitionSha256, "internal partition"],
  [receipt.sourceHashes.finalReadyPackagesSha256, partition.hashes.finalReadyPackagesSha256, "ready packages"],
  [receipt.sourceHashes.remainingHeldPackagesSha256, partition.hashes.remainingHeldPackagesSha256, "held packages"],
  [receipt.sourceHashes.linkedOrVoidedExclusionsSha256, partition.hashes.linkedOrVoidedExclusionsSha256, "linked/voided exclusions"],
  [receipt.sourceHashes.proposedPlayerShellsSha256, partition.hashes.proposedPlayerShellsSha256, "player shells"],
  [receipt.sourceHashes.relationshipPreviewsSha256, partition.hashes.relationshipPreviewsSha256, "relationships"],
  [receipt.sourceHashes.contractSha256, sha256(contractBytes), "contract"],
]) {
  assert(receiptValue === partitionValue, `Frozen ${label} hash drifted.`);
}

assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Receipt canonical hash drifted.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Receipt player hash drifted.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Receipt team hash drifted.");
assert(Array.isArray(trades) && trades.length === 1377, "Expected 1,377 trades.");
assert(Array.isArray(players) && players.length === 2164, "Expected 2,164 players.");
assert(Array.isArray(teams) && teams.length === 52, "Expected 52 teams.");
assert(receipt.postImportTeamTradeMemberships === countTeamMemberships(trades), "Team-membership total drifted.");
assert(receipt.postImportPlayerTradeReferences === countPlayerTradeReferences(players), "Player-reference total drifted.");
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
const expectedCreatedIds = uniqueSorted(
  partition.finalReadyPackages
    .filter((item) => item.importAction === "canonical-create")
    .map((item) => clean(item.proposedCanonicalId)),
);
const expectedAppendedIds = uniqueSorted(
  partition.finalReadyPackages
    .filter((item) => item.importAction === "perspective-append")
    .map((item) => clean(item.matchedCanonicalId)),
);
const expectedPlayerIds = uniqueSorted(
  partition.proposedPlayerShells.map((item) => clean(item.proposedPlayerId)),
);
const expectedResolvedExistingPlayerIds = [];
const expectedRelationshipIds = uniqueSorted(
  partition.relationshipPreviews.map((item) => clean(item.relationshipEdgeKey)),
);
const expectedExcludedSourceIds = uniqueSorted(
  partition.linkedOrVoidedExclusions.map((item) => clean(item.sourceTradeId)),
);

assert(
  JSON.stringify(receipt.importedCanonicalTradeIds) ===
    JSON.stringify(expectedCreatedIds),
  "Imported canonical-ID receipt drifted.",
);
assert(
  JSON.stringify(receipt.updatedPerspectiveCanonicalIds) ===
    JSON.stringify(expectedAppendedIds),
  "Updated perspective-ID receipt drifted.",
);
assert(
  JSON.stringify(receipt.importedPlayerIds) === JSON.stringify(expectedPlayerIds),
  "Imported player-ID receipt drifted.",
);
assert(
  JSON.stringify(receipt.resolvedExistingPlayerIds) ===
    JSON.stringify(expectedResolvedExistingPlayerIds),
  "Resolved-existing player-ID receipt drifted.",
);
assert(
  JSON.stringify(receipt.relationshipIds) ===
    JSON.stringify(expectedRelationshipIds),
  "Relationship-ID receipt drifted.",
);
assert(
  JSON.stringify(receipt.linkedOrVoidedExcludedSourceTradeIds) ===
    JSON.stringify(expectedExcludedSourceIds),
  "Linked/voided-exclusion receipt drifted.",
);

const packageByTradeId = new Map(
  partition.finalReadyPackages.map((item) => [clean(item.sourceTradeId), item]),
);
for (const packageRecord of partition.finalReadyPackages) {
  const sourceRecord = packageRecord.sourceRecord;
  const sourceId = clean(packageRecord.sourceTradeId);
  const targetId = clean(packageRecord.targetCanonicalId);
  const trade = tradeMap.get(targetId);
  assert(trade, `${sourceId}: target trade is missing.`);
  assert(
    sourcePerspectiveCount(trade, "denver-nuggets") === 1,
    `${sourceId}: Denver perspective count drifted.`,
  );
  const perspective = denverPerspective(trade);
  assert(perspective, `${sourceId}: Denver perspective is missing.`);
  const perspectiveVerdict = clean(perspective.verdict);
  assert(
    perspectiveVerdict === clean(sourceRecord["Final Verdict"]),
    `${sourceId}: Denver perspective verdict drifted.`,
  );
  const perspectiveSummary = clean(perspective.summary);
  assert(
    perspectiveSummary === clean(sourceRecord["Final Trade Summary"]),
    `${sourceId}: Denver perspective summary drifted.`,
  );
  assert(
    clean(trade.grades?.["denver-nuggets"]) ===
      clean(sourceRecord["Nuggets Grade"]),
    `${sourceId}: Denver grade drifted.`,
  );
  assert(trade.publishStatus === "private", `${sourceId}: publish status drifted.`);
  assert(trade.privateOnly === true, `${sourceId}: privateOnly drifted.`);
  assert(trade.indexEligible === false, `${sourceId}: index eligibility drifted.`);
  assert(trade.adEligible === false, `${sourceId}: ad eligibility drifted.`);
  assert(trade.publicationReady === false, `${sourceId}: publication readiness drifted.`);
  assert(Array.isArray(trade.teams) && trade.teams.includes("denver-nuggets"), `${sourceId}: Denver is absent from teams.`);

  if (packageRecord.importAction === "canonical-create") {
    assert(clean(trade.sourceTradeId) === sourceId, `${sourceId}: source ID drifted.`);
    assert(clean(trade.tradeDate) === clean(sourceRecord["Trade Date"]), `${sourceId}: date drifted.`);
    assert(clean(trade.summary) === clean(sourceRecord["Final Trade Summary"]), `${sourceId}: summary drifted.`);
    assert(clean(trade.analysis) === clean(sourceRecord["Final Trade Analysis"]), `${sourceId}: analysis drifted.`);
    assert(Array.isArray(trade.assetLedger) && trade.assetLedger.length > 0, `${sourceId}: asset ledger is empty.`);
    for (const asset of trade.assetLedger) {
      assert(clean(asset.assetId).startsWith("phase10g-asset-"), `${sourceId}: invalid new asset ID.`);
      assert(asset.privateOnly === true, `${sourceId}: asset privacy drifted.`);
      if (asset.fromTeam) assert(teamSet.has(asset.fromTeam), `${sourceId}: unknown fromTeam ${asset.fromTeam}.`);
      if (asset.toTeam) assert(teamSet.has(asset.toTeam), `${sourceId}: unknown toTeam ${asset.toTeam}.`);
      for (const team of asset.possibleFromTeams ?? []) {
        assert(teamSet.has(team), `${sourceId}: unknown possibleFromTeam ${team}.`);
      }
      for (const team of asset.possibleToTeams ?? []) {
        assert(teamSet.has(team), `${sourceId}: unknown possibleToTeam ${team}.`);
      }
    }
    if (packageRecord.dateCollisionResolvedAsDistinctCreate) {
      assert(
        packageRecord.dateCollisionCount > 0 &&
          packageRecord.canonicalDisposition === "new-canonical-date-collision-review",
        `${sourceId}: same-date distinct-create contract drifted.`,
      );
    }
  } else {
    assert(
      packageRecord.importAction === "perspective-append",
      `${sourceId}: unsupported import action.`,
    );
    assert(
      clean(trade.sourceTradeId) !== sourceId ||
        clean(trade.id) === clean(packageRecord.matchedCanonicalId),
      `${sourceId}: perspective append replaced canonical identity.`,
    );
  }
}


const explicitRoutedAssets = trades.reduce(
  (total, trade) =>
    total +
    (Array.isArray(trade.assetLedger)
      ? trade.assetLedger.filter(
          (asset) =>
            asset.sourceTeam === "denver-nuggets" &&
            asset.routingMethod === "phase10g-explicit-routing-map",
        ).length
      : 0),
  0,
);
assert(
  explicitRoutedAssets === 82,
  `Expected 82 explicit multi-team canonical-create routes, found ${explicitRoutedAssets}.`,
);

for (const sourceId of expectedExcludedSourceIds) {
  assert(
    !trades.some((trade) => clean(trade.sourceTradeId) === sourceId),
    `${sourceId}: linked/voided row was imported standalone.`,
  );
}

for (const shell of partition.proposedPlayerShells) {
  const originalId = clean(shell.proposedPlayerId);
  const id = correctedPlayerId(originalId);
  const player = playerMap.get(id);
  assert(player, `${id}: player target is missing.`);
  assert(Array.isArray(player.aliases), `${id}: aliases must be an array.`);
  assert(Array.isArray(player.referenceTypes), `${id}: referenceTypes must be an array.`);
  assert(Array.isArray(player.relationshipReferences), `${id}: relationshipReferences must be an array.`);


  assert(receipt.importedPlayerIds.includes(id), `${id}: new shell is absent from receipt.`);
  assert(player.publishStatus === "private", `${id}: publish status drifted.`);
  assert(player.privateOnly === true, `${id}: privateOnly drifted.`);
  assert(player.indexEligible === false, `${id}: index eligibility drifted.`);
  assert(player.adEligible === false, `${id}: ad eligibility drifted.`);
  assert(player.publicationReady === false, `${id}: publication readiness drifted.`);
}

let syntheticCount = 0;
let matchedCount = 0;
for (const relationship of partition.relationshipPreviews) {
  const player = playerMap.get(correctedPlayerId(relationship.targetPlayerId));
  assert(player, `${relationship.relationshipEdgeKey}: player is missing.`);
  const reference = (player.relationshipReferences ?? []).find(
    (item) =>
      clean(item.relationshipId) === clean(relationship.relationshipEdgeKey),
  );
  assert(reference, `${relationship.relationshipEdgeKey}: player relationship is missing.`);
  assert(clean(reference.tradeId) === clean(relationship.targetCanonicalId), `${relationship.relationshipEdgeKey}: trade ID drifted.`);
  const trade = tradeMap.get(clean(reference.tradeId));
  assert(trade, `${relationship.relationshipEdgeKey}: referenced trade is missing.`);
  assert(reference.privateOnly === true, `${relationship.relationshipEdgeKey}: privacy drifted.`);

  if (reference.perspectiveLocalAssetReference) {
    syntheticCount += 1;
    assert(
      clean(reference.assetId).startsWith("phase10g-perspective-asset-"),
      `${relationship.relationshipEdgeKey}: invalid synthetic asset reference.`,
    );
    assert(reference.sourceAssetId == null, `${relationship.relationshipEdgeKey}: synthetic source asset must be null.`);
    const packageRecord = packageByTradeId.get(clean(relationship.sourceTradeId));
    assert(packageRecord?.importAction === "perspective-append", `${relationship.relationshipEdgeKey}: synthetic reference used outside a perspective append.`);
  } else {
    matchedCount += 1;
    assert(
      (trade.assetLedger ?? []).some(
        (asset) => clean(asset.assetId) === clean(reference.assetId),
      ),
      `${relationship.relationshipEdgeKey}: asset reference is absent from the trade ledger.`,
    );
  }
}
assert(syntheticCount === 17, `Expected 17 synthetic references, found ${syntheticCount}.`);
assert(matchedCount === 615, `Expected 615 matched references, found ${matchedCount}.`);

console.log(
  JSON.stringify(
    {
      result: "PASS",
      phase: "10G",
      readyPackages: 225,
      canonicalTradesCreated: 180,
      perspectivesAppended: 45,
      playerShellsCreated: 234,
      frozenPlayerShellProposals: 234,
      frozenShellsResolvedToExistingPlayers: 0,
      relationshipReferencesAdded: 632,
      matchedExistingAssetReferences: matchedCount,
      syntheticPerspectiveAssetReferences: syntheticCount,
      explicitRoutingAssetsApplied: explicitRoutedAssets,
      postImportCanonicalTrades: trades.length,
      postImportPlayers: players.length,
      postImportTeams: teams.length,
      teamTradeMemberships: countTeamMemberships(trades),
      playerTradeReferences: countPlayerTradeReferences(players),
      canonicalStoreSha256: sha256(tradeBytes),
      playerStoreSha256: sha256(playerBytes),
      teamStoreSha256: sha256(teamBytes),
      receiptSha256: sha256(receiptBytes),
      publicationAuthorized: false,
      pushPerformed: false,
      deployPerformed: false,
    },
    null,
    2,
  ),
);
