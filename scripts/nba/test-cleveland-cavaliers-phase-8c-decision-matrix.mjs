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
for (const required of ["matrix-json", "preview-json", "reviewed-json"]) {
  assert(args[required], `Missing --${required}.`);
}

const [matrixBytes, previewBytes, reviewedBytes] = await Promise.all([
  readFile(args["matrix-json"]),
  readFile(args["preview-json"]),
  readFile(args["reviewed-json"]),
]);

const matrix = JSON.parse(matrixBytes.toString("utf8"));
const preview = JSON.parse(previewBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(matrix.result === "PASS" && matrix.phase === "8C", "Invalid Phase 8C matrix.");
assert(preview.result === "PASS" && preview.phase === "8B", "Invalid Phase 8B preview.");
assert(reviewed.result === "PASS" && reviewed.phase === "8A", "Invalid Phase 8A source.");
assert(Array.isArray(matrix.decisions) && matrix.decisions.length === 204, "Decision count drifted.");

const fixed = {
  sourceRows: 204,
  standaloneRows: 194,
  administrativeFollowups: 10,
  directionalRows: 188,
  publicCandidateRows: 77,
  privateNoindexRows: 117,
  insufficientEvidenceRows: 6,
  archiveImportReadyRows: 6,
  routingRequiredRows: 24,
  currentMatchedSourceRows: 37,
  priorReviewedExactMatchRows: 31,
  withinCavaliersCollisionRows: 2,
  recentProvisionalHoldRows: 6,
  previewBlockerRows: 70,
  phase8BBlockedRowsRetained: 70,
};
for (const [field, expected] of Object.entries(fixed)) {
  assert(
    matrix.counts[field] === expected,
    `${field} expected ${expected}, received ${matrix.counts[field]}.`,
  );
}

for (const field of [
  "phase8CAdditionalHoldRows",
  "unresolvedCrossTeamDeclarationRows",
  "preBlockedUnresolvedCrossTeamDeclarationRows",
  "additionalUnresolvedCrossTeamDeclarationRows",
  "directPackagingCandidateRows",
  "blockedOrReconciliationRows",
  "routingCandidateRows",
  "currentCanonicalReconciliationRows",
  "priorReviewedReconciliationRows",
  "identityCollisionRows",
  "newCanonicalCandidateRows",
]) {
  assert(
    Number.isInteger(matrix.counts[field]) && matrix.counts[field] >= 0,
    `${field} is invalid.`,
  );
}

assert(
  matrix.counts.directPackagingCandidateRows +
    matrix.counts.blockedOrReconciliationRows === 204,
  "Decision partition does not close.",
);
assert(
  matrix.counts.directPackagingCandidateRows <= 134,
  "Direct packaging queue exceeds the Phase 8B-clean population.",
);
assert(
  matrix.counts.blockedOrReconciliationRows >= 70,
  "Held partition lost a Phase 8B blocker.",
);
assert(
  matrix.counts.phase8CAdditionalHoldRows ===
    matrix.counts.additionalUnresolvedCrossTeamDeclarationRows,
  "New additional-hold accounting drifted.",
);
assert(
  matrix.counts.unresolvedCrossTeamDeclarationRows ===
    matrix.counts.preBlockedUnresolvedCrossTeamDeclarationRows +
      matrix.counts.additionalUnresolvedCrossTeamDeclarationRows,
  "Total unresolved-declaration accounting drifted.",
);
assert(
  matrix.counts.blockedOrReconciliationRows ===
    matrix.counts.previewBlockerRows +
      matrix.counts.phase8CAdditionalHoldRows,
  "Held partition does not reconcile.",
);
assert(
  matrix.decisions
    .filter((record) => record.phase8CAdditionalHold)
    .every(
      (record) =>
        record.phase8BBlocked === false &&
        record.resolutionClass === "unresolved-cross-team-declaration" &&
        record.blockers.length === 1 &&
        record.blockers[0] ===
          "declared-prior-reviewed-match-without-exact-identity",
    ),
  "Unexpected new Phase 8C hold.",
);
assert(
  matrix.decisions
    .filter(
      (record) =>
        record.phase8BBlocked &&
        record.resolutionClass === "unresolved-cross-team-declaration",
    )
    .every(
      (record) =>
        record.routingRequired === true &&
        record.blockers.includes("explicit-routing-required") &&
        record.blockers.includes(
          "declared-prior-reviewed-match-without-exact-identity",
        ),
    ),
  "Unexpected pre-blocked unresolved declaration.",
);
assert(
  matrix.hashes.decisionRecordsSha256 === sha256(JSON.stringify(matrix.decisions)),
  "Decision-record hash drifted.",
);
assert(
  matrix.hashes.previewRecordsSha256 === preview.hashes.previewRecordsSha256,
  "Preview-record source hash drifted.",
);
assert(
  matrix.hashes.reviewedRecordsSha256 === reviewed.recordsSha256,
  "Reviewed-record source hash drifted.",
);
assert(
  JSON.stringify(countBy(matrix.decisions.map((record) => record.resolutionClass))) ===
    JSON.stringify(matrix.counts.resolutionClassCounts),
  "Resolution-class accounting drifted.",
);
assert(
  JSON.stringify(countBy(matrix.decisions.flatMap((record) => record.blockers))) ===
    JSON.stringify(matrix.counts.blockerCounts),
  "Blocker accounting drifted.",
);
assert(
  JSON.stringify(countBy(matrix.decisions.map((record) => record.nextAction))) ===
    JSON.stringify(matrix.counts.nextActionCounts),
  "Next-action accounting drifted.",
);
assert(
  matrix.decisions.filter((record) => record.directPackagingCandidate).length ===
    matrix.counts.directPackagingCandidateRows,
  "Direct packaging queue drifted.",
);
assert(
  matrix.decisions.filter((record) => record.blockedOrReconciliation).length ===
    matrix.counts.blockedOrReconciliationRows,
  "Blocked/reconciliation queue drifted.",
);
assert(
  matrix.decisions.filter(
    (record) => record.phase8BBlocked && record.blockedOrReconciliation,
  ).length === 70,
  "A Phase 8B blocker escaped the held partition.",
);
assert(
  matrix.decisions.filter((record) => record.routingRequired).length === 24,
  "Routing-required queue drifted.",
);
assert(
  matrix.decisions.filter((record) => record.recentProvisionalHold).length === 6,
  "Recent provisional queue drifted.",
);
assert(
  matrix.decisions.filter((record) => record.mergeExclude).length === 10,
  "Administrative queue drifted.",
);
assert(
  matrix.decisions.every(
    (record) =>
      record.automaticMerge === false &&
      record.automaticRoute === false &&
      record.canonicalImport === false &&
      record.playerImport === false &&
      record.relationshipWrite === false &&
      record.routeWrite === false,
  ),
  "A forbidden action was enabled.",
);

assert(matrix.canonicalImports === 0, "Canonical import occurred.");
assert(matrix.playerImports === 0, "Player import occurred.");
assert(matrix.teamRegistryWrites === 0, "Team-registry write occurred.");
assert(matrix.relationshipWrites === 0, "Relationship write occurred.");
assert(matrix.routeDataWrites === 0, "Route-data write occurred.");
assert(matrix.automaticMerges === 0, "Automatic merge occurred.");
assert(matrix.automaticRoutes === 0, "Automatic route occurred.");
assert(matrix.publicationAuthorized === false, "Publication was authorized.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "8C",
  verified: matrix.counts,
  hashes: matrix.hashes,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
}, null, 2));
