#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex").toUpperCase(); }
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function clean(value) { return String(value ?? "").trim(); }

const args = parseArgs(process.argv);
for (const key of [
  "records-json","partition-json","receipt-json","phase19h-audit-json","exposure-audit-json",
  "trades-json","players-json","teams-json","phase19h-contract-md","phase19i-contract-md",
  "output-json","completed-at","starting-head","phase19h-head",
  "phase19h-report-sha256","phase19h-bundle-sha256","phase19h-shadow-freeze-sha256",
  "identity-diagnostic-json-sha256","identity-diagnostic-csv-sha256",
  "expected-records-sha256","expected-partition-sha256","expected-partition-semantic-sha256",
  "expected-canonical-store-sha256","expected-player-store-sha256","expected-team-store-sha256",
  "expected-receipt-sha256","expected-audit-sha256"
]) assert(args[key], `Missing --${key}`);

const [
  recordsBytes, partitionBytes, receiptBytes, auditBytes, exposureBytes,
  tradeBytes, playerBytes, teamBytes, phase19hContractBytes, phase19iContractBytes
] = await Promise.all([
  readFile(args["records-json"]), readFile(args["partition-json"]), readFile(args["receipt-json"]),
  readFile(args["phase19h-audit-json"]), readFile(args["exposure-audit-json"]),
  readFile(args["trades-json"]), readFile(args["players-json"]), readFile(args["teams-json"]),
  readFile(args["phase19h-contract-md"]), readFile(args["phase19i-contract-md"])
]);

const records = JSON.parse(recordsBytes.toString("utf8"));
const partition = JSON.parse(partitionBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const audit = JSON.parse(auditBytes.toString("utf8"));
const exposure = JSON.parse(exposureBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

for (const [actual, expected, label] of [
  [sha256(recordsBytes), args["expected-records-sha256"], "records"],
  [sha256(partitionBytes), args["expected-partition-sha256"], "partition"],
  [partition.hashes?.semanticPartitionSha256, args["expected-partition-semantic-sha256"], "semantic partition"],
  [sha256(receiptBytes), args["expected-receipt-sha256"], "receipt"],
  [sha256(auditBytes), args["expected-audit-sha256"], "Phase 19H audit"],
  [sha256(tradeBytes), args["expected-canonical-store-sha256"], "canonical store"],
  [sha256(playerBytes), args["expected-player-store-sha256"], "player store"],
  [sha256(teamBytes), args["expected-team-store-sha256"], "team store"],
]) assert(actual === expected, `${label} hash drifted: ${actual} !== ${expected}`);

assert(Array.isArray(records.records) && records.records.length === 201, "Phase 19B record count drifted.");
assert(partition.result === "PASS" && partition.phase === "19F" && partition.team === "milwaukee-bucks", "Invalid Phase 19F partition.");
assert(receipt.result === "PASS" && receipt.phase === "19H" && receipt.team === "milwaukee-bucks", "Invalid Phase 19H receipt.");
assert(audit.result === "PASS" && audit.phase === "19H", "Invalid Phase 19H audit.");
assert(exposure.result === "PASS" && exposure.phase === "SCALABLE-PRIVATE-EXPOSURE", "Invalid private exposure audit.");

for (const [actual, expected, label] of [
  [partition.counts?.sourceRows, 201, "partition source rows"],
  [partition.counts?.importReadyPackages, 163, "partition ready"],
  [partition.counts?.heldPackages, 31, "partition held"],
  [partition.counts?.structuralEvidenceExclusions, 7, "partition exclusions"],
  [partition.counts?.canonicalPerspectiveAppendPreviews, 92, "partition appends"],
  [partition.counts?.canonicalCreatePreviews, 71, "partition creates"],
  [partition.counts?.readyRequiredPlayerShells, 69, "partition ready shell proposals"],
  [partition.counts?.heldOnlyPlayerShells, 20, "partition held shells"],
  [partition.counts?.readyRelationshipEdges, 428, "partition ready relationships"],
  [partition.counts?.heldRelationshipEdges, 130, "partition held relationships"],
  [partition.counts?.readyTeamDependencyOccurrences, 326, "partition ready teams"],
  [partition.counts?.heldTeamDependencyOccurrences, 89, "partition held teams"],

  [receipt.readyPackages, 163, "receipt ready"],
  [receipt.heldPackages, 31, "receipt held"],
  [receipt.structuralEvidenceExclusions, 7, "receipt exclusions"],
  [receipt.canonicalTradesCreated, 71, "receipt creates"],
  [receipt.perspectivesAppended, 92, "receipt appends"],
  [receipt.playerShellsCreated, 66, "receipt created shells"],
  [receipt.readyShellsResolvedToExistingPlayers, 3, "receipt resolved shells"],
  [receipt.heldOnlyPlayerShellsDeferred, 20, "receipt held shells"],
  [receipt.relationshipReferencesAdded, 428, "receipt relationships"],
  [receipt.heldRelationshipEdgesDeferred, 130, "receipt held relationships"],
  [receipt.readyTeamDependencies, 326, "receipt ready team dependencies"],
  [receipt.effectiveReadyTeamDependencies, 326, "receipt effective team dependencies"],
  [receipt.heldTeamDependencies, 89, "receipt held team dependencies"],
  [receipt.existingPerspectiveReviewHolds, 0, "receipt existing-perspective holds"],
  [receipt.ambiguousIdentityOccurrencesDeferred, 2, "receipt ambiguous identities"],
  [receipt.matchedExistingAssetReferences, 417, "receipt matched asset references"],
  [receipt.syntheticPerspectiveAssetReferences, 11, "receipt synthetic asset references"],
  [receipt.postImportCanonicalTrades, 2249, "receipt final trades"],
  [receipt.postImportPlayers, 3093, "receipt final players"],
  [receipt.postImportTeams, 52, "receipt final teams"],

  [audit.counts?.canonicalTrades, 2249, "audit trades"],
  [audit.counts?.players, 3093, "audit players"],
  [audit.counts?.teams, 52, "audit teams"],
  [audit.counts?.readyPackages, 163, "audit ready"],
  [audit.counts?.heldPackages, 31, "audit held"],
  [audit.counts?.structuralEvidenceExclusions, 7, "audit exclusions"],
  [audit.counts?.canonicalTradesCreated, 71, "audit creates"],
  [audit.counts?.perspectivesAppended, 92, "audit appends"],
  [audit.counts?.playerShellsCreated, 66, "audit shells"],
  [audit.counts?.deferredPlayerShells, 20, "audit deferred shells"],
  [audit.counts?.relationshipReferencesAdded, 428, "audit relationships"],
  [audit.counts?.deferredRelationshipEdges, 130, "audit deferred relationships"],
  [audit.counts?.readyTeamDependencies, 326, "audit ready teams"],
  [audit.counts?.heldTeamDependencies, 89, "audit held teams"],
  [audit.counts?.ambiguousIdentityOccurrencesDeferred, 2, "audit ambiguous identities"],
  [audit.counts?.matchedExistingAssetReferences, 417, "audit matched assets"],
  [audit.counts?.syntheticPerspectiveAssetReferences, 11, "audit synthetic assets"],
  [audit.counts?.ownershipConflictSyntheticReferences, 2, "audit ownership synthetic guards"],
  [audit.counts?.privateQueryPlayerReferences, 3580, "audit private query refs"],
  [audit.counts?.routeModels, 5398, "audit route models"],
  [audit.counts?.internalLinks, 21835, "audit internal links"],

  [exposure.counts?.expectedNbaPages, 5398, "exposure expected pages"],
  [exposure.counts?.builtNbaPages, 5398, "exposure built pages"],
  [exposure.counts?.nbaInternalLinks, 21835, "exposure internal links"],
  [exposure.counts?.nbaBrokenLinks, 0, "exposure broken links"],
  [exposure.counts?.nbaPrivacyFailures, 0, "exposure privacy failures"],
  [exposure.counts?.nbaAdMarkers, 0, "exposure ad markers"],
  [exposure.counts?.publicNbaLinks, 0, "exposure public links"],
  [exposure.counts?.sitemapNbaUrls, 0, "exposure sitemap URLs"],
]) assert(actual === expected, `${label} drifted: ${actual} !== ${expected}`);

assert(trades.length === 2249 && players.length === 3093 && teams.length === 52, "Final store counts drifted.");
assert(audit.safety?.invalidPlayerReferences === 0, "Invalid player references detected.");
assert(audit.safety?.duplicateReferenceOwnership === 0, "Duplicate relationship/source-reference ownership detected.");
assert(audit.safety?.extraPlayerReferences === 0, "Extra player references detected.");
assert(audit.safety?.invalidTradeTeams === 0, "Invalid trade teams detected.");
assert(audit.safety?.publicationAuthorized === false, "Phase 19H audit publication authorization drifted.");
assert(receipt.publicationAuthorized === false && receipt.pushPerformed === false && receipt.deployPerformed === false, "Receipt publication/push/deploy state drifted.");

const expectedOverrides = new Map([
  ["nba-player-d-j-augustin-62f0387e0b", "nba-player-dj-augustin-7b32f3fe01"],
  ["nba-player-o-g-anunoby-2b0d93df9f", "nba-player-og-anunoby"],
  ["nba-player-r-j-hampton-0a2d6dcc68", "nba-player-rj-hampton-62cbde2ae5"],
]);
assert(Array.isArray(receipt.exactExistingPlayerOverrides) && receipt.exactExistingPlayerOverrides.length === 3, "Exact existing-player override count drifted.");
for (const row of receipt.exactExistingPlayerOverrides) {
  assert(expectedOverrides.get(clean(row.proposedPlayerId)) === clean(row.existingPlayerId), `Unexpected exact identity override: ${JSON.stringify(row)}`);
}
assert(Array.isArray(receipt.ownershipConflictSyntheticRelationshipIds) && receipt.ownershipConflictSyntheticRelationshipIds.length === 2, "Ownership-conflict synthetic guard count drifted.");

for (const [value, expected, label] of [
  [receipt.importedCanonicalTradeIds?.length, 71, "created trade IDs"],
  [receipt.updatedPerspectiveCanonicalIds?.length, 92, "updated perspective IDs"],
  [receipt.createdPlayerIds?.length, 66, "created player IDs"],
  [receipt.relationshipIds?.length, 428, "relationship IDs"],
  [receipt.deferredRelationshipIds?.length, 130, "deferred relationship IDs"],
  [receipt.heldSourceTradeIds?.length, 31, "held trade IDs"],
  [receipt.structuralEvidenceExcludedSourceTradeIds?.length, 7, "excluded trade IDs"],
]) assert(value === expected, `${label} drifted: ${value} !== ${expected}`);

const manifest = {
  result: "PASS",
  phase: "19I",
  protocol: "Warp-Freeze Protocol",
  completionPercent: 100,
  completionStatus: "CLOSED",
  team: "milwaukee-bucks",
  startingHead: args["starting-head"],
  phase19HHead: args["phase19h-head"],
  completedAt: args["completed-at"],
  accounting: {
    sourceRows: 201,
    readyPackagesImported: 163,
    heldPackagesImported: 0,
    heldPackagesDeferred: 31,
    structuralEvidenceExclusionsImported: 0,
    structuralEvidenceExclusionsDeferred: 7,
    canonicalTradesCreated: 71,
    perspectivesAppended: 92,
    readyPlayerShellProposals: 69,
    playerShellsCreated: 66,
    readyShellsResolvedToExistingPlayers: 3,
    heldOnlyPlayerShellsDeferred: 20,
    relationshipReferencesAdded: 428,
    heldRelationshipEdgesDeferred: 130,
    frozenReadyTeamDependencies: 326,
    effectiveReadyTeamDependencies: 326,
    heldTeamDependencies: 89,
    existingPerspectiveReviewHolds: 0,
    ambiguousIdentityOccurrencesDeferred: 2,
    matchedExistingAssetReferences: 417,
    syntheticPerspectiveAssetReferences: 11,
    ownershipConflictSyntheticReferences: 2,
    sourceReferencesAdded: receipt.sourceReferencesAdded,
  },
  stores: {
    canonicalTrades: 2249,
    players: 3093,
    teams: 52,
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
  },
  privateQuery: {
    playerTradeReferences: 3580,
    ambiguousExactIdentityKeys: 0,
  },
  routing: {
    routeModels: 5398,
    internalLinks: 21835,
    brokenLinks: 0,
    privacyViolations: 0,
  },
  exposure: {
    builtNbaPages: 5398,
    internalLinks: 21835,
    brokenLinks: 0,
    privacyFailures: 0,
    adMarkers: 0,
    publicNbaLinks: 0,
    sitemapNbaUrls: 0,
  },
  exactIdentityResolutions: {
    "nba-player-d-j-augustin-62f0387e0b": "nba-player-dj-augustin-7b32f3fe01",
    "nba-player-o-g-anunoby-2b0d93df9f": "nba-player-og-anunoby",
    "nba-player-r-j-hampton-0a2d6dcc68": "nba-player-rj-hampton-62cbde2ae5",
    diagnosticJsonSha256: args["identity-diagnostic-json-sha256"],
    diagnosticCsvSha256: args["identity-diagnostic-csv-sha256"],
  },
  ownershipConflictSyntheticRelationshipIds: receipt.ownershipConflictSyntheticRelationshipIds,
  hashes: {
    phase19BRecordsSha256: sha256(recordsBytes),
    phase19FPartitionSha256: sha256(partitionBytes),
    phase19FSemanticPartitionSha256: partition.hashes.semanticPartitionSha256,
    phase19HReceiptSha256: sha256(receiptBytes),
    phase19HAuditSha256: sha256(auditBytes),
    phase19HContractSha256: sha256(phase19hContractBytes),
    phase19IContractSha256: sha256(phase19iContractBytes),
    privateExposureAuditSha256: sha256(exposureBytes),
    phase19HReportSha256: args["phase19h-report-sha256"],
    phase19HBundleSha256: args["phase19h-bundle-sha256"],
    phase19HShadowFreezeSha256: args["phase19h-shadow-freeze-sha256"],
  },
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

await mkdir(path.dirname(path.resolve(args["output-json"])), { recursive: true });
await writeFile(args["output-json"], canonicalJson(manifest));
console.log(JSON.stringify(manifest, null, 2));
