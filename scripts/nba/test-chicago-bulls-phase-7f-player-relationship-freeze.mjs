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
  "freeze-json",
  "eligibility-freeze-json",
  "players-json",
  "contract-md",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [freezeBytes, eligibilityBytes, playersBytes, contractBytes] =
  await Promise.all([
    readFile(args["freeze-json"]),
    readFile(args["eligibility-freeze-json"]),
    readFile(args["players-json"]),
    readFile(args["contract-md"]),
  ]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const eligibility = JSON.parse(eligibilityBytes.toString("utf8"));

assert(freeze.result === "PASS" && freeze.phase === "7F", "Invalid Phase 7F freeze.");
assert(eligibility.result === "PASS" && eligibility.phase === "7E", "Invalid Phase 7E freeze.");
assert(Array.isArray(freeze.packageReadiness) && freeze.packageReadiness.length === 187, "Package-readiness count drifted.");
assert(Array.isArray(freeze.identityOccurrences) && freeze.identityOccurrences.length === 371, "Identity-occurrence count drifted.");
assert(Array.isArray(freeze.proposedPlayerShells), "Proposed player shells are unavailable.");
assert(Array.isArray(freeze.relationshipPreviews), "Relationship previews are unavailable.");

assert(
  freeze.packageReadinessSha256 ===
    sha256(JSON.stringify(freeze.packageReadiness)),
  "Package-readiness hash drifted.",
);
assert(
  freeze.identityOccurrencesSha256 ===
    sha256(JSON.stringify(freeze.identityOccurrences)),
  "Identity-occurrence hash drifted.",
);
assert(
  freeze.proposedPlayerShellsSha256 ===
    sha256(JSON.stringify(freeze.proposedPlayerShells)),
  "Proposed-player-shell hash drifted.",
);
assert(
  freeze.relationshipPreviewsSha256 ===
    sha256(JSON.stringify(freeze.relationshipPreviews)),
  "Relationship-preview hash drifted.",
);

assert(freeze.sourceHashes.eligibilityFreezeJsonSha256 === sha256(eligibilityBytes), "Eligibility-freeze file hash drifted.");
assert(freeze.sourceHashes.playerStoreSha256 === sha256(playersBytes), "Player-store file hash drifted.");
assert(freeze.sourceHashes.contractSha256 === sha256(contractBytes), "Contract hash drifted.");
assert(
  freeze.sourceHashes.phase7EEligibilityRecordsSha256 ===
    eligibility.eligibilityRecordsSha256,
  "Eligibility-record source hash drifted.",
);
assert(
  freeze.sourceHashes.phase7EDependencySeedSha256 ===
    eligibility.dependencySeedSha256,
  "Dependency-seed source hash drifted.",
);
assert(
  freeze.sourceHashes.phase7EPlayerIdentitySeedSha256 ===
    eligibility.playerIdentitySeedSha256,
  "Player-identity source hash drifted.",
);

const counts = freeze.counts;
const fixed = {
  sourceRows: 219,
  eligibleInputPackages: 187,
  inputHeldRecords: 25,
  excludedRecords: 7,
  dependencySeedRows: 620,
  playerIdentitySeedRows: 371,
  nonIdentityAssetSeedRows: 249,
  archiveReadyInputRows: 15,
  archiveEligibleInputRows: 13,
  archiveHeldInputRows: 2,
  archiveExcludedInputRows: 0,
};
for (const [field, expected] of Object.entries(fixed)) {
  assert(counts[field] === expected, `${field} expected ${expected}, received ${counts[field]}.`);
}
for (const field of [
  "readyPackages",
  "heldIdentityPackages",
  "readyIdentityOccurrences",
  "heldPackageIdentityOccurrences",
  "exactExistingReadyOccurrences",
  "proposedShellReadyOccurrences",
  "ambiguousIdentityOccurrences",
  "unsafeIdentityOccurrences",
  "proposedPlayerShells",
  "exactExistingUniquePlayers",
  "relationshipPreviewEdges",
]) {
  assert(Number.isInteger(counts[field]) && counts[field] >= 0, `${field} is invalid.`);
}

assert(counts.readyPackages + counts.heldIdentityPackages === 187, "Eligible package partition does not close.");
assert(
  counts.readyIdentityOccurrences +
    counts.heldPackageIdentityOccurrences === 371,
  "Identity occurrence package partition does not close.",
);
assert(
  counts.exactExistingReadyOccurrences +
    counts.proposedShellReadyOccurrences ===
      counts.readyIdentityOccurrences,
  "Ready identity partition does not close.",
);
assert(
  counts.relationshipPreviewEdges === counts.readyIdentityOccurrences,
  "Relationship-preview accounting drifted.",
);
assert(
  counts.archiveEligibleInputRows +
    counts.archiveHeldInputRows +
    counts.archiveExcludedInputRows === 15,
  "Archive input partition does not close.",
);

assert(
  JSON.stringify(
    countBy(freeze.identityOccurrences.map((record) => record.identityStatus)),
  ) === JSON.stringify(counts.identityStatusCounts),
  "Identity-status accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(freeze.packageReadiness.map((record) => record.packageStatus)),
  ) === JSON.stringify(counts.packageStatusCounts),
  "Package-status accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.relationshipPreviews.map((record) => record.relationshipType),
    ),
  ) === JSON.stringify(counts.relationshipTypeCounts),
  "Relationship-type accounting drifted.",
);

const packageKeys = freeze.packageReadiness.map((record) => record.packageKey);
assert(new Set(packageKeys).size === 187, "Package keys are not unique.");
const occurrenceKeys = freeze.identityOccurrences.map(
  (record) => record.dependencySeedKey,
);
assert(new Set(occurrenceKeys).size === 371, "Identity occurrence keys are not unique.");
const shellKeys = freeze.proposedPlayerShells.map(
  (record) => record.proposedPlayerKey,
);
assert(new Set(shellKeys).size === shellKeys.length, "Proposed shell keys are not unique.");
const relationshipKeys = freeze.relationshipPreviews.map(
  (record) => record.relationshipEdgeKey,
);
assert(new Set(relationshipKeys).size === relationshipKeys.length, "Relationship preview keys are not unique.");

const readyPackageKeys = new Set(
  freeze.packageReadiness
    .filter((record) => record.packageReady)
    .map((record) => record.packageKey),
);
const heldPackageKeys = new Set(
  freeze.packageReadiness
    .filter((record) => record.packageHeld)
    .map((record) => record.packageKey),
);

for (const record of freeze.packageReadiness) {
  assert(record.automaticPlayerCreate === false, `${record.sourceTradeId}: automatic player creation occurred.`);
  assert(record.automaticIdentityMerge === false, `${record.sourceTradeId}: automatic identity merge occurred.`);
  assert(record.canonicalImport === false, `${record.sourceTradeId}: canonical import occurred.`);
  assert(record.playerImport === false, `${record.sourceTradeId}: player import occurred.`);
  assert(record.relationshipWrite === false, `${record.sourceTradeId}: relationship write occurred.`);

  if (record.packageReady) {
    assert(record.packageHeld === false, `${record.sourceTradeId}: ready/held partition drifted.`);
    assert(record.ambiguousOccurrenceCount === 0, `${record.sourceTradeId}: ready package has ambiguity.`);
    assert(record.unsafeOccurrenceCount === 0, `${record.sourceTradeId}: ready package has unsafe identity.`);
  }
  if (record.packageHeld) {
    assert(record.packageReady === false, `${record.sourceTradeId}: held/ready partition drifted.`);
    assert(
      record.ambiguousOccurrenceCount > 0 ||
        record.unsafeOccurrenceCount > 0,
      `${record.sourceTradeId}: held package lacks an identity blocker.`,
    );
  }
}

for (const occurrence of freeze.identityOccurrences) {
  assert(occurrence.automaticPlayerCreate === false, `${occurrence.dependencySeedKey}: automatic player creation occurred.`);
  assert(occurrence.automaticIdentityMerge === false, `${occurrence.dependencySeedKey}: automatic identity merge occurred.`);
  assert(occurrence.playerImport === false, `${occurrence.dependencySeedKey}: player import occurred.`);
  assert(occurrence.relationshipWrite === false, `${occurrence.dependencySeedKey}: relationship write occurred.`);

  if (readyPackageKeys.has(occurrence.packageKey)) {
    assert(
      occurrence.identityStatus === "existing-player-exact" ||
        occurrence.identityStatus === "proposed-player-shell",
      `${occurrence.dependencySeedKey}: ready package contains unresolved identity.`,
    );
  }
  if (
    occurrence.identityStatus === "ambiguous-existing-identity" ||
    occurrence.identityStatus === "unsafe-identity-held"
  ) {
    assert(
      heldPackageKeys.has(occurrence.packageKey),
      `${occurrence.dependencySeedKey}: unresolved identity did not hold its package.`,
    );
  }
}

for (const shell of freeze.proposedPlayerShells) {
  assert(shell.automaticPlayerCreate === false, `${shell.proposedPlayerKey}: automatic player creation occurred.`);
  assert(shell.playerImport === false, `${shell.proposedPlayerKey}: player import occurred.`);
  assert(shell.occurrenceCount > 0, `${shell.proposedPlayerKey}: shell has no occurrences.`);
}

for (const relationship of freeze.relationshipPreviews) {
  assert(readyPackageKeys.has(relationship.packageKey), `${relationship.relationshipEdgeKey}: relationship belongs to held package.`);
  assert(relationship.relationshipWrite === false, `${relationship.relationshipEdgeKey}: relationship write occurred.`);
  assert(relationship.playerImport === false, `${relationship.relationshipEdgeKey}: player import occurred.`);
  assert(relationship.canonicalImport === false, `${relationship.relationshipEdgeKey}: canonical import occurred.`);
}

assert(freeze.canonicalImports === 0, "Canonical imports occurred.");
assert(freeze.playerImports === 0, "Player imports occurred.");
assert(freeze.teamRegistryWrites === 0, "Team-registry writes occurred.");
assert(freeze.relationshipWrites === 0, "Relationship writes occurred.");
assert(freeze.routeDataWrites === 0, "Route-data writes occurred.");
assert(freeze.automaticPlayerCreates === 0, "Automatic player creates occurred.");
assert(freeze.automaticIdentityMerges === 0, "Automatic identity merges occurred.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");
assert(freeze.pushPerformed === false, "Push occurred.");
assert(freeze.deployPerformed === false, "Deployment occurred.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "7F",
  verified: counts,
  packageReadinessSha256: freeze.packageReadinessSha256,
  identityOccurrencesSha256: freeze.identityOccurrencesSha256,
  proposedPlayerShellsSha256: freeze.proposedPlayerShellsSha256,
  relationshipPreviewsSha256: freeze.relationshipPreviewsSha256,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticPlayerCreates: 0,
  automaticIdentityMerges: 0,
}, null, 2));
