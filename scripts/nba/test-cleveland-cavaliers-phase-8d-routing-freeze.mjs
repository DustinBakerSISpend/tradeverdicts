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
for (const required of ["freeze-json", "matrix-json", "reviewed-json"]) {
  assert(args[required], `Missing --${required}.`);
}

const [freezeBytes, matrixBytes, reviewedBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["matrix-json"]),
  readFile(args["reviewed-json"]),
]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(freeze.result === "PASS" && freeze.phase === "8D", "Invalid Phase 8D freeze.");
assert(matrix.result === "PASS" && matrix.phase === "8C", "Invalid Phase 8C matrix.");
assert(reviewed.result === "PASS" && reviewed.phase === "8A", "Invalid Phase 8A reviewed source.");
assert(Array.isArray(freeze.routeRecords) && freeze.routeRecords.length === 17, "Route-record count drifted.");
assert(Array.isArray(freeze.freezeRecords) && freeze.freezeRecords.length === 204, "Freeze-record count drifted.");

const fixed = {
  sourceRows: 204,
  phase8CDirectPackagingRows: 133,
  phase8CBlockedOrReconciliationRows: 71,
  routingRequiredRows: 24,
  routingCandidateRows: 17,
  routesFrozen: 17,
  newlyAdvancedByRouting: 17,
  packagingQueueRows: 150,
  remainingHeldRows: 54,
  nonCandidateRoutingRows: 7,
  archiveImportReadyRows: 6,
};
for (const [field, expected] of Object.entries(fixed)) {
  assert(
    freeze.counts[field] === expected,
    `${field} expected ${expected}, received ${freeze.counts[field]}.`,
  );
}
for (const field of ["archiveReadyPackagingRows", "archiveReadyHeldRows"]) {
  assert(
    Number.isInteger(freeze.counts[field]) && freeze.counts[field] >= 0,
    `${field} is invalid.`,
  );
}
assert(
  freeze.counts.archiveReadyPackagingRows +
    freeze.counts.archiveReadyHeldRows === 6,
  "Archive-ready partition does not close.",
);
assert(
  freeze.counts.packagingQueueRows + freeze.counts.remainingHeldRows === 204,
  "Final routing partition does not close.",
);
assert(
  freeze.counts.packagingQueueRows ===
    freeze.counts.phase8CDirectPackagingRows +
      freeze.counts.newlyAdvancedByRouting,
  "Packaging queue accounting drifted.",
);
assert(
  freeze.hashes.routeRecordsSha256 ===
    sha256(JSON.stringify(freeze.routeRecords)),
  "Route-record hash drifted.",
);
assert(
  freeze.hashes.freezeRecordsSha256 ===
    sha256(JSON.stringify(freeze.freezeRecords)),
  "Freeze-record hash drifted.",
);
assert(
  freeze.hashes.decisionRecordsSha256 ===
    matrix.hashes.decisionRecordsSha256,
  "Phase 8C decision-record source hash drifted.",
);
assert(
  freeze.hashes.reviewedRecordsSha256 === reviewed.recordsSha256,
  "Reviewed-record source hash drifted.",
);
assert(
  JSON.stringify(countBy(freeze.freezeRecords.map((record) => record.finalStatus))) ===
    JSON.stringify(freeze.counts.finalStatusCounts),
  "Final-status accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.freezeRecords
        .filter((record) => record.remainingHeld)
        .map((record) => record.priorResolutionClass),
    ),
  ) === JSON.stringify(freeze.counts.remainingHoldResolutionCounts),
  "Remaining-hold accounting drifted.",
);
assert(
  freeze.routeRecords.every(
    (record) =>
      record.routingStatus === "frozen" &&
      record.advanceToPackaging === true &&
      record.automaticRoute === false &&
      record.routeDataWrite === false,
  ),
  "A route record enabled a forbidden action.",
);
assert(
  freeze.freezeRecords.every(
    (record) =>
      record.automaticMerge === false &&
      record.automaticRoute === false &&
      record.canonicalImport === false &&
      record.playerImport === false &&
      record.relationshipWrite === false &&
      record.routeDataWrite === false,
  ),
  "A freeze record enabled a forbidden action.",
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
  phase: "8D",
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
