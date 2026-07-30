#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
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
function asArrayDocument(raw, property) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw[property])) return raw[property];
  if (raw && Array.isArray(raw.records)) return raw.records;
  throw new Error(`JSON input does not contain ${property} array.`);
}
function clean(value) {
  return String(value ?? "").trim();
}

const args = parseArgs(process.argv);
for (const key of [
  "records-json",
  "partition-json",
  "partition-freeze-json",
  "receipt-json",
  "phase20h-audit-json",
  "exposure-audit-json",
  "trades-json",
  "players-json",
  "teams-json",
  "phase20h-contract-md",
  "phase20i-contract-md",
  "output-json",
  "completed-at",
  "phase20h-head",
  "starting-head",
  "phase20h-report-sha256",
  "phase20h-bundle-sha256",
  "phase20h-shadow-freeze-sha256",
  "expected-records-sha256",
  "expected-partition-sha256",
  "expected-partition-semantic-sha256",
  "expected-canonical-store-sha256",
  "expected-player-store-sha256",
  "expected-team-store-sha256",
  "expected-receipt-sha256",
  "expected-audit-sha256",
]) {
  assert(args[key], `Missing --${key}`);
}

const [
  recordsBytes,
  partitionBytes,
  freezeBytes,
  receiptBytes,
  auditBytes,
  exposureBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  phase20hContractBytes,
  phase20iContractBytes,
] = await Promise.all([
  readFile(args["records-json"]),
  readFile(args["partition-json"]),
  readFile(args["partition-freeze-json"]),
  readFile(args["receipt-json"]),
  readFile(args["phase20h-audit-json"]),
  readFile(args["exposure-audit-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["phase20h-contract-md"]),
  readFile(args["phase20i-contract-md"]),
]);

for (const [actual, expected, label] of [
  [sha256(recordsBytes), args["expected-records-sha256"], "records"],
  [sha256(partitionBytes), args["expected-partition-sha256"], "partition"],
  [sha256(receiptBytes), args["expected-receipt-sha256"], "receipt"],
  [sha256(auditBytes), args["expected-audit-sha256"], "Phase 20H audit"],
  [sha256(tradeBytes), args["expected-canonical-store-sha256"], "canonical store"],
  [sha256(playerBytes), args["expected-player-store-sha256"], "player store"],
  [sha256(teamBytes), args["expected-team-store-sha256"], "team store"],
]) {
  assert(actual === expected, `${label} hash drifted: ${actual} !== ${expected}`);
}

const recordsDocument = JSON.parse(recordsBytes.toString("utf8"));
const partition = JSON.parse(partitionBytes.toString("utf8"));
const freeze = JSON.parse(freezeBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const audit = JSON.parse(auditBytes.toString("utf8"));
const exposure = JSON.parse(exposureBytes.toString("utf8"));

const records = asArrayDocument(recordsDocument, "records");
const trades = asArrayDocument(JSON.parse(tradeBytes.toString("utf8")), "trades");
const players = asArrayDocument(JSON.parse(playerBytes.toString("utf8")), "players");
const teams = asArrayDocument(JSON.parse(teamBytes.toString("utf8")), "teams");

assert(records.length === 121, "Phase 20B record count drifted.");

assert(
  partition.result === "PASS" &&
    partition.phase === "20F-R1" &&
    partition.team === "minnesota-timberwolves",
  "Phase 20F partition metadata drifted."
);
assert(
  clean(partition.semanticPartitionSha256) ===
    args["expected-partition-semantic-sha256"],
  "Phase 20F semantic partition hash drifted."
);

for (const [actual, expected, label] of [
  [freeze.counts?.importReadyPackages, 97, "partition ready packages"],
  [freeze.counts?.heldPackages, 23, "partition held packages"],
  [freeze.counts?.structuralEvidenceExclusions, 1, "partition exclusions"],
  [freeze.counts?.canonicalPerspectiveAppendPreviews, 59, "partition appends"],
  [freeze.counts?.canonicalCreatePreviews, 38, "partition creates"],
  [freeze.counts?.readyRequiredPlayerShells, 35, "partition ready shells"],
  [freeze.counts?.heldOnlyPlayerShells, 13, "partition held-only shells"],
  [freeze.counts?.readyRelationshipEdges, 300, "partition ready relationships"],
  [freeze.counts?.heldRelationshipEdges, 93, "partition held relationships"],
  [freeze.counts?.readyTeamDependencyOccurrences, 194, "partition ready team dependencies"],
  [freeze.counts?.heldTeamDependencyOccurrences, 75, "partition held team dependencies"],
  [freeze.counts?.routingHoldPackages, 12, "routing holds"],
  [freeze.counts?.recentProvisionalHoldPackages, 10, "recent provisional holds"],
  [freeze.counts?.sourceEvidenceHoldPackages, 1, "source-evidence holds"],
  [freeze.counts?.dependencyHeldPackages, 0, "dependency holds"],
  [freeze.counts?.existingPerspectiveReviewHolds, 0, "existing-perspective holds"],
  [freeze.counts?.readyAmbiguousIdentityOccurrences, 0, "ready ambiguous identities"],
  [freeze.counts?.heldAmbiguousIdentityOccurrences, 0, "held ambiguous identities"],
  [freeze.counts?.readyPublicCandidatePackages, 14, "ready public candidates"],
  [freeze.counts?.heldPublicCandidatePackages, 0, "held public candidates"],
]) {
  assert(Number(actual) === expected, `${label} drifted: ${actual} !== ${expected}`);
}

assert(
  receipt.result === "PASS" &&
    receipt.phase === "20H" &&
    receipt.team === "minnesota-timberwolves",
  "Phase 20H receipt metadata drifted."
);

for (const [actual, expected, label] of [
  [receipt.readyPackages, 97, "receipt ready"],
  [receipt.heldPackages, 23, "receipt held"],
  [receipt.structuralEvidenceExclusions, 1, "receipt exclusions"],
  [receipt.canonicalTradesCreated, 38, "receipt creates"],
  [receipt.perspectivesAppended, 59, "receipt appends"],
  [receipt.playerShellsCreated, 35, "receipt created shells"],
  [receipt.readyShellsResolvedToExistingPlayers, 0, "receipt resolved existing shells"],
  [receipt.heldOnlyPlayerShellsDeferred, 13, "receipt held-only shells"],
  [receipt.relationshipReferencesAdded, 300, "receipt relationship refs"],
  [receipt.heldRelationshipEdgesDeferred, 93, "receipt held relationships"],
  [receipt.readyTeamDependencies, 194, "receipt ready team deps"],
  [receipt.heldTeamDependencies, 75, "receipt held team deps"],
  [receipt.existingPerspectiveReviewHolds, 0, "receipt existing-perspective holds"],
  [receipt.ambiguousIdentityOccurrencesDeferred, 0, "receipt ambiguous identities"],
  [receipt.matchedExistingAssetReferences, 298, "receipt matched asset refs"],
  [receipt.syntheticPerspectiveAssetReferences, 2, "receipt synthetic asset refs"],
  [receipt.postImportCanonicalTrades, 2287, "receipt final trades"],
  [receipt.postImportPlayers, 3128, "receipt final players"],
  [receipt.postImportTeams, 52, "receipt final teams"],
]) {
  assert(Number(actual) === expected, `${label} drifted: ${actual} !== ${expected}`);
}

assert(
  Object.keys(receipt.explicitPlayerTargetCorrections ?? {}).length === 0,
  "Minnesota explicit-player correction count drifted."
);
assert(
  (receipt.readyShellsResolvedToExistingPlayerIds?.length ?? 0) === 0,
  "Minnesota resolved-existing player IDs drifted."
);
assert(
  (receipt.ownershipConflictSyntheticRelationshipIds?.length ?? 0) === 0,
  "Ownership-conflict synthetic guard count drifted."
);
assert(receipt.heldPackageImports === 0, "Held package was imported.");
assert(receipt.heldPlayerShellImports === 0, "Held player shell was imported.");
assert(receipt.heldRelationshipWrites === 0, "Held relationship was written.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(receipt.pushPerformed === false, "Push was performed.");
assert(receipt.deployPerformed === false, "Deployment was performed.");

assert(
  audit.result === "PASS" &&
    audit.phase === "20H" &&
    audit.team === "minnesota-timberwolves",
  "Phase 20H audit metadata drifted."
);
for (const [actual, expected, label] of [
  [audit.counts?.canonicalTrades, 2287, "audit trades"],
  [audit.counts?.players, 3128, "audit players"],
  [audit.counts?.teams, 52, "audit teams"],
  [audit.counts?.readyPackages, 97, "audit ready"],
  [audit.counts?.heldPackages, 23, "audit held"],
  [audit.counts?.canonicalTradesCreated, 38, "audit creates"],
  [audit.counts?.perspectivesAppended, 59, "audit appends"],
  [audit.counts?.playerShellsCreated, 35, "audit shells"],
  [audit.counts?.privateQueryPlayerReferences, 3734, "audit private query refs"],
  [audit.counts?.privateQueryRepresentedTeams, 52, "audit represented teams"],
  [audit.counts?.routeModels, 5471, "audit route models"],
  [audit.counts?.internalLinks, 22368, "audit internal links"],
  [audit.safety?.invalidPlayerReferences, 0, "invalid player refs"],
  [audit.safety?.duplicateReferenceOwnership, 0, "duplicate relationship ownership"],
  [audit.safety?.extraPlayerReferences, 0, "extra player refs"],
  [audit.safety?.invalidTradeTeams, 0, "invalid trade teams"],
  [audit.safety?.explicitExistingPlayerOverrides, 0, "explicit existing-player overrides"],
  [audit.safety?.resolvedExistingPlayerIds, 0, "resolved existing-player IDs"],
]) {
  assert(Number(actual) === expected, `${label} drifted: ${actual} !== ${expected}`);
}
assert(audit.safety?.publicationAuthorized === false, "Audit publication authorization drifted.");
assert(audit.safety?.pushPerformed === false, "Audit push flag drifted.");
assert(audit.safety?.deployPerformed === false, "Audit deploy flag drifted.");

assert(
  exposure.result === "PASS" &&
    exposure.phase === "SCALABLE-PRIVATE-EXPOSURE",
  "Private exposure audit metadata drifted."
);
for (const [actual, expected, label] of [
  [exposure.counts?.expectedNbaPages, 5471, "exposure expected NBA pages"],
  [exposure.counts?.builtNbaPages, 5471, "exposure built NBA pages"],
  [exposure.counts?.nbaInternalLinks, 22368, "exposure internal links"],
  [exposure.counts?.nbaBrokenLinks, 0, "exposure broken links"],
  [exposure.counts?.nbaPrivacyFailures, 0, "exposure privacy failures"],
  [exposure.counts?.nbaAdMarkers, 0, "exposure ad markers"],
  [exposure.counts?.publicNbaLinks, 0, "exposure public NBA links"],
  [exposure.counts?.sitemapNbaUrls, 0, "exposure sitemap NBA URLs"],
]) {
  assert(Number(actual) === expected, `${label} drifted: ${actual} !== ${expected}`);
}

assert(trades.length === 2287, "Final canonical trade count drifted.");
assert(players.length === 3128, "Final player count drifted.");
assert(teams.length === 52, "Final team count drifted.");

const completion = {
  result: "PASS",
  phase: "20I",
  team: "minnesota-timberwolves",
  completionPercent: 100,
  completionStatus: "CLOSED",
  completedAt: args["completed-at"],
  repository: {
    startingHead: args["starting-head"],
    phase20HHead: args["phase20h-head"],
  },
  importAccounting: {
    sourceRows: 121,
    readyPackagesImported: 97,
    heldPackagesImported: 0,
    heldPackagesDeferred: 23,
    structuralExclusionsImported: 0,
    structuralExclusionsDeferred: 1,
    canonicalCreates: 38,
    perspectiveAppends: 59,
    playerShellsCreated: 35,
    existingPlayersResolved: 0,
    heldOnlyPlayerShellsDeferred: 13,
    relationshipReferencesAdded: 300,
    heldRelationshipEdgesDeferred: 93,
    readyTeamDependencies: 194,
    heldTeamDependencies: 75,
    existingPerspectiveReviewHolds: 0,
    ambiguousIdentityOccurrencesDeferred: 0,
    matchedExistingAssetReferences: 298,
    syntheticPerspectiveAssetReferences: 2,
    ownershipConflictSyntheticGuards: 0,
  },
  publicationPartition: {
    readyPublicCandidatesStillPrivate: 14,
    heldPublicCandidates: 0,
    publicationAuthorized: false,
    indexingAuthorized: false,
  },
  stores: {
    canonicalTrades: 2287,
    players: 3128,
    teams: 52,
    canonicalSha256: args["expected-canonical-store-sha256"],
    playerSha256: args["expected-player-store-sha256"],
    teamSha256: args["expected-team-store-sha256"],
  },
  privateQuery: {
    playerTradeReferences: 3734,
    representedTeams: 52,
  },
  routing: {
    routeModels: 5471,
    internalLinks: 22368,
    brokenLinks: 0,
  },
  exposure: {
    expectedNbaPages: 5471,
    builtNbaPages: 5471,
    internalLinks: 22368,
    privacyFailures: 0,
    adMarkers: 0,
    publicNbaLinks: 0,
    sitemapNbaUrls: 0,
  },
  evidence: {
    recordsSha256: sha256(recordsBytes),
    partitionSha256: sha256(partitionBytes),
    partitionFreezeSha256: sha256(freezeBytes),
    receiptSha256: sha256(receiptBytes),
    phase20HAuditSha256: sha256(auditBytes),
    exposureAuditSha256: sha256(exposureBytes),
    phase20HContractSha256: sha256(phase20hContractBytes),
    phase20IContractSha256: sha256(phase20iContractBytes),
    phase20HReportSha256: args["phase20h-report-sha256"],
    phase20HBundleSha256: args["phase20h-bundle-sha256"],
    phase20HShadowFreezeSha256: args["phase20h-shadow-freeze-sha256"],
  },
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

await writeFile(
  args["output-json"],
  `${JSON.stringify(completion, null, 2)}\n`,
  "utf8"
);
console.log(JSON.stringify(completion, null, 2));
