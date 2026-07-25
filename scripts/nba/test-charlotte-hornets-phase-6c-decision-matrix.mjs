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
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}
function stable(value) {
  return JSON.stringify(value);
}

const args = parseArgs(process.argv);
for (const required of ["manifest-json", "preview-json", "reviewed-json"]) {
  assert(args[required], `Missing --${required}`);
}

const [manifestBytes, previewBytes, reviewedBytes] = await Promise.all([
  readFile(args["manifest-json"]),
  readFile(args["preview-json"]),
  readFile(args["reviewed-json"]),
]);

const manifest = JSON.parse(manifestBytes.toString("utf8"));
const preview = JSON.parse(previewBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(manifest.result === "PASS", "Phase 6C manifest did not pass.");
assert(manifest.phase === "6C", "Unexpected Phase 6C phase.");
assert(
  manifest.mode === "CANONICAL_DECISION_MATRIX_FREEZE",
  "Unexpected Phase 6C mode.",
);
assert(Array.isArray(manifest.records), "Phase 6C records are unavailable.");
assert(manifest.records.length === 125, "Expected 125 Phase 6C records.");
assert(new Set(manifest.records.map((record) => record.tradeId)).size === 125, "Duplicate Phase 6C trade IDs.");
assert(
  stable(manifest.records.map((record) => record.tradeId).sort()) ===
  stable(preview.records.map((record) => record.tradeId).sort()),
  "Phase 6B and Phase 6C trade IDs differ.",
);
assert(
  stable(manifest.records.map((record) => record.tradeId).sort()) ===
  stable(reviewed.records.map((record) => record.tradeId).sort()),
  "Reviewed and Phase 6C trade IDs differ.",
);

assert(
  manifest.sourcePreview.previewRecordsSha256 ===
    preview.hashes.previewRecordsSha256,
  "Frozen Phase 6B preview-record hash drifted.",
);
assert(
  manifest.sourcePreview.previewSemanticSha256 ===
    preview.hashes.phase6aPreviewSemanticSha256,
  "Frozen Phase 6A semantic preview hash drifted.",
);
assert(
  manifest.reviewedBatchSha256 === sha256(reviewedBytes),
  "Reviewed-batch hash drifted.",
);
assert(
  manifest.decisionRecordsSha256 ===
    sha256(JSON.stringify(manifest.records)),
  "Decision-record hash drifted.",
);

const counts = manifest.counts;
assert(counts.sourceRows === 125, "Decision source count drifted.");
assert(counts.standaloneRows === 123, "Decision standalone count drifted.");
assert(counts.administrativeFollowups === 2, "Decision follow-up count drifted.");
assert(counts.routingRequiredRows === 10, "Decision routing count drifted.");
assert(counts.insufficientEvidenceRows === 9, "Decision evidence count drifted.");
assert(
  counts.nextPhaseCandidateRows + counts.blockedOrReconciliationRows === 125,
  "Decision row accounting drifted.",
);
assert(
  stable(counts.resolutionClassCounts) ===
    stable(countBy(manifest.records.map((record) => record.resolutionClass))),
  "Resolution-class accounting drifted.",
);
assert(
  stable(counts.recommendedActionCounts) ===
    stable(countBy(manifest.records.map((record) => record.recommendedAction))),
  "Recommended-action accounting drifted.",
);
assert(
  stable(counts.blockerCounts) ===
    stable(countBy(manifest.records.flatMap((record) => record.blockers))),
  "Blocker accounting drifted.",
);

assert(
  manifest.records.every((record) => record.canonicalImportAuthorized === false),
  "Canonical import authorization escaped.",
);
assert(
  manifest.records.every((record) => record.automaticMergeAuthorized === false),
  "Automatic merge authorization escaped.",
);
assert(
  manifest.records.every((record) => record.automaticRoutingAuthorized === false),
  "Automatic routing authorization escaped.",
);
assert(
  manifest.records.every((record) => record.publicationAuthorized === false),
  "Publication authorization escaped.",
);

assert(manifest.canonicalImports === 0, "Canonical import occurred.");
assert(manifest.playerImports === 0, "Player import occurred.");
assert(manifest.teamRegistryWrites === 0, "Team-registry write occurred.");
assert(manifest.relationshipWrites === 0, "Relationship write occurred.");
assert(manifest.routeDataWrites === 0, "Route-data write occurred.");
assert(manifest.automaticMerges === 0, "Automatic merge occurred.");
assert(manifest.automaticRoutes === 0, "Automatic routing occurred.");
assert(manifest.publicationAuthorized === false, "Publication was authorized.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "6C",
  counts,
  decisionRecordsSha256: manifest.decisionRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
}, null, 2));
