#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}
function toCsv(rows, fallbackHeaders) {
  const headers = rows.length ? Object.keys(rows[0]) : fallbackHeaders;
  assert(headers.length > 0, "CSV headers are unavailable.");
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}
function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}
function unique(values) {
  return [...new Set(values)];
}
function candidateCount(record) {
  return (
    record.currentCanonicalCandidates.length +
    record.atlantaReviewedCandidates.length +
    record.bostonReviewedCandidates.length +
    record.brooklynReviewedCandidates.length
  );
}

const args = parseArgs(process.argv);
for (const required of [
  "preview-json",
  "reviewed-json",
  "expected-preview-records-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}`);
}

const [previewBytes, reviewedBytes] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["reviewed-json"]),
]);

const preview = JSON.parse(previewBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(preview.result === "PASS", "Phase 6B preview did not pass.");
assert(preview.phase === "6B", "Unexpected source preview phase.");
assert(
  preview.hashes?.previewRecordsSha256 === args["expected-preview-records-sha"],
  "Phase 6B preview-record hash does not match the frozen checkpoint.",
);
assert(Array.isArray(preview.records), "Phase 6B records are unavailable.");
assert(preview.records.length === 125, "Expected 125 Phase 6B rows.");
assert(Array.isArray(reviewed.records), "Reviewed Charlotte records are unavailable.");
assert(reviewed.records.length === 125, "Expected 125 reviewed Charlotte rows.");

const reviewedById = new Map(reviewed.records.map((record) => [record.tradeId, record]));
assert(reviewedById.size === 125, "Duplicate reviewed Charlotte trade IDs.");

const decisions = preview.records.map((record) => {
  const source = reviewedById.get(record.tradeId);
  assert(source, `Reviewed record missing for ${record.tradeId}.`);

  const current = record.currentCanonicalCandidates;
  const prior = unique([
    ...record.atlantaReviewedCandidates,
    ...record.bostonReviewedCandidates,
    ...record.brooklynReviewedCandidates,
  ]);
  const inheritedBlockers = [...record.blockers];

  let resolutionClass;
  let recommendedAction;

  if (record.sourceDisposition === "merge-followup") {
    resolutionClass = "administrative-followup";
    recommendedAction = "attach-to-underlying-canonical";
  } else if (current.length > 1) {
    resolutionClass = "ambiguous-current-canonical";
    recommendedAction = "manual-current-canonical-selection";
  } else if (current.length === 1) {
    resolutionClass = "existing-canonical-reconciliation";
    recommendedAction = "reconcile-charlotte-perspective-to-existing-canonical";
  } else if (prior.length > 1) {
    resolutionClass = "multiple-prior-reviewed-matches";
    recommendedAction = "manual-cross-team-match-selection";
  } else if (prior.length === 1) {
    resolutionClass = "shared-reviewed-candidate";
    recommendedAction = "reconcile-with-prior-reviewed-perspective";
  } else if (record.crossTeamRequired) {
    resolutionClass = "unresolved-cross-team-match";
    recommendedAction = "research-exact-cross-team-identity";
  } else {
    resolutionClass = "new-canonical-candidate";
    recommendedAction = "eligible-for-guarded-canonical-create-review";
  }

  const blockers = [...inheritedBlockers];

  if (
    resolutionClass === "existing-canonical-reconciliation" &&
    !blockers.includes("existing-canonical-manual-reconciliation")
  ) {
    blockers.push("existing-canonical-manual-reconciliation");
  }
  if (
    resolutionClass === "shared-reviewed-candidate" &&
    !blockers.includes("prior-reviewed-manual-reconciliation")
  ) {
    blockers.push("prior-reviewed-manual-reconciliation");
  }
  if (
    resolutionClass === "new-canonical-candidate" &&
    blockers.length === 0
  ) {
    blockers.push("canonical-create-approval-required");
  }

  const nextPhaseCandidate =
    resolutionClass === "new-canonical-candidate" &&
    blockers.length === 1 &&
    blockers[0] === "canonical-create-approval-required";

  return {
    tradeId: record.tradeId,
    tradeDate: record.tradeDate,
    sourceTeam: record.sourceTeam,
    partnerTeams: record.partnerTeams,
    teamCount: record.teamCount,
    sourceDisposition: record.sourceDisposition,
    resolutionClass,
    recommendedAction,
    currentCanonicalCandidates: current,
    atlantaReviewedCandidates: record.atlantaReviewedCandidates,
    bostonReviewedCandidates: record.bostonReviewedCandidates,
    brooklynReviewedCandidates: record.brooklynReviewedCandidates,
    canonicalTargetFromWorkbook: source.canonicalTarget ?? "",
    routingRequired: record.routingRequired,
    sameDateTeamCollision: record.sameDateTeamCollision,
    verdict: record.verdict,
    confidence: record.confidence,
    contentClass: record.contentClass,
    lowValueRisk: record.lowValueRisk,
    publishStatus: record.publishStatus,
    blockers: unique(blockers),
    candidateReferenceCount: candidateCount(record),
    nextPhaseCandidate,
    canonicalImportAuthorized: false,
    automaticMergeAuthorized: false,
    automaticRoutingAuthorized: false,
    publicationAuthorized: false,
  };
});

decisions.sort((left, right) =>
  left.tradeDate.localeCompare(right.tradeDate) ||
  left.tradeId.localeCompare(right.tradeId)
);

const counts = {
  sourceRows: decisions.length,
  standaloneRows: decisions.filter(
    (record) => record.resolutionClass !== "administrative-followup",
  ).length,
  administrativeFollowups: decisions.filter(
    (record) => record.resolutionClass === "administrative-followup",
  ).length,
  nextPhaseCandidateRows: decisions.filter(
    (record) => record.nextPhaseCandidate,
  ).length,
  blockedOrReconciliationRows: decisions.filter(
    (record) => !record.nextPhaseCandidate,
  ).length,
  routingRequiredRows: decisions.filter((record) => record.routingRequired).length,
  insufficientEvidenceRows: decisions.filter(
    (record) => record.verdict === "Insufficient Evidence",
  ).length,
  sameDateTeamCollisionRows: decisions.filter(
    (record) => record.sameDateTeamCollision,
  ).length,
  resolutionClassCounts: countBy(
    decisions.map((record) => record.resolutionClass),
  ),
  recommendedActionCounts: countBy(
    decisions.map((record) => record.recommendedAction),
  ),
  blockerCounts: countBy(decisions.flatMap((record) => record.blockers)),
};

assert(counts.sourceRows === 125, "Decision source-row count drifted.");
assert(counts.standaloneRows === 123, "Decision standalone count drifted.");
assert(counts.administrativeFollowups === 2, "Decision follow-up count drifted.");
assert(counts.routingRequiredRows === 10, "Decision routing count drifted.");
assert(counts.insufficientEvidenceRows === 9, "Decision evidence count drifted.");
assert(
  counts.nextPhaseCandidateRows + counts.blockedOrReconciliationRows === 125,
  "Decision row accounting drifted.",
);
assert(
  decisions.every((record) => record.canonicalImportAuthorized === false),
  "A decision authorized canonical import.",
);
assert(
  decisions.every((record) => record.automaticMergeAuthorized === false),
  "A decision authorized automatic merge.",
);
assert(
  decisions.every((record) => record.automaticRoutingAuthorized === false),
  "A decision authorized automatic routing.",
);
assert(
  decisions.every((record) => record.publicationAuthorized === false),
  "A decision authorized publication.",
);

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const outputFiles = {
  manifestJson: "charlotte-hornets-phase-6c-decision-matrix.json",
  allCsv: "charlotte-hornets-phase-6c-all-decisions.csv",
  nextCsv: "charlotte-hornets-phase-6c-next-phase-candidates.csv",
  existingCsv: "charlotte-hornets-phase-6c-existing-canonical-reconciliations.csv",
  sharedCsv: "charlotte-hornets-phase-6c-prior-reviewed-reconciliations.csv",
  newCsv: "charlotte-hornets-phase-6c-new-canonical-candidates.csv",
  followupCsv: "charlotte-hornets-phase-6c-administrative-followups.csv",
  blockedCsv: "charlotte-hornets-phase-6c-blocked-and-research.csv",
  routingCsv: "charlotte-hornets-phase-6c-routing-holds.csv",
};

function flatten(record) {
  return {
    tradeId: record.tradeId,
    tradeDate: record.tradeDate,
    partnerTeams: record.partnerTeams,
    teamCount: record.teamCount,
    sourceDisposition: record.sourceDisposition,
    resolutionClass: record.resolutionClass,
    recommendedAction: record.recommendedAction,
    currentCanonicalCandidates: record.currentCanonicalCandidates.join(" | "),
    atlantaReviewedCandidates: record.atlantaReviewedCandidates.join(" | "),
    bostonReviewedCandidates: record.bostonReviewedCandidates.join(" | "),
    brooklynReviewedCandidates: record.brooklynReviewedCandidates.join(" | "),
    canonicalTargetFromWorkbook: record.canonicalTargetFromWorkbook,
    routingRequired: record.routingRequired,
    sameDateTeamCollision: record.sameDateTeamCollision,
    verdict: record.verdict,
    confidence: record.confidence,
    contentClass: record.contentClass,
    lowValueRisk: record.lowValueRisk,
    blockers: record.blockers.join(" | "),
    nextPhaseCandidate: record.nextPhaseCandidate,
    canonicalImportAuthorized: false,
  };
}

const flat = decisions.map(flatten);
const nextRows = flat.filter((record) => record.nextPhaseCandidate === true);
const existingRows = flat.filter(
  (record) => record.resolutionClass === "existing-canonical-reconciliation",
);
const sharedRows = flat.filter(
  (record) => record.resolutionClass === "shared-reviewed-candidate",
);
const newRows = flat.filter(
  (record) => record.resolutionClass === "new-canonical-candidate",
);
const followupRows = flat.filter(
  (record) => record.resolutionClass === "administrative-followup",
);
const blockedRows = flat.filter((record) => record.nextPhaseCandidate !== true);
const routingRows = flat.filter((record) => record.routingRequired === true);

const manifest = {
  result: "PASS",
  phase: "6C",
  mode: "CANONICAL_DECISION_MATRIX_FREEZE",
  batchId: reviewed.batchId,
  sourcePreview: {
    previewRecordsSha256: preview.hashes.previewRecordsSha256,
    previewSemanticSha256: preview.hashes.phase6aPreviewSemanticSha256,
  },
  reviewedBatchSha256: sha256(reviewedBytes),
  counts,
  decisionRecordsSha256: sha256(JSON.stringify(decisions)),
  records: decisions,
  outputFiles,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const headers = Object.keys(flat[0]);
await Promise.all([
  writeFile(
    path.join(outputDir, outputFiles.manifestJson),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  ),
  writeFile(path.join(outputDir, outputFiles.allCsv), toCsv(flat, headers), "utf8"),
  writeFile(path.join(outputDir, outputFiles.nextCsv), toCsv(nextRows, headers), "utf8"),
  writeFile(path.join(outputDir, outputFiles.existingCsv), toCsv(existingRows, headers), "utf8"),
  writeFile(path.join(outputDir, outputFiles.sharedCsv), toCsv(sharedRows, headers), "utf8"),
  writeFile(path.join(outputDir, outputFiles.newCsv), toCsv(newRows, headers), "utf8"),
  writeFile(path.join(outputDir, outputFiles.followupCsv), toCsv(followupRows, headers), "utf8"),
  writeFile(path.join(outputDir, outputFiles.blockedCsv), toCsv(blockedRows, headers), "utf8"),
  writeFile(path.join(outputDir, outputFiles.routingCsv), toCsv(routingRows, headers), "utf8"),
]);

console.log(JSON.stringify({
  result: manifest.result,
  phase: manifest.phase,
  mode: manifest.mode,
  sourcePreview: manifest.sourcePreview,
  counts: manifest.counts,
  decisionRecordsSha256: manifest.decisionRecordsSha256,
  outputFiles: manifest.outputFiles,
  canonicalImports: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
}, null, 2));
