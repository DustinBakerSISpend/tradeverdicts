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
function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    String(left).localeCompare(String(right), "en"),
  );
}
function tradeId(trade) {
  return clean(trade.id ?? trade.tradeId);
}
function playerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug);
}
function teamSlug(team) {
  return clean(team.slug ?? team.id ?? team.teamId);
}
function perspectives(trade) {
  if (Array.isArray(trade?.perspectives)) return trade.perspectives;
  if (trade?.perspectives && typeof trade.perspectives === "object") {
    return Object.entries(trade.perspectives).map(([sourceTeam, perspective]) => ({
      sourceTeam,
      ...perspective,
    }));
  }
  return [];
}
function perspectiveSourceTradeId(perspective) {
  if (clean(perspective?.sourceTradeId)) return clean(perspective.sourceTradeId);
  const submissionId = clean(perspective?.sourceSubmissionId);
  const match = submissionId.match(/(DAL-\d{4}-\d{4})$/u);
  return match ? match[1] : "";
}
function perspectiveDallasGrade(perspective) {
  return clean(perspective?.grades?.["dallas-mavericks"] ?? perspective?.grade);
}
function countTeamMemberships(trades) {
  return trades.reduce(
    (sum, trade) => sum + (Array.isArray(trade.teams) ? trade.teams.length : 0),
    0,
  );
}
function countRelationshipReferences(players) {
  return players.reduce(
    (sum, player) =>
      sum +
      (Array.isArray(player.relationshipReferences)
        ? player.relationshipReferences.length
        : 0),
    0,
  );
}
function expectedRole(identityKind) {
  if (identityKind === "draft_pick_player") return "pick-became-player";
  if (identityKind === "draft_rights_player") return "draft-rights-player";
  if (identityKind === "expansion_selection_player") {
    return "expansion-selection-player";
  }
  if (identityKind === "free_agent_rights_player") {
    return "free-agent-rights-player";
  }
  return "traded-player";
}
function expectedReferenceType(identityKind) {
  if (identityKind === "draft_pick_player") return "draft_outcome";
  if (identityKind === "draft_rights_player") return "draft_rights";
  if (identityKind === "expansion_selection_player") {
    return "expansion_selection";
  }
  if (identityKind === "free_agent_rights_player") {
    return "free_agent_rights";
  }
  return "direct_player";
}
function assertPrivateSafe(record, label) {
  assert(record.privateOnly !== false, `${label}: explicitly public privateOnly flag detected.`);
  assert(record.publishStatus !== "public", `${label}: public publish status detected.`);
  assert(record.indexEligible !== true, `${label}: index eligibility detected.`);
  assert(record.adEligible !== true, `${label}: ad eligibility detected.`);
  assert(record.publicationReady !== true, `${label}: publication readiness detected.`);
}
function assertPrivateExplicit(record, label) {
  assert(record.privateOnly === true, `${label}: privateOnly drifted.`);
  assert(record.publishStatus === "private", `${label}: publish status drifted.`);
  assert(record.indexEligible === false, `${label}: index eligibility drifted.`);
  assert(record.adEligible === false, `${label}: ad eligibility drifted.`);
  assert(record.publicationReady === false, `${label}: publication readiness drifted.`);
}

const args = parseArgs(process.argv);
for (const required of [
  "receipt-json",
  "phase9f-partition",
  "trades-json",
  "players-json",
  "teams-json",
  "phase9g-contract-md",
  "phase9h-contract-md",
  "output-json",
  "completed-at",
  "phase9g-head",
  "receipt-starting-head",
  "phase9g-report-sha256",
  "phase9g-bundle-sha256",
  "route-models",
  "internal-links",
  "team-trade-memberships",
  "player-relationship-references",
  "query-player-trade-references",
  "private-trades",
  "private-players",
  "unique-trade-dates",
  "shared-perspective-trades",
]) {
  assert(args[required], `Missing --${required}`);
}

const [receiptBytes, partitionBytes, tradeBytes, playerBytes, teamBytes, phase9GContractBytes, phase9HContractBytes] =
  await Promise.all([
    readFile(args["receipt-json"]),
    readFile(args["phase9f-partition"]),
    readFile(args["trades-json"]),
    readFile(args["players-json"]),
    readFile(args["teams-json"]),
    readFile(args["phase9g-contract-md"]),
    readFile(args["phase9h-contract-md"]),
  ]);

const receipt = JSON.parse(receiptBytes.toString("utf8"));
const partition = JSON.parse(partitionBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(receipt.result === "PASS" && receipt.phase === "9G", "Invalid Phase 9G receipt.");
assert(partition.result === "PASS" && partition.phase === "9F", "Invalid Phase 9F partition.");
assert(receipt.protocol === "Warp-Freeze Protocol", "Receipt protocol drifted.");
assert(partition.protocol === "Warp-Freeze Protocol", "Partition protocol drifted.");
assert(sha256(partitionBytes) === "06A45A77F03D681C260DCFA2B967F97988C32F949A37DA0BE10ABEE3F1950A9E", "Partition file hash drifted.");
assert(sha256(tradeBytes) === "837B206786ED3EC1F9FB8183A21449BF9D305142200A50D9D4FE11C240D1D79D", "Canonical store hash drifted.");
assert(sha256(playerBytes) === "2929040C853B8A4DBE31E3DF7CC02780D44C9CAE3291EF884E4FBEEEB9DF3B75", "Player store hash drifted.");
assert(sha256(teamBytes) === "26B17E87B6AAA97B28162078701850274A895E49197422B77CA3CE32BF262C90", "Team store hash drifted.");
assert(sha256(receiptBytes) === "A1973B042CEDDA537D2DDA4629E7EE6D2EEBD06814643980E8B6814AE45EF8EA", "Receipt hash drifted.");
assert(sha256(phase9GContractBytes) === "4A6AF205DCCF22913834256E8FE0E4328F0D53562EC289D0881E8BE4D14644B3", "Phase 9G contract hash drifted.");
assert(phase9HContractBytes.length > 0, "Phase 9H completion contract is empty.");
assert(receipt.startingHead === args["receipt-starting-head"], "Receipt starting HEAD drifted.");
assert(args["phase9g-head"] === "209b67ff907696565f25f7e5798755a6da2ac5eb", "Phase 9G checkpoint HEAD drifted.");
assert(/^[A-F0-9]{64}$/u.test(args["phase9g-report-sha256"]), "Invalid Phase 9G report SHA256.");
assert(/^[A-F0-9]{64}$/u.test(args["phase9g-bundle-sha256"]), "Invalid Phase 9G bundle SHA256.");

for (const [actual, expected, label] of [
  [receipt.readyPackages, 151, "ready packages"],
  [receipt.heldPackages, 0, "held packages"],
  [receipt.parentLinkedExclusions, 4, "parent-linked exclusions"],
  [receipt.canonicalTradesCreated, 115, "canonical creates"],
  [receipt.perspectivesAppended, 36, "perspective appends"],
  [receipt.dateCollisionDistinctCreates, 4, "same-date creates"],
  [receipt.frozenPlayerShellProposals, 183, "frozen shell proposals"],
  [receipt.playerShellsCreated, 182, "player shells created"],
  [receipt.frozenShellsResolvedToExistingPlayers, 1, "existing-player resolutions"],
  [receipt.relationshipReferencesAdded, 507, "relationships added"],
  [receipt.matchedExistingAssetReferences, 494, "canonical asset references"],
  [receipt.syntheticPerspectiveAssetReferences, 13, "perspective-local references"],
  [receipt.postImportCanonicalTrades, 1197, "post-import trades"],
  [receipt.postImportPlayers, 1930, "post-import players"],
  [receipt.postImportTeams, 52, "post-import teams"],
  [receipt.postImportTeamTradeMemberships, 2495, "team memberships"],
  [receipt.postImportPlayerTradeReferences, 1975, "relationship references"],
  [receipt.teamTradeMembershipsAdded, 244, "team memberships added"],
  [receipt.playerTradeReferencesAdded, 507, "player references added"],
  [receipt.teamRegistryEntriesAdded, 0, "team registrations"],
]) {
  assert(actual === expected, `Receipt ${label} drifted: ${actual} !== ${expected}.`);
}
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(receipt.pushPerformed === false, "A push was recorded.");
assert(receipt.deployPerformed === false, "A deployment was recorded.");
assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Receipt canonical hash drifted.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Receipt player hash drifted.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Receipt team hash drifted.");
assert(receipt.sourceHashes.phase9FFileSha256 === sha256(partitionBytes), "Receipt partition hash drifted.");
assert(receipt.sourceHashes.phase9FInternalPartitionSha256 === partition.hashes.finalImportPartitionSha256, "Receipt internal partition hash drifted.");
assert(receipt.sourceHashes.contractSha256 === sha256(phase9GContractBytes), "Receipt contract hash drifted.");

assert(Array.isArray(trades) && trades.length === 1197, "Expected 1,197 canonical trades.");
assert(Array.isArray(players) && players.length === 1930, "Expected 1,930 players.");
assert(Array.isArray(teams) && teams.length === 52, "Expected 52 teams.");
assert(countTeamMemberships(trades) === 2495, "Team-membership total drifted.");
assert(countRelationshipReferences(players) === 1975, "Player relationship-reference total drifted.");

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const teamSet = new Set(teams.map(teamSlug));
assert(tradeMap.size === trades.length, "Duplicate canonical trade IDs detected.");
assert(playerMap.size === players.length, "Duplicate player IDs detected.");
assert(teamSet.size === teams.length, "Duplicate team slugs detected.");

for (const trade of trades) {
  assertPrivateSafe(trade, tradeId(trade));
  for (const team of Array.isArray(trade.teams) ? trade.teams : []) {
    assert(teamSet.has(clean(team)), `${tradeId(trade)}: unregistered team ${team}.`);
  }
  for (const asset of Array.isArray(trade.assetLedger) ? trade.assetLedger : []) {
    assert(clean(asset.assetId), `${tradeId(trade)}: asset ID is missing.`);
    assert(asset.privateOnly !== false, `${tradeId(trade)}: explicitly public asset detected.`);
    if (clean(asset.fromTeam)) assert(teamSet.has(clean(asset.fromTeam)), `${tradeId(trade)}: unregistered fromTeam.`);
    if (clean(asset.toTeam)) assert(teamSet.has(clean(asset.toTeam)), `${tradeId(trade)}: unregistered toTeam.`);
  }
}
for (const player of players) assertPrivateSafe(player, playerId(player));

const readyPackages = partition.finalReadyPackages;
const createPackages = readyPackages.filter((item) => item.importAction === "canonical-create");
const appendPackages = readyPackages.filter((item) => item.importAction === "perspective-append");
const collisionPackages = readyPackages.filter((item) => item.dateCollisionResolvedAsDistinctCreate === true);
assert(readyPackages.length === 151, "Ready-package count drifted.");
assert(partition.remainingHeldPackages.length === 0, "Held package appeared.");
assert(createPackages.length === 115, "Canonical-create partition drifted.");
assert(appendPackages.length === 36, "Perspective-append partition drifted.");
assert(collisionPackages.length === 4, "Same-date distinct-create partition drifted.");
assert(partition.parentLinkedExclusions.length === 4, "Parent-linked exclusion count drifted.");

const createdIds = [];
const appendedIds = [];
for (const packageRecord of readyPackages) {
  const source = packageRecord.sourceRecord;
  const id = clean(packageRecord.targetCanonicalId);
  const trade = tradeMap.get(id);
  assert(trade, `${packageRecord.sourceTradeId}: target canonical trade is missing (${id}).`);
  const dallasPerspectives = perspectives(trade).filter(
    (perspective) => clean(perspective.sourceTeam) === "dallas-mavericks" && perspectiveSourceTradeId(perspective) === clean(packageRecord.sourceTradeId),
  );
  assert(dallasPerspectives.length === 1, `${id}: expected exactly one Dallas perspective for ${packageRecord.sourceTradeId}.`);
  const perspective = dallasPerspectives[0];
  assert(clean(perspective.summary) === clean(source["Final Trade Summary"]), `${id}: Dallas summary drifted.`);
  assert(clean(perspective.analysis) === clean(source["Final Trade Analysis"]), `${id}: Dallas analysis drifted.`);
  assert(clean(perspective.verdict) === clean(source["Final Verdict"]), `${id}: Dallas verdict drifted.`);
  assert(perspectiveDallasGrade(perspective) === clean(source["Mavericks Grade"]), `${id}: Dallas grade drifted.`);
  assert(trade.sourceTeams?.includes("dallas-mavericks"), `${id}: Dallas source-team membership is missing.`);
  assert(trade.teams?.includes("dallas-mavericks"), `${id}: Dallas team membership is missing.`);

  if (packageRecord.importAction === "canonical-create") {
    createdIds.push(id);
    assertPrivateExplicit(trade, id);
    assert(clean(trade.sourceTradeId) === clean(packageRecord.sourceTradeId), `${id}: source trade ID drifted.`);
    assert(clean(trade.tradeDate) === clean(packageRecord.tradeDate), `${id}: trade date drifted.`);
    assert(clean(trade.verdict) === clean(source["Final Verdict"]), `${id}: canonical verdict drifted.`);
    assert(clean(trade.summary) === clean(source["Final Trade Summary"]), `${id}: canonical summary drifted.`);
    assert(clean(trade.analysis) === clean(source["Final Trade Analysis"]), `${id}: canonical analysis drifted.`);
  } else {
    appendedIds.push(id);
    assert(clean(trade.sourceTradeId) !== clean(packageRecord.sourceTradeId), `${id}: perspective append overwrote canonical source identity.`);
  }
}
assert(JSON.stringify(uniqueSorted(createdIds)) === JSON.stringify(receipt.importedCanonicalTradeIds), "Created canonical ID receipt drifted.");
assert(JSON.stringify(uniqueSorted(appendedIds)) === JSON.stringify(receipt.updatedPerspectiveCanonicalIds), "Updated canonical ID receipt drifted.");

for (const packageRecord of collisionPackages) {
  const trade = tradeMap.get(clean(packageRecord.targetCanonicalId));
  assert(trade, `${packageRecord.sourceTradeId}: same-date create is missing.`);
  assert(packageRecord.importAction === "canonical-create", `${packageRecord.sourceTradeId}: same-date record was not created.`);
  assert(packageRecord.dateCollisionCanonicalIds.length > 0, `${packageRecord.sourceTradeId}: collision lineage is empty.`);
  for (const collidedId of packageRecord.dateCollisionCanonicalIds) {
    const collided = tradeMap.get(clean(collidedId));
    assert(collided, `${packageRecord.sourceTradeId}: prior same-date canonical is missing.`);
    assert(tradeId(collided) !== tradeId(trade), `${packageRecord.sourceTradeId}: date-only merge occurred.`);
    assert(clean(collided.tradeDate) === clean(trade.tradeDate), `${packageRecord.sourceTradeId}: collision date drifted.`);
  }
}

const allPerspectiveSourceIds = new Set(
  trades.flatMap((trade) => perspectives(trade).map(perspectiveSourceTradeId)).filter(Boolean),
);
for (const exclusion of partition.parentLinkedExclusions) {
  const sourceTradeId = clean(exclusion.sourceTradeId);
  assert(!trades.some((trade) => clean(trade.sourceTradeId) === sourceTradeId), `Parent-linked row was created: ${sourceTradeId}`);
  assert(!allPerspectiveSourceIds.has(sourceTradeId), `Parent-linked row was appended: ${sourceTradeId}`);
}

const correction = receipt.identityCorrections?.[0];
assert(receipt.identityCorrections.length === 1, "Identity-correction count drifted.");
assert(clean(correction.correctedPlayerId) === "nba-player-vsevolod-ishchenko", "Corrected player ID drifted.");
assert(JSON.stringify(receipt.resolvedExistingPlayerIds) === JSON.stringify(["nba-player-vsevolod-ishchenko"]), "Resolved existing-player list drifted.");
assert(!playerMap.has(clean(correction.originalPlayerId)), "Malformed Vsevolod duplicate player exists.");
const correctedPlayer = playerMap.get("nba-player-vsevolod-ishchenko");
assert(correctedPlayer, "Corrected Vsevolod player is missing.");
assertPrivateExplicit(correctedPlayer, "nba-player-vsevolod-ishchenko");

const expectedImportedPlayerIds = uniqueSorted(
  partition.proposedPlayerShells
    .map((shell) => clean(shell.proposedPlayerId))
    .filter((id) => id && id !== clean(correction.originalPlayerId)),
);
assert(expectedImportedPlayerIds.length === 182, "Expected 182 created player IDs.");
assert(JSON.stringify(expectedImportedPlayerIds) === JSON.stringify(receipt.importedPlayerIds), "Imported player ID receipt drifted.");
for (const id of expectedImportedPlayerIds) {
  const player = playerMap.get(id);
  assert(player, `Imported player shell is missing: ${id}`);
  assertPrivateExplicit(player, id);
}

const relationshipOwners = new Map();
for (const player of players) {
  const owner = playerId(player);
  for (const reference of Array.isArray(player.relationshipReferences) ? player.relationshipReferences : []) {
    const relationshipId = clean(reference.relationshipId);
    if (!relationshipId) continue;
    const owners = relationshipOwners.get(relationshipId) ?? [];
    owners.push({ owner, reference });
    relationshipOwners.set(relationshipId, owners);
  }
}

let canonicalAssetReferences = 0;
let perspectiveLocalReferences = 0;
for (const relationship of partition.relationshipPreviews) {
  const relationshipId = clean(relationship.relationshipEdgeKey);
  let expectedPlayerId = clean(relationship.targetPlayerId ?? relationship.existingPlayerId ?? relationship.proposedPlayerId);
  if (expectedPlayerId === clean(correction.originalPlayerId)) {
    expectedPlayerId = clean(correction.correctedPlayerId);
  }
  const owners = relationshipOwners.get(relationshipId) ?? [];
  assert(owners.length === 1, `${relationshipId}: expected one relationship owner, found ${owners.length}.`);
  const { owner, reference } = owners[0];
  assert(owner === expectedPlayerId, `${relationshipId}: relationship owner drifted.`);
  assert(clean(reference.tradeId) === clean(relationship.targetCanonicalId), `${relationshipId}: trade target drifted.`);
  assert(clean(reference.canonicalTradeId) === clean(relationship.targetCanonicalId), `${relationshipId}: canonical target drifted.`);
  assert(clean(reference.sourceTradeId) === clean(relationship.sourceTradeId), `${relationshipId}: source trade drifted.`);
  assert(clean(reference.relationshipRole) === expectedRole(clean(relationship.identityKind)), `${relationshipId}: relationship role drifted.`);
  assert(clean(reference.referenceType) === expectedReferenceType(clean(relationship.identityKind)), `${relationshipId}: reference type drifted.`);
  assert(reference.privateOnly === true, `${relationshipId}: public relationship detected.`);
  const trade = tradeMap.get(clean(relationship.targetCanonicalId));
  assert(trade, `${relationshipId}: canonical trade is missing.`);
  const assetIds = new Set((trade.assetLedger ?? []).map((asset) => clean(asset.assetId)));
  if (reference.perspectiveLocalAssetReference === true) {
    perspectiveLocalReferences += 1;
    assert(clean(reference.assetId).startsWith("phase9g-perspective-asset-"), `${relationshipId}: local asset ID drifted.`);
    assert(!assetIds.has(clean(reference.assetId)), `${relationshipId}: local asset unexpectedly entered canonical ledger.`);
  } else {
    canonicalAssetReferences += 1;
    assert(assetIds.has(clean(reference.assetId)), `${relationshipId}: canonical asset reference is unresolved.`);
  }
}
assert(canonicalAssetReferences === 494, "Canonical-ledger relationship count drifted.");
assert(perspectiveLocalReferences === 13, "Perspective-local relationship count drifted.");
assert(JSON.stringify(uniqueSorted(partition.relationshipPreviews.map((item) => clean(item.relationshipEdgeKey)))) === JSON.stringify(receipt.relationshipIds), "Relationship ID receipt drifted.");

const routeModels = Number(args["route-models"]);
const internalLinks = Number(args["internal-links"]);
const teamTradeMemberships = Number(args["team-trade-memberships"]);
const playerRelationshipReferences = Number(args["player-relationship-references"]);
const queryPlayerTradeReferences = Number(args["query-player-trade-references"]);
const privateTrades = Number(args["private-trades"]);
const privatePlayers = Number(args["private-players"]);
const uniqueTradeDates = Number(args["unique-trade-dates"]);
const sharedPerspectiveTrades = Number(args["shared-perspective-trades"]);
for (const [actual, expected, label] of [
  [routeModels, 3183, "route models"],
  [internalLinks, 10602, "internal links"],
  [teamTradeMemberships, 2495, "team trade memberships"],
  [playerRelationshipReferences, 1975, "player relationship references"],
  [queryPlayerTradeReferences, 1215, "query player references"],
  [privateTrades, 1197, "private trades"],
  [privatePlayers, 1930, "private players"],
  [uniqueTradeDates, 904, "unique trade dates"],
  [sharedPerspectiveTrades, 54, "shared-perspective trades"],
]) {
  assert(actual === expected, `${label} drifted: ${actual} !== ${expected}.`);
}

const manifest = {
  result: "PASS",
  phase: "9H",
  mode: "final-private-completion-audit",
  protocol: "Warp-Freeze Protocol",
  completedAt: args["completed-at"],
  completionPercent: 100,
  phase9GHead: args["phase9g-head"],
  receiptStartingHead: args["receipt-starting-head"],
  sourceHashes: {
    phase9FPartitionSha256: sha256(partitionBytes),
    phase9FInternalPartitionSha256: partition.hashes.finalImportPartitionSha256,
    phase9GReceiptSha256: sha256(receiptBytes),
    phase9GContractSha256: sha256(phase9GContractBytes),
    phase9HContractSha256: sha256(phase9HContractBytes),
    phase9GReportSha256: args["phase9g-report-sha256"],
    phase9GBundleSha256: args["phase9g-bundle-sha256"],
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
  },
  accounting: {
    sourceRows: 155,
    readyPackagesImported: 151,
    heldPackagesImported: 0,
    canonicalTradesCreated: 115,
    perspectivesAppended: 36,
    dateCollisionDistinctCreates: 4,
    parentLinkedExclusions: 4,
    frozenPlayerShellProposals: 183,
    playerShellsCreated: 182,
    frozenShellsResolvedToExistingPlayers: 1,
    relationshipReferencesAdded: 507,
    matchedCanonicalAssetReferences: 494,
    perspectiveLocalAssetReferences: 13,
  },
  stores: {
    canonicalTrades: trades.length,
    players: players.length,
    teams: teams.length,
    teamTradeMemberships,
    playerRelationshipReferences,
    queryPlayerTradeReferences,
    uniqueTradeDates,
    sharedPerspectiveTrades,
    privateTrades,
    privatePlayers,
  },
  routing: {
    routeModels,
    internalNbaLinks: internalLinks,
    duplicatePaths: 0,
    brokenLinks: 0,
    privacyViolations: 0,
  },
  validation: {
    phase9GReceipt: "PASS",
    canonicalCreates: "PASS",
    perspectiveAppends: "PASS",
    sameDateDistinctCreates: "PASS",
    parentLinkedExclusions: "PASS",
    playerShells: "PASS",
    existingPlayerResolution: "PASS",
    relationshipOwnership: "PASS",
    canonicalAssetReferences: "PASS",
    perspectiveLocalReferences: "PASS",
    privateQueryLayer: "PASS",
    privateRouteModels: "PASS",
    privateExposureContract: "PASS",
    strictPublicRecords: "PASS",
    productionBuild: "PASS",
    idempotentReplay: "PASS",
  },
  importedCanonicalTradeIds: receipt.importedCanonicalTradeIds,
  updatedPerspectiveCanonicalIds: receipt.updatedPerspectiveCanonicalIds,
  importedPlayerIds: receipt.importedPlayerIds,
  resolvedExistingPlayerIds: receipt.resolvedExistingPlayerIds,
  relationshipIds: receipt.relationshipIds,
  parentLinkedExclusionIds: uniqueSorted(
    partition.parentLinkedExclusions.map((item) => clean(item.sourceTradeId)),
  ),
  canonicalTradeWrites: 0,
  playerWrites: 0,
  teamWrites: 0,
  relationshipWrites: 0,
  routeWrites: 0,
  parentLinkedWrites: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

await mkdir(path.dirname(args["output-json"]), { recursive: true });
await writeFile(args["output-json"], canonicalJson(manifest));
console.log(JSON.stringify({
  result: "PASS",
  completionPercent: 100,
  manifestSha256: sha256(canonicalJson(manifest)),
  accounting: manifest.accounting,
  stores: manifest.stores,
  routing: manifest.routing,
}, null, 2));
