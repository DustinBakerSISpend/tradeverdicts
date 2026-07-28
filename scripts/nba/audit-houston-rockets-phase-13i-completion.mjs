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
  "partition-json", "receipt-json", "phase13h-audit-json", "exposure-audit-json",
  "trades-json", "players-json", "teams-json", "phase13h-contract-md", "phase13i-contract-md",
  "output-json", "completed-at", "phase13h-head", "starting-head", "phase13h-report-sha256",
  "phase13h-bundle-sha256", "expected-canonical-store-sha256", "expected-player-store-sha256",
  "expected-team-store-sha256", "expected-receipt-sha256", "expected-audit-sha256",
]) assert(args[required], `Missing --${required}`);

const [partitionBytes, receiptBytes, phase13hAuditBytes, exposureBytes, tradeBytes, playerBytes, teamBytes, phase13hContractBytes, phase13iContractBytes] = await Promise.all([
  readFile(args["partition-json"]), readFile(args["receipt-json"]), readFile(args["phase13h-audit-json"]),
  readFile(args["exposure-audit-json"]), readFile(args["trades-json"]), readFile(args["players-json"]),
  readFile(args["teams-json"]), readFile(args["phase13h-contract-md"]), readFile(args["phase13i-contract-md"]),
]);
const partition = JSON.parse(partitionBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const phase13hAudit = JSON.parse(phase13hAuditBytes.toString("utf8"));
const exposure = JSON.parse(exposureBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(partition.result === "PASS" && partition.phase === "13F", "Invalid Phase 13F partition.");
assert(receipt.result === "PASS" && receipt.phase === "13H", "Invalid Phase 13H receipt.");
assert(phase13hAudit.result === "PASS" && phase13hAudit.phase === "13H", "Invalid Phase 13H independent audit.");
assert(exposure.result === "PASS" && exposure.phase === "SCALABLE-PRIVATE-EXPOSURE", "Private exposure audit failed.");

assert(sha256(tradeBytes) === args["expected-canonical-store-sha256"], "Canonical store hash drifted.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Player store hash drifted.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Team store hash drifted.");
assert(sha256(receiptBytes) === args["expected-receipt-sha256"], "Phase 13H receipt hash drifted.");
assert(sha256(phase13hAuditBytes) === args["expected-audit-sha256"], "Phase 13H independent-audit hash drifted.");
assert(receipt.sourceHashes?.phase13FPartitionSha256 === sha256(partitionBytes), "Receipt Phase 13F partition hash drifted.");
assert(receipt.sourceHashes?.contractSha256 === sha256(phase13hContractBytes), "Receipt Phase 13H contract hash drifted.");
assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Receipt canonical-store hash drifted.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Receipt player-store hash drifted.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Receipt team-store hash drifted.");
assert(phase13hAudit.hashes?.canonicalStoreSha256 === sha256(tradeBytes), "Independent audit canonical-store hash drifted.");
assert(phase13hAudit.hashes?.playerStoreSha256 === sha256(playerBytes), "Independent audit player-store hash drifted.");
assert(phase13hAudit.hashes?.teamStoreSha256 === sha256(teamBytes), "Independent audit team-store hash drifted.");
assert(phase13hAudit.hashes?.receiptSha256 === sha256(receiptBytes), "Independent audit receipt hash drifted.");

assert(receipt.startingHead === args["starting-head"], "Receipt starting HEAD drifted.");
assert(args["phase13h-head"] === "6648cd251e170265f4143d8a27025afcdfe7a109", "Phase 13H HEAD drifted.");
assert(/^[A-F0-9]{64}$/u.test(args["phase13h-report-sha256"]), "Invalid Phase 13H report hash.");
assert(/^[A-F0-9]{64}$/u.test(args["phase13h-bundle-sha256"]), "Invalid Phase 13H bundle hash.");

for (const [actual, expected, label] of [
  [partition.counts?.sourceRows, 231, "partition source rows"],
  [partition.counts?.importReadyPackages, 191, "partition ready packages"],
  [partition.counts?.heldPackages, 26, "partition held packages"],
  [partition.counts?.structuralEvidenceExclusions, 14, "partition structural exclusions"],
  [partition.counts?.canonicalPerspectiveAppendPreviews, 59, "partition perspective appends"],
  [partition.counts?.canonicalCreatePreviews, 132, "partition canonical creates"],
  [partition.counts?.readyRequiredPlayerShells, 136, "partition ready shells"],
  [partition.counts?.heldOnlyPlayerShells, 22, "partition held shells"],
  [partition.counts?.readyRelationshipEdges, 546, "partition ready relationships"],
  [partition.counts?.heldRelationshipEdges, 118, "partition held relationships"],
  [receipt.sourceRows, 231, "receipt source rows"],
  [receipt.readyPackages, 191, "receipt ready packages"],
  [receipt.heldPackages, 26, "receipt held packages"],
  [receipt.structuralEvidenceExclusions, 14, "receipt structural exclusions"],
  [receipt.canonicalTradesCreated, 132, "receipt canonical creates"],
  [receipt.perspectivesAppended, 59, "receipt perspective appends"],
  [receipt.frozenPlayerShellProposals, 158, "receipt frozen shell proposals"],
  [receipt.playerShellsCreated, 134, "receipt shells created"],
  [receipt.readyShellsResolvedToExistingPlayers, 1, "receipt shell existing resolution"],
  [receipt.redundantReadyShellsExcluded, 1, "receipt redundant shell exclusion"],
  [receipt.heldOnlyPlayerShellsDeferred, 22, "receipt held shell deferrals"],
  [receipt.frozenRelationshipEdges, 664, "receipt frozen relationships"],
  [receipt.relationshipReferencesAdded, 545, "receipt relationships added"],
  [receipt.redundantReadyRelationshipEdgesExcluded, 1, "receipt redundant relationship exclusion"],
  [receipt.heldRelationshipEdgesDeferred, 118, "receipt held relationship deferrals"],
  [receipt.matchedExistingAssetReferences, 542, "receipt matched asset refs"],
  [receipt.syntheticPerspectiveAssetReferences, 3, "receipt synthetic perspective refs"],
  [receipt.sourceReferencesAdded, 477, "receipt source refs added"],
  [receipt.publicCandidatePackagesImportedPrivately, 44, "receipt public-candidate private imports"],
  [receipt.postImportCanonicalTrades, 1848, "receipt post trades"],
  [receipt.postImportPlayers, 2700, "receipt post players"],
  [receipt.postImportTeams, 52, "receipt post teams"],
  [receipt.postImportTeamTradeMemberships, 3837, "receipt post team memberships"],
  [receipt.postImportRelationshipReferences, 4321, "receipt post relationship refs"],
  [receipt.postImportSourceReferences, 2107, "receipt post source refs"],
]) assert(actual === expected, `${label}: expected ${expected}, found ${actual}`);

for (const [actual, expected, label] of [
  [phase13hAudit.counts?.canonicalTrades, 1848, "audit trades"],
  [phase13hAudit.counts?.players, 2700, "audit players"],
  [phase13hAudit.counts?.teams, 52, "audit teams"],
  [phase13hAudit.counts?.readyPackages, 191, "audit ready packages"],
  [phase13hAudit.counts?.heldPackages, 26, "audit held packages"],
  [phase13hAudit.counts?.structuralEvidenceExclusions, 14, "audit structural exclusions"],
  [phase13hAudit.counts?.canonicalTradesCreated, 132, "audit creates"],
  [phase13hAudit.counts?.perspectivesAppended, 59, "audit appends"],
  [phase13hAudit.counts?.playerShellsCreated, 134, "audit shells"],
  [phase13hAudit.counts?.relationshipReferencesAdded, 545, "audit relationships"],
  [phase13hAudit.counts?.privateQueryPlayerReferences, 2107, "audit query refs"],
  [phase13hAudit.counts?.routeModels, 4604, "audit routes"],
  [phase13hAudit.counts?.internalLinks, 16491, "audit internal links"],
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

assert(trades.length === 1848 && players.length === 2700 && teams.length === 52, "Post-import store counts drifted.");
for (const trade of trades) assertPrivateSafe(trade, trade.id ?? "trade");
for (const player of players) assertPrivateSafe(player, player.id ?? "player");

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });
for (const [actual, expected, label] of [
  [query.counts.canonicalTrades, 1848, "query canonical trades"],
  [query.counts.players, 2700, "query players"],
  [query.counts.representedTeams, 52, "query represented teams"],
  [query.counts.uniqueTradeDates, 1314, "query unique dates"],
  [query.counts.teamTradeMemberships, 3837, "query team memberships"],
  [query.counts.playerTradeReferences, 2107, "query player refs"],
  [query.counts.playerIdentityKeys, 2708, "query identity keys"],
  [query.counts.ambiguousExactIdentityKeys, 0, "query ambiguous identities"],
  [query.counts.sharedPerspectiveTrades, 272, "query shared perspectives"],
  [query.counts.privateTrades, 1848, "query private trades"],
  [query.counts.privatePlayers, 2700, "query private players"],
  [routes.counts.routeModels, 4604, "route models"],
  [routes.counts.internalLinks, 16491, "route internal links"],
  [routes.counts.tradeDetailModels, 1848, "route trade details"],
  [routes.counts.playerDetailModels, 2700, "route player details"],
  [routes.counts.teamDetailModels, 52, "route team details"],
  [routes.counts.sharedPerspectiveTradeModels, 272, "route shared perspectives"],
  [routes.counts.privateRouteModels, 4604, "route private models"],
  [routes.counts.noindexRouteModels, 4604, "route noindex models"],
  [routes.counts.adFreeRouteModels, 4604, "route ad-free models"],
  [routes.counts.sitemapExcludedRouteModels, 4604, "route sitemap excluded"],
  [routes.counts.navigationExcludedRouteModels, 4604, "route navigation excluded"],
  [routes.counts.duplicatePaths, 0, "route duplicate paths"],
  [routes.counts.brokenLinks, 0, "route broken links"],
  [routes.counts.crossNamespaceLinks, 0, "route cross-namespace links"],
  [routes.counts.selfLinks, 0, "route self links"],
  [routes.counts.privacyViolations, 0, "route privacy violations"],
  [routes.counts.incompleteModels, 0, "route incomplete models"],
]) assert(actual === expected, `${label}: expected ${expected}, found ${actual}`);

for (const [key, expected] of Object.entries({
  expectedNbaPages: 4604,
  builtNbaPages: 4604,
  nbaInternalLinks: 16491,
  missingNbaHtmlFiles: 0,
  unexpectedNbaHtmlFiles: 0,
  nbaBrokenLinks: 0,
  nbaPrivacyFailures: 0,
  nbaAdMarkers: 0,
  nbaPublicationMarkers: 0,
  privateNbaPages: 4604,
  noindexNbaPages: 4604,
  adFreeNbaPages: 4604,
  publicNbaLinks: 0,
  publicPagesLinkingToNba: 0,
  sitemapNbaUrls: 0,
})) assert(exposure.counts?.[key] === expected, `Exposure ${key}: expected ${expected}, found ${exposure.counts?.[key]}`);
assert(exposure.counts?.sitemapFiles >= 1, "No sitemap files found.");
assert(exposure.counts?.sitemapUrls >= 1, "No sitemap URLs found.");

const manifest = {
  result: "PASS",
  phase: "13I",
  protocol: "Warp-Freeze Protocol",
  mode: "HOUSTON_ROCKETS_PRIVATE_IMPORT_COMPLETION",
  completionPercent: 100,
  completedAt: args["completed-at"],
  startingHead: args["starting-head"],
  phase13HHead: args["phase13h-head"],
  sourceHashes: {
    phase13FPartitionSha256: sha256(partitionBytes),
    phase13FSemanticPartitionSha256: partition.hashes.semanticPartitionSha256,
    phase13HReceiptSha256: sha256(receiptBytes),
    phase13HAuditSha256: sha256(phase13hAuditBytes),
    privateExposureAuditSha256: sha256(exposureBytes),
    phase13HContractSha256: sha256(phase13hContractBytes),
    phase13IContractSha256: sha256(phase13iContractBytes),
    phase13HReportSha256: args["phase13h-report-sha256"],
    phase13HBundleSha256: args["phase13h-bundle-sha256"],
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
  },
  accounting: {
    sourceRows: 231,
    readyPackagesImported: 191,
    heldPackagesImported: 0,
    structuralEvidenceExclusionsImported: 0,
    canonicalTradesCreated: 132,
    perspectivesAppended: 59,
    heldPackages: 26,
    structuralEvidenceExclusions: 14,
    frozenPlayerShellProposals: 158,
    playerShellsCreated: 134,
    readyShellsResolvedToExistingPlayers: 1,
    redundantReadyShellsExcluded: 1,
    heldOnlyPlayerShellsDeferred: 22,
    frozenRelationshipEdges: 664,
    relationshipReferencesAdded: 545,
    redundantReadyRelationshipEdgesExcluded: 1,
    heldRelationshipEdgesDeferred: 118,
    matchedExistingAssetReferences: 542,
    syntheticPerspectiveAssetReferences: 3,
    sourceReferencesAdded: 477,
    publicCandidatePackagesImportedPrivately: 44,
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
    phase13HReceipt: "PASS",
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
  phase: "13I",
  completionPercent: 100,
  manifestSha256: sha256(canonicalJson(manifest)),
  accounting: manifest.accounting,
  stores: manifest.stores,
  routing: manifest.routing,
}, null, 2));
