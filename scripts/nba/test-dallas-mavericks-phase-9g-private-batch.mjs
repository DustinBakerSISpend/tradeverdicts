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
function dallasPerspective(trade) {
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
          ) === "dallas-mavericks",
      ) ?? null
    );
  }
  if (perspectives && typeof perspectives === "object") {
    return perspectives["dallas-mavericks"] ?? null;
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

const IDENTITY_CORRECTIONS = new Map([
  [
    "nba-player-vsevolod-ishchenko-via-los-angeles-and-chicago-69c7c91a9c",
    "nba-player-vsevolod-ishchenko",
  ],
]);
function correctedPlayerId(value) {
  const id = clean(value);
  return IDENTITY_CORRECTIONS.get(id) ?? id;
}

const args = parseArgs(process.argv);
for (const required of [
  "receipt-json",
  "partition-json",
  "trades-json",
  "players-json",
  "teams-json",
  "contract-md",
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
] = await Promise.all([
  readFile(args["receipt-json"]),
  readFile(args["partition-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["contract-md"]),
]);

const receipt = JSON.parse(receiptBytes.toString("utf8"));
const partition = JSON.parse(partitionBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(receipt.result === "PASS" && receipt.phase === "9G", "Invalid Phase 9G receipt.");
assert(receipt.protocol === "Warp-Freeze Protocol", "Receipt protocol drifted.");
assert(partition.result === "PASS" && partition.phase === "9F", "Invalid Phase 9F partition.");
assert(contractBytes.length > 0, "Phase 9G contract is empty.");
assert(sha256(receiptBytes) === args["expected-receipt-sha256"], "Receipt file hash drifted.");
assert(sha256(tradeBytes) === args["expected-canonical-store-sha256"], "Canonical store hash drifted.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Player store hash drifted.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Team store hash drifted.");

for (const [actual, expected, label] of [
  [receipt.preImportCanonicalTrades, 1082, "pre-import trades"],
  [receipt.preImportPlayers, 1748, "pre-import players"],
  [receipt.preImportTeams, 52, "pre-import teams"],
  [receipt.readyPackages, 151, "ready packages"],
  [receipt.heldPackages, 0, "held packages"],
  [receipt.parentLinkedExclusions, 4, "parent-linked exclusions"],
  [receipt.canonicalTradesCreated, 115, "canonical creates"],
  [receipt.perspectivesAppended, 36, "perspective appends"],
  [receipt.dateCollisionDistinctCreates, 4, "date-collision creates"],
  [receipt.playerShellsCreated, 182, "player shells"],
  [receipt.frozenPlayerShellProposals, 183, "frozen shell proposals"],
  [receipt.frozenShellsResolvedToExistingPlayers, 1, "shells resolved to existing players"],
  [receipt.relationshipReferencesAdded, 507, "relationship references"],
  [receipt.matchedExistingAssetReferences, 494, "matched asset references"],
  [receipt.syntheticPerspectiveAssetReferences, 13, "synthetic perspective references"],
  [receipt.postImportCanonicalTrades, 1197, "post-import trades"],
  [receipt.postImportPlayers, 1930, "post-import players"],
  [receipt.postImportTeams, 52, "post-import teams"],
  [receipt.teamTradeMembershipsAdded, 244, "team memberships added"],
  [receipt.playerTradeReferencesAdded, 507, "player references added"],
  [receipt.teamRegistryEntriesAdded, 0, "team registrations"],
  [receipt.repositoryDataWrites, 3, "repository data writes"],
  [receipt.identityCorrections.length, 1, "identity corrections"],
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
  [receipt.sourceHashes.phase9FFileSha256, sha256(partitionBytes), "partition file"],
  [receipt.sourceHashes.phase9FInternalPartitionSha256, partition.hashes.finalImportPartitionSha256, "internal partition"],
  [receipt.sourceHashes.finalReadyPackagesSha256, partition.hashes.finalReadyPackagesSha256, "ready packages"],
  [receipt.sourceHashes.remainingHeldPackagesSha256, partition.hashes.remainingHeldPackagesSha256, "held packages"],
  [receipt.sourceHashes.parentLinkedExclusionsSha256, partition.hashes.parentLinkedExclusionsSha256, "parent exclusions"],
  [receipt.sourceHashes.proposedPlayerShellsSha256, partition.hashes.proposedPlayerShellsSha256, "player shells"],
  [receipt.sourceHashes.relationshipPreviewsSha256, partition.hashes.relationshipPreviewsSha256, "relationships"],
  [receipt.sourceHashes.contractSha256, sha256(contractBytes), "contract"],
]) {
  assert(receiptValue === partitionValue, `Frozen ${label} hash drifted.`);
}

assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Receipt canonical hash drifted.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Receipt player hash drifted.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Receipt team hash drifted.");
assert(Array.isArray(trades) && trades.length === 1197, "Expected 1,197 trades.");
assert(Array.isArray(players) && players.length === 1930, "Expected 1,930 players.");
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
assert(
  !playerMap.has(
    "nba-player-vsevolod-ishchenko-via-los-angeles-and-chicago-69c7c91a9c",
  ),
  "Malformed Vsevolod Ishchenko player shell was imported.",
);
const correctedIshchenko = playerMap.get(
  "nba-player-vsevolod-ishchenko",
);
assert(correctedIshchenko, "Corrected Vsevolod Ishchenko shell is missing.");
assert(
  clean(correctedIshchenko.displayName) === "Vsevolod Ishchenko",
  "Corrected Vsevolod Ishchenko display name drifted.",
);

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
  partition.proposedPlayerShells
    .filter(
      (item) =>
        clean(item.proposedPlayerId) !==
        "nba-player-vsevolod-ishchenko-via-los-angeles-and-chicago-69c7c91a9c",
    )
    .map((item) => correctedPlayerId(item.proposedPlayerId)),
);
const expectedResolvedExistingPlayerIds = ["nba-player-vsevolod-ishchenko"];
const expectedRelationshipIds = uniqueSorted(
  partition.relationshipPreviews.map((item) => clean(item.relationshipEdgeKey)),
);
const expectedExcludedSourceIds = uniqueSorted(
  partition.parentLinkedExclusions.map((item) => clean(item.sourceTradeId)),
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
  JSON.stringify(receipt.parentLinkedExcludedSourceTradeIds) ===
    JSON.stringify(expectedExcludedSourceIds),
  "Parent-exclusion receipt drifted.",
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
    sourcePerspectiveCount(trade, "dallas-mavericks") === 1,
    `${sourceId}: Dallas perspective count drifted.`,
  );
  const perspective = dallasPerspective(trade);
  assert(perspective, `${sourceId}: Dallas perspective is missing.`);
  const perspectiveVerdict = clean(perspective.verdict);
  assert(
    perspectiveVerdict === clean(sourceRecord["Final Verdict"]),
    `${sourceId}: Dallas perspective verdict drifted.`,
  );
  const perspectiveSummary = clean(perspective.summary);
  assert(
    perspectiveSummary === clean(sourceRecord["Final Trade Summary"]),
    `${sourceId}: Dallas perspective summary drifted.`,
  );
  assert(
    clean(trade.grades?.["dallas-mavericks"]) ===
      clean(sourceRecord["Mavericks Grade"]),
    `${sourceId}: Dallas grade drifted.`,
  );
  assert(trade.publishStatus === "private", `${sourceId}: publish status drifted.`);
  assert(trade.privateOnly === true, `${sourceId}: privateOnly drifted.`);
  assert(trade.indexEligible === false, `${sourceId}: index eligibility drifted.`);
  assert(trade.adEligible === false, `${sourceId}: ad eligibility drifted.`);
  assert(trade.publicationReady === false, `${sourceId}: publication readiness drifted.`);
  assert(Array.isArray(trade.teams) && trade.teams.includes("dallas-mavericks"), `${sourceId}: Dallas is absent from teams.`);

  if (packageRecord.importAction === "canonical-create") {
    assert(clean(trade.sourceTradeId) === sourceId, `${sourceId}: source ID drifted.`);
    assert(clean(trade.tradeDate) === clean(sourceRecord["Trade Date"]), `${sourceId}: date drifted.`);
    assert(clean(trade.summary) === clean(sourceRecord["Final Trade Summary"]), `${sourceId}: summary drifted.`);
    assert(clean(trade.analysis) === clean(sourceRecord["Final Trade Analysis"]), `${sourceId}: analysis drifted.`);
    assert(Array.isArray(trade.assetLedger) && trade.assetLedger.length > 0, `${sourceId}: asset ledger is empty.`);
    for (const asset of trade.assetLedger) {
      assert(clean(asset.assetId).startsWith("phase9g-asset-"), `${sourceId}: invalid new asset ID.`);
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

for (const sourceId of expectedExcludedSourceIds) {
  assert(
    !trades.some((trade) => clean(trade.sourceTradeId) === sourceId),
    `${sourceId}: parent-linked row was imported standalone.`,
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

  if (
    originalId ===
    "nba-player-vsevolod-ishchenko-via-los-angeles-and-chicago-69c7c91a9c"
  ) {
    assert(
      id === "nba-player-vsevolod-ishchenko",
      "Vsevolod Ishchenko did not resolve to the existing player.",
    );
    assert(
      !receipt.importedPlayerIds.includes(id),
      "Existing Vsevolod Ishchenko was incorrectly counted as a new player.",
    );
    continue;
  }

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
      clean(reference.assetId).startsWith("phase9g-perspective-asset-"),
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
assert(syntheticCount === 13, `Expected 13 synthetic references, found ${syntheticCount}.`);
assert(matchedCount === 494, `Expected 494 matched references, found ${matchedCount}.`);

console.log(
  JSON.stringify(
    {
      result: "PASS",
      phase: "9G",
      readyPackages: 151,
      canonicalTradesCreated: 115,
      perspectivesAppended: 36,
      playerShellsCreated: 182,
      frozenPlayerShellProposals: 183,
      frozenShellsResolvedToExistingPlayers: 1,
      relationshipReferencesAdded: 507,
      matchedExistingAssetReferences: matchedCount,
      syntheticPerspectiveAssetReferences: syntheticCount,
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
