#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error(`Invalid argument near ${key}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
}

const args = parseArgs(process.argv);
for (const required of [
  "resolution-json",
  "phase7f-freeze-json",
  "players-json",
  "contract-md",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [resolutionBytes, freezeBytes, playersBytes, contractBytes] =
  await Promise.all([
    readFile(args["resolution-json"]),
    readFile(args["phase7f-freeze-json"]),
    readFile(args["players-json"]),
    readFile(args["contract-md"]),
  ]);

const resolution = JSON.parse(resolutionBytes.toString("utf8"));
const phase7F = JSON.parse(freezeBytes.toString("utf8"));

assert(resolution.result === "PASS" && resolution.phase === "7G", "Invalid Phase 7G resolution.");
assert(phase7F.result === "PASS" && phase7F.phase === "7F", "Invalid Phase 7F freeze.");
assert(Array.isArray(resolution.finalPackageRecords) && resolution.finalPackageRecords.length === 187, "Final package count drifted.");
assert(Array.isArray(resolution.resolutionRecords) && resolution.resolutionRecords.length === 16, "Resolution-record count drifted.");
assert(Array.isArray(resolution.proposedPlayerShells), "Final proposed shells are unavailable.");
assert(Array.isArray(resolution.relationshipPreviews), "Final relationship previews are unavailable.");

assert(
  resolution.finalPackageRecordsSha256 ===
    sha256(JSON.stringify(resolution.finalPackageRecords)),
  "Final package-record hash drifted.",
);
assert(
  resolution.resolutionRecordsSha256 ===
    sha256(JSON.stringify(resolution.resolutionRecords)),
  "Resolution-record hash drifted.",
);
assert(
  resolution.proposedPlayerShellsSha256 ===
    sha256(JSON.stringify(resolution.proposedPlayerShells)),
  "Final proposed-shell hash drifted.",
);
assert(
  resolution.relationshipPreviewsSha256 ===
    sha256(JSON.stringify(resolution.relationshipPreviews)),
  "Final relationship-preview hash drifted.",
);
assert(
  resolution.sourceHashes.phase7FFreezeJsonSha256 === sha256(freezeBytes),
  "Phase 7F freeze file hash drifted.",
);
assert(
  resolution.sourceHashes.playerStoreSha256 === sha256(playersBytes),
  "Player-store file hash drifted.",
);
assert(
  resolution.sourceHashes.contractSha256 === sha256(contractBytes),
  "Contract hash drifted.",
);

const counts = resolution.counts;
const fixed = {
  sourceRows: 219,
  eligibleInputPackages: 187,
  phase7fReadyPackages: 173,
  phase7fHeldIdentityPackages: 14,
  phase7fProposedPlayerShells: 218,
  phase7fRelationshipPreviewEdges: 349,
  phase7fAmbiguousIdentityOccurrences: 0,
  phase7fUnsafeIdentityOccurrences: 16,
  existingHeldRecords: 25,
  excludedRecords: 7,
  archiveReadyInputRows: 15,
};
for (const [field, expected] of Object.entries(fixed)) {
  assert(counts[field] === expected, `${field} expected ${expected}, received ${counts[field]}.`);
}
for (const field of [
  "resolvedUnsafeOccurrences",
  "remainingUnsafeOccurrences",
  "newlyAdvancedPackages",
  "finalReadyPackages",
  "remainingHeldPackages",
  "finalProposedPlayerShells",
  "finalRelationshipPreviewEdges",
]) {
  assert(Number.isInteger(counts[field]) && counts[field] >= 0, `${field} is invalid.`);
}

assert(
  counts.resolvedUnsafeOccurrences +
    counts.remainingUnsafeOccurrences === 16,
  "Unsafe occurrence partition does not close.",
);
assert(
  counts.finalReadyPackages +
    counts.remainingHeldPackages === 187,
  "Final package partition does not close.",
);
assert(
  counts.finalReadyPackages ===
    counts.phase7fReadyPackages + counts.newlyAdvancedPackages,
  "Final ready-package accounting drifted.",
);
assert(
  counts.finalReadyPackages >= counts.phase7fReadyPackages,
  "Ready-package count regressed.",
);
assert(
  counts.remainingHeldPackages <= counts.phase7fHeldIdentityPackages,
  "Held-package count increased.",
);

assert(
  JSON.stringify(
    countBy(
      resolution.resolutionRecords.map((record) => record.repairRule),
    ),
  ) === JSON.stringify(counts.resolutionRuleCounts),
  "Resolution-rule accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      resolution.resolutionRecords.map((record) => record.finalStatus),
    ),
  ) === JSON.stringify(counts.resolutionStatusCounts),
  "Resolution-status accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      resolution.finalPackageRecords.map((record) => record.finalStatus),
    ),
  ) === JSON.stringify(counts.finalPackageStatusCounts),
  "Final package-status accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      resolution.relationshipPreviews.map(
        (record) => record.relationshipType,
      ),
    ),
  ) === JSON.stringify(counts.relationshipTypeCounts),
  "Relationship-type accounting drifted.",
);

const readyPackageKeys = new Set(
  resolution.finalPackageRecords
    .filter((record) => record.finalReady)
    .map((record) => record.packageKey),
);
const heldPackageKeys = new Set(
  resolution.finalPackageRecords
    .filter((record) => record.finalHeld)
    .map((record) => record.packageKey),
);

for (const record of resolution.finalPackageRecords) {
  assert(record.automaticPlayerCreate === false, `${record.sourceTradeId}: automatic player creation occurred.`);
  assert(record.automaticIdentityMerge === false, `${record.sourceTradeId}: automatic identity merge occurred.`);
  assert(record.canonicalImport === false, `${record.sourceTradeId}: canonical import occurred.`);
  assert(record.playerImport === false, `${record.sourceTradeId}: player import occurred.`);
  assert(record.relationshipWrite === false, `${record.sourceTradeId}: relationship write occurred.`);

  if (record.finalReady) {
    assert(record.finalHeld === false, `${record.sourceTradeId}: ready/held partition drifted.`);
    assert(record.remainingUnsafeOccurrenceCount === 0, `${record.sourceTradeId}: ready package retains unsafe identity.`);
    assert(record.remainingAmbiguousOccurrenceCount === 0, `${record.sourceTradeId}: ready package retains ambiguity.`);
  }
  if (record.finalHeld) {
    assert(record.finalReady === false, `${record.sourceTradeId}: held/ready partition drifted.`);
    assert(
      record.remainingUnsafeOccurrenceCount > 0 ||
        record.remainingAmbiguousOccurrenceCount > 0,
      `${record.sourceTradeId}: held package lacks an identity blocker.`,
    );
  }
  if (record.newlyAdvanced) {
    assert(record.phase7fPackageHeld === true, `${record.sourceTradeId}: advanced package was not previously held.`);
    assert(record.finalReady === true, `${record.sourceTradeId}: advanced package is not ready.`);
  }
}

for (const record of resolution.resolutionRecords) {
  assert(record.automaticPlayerCreate === false, `${record.dependencySeedKey}: automatic player creation occurred.`);
  assert(record.automaticIdentityMerge === false, `${record.dependencySeedKey}: automatic identity merge occurred.`);
  assert(record.playerImport === false, `${record.dependencySeedKey}: player import occurred.`);
  assert(record.relationshipWrite === false, `${record.dependencySeedKey}: relationship write occurred.`);

  if (record.resolved) {
    assert(record.entityResolutions.length > 0, `${record.dependencySeedKey}: resolved occurrence has no entities.`);
    assert(
      record.entityResolutions.every(
        (entity) =>
          entity.resolutionStatus === "existing-player-exact" ||
          entity.resolutionStatus === "proposed-player-shell",
      ),
      `${record.dependencySeedKey}: resolved occurrence contains unresolved entity.`,
    );
  }
}

const proposedKeys = resolution.proposedPlayerShells.map(
  (record) => record.proposedPlayerKey,
);
const proposedIds = resolution.proposedPlayerShells.map(
  (record) => record.proposedPlayerId,
);
assert(new Set(proposedKeys).size === proposedKeys.length, "Final proposed shell keys are not unique.");
assert(new Set(proposedIds).size === proposedIds.length, "Final proposed shell IDs are not unique.");

for (const shell of resolution.proposedPlayerShells) {
  assert(shell.automaticPlayerCreate === false, `${shell.proposedPlayerKey}: automatic player creation occurred.`);
  assert(shell.playerImport === false, `${shell.proposedPlayerKey}: player import occurred.`);
  assert(shell.occurrenceCount > 0, `${shell.proposedPlayerKey}: shell has no occurrences.`);
}

const relationshipKeys = resolution.relationshipPreviews.map(
  (record) => record.relationshipEdgeKey,
);
assert(new Set(relationshipKeys).size === relationshipKeys.length, "Final relationship keys are not unique.");

for (const relationship of resolution.relationshipPreviews) {
  assert(readyPackageKeys.has(relationship.packageKey), `${relationship.relationshipEdgeKey}: relationship belongs to held package.`);
  assert(!heldPackageKeys.has(relationship.packageKey), `${relationship.relationshipEdgeKey}: relationship belongs to final hold.`);
  assert(relationship.relationshipWrite === false, `${relationship.relationshipEdgeKey}: relationship write occurred.`);
  assert(relationship.playerImport === false, `${relationship.relationshipEdgeKey}: player import occurred.`);
  assert(relationship.canonicalImport === false, `${relationship.relationshipEdgeKey}: canonical import occurred.`);
}

assert(resolution.canonicalImports === 0, "Canonical imports occurred.");
assert(resolution.playerImports === 0, "Player imports occurred.");
assert(resolution.teamRegistryWrites === 0, "Team-registry writes occurred.");
assert(resolution.relationshipWrites === 0, "Relationship writes occurred.");
assert(resolution.routeDataWrites === 0, "Route-data writes occurred.");
assert(resolution.automaticPlayerCreates === 0, "Automatic player creates occurred.");
assert(resolution.automaticIdentityMerges === 0, "Automatic identity merges occurred.");
assert(resolution.publicationAuthorized === false, "Publication was authorized.");
assert(resolution.pushPerformed === false, "Push occurred.");
assert(resolution.deployPerformed === false, "Deployment occurred.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "7G",
  verified: counts,
  finalPackageRecordsSha256:
    resolution.finalPackageRecordsSha256,
  resolutionRecordsSha256:
    resolution.resolutionRecordsSha256,
  proposedPlayerShellsSha256:
    resolution.proposedPlayerShellsSha256,
  relationshipPreviewsSha256:
    resolution.relationshipPreviewsSha256,
  importPartitionSha256:
    resolution.importPartitionSha256,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticPlayerCreates: 0,
  automaticIdentityMerges: 0,
}, null, 2));
