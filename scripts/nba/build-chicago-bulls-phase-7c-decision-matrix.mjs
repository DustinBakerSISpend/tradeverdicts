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
function clean(value) {
  return String(value ?? "").trim();
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
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}
function toCsv(rows, headers) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}
function resolutionClass(record, reviewed) {
  if (record.mergeExclude) return "administrative-followup";
  if (record.currentCanonicalMatchCount > 1) return "ambiguous-current-canonical";
  if (record.currentCanonicalMatchCount === 1) return "existing-canonical-reconciliation";
  if (record.priorReviewedExactMatchCount > 1) return "multiple-prior-reviewed-matches";
  if (record.priorReviewedExactMatchCount === 1) return "shared-reviewed-candidate";
  if (record.withinBullsIdentityCount > 1) return "within-bulls-collision";
  if (reviewed.priorReviewedMatch) return "unresolved-cross-team-match";
  return "new-canonical-candidate";
}
function blockersFor(record, reviewed, resolution) {
  const blockers = [];
  if (resolution === "administrative-followup") {
    blockers.push("non-standalone-linked-child");
  }
  if (resolution === "ambiguous-current-canonical") {
    blockers.push("multiple-current-canonical-matches");
  }
  if (resolution === "existing-canonical-reconciliation") {
    blockers.push("existing-canonical-perspective-reconciliation");
  }
  if (resolution === "multiple-prior-reviewed-matches") {
    blockers.push("multiple-prior-reviewed-exact-matches");
  }
  if (resolution === "shared-reviewed-candidate") {
    blockers.push("prior-reviewed-exact-match");
  }
  if (resolution === "within-bulls-collision") {
    blockers.push("within-bulls-date-team-collision");
  }
  if (resolution === "unresolved-cross-team-match") {
    blockers.push("declared-prior-reviewed-match-without-exact-identity");
  }
  if (record.routingRequired) {
    blockers.push("explicit-routing-required");
  }
  return [...new Set(blockers)].sort();
}

const args = parseArgs(process.argv);
for (const required of [
  "preview-json",
  "reviewed-json",
  "expected-preview-records-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [previewBytes, reviewedBytes] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["reviewed-json"]),
]);

const preview = JSON.parse(previewBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(preview.result === "PASS" && preview.phase === "7B", "Invalid Phase 7B preview.");
assert(reviewed.result === "PASS" && reviewed.phase === "7A", "Invalid Phase 7A reviewed batch.");
assert(Array.isArray(preview.previewRecords) && preview.previewRecords.length === 219, "Expected 219 preview rows.");
assert(Array.isArray(reviewed.records) && reviewed.records.length === 219, "Expected 219 reviewed rows.");
assert(
  preview.hashes.previewRecordsSha256 === args["expected-preview-records-sha"],
  "Phase 7B preview-record hash differs from the frozen checkpoint.",
);
assert(
  sha256(JSON.stringify(preview.previewRecords)) === args["expected-preview-records-sha"],
  "Phase 7B preview records fail hash recomputation.",
);

const reviewedById = new Map(
  reviewed.records.map((record) => [record.sourceTradeId, record]),
);
const decisions = [];

for (const previewRecord of preview.previewRecords) {
  const sourceTradeId = clean(previewRecord.sourceTradeId);
  const reviewedRecord = reviewedById.get(sourceTradeId);
  assert(reviewedRecord, `${sourceTradeId}: reviewed source row is missing.`);

  const resolution = resolutionClass(previewRecord, reviewedRecord);
  const blockers = blockersFor(previewRecord, reviewedRecord, resolution);
  const nextPhaseCandidate =
    !previewRecord.mergeExclude &&
    resolution === "new-canonical-candidate" &&
    blockers.length === 0;

  let nextAction = "hold-for-phase-7d-routing-or-reconciliation";
  if (nextPhaseCandidate) {
    nextAction = "advance-to-phase-7d-packaging";
  } else if (resolution === "administrative-followup") {
    nextAction = "hold-linked-parent-merge";
  } else if (resolution === "existing-canonical-reconciliation") {
    nextAction = "hold-existing-canonical-reconciliation";
  } else if (
    resolution === "shared-reviewed-candidate" ||
    resolution === "multiple-prior-reviewed-matches" ||
    resolution === "unresolved-cross-team-match"
  ) {
    nextAction = "hold-prior-reviewed-reconciliation";
  } else if (
    resolution === "ambiguous-current-canonical" ||
    resolution === "within-bulls-collision"
  ) {
    nextAction = "hold-identity-resolution";
  } else if (previewRecord.routingRequired) {
    nextAction = "hold-phase-7d-routing";
  }

  decisions.push({
    sourceTradeId,
    sourceRow: previewRecord.sourceRow,
    tradeDate: previewRecord.tradeDate,
    canonicalIdentityKey: previewRecord.canonicalIdentityKey,
    teams: previewRecord.teams,
    declaredTeamCount: previewRecord.declaredTeamCount,
    standalone: previewRecord.standalone,
    mergeExclude: previewRecord.mergeExclude,
    parentTradeId: previewRecord.parentTradeId,
    routingRequired: previewRecord.routingRequired,
    verdict: previewRecord.verdict,
    outcomeScore: previewRecord.outcomeScore,
    confidence: previewRecord.confidence,
    tier: previewRecord.tier,
    contentClass: previewRecord.contentClass,
    publishStatus: previewRecord.publishStatus,
    databaseStatus: previewRecord.databaseStatus,
    databaseImportAuthorized: previewRecord.databaseImportAuthorized,
    currentCanonicalMatchCount: previewRecord.currentCanonicalMatchCount,
    currentCanonicalMatchIds: previewRecord.currentCanonicalMatchIds,
    priorReviewedExactMatchCount: previewRecord.priorReviewedExactMatchCount,
    atlantaMatchCount: previewRecord.atlantaMatchCount,
    bostonMatchCount: previewRecord.bostonMatchCount,
    brooklynMatchCount: previewRecord.brooklynMatchCount,
    charlotteMatchCount: previewRecord.charlotteMatchCount,
    withinBullsIdentityCount: previewRecord.withinBullsIdentityCount,
    withinBullsSourceTradeIds: previewRecord.withinBullsSourceTradeIds,
    declaredPriorReviewedMatch: reviewedRecord.priorReviewedMatch,
    declaredPriorReviewedTeams: reviewedRecord.priorReviewedTeams,
    insufficientEvidence: previewRecord.verdict === "Insufficient Evidence",
    archiveImportReady:
      previewRecord.verdict === "Insufficient Evidence" &&
      previewRecord.databaseStatus === "Ready — archival import",
    resolutionClass: resolution,
    blockers,
    blockerCount: blockers.length,
    nextPhaseCandidate,
    nextAction,
    automaticMerge: false,
    automaticRoute: false,
    canonicalImport: false,
    playerImport: false,
    relationshipWrite: false,
    routeWrite: false,
  });
}

assert(decisions.length === 219, "Decision-record count drifted.");
assert(new Set(decisions.map((record) => record.sourceTradeId)).size === 219, "Decision IDs are not unique.");

const nextPhaseCandidates = decisions.filter((record) => record.nextPhaseCandidate);
const existingCanonical = decisions.filter(
  (record) => record.resolutionClass === "existing-canonical-reconciliation" ||
    record.resolutionClass === "ambiguous-current-canonical",
);
const priorReviewed = decisions.filter((record) =>
  [
    "shared-reviewed-candidate",
    "multiple-prior-reviewed-matches",
    "unresolved-cross-team-match",
  ].includes(record.resolutionClass),
);
const newCanonical = decisions.filter(
  (record) => record.resolutionClass === "new-canonical-candidate",
);
const administrative = decisions.filter(
  (record) => record.resolutionClass === "administrative-followup",
);
const identityCollisions = decisions.filter(
  (record) =>
    record.resolutionClass === "within-bulls-collision" ||
    record.resolutionClass === "ambiguous-current-canonical",
);
const blocked = decisions.filter((record) => !record.nextPhaseCandidate);
const routingHolds = decisions.filter((record) => record.routingRequired);
const archivalRows = decisions.filter((record) => record.insufficientEvidence);

const counts = {
  sourceRows: decisions.length,
  standaloneRows: decisions.filter((record) => record.standalone).length,
  administrativeFollowups: administrative.length,
  directionalRows: decisions.filter((record) => record.outcomeScore != null).length,
  publicCandidateRows: decisions.filter((record) => record.contentClass === "Public Candidate").length,
  privateNoindexRows: decisions.filter((record) => record.contentClass === "Private/Noindex Archive").length,
  insufficientEvidenceRows: archivalRows.length,
  archiveImportReadyRows: archivalRows.filter((record) => record.archiveImportReady).length,
  routingRequiredRows: routingHolds.length,
  currentMatchedSourceRows: decisions.filter((record) => record.currentCanonicalMatchCount > 0).length,
  priorReviewedExactMatchRows: decisions.filter((record) => record.priorReviewedExactMatchCount > 0).length,
  withinBullsCollisionRows: decisions.filter((record) => record.withinBullsIdentityCount > 1).length,
  nextPhaseCandidateRows: nextPhaseCandidates.length,
  blockedOrReconciliationRows: blocked.length,
  existingCanonicalReconciliationRows: existingCanonical.length,
  priorReviewedReconciliationRows: priorReviewed.length,
  newCanonicalCandidateRows: newCanonical.length,
  identityCollisionRows: identityCollisions.length,
  resolutionClassCounts: countBy(decisions.map((record) => record.resolutionClass)),
  blockerCounts: countBy(decisions.flatMap((record) => record.blockers)),
  nextActionCounts: countBy(decisions.map((record) => record.nextAction)),
};

assert(counts.sourceRows === 219, "Source-row count drifted.");
assert(counts.standaloneRows === 212, "Standalone count drifted.");
assert(counts.administrativeFollowups === 7, "Administrative count drifted.");
assert(counts.directionalRows === 197, "Directional count drifted.");
assert(counts.publicCandidateRows === 87, "Public-candidate count drifted.");
assert(counts.privateNoindexRows === 125, "Private/noindex count drifted.");
assert(counts.insufficientEvidenceRows === 15, "Insufficient-evidence count drifted.");
assert(counts.archiveImportReadyRows === 15, "Archive-import readiness drifted.");
assert(counts.routingRequiredRows === 15, "Routing count drifted.");
assert(counts.currentMatchedSourceRows === 16, "Current-match count differs from Phase 7B.");
assert(counts.priorReviewedExactMatchRows === 11, "Prior-reviewed exact-match count differs from Phase 7B.");
assert(counts.withinBullsCollisionRows === 2, "Within-Bulls collision count differs from Phase 7B.");
assert(counts.nextPhaseCandidateRows + counts.blockedOrReconciliationRows === 219, "Decision partition does not close.");
assert(decisions.every((record) => record.automaticMerge === false), "Automatic merge enabled.");
assert(decisions.every((record) => record.automaticRoute === false), "Automatic route enabled.");
assert(decisions.every((record) => record.canonicalImport === false), "Canonical import occurred.");
assert(decisions.every((record) => record.playerImport === false), "Player import occurred.");
assert(decisions.every((record) => record.relationshipWrite === false), "Relationship write occurred.");
assert(decisions.every((record) => record.routeWrite === false), "Route write occurred.");

const decisionRecordsSha256 = sha256(JSON.stringify(decisions));
const manifest = {
  result: "PASS",
  phase: "7C",
  mode: "CANONICAL_DECISION_MATRIX_FREEZE",
  sourceTeam: "chicago-bulls",
  expectedPreviewRecordsSha256: args["expected-preview-records-sha"],
  counts,
  decisionRecordsSha256,
  sourceHashes: {
    previewJsonSha256: sha256(previewBytes),
    reviewedJsonSha256: sha256(reviewedBytes),
    phase7BPreviewRecordsSha256: preview.hashes.previewRecordsSha256,
  },
  decisions,
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

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const files = {
  manifest: "chicago-bulls-phase-7c-decision-matrix.json",
  allDecisions: "chicago-bulls-phase-7c-all-decisions.csv",
  nextPhaseCandidates: "chicago-bulls-phase-7c-next-phase-candidates.csv",
  existingCanonical: "chicago-bulls-phase-7c-existing-canonical-reconciliations.csv",
  priorReviewed: "chicago-bulls-phase-7c-prior-reviewed-reconciliations.csv",
  newCanonical: "chicago-bulls-phase-7c-new-canonical-candidates.csv",
  administrative: "chicago-bulls-phase-7c-administrative-followups.csv",
  identityCollisions: "chicago-bulls-phase-7c-identity-collisions.csv",
  blocked: "chicago-bulls-phase-7c-blocked-and-reconciliation.csv",
  routingHolds: "chicago-bulls-phase-7c-routing-holds.csv",
  archivalRows: "chicago-bulls-phase-7c-private-archive-ready.csv",
};

const csvHeaders = [
  "sourceTradeId", "sourceRow", "tradeDate", "canonicalIdentityKey", "teams",
  "declaredTeamCount", "standalone", "mergeExclude", "parentTradeId",
  "routingRequired", "verdict", "contentClass", "databaseStatus",
  "currentCanonicalMatchCount", "currentCanonicalMatchIds",
  "priorReviewedExactMatchCount", "declaredPriorReviewedMatch",
  "declaredPriorReviewedTeams", "withinBullsIdentityCount",
  "withinBullsSourceTradeIds", "resolutionClass", "blockers",
  "blockerCount", "archiveImportReady", "nextPhaseCandidate",
  "nextAction", "automaticMerge", "automaticRoute",
];
function csvRows(records) {
  return records.map((record) => ({
    ...record,
    teams: record.teams.join(" | "),
    currentCanonicalMatchIds: record.currentCanonicalMatchIds.join(" | "),
    declaredPriorReviewedTeams: record.declaredPriorReviewedTeams.join(" | "),
    withinBullsSourceTradeIds: record.withinBullsSourceTradeIds.join(" | "),
    blockers: record.blockers.join(" | "),
  }));
}

await Promise.all([
  writeFile(path.join(outputDir, files.manifest), JSON.stringify(manifest, null, 2) + "\n"),
  writeFile(path.join(outputDir, files.allDecisions), toCsv(csvRows(decisions), csvHeaders)),
  writeFile(path.join(outputDir, files.nextPhaseCandidates), toCsv(csvRows(nextPhaseCandidates), csvHeaders)),
  writeFile(path.join(outputDir, files.existingCanonical), toCsv(csvRows(existingCanonical), csvHeaders)),
  writeFile(path.join(outputDir, files.priorReviewed), toCsv(csvRows(priorReviewed), csvHeaders)),
  writeFile(path.join(outputDir, files.newCanonical), toCsv(csvRows(newCanonical), csvHeaders)),
  writeFile(path.join(outputDir, files.administrative), toCsv(csvRows(administrative), csvHeaders)),
  writeFile(path.join(outputDir, files.identityCollisions), toCsv(csvRows(identityCollisions), csvHeaders)),
  writeFile(path.join(outputDir, files.blocked), toCsv(csvRows(blocked), csvHeaders)),
  writeFile(path.join(outputDir, files.routingHolds), toCsv(csvRows(routingHolds), csvHeaders)),
  writeFile(path.join(outputDir, files.archivalRows), toCsv(csvRows(archivalRows), csvHeaders)),
]);

console.log(JSON.stringify({
  result: manifest.result,
  phase: manifest.phase,
  counts: manifest.counts,
  decisionRecordsSha256,
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
}, null, 2));
