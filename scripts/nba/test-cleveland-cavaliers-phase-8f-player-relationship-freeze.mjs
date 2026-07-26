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
]) {
  assert(args[required], `Missing --${required}.`);
}

const [freezeBytes, eligibilityBytes, playersBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["eligibility-freeze-json"]),
  readFile(args["players-json"]),
]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const eligibility = JSON.parse(eligibilityBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));

const playerRecords = Array.isArray(players)
  ? players
  : Array.isArray(players?.players)
    ? players.players
    : Object.values(players ?? {});

assert(freeze.result === "PASS" && freeze.phase === "8F", "Invalid Phase 8F freeze.");
assert(eligibility.result === "PASS" && eligibility.phase === "8E", "Invalid Phase 8E source.");
assert(playerRecords.length === 1510, "Existing player-store count drifted.");
assert(
  Array.isArray(freeze.packageReadiness) &&
    freeze.packageReadiness.length === 150,
  "Package-readiness count drifted.",
);
assert(
  Array.isArray(freeze.identityOccurrences) &&
    freeze.identityOccurrences.length === 446,
  "Identity-occurrence count drifted.",
);

const fixed = {
  sourceRows: 204,
  eligibleInputPackages: 150,
  inputHeldRecords: 44,
  excludedRecords: 10,
  dependencySeedRows: 533,
  playerIdentitySeedRows: 446,
  nonIdentityAssetSeedRows: 87,
  archiveInputRows: 5,
};
for (const [field, expected] of Object.entries(fixed)) {
  assert(
    freeze.counts[field] === expected,
    `${field} expected ${expected}, received ${freeze.counts[field]}.`,
  );
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
  "archiveReadyPackages",
  "archiveHeldIdentityPackages",
]) {
  assert(
    Number.isInteger(freeze.counts[field]) && freeze.counts[field] >= 0,
    `${field} is invalid.`,
  );
}

assert(
  freeze.counts.readyPackages + freeze.counts.heldIdentityPackages === 150,
  "Eligible package partition does not close.",
);
assert(
  freeze.counts.readyIdentityOccurrences +
    freeze.counts.heldPackageIdentityOccurrences === 446,
  "Identity package partition does not close.",
);
assert(
  freeze.counts.exactExistingReadyOccurrences +
    freeze.counts.proposedShellReadyOccurrences ===
      freeze.counts.readyIdentityOccurrences,
  "Ready identity partition does not close.",
);
assert(
  freeze.counts.relationshipPreviewEdges ===
    freeze.counts.readyIdentityOccurrences,
  "Relationship preview accounting drifted.",
);
assert(
  freeze.counts.archiveReadyPackages +
    freeze.counts.archiveHeldIdentityPackages === 5,
  "Archive package identity partition does not close.",
);

assert(
  freeze.hashes.packageReadinessSha256 ===
    sha256(JSON.stringify(freeze.packageReadiness)),
  "Package-readiness hash drifted.",
);
assert(
  freeze.hashes.identityOccurrencesSha256 ===
    sha256(JSON.stringify(freeze.identityOccurrences)),
  "Identity-occurrence hash drifted.",
);
assert(
  freeze.hashes.proposedPlayerShellsSha256 ===
    sha256(JSON.stringify(freeze.proposedPlayerShells)),
  "Proposed-shell hash drifted.",
);
assert(
  freeze.hashes.relationshipPreviewsSha256 ===
    sha256(JSON.stringify(freeze.relationshipPreviews)),
  "Relationship-preview hash drifted.",
);
assert(
  freeze.hashes.eligibilityRecordsSha256 ===
    eligibility.hashes.eligibilityRecordsSha256,
  "Eligibility source hash drifted.",
);
assert(
  freeze.hashes.dependencySeedsSha256 ===
    eligibility.hashes.dependencySeedsSha256,
  "Dependency source hash drifted.",
);
assert(
  freeze.hashes.playerIdentitySeedsSha256 ===
    eligibility.hashes.playerIdentitySeedsSha256,
  "Identity seed source hash drifted.",
);
assert(
  freeze.hashes.playerStoreSha256 === sha256(playersBytes),
  "Player-store hash drifted.",
);

assert(
  JSON.stringify(
    countBy(
      freeze.identityOccurrences.map((record) => record.identityStatus),
    ),
  ) === JSON.stringify(freeze.counts.identityStatusCounts),
  "Identity-status accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.packageReadiness.map((record) => record.packageStatus),
    ),
  ) === JSON.stringify(freeze.counts.packageStatusCounts),
  "Package-status accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.relationshipPreviews.map(
        (record) => record.relationshipType,
      ),
    ),
  ) === JSON.stringify(freeze.counts.relationshipTypeCounts),
  "Relationship-type accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.identityOccurrences.map((record) => record.identityKind),
    ),
  ) === JSON.stringify(freeze.counts.identityKindCounts),
  "Identity-kind accounting drifted.",
);

assert(
  freeze.packageReadiness.every(
    (record) =>
      record.automaticPlayerCreate === false &&
      record.automaticIdentityMerge === false &&
      record.canonicalImport === false &&
      record.playerImport === false &&
      record.relationshipWrite === false,
  ),
  "A package enabled a forbidden action.",
);
assert(
  freeze.identityOccurrences.every(
    (record) =>
      record.automaticPlayerCreate === false &&
      record.automaticIdentityMerge === false &&
      record.playerImport === false &&
      record.relationshipWrite === false,
  ),
  "An identity occurrence enabled a forbidden action.",
);
assert(
  freeze.relationshipPreviews.every(
    (record) =>
      record.relationshipWrite === false &&
      record.playerImport === false &&
      record.canonicalImport === false,
  ),
  "A relationship preview enabled a forbidden action.",
);

assert(freeze.canonicalImports === 0, "Canonical import occurred.");
assert(freeze.playerImports === 0, "Player import occurred.");
assert(freeze.teamRegistryWrites === 0, "Team-registry write occurred.");
assert(freeze.relationshipWrites === 0, "Relationship write occurred.");
assert(freeze.routeDataWrites === 0, "Route-data write occurred.");
assert(freeze.automaticPlayerCreates === 0, "Automatic player creation occurred.");
assert(freeze.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "8F",
  verified: freeze.counts,
  hashes: freeze.hashes,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticPlayerCreates: 0,
  automaticIdentityMerges: 0,
  publicationAuthorized: false,
}, null, 2));
