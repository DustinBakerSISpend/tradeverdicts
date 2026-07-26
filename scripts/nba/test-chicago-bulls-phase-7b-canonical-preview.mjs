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
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(output).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
}

const args = parseArgs(process.argv);
for (const required of [
  "preview-json",
  "reviewed-json",
  "phase7a-preview-json",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [previewBytes, reviewedBytes, phase7ABytes] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["reviewed-json"]),
  readFile(args["phase7a-preview-json"]),
]);

const preview = JSON.parse(previewBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const phase7A = JSON.parse(phase7ABytes.toString("utf8"));

assert(preview.result === "PASS" && preview.phase === "7B", "Invalid Phase 7B preview.");
assert(reviewed.result === "PASS" && reviewed.phase === "7A", "Invalid reviewed batch.");
assert(phase7A.result === "PASS" && phase7A.phase === "7A", "Invalid Phase 7A preview.");
assert(Array.isArray(preview.previewRecords), "Preview records unavailable.");
assert(preview.previewRecords.length === 219, "Preview record count drifted.");
assert(reviewed.records.length === 219, "Reviewed record count drifted.");
assert(phase7A.reviewedRows === 219, "Phase 7A preview row count drifted.");

const counts = preview.counts;
const fixedCounts = {
  sourceRows: 219,
  standalonePreviewRows: 212,
  nonStandaloneRows: 7,
  oneTeamRows: 3,
  twoTeamRows: 201,
  multiTeamRows: 15,
  partnerReferences: 232,
  directionalRows: 197,
  publicCandidateRows: 87,
  privateNoindexRows: 125,
  mergeExcludeRows: 7,
  routingRequiredRows: 15,
  insufficientEvidenceRows: 15,
  priorReviewedFlagRows: 23,
};
for (const [field, expected] of Object.entries(fixedCounts)) {
  assert(counts[field] === expected, `${field} expected ${expected}, received ${counts[field]}.`);
}
for (const field of [
  "currentMatchedSourceRows",
  "ambiguousCurrentMatchRows",
  "atlantaMatchedSourceRows",
  "bostonMatchedSourceRows",
  "brooklynMatchedSourceRows",
  "charlotteMatchedSourceRows",
  "priorReviewedExactMatchRows",
  "withinBullsCollisionRows",
  "blockerRows",
]) {
  assert(Number.isInteger(counts[field]) && counts[field] >= 0, `${field} is invalid.`);
}

const ids = preview.previewRecords.map((record) => record.sourceTradeId);
assert(new Set(ids).size === 219, "Preview source IDs are not unique.");
assert(
  JSON.stringify([...ids].sort()) ===
    JSON.stringify(reviewed.records.map((record) => record.sourceTradeId).sort()),
  "Preview and reviewed source IDs differ.",
);

assert(
  preview.hashes.previewRecordsSha256 === sha256(JSON.stringify(preview.previewRecords)),
  "Preview-record hash drifted.",
);
assert(
  preview.sourceHashes.reviewedJsonSha256 === sha256(reviewedBytes),
  "Reviewed source hash drifted.",
);
assert(
  preview.sourceHashes.phase7APreviewSha256 === sha256(phase7ABytes),
  "Phase 7A preview hash drifted.",
);

assert(
  JSON.stringify(countBy(preview.previewRecords.map((record) => record.canonicalAction))) ===
    JSON.stringify(counts.actionCounts),
  "Action-count accounting drifted.",
);
assert(
  Object.values(counts.actionCounts).reduce((sum, value) => sum + value, 0) === 219,
  "Action counts do not sum to 219.",
);

for (const record of preview.previewRecords) {
  assert(record.canonicalImport === false, `${record.sourceTradeId}: canonical import occurred.`);
  assert(record.playerImport === false, `${record.sourceTradeId}: player import occurred.`);
  assert(record.relationshipWrite === false, `${record.sourceTradeId}: relationship write occurred.`);
  assert(record.routeWrite === false, `${record.sourceTradeId}: route write occurred.`);
  assert(record.automaticMerge === false, `${record.sourceTradeId}: automatic merge occurred.`);
  assert(record.automaticRoute === false, `${record.sourceTradeId}: automatic route occurred.`);
  assert(record.canonicalAction.startsWith("hold-"), `${record.sourceTradeId}: non-hold action emitted.`);
  assert(record.teams.length === record.declaredTeamCount, `${record.sourceTradeId}: team count drifted.`);

  if (record.mergeExclude) {
    assert(record.canonicalAction === "hold-merge-with-parent", `${record.sourceTradeId}: merge action drifted.`);
    assert(record.parentTradeId, `${record.sourceTradeId}: merge row lacks parent.`);
  }
  if (record.currentCanonicalMatchCount > 1) {
    assert(record.canonicalAction === "hold-ambiguous-current-canonical", `${record.sourceTradeId}: ambiguous current match action drifted.`);
  }
  if (record.routingRequired) {
    assert(record.declaredTeamCount > 2, `${record.sourceTradeId}: routing row is not multi-team.`);
  }
}

assert(preview.canonicalImports === 0, "Canonical imports occurred.");
assert(preview.playerImports === 0, "Player imports occurred.");
assert(preview.teamRegistryWrites === 0, "Team-registry writes occurred.");
assert(preview.relationshipWrites === 0, "Relationship writes occurred.");
assert(preview.routeDataWrites === 0, "Route-data writes occurred.");
assert(preview.automaticMerges === 0, "Automatic merges occurred.");
assert(preview.automaticRoutes === 0, "Automatic routes occurred.");
assert(preview.publicationAuthorized === false, "Publication was authorized.");
assert(preview.pushPerformed === false, "Push occurred.");
assert(preview.deployPerformed === false, "Deployment occurred.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "7B",
  verified: {
    sourceRows: counts.sourceRows,
    standalonePreviewRows: counts.standalonePreviewRows,
    nonStandaloneRows: counts.nonStandaloneRows,
    oneTeamRows: counts.oneTeamRows,
    twoTeamRows: counts.twoTeamRows,
    multiTeamRows: counts.multiTeamRows,
    partnerReferences: counts.partnerReferences,
    directionalRows: counts.directionalRows,
    publicCandidateRows: counts.publicCandidateRows,
    privateNoindexRows: counts.privateNoindexRows,
    mergeExcludeRows: counts.mergeExcludeRows,
    routingRequiredRows: counts.routingRequiredRows,
    insufficientEvidenceRows: counts.insufficientEvidenceRows,
    priorReviewedFlagRows: counts.priorReviewedFlagRows,
    currentMatchedSourceRows: counts.currentMatchedSourceRows,
    ambiguousCurrentMatchRows: counts.ambiguousCurrentMatchRows,
    priorReviewedExactMatchRows: counts.priorReviewedExactMatchRows,
    withinBullsCollisionRows: counts.withinBullsCollisionRows,
    blockerRows: counts.blockerRows,
  },
  actionCounts: counts.actionCounts,
  previewRecordsSha256: preview.hashes.previewRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
}, null, 2));
