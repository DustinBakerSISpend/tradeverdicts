#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key}`);
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
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function countBy(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)));
}

const args = parseArgs(process.argv);
for (const required of [
  "resolution-json",
  "phase5e-freeze",
  "phase5f-freeze",
  "trades-json",
  "players-json",
]) assert(args[required], `Missing --${required}`);

const [resolutionBytes, phase5EBytes, phase5FBytes, tradesBytes, playersBytes] = await Promise.all([
  readFile(args["resolution-json"]),
  readFile(args["phase5e-freeze"]),
  readFile(args["phase5f-freeze"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const resolution = JSON.parse(resolutionBytes.toString("utf8"));
const phase5E = JSON.parse(phase5EBytes.toString("utf8"));
const phase5F = JSON.parse(phase5FBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));

assert(resolution.result === "PASS", "Resolution result is not PASS.");
assert(resolution.phase === "5G", "Resolution phase is not 5G.");
assert(resolution.mode === "BROOKLYN_NETS_FINAL_BLOCKER_RESOLUTION_AND_IMPORT_PARTITION", "Unexpected resolution mode.");
assert(resolution.sourceRows === 251, "Source-row count drifted.");
assert(resolution.packagingActions === 208, "Packaging action count drifted.");
assert(resolution.readyPackages + resolution.heldPackages === 208, "Import partition does not total 208.");
assert(Array.isArray(resolution.finalPackages) && resolution.finalPackages.length === 208, "Expected 208 final packages.");
assert(Array.isArray(resolution.allRelationshipRecords), "Final relationship array missing.");
assert(Array.isArray(resolution.resolvedAmbiguousIdentityRecords), "Resolved identity record array missing.");
assert(Array.isArray(resolution.remainingAmbiguousHoldRecords), "Remaining ambiguous hold array missing.");
assert(Array.isArray(resolution.sharedUnionResolutionRecords), "Shared union record array missing.");
assert(Array.isArray(trades) && trades.length === 456, "Canonical store changed.");
assert(Array.isArray(players), "Player store is not an array.");

assert(resolution.sourceHashes.phase5EFileSha256 === sha256(phase5EBytes), "Phase 5E source hash mismatch.");
assert(resolution.sourceHashes.phase5FFileSha256 === sha256(phase5FBytes), "Phase 5F source hash mismatch.");
assert(resolution.sourceHashes.canonicalTradesSha256 === sha256(tradesBytes), "Canonical store hash mismatch.");
assert(resolution.sourceHashes.playersSha256 === sha256(playersBytes), "Player store hash mismatch.");
assert(
  resolution.finalPackageRecordsSha256 === sha256(Buffer.from(stable(resolution.finalPackages))),
  "Final package-record hash mismatch."
);
assert(
  resolution.finalRelationshipRecordsSha256 === sha256(Buffer.from(stable(resolution.allRelationshipRecords))),
  "Final relationship-record hash mismatch."
);

assert(new Set(resolution.finalPackages.map((item) => item.packageId)).size === 208, "Duplicate final package ID.");
assert(
  new Set(resolution.allRelationshipRecords.map((item) => item.relationshipId)).size ===
    resolution.allRelationshipRecords.length,
  "Duplicate final relationship ID."
);
assert(
  resolution.resolvedAmbiguousOccurrences + resolution.remainingAmbiguousOccurrences ===
    phase5F.ambiguousRelationshipOccurrences,
  "Ambiguous occurrence accounting drifted."
);
assert(
  resolution.resolvedAmbiguousIdentities + resolution.remainingAmbiguousIdentities ===
    phase5F.ambiguousPlayerHolds,
  "Ambiguous identity accounting drifted."
);
assert(
  resolution.resolvedAmbiguousIdentityRecords.length === resolution.resolvedAmbiguousIdentities,
  "Resolved ambiguous identity record count drifted."
);
assert(
  resolution.remainingAmbiguousHoldRecords.length === resolution.remainingAmbiguousIdentities,
  "Remaining ambiguous identity record count drifted."
);
assert(
  resolution.sharedUnionResolutionRecords.length === resolution.sharedUnionResolutions,
  "Shared union resolution record count drifted."
);
assert(
  resolution.baseRelationshipPreviews + resolution.additionalRelationships ===
    resolution.totalRelationshipPreviews,
  "Relationship preview accounting drifted."
);
assert(resolution.readyPlayerShellPackages <= resolution.playerShellPackages, "Ready shell count exceeds total shells.");
assert(resolution.readyRelationshipPreviews <= resolution.totalRelationshipPreviews, "Ready relationship count exceeds total.");

const actualEligibility = countBy(
  resolution.finalPackages.map((item) => item.phase5GEligibility.status)
);
assert(stable(actualEligibility) === stable(resolution.eligibilityCounts), "Eligibility counts do not match packages.");
assert(
  resolution.finalPackages.every((item) =>
    item.importEligible === item.phase5GEligibility.ready &&
    item.importAuthorized === false &&
    item.canonicalImportAuthorized === false &&
    item.playerImportAuthorized === false &&
    item.perspectiveWriteAuthorized === false &&
    item.relationshipWriteAuthorized === false &&
    item.routeDataWriteAuthorized === false &&
    item.privateOnly === true
  ),
  "A final package escaped private/no-write policy."
);

for (const item of resolution.resolvedAmbiguousIdentityRecords) {
  assert(item.selectedPlayerId, `${item.playerName}: resolved player ID missing.`);
  assert(item.actualWriteAuthorized === false, `${item.playerName}: identity write authorized.`);
}
for (const item of resolution.remainingAmbiguousHoldRecords) {
  assert(item.automaticResolutionAuthorized === false, `${item.playerName}: automatic resolution authorized.`);
}
for (const item of resolution.sharedUnionResolutionRecords) {
  assert(item.targetCanonicalId?.startsWith("nba-trade-"), `${item.packageId}: invalid union target.`);
  assert(item.sourceTeams.length >= 2, `${item.packageId}: shared union lacks team perspectives.`);
  assert(item.actualWriteAuthorized === false, `${item.packageId}: union write authorized.`);
}

for (const key of [
  "canonicalImports",
  "playerImports",
  "perspectiveWrites",
  "relationshipWrites",
  "routeDataWrites",
  "automaticIdentityMerges",
  "automaticCanonicalMerges",
]) assert(resolution[key] === 0, `${key} is not zero.`);
assert(resolution.publicationAuthorized === false, "Publication was authorized.");
assert(resolution.pushPerformed === false, "Push was performed.");
assert(resolution.deployPerformed === false, "Deployment was performed.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "5G",
  verified: {
    sourceRows: resolution.sourceRows,
    packagingActions: resolution.packagingActions,
    sharedUnionResolutions: resolution.sharedUnionResolutions,
    resolvedAmbiguousIdentities: resolution.resolvedAmbiguousIdentities,
    resolvedAmbiguousOccurrences: resolution.resolvedAmbiguousOccurrences,
    remainingAmbiguousIdentities: resolution.remainingAmbiguousIdentities,
    remainingAmbiguousOccurrences: resolution.remainingAmbiguousOccurrences,
    readyPackages: resolution.readyPackages,
    heldPackages: resolution.heldPackages,
    readyCanonicalCreatePackages: resolution.readyCanonicalCreatePackages,
    readyPerspectiveAppendPackages: resolution.readyPerspectiveAppendPackages,
    playerShellPackages: resolution.playerShellPackages,
    readyPlayerShellPackages: resolution.readyPlayerShellPackages,
    totalRelationshipPreviews: resolution.totalRelationshipPreviews,
    readyRelationshipPreviews: resolution.readyRelationshipPreviews,
  },
  finalPackageRecordsSha256: resolution.finalPackageRecordsSha256,
  finalRelationshipRecordsSha256: resolution.finalRelationshipRecordsSha256,
  importPartitionSha256: resolution.importPartitionSha256,
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
}, null, 2));
