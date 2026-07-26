#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }

const args = parseArgs(process.argv);
for (const required of [
  "resolution-json", "phase6e-freeze", "phase6f-freeze",
  "players-json", "trades-json", "contract-md",
]) assert(args[required], `Missing --${required}`);

const [resolutionBytes, eBytes, fBytes, playerBytes, tradeBytes, contractBytes] = await Promise.all([
  readFile(args["resolution-json"]), readFile(args["phase6e-freeze"]),
  readFile(args["phase6f-freeze"]), readFile(args["players-json"]),
  readFile(args["trades-json"]), readFile(args["contract-md"]),
]);
const resolution = JSON.parse(resolutionBytes.toString("utf8"));
const phase6e = JSON.parse(eBytes.toString("utf8"));
const phase6f = JSON.parse(fBytes.toString("utf8"));

assert(resolution.result === "PASS", "Phase 6G resolution did not pass.");
assert(resolution.phase === "6G", "Unexpected Phase 6G phase.");
assert(resolution.mode === "FINAL_BLOCKER_RESOLUTION_AND_IMPORT_PARTITION", "Unexpected Phase 6G mode.");
assert(resolution.sourceRows === 125, "Source-row count drifted.");
assert(resolution.packagingActions === 103, "Packaging count drifted.");
assert(resolution.resolvedAmbiguousOccurrences + resolution.remainingAmbiguousOccurrences === 1, "Ambiguous accounting drifted.");
assert(resolution.readyPackages + resolution.heldPackages === 103, "Ready/held accounting drifted.");
assert(resolution.readyCanonicalCreatePackages === resolution.readyPackages, "Canonical-create accounting drifted.");
assert(resolution.readyPerspectiveAppendPackages === 0, "Unexpected perspective append.");
assert(resolution.baseRelationshipPreviews === 201, "Base relationship count drifted.");
assert(resolution.totalRelationshipPreviews === resolution.baseRelationshipPreviews + resolution.additionalRelationships, "Relationship accounting drifted.");
assert(Array.isArray(resolution.finalPackageRecords) && resolution.finalPackageRecords.length === 103, "Final package records drifted.");
assert(Array.isArray(resolution.readyPlayerShellRecords), "Ready player shells unavailable.");
assert(Array.isArray(resolution.finalRelationshipRecords), "Final relationships unavailable.");
assert(Array.isArray(resolution.readyRelationshipRecords), "Ready relationships unavailable.");
assert(resolution.finalPackageRecordsSha256 === sha256(JSON.stringify(resolution.finalPackageRecords)), "Final package hash drifted.");
assert(resolution.readyPlayerShellRecordsSha256 === sha256(JSON.stringify(resolution.readyPlayerShellRecords)), "Ready shell hash drifted.");
assert(resolution.finalRelationshipRecordsSha256 === sha256(JSON.stringify(resolution.finalRelationshipRecords)), "Final relationship hash drifted.");
assert(resolution.readyRelationshipRecordsSha256 === sha256(JSON.stringify(resolution.readyRelationshipRecords)), "Ready relationship hash drifted.");
assert(resolution.sourceHashes.phase6eEligibilityRecordsSha256 === phase6e.eligibilityRecordsSha256, "Phase 6E hash drifted.");
assert(resolution.sourceHashes.phase6fPackageReadinessRecordsSha256 === phase6f.packageReadinessRecordsSha256, "Phase 6F readiness hash drifted.");
assert(resolution.sourceHashes.phase6fRelationshipPreviewRecordsSha256 === phase6f.relationshipPreviewRecordsSha256, "Phase 6F relationship hash drifted.");
assert(resolution.sourceHashes.phase6fFreezeRecordsSha256 === phase6f.freezeRecordsSha256, "Phase 6F freeze hash drifted.");
assert(resolution.sourceHashes.playersStoreSha256 === sha256(playerBytes), "Player-store hash drifted.");
assert(resolution.sourceHashes.canonicalStoreSha256 === sha256(tradeBytes), "Canonical-store hash drifted.");
assert(resolution.sourceHashes.contractSha256 === sha256(contractBytes), "Contract hash drifted.");
assert(resolution.finalPackageRecords.filter((r) => r.importReady).length === resolution.readyPackages, "Ready record count drifted.");
assert(resolution.finalPackageRecords.filter((r) => !r.importReady).length === resolution.heldPackages, "Held record count drifted.");
assert(resolution.readyRelationshipRecords.every((r) => resolution.finalPackageRecords.some((p) => p.importReady && p.eligibilityKey === r.eligibilityKey)), "Held relationship entered ready set.");
assert(resolution.canonicalImports === 0, "Canonical import occurred.");
assert(resolution.playerImports === 0, "Player import occurred.");
assert(resolution.perspectiveWrites === 0, "Perspective write occurred.");
assert(resolution.relationshipWrites === 0, "Relationship write occurred.");
assert(resolution.routeDataWrites === 0, "Route-data write occurred.");
assert(resolution.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(resolution.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(resolution.publicationAuthorized === false, "Publication was authorized.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "6G",
  verified: {
    sourceRows: resolution.sourceRows,
    packagingActions: resolution.packagingActions,
    resolvedAmbiguousOccurrences: resolution.resolvedAmbiguousOccurrences,
    remainingAmbiguousOccurrences: resolution.remainingAmbiguousOccurrences,
    readyPackages: resolution.readyPackages,
    heldPackages: resolution.heldPackages,
    readyPlayerShellPackages: resolution.readyPlayerShellPackages,
    readyRelationshipPreviews: resolution.readyRelationshipPreviews,
  },
  finalPackageRecordsSha256: resolution.finalPackageRecordsSha256,
  readyPlayerShellRecordsSha256: resolution.readyPlayerShellRecordsSha256,
  readyRelationshipRecordsSha256: resolution.readyRelationshipRecordsSha256,
  importPartitionSha256: resolution.importPartitionSha256,
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
}, null, 2));
