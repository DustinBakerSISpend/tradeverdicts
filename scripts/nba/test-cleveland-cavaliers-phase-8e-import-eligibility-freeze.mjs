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
  "routing-freeze-json",
  "reviewed-json",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [freezeBytes, routingBytes, reviewedBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["routing-freeze-json"]),
  readFile(args["reviewed-json"]),
]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(freeze.result === "PASS" && freeze.phase === "8E", "Invalid Phase 8E freeze.");
assert(routing.result === "PASS" && routing.phase === "8D", "Invalid Phase 8D freeze.");
assert(reviewed.result === "PASS" && reviewed.phase === "8A", "Invalid Phase 8A source.");
assert(
  Array.isArray(freeze.eligibilityRecords) &&
    freeze.eligibilityRecords.length === 204,
  "Eligibility-record count drifted.",
);

const fixed = {
  sourceRows: 204,
  eligibleRows: 150,
  heldRows: 44,
  excludedRows: 10,
  phase8DPackagingQueueRows: 150,
  phase8DRemainingHeldRows: 54,
  routesFrozen: 17,
  routedEligibleRows: 17,
  nonCandidateRoutingRows: 7,
  recentProvisionalHoldRows: 6,
  archiveImportReadyRows: 6,
};
for (const [field, expected] of Object.entries(fixed)) {
  assert(
    freeze.counts[field] === expected,
    `${field} expected ${expected}, received ${freeze.counts[field]}.`,
  );
}
for (const field of [
  "archiveEligibleRows",
  "archiveHeldRows",
  "archiveExcludedRows",
  "dependencySeeds",
  "playerIdentitySeeds",
  "safeFormatIdentitySeeds",
  "unsafeFormatIdentitySeeds",
]) {
  assert(
    Number.isInteger(freeze.counts[field]) && freeze.counts[field] >= 0,
    `${field} is invalid.`,
  );
}
assert(freeze.counts.dependencySeeds > 0, "Dependency seed set is empty.");
assert(freeze.counts.playerIdentitySeeds > 0, "Player identity seed set is empty.");
assert(
  freeze.counts.archiveEligibleRows +
    freeze.counts.archiveHeldRows +
    freeze.counts.archiveExcludedRows === 6,
  "Archive partition does not close.",
);
assert(
  freeze.counts.eligibleRows +
    freeze.counts.heldRows +
    freeze.counts.excludedRows === 204,
  "Eligibility partition does not close.",
);
assert(
  freeze.hashes.eligibilityRecordsSha256 ===
    sha256(JSON.stringify(freeze.eligibilityRecords)),
  "Eligibility-record hash drifted.",
);
assert(
  freeze.hashes.dependencySeedsSha256 ===
    sha256(JSON.stringify(freeze.dependencySeeds)),
  "Dependency-seed hash drifted.",
);
assert(
  freeze.hashes.playerIdentitySeedsSha256 ===
    sha256(JSON.stringify(freeze.playerIdentitySeeds)),
  "Player-identity-seed hash drifted.",
);
assert(
  freeze.hashes.freezeRecordsSha256 ===
    routing.hashes.freezeRecordsSha256,
  "Phase 8D freeze source hash drifted.",
);
assert(
  freeze.hashes.routeRecordsSha256 === routing.hashes.routeRecordsSha256,
  "Phase 8D route source hash drifted.",
);
assert(
  freeze.hashes.reviewedRecordsSha256 === reviewed.recordsSha256,
  "Reviewed-record source hash drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.eligibilityRecords.map((record) => record.eligibilityStatus),
    ),
  ) === JSON.stringify(freeze.counts.eligibilityStatusCounts),
  "Eligibility-status accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.eligibilityRecords.flatMap((record) => record.holdReasons),
    ),
  ) === JSON.stringify(freeze.counts.holdReasonCounts),
  "Hold-reason accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(freeze.dependencySeeds.map((record) => record.assetClass)),
  ) === JSON.stringify(freeze.counts.dependencyClassCounts),
  "Dependency-class accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(freeze.playerIdentitySeeds.map((record) => record.identityKind)),
  ) === JSON.stringify(freeze.counts.identityKindCounts),
  "Identity-kind accounting drifted.",
);
assert(
  freeze.eligibilityRecords
    .filter((record) => record.recentProvisionalHold)
    .every((record) => !record.eligible),
  "A recent provisional hold became eligible.",
);
assert(
  freeze.eligibilityRecords
    .filter((record) => record.routingRequired && !record.routeFrozen)
    .every((record) => !record.eligible),
  "A non-candidate routing row became eligible.",
);
assert(
  freeze.eligibilityRecords
    .filter((record) => record.excluded)
    .every((record) => record.mergeExclude),
  "An excluded row is not administrative.",
);
assert(
  freeze.dependencySeeds.every(
    (seed) =>
      freeze.eligibilityRecords.some(
        (record) =>
          record.eligibilityKey === seed.packageKey && record.eligible,
      ) &&
      seed.automaticWrite === false,
  ),
  "A dependency seed is detached or writable.",
);
assert(
  freeze.playerIdentitySeeds.every(
    (seed) =>
      freeze.dependencySeeds.some(
        (dependency) =>
          dependency.dependencyKey === seed.dependencyKey &&
          dependency.packageKey === seed.packageKey,
      ) &&
      seed.automaticPlayerCreate === false &&
      seed.automaticIdentityMerge === false,
  ),
  "A player identity seed is detached or writable.",
);
assert(
  freeze.eligibilityRecords.every(
    (record) =>
      record.canonicalImport === false &&
      record.playerImport === false &&
      record.teamRegistryWrite === false &&
      record.relationshipWrite === false &&
      record.routeDataWrite === false &&
      record.automaticMerge === false &&
      record.automaticRoute === false,
  ),
  "A forbidden action was enabled.",
);

assert(freeze.canonicalImports === 0, "Canonical import occurred.");
assert(freeze.playerImports === 0, "Player import occurred.");
assert(freeze.teamRegistryWrites === 0, "Team-registry write occurred.");
assert(freeze.relationshipWrites === 0, "Relationship write occurred.");
assert(freeze.routeDataWrites === 0, "Route-data write occurred.");
assert(freeze.automaticMerges === 0, "Automatic merge occurred.");
assert(freeze.automaticRoutes === 0, "Automatic route occurred.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "8E",
  verified: freeze.counts,
  hashes: freeze.hashes,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
}, null, 2));
