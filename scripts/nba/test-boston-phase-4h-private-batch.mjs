#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { buildPrivateRelationshipGraph } from "../../src/lib/nba/build-private-relationship-graph.mjs";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readPlayerId(player) {
  return String(
    player.id ?? player.playerId ?? player.slug ?? player.identity?.id ?? "",
  ).trim();
}

const args = parseArgs(process.argv);
for (const required of [
  "phase4e-freeze",
  "phase4g-resolution",
  "trades-json",
  "players-json",
  "teams-json",
  "receipt-json",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  phase4eBytes,
  phase4gBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  receiptBytes,
] = await Promise.all([
  readFile(args["phase4e-freeze"]),
  readFile(args["phase4g-resolution"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["receipt-json"]),
]);

const phase4e = JSON.parse(phase4eBytes.toString("utf8"));
const phase4g = JSON.parse(phase4gBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));

assert(receipt.result === "PASS" && receipt.phase === "4H", "Invalid Phase 4H receipt.");
assert(Array.isArray(trades), "Canonical store is not an array.");
assert(Array.isArray(players), "Player store is not an array.");
assert(Array.isArray(teams), "Team registry is not an array.");

assert(
  receipt.readyPackages + receipt.heldPackages === 211,
  "Import partition does not total 211.",
);
assert(
  receipt.sourceRows === 223 &&
    receipt.packagingActions === 211 &&
    receipt.excludedNonStandalone === 12,
  "Source accounting drifted.",
);
assert(
  receipt.relationshipEligiblePackageCount ===
    receipt.canonicalTradesAdded,
  "Relationship-eligible package count must equal imported canonical creates.",
);
assert(
  receipt.perspectiveRelationshipCandidatesSkipped >= 0,
  "Perspective relationship skip count is invalid.",
);
assert(
  receipt.postImportCanonicalTrades ===
    receipt.preImportCanonicalTrades + receipt.canonicalTradesAdded,
  "Canonical count arithmetic failed.",
);
assert(
  receipt.postImportPlayers ===
    receipt.preImportPlayers + receipt.playerShellsAdded,
  "Player count arithmetic failed.",
);
assert(trades.length === receipt.postImportCanonicalTrades, "Canonical store count differs from receipt.");
assert(players.length === receipt.postImportPlayers, "Player store count differs from receipt.");
assert(sha256(tradeBytes) === receipt.canonicalStoreSha256, "Canonical store hash differs from receipt.");
assert(sha256(playerBytes) === receipt.playerStoreSha256, "Player store hash differs from receipt.");

const tradeIds = trades.map((trade) => trade.id);
const tradeSlugs = trades.map((trade) => trade.slug);
const playerIds = players.map(readPlayerId);
const playerSlugs = players.map((player) => player.slug);

assert(new Set(tradeIds).size === tradeIds.length, "Duplicate canonical IDs.");
assert(new Set(tradeSlugs).size === tradeSlugs.length, "Duplicate canonical slugs.");
assert(new Set(playerIds).size === playerIds.length, "Duplicate player IDs.");
assert(new Set(playerSlugs).size === playerSlugs.length, "Duplicate player slugs.");

const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
const playerById = new Map(players.map((player) => [readPlayerId(player), player]));

let syntheticCanonicalAssetIdsFound = 0;

for (const canonicalId of receipt.importedCanonicalTradeIds) {
  const trade = tradeById.get(canonicalId);
  assert(trade, `${canonicalId}: imported canonical missing.`);
  assert(trade.importMetadata?.phase === "4H", `${canonicalId}: import metadata missing.`);

  const canonicalAssetIds = trade.assetLedger.map((asset) =>
    String(asset.assetId ?? "").trim()
  );
  assert(
    canonicalAssetIds.every(Boolean) &&
      new Set(canonicalAssetIds).size === canonicalAssetIds.length,
    `${canonicalId}: canonical asset IDs are missing or duplicated.`,
  );
  syntheticCanonicalAssetIdsFound += trade.assetLedger.filter(
    (asset) =>
      asset.syntheticAssetReference === true &&
      asset.sourceAssetId === null &&
      [
        "relationship-reference",
        "deterministic-canonical-asset-fields",
      ].includes(asset.syntheticAssetReferenceMethod) &&
      String(asset.syntheticAssetReferenceSource ?? "").length > 0,
  ).length;
  assert(
    trade.publishStatus === "private" &&
      trade.indexEligible === false &&
      trade.adEligible === false &&
      trade.publicationReady === false &&
      trade.automaticMerge === false,
    `${canonicalId}: privacy guard failed.`,
  );
  assert(
    trade.routingCompleteness === "complete" &&
      trade.unresolvedAssetRouting.length === 0 &&
      trade.assetLedger.every(
        (asset) =>
          asset.fromTeam &&
          asset.toTeam &&
          asset.type !== "other" &&
          asset.status !== "unclassified",
      ),
    `${canonicalId}: canonical routing/data guard failed.`,
  );
}

assert(
  syntheticCanonicalAssetIdsFound ===
    receipt.syntheticCanonicalAssetIdsAdded,
  "Synthetic canonical asset-ID count differs from receipt.",
);
assert(
  receipt.syntheticCanonicalAssetIdsAdded >= 1,
  "Expected at least one legacy synthetic canonical asset ID.",
);
assert(
  receipt.syntheticCanonicalAssetIdsAdded ===
    receipt.relationshipBackedSyntheticAssetIdsAdded +
      receipt.fieldDerivedSyntheticAssetIdsAdded,
  "Synthetic canonical asset-ID method counts do not reconcile.",
);
assert(
  receipt.fieldDerivedSyntheticAssetIdsAdded >= 1,
  "Expected at least one field-derived legacy canonical asset ID.",
);

for (const canonicalId of receipt.heldCanonicalTradeIds) {
  assert(!tradeById.has(canonicalId), `${canonicalId}: held canonical was imported.`);
}

for (const canonicalId of receipt.updatedPerspectiveCanonicalIds) {
  const trade = tradeById.get(canonicalId);
  assert(trade, `${canonicalId}: perspective target missing.`);
  assert(
    trade.sourceTeams.includes("boston-celtics") &&
      trade.perspectives?.["boston-celtics"],
    `${canonicalId}: Boston perspective missing.`,
  );
  assert(
    (trade.perspectiveReconciliations ?? []).some(
      (item) => item.phase === "4H" && item.sourceTeam === "boston-celtics",
    ),
    `${canonicalId}: Phase 4H reconciliation metadata missing.`,
  );
}

for (const playerId of receipt.importedPlayerIds) {
  const player = playerById.get(playerId);
  assert(player, `${playerId}: imported player missing.`);
  assert(player.importMetadata?.phase === "4H", `${playerId}: import metadata missing.`);
  assert(
    player.publishStatus === "private" &&
      player.indexEligible === false &&
      player.adEligible === false &&
      player.publicationReady === false &&
      player.automaticMerge === false,
    `${playerId}: player privacy guard failed.`,
  );
  assert(player.referenceCount > 0, `${playerId}: imported player has no references.`);
}

const relationshipIds = new Set(receipt.relationshipIds);
const perspectiveTargetIds = new Set(
  receipt.updatedPerspectiveCanonicalIds,
);
let foundRelationshipCount = 0;
for (const player of players) {
  for (const reference of player.sourceReferences ?? []) {
    if (relationshipIds.has(reference.edgeId)) {
      foundRelationshipCount += 1;
      assert(
        receipt.importedCanonicalTradeIds.includes(
          reference.canonicalTradeId,
        ),
        `${reference.edgeId}: relationship does not point to a newly imported canonical.`,
      );
      assert(
        !perspectiveTargetIds.has(reference.canonicalTradeId),
        `${reference.edgeId}: perspective-only package activated a player relationship.`,
      );
      assert(
        ["direct_player", "draft_rights", "draft_outcome"].includes(
          reference.referenceType,
        ),
        `${reference.edgeId}: unsupported active reference type ${reference.referenceType}.`,
      );
    }
  }
}
assert(
  foundRelationshipCount === receipt.relationshipReferencesAdded,
  "Imported relationship reference count differs from receipt.",
);

const perspectiveSourceTradeIds = new Set(
  phase4e.packages
    .filter((item) => item.packageKind === "perspective-append")
    .map((item) => item.sourceTradeId),
);
for (const player of players) {
  for (const reference of player.sourceReferences ?? []) {
    if (
      perspectiveTargetIds.has(reference.canonicalTradeId) &&
      perspectiveSourceTradeIds.has(reference.sourceTradeId)
    ) {
      throw new Error(
        `${reference.edgeId}: Boston perspective-only source relationship was activated.`,
      );
    }
  }
}

const readyStatuses = new Set(["dependency-clear", "ready-after-player-shell-import"]);
const expectedReady = phase4g.readiness
  .filter((item) => readyStatuses.has(item.finalEligibility))
  .map((item) => item.packageId)
  .sort();
const expectedHeld = phase4g.readiness
  .filter((item) => !readyStatuses.has(item.finalEligibility))
  .map((item) => item.packageId)
  .sort();

assert(
  JSON.stringify(expectedReady) === JSON.stringify(receipt.importedPackageIds),
  "Imported package IDs differ from Phase 4G partition.",
);
assert(
  JSON.stringify(expectedHeld) === JSON.stringify(receipt.heldPackageIds),
  "Held package IDs differ from Phase 4G partition.",
);

const relationshipGraph = buildPrivateRelationshipGraph({
  trades,
  players,
  teams,
});

function issueSample(items) {
  return JSON.stringify((items ?? []).slice(0, 12), null, 2);
}

assert(
  relationshipGraph.counts.invalidPlayerReferences === 0,
  `Invalid player references remain:\n${issueSample(
    relationshipGraph.issues.invalidPlayerReferences,
  )}`,
);
assert(
  relationshipGraph.counts.duplicateReferenceOwnership === 0,
  `Duplicate player-reference ownership remains:\n${issueSample(
    relationshipGraph.issues.duplicateReferenceOwnership,
  )}`,
);
assert(
  relationshipGraph.counts.extraPlayerReferences === 0,
  `Extra player references remain:\n${issueSample(
    relationshipGraph.issues.extraPlayerReferences,
  )}`,
);
assert(
  relationshipGraph.counts.missingPlayerReferences === 0,
  `Missing player references remain:\n${issueSample(
    relationshipGraph.issues.missingPlayerReferences,
  )}`,
);

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });

assert(
  query.counts?.canonicalTrades === receipt.postImportCanonicalTrades ||
    query.canonicalTrades === receipt.postImportCanonicalTrades,
  "Private-query canonical count drifted.",
);
assert(
  query.counts?.players === receipt.postImportPlayers ||
    query.players === receipt.postImportPlayers,
  "Private-query player count drifted.",
);

assert(
  routes.counts.tradeDetailModels === receipt.postImportCanonicalTrades,
  "Trade route-model count drifted.",
);
assert(
  routes.counts.playerDetailModels === receipt.postImportPlayers,
  "Player route-model count drifted.",
);
assert(
  routes.counts.routeModels ===
    4 +
      routes.counts.tradeDetailModels +
      routes.counts.playerDetailModels +
      routes.counts.teamDetailModels,
  "Route-model arithmetic failed.",
);
assert(routes.counts.brokenLinks === 0, "Broken private links exist.");
assert(routes.counts.privacyViolations === 0, "Private route-model privacy violation.");
assert(routes.counts.duplicatePaths === 0, "Duplicate private route path.");
assert(routes.counts.crossNamespaceLinks === 0, "NBA link leaves the private namespace.");

assert(receipt.automaticMerges === 0, "Automatic merge detected.");
assert(receipt.automaticRoutes === 0, "Automatic route detected.");
assert(receipt.publicationAuthorized === false, "Publication authorized.");
assert(receipt.pushPerformed === false, "Push marker changed.");
assert(receipt.deployPerformed === false, "Deploy marker changed.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "4H",
  verified: {
    sourceRows: 223,
    importedPackages: receipt.readyPackages,
    heldPackages: receipt.heldPackages,
    canonicalTradesAdded: receipt.canonicalTradesAdded,
    perspectivesAdded: receipt.perspectivesAdded,
    playerShellsAdded: receipt.playerShellsAdded,
    existingPlayersUpdated: receipt.existingPlayersUpdated,
    relationshipReferencesAdded: receipt.relationshipReferencesAdded,
    relationshipGraphMissingReferences:
      relationshipGraph.counts.missingPlayerReferences,
    relationshipGraphExtraReferences:
      relationshipGraph.counts.extraPlayerReferences,
    relationshipGraphInvalidReferences:
      relationshipGraph.counts.invalidPlayerReferences,
    relationshipGraphDuplicateOwnership:
      relationshipGraph.counts.duplicateReferenceOwnership,
    perspectiveRelationshipCandidatesSkipped:
      receipt.perspectiveRelationshipCandidatesSkipped,
    relationshipEligiblePackageCount:
      receipt.relationshipEligiblePackageCount,
    syntheticCanonicalAssetIdsAdded:
      receipt.syntheticCanonicalAssetIdsAdded,
    relationshipBackedSyntheticAssetIdsAdded:
      receipt.relationshipBackedSyntheticAssetIdsAdded,
    fieldDerivedSyntheticAssetIdsAdded:
      receipt.fieldDerivedSyntheticAssetIdsAdded,
    postImportCanonicalTrades: receipt.postImportCanonicalTrades,
    postImportPlayers: receipt.postImportPlayers,
    representedTeams:
      query.counts?.representedTeams ?? query.representedTeams?.length,
    routeModels: routes.counts.routeModels,
    tradeDetailModels: routes.counts.tradeDetailModels,
    playerDetailModels: routes.counts.playerDetailModels,
    teamDetailModels: routes.counts.teamDetailModels,
    internalLinks: routes.counts.internalLinks,
    sharedPerspectiveTradeModels: routes.counts.sharedPerspectiveTradeModels,
    brokenLinks: routes.counts.brokenLinks,
    privacyViolations: routes.counts.privacyViolations,
    automaticMerges: 0,
    automaticRoutes: 0,
  },
}, null, 2));
