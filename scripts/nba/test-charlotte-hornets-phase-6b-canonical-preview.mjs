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
function stablePhase6APreview(source) {
  const {
    candidatePath,
    matchPath,
    teamPath,
    routingPath,
    previewPath,
    ...stableFields
  } = source;
  return stableFields;
}

const args = parseArgs(process.argv);
for (const required of [
  "preview-json",
  "reviewed-json",
  "phase6a-preview-json",
  "candidate-csv",
  "team-resolution-csv",
  "routing-csv",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  previewBytes,
  reviewedBytes,
  phase6aBytes,
  candidateBytes,
  teamResolutionBytes,
  routingBytes,
] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["reviewed-json"]),
  readFile(args["phase6a-preview-json"]),
  readFile(args["candidate-csv"]),
  readFile(args["team-resolution-csv"]),
  readFile(args["routing-csv"]),
]);

const preview = JSON.parse(previewBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const phase6a = JSON.parse(phase6aBytes.toString("utf8"));

assert(preview.result === "PASS", "Phase 6B preview did not pass.");
assert(preview.phase === "6B", "Unexpected Phase 6B phase value.");
assert(preview.mode === "DUPLICATE_SAFE_CANONICAL_PREVIEW", "Unexpected Phase 6B mode.");
assert(Array.isArray(preview.records), "Phase 6B records are unavailable.");
assert(Array.isArray(reviewed.records), "Reviewed Charlotte records are unavailable.");
assert(preview.records.length === 125, "Expected 125 Phase 6B records.");
assert(reviewed.records.length === 125, "Expected 125 reviewed Charlotte records.");
assert(new Set(preview.records.map((record) => record.tradeId)).size === 125, "Duplicate Phase 6B trade IDs.");
assert(
  stable(preview.records.map((record) => record.tradeId).sort()) ===
  stable(reviewed.records.map((record) => record.tradeId).sort()),
  "Phase 6B and reviewed trade IDs differ.",
);

const counts = preview.counts;
assert(counts.sourceRows === 125, "Source-row count drifted.");
assert(counts.standalonePreviewRows === 123, "Standalone count drifted.");
assert(counts.nonStandaloneRows === 2, "Non-standalone count drifted.");
assert(counts.twoTeamRows === 115, "Two-team count drifted.");
assert(counts.multiTeamRows === 10, "Multi-team count drifted.");
assert(counts.partnerReferences === 140, "Partner-reference count drifted.");
assert(counts.crossTeamRequiredRows === 13, "Cross-team required count drifted.");
assert(counts.routingRequiredRows === 10, "Routing-required count drifted.");
assert(counts.insufficientEvidenceRows === 9, "Insufficient-evidence count drifted.");

assert(
  counts.currentMatchedSourceRows ===
  preview.records.filter((record) => record.currentCanonicalCandidates.length > 0).length,
  "Current-match accounting drifted.",
);
assert(
  counts.ambiguousCurrentMatchRows ===
  preview.records.filter((record) => record.currentCanonicalCandidates.length > 1).length,
  "Ambiguous-current accounting drifted.",
);
assert(
  counts.atlantaMatchedSourceRows ===
  preview.records.filter((record) => record.atlantaReviewedCandidates.length > 0).length,
  "Atlanta-match accounting drifted.",
);
assert(
  counts.bostonMatchedSourceRows ===
  preview.records.filter((record) => record.bostonReviewedCandidates.length > 0).length,
  "Boston-match accounting drifted.",
);
assert(
  counts.brooklynMatchedSourceRows ===
  preview.records.filter((record) => record.brooklynReviewedCandidates.length > 0).length,
  "Brooklyn-match accounting drifted.",
);
assert(
  counts.blockerRows === preview.records.filter((record) => record.blockers.length > 0).length,
  "Blocker-row accounting drifted.",
);
assert(
  stable(counts.actionCounts) ===
  stable(countBy(preview.records.map((record) => record.previewAction))),
  "Action accounting drifted.",
);
assert(
  stable(counts.dispositionCounts) ===
  stable(countBy(preview.records.map((record) => record.sourceDisposition))),
  "Disposition accounting drifted.",
);
assert(
  stable(counts.contentClassCounts) ===
  stable(countBy(preview.records.map((record) => record.contentClass))),
  "Content-class accounting drifted.",
);

assert(
  preview.hashes.phase6aPreviewSemanticSha256 ===
    sha256(JSON.stringify(stablePhase6APreview(phase6a))),
  "Phase 6A semantic preview hash drifted.",
);
assert(
  preview.hashes.phase6aCandidateCsvSha256 === sha256(candidateBytes),
  "Phase 6A candidate CSV hash drifted.",
);
assert(
  preview.hashes.phase6aTeamResolutionCsvSha256 === sha256(teamResolutionBytes),
  "Phase 6A team-resolution hash drifted.",
);
assert(
  preview.hashes.phase6aRoutingCsvSha256 === sha256(routingBytes),
  "Phase 6A routing hash drifted.",
);
assert(
  preview.hashes.reviewedBatchSha256 === sha256(reviewedBytes),
  "Reviewed-batch hash drifted.",
);
assert(
  preview.hashes.previewRecordsSha256 === sha256(JSON.stringify(preview.records)),
  "Preview-record hash drifted.",
);

assert(preview.canonicalImports === 0, "Canonical import occurred.");
assert(preview.playerImports === 0, "Player import occurred.");
assert(preview.teamRegistryWrites === 0, "Team-registry write occurred.");
assert(preview.relationshipWrites === 0, "Relationship write occurred.");
assert(preview.routeDataWrites === 0, "Route-data write occurred.");
assert(preview.automaticMerges === 0, "Automatic merge occurred.");
assert(preview.automaticRoutes === 0, "Automatic routing occurred.");
assert(preview.publicationAuthorized === false, "Publication was authorized.");
assert(phase6a.result === "PASS", "Source Phase 6A preview did not pass.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "6B",
  verified: counts,
  previewRecordsSha256: preview.hashes.previewRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
}, null, 2));
