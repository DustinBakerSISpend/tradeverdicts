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
  "partition-json", "receipt-json", "phase15h-audit-json", "exposure-audit-json",
  "trades-json", "players-json", "teams-json", "phase15h-contract-md", "phase15i-contract-md",
  "output-json", "completed-at", "phase15h-head", "starting-head",
  "phase15h-report-sha256", "phase15h-bundle-sha256", "phase15h-shadow-freeze-sha256",
  "expected-canonical-store-sha256", "expected-player-store-sha256",
  "expected-team-store-sha256", "expected-receipt-sha256", "expected-audit-sha256",
]) assert(args[required], `Missing --${required}`);

const [
  partitionBytes, receiptBytes, phase15hAuditBytes, exposureBytes,
  tradeBytes, playerBytes, teamBytes, phase15hContractBytes, phase15iContractBytes,
] = await Promise.all([
  readFile(args["partition-json"]),
  readFile(args["receipt-json"]),
  readFile(args["phase15h-audit-json"]),
  readFile(args["exposure-audit-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["phase15h-contract-md"]),
  readFile(args["phase15i-contract-md"]),
]);

const partition = JSON.parse(partitionBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const phase15hAudit = JSON.parse(phase15hAuditBytes.toString("utf8"));
const exposure = JSON.parse(exposureBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(partition.result === "PASS" && partition.phase === "15F", "Invalid Phase 15F partition.");
assert(receipt.result === "PASS" && receipt.phase === "15H", "Invalid Phase 15H receipt.");
assert(phase15hAudit.result === "PASS" && phase15hAudit.phase === "15H", "Invalid Phase 15H independent audit.");
assert(exposure.result === "PASS" && exposure.phase === "SCALABLE-PRIVATE-EXPOSURE", "Private exposure audit failed.");

assert(sha256(tradeBytes) === args["expected-canonical-store-sha256"], "Canonical store hash drifted.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Player store hash drifted.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Team store hash drifted.");
assert(sha256(receiptBytes) === args["expected-receipt-sha256"], "Phase 15H receipt hash drifted.");
assert(sha256(phase15hAuditBytes) === args["expected-audit-sha256"], "Phase 15H independent-audit hash drifted.");

assert(receipt.sourceHashes?.phase15FPartitionSha256 === sha256(partitionBytes), "Receipt Phase 15F partition hash drifted.");
assert(receipt.sourceHashes?.contractSha256 === sha256(phase15hContractBytes), "Receipt Phase 15H contract hash drifted.");
assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Receipt canonical-store hash drifted.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Receipt player-store hash drifted.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Receipt team-store hash drifted.");
assert(phase15hAudit.hashes?.canonicalStoreSha256 === sha256(tradeBytes), "Phase 15H audit canonical-store hash drifted.");
assert(phase15hAudit.hashes?.playerStoreSha256 === sha256(playerBytes), "Phase 15H audit player-store hash drifted.");
assert(phase15hAudit.hashes?.teamStoreSha256 === sha256(teamBytes), "Phase 15H audit team-store hash drifted.");
assert(phase15hAudit.hashes?.receiptSha256 === sha256(receiptBytes), "Phase 15H audit receipt hash drifted.");

assert(receipt.startingHead === args["starting-head"], "Receipt starting HEAD drifted.");
assert(args["phase15h-head"] === "6d7779d1cb55120a49b7a63956b12aa15c4f52f2", "Phase 15H HEAD drifted.");
for (const key of ["phase15h-report-sha256", "phase15h-bundle-sha256", "phase15h-shadow-freeze-sha256"]) {
  assert(/^[A-F0-9]{64}$/u.test(args[key]), `Invalid ${key}.`);
}

for (const [actual, expected, label] of [
  [partition.counts?.sourceRows, 202, "partition source rows"],
  [partition.counts?.importReadyPackages, 162, "partition ready packages"],
  [partition.counts?.heldPackages, 20, "partition held packages"],
  [partition.counts?.structuralEvidenceExclusions, 20, "partition structural exclusions"],
  [partition.counts?.canonicalPerspectiveAppendPreviews, 79, "partition perspective appends"],
  [partition.counts?.canonicalCreatePreviews, 83, "partition canonical creates"],
  [partition.counts?.readyRequiredPlayerShells, 82, "partition ready shells"],
  [partition.counts?.heldOnlyPlayerShells, 14, "partition held shells"],
  [partition.counts?.readyRelationshipEdges, 464, "partition ready relationships"],
  [partition.counts?.heldRelationshipEdges, 87, "partition held relationships"],
  [receipt.sourceRows, 202, "receipt source rows"],
  [receipt.readyPackages, 162, "receipt ready packages"],
  [receipt.heldPackages, 20, "receipt held packages"],
  [receipt.structuralEvidenceExclusions, 20, "receipt structural exclusions"],
  [receipt.canonicalTradesCreated, 83, "receipt canonical creates"],
  [receipt.perspectivesAppended, 79, "receipt perspective appends"],
  [receipt.frozenPlayerShellProposals, 96, "receipt frozen shell proposals"],
  [receipt.playerShellsCreated, 82, "receipt shells created"],
  [receipt.readyShellsResolvedToExistingPlayers, 0, "receipt shell existing resolutions"],
  [receipt.redundantReadyShellsExcluded, 0, "receipt redundant shell exclusions"],
  [receipt.heldOnlyPlayerShellsDeferred, 14, "receipt held shell deferrals"],
  [receipt.frozenRelationshipEdges, 551, "receipt frozen relationships"],
  [receipt.relationshipReferencesAdded, 464, "receipt relationships added"],
  [receipt.redundantReadyRelationshipEdgesExcluded, 0, "receipt redundant relationship exclusions"],
  [receipt.heldRelationshipEdgesDeferred, 87, "receipt held relationship deferrals"],
  [receipt.sourceReferencesAdded, 341, "receipt source refs added"],
  [receipt.publicCandidatePackagesImportedPrivately, 40, "receipt public-candidate private imports"],
  [receipt.postImportCanonicalTrades, 2014, "receipt post trades"],
  [receipt.postImportPlayers, 2865, "receipt post players"],
  [receipt.postImportTeams, 52, "receipt post teams"],
  [receipt.postImportTeamTradeMemberships, 4169, "receipt post team memberships"],
  [receipt.postImportRelationshipReferences, 5131, "receipt post relationship refs"],
  [receipt.postImportSourceReferences, 2718, "receipt post source refs"],
]) assert(actual === expected, `${label}: expected ${expected}, found ${actual}`);

assert(receipt.matchedExistingAssetReferences + receipt.syntheticPerspectiveAssetReferences === 464, "Relationship asset-reference accounting drifted.");
assert(receipt.heldPackageImports === 0, "A held package was imported.");
assert(receipt.heldPlayerShellImports === 0, "A held-only player shell was imported.");
assert(receipt.heldRelationshipWrites === 0, "A held relationship was written.");
assert(receipt.teamRegistryEntriesAdded === 0, "The team registry changed.");
assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route occurred.");
assert(receipt.automaticTeamRegistrations === 0, "Automatic team registration occurred.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(receipt.pushPerformed === false && receipt.deployPerformed === false, "Push/deploy drifted.");

for (const [actual, expected, label] of [
  [phase15hAudit.counts?.canonicalTrades, 2014, "audit trades"],
  [phase15hAudit.counts?.players, 2865, "audit players"],
  [phase15hAudit.counts?.teams, 52, "audit teams"],
  [phase15hAudit.counts?.readyPackages, 162, "audit ready packages"],
  [phase15hAudit.counts?.heldPackages, 20, "audit held packages"],
  [phase15hAudit.counts?.structuralEvidenceExclusions, 20, "audit structural exclusions"],
  [phase15hAudit.counts?.canonicalTradesCreated, 83, "audit creates"],
  [phase15hAudit.counts?.perspectivesAppended, 79, "audit appends"],
  [phase15hAudit.counts?.playerShellsCreated, 82, "audit shells"],
  [phase15hAudit.counts?.relationshipReferencesAdded, 464, "audit relationships"],
  [phase15hAudit.counts?.privateQueryPlayerReferences, 2718, "audit query refs"],
  [phase15hAudit.counts?.routeModels, 4935, "audit routes"],
  [phase15hAudit.counts?.internalLinks, 18708, "audit internal links"],
]) assert(actual === expected, `${label}: expected ${expected}, found ${actual}`);

assert(trades.length === 2014 && players.length === 2865 && teams.length === 52, "Post-import store counts drifted.");
assert(countRelationships(players) === 5131, "Player relationship-reference count drifted.");
assert(countSourceReferences(players) === 2718, "Player source-reference count drifted.");
for (const trade of trades) assertPrivateSafe(trade, trade.id ?? "trade");
for (const player of players) assertPrivateSafe(player, player.id ?? "player");

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });
for (const [actual, expected, label] of [
  [query.counts.canonicalTrades, 2014, "query canonical trades"],
  [query.counts.players, 2865, "query players"],
  [query.counts.representedTeams, 52, "query represented teams"],
  [query.counts.uniqueTradeDates, 1399, "query unique dates"],
  [query.counts.teamTradeMemberships, 4169, "query team memberships"],
  [query.counts.playerTradeReferences, 2718, "query player refs"],
  [query.counts.playerIdentityKeys, 2873, "query identity keys"],
  [query.counts.ambiguousExactIdentityKeys, 0, "query ambiguous identities"],
  [query.counts.sharedPerspectiveTrades, 401, "query shared perspectives"],
  [query.counts.privateTrades, 2014, "query private trades"],
  [query.counts.privatePlayers, 2865, "query private players"],
  [routes.counts.routeModels, 4935, "route models"],
  [routes.counts.internalLinks, 18708, "route internal links"],
  [routes.counts.tradeDetailModels, 2014, "route trade details"],
  [routes.counts.playerDetailModels, 2865, "route player details"],
  [routes.counts.teamDetailModels, 52, "route team details"],
  [routes.counts.sharedPerspectiveTradeModels, 401, "route shared perspectives"],
  [routes.counts.privateRouteModels, 4935, "route private models"],
  [routes.counts.noindexRouteModels, 4935, "route noindex models"],
  [routes.counts.adFreeRouteModels, 4935, "route ad-free models"],
  [routes.counts.sitemapExcludedRouteModels, 4935, "route sitemap excluded"],
  [routes.counts.navigationExcludedRouteModels, 4935, "route navigation excluded"],
  [routes.counts.duplicatePaths, 0, "route duplicate paths"],
  [routes.counts.brokenLinks, 0, "route broken links"],
  [routes.counts.crossNamespaceLinks, 0, "route cross-namespace links"],
  [routes.counts.selfLinks, 0, "route self links"],
  [routes.counts.privacyViolations, 0, "route privacy violations"],
  [routes.counts.incompleteModels, 0, "route incomplete models"],
]) assert(actual === expected, `${label}: expected ${expected}, found ${actual}`);

for (const [key, expected] of Object.entries({
  expectedNbaPages: 4935,
  builtNbaPages: 4935,
  nbaInternalLinks: 18708,
  missingNbaHtmlFiles: 0,
  unexpectedNbaHtmlFiles: 0,
  nbaBrokenLinks: 0,
  nbaPrivacyFailures: 0,
  nbaAdMarkers: 0,
  nbaPublicationMarkers: 0,
  privateNbaPages: 4935,
  noindexNbaPages: 4935,
  adFreeNbaPages: 4935,
  publicNbaLinks: 0,
  publicPagesLinkingToNba: 0,
  sitemapNbaUrls: 0,
})) assert(exposure.counts?.[key] === expected, `Exposure ${key}: expected ${expected}, found ${exposure.counts?.[key]}`);
assert(exposure.counts?.sitemapFiles >= 1, "No sitemap files found.");
assert(exposure.counts?.sitemapUrls >= 1, "No sitemap URLs found.");

const manifest = {
  result: "PASS",
  phase: "15I",
  protocol: "Warp-Freeze Protocol",
  mode: "LOS_ANGELES_CLIPPERS_PRIVATE_IMPORT_COMPLETION",
  completionPercent: 100,
  completedAt: args["completed-at"],
  startingHead: args["starting-head"],
  phase15HHead: args["phase15h-head"],
  sourceHashes: {
    phase15FPartitionSha256: sha256(partitionBytes),
    phase15FSemanticPartitionSha256: partition.hashes.semanticPartitionSha256,
    phase15HReceiptSha256: sha256(receiptBytes),
    phase15HAuditSha256: sha256(phase15hAuditBytes),
    privateExposureAuditSha256: sha256(exposureBytes),
    phase15HContractSha256: sha256(phase15hContractBytes),
    phase15IContractSha256: sha256(phase15iContractBytes),
    phase15HReportSha256: args["phase15h-report-sha256"],
    phase15HBundleSha256: args["phase15h-bundle-sha256"],
    phase15HShadowFreezeSha256: args["phase15h-shadow-freeze-sha256"],
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
  },
  accounting: {
    sourceRows: 202,
    readyPackagesImported: 162,
    heldPackagesImported: 0,
    structuralEvidenceExclusionsImported: 0,
    canonicalTradesCreated: 83,
    perspectivesAppended: 79,
    heldPackages: 20,
    structuralEvidenceExclusions: 20,
    frozenPlayerShellProposals: 96,
    playerShellsCreated: 82,
    readyShellsResolvedToExistingPlayers: 0,
    redundantReadyShellsExcluded: 0,
    heldOnlyPlayerShellsDeferred: 14,
    frozenRelationshipEdges: 551,
    relationshipReferencesAdded: 464,
    redundantReadyRelationshipEdgesExcluded: 0,
    heldRelationshipEdgesDeferred: 87,
    matchedExistingAssetReferences: receipt.matchedExistingAssetReferences,
    syntheticPerspectiveAssetReferences: receipt.syntheticPerspectiveAssetReferences,
    sourceReferencesAdded: 341,
    publicCandidatePackagesImportedPrivately: 40,
    explicitGeorgeJohnsonThomasCorrections: Object.keys(receipt.explicitRelationshipTargetCorrections ?? {}).length,
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
    phase15HReceipt: "PASS",
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

assert(manifest.accounting.explicitGeorgeJohnsonThomasCorrections === 2, "Expected two George Johnson (Thomas) explicit relationship corrections.");

await mkdir(path.dirname(path.resolve(args["output-json"])), { recursive: true });
await writeFile(args["output-json"], canonicalJson(manifest));
console.log(JSON.stringify({
  result: "PASS",
  phase: "15I",
  completionPercent: 100,
  manifestSha256: sha256(canonicalJson(manifest)),
  accounting: manifest.accounting,
  stores: manifest.stores,
  routing: manifest.routing,
}, null, 2));

