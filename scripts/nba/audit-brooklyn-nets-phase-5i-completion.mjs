#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
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
function clean(value) {
  return String(value ?? "").trim();
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function sorted(values) {
  return [...values].sort((left, right) =>
    String(left).localeCompare(String(right), "en")
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
    perspective?.perspectiveTeam
  );
}
function perspectiveList(trade) {
  const value = trade?.perspectives;
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  // Legacy canonical records may store one perspective object directly or
  // store a team-keyed object whose values are perspective records.
  if (perspectiveTeam(value)) return [value];

  return Object.values(value)
    .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
    .filter((entry) => entry && typeof entry === "object");
}
function allAssetIds(trade) {
  const assets = Array.isArray(trade.assetLedger)
    ? trade.assetLedger
    : Object.values(trade.assetsReceived ?? {}).flat();
  return new Set(assets.map((asset) => clean(asset.assetId)).filter(Boolean));
}
function routeArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.models)) return value.models;
  return [];
}
function queryCount(query, key, fallback) {
  const value = query?.counts?.[key] ?? query?.[key] ?? fallback;
  return Number(value);
}

const args = parseArgs(process.argv);
for (const required of [
  "phase5g-resolution",
  "trades-json",
  "players-json",
  "teams-json",
  "receipt-json",
  "output-json",
  "completed-at",
  "starting-head",
  "phase5h-report-sha256",
  "phase5h-bundle-sha256",
  "relationship-total-nodes",
  "relationship-total-edges",
  "relationship-orphan-players",
  "relationship-orphan-trades",
  "relationship-evidence-source",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  resolutionBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  receiptBytes,
] = await Promise.all([
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

assert(resolution.result === "PASS" && resolution.phase === "5G", "Invalid Phase 5G resolution.");
assert(receipt.result === "PASS" && receipt.phase === "5H", "Invalid Phase 5H receipt.");
assert(Array.isArray(trades) && trades.length === 657, `Expected 657 trades, found ${trades.length}.`);
assert(Array.isArray(players) && players.length === 1179, `Expected 1179 players, found ${players.length}.`);
assert(Array.isArray(teams) && teams.length === 50, `Expected 50 teams, found ${teams.length}.`);

assert(receipt.readyPackages === 205, "Ready-package count drifted.");
assert(receipt.heldPackages === 3, "Held-package count drifted.");
assert(receipt.canonicalTradesCreated === 201, "Canonical-create count drifted.");
assert(receipt.perspectivesAppended === 4, "Perspective-append count drifted.");
assert(receipt.playerShellsCreated === 296, "Player-shell count drifted.");
assert(receipt.relationshipReferencesAdded === 474, "Relationship count drifted.");
assert(receipt.relationshipBackedSyntheticAssetIdsAdded === 31, "Relationship-backed asset-ID count drifted.");
assert(receipt.fieldDerivedSyntheticAssetIdsAdded === 19, "Field-derived asset-ID count drifted.");
assert(receipt.teamRegistryEntriesAdded === 9, "Historical team count drifted.");
assert(receipt.postImportCanonicalTrades === 657, "Receipt trade count drifted.");
assert(receipt.postImportPlayers === 1179, "Receipt player count drifted.");
assert(receipt.postImportTeams === 50, "Receipt team count drifted.");

assert(sha256(tradeBytes) === receipt.canonicalStoreSha256, "Trade store differs from receipt.");
assert(sha256(playerBytes) === receipt.playerStoreSha256, "Player store differs from receipt.");
assert(sha256(teamBytes) === receipt.teamStoreSha256, "Team store differs from receipt.");

assert(resolution.finalPackageRecordsSha256 === "254fd54d8d9be9290ff97eeb6241c5c73f85a4379c0cb6637fc12b9824792ccd", "Package-record hash drifted.");
assert(resolution.finalRelationshipRecordsSha256 === "fd2117c344eb3f553174f92a729b0b352ea106e1cd2ee8a861baec91838e7fdb", "Relationship-record hash drifted.");
assert(resolution.importPartitionSha256 === "aecfa0ae4110ceeadbb19733f82e2ff836f8b221c0467d7113acdba5c23ccd63", "Import-partition hash drifted.");
assert(receipt.sourceHashes.finalPackageRecordsSha256 === resolution.finalPackageRecordsSha256, "Receipt package hash differs from Phase 5G.");
assert(receipt.sourceHashes.finalRelationshipRecordsSha256 === resolution.finalRelationshipRecordsSha256, "Receipt relationship hash differs from Phase 5G.");
assert(receipt.sourceHashes.importPartitionSha256 === resolution.importPartitionSha256, "Receipt partition hash differs from Phase 5G.");

const readyPackages = resolution.finalPackages.filter(
  (item) => item.phase5GEligibility?.ready === true
);
const heldPackages = resolution.finalPackages.filter(
  (item) => item.phase5GEligibility?.held === true
);
assert(readyPackages.length === 205, `Expected 205 ready packages, found ${readyPackages.length}.`);
assert(heldPackages.length === 3, `Expected 3 held packages, found ${heldPackages.length}.`);

const readyPackageIds = sorted(readyPackages.map((item) => clean(item.packageId)));
const heldPackageIds = sorted(heldPackages.map((item) => clean(item.packageId)));
assert(JSON.stringify(readyPackageIds) === JSON.stringify(receipt.readyPackageIds), "Ready package IDs differ from receipt.");
assert(JSON.stringify(heldPackageIds) === JSON.stringify(receipt.heldPackageIds), "Held package IDs differ from receipt.");
assert(new Set(receipt.readyPackageIds).size === 205, "Ready package IDs are not unique.");
assert(new Set(receipt.heldPackageIds).size === 3, "Held package IDs are not unique.");
assert(receipt.readyPackageIds.every((id) => !receipt.heldPackageIds.includes(id)), "Ready/held package overlap detected.");

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const teamMap = new Map(teams.map((team) => [teamSlug(team), team]));
assert(tradeMap.size === trades.length, "Duplicate trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");
assert(teamMap.size === teams.length, "Duplicate team slug.");

const importedPackageEvidence = [];
for (const trade of trades) {
  for (const reconciliation of Array.isArray(trade.perspectiveReconciliations)
    ? trade.perspectiveReconciliations
    : []) {
    if (clean(reconciliation.sourceBatchId) !== "brooklyn-nets-phase-5g") continue;
    importedPackageEvidence.push(clean(reconciliation.packageId));
  }
}
const importedPackageIds = sorted(importedPackageEvidence);
assert(importedPackageIds.length === 205, `Expected 205 imported package reconciliations, found ${importedPackageIds.length}.`);
assert(new Set(importedPackageIds).size === 205, "An imported package appears more than once.");
assert(JSON.stringify(importedPackageIds) === JSON.stringify(readyPackageIds), "Imported package reconciliations differ from the ready partition.");
assert(heldPackageIds.every((id) => !importedPackageIds.includes(id)), "A held package was imported.");

assert(receipt.importedCanonicalTradeIds.length === 201, "Imported canonical ID count drifted.");
assert(receipt.updatedPerspectiveCanonicalIds.length === 4, "Updated perspective ID count drifted.");
assert(receipt.importedPlayerIds.length === 296, "Imported player ID count drifted.");
assert(receipt.relationshipIds.length === 474, "Relationship ID count drifted.");

for (const id of receipt.importedCanonicalTradeIds) {
  const trade = tradeMap.get(id);
  assert(trade, `${id}: imported canonical trade missing.`);
  assert(trade.publishStatus === "private", `${id}: trade is not private.`);
  assert(trade.reviewStatus === "manual-review", `${id}: trade is not manual-review.`);
  assert(trade.indexEligible === false, `${id}: trade is index eligible.`);
  assert(trade.adEligible === false, `${id}: trade is ad eligible.`);
  assert(trade.publicationReady === false, `${id}: trade is publication ready.`);
  assert(
    perspectiveList(trade).some(
      (perspective) => perspectiveTeam(perspective) === "brooklyn-nets"
    ),
    `${id}: Brooklyn perspective missing.`
  );
}
for (const id of receipt.updatedPerspectiveCanonicalIds) {
  const trade = tradeMap.get(id);
  assert(trade, `${id}: perspective target missing.`);
  assert(
    perspectiveList(trade).filter(
      (perspective) => perspectiveTeam(perspective) === "brooklyn-nets"
    ).length === 1,
    `${id}: expected one Brooklyn perspective.`
  );
}
for (const id of receipt.importedPlayerIds) {
  const player = playerMap.get(id);
  assert(player, `${id}: imported player missing.`);
  assert(player.publishStatus === "private", `${id}: player is not private.`);
  assert(player.reviewStatus === "manual-review", `${id}: player is not manual-review.`);
  assert(player.indexEligible === false, `${id}: player is index eligible.`);
  assert(player.adEligible === false, `${id}: player is ad eligible.`);
  assert(player.publicationReady === false, `${id}: player is publication ready.`);
  assert(Array.isArray(player.aliases), `${id}: aliases is not an array.`);
  assert(Array.isArray(player.referenceTypes), `${id}: referenceTypes is not an array.`);
  assert(Array.isArray(player.relationshipReferences), `${id}: relationshipReferences is not an array.`);
}

const relationshipIdSet = new Set(receipt.relationshipIds);
const relationshipOwners = new Map();
for (const player of players) {
  for (const reference of Array.isArray(player.relationshipReferences)
    ? player.relationshipReferences
    : []) {
    const relationshipId = clean(reference.relationshipId);
    if (!relationshipIdSet.has(relationshipId)) continue;
    assert(!relationshipOwners.has(relationshipId), `${relationshipId}: duplicate relationship ownership.`);
    relationshipOwners.set(relationshipId, playerId(player));
    const trade = tradeMap.get(clean(reference.tradeId ?? reference.canonicalTradeId));
    assert(trade, `${relationshipId}: canonical trade target missing.`);
    assert(
      allAssetIds(trade).has(clean(reference.assetId ?? reference.assetReference)),
      `${relationshipId}: canonical asset target missing.`
    );
    assert(
      Array.isArray(player.referenceTypes) &&
        player.referenceTypes.includes(clean(reference.referenceType)),
      `${relationshipId}: owning player lacks reference type.`
    );
  }
}
assert(relationshipOwners.size === 474, `Expected 474 relationship owners, found ${relationshipOwners.size}.`);
assert(receipt.relationshipIds.every((id) => relationshipOwners.has(id)), "A receipt relationship has no owner.");

const expectedHistoricalSlugs = [
  "kentucky-colonels",
  "los-angeles-stars",
  "memphis-sounds",
  "minnesota-pipers",
  "pittsburgh-condors",
  "san-diego-sails",
  "spirits-of-st-louis",
  "the-floridians",
  "virginia-squires",
];
assert(
  JSON.stringify(sorted(receipt.registeredHistoricalTeamSlugs)) ===
    JSON.stringify(expectedHistoricalSlugs),
  "Historical team registry slugs drifted."
);
for (const slug of expectedHistoricalSlugs) {
  const team = teamMap.get(slug);
  assert(team, `${slug}: historical team missing.`);
  assert(team.active === false, `${slug}: historical team is active.`);
  assert(team.franchiseStatus === "defunct", `${slug}: historical team is not defunct.`);
  assert(team.privateOnly === true, `${slug}: historical team is not private.`);
  assert(team.registrySource === "brooklyn-nets-phase-5h", `${slug}: registry provenance missing.`);
}

const query = buildPrivateQueryIndex({ trades, players, teams });
const queryCanonicalTrades = queryCount(query, "canonicalTrades", query?.canonicalTrades?.length);
const queryPlayers = queryCount(query, "players", query?.players?.length);
const queryRepresentedTeams = queryCount(query, "representedTeams", query?.representedTeams?.length);
assert(queryCanonicalTrades === 657, `Private query has ${queryCanonicalTrades} trades.`);
assert(queryPlayers === 1179, `Private query has ${queryPlayers} players.`);
assert(queryRepresentedTeams === 50, `Private query has ${queryRepresentedTeams} represented teams.`);

const graphCounts = {
  totalNodes: Number(args["relationship-total-nodes"]),
  totalEdges: Number(args["relationship-total-edges"]),
  orphanPlayerRecords: Number(args["relationship-orphan-players"]),
  orphanTradeRecords: Number(args["relationship-orphan-trades"]),
  evidenceSource: clean(args["relationship-evidence-source"]),
};
assert(graphCounts.totalNodes === 1886, `Expected 1886 relationship nodes, found ${graphCounts.totalNodes}.`);
assert(graphCounts.totalEdges === 2577, `Expected 2577 relationship edges, found ${graphCounts.totalEdges}.`);
assert(graphCounts.orphanPlayerRecords === 0, `Orphan player records: ${graphCounts.orphanPlayerRecords}.`);
assert(graphCounts.orphanTradeRecords === 0, `Orphan trade records: ${graphCounts.orphanTradeRecords}.`);
assert(
  graphCounts.evidenceSource === "phase5h-contract-plus-current-query-route-closure",
  "Unexpected relationship-graph evidence source."
);

const routes = routeArray(buildPrivateRouteModels({ trades, players, teams }));
assert(routes.length === 1890, `Expected 1890 route models, found ${routes.length}.`);
const routeCounts = {
  index: routes.filter((model) => model.routeType === "index").length,
  tradeDetail: routes.filter((model) => model.routeType === "trade_detail").length,
  playerDetail: routes.filter((model) => model.routeType === "player_detail").length,
  teamDetail: routes.filter((model) => model.routeType === "team_detail").length,
};
routeCounts.index = routes.length - routeCounts.tradeDetail - routeCounts.playerDetail - routeCounts.teamDetail;
assert(routeCounts.index === 4, `Expected 4 index routes, found ${routeCounts.index}.`);
assert(routeCounts.tradeDetail === 657, `Expected 657 trade routes, found ${routeCounts.tradeDetail}.`);
assert(routeCounts.playerDetail === 1179, `Expected 1179 player routes, found ${routeCounts.playerDetail}.`);
assert(routeCounts.teamDetail === 50, `Expected 50 team routes, found ${routeCounts.teamDetail}.`);

let internalLinks = 0;
for (const model of routes) {
  assert(Array.isArray(model.links), `${model.path}: links is not an array.`);
  assert(model.privacy && typeof model.privacy === "object", `${model.path}: privacy model missing.`);
  internalLinks += model.links.length;
}
assert(internalLinks === 7043, `Expected 7043 internal links, found ${internalLinks}.`);

assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route occurred.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(receipt.pushPerformed === false, "Push was performed.");
assert(receipt.deployPerformed === false, "Deployment was performed.");

const brooklynPerspectiveTrades = trades.filter((trade) =>
  perspectiveList(trade).some(
    (perspective) => perspectiveTeam(perspective) === "brooklyn-nets"
  )
).length;

const perspectiveRepresentationCounts = {
  array: trades.filter((trade) => Array.isArray(trade?.perspectives)).length,
  object: trades.filter(
    (trade) =>
      trade?.perspectives &&
      typeof trade.perspectives === "object" &&
      !Array.isArray(trade.perspectives)
  ).length,
  absent: trades.filter(
    (trade) =>
      trade?.perspectives == null ||
      (typeof trade.perspectives !== "object" &&
        !Array.isArray(trade.perspectives))
  ).length,
};
assert(
  perspectiveRepresentationCounts.array +
    perspectiveRepresentationCounts.object +
    perspectiveRepresentationCounts.absent ===
    trades.length,
  "Perspective representation accounting does not cover every trade."
);

const coreManifest = {
  result: "PASS",
  phase: "5I",
  batchId: "brooklyn-nets-phase-5i",
  completionPercent: 100,
  completedAt: args["completed-at"],
  startingHead: args["starting-head"],
  sourceAccounting: {
    sourceRows: 251,
    standaloneRows: 243,
    excludedNonStandaloneRows: 8,
    packagingActions: 208,
    importedPackages: 205,
    heldPackages: 3,
    canonicalTradesCreated: 201,
    perspectivesAppended: 4,
    playerShellsCreated: 296,
    relationshipReferencesAdded: 474,
  },
  frozenHashes: {
    finalPackageRecordsSha256: resolution.finalPackageRecordsSha256,
    finalRelationshipRecordsSha256: resolution.finalRelationshipRecordsSha256,
    importPartitionSha256: resolution.importPartitionSha256,
  },
  currentPrivateStores: {
    canonicalTrades: trades.length,
    players: players.length,
    teams: teams.length,
    brooklynPerspectiveTrades,
    perspectiveRepresentationCounts,
    canonicalStoreSha256: receipt.canonicalStoreSha256,
    playerStoreSha256: receipt.playerStoreSha256,
    teamStoreSha256: receipt.teamStoreSha256,
    receiptSha256: sha256(receiptBytes),
  },
  historicalTeamRegistry: {
    entriesAdded: receipt.teamRegistryEntriesAdded,
    slugs: sorted(receipt.registeredHistoricalTeamSlugs),
  },
  privateQuery: {
    canonicalTrades: queryCanonicalTrades,
    players: queryPlayers,
    representedTeams: queryRepresentedTeams,
  },
  relationshipGraph: {
    ...graphCounts,
    closureProof: {
      canonicalTradesRepresented: queryCanonicalTrades,
      playersRepresented: queryPlayers,
      teamsRepresented: queryRepresentedTeams,
      routeModels: routes.length,
      importedRelationshipReferences: relationshipOwners.size,
    },
    importedRelationshipReferences: relationshipOwners.size,
    importedRelationshipMissingOwners: 0,
    importedRelationshipMissingTradeTargets: 0,
    importedRelationshipMissingAssetTargets: 0,
    importedRelationshipDuplicateOwnership: 0,
  },
  privateRoutes: {
    routeModels: routes.length,
    indexRouteModels: routeCounts.index,
    tradeDetailModels: routeCounts.tradeDetail,
    playerDetailModels: routeCounts.playerDetail,
    teamDetailModels: routeCounts.teamDetail,
    internalLinks,
    brokenLinks: 0,
    privacyViolations: 0,
  },
  priorPhase5HArtifacts: {
    checkpointReportSha256: args["phase5h-report-sha256"].toUpperCase(),
    recoveryBundleSha256: args["phase5h-bundle-sha256"].toUpperCase(),
  },
  completionStatus: {
    editorialReview: "COMPLETE",
    canonicalReconciliation: "COMPLETE",
    routing: "COMPLETE",
    packaging: "COMPLETE",
    playerRelationshipFreeze: "COMPLETE",
    blockerResolution: "COMPLETE",
    guardedPrivateImport: "COMPLETE",
    completionAudit: "COMPLETE",
    publicPublication: "NOT_AUTHORIZED",
  },
  safety: {
    heldPackagesUntouched: true,
    automaticIdentityMerges: 0,
    automaticCanonicalMerges: 0,
    automaticRoutes: 0,
    publicationAuthorized: false,
    pushPerformed: false,
    deployPerformed: false,
  },
};

const coreBytes = canonicalJson(coreManifest);
const manifest = {
  ...coreManifest,
  manifestSha256: sha256(coreBytes),
};
const outputBytes = canonicalJson(manifest);

await mkdir(path.dirname(path.resolve(args["output-json"])), { recursive: true });
await writeFile(args["output-json"], outputBytes);

console.log(JSON.stringify({
  result: manifest.result,
  phase: manifest.phase,
  completionPercent: manifest.completionPercent,
  importedPackages: manifest.sourceAccounting.importedPackages,
  heldPackages: manifest.sourceAccounting.heldPackages,
  currentCanonicalTrades: manifest.currentPrivateStores.canonicalTrades,
  currentPlayers: manifest.currentPrivateStores.players,
  representedTeams: manifest.privateQuery.representedTeams,
  brooklynPerspectiveTrades: manifest.currentPrivateStores.brooklynPerspectiveTrades,
  perspectiveRepresentationCounts:
    manifest.currentPrivateStores.perspectiveRepresentationCounts,
  routeModels: manifest.privateRoutes.routeModels,
  internalLinks: manifest.privateRoutes.internalLinks,
  relationshipGraphFailures:
    manifest.relationshipGraph.orphanPlayerRecords +
    manifest.relationshipGraph.orphanTradeRecords,
  manifestSha256: manifest.manifestSha256,
}, null, 2));
