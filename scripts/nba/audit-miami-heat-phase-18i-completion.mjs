#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
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
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}
function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const args = parseArgs(process.argv);
for (const required of [
  "records-json",
  "partition-json",
  "receipt-json",
  "phase18h-audit-json",
  "exposure-audit-json",
  "trades-json",
  "players-json",
  "teams-json",
  "phase18h-contract-md",
  "phase18i-contract-md",
  "output-json",
  "completed-at",
  "starting-head",
  "phase18h-head",
  "phase18h-report-sha256",
  "phase18h-bundle-sha256",
  "phase18h-shadow-freeze-sha256",
  "identity-diagnostic-json-sha256",
  "identity-diagnostic-csv-sha256",
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
  recordsBytes,
  partitionBytes,
  receiptBytes,
  auditBytes,
  exposureBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  phase18hContractBytes,
  phase18iContractBytes,
] = await Promise.all([
  readFile(args["records-json"]),
  readFile(args["partition-json"]),
  readFile(args["receipt-json"]),
  readFile(args["phase18h-audit-json"]),
  readFile(args["exposure-audit-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["phase18h-contract-md"]),
  readFile(args["phase18i-contract-md"]),
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
  [sha256(auditBytes), args["expected-audit-sha256"], "Phase 18H audit"],
  [sha256(tradeBytes), args["expected-canonical-store-sha256"], "canonical store"],
  [sha256(playerBytes), args["expected-player-store-sha256"], "player store"],
  [sha256(teamBytes), args["expected-team-store-sha256"], "team store"],
]) {
  assert(actual === expected, `${label} hash drifted: ${actual} !== ${expected}`);
}

assert(records.result === "PASS" && records.phase === "18B", "Invalid Phase 18B records.");
assert(Array.isArray(records.records) && records.records.length === 98, "Phase 18B record count drifted.");
assert(partition.result === "PASS" && partition.phase === "18F", "Invalid Phase 18F partition.");
assert(receipt.result === "PASS" && receipt.phase === "18H", "Invalid Phase 18H receipt.");
assert(audit.result === "PASS" && audit.phase === "18H", "Invalid Phase 18H audit.");
assert(exposure.result === "PASS" && exposure.phase === "SCALABLE-PRIVATE-EXPOSURE", "Invalid private exposure audit.");

for (const [actual, expected, label] of [
  [partition.counts?.sourceRows, 98, "partition source rows"],
  [partition.counts?.importReadyPackages, 75, "partition ready"],
  [partition.counts?.heldPackages, 12, "partition held"],
  [partition.counts?.structuralEvidenceExclusions, 11, "partition exclusions"],
  [partition.counts?.canonicalPerspectiveAppendPreviews, 38, "partition appends"],
  [partition.counts?.canonicalCreatePreviews, 37, "partition creates"],
  [partition.counts?.readyRequiredPlayerShells, 29, "partition ready shell proposals"],
  [partition.counts?.heldOnlyPlayerShells, 6, "partition held shells"],
  [partition.counts?.readyRelationshipEdges, 204, "partition ready relationships"],
  [partition.counts?.heldRelationshipEdges, 58, "partition held relationships"],
  [partition.counts?.readyTeamDependencyOccurrences, 149, "partition ready teams"],
  [partition.counts?.heldTeamDependencyOccurrences, 37, "partition held teams"],

  [receipt.sourceRows, 98, "receipt source rows"],
  [receipt.readyPackages, 75, "receipt ready"],
  [receipt.heldPackages, 12, "receipt held"],
  [receipt.structuralEvidenceExclusions, 11, "receipt exclusions"],
  [receipt.canonicalTradesCreated, 37, "receipt creates"],
  [receipt.perspectivesAppended, 38, "receipt appends"],
  [receipt.playerShellsCreated, 28, "receipt created shells"],
  [receipt.readyShellsResolvedToExistingPlayers, 1, "receipt resolved shell"],
  [receipt.heldOnlyPlayerShellsDeferred, 6, "receipt held shells"],
  [receipt.relationshipReferencesAdded, 204, "receipt relationships"],
  [receipt.heldRelationshipEdgesDeferred, 58, "receipt held relationships"],
  [receipt.readyTeamDependencies, 149, "receipt frozen team dependencies"],
  [receipt.effectiveReadyTeamDependencies, 150, "receipt effective team dependencies"],
  [receipt.heldTeamDependencies, 37, "receipt held team dependencies"],
  [receipt.existingPerspectiveReviewHolds, 0, "receipt existing-perspective holds"],
  [receipt.ambiguousIdentityOccurrencesDeferred, 2, "receipt ambiguous identities"],
  [receipt.matchedExistingAssetReferences, 203, "receipt matched assets"],
  [receipt.syntheticPerspectiveAssetReferences, 1, "receipt synthetic assets"],
  [receipt.postImportCanonicalTrades, 2178, "receipt final trades"],
  [receipt.postImportPlayers, 3027, "receipt final players"],
  [receipt.postImportTeams, 52, "receipt final teams"],

  [audit.counts?.canonicalTrades, 2178, "audit trades"],
  [audit.counts?.players, 3027, "audit players"],
  [audit.counts?.teams, 52, "audit teams"],
  [audit.counts?.readyPackages, 75, "audit ready"],
  [audit.counts?.heldPackages, 12, "audit held"],
  [audit.counts?.structuralEvidenceExclusions, 11, "audit exclusions"],
  [audit.counts?.canonicalTradesCreated, 37, "audit creates"],
  [audit.counts?.perspectivesAppended, 38, "audit appends"],
  [audit.counts?.playerShellsCreated, 28, "audit shells"],
  [audit.counts?.readyShellsResolvedToExistingPlayers, 1, "audit resolved shell"],
  [audit.counts?.deferredPlayerShells, 6, "audit deferred shells"],
  [audit.counts?.relationshipReferencesAdded, 204, "audit relationships"],
  [audit.counts?.deferredRelationshipEdges, 58, "audit deferred relationships"],
  [audit.counts?.readyTeamDependencies, 149, "audit frozen team dependencies"],
  [audit.counts?.effectiveReadyTeamDependencies, 150, "audit effective team dependencies"],
  [audit.counts?.heldTeamDependencies, 37, "audit held team dependencies"],
  [audit.counts?.existingPerspectiveReviewHolds, 0, "audit existing-perspective holds"],
  [audit.counts?.ambiguousIdentityOccurrencesDeferred, 2, "audit ambiguous identities"],
  [audit.counts?.matchedExistingAssetReferences, 203, "audit matched assets"],
  [audit.counts?.syntheticPerspectiveAssetReferences, 1, "audit synthetic assets"],
  [audit.counts?.ownershipConflictSyntheticReferences, 1, "audit ownership guard"],
  [audit.counts?.privateQueryPlayerReferences, 3304, "audit private query refs"],
  [audit.counts?.routeModels, 5261, "audit route models"],
  [audit.counts?.internalLinks, 20862, "audit internal links"],

  [exposure.counts?.expectedNbaPages, 5261, "exposure expected pages"],
  [exposure.counts?.builtNbaPages, 5261, "exposure built pages"],
  [exposure.counts?.nbaInternalLinks, 20862, "exposure internal links"],
  [exposure.counts?.nbaBrokenLinks, 0, "exposure broken links"],
  [exposure.counts?.nbaPrivacyFailures, 0, "exposure privacy failures"],
  [exposure.counts?.nbaAdMarkers, 0, "exposure ad markers"],
  [exposure.counts?.publicNbaLinks, 0, "exposure public links"],
  [exposure.counts?.sitemapNbaUrls, 0, "exposure sitemap URLs"],
]) {
  assert(actual === expected, `${label} drifted: ${actual} !== ${expected}`);
}

assert(trades.length === 2178 && players.length === 3027 && teams.length === 52, "Final store counts drifted.");
assert(audit.safety?.duplicateReferenceOwnership === 0, "Duplicate relationship ownership detected.");
assert(audit.safety?.publicationAuthorized === false, "Phase 18H audit publication authorization drifted.");
assert(receipt.publicationAuthorized === false, "Receipt publication authorization drifted.");
assert(receipt.pushPerformed === false && receipt.deployPerformed === false, "Receipt push/deploy status drifted.");

assert(
  receipt.explicitPlayerTargetCorrections?.["nba-player-a-j-hammons"] ===
    "nba-player-aj-hammons-10e57ab027",
  "A.J. Hammons existing-player correction drifted.",
);
assert(
  receipt.explicitPlayerTargetCorrectionEvidence?.["nba-player-a-j-hammons"]?.diagnosticJsonSha256 ===
    args["identity-diagnostic-json-sha256"] &&
  receipt.explicitPlayerTargetCorrectionEvidence?.["nba-player-a-j-hammons"]?.diagnosticCsvSha256 ===
    args["identity-diagnostic-csv-sha256"],
  "A.J. Hammons diagnostic hash evidence drifted.",
);
assert(
  Array.isArray(receipt.ownershipConflictSyntheticRelationshipIds) &&
  receipt.ownershipConflictSyntheticRelationshipIds.length === 1 &&
  Array.isArray(receipt.forcedSyntheticRelationshipIds) &&
  receipt.forcedSyntheticRelationshipIds.length === 1,
  "Synthetic ownership-guard accounting drifted.",
);
assert(
  receipt.explicitTeamDependencyCorrections?.["MIA-2005-0037"]?.canonicalTeamSlug ===
    "charlotte-hornets",
  "MIA-2005-0037 Bobcats/Charlotte correction drifted.",
);

for (const [value, expected, label] of [
  [receipt.importedCanonicalTradeIds?.length, 37, "created trade IDs"],
  [receipt.updatedPerspectiveCanonicalIds?.length, 38, "updated perspective IDs"],
  [receipt.importedPlayerIds?.length, 28, "imported player IDs"],
  [receipt.readyShellsResolvedToExistingPlayerIds?.length, 1, "resolved player IDs"],
  [receipt.deferredPlayerIds?.length, 6, "deferred player IDs"],
  [receipt.relationshipIds?.length, 204, "relationship IDs"],
  [receipt.deferredRelationshipIds?.length, 58, "deferred relationship IDs"],
  [receipt.heldSourceTradeIds?.length, 12, "held trade IDs"],
  [receipt.structuralEvidenceExcludedSourceTradeIds?.length, 11, "excluded trade IDs"],
]) {
  assert(value === expected, `${label} drifted: ${value} !== ${expected}`);
}

const manifest = {
  result: "PASS",
  phase: "18I",
  protocol: "Warp-Freeze Protocol",
  completionPercent: 100,
  completionStatus: "CLOSED",
  team: "miami-heat",
  startingHead: args["starting-head"],
  phase18HHead: args["phase18h-head"],
  completedAt: args["completed-at"],
  accounting: {
    sourceRows: 98,
    readyPackagesImported: 75,
    heldPackagesImported: 0,
    heldPackagesDeferred: 12,
    structuralEvidenceExclusionsImported: 0,
    structuralEvidenceExclusionsDeferred: 11,
    canonicalTradesCreated: 37,
    perspectivesAppended: 38,
    readyPlayerShellProposals: 29,
    playerShellsCreated: 28,
    readyShellsResolvedToExistingPlayers: 1,
    heldOnlyPlayerShellsDeferred: 6,
    relationshipReferencesAdded: 204,
    heldRelationshipEdgesDeferred: 58,
    frozenReadyTeamDependencies: 149,
    effectiveReadyTeamDependencies: 150,
    heldTeamDependencies: 37,
    existingPerspectiveReviewHolds: 0,
    ambiguousIdentityOccurrencesDeferred: 2,
    matchedExistingAssetReferences: 203,
    syntheticPerspectiveAssetReferences: 1,
    ownershipConflictSyntheticReferences: 1,
    sourceReferencesAdded: receipt.sourceReferencesAdded,
  },
  stores: {
    canonicalTrades: 2178,
    players: 3027,
    teams: 52,
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
  },
  privateQuery: {
    playerTradeReferences: 3304,
    ambiguousExactIdentityKeys: 0,
  },
  routing: {
    routeModels: 5261,
    internalLinks: 20862,
    brokenLinks: 0,
    privacyViolations: 0,
  },
  exposure: {
    builtNbaPages: 5261,
    internalLinks: 20862,
    brokenLinks: 0,
    privacyFailures: 0,
    adMarkers: 0,
    publicNbaLinks: 0,
    sitemapNbaUrls: 0,
  },
  corrections: {
    ajHammons: {
      proposedPlayerId: "nba-player-a-j-hammons",
      resolvedPlayerId: "nba-player-aj-hammons-10e57ab027",
      diagnosticJsonSha256: args["identity-diagnostic-json-sha256"],
      diagnosticCsvSha256: args["identity-diagnostic-csv-sha256"],
    },
    bobcatsCharlotte: {
      sourceTradeId: "MIA-2005-0037",
      canonicalTeamSlug: "charlotte-hornets",
    },
    ownershipConflictSyntheticRelationships:
      receipt.ownershipConflictSyntheticRelationshipIds,
  },
  hashes: {
    phase18BRecordsSha256: sha256(recordsBytes),
    phase18FPartitionSha256: sha256(partitionBytes),
    phase18FSemanticPartitionSha256: partition.hashes.semanticPartitionSha256,
    phase18HReceiptSha256: sha256(receiptBytes),
    phase18HAuditSha256: sha256(auditBytes),
    phase18HContractSha256: sha256(phase18hContractBytes),
    phase18IContractSha256: sha256(phase18iContractBytes),
    privateExposureAuditSha256: sha256(exposureBytes),
    phase18HReportSha256: args["phase18h-report-sha256"],
    phase18HBundleSha256: args["phase18h-bundle-sha256"],
    phase18HShadowFreezeSha256: args["phase18h-shadow-freeze-sha256"],
  },
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

await mkdir(path.dirname(path.resolve(args["output-json"])), { recursive: true });
await writeFile(args["output-json"], canonicalJson(manifest));
console.log(JSON.stringify(manifest, null, 2));

