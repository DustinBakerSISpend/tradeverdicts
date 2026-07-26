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
  "preview-json",
  "reviewed-json",
  "phase8a-preview-json",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [previewBytes, reviewedBytes, phase8ABytes] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["reviewed-json"]),
  readFile(args["phase8a-preview-json"]),
]);

const preview = JSON.parse(previewBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const phase8A = JSON.parse(phase8ABytes.toString("utf8"));

assert(preview.result === "PASS" && preview.phase === "8B", "Invalid Phase 8B preview.");
assert(reviewed.result === "PASS" && reviewed.phase === "8A", "Invalid reviewed source.");
assert(phase8A.result === "PASS" && phase8A.phase === "8A", "Invalid Phase 8A preview.");
assert(Array.isArray(preview.previewRecords) && preview.previewRecords.length === 204, "Preview-record count drifted.");

const fixed = {
  sourceRows: 204,
  standalonePreviewRows: 194,
  nonStandaloneRows: 10,
  oneTeamRows: 0,
  twoTeamRows: 180,
  multiTeamRows: 24,
  partnerReferences: 229,
  directionalRows: 188,
  publicCandidateRows: 77,
  privateNoindexRows: 117,
  mergeExcludeRows: 10,
  routingRequiredRows: 24,
  insufficientEvidenceRows: 6,
  priorReviewedFlagRows: 41,
  provisionalRows: 7,
  recentProvisionalHoldRows: 6,
  importAuthorizedRows: 188,
};
for (const [field, expected] of Object.entries(fixed)) {
  assert(
    preview.counts[field] === expected,
    `${field} expected ${expected}, received ${preview.counts[field]}.`,
  );
}
for (const field of [
  "currentMatchedSourceRows",
  "ambiguousCurrentMatchRows",
  "atlantaMatchedSourceRows",
  "bostonMatchedSourceRows",
  "brooklynMatchedSourceRows",
  "charlotteMatchedSourceRows",
  "chicagoMatchedSourceRows",
  "priorReviewedExactMatchRows",
  "withinCavaliersCollisionRows",
  "blockerRows",
]) {
  assert(
    Number.isInteger(preview.counts[field]) && preview.counts[field] >= 0,
    `${field} is invalid.`,
  );
}

assert(
  preview.hashes.previewRecordsSha256 ===
    sha256(JSON.stringify(preview.previewRecords)),
  "Preview-record hash drifted.",
);
assert(
  preview.hashes.reviewedRecordsSha256 === reviewed.recordsSha256,
  "Reviewed-record hash drifted.",
);
assert(
  preview.hashes.phase8APreviewFileSha256 === sha256(phase8ABytes),
  "Phase 8A preview-file hash drifted.",
);
assert(
  JSON.stringify(countBy(preview.previewRecords.map((record) => record.canonicalAction))) ===
    JSON.stringify(preview.counts.actionCounts),
  "Canonical-action accounting drifted.",
);
assert(
  JSON.stringify(countBy(preview.previewRecords.flatMap((record) => record.blockerReasons))) ===
    JSON.stringify(preview.counts.blockerReasonCounts),
  "Blocker-reason accounting drifted.",
);

assert(
  preview.previewRecords.filter((record) => record.mergeExclude).length === 10,
  "Linked-row partition drifted.",
);
assert(
  preview.previewRecords.filter((record) => record.routingRequired).length === 24,
  "Routing partition drifted.",
);
assert(
  preview.previewRecords.filter((record) => record.recentProvisionalHold).length === 6,
  "Recent provisional partition drifted.",
);
assert(
  preview.previewRecords.filter((record) => record.blocked).length ===
    preview.counts.blockerRows,
  "Blocker-row count drifted.",
);
assert(
  preview.previewRecords.every(
    (record) =>
      record.automaticMerge === false &&
      record.automaticRoute === false &&
      record.canonicalImport === false &&
      record.playerImport === false &&
      record.relationshipWrite === false &&
      record.routeDataWrite === false,
  ),
  "A forbidden action was enabled.",
);

assert(preview.canonicalImports === 0, "Canonical import occurred.");
assert(preview.playerImports === 0, "Player import occurred.");
assert(preview.teamRegistryWrites === 0, "Team-registry write occurred.");
assert(preview.relationshipWrites === 0, "Relationship write occurred.");
assert(preview.routeDataWrites === 0, "Route-data write occurred.");
assert(preview.automaticMerges === 0, "Automatic merge occurred.");
assert(preview.automaticRoutes === 0, "Automatic route occurred.");
assert(preview.publicationAuthorized === false, "Publication was authorized.");
assert(preview.pushPerformed === false, "Push occurred.");
assert(preview.deployPerformed === false, "Deployment occurred.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "8B",
  verified: preview.counts,
  hashes: preview.hashes,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
}, null, 2));
