#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sorted(values) {
  return [...values].sort((left, right) =>
    String(left).localeCompare(String(right), "en"),
  );
}

function readPlayerId(player) {
  return String(
    player.id ?? player.playerId ?? player.slug ?? player.identity?.id ?? "",
  ).trim();
}

function issueSample(items) {
  return JSON.stringify((items ?? []).slice(0, 12), null, 2);
}

const args = parseArgs(process.argv);
for (const required of [
  "phase4e-freeze",
  "phase4g-resolution",
  "trades-json",
  "players-json",
  "teams-json",
  "receipt-json",
  "output-json",
  "completed-at",
  "starting-head",
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

assert(phase4e.result === "PASS" && phase4e.phase === "4E", "Invalid Phase 4E freeze.");
assert(phase4g.result === "PASS" && phase4g.phase === "4G", "Invalid Phase 4G resolution.");
assert(receipt.result === "PASS" && receipt.phase === "4H", "Invalid Phase 4H receipt.");
assert(Array.isArray(trades), "Canonical trade store is not an array.");
assert(Array.isArray(players), "Player store is not an array.");
assert(Array.isArray(teams), "Team registry is not an array.");

assert(receipt.sourceRows === 223, "Boston source-row count drifted.");
assert(receipt.packagingActions === 211, "Boston package-action count drifted.");
assert(receipt.excludedNonStandalone === 12, "Excluded source-row count drifted.");
assert(
  receipt.readyPackages + receipt.heldPackages === 211,
  "Ready/held package partition no longer totals 211.",
);
assert(
  receipt.postImportCanonicalTrades === trades.length,
  "Canonical trade count differs from the Phase 4H receipt.",
);
assert(
  receipt.postImportPlayers === players.length,
  "Player count differs from the Phase 4H receipt.",
);
assert(
  sha256(tradeBytes) === receipt.canonicalStoreSha256,
  "Canonical trade store hash differs from the Phase 4H receipt.",
);
assert(
  sha256(playerBytes) === receipt.playerStoreSha256,
  "Player store hash differs from the Phase 4H receipt.",
);

const readyStatuses = new Set([
  "dependency-clear",
  "ready-after-player-shell-import",
]);
const expectedReadyPackageIds = sorted(
  phase4g.readiness
    .filter((item) => readyStatuses.has(item.finalEligibility))
    .map((item) => item.packageId),
);
const expectedHeldPackageIds = sorted(
  phase4g.readiness
    .filter((item) => !readyStatuses.has(item.finalEligibility))
    .map((item) => item.packageId),
);

assert(
  JSON.stringify(expectedReadyPackageIds) ===
    JSON.stringify(receipt.importedPackageIds),
  "Imported package IDs differ from the frozen Phase 4G partition.",
);
assert(
  JSON.stringify(expectedHeldPackageIds) ===
    JSON.stringify(receipt.heldPackageIds),
  "Held package IDs differ from the frozen Phase 4G partition.",
);

const packageById = new Map(
  phase4e.packages.map((item) => [item.packageId, item]),
);
assert(
  receipt.importedPackageIds.every((packageId) => packageById.has(packageId)),
  "An imported package is absent from the Phase 4E freeze.",
);
assert(
  receipt.heldPackageIds.every((packageId) => packageById.has(packageId)),
  "A held package is absent from the Phase 4E freeze.",
);

const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
const playerById = new Map(players.map((player) => [readPlayerId(player), player]));

for (const canonicalId of receipt.importedCanonicalTradeIds) {
  const trade = tradeById.get(canonicalId);
  assert(trade, `${canonicalId}: imported canonical trade is missing.`);
  assert(
    trade.sourceTeams.includes("boston-celtics") &&
      trade.perspectives?.["boston-celtics"],
    `${canonicalId}: Boston source perspective is missing.`,
  );
  assert(
    trade.importMetadata?.phase === "4H" &&
      trade.publishStatus === "private" &&
      trade.indexEligible === false &&
      trade.adEligible === false &&
      trade.publicationReady === false &&
      trade.automaticMerge === false,
    `${canonicalId}: private import metadata or visibility guard failed.`,
  );
  assert(
    trade.routingCompleteness === "complete" &&
      trade.unresolvedAssetRouting.length === 0 &&
      trade.assetLedger.every(
        (asset) =>
          asset.assetId &&
          asset.fromTeam &&
          asset.toTeam &&
          asset.type !== "other" &&
          asset.status !== "unclassified",
      ),
    `${canonicalId}: canonical routing or asset completeness failed.`,
  );
}

for (const canonicalId of receipt.updatedPerspectiveCanonicalIds) {
  const trade = tradeById.get(canonicalId);
  assert(trade, `${canonicalId}: updated perspective target is missing.`);
  assert(
    trade.sourceTeams.includes("boston-celtics") &&
      trade.perspectives?.["boston-celtics"],
    `${canonicalId}: appended Boston perspective is missing.`,
  );
  assert(
    (trade.perspectiveReconciliations ?? []).some(
      (entry) =>
        entry.phase === "4H" &&
        entry.sourceTeam === "boston-celtics",
    ),
    `${canonicalId}: Phase 4H reconciliation provenance is missing.`,
  );
}

for (const canonicalId of receipt.heldCanonicalTradeIds) {
  assert(
    !tradeById.has(canonicalId),
    `${canonicalId}: held canonical package was imported.`,
  );
}

for (const playerId of receipt.importedPlayerIds) {
  const player = playerById.get(playerId);
  assert(player, `${playerId}: imported player shell is missing.`);
  assert(
    player.importMetadata?.phase === "4H" &&
      player.publishStatus === "private" &&
      player.indexEligible === false &&
      player.adEligible === false &&
      player.publicationReady === false &&
      player.automaticMerge === false,
    `${playerId}: player visibility or import provenance failed.`,
  );
  assert(
    player.referenceCount > 0 &&
      player.sourceReferences.length === player.referenceCount,
    `${playerId}: player relationship count is invalid.`,
  );
}

const heldSourceTradeIds = new Set(
  receipt.heldPackageIds.map(
    (packageId) => packageById.get(packageId).sourceTradeId,
  ),
);
for (const player of players) {
  for (const reference of player.sourceReferences ?? []) {
    assert(
      !heldSourceTradeIds.has(reference.sourceTradeId),
      `${reference.edgeId}: held package relationship was activated.`,
    );
  }
}

const relationshipGraph = buildPrivateRelationshipGraph({
  trades,
  players,
  teams,
});

assert(
  relationshipGraph.counts.invalidPlayerReferences === 0,
  `Invalid player references:\n${issueSample(
    relationshipGraph.issues.invalidPlayerReferences,
  )}`,
);
assert(
  relationshipGraph.counts.duplicateReferenceOwnership === 0,
  `Duplicate player-reference ownership:\n${issueSample(
    relationshipGraph.issues.duplicateReferenceOwnership,
  )}`,
);
assert(
  relationshipGraph.counts.extraPlayerReferences === 0,
  `Extra player references:\n${issueSample(
    relationshipGraph.issues.extraPlayerReferences,
  )}`,
);
assert(
  relationshipGraph.counts.missingPlayerReferences === 0,
  `Missing player references:\n${issueSample(
    relationshipGraph.issues.missingPlayerReferences,
  )}`,
);

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });

const queryCanonicalTrades =
  query.counts?.canonicalTrades ?? query.canonicalTrades;
const queryPlayers =
  query.counts?.players ?? query.players;
const representedTeams =
  query.counts?.representedTeams ?? query.representedTeams?.length;

assert(
  queryCanonicalTrades === trades.length,
  "Private-query canonical trade count drifted.",
);
assert(
  queryPlayers === players.length,
  "Private-query player count drifted.",
);
assert(
  routes.counts.tradeDetailModels === trades.length,
  "Trade-detail route count drifted.",
);
assert(
  routes.counts.playerDetailModels === players.length,
  "Player-detail route count drifted.",
);
assert(
  routes.counts.routeModels ===
    4 +
      routes.counts.tradeDetailModels +
      routes.counts.playerDetailModels +
      routes.counts.teamDetailModels,
  "Private route-model arithmetic failed.",
);
assert(routes.counts.brokenLinks === 0, "Broken private NBA links exist.");
assert(routes.counts.privacyViolations === 0, "Private route visibility violation.");
assert(routes.counts.duplicatePaths === 0, "Duplicate NBA route path.");
assert(routes.counts.crossNamespaceLinks === 0, "NBA link escaped the private namespace.");

const bostonPerspectiveTrades = trades.filter(
  (trade) =>
    trade.sourceTeams?.includes("boston-celtics") &&
    trade.perspectives?.["boston-celtics"],
);
const sharedAtlantaBostonTrades = bostonPerspectiveTrades.filter(
  (trade) =>
    trade.sourceTeams?.includes("atlanta-hawks") &&
    trade.perspectives?.["atlanta-hawks"],
);
const bostonImportedPlayersWithReferences = players.filter(
  (player) =>
    (player.sourceReferences ?? []).some(
      (reference) =>
        receipt.importedCanonicalTradeIds.includes(
          reference.canonicalTradeId,
        ),
    ),
);

assert(
  bostonPerspectiveTrades.length >=
    receipt.canonicalTradesAdded + receipt.perspectivesAdded,
  "Boston perspective coverage is below the imported Phase 4H action count.",
);
assert(
  receipt.automaticMerges === 0 &&
    receipt.automaticRoutes === 0 &&
    receipt.publicationAuthorized === false &&
    receipt.pushPerformed === false &&
    receipt.deployPerformed === false,
  "Phase 4H safety flags changed.",
);

const manifest = {
  result: "PASS",
  phase: "4I",
  team: "boston-celtics",
  status: "PRIVATE_TECHNICAL_BATCH_COMPLETE",
  completionPercent: 100,
  completedAt: args["completed-at"],
  startingHead: args["starting-head"],
  sourcePhase4GCheckpoint:
    "b449a90796fa3562ca23684db662b68fd3d3f191",
  sourcePhase4HReceiptSha256: sha256(receiptBytes),
  sourcePhase4EFreezeSha256: sha256(phase4eBytes),
  sourcePhase4GResolutionSha256: sha256(phase4gBytes),
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  sourceAccounting: {
    sourceRows: receipt.sourceRows,
    packagingActions: receipt.packagingActions,
    importedPackages: receipt.readyPackages,
    heldPackages: receipt.heldPackages,
    excludedNonStandalone: receipt.excludedNonStandalone,
  },
  privateImport: {
    canonicalTradesAdded: receipt.canonicalTradesAdded,
    perspectivesAdded: receipt.perspectivesAdded,
    playerShellsAdded: receipt.playerShellsAdded,
    existingPlayersUpdated: receipt.existingPlayersUpdated,
    relationshipReferencesAdded: receipt.relationshipReferencesAdded,
    syntheticCanonicalAssetIdsAdded:
      receipt.syntheticCanonicalAssetIdsAdded,
    currentCanonicalTrades: trades.length,
    currentPlayers: players.length,
    bostonPerspectiveTrades: bostonPerspectiveTrades.length,
    sharedAtlantaBostonTrades: sharedAtlantaBostonTrades.length,
    bostonImportedPlayersWithReferences:
      bostonImportedPlayersWithReferences.length,
  },
  relationshipGraph: {
    missingPlayerReferences:
      relationshipGraph.counts.missingPlayerReferences,
    extraPlayerReferences:
      relationshipGraph.counts.extraPlayerReferences,
    invalidPlayerReferences:
      relationshipGraph.counts.invalidPlayerReferences,
    duplicateReferenceOwnership:
      relationshipGraph.counts.duplicateReferenceOwnership,
  },
  privateRoutes: {
    representedTeams,
    routeModels: routes.counts.routeModels,
    tradeDetailModels: routes.counts.tradeDetailModels,
    playerDetailModels: routes.counts.playerDetailModels,
    teamDetailModels: routes.counts.teamDetailModels,
    internalLinks: routes.counts.internalLinks,
    sharedPerspectiveTradeModels:
      routes.counts.sharedPerspectiveTradeModels,
    brokenLinks: routes.counts.brokenLinks,
    privacyViolations: routes.counts.privacyViolations,
    duplicatePaths: routes.counts.duplicatePaths,
    crossNamespaceLinks: routes.counts.crossNamespaceLinks,
  },
  completion: {
    editorialReview: true,
    canonicalReconciliation: true,
    routingFreeze: true,
    packagingFreeze: true,
    playerRelationshipFreeze: true,
    blockerResolution: true,
    guardedPrivateImport: true,
    completionAudit: true,
    publicPublication: false,
  },
  safety: {
    heldPackagesUntouched: true,
    automaticMerges: 0,
    automaticRoutes: 0,
    publicationAuthorized: false,
    indexEligible: false,
    adEligible: false,
    publicLinksAuthorized: false,
    sitemapInclusionAuthorized: false,
    pushPerformed: false,
    previewDeployPerformed: false,
    productionDeployPerformed: false,
  },
  importedPackageIds: receipt.importedPackageIds,
  heldPackageIds: receipt.heldPackageIds,
  importedCanonicalTradeIds: receipt.importedCanonicalTradeIds,
  updatedPerspectiveCanonicalIds:
    receipt.updatedPerspectiveCanonicalIds,
  importedPlayerIds: receipt.importedPlayerIds,
};

const outputBytes = canonicalJson(manifest);
await mkdir(path.dirname(args["output-json"]), { recursive: true });
await writeFile(args["output-json"], outputBytes);

console.log(JSON.stringify({
  result: "PASS",
  phase: "4I",
  status: manifest.status,
  completionPercent: manifest.completionPercent,
  importedPackages: manifest.sourceAccounting.importedPackages,
  heldPackages: manifest.sourceAccounting.heldPackages,
  currentCanonicalTrades:
    manifest.privateImport.currentCanonicalTrades,
  currentPlayers: manifest.privateImport.currentPlayers,
  bostonPerspectiveTrades:
    manifest.privateImport.bostonPerspectiveTrades,
  representedTeams: manifest.privateRoutes.representedTeams,
  routeModels: manifest.privateRoutes.routeModels,
  internalLinks: manifest.privateRoutes.internalLinks,
  relationshipGraphFailures:
    manifest.relationshipGraph.missingPlayerReferences +
    manifest.relationshipGraph.extraPlayerReferences +
    manifest.relationshipGraph.invalidPlayerReferences +
    manifest.relationshipGraph.duplicateReferenceOwnership,
  manifestSha256: sha256(outputBytes),
}, null, 2));
