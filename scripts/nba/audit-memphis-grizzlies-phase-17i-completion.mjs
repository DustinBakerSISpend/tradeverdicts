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

function memphisPerspectiveCount(trade) {
  if (Array.isArray(trade?.perspectives)) {
    return trade.perspectives.filter(
      (perspective) => clean(perspective?.sourceTeam) === "memphis-grizzlies",
    ).length;
  }

  return Object.prototype.hasOwnProperty.call(
    trade?.perspectives ?? {},
    "memphis-grizzlies",
  )
    ? 1
    : 0;
}

const args = parseArgs(process.argv);

for (const required of [
  "partition-json",
  "records-json",
  "receipt-json",
  "phase17h-audit-json",
  "exposure-audit-json",
  "trades-json",
  "players-json",
  "teams-json",
  "phase17h-contract-md",
  "phase17i-contract-md",
  "output-json",
  "completed-at",
  "phase17h-head",
  "starting-head",
  "phase17h-report-sha256",
  "phase17h-bundle-sha256",
  "phase17h-shadow-freeze-sha256",
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
  phase17hAuditBytes,
  exposureBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  phase17hContractBytes,
  phase17iContractBytes,
] = await Promise.all([
  readFile(args["partition-json"]),
  readFile(args["records-json"]),
  readFile(args["receipt-json"]),
  readFile(args["phase17h-audit-json"]),
  readFile(args["exposure-audit-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["phase17h-contract-md"]),
  readFile(args["phase17i-contract-md"]),
]);

const partition = JSON.parse(partitionBytes.toString("utf8"));
const records = JSON.parse(recordsBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const phase17hAudit = JSON.parse(phase17hAuditBytes.toString("utf8"));
const exposure = JSON.parse(exposureBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(partition.result === "PASS" && partition.phase === "17F", "Invalid Phase 17F partition.");
assert(records.result === "PASS" && records.phase === "17B", "Invalid Phase 17B records.");
assert(Array.isArray(records.records) && records.records.length === 126, "Phase 17B record count drifted.");
assert(receipt.result === "PASS" && receipt.phase === "17H", "Invalid Phase 17H receipt.");
assert(
  phase17hAudit.result === "PASS" && phase17hAudit.phase === "17H",
  "Invalid Phase 17H independent audit.",
);
assert(
  exposure.result === "PASS" &&
    exposure.phase === "SCALABLE-PRIVATE-EXPOSURE",
  "Private exposure audit failed.",
);

for (const [actual, expected, label] of [
  [sha256(recordsBytes), args["expected-records-sha256"], "Phase 17B records"],
  [sha256(partitionBytes), args["expected-partition-sha256"], "Phase 17F partition"],
  [
    partition.hashes?.semanticPartitionSha256,
    args["expected-partition-semantic-sha256"],
    "Phase 17F semantic partition",
  ],
  [sha256(tradeBytes), args["expected-canonical-store-sha256"], "canonical store"],
  [sha256(playerBytes), args["expected-player-store-sha256"], "player store"],
  [sha256(teamBytes), args["expected-team-store-sha256"], "team store"],
  [sha256(receiptBytes), args["expected-receipt-sha256"], "Phase 17H receipt"],
  [sha256(phase17hAuditBytes), args["expected-audit-sha256"], "Phase 17H audit"],
]) {
  assert(actual === expected, `${label} hash drifted: ${actual} !== ${expected}.`);
}

for (const [actual, expected, label] of [
  [partition.counts?.importReadyPackages, 93, "partition ready packages"],
  [partition.counts?.heldPackages, 21, "partition held packages"],
  [partition.counts?.structuralEvidenceExclusions, 12, "partition exclusions"],
  [partition.counts?.canonicalPerspectiveAppendPreviews, 40, "partition appends"],
  [partition.counts?.canonicalCreatePreviews, 53, "partition creates"],
  [partition.counts?.readyRequiredPlayerShells, 59, "partition ready shells"],
  [partition.counts?.heldOnlyPlayerShells, 17, "partition held shells"],
  [partition.counts?.readyRelationshipEdges, 281, "partition ready relationships"],
  [partition.counts?.heldRelationshipEdges, 101, "partition held relationships"],
  [partition.counts?.readyTeamDependencyOccurrences, 186, "partition ready teams"],
  [partition.counts?.heldTeamDependencyOccurrences, 69, "partition held teams"],
]) {
  assert(actual === expected, `${label}: expected ${expected}, found ${actual}.`);
}

for (const [actual, expected, label] of [
  [receipt.readyPackages, 93, "receipt ready packages"],
  [receipt.heldPackages, 21, "receipt held packages"],
  [receipt.structuralEvidenceExclusions, 12, "receipt exclusions"],
  [receipt.canonicalTradesCreated, 53, "receipt canonical creates"],
  [receipt.perspectivesAppended, 40, "receipt perspective appends"],
  [receipt.playerShellsCreated, 58, "receipt player shells"],
  [receipt.readyShellsResolvedToExistingPlayers, 1, "receipt resolved shell"],
  [receipt.heldOnlyPlayerShellsDeferred, 17, "receipt held-only shells"],
  [receipt.relationshipReferencesAdded, 281, "receipt relationships"],
  [receipt.heldRelationshipEdgesDeferred, 101, "receipt held relationships"],
  [receipt.readyTeamDependencies, 186, "receipt ready teams"],
  [receipt.heldTeamDependencies, 69, "receipt held teams"],
  [receipt.existingPerspectiveReviewHolds, 0, "receipt existing-perspective holds"],
  [receipt.ambiguousIdentityOccurrencesDeferred, 0, "receipt ambiguous identities"],
  [receipt.matchedExistingAssetReferences, 281, "receipt matched assets"],
  [receipt.syntheticPerspectiveAssetReferences, 0, "receipt synthetic assets"],
  [receipt.sourceReferencesAdded, 188, "receipt source references"],
]) {
  assert(actual === expected, `${label}: expected ${expected}, found ${actual}.`);
}

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
    playerCorrections["nba-player-dj-kennedy"] === "nba-player-d-j-kennedy",
  "D.J. Kennedy existing-player correction drifted.",
);
assert(
  Object.keys(receipt.explicitRelationshipTargetCorrections ?? {}).length === 0,
  "Unexpected relationship-target correction exists.",
);
assert(
  Array.isArray(receipt.forcedSyntheticRelationshipIds) &&
    receipt.forcedSyntheticRelationshipIds.length === 0,
  "Unexpected synthetic relationship guard exists.",
);

for (const [arrayValue, expected, label] of [
  [receipt.importedCanonicalTradeIds, 53, "created trade IDs"],
  [receipt.updatedPerspectiveCanonicalIds, 40, "updated perspective IDs"],
  [receipt.importedPlayerIds, 58, "imported player IDs"],
  [receipt.readyShellsResolvedToExistingPlayerIds, 1, "resolved player IDs"],
  [receipt.deferredPlayerIds, 17, "deferred player IDs"],
  [receipt.relationshipIds, 281, "relationship IDs"],
  [receipt.deferredRelationshipIds, 101, "deferred relationship IDs"],
  [receipt.heldSourceTradeIds, 21, "held source trade IDs"],
  [receipt.structuralEvidenceExcludedSourceTradeIds, 12, "excluded source trade IDs"],
]) {
  assert(Array.isArray(arrayValue) && arrayValue.length === expected, `${label} drifted.`);
}

for (const [actual, expected, label] of [
  [phase17hAudit.counts?.canonicalTrades, 2141, "audit trades"],
  [phase17hAudit.counts?.players, 2999, "audit players"],
  [phase17hAudit.counts?.teams, 52, "audit teams"],
  [phase17hAudit.counts?.readyPackages, 93, "audit ready packages"],
  [phase17hAudit.counts?.heldPackages, 21, "audit held packages"],
  [phase17hAudit.counts?.structuralEvidenceExclusions, 12, "audit exclusions"],
  [phase17hAudit.counts?.canonicalTradesCreated, 53, "audit creates"],
  [phase17hAudit.counts?.perspectivesAppended, 40, "audit appends"],
  [phase17hAudit.counts?.playerShellsCreated, 58, "audit player shells"],
  [phase17hAudit.counts?.readyShellsResolvedToExistingPlayers, 1, "audit resolved shell"],
  [phase17hAudit.counts?.deferredPlayerShells, 17, "audit deferred shells"],
  [phase17hAudit.counts?.relationshipReferencesAdded, 281, "audit relationships"],
  [phase17hAudit.counts?.deferredRelationshipEdges, 101, "audit deferred relationships"],
  [phase17hAudit.counts?.readyTeamDependencies, 186, "audit ready team dependencies"],
  [phase17hAudit.counts?.heldTeamDependencies, 69, "audit held team dependencies"],
  [phase17hAudit.counts?.existingPerspectiveReviewHolds, 0, "audit existing-perspective hold"],
  [phase17hAudit.counts?.ambiguousIdentityOccurrencesDeferred, 0, "audit ambiguous identities"],
  [phase17hAudit.counts?.matchedExistingAssetReferences, 281, "audit matched assets"],
  [phase17hAudit.counts?.syntheticPerspectiveAssetReferences, 0, "audit synthetic assets"],
  [phase17hAudit.counts?.sourceReferencesAdded, 188, "audit source refs"],
  [phase17hAudit.counts?.privateQueryPlayerReferences, 3159, "audit private query refs"],
  [phase17hAudit.counts?.routeModels, 5196, "audit route models"],
  [phase17hAudit.counts?.internalLinks, 20359, "audit internal links"],
]) {
  assert(actual === expected, `${label}: expected ${expected}, found ${actual}.`);
}

assert(
  phase17hAudit.safety?.duplicateReferenceOwnership === 0,
  "Phase 17H audit duplicate ownership drifted.",
);
assert(
  phase17hAudit.safety?.publicationAuthorized === false,
  "Phase 17H audit publication status drifted.",
);

assert(
  trades.length === 2141 && players.length === 2999 && teams.length === 52,
  "Post-import store counts drifted.",
);
assert(countRelationships(players) === 5767, "Player relationship-reference count drifted.");
assert(countSourceReferences(players) === 3159, "Player source-reference count drifted.");

for (const trade of trades) assertPrivateSafe(trade, trade.id ?? "trade");
for (const player of players) assertPrivateSafe(player, player.id ?? "player");

const tradeMap = new Map(trades.map((trade) => [trade.id, trade]));
for (const id of receipt.updatedPerspectiveCanonicalIds) {
  const trade = tradeMap.get(id);
  assert(trade, `Updated Memphis perspective target missing: ${id}`);
  assert(
    memphisPerspectiveCount(trade) === 1,
    `${id}: target does not retain exactly one Memphis perspective.`,
  );
}

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
  [query.counts.canonicalTrades, 2141, "query canonical trades"],
  [query.counts.players, 2999, "query players"],
  [query.counts.representedTeams, 52, "query represented teams"],
  [query.counts.uniqueTradeDates, 1461, "query unique dates"],
  [query.counts.teamTradeMemberships, 4423, "query team memberships"],
  [query.counts.playerTradeReferences, 3159, "query player refs"],
  [query.counts.playerIdentityKeys, 3017, "query identity keys"],
  [query.counts.ambiguousExactIdentityKeys, 0, "query ambiguous identities"],
  [query.counts.sharedPerspectiveTrades, 513, "query shared perspectives"],
  [query.counts.privateTrades, 2141, "query private trades"],
  [query.counts.privatePlayers, 2999, "query private players"],
  [query.counts.noindexTrades, 2141, "query noindex trades"],
  [query.counts.noindexPlayers, 2999, "query noindex players"],
  [query.counts.adFreeTrades, 2141, "query ad-free trades"],
  [query.counts.adFreePlayers, 2999, "query ad-free players"],
  [routes.counts.routeModels, 5196, "route models"],
  [routes.counts.indexRouteModels, 4, "index route models"],
  [routes.counts.tradeDetailModels, 2141, "trade route models"],
  [routes.counts.playerDetailModels, 2999, "player route models"],
  [routes.counts.teamDetailModels, 52, "team route models"],
  [routes.counts.internalLinks, 20359, "route internal links"],
  [routes.counts.sharedPerspectiveTradeModels, 513, "route shared perspectives"],
  [routes.counts.privateRouteModels, 5196, "private route models"],
  [routes.counts.noindexRouteModels, 5196, "noindex route models"],
  [routes.counts.adFreeRouteModels, 5196, "ad-free route models"],
  [routes.counts.sitemapExcludedRouteModels, 5196, "sitemap-excluded route models"],
  [routes.counts.navigationExcludedRouteModels, 5196, "navigation-excluded route models"],
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
  [exposure.counts?.expectedNbaPages, 5196, "exposure expected NBA pages"],
  [exposure.counts?.builtNbaPages, 5196, "exposure built NBA pages"],
  [exposure.counts?.nbaInternalLinks, 20359, "exposure NBA internal links"],
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
  phase: "17I",
  protocol: "Warp-Freeze Protocol",
  completionPercent: 100,
  completionStatus: "CLOSED",
  team: "memphis-grizzlies",
  completedAt: args["completed-at"],
  phase17HHead: args["phase17h-head"],
  startingHead: args["starting-head"],
  accounting: {
    sourceRows: 126,
    readyPackagesImported: 93,
    heldPackagesImported: 0,
    heldPackagesDeferred: 21,
    structuralEvidenceExclusionsImported: 0,
    structuralEvidenceExclusionsDeferred: 12,
    canonicalTradesCreated: 53,
    perspectivesAppended: 40,
    playerShellsCreated: 58,
    readyShellsResolvedToExistingPlayers: 1,
    heldOnlyPlayerShellsDeferred: 17,
    relationshipReferencesAdded: 281,
    heldRelationshipEdgesDeferred: 101,
    readyTeamDependencies: 186,
    heldTeamDependencies: 69,
    existingPerspectiveReviewHolds: 0,
    ambiguousIdentityOccurrencesDeferred: 0,
    matchedExistingAssetReferences: 281,
    syntheticPerspectiveAssetReferences: 0,
    sourceReferencesAdded: 188,
  },
  stores: {
    canonicalTrades: trades.length,
    players: players.length,
    teams: teams.length,
    teamTradeMemberships: query.counts.teamTradeMemberships,
    playerRelationshipReferences: countRelationships(players),
    playerSourceReferences: countSourceReferences(players),
    sharedPerspectiveTrades: query.counts.sharedPerspectiveTrades,
  },
  routing: {
    playerTradeReferences: query.counts.playerTradeReferences,
    playerIdentityKeys: query.counts.playerIdentityKeys,
    ambiguousExactIdentityKeys: query.counts.ambiguousExactIdentityKeys,
    routeModels: routes.counts.routeModels,
    internalLinks: routes.counts.internalLinks,
    brokenLinks: routes.counts.brokenLinks,
    duplicatePaths: routes.counts.duplicatePaths,
    privacyViolations: routes.counts.privacyViolations,
  },
  exposure: {
    expectedNbaPages: exposure.counts.expectedNbaPages,
    builtNbaPages: exposure.counts.builtNbaPages,
    nbaInternalLinks: exposure.counts.nbaInternalLinks,
    nbaBrokenLinks: exposure.counts.nbaBrokenLinks,
    nbaPrivacyFailures: exposure.counts.nbaPrivacyFailures,
    nbaAdMarkers: exposure.counts.nbaAdMarkers,
    publicNbaLinks: exposure.counts.publicNbaLinks,
    sitemapNbaUrls: exposure.counts.sitemapNbaUrls,
  },
  hashes: {
    phase17BRecordsSha256: sha256(recordsBytes),
    phase17FPartitionSha256: sha256(partitionBytes),
    phase17FSemanticPartitionSha256: partition.hashes.semanticPartitionSha256,
    phase17HReceiptSha256: sha256(receiptBytes),
    phase17HAuditSha256: sha256(phase17hAuditBytes),
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
    phase17HContractSha256: sha256(phase17hContractBytes),
    phase17IContractSha256: sha256(phase17iContractBytes),
    privateExposureAuditSha256: sha256(exposureBytes),
    phase17HReportSha256: args["phase17h-report-sha256"],
    phase17HBundleSha256: args["phase17h-bundle-sha256"],
    phase17HShadowFreezeSha256: args["phase17h-shadow-freeze-sha256"],
  },
  explicitIdentityCorrections: {
    "nba-player-dj-kennedy": "nba-player-d-j-kennedy",
  },
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

await mkdir(path.dirname(path.resolve(args["output-json"])), { recursive: true });
await writeFile(args["output-json"], canonicalJson(manifest));
console.log(JSON.stringify(manifest, null, 2));

