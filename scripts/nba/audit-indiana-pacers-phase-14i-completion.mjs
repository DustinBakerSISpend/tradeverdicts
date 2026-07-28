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
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function countRelationships(players) {
  return players.reduce((sum, player) => sum + (Array.isArray(player.relationshipReferences) ? player.relationshipReferences.length : 0), 0);
}
function countSourceReferences(players) {
  return players.reduce((sum, player) => sum + (Array.isArray(player.sourceReferences) ? player.sourceReferences.length : 0), 0);
}
function assertPrivateSafe(record, label) {
  assert(record.privateOnly !== false, `${label}: explicitly public privateOnly flag detected.`);
  assert(record.publishStatus !== "public", `${label}: public publish status detected.`);
  assert(record.indexEligible !== true, `${label}: index eligibility detected.`);
  assert(record.adEligible !== true, `${label}: ad eligibility detected.`);
  assert(record.publicationReady !== true, `${label}: publication readiness detected.`);
}

const args = parseArgs(process.argv);
for (const required of [
  "partition-json", "receipt-json", "phase14h-audit-json", "exposure-audit-json",
  "trades-json", "players-json", "teams-json", "phase14h-contract-md", "phase14i-contract-md",
  "output-json", "completed-at", "phase14h-head", "starting-head", "phase14h-report-sha256",
  "phase14h-bundle-sha256", "expected-canonical-store-sha256", "expected-player-store-sha256",
  "expected-team-store-sha256", "expected-receipt-sha256", "expected-audit-sha256",
]) assert(args[required], `Missing --${required}`);

const [partitionBytes, receiptBytes, phase14hAuditBytes, exposureBytes, tradeBytes, playerBytes, teamBytes, phase14hContractBytes, phase14iContractBytes] = await Promise.all([
  readFile(args["partition-json"]), readFile(args["receipt-json"]), readFile(args["phase14h-audit-json"]),
  readFile(args["exposure-audit-json"]), readFile(args["trades-json"]), readFile(args["players-json"]),
  readFile(args["teams-json"]), readFile(args["phase14h-contract-md"]), readFile(args["phase14i-contract-md"]),
]);
const partition = JSON.parse(partitionBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const phase14hAudit = JSON.parse(phase14hAuditBytes.toString("utf8"));
const exposure = JSON.parse(exposureBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(partition.result === "PASS" && partition.phase === "14F", "Invalid Phase 14F partition.");
assert(receipt.result === "PASS" && receipt.phase === "14H", "Invalid Phase 14H receipt.");
assert(phase14hAudit.result === "PASS" && phase14hAudit.phase === "14H", "Invalid Phase 14H independent audit.");
assert(exposure.result === "PASS" && exposure.phase === "SCALABLE-PRIVATE-EXPOSURE", "Private exposure audit failed.");

assert(sha256(tradeBytes) === args["expected-canonical-store-sha256"], "Canonical store hash drifted.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Player store hash drifted.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Team store hash drifted.");
assert(sha256(receiptBytes) === args["expected-receipt-sha256"], "Phase 14H receipt hash drifted.");
assert(sha256(phase14hAuditBytes) === args["expected-audit-sha256"], "Phase 14H independent-audit hash drifted.");
assert(receipt.sourceHashes?.phase14FPartitionSha256 === sha256(partitionBytes), "Receipt Phase 14F partition hash drifted.");
assert(receipt.sourceHashes?.contractSha256 === sha256(phase14hContractBytes), "Receipt Phase 14H contract hash drifted.");
assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Receipt canonical-store hash drifted.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Receipt player-store hash drifted.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Receipt team-store hash drifted.");
assert(phase14hAudit.hashes?.canonicalStoreSha256 === sha256(tradeBytes), "Independent audit canonical-store hash drifted.");
assert(phase14hAudit.hashes?.playerStoreSha256 === sha256(playerBytes), "Independent audit player-store hash drifted.");
assert(phase14hAudit.hashes?.teamStoreSha256 === sha256(teamBytes), "Independent audit team-store hash drifted.");
assert(phase14hAudit.hashes?.receiptSha256 === sha256(receiptBytes), "Independent audit receipt hash drifted.");

assert(receipt.startingHead === args["starting-head"], "Receipt starting HEAD drifted.");
assert(args["phase14h-head"] === "33f5a0997840242bafd3b63d0173a75939434ac2", "Phase 14H HEAD drifted.");
assert(/^[A-F0-9]{64}$/u.test(args["phase14h-report-sha256"]), "Invalid Phase 14H report hash.");
assert(/^[A-F0-9]{64}$/u.test(args["phase14h-bundle-sha256"]), "Invalid Phase 14H bundle hash.");

for (const [actual, expected, label] of [
  [partition.counts?.sourceRows, 168, "partition source rows"],
  [partition.counts?.importReadyPackages, 133, "partition ready packages"],
  [partition.counts?.heldPackages, 16, "partition held packages"],
  [partition.counts?.structuralEvidenceExclusions, 19, "partition structural exclusions"],
  [partition.counts?.canonicalPerspectiveAppendPreviews, 50, "partition perspective appends"],
  [partition.counts?.canonicalCreatePreviews, 83, "partition canonical creates"],
  [partition.counts?.readyRequiredPlayerShells, 85, "partition ready shells"],
  [partition.counts?.heldOnlyPlayerShells, 13, "partition held shells"],
  [partition.counts?.readyRelationshipEdges, 346, "partition ready relationships"],
  [partition.counts?.heldRelationshipEdges, 57, "partition held relationships"],
  [receipt.sourceRows, 168, "receipt source rows"],
  [receipt.readyPackages, 133, "receipt ready packages"],
  [receipt.heldPackages, 16, "receipt held packages"],
  [receipt.structuralEvidenceExclusions, 19, "receipt structural exclusions"],
  [receipt.canonicalTradesCreated, 83, "receipt canonical creates"],
  [receipt.perspectivesAppended, 50, "receipt perspective appends"],
  [receipt.frozenPlayerShellProposals, 98, "receipt frozen shell proposals"],
  [receipt.playerShellsCreated, 83, "receipt shells created"],
  [receipt.readyShellsResolvedToExistingPlayers, 2, "receipt shell existing resolution"],
  [receipt.redundantReadyShellsExcluded, 0, "receipt redundant shell exclusion"],
  [receipt.heldOnlyPlayerShellsDeferred, 13, "receipt held shell deferrals"],
  [receipt.frozenRelationshipEdges, 403, "receipt frozen relationships"],
  [receipt.relationshipReferencesAdded, 346, "receipt relationships added"],
  [receipt.redundantReadyRelationshipEdgesExcluded, 0, "receipt redundant relationship exclusion"],
  [receipt.heldRelationshipEdgesDeferred, 57, "receipt held relationship deferrals"],
  [receipt.matchedExistingAssetReferences, 345, "receipt matched asset refs"],
  [receipt.syntheticPerspectiveAssetReferences, 1, "receipt synthetic perspective refs"],
  [receipt.sourceReferencesAdded, 270, "receipt source refs added"],
  [receipt.publicCandidatePackagesImportedPrivately, 31, "receipt public-candidate private imports"],
  [receipt.postImportCanonicalTrades, 1931, "receipt post trades"],
  [receipt.postImportPlayers, 2783, "receipt post players"],
  [receipt.postImportTeams, 52, "receipt post teams"],
  [receipt.postImportTeamTradeMemberships, 4003, "receipt post team memberships"],
  [receipt.postImportRelationshipReferences, 4667, "receipt post relationship refs"],
  [receipt.postImportSourceReferences, 2377, "receipt post source refs"],
]) assert(actual === expected, `${label}: expected ${expected}, found ${actual}`);

for (const [actual, expected, label] of [
  [phase14hAudit.counts?.canonicalTrades, 1931, "audit trades"],
  [phase14hAudit.counts?.players, 2783, "audit players"],
  [phase14hAudit.counts?.teams, 52, "audit teams"],
  [phase14hAudit.counts?.readyPackages, 133, "audit ready packages"],
  [phase14hAudit.counts?.heldPackages, 16, "audit held packages"],
  [phase14hAudit.counts?.structuralEvidenceExclusions, 19, "audit structural exclusions"],
  [phase14hAudit.counts?.canonicalTradesCreated, 83, "audit creates"],
  [phase14hAudit.counts?.perspectivesAppended, 50, "audit appends"],
  [phase14hAudit.counts?.playerShellsCreated, 83, "audit shells"],
  [phase14hAudit.counts?.relationshipReferencesAdded, 346, "audit relationships"],
  [phase14hAudit.counts?.privateQueryPlayerReferences, 2377, "audit query refs"],
  [phase14hAudit.counts?.routeModels, 4770, "audit routes"],
  [phase14hAudit.counts?.internalLinks, 17529, "audit internal links"],
]) assert(actual === expected, `${label}: expected ${expected}, found ${actual}`);

assert(receipt.heldPackageImports === 0, "A held package was imported.");
assert(receipt.heldPlayerShellImports === 0, "A held-only player shell was imported.");
assert(receipt.heldRelationshipWrites === 0, "A held relationship was written.");
assert(receipt.teamRegistryEntriesAdded === 0, "The team registry changed.");
assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route occurred.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(receipt.pushPerformed === false && receipt.deployPerformed === false, "Push/deploy drifted.");

assert(trades.length === 1931 && players.length === 2783 && teams.length === 52, "Post-import store counts drifted.");
for (const trade of trades) assertPrivateSafe(trade, trade.id ?? "trade");
for (const player of players) assertPrivateSafe(player, player.id ?? "player");

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });
for (const [actual, expected, label] of [
  [query.counts.canonicalTrades, 1931, "query canonical trades"],
  [query.counts.players, 2783, "query players"],
  [query.counts.representedTeams, 52, "query represented teams"],
  [query.counts.uniqueTradeDates, 1357, "query unique dates"],
  [query.counts.teamTradeMemberships, 4003, "query team memberships"],
  [query.counts.playerTradeReferences, 2377, "query player refs"],
  [query.counts.playerIdentityKeys, 2791, "query identity keys"],
  [query.counts.ambiguousExactIdentityKeys, 0, "query ambiguous identities"],
  [query.counts.sharedPerspectiveTrades, 322, "query shared perspectives"],
  [query.counts.privateTrades, 1931, "query private trades"],
  [query.counts.privatePlayers, 2783, "query private players"],
  [routes.counts.routeModels, 4770, "route models"],
  [routes.counts.internalLinks, 17529, "route internal links"],
  [routes.counts.tradeDetailModels, 1931, "route trade details"],
  [routes.counts.playerDetailModels, 2783, "route player details"],
  [routes.counts.teamDetailModels, 52, "route team details"],
  [routes.counts.sharedPerspectiveTradeModels, 322, "route shared perspectives"],
  [routes.counts.privateRouteModels, 4770, "route private models"],
  [routes.counts.noindexRouteModels, 4770, "route noindex models"],
  [routes.counts.adFreeRouteModels, 4770, "route ad-free models"],
  [routes.counts.sitemapExcludedRouteModels, 4770, "route sitemap excluded"],
  [routes.counts.navigationExcludedRouteModels, 4770, "route navigation excluded"],
  [routes.counts.duplicatePaths, 0, "route duplicate paths"],
  [routes.counts.brokenLinks, 0, "route broken links"],
  [routes.counts.crossNamespaceLinks, 0, "route cross-namespace links"],
  [routes.counts.selfLinks, 0, "route self links"],
  [routes.counts.privacyViolations, 0, "route privacy violations"],
  [routes.counts.incompleteModels, 0, "route incomplete models"],
]) assert(actual === expected, `${label}: expected ${expected}, found ${actual}`);

for (const [key, expected] of Object.entries({
  expectedNbaPages: 4770,
  builtNbaPages: 4770,
  nbaInternalLinks: 17529,
  missingNbaHtmlFiles: 0,
  unexpectedNbaHtmlFiles: 0,
  nbaBrokenLinks: 0,
  nbaPrivacyFailures: 0,
  nbaAdMarkers: 0,
  nbaPublicationMarkers: 0,
  privateNbaPages: 4770,
  noindexNbaPages: 4770,
  adFreeNbaPages: 4770,
  publicNbaLinks: 0,
  publicPagesLinkingToNba: 0,
  sitemapNbaUrls: 0,
})) assert(exposure.counts?.[key] === expected, `Exposure ${key}: expected ${expected}, found ${exposure.counts?.[key]}`);
assert(exposure.counts?.sitemapFiles >= 1, "No sitemap files found.");
assert(exposure.counts?.sitemapUrls >= 1, "No sitemap URLs found.");

const manifest = {
  result: "PASS",
  phase: "14I",
  protocol: "Warp-Freeze Protocol",
  mode: "INDIANA_PACERS_PRIVATE_IMPORT_COMPLETION",
  completionPercent: 100,
  completedAt: args["completed-at"],
  startingHead: args["starting-head"],
  phase14HHead: args["phase14h-head"],
  sourceHashes: {
    phase14FPartitionSha256: sha256(partitionBytes),
    phase14FSemanticPartitionSha256: partition.hashes.semanticPartitionSha256,
    phase14HReceiptSha256: sha256(receiptBytes),
    phase14HAuditSha256: sha256(phase14hAuditBytes),
    privateExposureAuditSha256: sha256(exposureBytes),
    phase14HContractSha256: sha256(phase14hContractBytes),
    phase14IContractSha256: sha256(phase14iContractBytes),
    phase14HReportSha256: args["phase14h-report-sha256"],
    phase14HBundleSha256: args["phase14h-bundle-sha256"],
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
  },
  accounting: {
    sourceRows: 168,
    readyPackagesImported: 133,
    heldPackagesImported: 0,
    structuralEvidenceExclusionsImported: 0,
    canonicalTradesCreated: 83,
    perspectivesAppended: 50,
    heldPackages: 16,
    structuralEvidenceExclusions: 19,
    frozenPlayerShellProposals: 98,
    playerShellsCreated: 83,
    readyShellsResolvedToExistingPlayers: 2,
    redundantReadyShellsExcluded: 0,
    heldOnlyPlayerShellsDeferred: 13,
    frozenRelationshipEdges: 403,
    relationshipReferencesAdded: 346,
    redundantReadyRelationshipEdgesExcluded: 0,
    heldRelationshipEdgesDeferred: 57,
    matchedExistingAssetReferences: 345,
    syntheticPerspectiveAssetReferences: 1,
    sourceReferencesAdded: 270,
    publicCandidatePackagesImportedPrivately: 31,
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
    phase14HReceipt: "PASS",
    independentImportAudit: "PASS",
    heldAndExcludedIsolation: "PASS",
    playerIdentityCorrections: "PASS",
    relationshipOwnership: "PASS",
    privateQueryLayer: "PASS",
    privateRouteModels: "PASS",
    productionBuild: "PASS",
    privateExposureAndSitemapIsolation: "PASS",
    idempotentReplay: "PASS",
  },
  importedCanonicalTradeIds: receipt.importedCanonicalTradeIds,
  updatedPerspectiveCanonicalIds: receipt.updatedPerspectiveCanonicalIds,
  importedPlayerIds: receipt.importedPlayerIds,
  deferredPlayerIds: receipt.deferredPlayerIds,
  relationshipIds: receipt.relationshipIds,
  deferredRelationshipIds: receipt.deferredRelationshipIds,
  heldSourceTradeIds: receipt.heldSourceTradeIds,
  structuralEvidenceExcludedSourceTradeIds: receipt.structuralEvidenceExcludedSourceTradeIds,
  canonicalTradeWrites: 0,
  playerWrites: 0,
  teamWrites: 0,
  relationshipWrites: 0,
  routeWrites: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

await mkdir(path.dirname(path.resolve(args["output-json"])), { recursive: true });
await writeFile(args["output-json"], canonicalJson(manifest));
console.log(JSON.stringify({
  result: "PASS",
  phase: "14I",
  completionPercent: 100,
  manifestSha256: sha256(canonicalJson(manifest)),
  accounting: manifest.accounting,
  stores: manifest.stores,
  routing: manifest.routing,
}, null, 2));
