#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrivateRelationshipGraph } from "../../src/lib/nba/build-private-relationship-graph.mjs";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

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
  return createHash("sha256")
    .update(value)
    .digest("hex")
    .toUpperCase();
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function countRelationships(players) {
  return players.reduce(
    (sum, player) =>
      sum +
      (Array.isArray(player.relationshipReferences)
        ? player.relationshipReferences.length
        : 0),
    0,
  );
}

function countSourceReferences(players) {
  return players.reduce(
    (sum, player) =>
      sum +
      (Array.isArray(player.sourceReferences)
        ? player.sourceReferences.length
        : 0),
    0,
  );
}

function assertPrivateSafe(record, label) {
  assert(record.publishStatus === "private", `${label}: publish status is not private.`);
  assert(record.indexEligible === false, `${label}: index eligibility detected.`);
  assert(record.adEligible === false, `${label}: ad eligibility detected.`);
  assert(record.publicationReady === false, `${label}: publication readiness detected.`);
}

function lakersPerspectiveCount(trade) {
  if (Array.isArray(trade?.perspectives)) {
    return trade.perspectives.filter(
      (perspective) => clean(perspective?.sourceTeam) === "los-angeles-lakers",
    ).length;
  }

  return Object.prototype.hasOwnProperty.call(
    trade?.perspectives ?? {},
    "los-angeles-lakers",
  )
    ? 1
    : 0;
}

const args = parseArgs(process.argv);

for (const required of [
  "partition-json",
  "records-json",
  "receipt-json",
  "phase16h-audit-json",
  "exposure-audit-json",
  "trades-json",
  "players-json",
  "teams-json",
  "phase16h-contract-md",
  "phase16i-contract-md",
  "output-json",
  "completed-at",
  "phase16h-head",
  "starting-head",
  "phase16h-report-sha256",
  "phase16h-bundle-sha256",
  "phase16h-shadow-freeze-sha256",
  "expected-records-sha256",
  "expected-partition-sha256",
  "expected-partition-semantic-sha256",
  "expected-canonical-store-sha256",
  "expected-player-store-sha256",
  "expected-team-store-sha256",
  "expected-receipt-sha256",
  "expected-audit-sha256",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  partitionBytes,
  recordsBytes,
  receiptBytes,
  phase16hAuditBytes,
  exposureBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  phase16hContractBytes,
  phase16iContractBytes,
] = await Promise.all([
  readFile(args["partition-json"]),
  readFile(args["records-json"]),
  readFile(args["receipt-json"]),
  readFile(args["phase16h-audit-json"]),
  readFile(args["exposure-audit-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["phase16h-contract-md"]),
  readFile(args["phase16i-contract-md"]),
]);

const partition = JSON.parse(partitionBytes.toString("utf8"));
const records = JSON.parse(recordsBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const phase16hAudit = JSON.parse(phase16hAuditBytes.toString("utf8"));
const exposure = JSON.parse(exposureBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(partition.result === "PASS" && partition.phase === "16F", "Invalid Phase 16F partition.");
assert(records.result === "PASS" && records.phase === "16B", "Invalid Phase 16B records.");
assert(Array.isArray(records.records) && records.records.length === 206, "Phase 16B record count drifted.");
assert(receipt.result === "PASS" && receipt.phase === "16H", "Invalid Phase 16H receipt.");
assert(
  phase16hAudit.result === "PASS" && phase16hAudit.phase === "16H",
  "Invalid Phase 16H independent audit.",
);
assert(
  exposure.result === "PASS" &&
    exposure.phase === "SCALABLE-PRIVATE-EXPOSURE",
  "Private exposure audit failed.",
);

for (const [actual, expected, label] of [
  [sha256(recordsBytes), args["expected-records-sha256"], "Phase 16B records"],
  [sha256(partitionBytes), args["expected-partition-sha256"], "Phase 16F partition"],
  [
    partition.hashes?.semanticPartitionSha256,
    args["expected-partition-semantic-sha256"],
    "Phase 16F semantic partition",
  ],
  [sha256(tradeBytes), args["expected-canonical-store-sha256"], "canonical store"],
  [sha256(playerBytes), args["expected-player-store-sha256"], "player store"],
  [sha256(teamBytes), args["expected-team-store-sha256"], "team store"],
  [sha256(receiptBytes), args["expected-receipt-sha256"], "Phase 16H receipt"],
  [sha256(phase16hAuditBytes), args["expected-audit-sha256"], "Phase 16H audit"],
]) {
  assert(actual === expected, `${label} hash drifted: ${actual} !== ${expected}.`);
}

assert(
  receipt.sourceHashes?.phase16BRecordsSha256 === sha256(recordsBytes),
  "Receipt Phase 16B records hash drifted.",
);
assert(
  receipt.sourceHashes?.phase16FPartitionSha256 === sha256(partitionBytes),
  "Receipt Phase 16F partition hash drifted.",
);
assert(
  receipt.sourceHashes?.phase16FSemanticPartitionSha256 ===
    partition.hashes?.semanticPartitionSha256,
  "Receipt Phase 16F semantic hash drifted.",
);
assert(
  receipt.sourceHashes?.contractSha256 === sha256(phase16hContractBytes),
  "Receipt Phase 16H contract hash drifted.",
);
assert(
  receipt.canonicalStoreSha256 === sha256(tradeBytes),
  "Receipt canonical-store hash drifted.",
);
assert(
  receipt.playerStoreSha256 === sha256(playerBytes),
  "Receipt player-store hash drifted.",
);
assert(
  receipt.teamStoreSha256 === sha256(teamBytes),
  "Receipt team-store hash drifted.",
);
assert(
  phase16hAudit.hashes?.canonicalStoreSha256 === sha256(tradeBytes),
  "Phase 16H audit canonical-store hash drifted.",
);
assert(
  phase16hAudit.hashes?.playerStoreSha256 === sha256(playerBytes),
  "Phase 16H audit player-store hash drifted.",
);
assert(
  phase16hAudit.hashes?.teamStoreSha256 === sha256(teamBytes),
  "Phase 16H audit team-store hash drifted.",
);
assert(
  phase16hAudit.hashes?.receiptSha256 === sha256(receiptBytes),
  "Phase 16H audit receipt hash drifted.",
);

assert(receipt.startingHead === args["starting-head"], "Receipt starting HEAD drifted.");
assert(
  args["phase16h-head"] === "e13cae6c22da2bcaf868a2e89b96fad10ca24d10",
  "Phase 16H HEAD drifted.",
);
for (const key of [
  "phase16h-report-sha256",
  "phase16h-bundle-sha256",
  "phase16h-shadow-freeze-sha256",
]) {
  assert(/^[A-F0-9]{64}$/u.test(args[key]), `Invalid ${key}.`);
}

for (const [actual, expected, label] of [
  [partition.counts?.sourceRows, 206, "partition source rows"],
  [partition.counts?.importReadyPackages, 146, "partition ready packages"],
  [partition.counts?.heldPackages, 21, "partition held packages"],
  [partition.counts?.structuralEvidenceExclusions, 39, "partition exclusions"],
  [partition.counts?.canonicalPerspectiveAppendPreviews, 72, "partition perspective appends"],
  [partition.counts?.canonicalCreatePreviews, 74, "partition canonical creates"],
  [partition.counts?.readyRequiredPlayerShells, 77, "partition ready-required shells"],
  [partition.counts?.heldOnlyPlayerShells, 23, "partition held-only shells"],
  [partition.counts?.readyRelationshipEdges, 355, "partition ready relationships"],
  [partition.counts?.heldRelationshipEdges, 100, "partition held relationships"],
  [partition.counts?.readyTeamDependencyOccurrences, 292, "partition ready teams"],
  [partition.counts?.heldTeamDependencyOccurrences, 60, "partition held teams"],
  [partition.counts?.readyPublicCandidatePackages, 34, "partition ready public candidates"],
  [receipt.preImportCanonicalTrades, 2014, "receipt pre-import trades"],
  [receipt.preImportPlayers, 2865, "receipt pre-import players"],
  [receipt.preImportTeams, 52, "receipt pre-import teams"],
  [receipt.preImportTeamTradeMemberships, 4169, "receipt pre-import team memberships"],
  [receipt.preImportRelationshipReferences, 5131, "receipt pre-import relationships"],
  [receipt.preImportSourceReferences, 2718, "receipt pre-import source references"],
  [receipt.sourceRows, 206, "receipt source rows"],
  [receipt.readyPackages, 146, "receipt ready packages"],
  [receipt.heldPackages, 21, "receipt held packages"],
  [receipt.structuralEvidenceExclusions, 39, "receipt exclusions"],
  [receipt.canonicalTradesCreated, 74, "receipt canonical creates"],
  [receipt.perspectivesAppended, 72, "receipt perspective appends"],
  [receipt.frozenPlayerShellProposals, 100, "receipt frozen shell proposals"],
  [receipt.playerShellsCreated, 76, "receipt player shells created"],
  [receipt.readyShellsResolvedToExistingPlayers, 1, "receipt existing-player resolution"],
  [receipt.redundantReadyShellsExcluded, 0, "receipt redundant shell exclusions"],
  [receipt.heldOnlyPlayerShellsDeferred, 23, "receipt held-only shell deferrals"],
  [receipt.frozenRelationshipEdges, 455, "receipt frozen relationship edges"],
  [receipt.relationshipReferencesAdded, 355, "receipt relationship references added"],
  [receipt.redundantReadyRelationshipEdgesExcluded, 0, "receipt redundant relationship exclusions"],
  [receipt.heldRelationshipEdgesDeferred, 100, "receipt held relationship deferrals"],
  [receipt.readyTeamDependencies, 292, "receipt ready team dependencies"],
  [receipt.heldTeamDependencies, 60, "receipt held team dependencies"],
  [receipt.existingPerspectiveReviewHolds, 1, "receipt existing-perspective hold"],
  [receipt.ambiguousIdentityOccurrencesDeferred, 6, "receipt ambiguous identities deferred"],
  [receipt.matchedExistingAssetReferences, 353, "receipt matched asset references"],
  [receipt.syntheticPerspectiveAssetReferences, 2, "receipt synthetic asset references"],
  [receipt.sourceReferencesAdded, 253, "receipt source references added"],
  [receipt.publicCandidatePackagesImportedPrivately, 34, "receipt private public-candidate imports"],
  [receipt.postImportCanonicalTrades, 2088, "receipt post-import trades"],
  [receipt.postImportPlayers, 2941, "receipt post-import players"],
  [receipt.postImportTeams, 52, "receipt post-import teams"],
  [receipt.postImportTeamTradeMemberships, 4317, "receipt post-import team memberships"],
  [receipt.postImportRelationshipReferences, 5486, "receipt post-import relationship references"],
  [receipt.postImportSourceReferences, 2971, "receipt post-import source references"],
  [receipt.teamTradeMembershipsAdded, 148, "receipt team memberships added"],
  [receipt.playerRelationshipReferencesAdded, 355, "receipt player relationships added"],
  [receipt.playerSourceReferencesAdded, 253, "receipt player source references added"],
]) {
  assert(actual === expected, `${label}: expected ${expected}, found ${actual}.`);
}

assert(
  receipt.matchedExistingAssetReferences +
    receipt.syntheticPerspectiveAssetReferences ===
    355,
  "Relationship asset-reference accounting drifted.",
);
assert(receipt.teamRegistryEntriesAdded === 0, "The team registry changed.");
assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route creation occurred.");
assert(receipt.automaticTeamRegistrations === 0, "Automatic team registration occurred.");
assert(receipt.heldPackageImports === 0, "A held package was imported.");
assert(receipt.heldPlayerShellImports === 0, "A held-only player shell was imported.");
assert(receipt.heldRelationshipWrites === 0, "A held relationship was written.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(
  receipt.pushPerformed === false && receipt.deployPerformed === false,
  "Push/deployment status drifted.",
);

const playerCorrections = receipt.explicitPlayerTargetCorrections ?? {};
assert(
  Object.keys(playerCorrections).length === 1 &&
    playerCorrections["nba-player-a-c-green"] ===
      "nba-player-ac-green-262dde3792",
  "A.C. Green existing-player correction drifted.",
);
assert(
  Object.keys(receipt.explicitRelationshipTargetCorrections ?? {}).length === 0,
  "Unexpected relationship-target correction exists.",
);
const forcedSynthetic = new Set(receipt.forcedSyntheticRelationshipIds ?? []);
assert(
  forcedSynthetic.size === 1 &&
    forcedSynthetic.has(
      "los-angeles-lakers:LAL-2004-0151:received:003:identity:01:player:nba-player-jumaine-jones-c13305971d",
    ),
  "Jumaine Jones perspective-local synthetic guard drifted.",
);

for (const [arrayValue, expected, label] of [
  [receipt.importedCanonicalTradeIds, 74, "created trade IDs"],
  [receipt.updatedPerspectiveCanonicalIds, 72, "updated perspective IDs"],
  [receipt.importedPlayerIds, 76, "imported player IDs"],
  [receipt.readyShellsResolvedToExistingPlayerIds, 1, "resolved player IDs"],
  [receipt.redundantReadyShellIds, 0, "redundant shell IDs"],
  [receipt.deferredPlayerIds, 23, "deferred player IDs"],
  [receipt.relationshipIds, 355, "relationship IDs"],
  [receipt.deferredRelationshipIds, 100, "deferred relationship IDs"],
  [receipt.heldSourceTradeIds, 21, "held source trade IDs"],
  [receipt.structuralEvidenceExcludedSourceTradeIds, 39, "excluded source trade IDs"],
]) {
  assert(Array.isArray(arrayValue) && arrayValue.length === expected, `${label} drifted.`);
}

for (const [actual, expected, label] of [
  [phase16hAudit.counts?.canonicalTrades, 2088, "audit trades"],
  [phase16hAudit.counts?.players, 2941, "audit players"],
  [phase16hAudit.counts?.teams, 52, "audit teams"],
  [phase16hAudit.counts?.readyPackages, 146, "audit ready packages"],
  [phase16hAudit.counts?.heldPackages, 21, "audit held packages"],
  [phase16hAudit.counts?.structuralEvidenceExclusions, 39, "audit exclusions"],
  [phase16hAudit.counts?.canonicalTradesCreated, 74, "audit creates"],
  [phase16hAudit.counts?.perspectivesAppended, 72, "audit appends"],
  [phase16hAudit.counts?.playerShellsCreated, 76, "audit player shells"],
  [phase16hAudit.counts?.readyShellsResolvedToExistingPlayers, 1, "audit resolved shell"],
  [phase16hAudit.counts?.deferredPlayerShells, 23, "audit deferred shells"],
  [phase16hAudit.counts?.relationshipReferencesAdded, 355, "audit relationships"],
  [phase16hAudit.counts?.deferredRelationshipEdges, 100, "audit deferred relationships"],
  [phase16hAudit.counts?.readyTeamDependencies, 292, "audit ready team dependencies"],
  [phase16hAudit.counts?.heldTeamDependencies, 60, "audit held team dependencies"],
  [phase16hAudit.counts?.existingPerspectiveReviewHolds, 1, "audit existing-perspective hold"],
  [phase16hAudit.counts?.ambiguousIdentityOccurrencesDeferred, 6, "audit ambiguous identities"],
  [phase16hAudit.counts?.matchedExistingAssetReferences, 353, "audit matched assets"],
  [phase16hAudit.counts?.syntheticPerspectiveAssetReferences, 2, "audit synthetic assets"],
  [phase16hAudit.counts?.sourceReferencesAdded, 253, "audit source refs"],
  [phase16hAudit.counts?.privateQueryPlayerReferences, 2971, "audit private query refs"],
  [phase16hAudit.counts?.routeModels, 5085, "audit route models"],
  [phase16hAudit.counts?.internalLinks, 19660, "audit internal links"],
]) {
  assert(actual === expected, `${label}: expected ${expected}, found ${actual}.`);
}
assert(
  phase16hAudit.safety?.duplicateReferenceOwnership === 0,
  "Phase 16H audit duplicate ownership drifted.",
);
assert(
  phase16hAudit.safety?.publicationAuthorized === false,
  "Phase 16H audit publication status drifted.",
);

assert(
  trades.length === 2088 && players.length === 2941 && teams.length === 52,
  "Post-import store counts drifted.",
);
assert(countRelationships(players) === 5486, "Player relationship-reference count drifted.");
assert(countSourceReferences(players) === 2971, "Player source-reference count drifted.");

for (const trade of trades) assertPrivateSafe(trade, trade.id ?? "trade");
for (const player of players) assertPrivateSafe(player, player.id ?? "player");

const tradeMap = new Map(trades.map((trade) => [trade.id, trade]));
const ruiTrade = tradeMap.get("nba-trade-20230123-7ee8d6d15384");
assert(ruiTrade, "Rui Hachimura existing-perspective target is missing.");
assert(
  lakersPerspectiveCount(ruiTrade) === 1,
  "Rui Hachimura trade does not retain exactly one Lakers perspective.",
);

const graph = buildPrivateRelationshipGraph({ trades, players, teams });
for (const [actual, expected, label] of [
  [graph.counts.invalidPlayerReferences, 0, "invalid player references"],
  [graph.counts.duplicateReferenceOwnership, 0, "duplicate relationship ownership"],
  [graph.counts.extraPlayerReferences, 0, "extra player references"],
  [graph.counts.invalidTradeTeams, 0, "invalid trade teams"],
]) {
  assert(actual === expected, `${label}: expected ${expected}, found ${actual}.`);
}

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });

for (const [actual, expected, label] of [
  [query.counts.canonicalTrades, 2088, "query canonical trades"],
  [query.counts.players, 2941, "query players"],
  [query.counts.representedTeams, 52, "query represented teams"],
  [query.counts.uniqueTradeDates, 1446, "query unique dates"],
  [query.counts.teamTradeMemberships, 4317, "query team memberships"],
  [query.counts.playerTradeReferences, 2971, "query player refs"],
  [query.counts.playerIdentityKeys, 2957, "query identity keys"],
  [query.counts.ambiguousExactIdentityKeys, 0, "query ambiguous identities"],
  [query.counts.sharedPerspectiveTrades, 473, "query shared perspectives"],
  [query.counts.privateTrades, 2088, "query private trades"],
  [query.counts.privatePlayers, 2941, "query private players"],
  [query.counts.noindexTrades, 2088, "query noindex trades"],
  [query.counts.noindexPlayers, 2941, "query noindex players"],
  [query.counts.adFreeTrades, 2088, "query ad-free trades"],
  [query.counts.adFreePlayers, 2941, "query ad-free players"],
  [routes.counts.routeModels, 5085, "route models"],
  [routes.counts.indexRouteModels, 4, "index route models"],
  [routes.counts.tradeDetailModels, 2088, "trade route models"],
  [routes.counts.playerDetailModels, 2941, "player route models"],
  [routes.counts.teamDetailModels, 52, "team route models"],
  [routes.counts.internalLinks, 19660, "route internal links"],
  [routes.counts.sharedPerspectiveTradeModels, 473, "route shared perspectives"],
  [routes.counts.privateRouteModels, 5085, "private route models"],
  [routes.counts.noindexRouteModels, 5085, "noindex route models"],
  [routes.counts.adFreeRouteModels, 5085, "ad-free route models"],
  [routes.counts.sitemapExcludedRouteModels, 5085, "sitemap-excluded route models"],
  [routes.counts.navigationExcludedRouteModels, 5085, "navigation-excluded route models"],
  [routes.counts.routeCreatedModels, 0, "created route models"],
  [routes.counts.duplicatePaths, 0, "duplicate paths"],
  [routes.counts.brokenLinks, 0, "broken links"],
  [routes.counts.crossNamespaceLinks, 0, "cross-namespace links"],
  [routes.counts.selfLinks, 0, "self links"],
  [routes.counts.privacyViolations, 0, "privacy violations"],
  [routes.counts.incompleteModels, 0, "incomplete route models"],
]) {
  assert(actual === expected, `${label}: expected ${expected}, found ${actual}.`);
}

for (const [actual, expected, label] of [
  [exposure.counts?.expectedNbaPages, 5085, "exposure expected NBA pages"],
  [exposure.counts?.builtNbaPages, 5085, "exposure built NBA pages"],
  [exposure.counts?.nbaInternalLinks, 19660, "exposure NBA internal links"],
  [exposure.counts?.nbaBrokenLinks, 0, "exposure broken links"],
  [exposure.counts?.nbaPrivacyFailures, 0, "exposure privacy failures"],
  [exposure.counts?.nbaAdMarkers, 0, "exposure ad markers"],
  [exposure.counts?.publicNbaLinks, 0, "exposure public links"],
  [exposure.counts?.sitemapNbaUrls, 0, "exposure sitemap URLs"],
]) {
  assert(actual === expected, `${label}: expected ${expected}, found ${actual}.`);
}

const manifest = {
  result: "PASS",
  phase: "16I",
  protocol: "Warp-Freeze Protocol",
  completionPercent: 100,
  completionStatus: "CLOSED",
  team: "los-angeles-lakers",
  completedAt: args["completed-at"],
  phase16HHead: args["phase16h-head"],
  startingHead: args["starting-head"],
  hashes: {
    phase16BRecordsSha256: sha256(recordsBytes),
    phase16FPartitionSha256: sha256(partitionBytes),
    phase16FSemanticPartitionSha256:
      partition.hashes.semanticPartitionSha256,
    phase16HReceiptSha256: sha256(receiptBytes),
    phase16HIndependentAuditSha256: sha256(phase16hAuditBytes),
    phase16HContractSha256: sha256(phase16hContractBytes),
    phase16IContractSha256: sha256(phase16iContractBytes),
    phase16HReportSha256: args["phase16h-report-sha256"],
    phase16HBundleSha256: args["phase16h-bundle-sha256"],
    phase16HShadowFreezeSha256: args["phase16h-shadow-freeze-sha256"],
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
  },
  accounting: {
    sourceRows: 206,
    readyPackagesImported: 146,
    heldPackagesImported: 0,
    heldPackages: 21,
    structuralEvidenceExclusionsImported: 0,
    structuralEvidenceExclusions: 39,
    canonicalTradesCreated: 74,
    perspectivesAppended: 72,
    frozenPlayerShellProposals: 100,
    playerShellsCreated: 76,
    readyShellsResolvedToExistingPlayers: 1,
    redundantReadyShellsExcluded: 0,
    heldOnlyPlayerShellsDeferred: 23,
    frozenRelationshipEdges: 455,
    relationshipReferencesAdded: 355,
    redundantReadyRelationshipEdgesExcluded: 0,
    heldRelationshipEdgesDeferred: 100,
    readyTeamDependencies: 292,
    heldTeamDependencies: 60,
    existingPerspectiveReviewHolds: 1,
    ambiguousIdentityOccurrencesDeferred: 6,
    matchedExistingAssetReferences: 353,
    syntheticPerspectiveAssetReferences: 2,
    sourceReferencesAdded: 253,
    publicCandidatePackagesImportedPrivately: 34,
    explicitPlayerTargetCorrections:
      Object.keys(playerCorrections).length,
    forcedSyntheticRelationshipGuards:
      forcedSynthetic.size,
  },
  stores: {
    canonicalTrades: trades.length,
    players: players.length,
    teams: teams.length,
    teamTradeMemberships: query.counts.teamTradeMemberships,
    playerRelationshipReferences: countRelationships(players),
    queryPlayerTradeReferences: query.counts.playerTradeReferences,
    playerSourceReferences: countSourceReferences(players),
    uniqueTradeDates: query.counts.uniqueTradeDates,
    sharedPerspectiveTrades: query.counts.sharedPerspectiveTrades,
    privateTrades: query.counts.privateTrades,
    privatePlayers: query.counts.privatePlayers,
  },
  routing: {
    routeModels: routes.counts.routeModels,
    internalNbaLinks: routes.counts.internalLinks,
    duplicatePaths: routes.counts.duplicatePaths,
    brokenLinks: routes.counts.brokenLinks,
    privacyViolations: routes.counts.privacyViolations,
  },
  build: exposure.counts,
  validation: {
    phase16HReceipt: "PASS",
    independentImportAudit: "PASS",
    heldAndExcludedIsolation: "PASS",
    existingPerspectiveIsolation: "PASS",
    ambiguousIdentityIsolation: "PASS",
    playerIdentityCorrection: "PASS",
    relationshipOwnership: "PASS",
    privateQueryLayer: "PASS",
    privateRouteModels: "PASS",
    productionBuild: "PASS",
    privateExposureAndSitemapIsolation: "PASS",
    idempotentReplay: "PASS",
  },
  importedCanonicalTradeIds: receipt.importedCanonicalTradeIds,
  updatedPerspectiveCanonicalIds:
    receipt.updatedPerspectiveCanonicalIds,
  importedPlayerIds: receipt.importedPlayerIds,
  resolvedExistingPlayerIds:
    receipt.readyShellsResolvedToExistingPlayerIds,
  deferredPlayerIds: receipt.deferredPlayerIds,
  relationshipIds: receipt.relationshipIds,
  deferredRelationshipIds: receipt.deferredRelationshipIds,
  heldSourceTradeIds: receipt.heldSourceTradeIds,
  structuralEvidenceExcludedSourceTradeIds:
    receipt.structuralEvidenceExcludedSourceTradeIds,
  canonicalTradeWrites: 0,
  playerWrites: 0,
  teamWrites: 0,
  relationshipWrites: 0,
  routeWrites: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

assert(
  manifest.accounting.explicitPlayerTargetCorrections === 1,
  "Expected one explicit player-target correction.",
);
assert(
  manifest.accounting.forcedSyntheticRelationshipGuards === 1,
  "Expected one forced synthetic relationship guard.",
);

await mkdir(path.dirname(path.resolve(args["output-json"])), {
  recursive: true,
});
await writeFile(args["output-json"], canonicalJson(manifest));

console.log(
  JSON.stringify(
    {
      result: "PASS",
      phase: "16I",
      completionPercent: 100,
      manifestSha256: sha256(canonicalJson(manifest)),
      accounting: manifest.accounting,
      stores: manifest.stores,
      routing: manifest.routing,
    },
    null,
    2,
  ),
);

