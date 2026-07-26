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
for (const required of ["manifest-json", "preview-json", "reviewed-json"]) {
  assert(args[required], `Missing --${required}.`);
}

const [manifestBytes, previewBytes, reviewedBytes] = await Promise.all([
  readFile(args["manifest-json"]),
  readFile(args["preview-json"]),
  readFile(args["reviewed-json"]),
]);

const manifest = JSON.parse(manifestBytes.toString("utf8"));
const preview = JSON.parse(previewBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(manifest.result === "PASS" && manifest.phase === "7C", "Invalid Phase 7C manifest.");
assert(preview.result === "PASS" && preview.phase === "7B", "Invalid Phase 7B preview.");
assert(reviewed.result === "PASS" && reviewed.phase === "7A", "Invalid reviewed batch.");
assert(Array.isArray(manifest.decisions) && manifest.decisions.length === 219, "Decision count drifted.");
assert(
  manifest.decisionRecordsSha256 === sha256(JSON.stringify(manifest.decisions)),
  "Decision-record hash drifted.",
);
assert(
  manifest.expectedPreviewRecordsSha256 === preview.hashes.previewRecordsSha256,
  "Frozen preview-record hash drifted.",
);
assert(
  manifest.sourceHashes.previewJsonSha256 === sha256(previewBytes),
  "Preview file hash drifted.",
);
assert(
  manifest.sourceHashes.reviewedJsonSha256 === sha256(reviewedBytes),
  "Reviewed file hash drifted.",
);

const counts = manifest.counts;
const fixed = {
  sourceRows: 219,
  standaloneRows: 212,
  administrativeFollowups: 7,
  directionalRows: 197,
  publicCandidateRows: 87,
  privateNoindexRows: 125,
  insufficientEvidenceRows: 15,
  archiveImportReadyRows: 15,
  routingRequiredRows: 15,
  currentMatchedSourceRows: 16,
  priorReviewedExactMatchRows: 11,
  withinBullsCollisionRows: 2,
};
for (const [field, expected] of Object.entries(fixed)) {
  assert(counts[field] === expected, `${field} expected ${expected}, received ${counts[field]}.`);
}
assert(
  counts.nextPhaseCandidateRows + counts.blockedOrReconciliationRows === 219,
  "Decision partition does not close.",
);
assert(
  Object.values(counts.resolutionClassCounts).reduce((sum, value) => sum + value, 0) === 219,
  "Resolution classes do not sum to 219.",
);
assert(
  Object.values(counts.nextActionCounts).reduce((sum, value) => sum + value, 0) === 219,
  "Next-action counts do not sum to 219.",
);
assert(
  JSON.stringify(countBy(manifest.decisions.map((record) => record.resolutionClass))) ===
    JSON.stringify(counts.resolutionClassCounts),
  "Resolution-class accounting drifted.",
);
assert(
  JSON.stringify(countBy(manifest.decisions.map((record) => record.nextAction))) ===
    JSON.stringify(counts.nextActionCounts),
  "Next-action accounting drifted.",
);
assert(
  JSON.stringify(countBy(manifest.decisions.flatMap((record) => record.blockers))) ===
    JSON.stringify(counts.blockerCounts),
  "Blocker accounting drifted.",
);

const decisionIds = manifest.decisions.map((record) => record.sourceTradeId);
assert(new Set(decisionIds).size === 219, "Decision IDs are not unique.");
assert(
  JSON.stringify([...decisionIds].sort()) ===
    JSON.stringify(reviewed.records.map((record) => record.sourceTradeId).sort()),
  "Decision and reviewed IDs differ.",
);

for (const record of manifest.decisions) {
  assert(record.automaticMerge === false, `${record.sourceTradeId}: automatic merge occurred.`);
  assert(record.automaticRoute === false, `${record.sourceTradeId}: automatic route occurred.`);
  assert(record.canonicalImport === false, `${record.sourceTradeId}: canonical import occurred.`);
  assert(record.playerImport === false, `${record.sourceTradeId}: player import occurred.`);
  assert(record.relationshipWrite === false, `${record.sourceTradeId}: relationship write occurred.`);
  assert(record.routeWrite === false, `${record.sourceTradeId}: route write occurred.`);

  if (record.nextPhaseCandidate) {
    assert(record.resolutionClass === "new-canonical-candidate", `${record.sourceTradeId}: candidate resolution drifted.`);
    assert(record.blockerCount === 0, `${record.sourceTradeId}: candidate still has blockers.`);
    assert(record.nextAction === "advance-to-phase-7d-packaging", `${record.sourceTradeId}: candidate action drifted.`);
  } else {
    assert(record.blockerCount > 0, `${record.sourceTradeId}: held row has no blocker.`);
  }

  if (record.insufficientEvidence) {
    assert(record.archiveImportReady === true, `${record.sourceTradeId}: private archive was reopened as research.`);
  }
  if (record.mergeExclude) {
    assert(record.resolutionClass === "administrative-followup", `${record.sourceTradeId}: administrative class drifted.`);
    assert(record.parentTradeId, `${record.sourceTradeId}: linked parent is missing.`);
  }
  if (record.routingRequired) {
    assert(record.blockers.includes("explicit-routing-required"), `${record.sourceTradeId}: routing blocker missing.`);
  }
}

assert(manifest.canonicalImports === 0, "Canonical imports occurred.");
assert(manifest.playerImports === 0, "Player imports occurred.");
assert(manifest.teamRegistryWrites === 0, "Team-registry writes occurred.");
assert(manifest.relationshipWrites === 0, "Relationship writes occurred.");
assert(manifest.routeDataWrites === 0, "Route-data writes occurred.");
assert(manifest.automaticMerges === 0, "Automatic merges occurred.");
assert(manifest.automaticRoutes === 0, "Automatic routes occurred.");
assert(manifest.publicationAuthorized === false, "Publication was authorized.");
assert(manifest.pushPerformed === false, "Push occurred.");
assert(manifest.deployPerformed === false, "Deployment occurred.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "7C",
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
