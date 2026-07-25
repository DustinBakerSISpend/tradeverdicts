#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key}`);
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
  return createHash("sha256").update(value).digest("hex");
}
function playerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id);
}
function tradeId(trade) {
  return clean(trade.id ?? trade.tradeId);
}
function perspectiveTeam(perspective) {
  return clean(
    perspective.sourceTeam ??
    perspective.teamId ??
    perspective.team ??
    perspective.perspectiveTeam
  );
}
function teamSlug(team) {
  return clean(team.slug ?? team.id ?? team.teamId);
}
function tradeTeamSlugs(trade) {
  const slugs = new Set(Array.isArray(trade.teams) ? trade.teams.map(clean) : []);
  for (const slug of Object.keys(trade.assetsReceived ?? {})) slugs.add(clean(slug));
  for (const slug of Object.keys(trade.assetsSent ?? {})) slugs.add(clean(slug));
  for (const asset of Array.isArray(trade.assetLedger) ? trade.assetLedger : []) {
    slugs.add(clean(asset.fromTeam));
    slugs.add(clean(asset.toTeam));
  }
  return [...slugs].filter(Boolean);
}
function allAssetIds(trade) {
  const assets = Array.isArray(trade.assetLedger)
    ? trade.assetLedger
    : Object.values(trade.assetsReceived ?? {}).flat();
  return new Set(assets.map((asset) => clean(asset.assetId)).filter(Boolean));
}

const args = parseArgs(process.argv);
for (const required of [
  "phase5g-resolution",
  "trades-json",
  "players-json",
  "teams-json",
  "receipt-json",
]) assert(args[required], `Missing --${required}`);

const [resolutionBytes, tradeBytes, playerBytes, teamBytes, receiptBytes] = await Promise.all([
  readFile(args["phase5g-resolution"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["receipt-json"]),
]);

const resolution = JSON.parse(resolutionBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));

assert(resolution.result === "PASS" && resolution.phase === "5G", "Invalid Phase 5G source.");
assert(receipt.result === "PASS" && receipt.phase === "5H", "Invalid Phase 5H receipt.");
assert(Array.isArray(trades) && trades.length === 657, `Expected 657 canonical trades, found ${trades.length}.`);
assert(Array.isArray(players) && players.length === 1179, `Expected 1179 players, found ${players.length}.`);
assert(Array.isArray(teams), "Team store is not an array.");
assert(receipt.preImportTeams === 41, "Pre-import team count drifted.");
assert(receipt.teamRegistryEntriesAdded > 0, "No historical team registry entries were added.");
assert(
  teams.length === receipt.postImportTeams &&
    receipt.postImportTeams === receipt.preImportTeams + receipt.teamRegistryEntriesAdded,
  "Post-import team count does not match the receipt."
);

assert(receipt.readyPackages === 205, "Imported package count drifted.");
assert(receipt.heldPackages === 3, "Held package count drifted.");
assert(receipt.canonicalTradesCreated === 201, "Canonical-create import count drifted.");
assert(receipt.perspectivesAppended === 4, "Perspective append count drifted.");
assert(receipt.playerShellsCreated === 296, "Player-shell count drifted.");
assert(receipt.relationshipReferencesAdded === 474, "Relationship-reference count drifted.");
assert(receipt.postImportCanonicalTrades === 657, "Post-import trade count drifted.");
assert(receipt.postImportPlayers === 1179, "Post-import player count drifted.");
assert(receipt.postImportTeams === teams.length, "Post-import team count drifted.");
assert(receipt.repositoryDataWrites === 4, "Repository data-write count drifted.");
assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Canonical store hash differs from receipt.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Player store hash differs from receipt.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Team store hash differs from receipt.");
assert(receipt.sourceHashes.finalPackageRecordsSha256 === resolution.finalPackageRecordsSha256, "Frozen package hash mismatch.");
assert(receipt.sourceHashes.finalRelationshipRecordsSha256 === resolution.finalRelationshipRecordsSha256, "Frozen relationship hash mismatch.");
assert(receipt.sourceHashes.importPartitionSha256 === resolution.importPartitionSha256, "Frozen partition hash mismatch.");

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const teamMap = new Map(teams.map((team) => [teamSlug(team), team]));
assert(tradeMap.size === trades.length, "Duplicate canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");
assert(teamMap.size === teams.length, "Duplicate team registry slug.");
for (const trade of trades) {
  for (const slug of tradeTeamSlugs(trade)) {
    assert(teamMap.has(slug), `${trade.sourceTradeId ?? trade.id}: unknown team ${slug}`);
  }
}
for (const slug of receipt.registeredHistoricalTeamSlugs) {
  const team = teamMap.get(slug);
  assert(team, `Registered historical team missing: ${slug}`);
  assert(team.active === false, `${slug}: historical registry entry is active.`);
  assert(team.franchiseStatus === "defunct", `${slug}: historical registry entry is not defunct.`);
  assert(team.registrySource === "brooklyn-nets-phase-5h", `${slug}: registry provenance missing.`);
}

for (const id of receipt.importedCanonicalTradeIds) {
  const trade = tradeMap.get(id);
  assert(trade, `Imported canonical trade missing: ${id}`);
  assert(trade.publishStatus === "private", `${id}: imported trade is not private.`);
  assert(trade.reviewStatus === "manual-review", `${id}: imported trade is not manual-review.`);
  assert(
    trade.importReviewStatus === "private-imported-nets-phase-5h",
    `${id}: imported trade provenance status is missing.`
  );
  assert(trade.indexEligible === false, `${id}: imported trade is index eligible.`);
  assert(trade.adEligible === false, `${id}: imported trade is ad eligible.`);
  assert(trade.publicationReady === false, `${id}: imported trade is publication ready.`);
  assert(
    Array.isArray(trade.perspectives) &&
      trade.perspectives.some((item) => perspectiveTeam(item) === "brooklyn-nets"),
    `${id}: Brooklyn perspective missing.`
  );
  const assetIds = allAssetIds(trade);
  assert(assetIds.size > 0, `${id}: imported trade has no asset IDs.`);
}

for (const id of receipt.updatedPerspectiveCanonicalIds) {
  const trade = tradeMap.get(id);
  assert(trade, `Perspective target missing: ${id}`);
  const nets = (trade.perspectives ?? []).filter(
    (item) => perspectiveTeam(item) === "brooklyn-nets"
  );
  assert(nets.length === 1, `${id}: expected exactly one Brooklyn perspective.`);
}

for (const id of receipt.importedPlayerIds) {
  const player = playerMap.get(id);
  assert(player, `Imported player shell missing: ${id}`);
  assert(player.publishStatus === "private", `${id}: player shell is not private.`);
  assert(player.reviewStatus === "manual-review", `${id}: player shell is not manual-review.`);
  assert(
    player.importReviewStatus === "private-shell-imported-nets-phase-5h",
    `${id}: player-shell provenance status is missing.`
  );
  assert(player.indexEligible === false, `${id}: player shell is index eligible.`);
  assert(player.adEligible === false, `${id}: player shell is ad eligible.`);
  assert(player.publicationReady === false, `${id}: player shell is publication ready.`);
  assert(Array.isArray(player.aliases), `${id}: player aliases must be an array.`);
  assert(
    Array.isArray(player.referenceTypes),
    `${id}: player referenceTypes must be an array.`
  );
  assert(
    Array.isArray(player.relationshipReferences),
    `${id}: player relationshipReferences must be an array.`
  );
}

const relationshipOwners = new Map();
let relationshipCount = 0;
for (const player of players) {
  for (const reference of Array.isArray(player.relationshipReferences)
    ? player.relationshipReferences
    : []) {
    if (!receipt.relationshipIds.includes(reference.relationshipId)) continue;
    relationshipCount += 1;
    assert(!relationshipOwners.has(reference.relationshipId), `Relationship has duplicate owners: ${reference.relationshipId}`);
    relationshipOwners.set(reference.relationshipId, playerId(player));

    const trade = tradeMap.get(clean(reference.tradeId ?? reference.canonicalTradeId));
    assert(trade, `${reference.relationshipId}: trade target missing.`);
    const assetIds = allAssetIds(trade);
    assert(assetIds.has(clean(reference.assetId ?? reference.assetReference)), `${reference.relationshipId}: asset target missing.`);
    assert(
      Array.isArray(player.referenceTypes) &&
        player.referenceTypes.includes(clean(reference.referenceType)),
      `${reference.relationshipId}: owning player lacks reference type ${reference.referenceType}.`
    );
  }
}
assert(relationshipCount === 474, `Expected 474 imported relationship references, found ${relationshipCount}.`);
assert(relationshipOwners.size === 474, "Relationship ownership count drifted.");

const builtRouteModels = buildPrivateRouteModels({ trades, players, teams });
const routeModels = Array.isArray(builtRouteModels)
  ? builtRouteModels
  : Array.isArray(builtRouteModels?.models)
    ? builtRouteModels.models
    : [];

assert(routeModels.length === 1890, `Expected 1890 private route models, found ${routeModels.length}.`);

const playerDetailModels = routeModels.filter(
  (model) => model.routeType === "player_detail"
);
const tradeDetailModels = routeModels.filter(
  (model) => model.routeType === "trade_detail"
);
const teamDetailModels = routeModels.filter(
  (model) => model.routeType === "team_detail"
);

assert(
  playerDetailModels.length === 1179,
  `Expected 1179 player-detail models, found ${playerDetailModels.length}.`
);
assert(
  tradeDetailModels.length === 657,
  `Expected 657 trade-detail models, found ${tradeDetailModels.length}.`
);
assert(
  teamDetailModels.length === 50,
  `Expected 50 team-detail models, found ${teamDetailModels.length}.`
);

for (const model of routeModels) {
  assert(Array.isArray(model.links), `${model.path}: route-model links must be an array.`);
  assert(model.privacy && typeof model.privacy === "object", `${model.path}: privacy model missing.`);
}
for (const model of playerDetailModels) {
  assert(Array.isArray(model.aliases), `${model.path}: aliases must be an array.`);
  assert(
    Array.isArray(model.referenceTypes),
    `${model.path}: referenceTypes must be an array.`
  );
  model.aliases.join(", ");
  model.referenceTypes.join(", ");
}
for (const model of tradeDetailModels) {
  assert(
    Array.isArray(model.perspectiveTeams),
    `${model.path}: perspectiveTeams must be an array.`
  );
  model.perspectiveTeams.join(", ");
}

for (const id of receipt.heldCanonicalTradeIds) {
  assert(!tradeMap.has(id), `Held canonical target was imported: ${id}`);
}

assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route occurred.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(receipt.pushPerformed === false, "Push was performed.");
assert(receipt.deployPerformed === false, "Deployment was performed.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "5H",
  verified: {
    importedPackages: receipt.readyPackages,
    heldPackages: receipt.heldPackages,
    canonicalTradesCreated: receipt.canonicalTradesCreated,
    perspectivesAppended: receipt.perspectivesAppended,
    playerShellsCreated: receipt.playerShellsCreated,
    relationshipReferencesAdded: receipt.relationshipReferencesAdded,
    postImportCanonicalTrades: receipt.postImportCanonicalTrades,
    postImportPlayers: receipt.postImportPlayers,
    teams: teams.length,
    teamRegistryEntriesAdded: receipt.teamRegistryEntriesAdded,
    relationshipGraphMissingReferences: 0,
    relationshipGraphExtraReferences: 0,
    relationshipGraphInvalidReferences: 0,
    relationshipGraphDuplicateOwnership: 0,
    renderShapeRouteModels: routeModels.length,
    renderShapePlayerModels: playerDetailModels.length,
    renderShapeTradeModels: tradeDetailModels.length,
    renderShapeTeamModels: teamDetailModels.length,
    renderJoinPreflight: "PASS",
  },
  canonicalStoreSha256: receipt.canonicalStoreSha256,
  playerStoreSha256: receipt.playerStoreSha256,
  teamStoreSha256: receipt.teamStoreSha256,
  receiptSha256: sha256(receiptBytes),
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  automaticRoutes: 0,
}, null, 2));
