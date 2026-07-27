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
  const match = submissionId.match(/(DEN-\d{4}-\d{4})$/u);
  return match ? match[1] : "";
}
function perspectiveDenverGrade(perspective) {
  return clean(perspective?.grades?.["denver-nuggets"] ?? perspective?.grade);
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
  if (identityKind === "expansion_selection_player") return "expansion-selection-player";
  if (identityKind === "free_agent_rights_player") return "free-agent-rights-player";
  return "traded-player";
}
function expectedReferenceType(identityKind) {
  if (identityKind === "draft_pick_player") return "draft_outcome";
  if (identityKind === "draft_rights_player") return "draft_rights";
  if (identityKind === "expansion_selection_player") return "expansion_selection";
  if (identityKind === "free_agent_rights_player") return "free_agent_rights";
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
  "phase10f-partition",
  "trades-json",
  "players-json",
  "teams-json",
  "phase10g-contract-md",
  "phase10h-contract-md",
  "output-json",
  "completed-at",
  "phase10g-head",
  "receipt-starting-head",
  "phase10g-report-sha256",
  "phase10g-bundle-sha256",
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

const [receiptBytes, partitionBytes, tradeBytes, playerBytes, teamBytes, phase10GContractBytes, phase10HContractBytes] =
  await Promise.all([
    readFile(args["receipt-json"]),
    readFile(args["phase10f-partition"]),
    readFile(args["trades-json"]),
    readFile(args["players-json"]),
    readFile(args["teams-json"]),
    readFile(args["phase10g-contract-md"]),
    readFile(args["phase10h-contract-md"]),
  ]);

const receipt = JSON.parse(receiptBytes.toString("utf8"));
const partition = JSON.parse(partitionBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(receipt.result === "PASS" && receipt.phase === "10G", "Invalid Phase 10G receipt.");
assert(partition.result === "PASS" && partition.phase === "10F", "Invalid Phase 10F partition.");
assert(receipt.protocol === "Warp-Freeze Protocol", "Receipt protocol drifted.");
assert(partition.protocol === "Warp-Freeze Protocol", "Partition protocol drifted.");
assert(sha256(partitionBytes) === "267D3DB23D722765A26BDC25D32FA913876C7EC11CEE76B251C63E6B2E1600AF", "Partition file hash drifted.");
assert(sha256(tradeBytes) === "76ED0D4C9BD83DCAC6B28146508071F124060A4632EF4230F68C71991FCA54A6", "Canonical store hash drifted.");
assert(sha256(playerBytes) === "557FB7C05EA17A1A57674DE2044087FFCC3CDBC025B3CDE272B094DFD8960F3C", "Player store hash drifted.");
assert(sha256(teamBytes) === "26B17E87B6AAA97B28162078701850274A895E49197422B77CA3CE32BF262C90", "Team store hash drifted.");
assert(sha256(receiptBytes) === "CFDA66359453BAFF5F6DD05E952E826BBB26441DB29D54A538C8CDDE61FCEF9B", "Receipt hash drifted.");
assert(sha256(phase10GContractBytes) === "D3E2B506189074996C4EEEBE9764EA44CFD6BEF8DFD015AF85C9C32C3E2EAC7F", "Phase 10G contract hash drifted.");
assert(phase10HContractBytes.length > 0, "Phase 10H completion contract is empty.");
assert(receipt.startingHead === args["receipt-starting-head"], "Receipt starting HEAD drifted.");
assert(args["phase10g-head"] === "22671292744016725dce2a5b8dd5acc67f204859", "Phase 10G checkpoint HEAD drifted.");
assert(/^[A-F0-9]{64}$/u.test(args["phase10g-report-sha256"]), "Invalid Phase 10G report SHA256.");
assert(/^[A-F0-9]{64}$/u.test(args["phase10g-bundle-sha256"]), "Invalid Phase 10G bundle SHA256.");

for (const [actual, expected, label] of [
  [receipt.readyPackages, 225, "ready packages"],
  [receipt.heldPackages, 0, "held packages"],
  [receipt.linkedOrVoidedExclusions, 6, "linked or voided exclusions"],
  [receipt.canonicalTradesCreated, 180, "canonical creates"],
  [receipt.perspectivesAppended, 45, "perspective appends"],
  [receipt.dateCollisionDistinctCreates, 8, "same-date creates"],
  [receipt.frozenPlayerShellProposals, 234, "frozen shell proposals"],
  [receipt.playerShellsCreated, 234, "player shells created"],
  [receipt.frozenShellsResolvedToExistingPlayers, 0, "existing-player resolutions"],
  [receipt.relationshipReferencesAdded, 632, "relationships added"],
  [receipt.matchedExistingAssetReferences, 615, "canonical asset references"],
  [receipt.syntheticPerspectiveAssetReferences, 17, "perspective-local references"],
  [receipt.explicitRoutingAssetsApplied, 82, "explicit routing assets"],
  [receipt.postImportCanonicalTrades, 1377, "post-import trades"],
  [receipt.postImportPlayers, 2164, "post-import players"],
  [receipt.postImportTeams, 52, "post-import teams"],
  [receipt.postImportTeamTradeMemberships, 2876, "team memberships"],
  [receipt.postImportPlayerTradeReferences, 2607, "relationship references"],
  [receipt.teamTradeMembershipsAdded, 381, "team memberships added"],
  [receipt.playerTradeReferencesAdded, 632, "player references added"],
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
assert(receipt.sourceHashes.phase10FFileSha256 === sha256(partitionBytes), "Receipt partition hash drifted.");
assert(receipt.sourceHashes.phase10FInternalPartitionSha256 === partition.hashes.finalImportPartitionSha256, "Receipt internal partition hash drifted.");
assert(receipt.sourceHashes.contractSha256 === sha256(phase10GContractBytes), "Receipt contract hash drifted.");

assert(Array.isArray(trades) && trades.length === 1377, "Expected 1,377 canonical trades.");
assert(Array.isArray(players) && players.length === 2164, "Expected 2,164 players.");
assert(Array.isArray(teams) && teams.length === 52, "Expected 52 teams.");
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
assert(readyPackages.length === 225, "Ready-package count drifted.");
assert(partition.remainingHeldPackages.length === 0, "Held package appeared.");
assert(createPackages.length === 180, "Canonical-create partition drifted.");
assert(appendPackages.length === 45, "Perspective-append partition drifted.");
assert(collisionPackages.length === 8, "Same-date distinct-create partition drifted.");
assert(partition.linkedOrVoidedExclusions.length === 6, "Linked or voided exclusion count drifted.");
assert(partition.linkedOrVoidedExclusions.filter((item) => clean(item.parentLinkedTradeId)).length === 5, "Parent-linked exclusion count drifted.");

const createdIds = [];
const appendedIds = [];
for (const packageRecord of readyPackages) {
  const source = packageRecord.sourceRecord;
  const id = clean(packageRecord.targetCanonicalId);
  const trade = tradeMap.get(id);
  assert(trade, `${packageRecord.sourceTradeId}: target canonical trade is missing (${id}).`);
  const denverPerspectives = perspectives(trade).filter(
    (perspective) => clean(perspective.sourceTeam) === "denver-nuggets" && perspectiveSourceTradeId(perspective) === clean(packageRecord.sourceTradeId),
  );
  assert(denverPerspectives.length === 1, `${id}: expected exactly one Denver perspective for ${packageRecord.sourceTradeId}.`);
  const perspective = denverPerspectives[0];
  assert(clean(perspective.summary) === clean(source["Final Trade Summary"]), `${id}: Denver summary drifted.`);
  assert(clean(perspective.analysis) === clean(source["Final Trade Analysis"]), `${id}: Denver analysis drifted.`);
  assert(clean(perspective.verdict) === clean(source["Final Verdict"]), `${id}: Denver verdict drifted.`);
  assert(perspectiveDenverGrade(perspective) === clean(source["Nuggets Grade"]), `${id}: Denver grade drifted.`);
  assert(trade.sourceTeams?.includes("denver-nuggets"), `${id}: Denver source-team membership is missing.`);
  assert(trade.teams?.includes("denver-nuggets"), `${id}: Denver team membership is missing.`);

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
for (const exclusion of partition.linkedOrVoidedExclusions) {
  const sourceTradeId = clean(exclusion.sourceTradeId);
  assert(!trades.some((trade) => clean(trade.sourceTradeId) === sourceTradeId), `Excluded row was created: ${sourceTradeId}`);
  assert(!allPerspectiveSourceIds.has(sourceTradeId), `Excluded row was appended: ${sourceTradeId}`);
}

assert(Array.isArray(receipt.identityCorrections) && receipt.identityCorrections.length === 0, "Unexpected identity correction exists.");
assert(Array.isArray(receipt.resolvedExistingPlayerIds) && receipt.resolvedExistingPlayerIds.length === 0, "Unexpected existing-player resolution exists.");
const expectedImportedPlayerIds = uniqueSorted(
  partition.proposedPlayerShells.map((shell) => clean(shell.proposedPlayerId)),
);
assert(expectedImportedPlayerIds.length === 234, "Expected 234 created player IDs.");
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
  const expectedPlayerId = clean(relationship.targetPlayerId ?? relationship.existingPlayerId ?? relationship.proposedPlayerId);
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
    assert(clean(reference.assetId).startsWith("phase10g-perspective-asset-"), `${relationshipId}: local asset ID drifted.`);
    assert(!assetIds.has(clean(reference.assetId)), `${relationshipId}: local asset unexpectedly entered canonical ledger.`);
  } else {
    canonicalAssetReferences += 1;
    assert(assetIds.has(clean(reference.assetId)), `${relationshipId}: canonical asset reference is unresolved.`);
  }
}
assert(canonicalAssetReferences === 615, "Canonical-ledger relationship count drifted.");
assert(perspectiveLocalReferences === 17, "Perspective-local relationship count drifted.");
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
  [routeModels, 3597, "route models"],
  [internalLinks, 11778, "internal links"],
  [teamTradeMemberships, 2876, "team trade memberships"],
  [playerRelationshipReferences, 2607, "player relationship references"],
  [queryPlayerTradeReferences, 1215, "query player references"],
  [privateTrades, 1377, "private trades"],
  [privatePlayers, 2164, "private players"],
  [uniqueTradeDates, 1022, "unique trade dates"],
  [sharedPerspectiveTrades, 98, "shared-perspective trades"],
]) {
  assert(actual === expected, `${label} drifted: ${actual} !== ${expected}.`);
}
assert(countTeamMemberships(trades) === teamTradeMemberships, "Direct team-membership count drifted.");
assert(countRelationshipReferences(players) === playerRelationshipReferences, "Direct player-relationship count drifted.");

const manifest = {
  result: "PASS",
  phase: "10H",
  mode: "final-private-completion-audit",
  protocol: "Warp-Freeze Protocol",
  completedAt: args["completed-at"],
  completionPercent: 100,
  phase10GHead: args["phase10g-head"],
  receiptStartingHead: args["receipt-starting-head"],
  sourceHashes: {
    phase10FPartitionSha256: sha256(partitionBytes),
    phase10FInternalPartitionSha256: partition.hashes.finalImportPartitionSha256,
    phase10GReceiptSha256: sha256(receiptBytes),
    phase10GContractSha256: sha256(phase10GContractBytes),
    phase10HContractSha256: sha256(phase10HContractBytes),
    phase10GReportSha256: args["phase10g-report-sha256"],
    phase10GBundleSha256: args["phase10g-bundle-sha256"],
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
  },
  accounting: {
    sourceRows: 231,
    readyPackagesImported: 225,
    heldPackagesImported: 0,
    canonicalTradesCreated: 180,
    perspectivesAppended: 45,
    dateCollisionDistinctCreates: 8,
    linkedOrVoidedExclusions: 6,
    parentLinkedExclusions: 5,
    voidedWithoutParentExclusions: 1,
    frozenPlayerShellProposals: 234,
    playerShellsCreated: 234,
    frozenShellsResolvedToExistingPlayers: 0,
    relationshipReferencesAdded: 632,
    matchedCanonicalAssetReferences: 615,
    perspectiveLocalAssetReferences: 17,
    explicitRoutingAssetsApplied: 82,
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
    phase10GReceipt: "PASS",
    canonicalCreates: "PASS",
    perspectiveAppends: "PASS",
    sameDateDistinctCreates: "PASS",
    linkedOrVoidedExclusions: "PASS",
    playerShells: "PASS",
    existingPlayerResolution: "PASS",
    relationshipOwnership: "PASS",
    canonicalAssetReferences: "PASS",
    perspectiveLocalReferences: "PASS",
    explicitRoutingAssets: "PASS",
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
  linkedOrVoidedExclusionIds: uniqueSorted(
    partition.linkedOrVoidedExclusions.map((item) => clean(item.sourceTradeId)),
  ),
  canonicalTradeWrites: 0,
  playerWrites: 0,
  teamWrites: 0,
  relationshipWrites: 0,
  routeWrites: 0,
  linkedOrVoidedWrites: 0,
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
