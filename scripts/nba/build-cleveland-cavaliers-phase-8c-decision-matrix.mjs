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
  if (record.recentProvisionalHold) return "recent-provisional-hold";
  if (record.currentCanonicalMatchCount > 1) {
    return "ambiguous-current-canonical";
  }
  if (record.currentCanonicalMatchCount === 1) {
    return "existing-canonical-reconciliation";
  }
  if (record.withinCavaliersCollisionCount > 0) {
    return "within-cavaliers-collision";
  }
  if (record.priorReviewedExactMatchCount > 1) {
    return "multiple-prior-reviewed-matches";
  }
  if (record.priorReviewedExactMatchCount === 1) {
    return "shared-reviewed-candidate";
  }
  if (reviewed.priorReviewedMatch) {
    return "unresolved-cross-team-declaration";
  }
  if (record.routingRequired) return "routing-candidate";
  return "new-canonical-candidate";
}
function blockersFor(record, reviewed, resolution) {
  const blockers = [];
  if (resolution === "administrative-followup") {
    blockers.push("non-standalone-linked-row");
  }
  if (resolution === "recent-provisional-hold") {
    blockers.push("recent-provisional-import-hold");
  }
  if (resolution === "ambiguous-current-canonical") {
    blockers.push("multiple-current-canonical-matches");
  }
  if (resolution === "existing-canonical-reconciliation") {
    blockers.push("existing-canonical-perspective-reconciliation");
  }
  if (resolution === "within-cavaliers-collision") {
    blockers.push("within-cavaliers-date-team-collision");
  }
  if (resolution === "multiple-prior-reviewed-matches") {
    blockers.push("multiple-prior-reviewed-exact-matches");
  }
  if (resolution === "shared-reviewed-candidate") {
    blockers.push("prior-reviewed-exact-match");
  }
  if (resolution === "unresolved-cross-team-declaration") {
    blockers.push("declared-prior-reviewed-match-without-exact-identity");
  }
  if (record.routingRequired) blockers.push("explicit-routing-required");
  return [...new Set(blockers)].sort();
}
function nextAction(resolution) {
  if (resolution === "new-canonical-candidate") {
    return "advance-to-post-routing-packaging-queue";
  }
  if (resolution === "routing-candidate") {
    return "hold-for-phase-8d-routing";
  }
  if (resolution === "administrative-followup") {
    return "hold-linked-parent-merge";
  }
  if (
    resolution === "existing-canonical-reconciliation" ||
    resolution === "ambiguous-current-canonical"
  ) {
    return "hold-current-canonical-reconciliation";
  }
  if (
    resolution === "shared-reviewed-candidate" ||
    resolution === "multiple-prior-reviewed-matches" ||
    resolution === "unresolved-cross-team-declaration"
  ) {
    return "hold-prior-reviewed-reconciliation";
  }
  if (resolution === "within-cavaliers-collision") {
    return "hold-identity-resolution";
  }
  if (resolution === "recent-provisional-hold") {
    return "hold-recent-provisional";
  }
  return "hold-manual-review";
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

assert(preview.result === "PASS" && preview.phase === "8B", "Invalid Phase 8B preview.");
assert(reviewed.result === "PASS" && reviewed.phase === "8A", "Invalid Phase 8A reviewed source.");
assert(Array.isArray(preview.previewRecords) && preview.previewRecords.length === 204, "Expected 204 preview records.");
assert(Array.isArray(reviewed.records) && reviewed.records.length === 204, "Expected 204 reviewed records.");
assert(
  preview.hashes.previewRecordsSha256 === args["expected-preview-records-sha"],
  "Phase 8B preview-record hash differs from the frozen checkpoint.",
);
assert(
  sha256(JSON.stringify(preview.previewRecords)) ===
    args["expected-preview-records-sha"],
  "Phase 8B preview-record hash recomputation failed.",
);

const reviewedById = new Map(
  reviewed.records.map((record) => [record.sourceTradeId, record]),
);
assert(reviewedById.size === 204, "Duplicate reviewed source-trade ID.");

const decisions = [];
for (const record of preview.previewRecords) {
  const reviewedRecord = reviewedById.get(record.sourceTradeId);
  assert(reviewedRecord, `${record.sourceTradeId}: reviewed source row is missing.`);

  const resolution = resolutionClass(record, reviewedRecord);
  const blockers = blockersFor(record, reviewedRecord, resolution);
  const directPackagingCandidate =
    resolution === "new-canonical-candidate" &&
    blockers.length === 0 &&
    record.blocked === false;
  const routingCandidate =
    resolution === "routing-candidate" &&
    record.routingRequired === true &&
    ![
      "administrative-followup",
      "recent-provisional-hold",
      "ambiguous-current-canonical",
      "existing-canonical-reconciliation",
      "within-cavaliers-collision",
      "multiple-prior-reviewed-matches",
      "shared-reviewed-candidate",
      "unresolved-cross-team-declaration",
    ].includes(resolution);

  const archiveImportReady =
    reviewedRecord.verdict === "Insufficient Evidence" &&
    reviewedRecord.databaseStatus === "Ready — archival import";

  decisions.push({
    decisionKey: `cleveland-cavaliers:${record.sourceTradeId}`,
    sourceTradeId: record.sourceTradeId,
    sourceRow: record.sourceRow,
    tradeDate: record.tradeDate,
    canonicalIdentityKey: record.identityKey,
    teams: [...record.teams],
    partnerTeams: [...record.partnerTeams],
    declaredTeamCount: record.declaredTeamCount,
    mergeExclude: record.mergeExclude,
    parentTradeId: record.parentTradeId,
    routingRequired: record.routingRequired,
    explicitEdgeReview: record.explicitEdgeReview,
    verdict: record.verdict,
    outcomeScore: record.outcomeScore,
    confidence: record.confidence,
    tier: record.tier,
    contentClass: record.contentClass,
    publishStatus: record.publishStatus,
    databaseStatus: record.databaseStatus,
    databaseImportAuthorized: record.databaseImportAuthorized,
    publicCandidate: record.publicCandidate,
    privateNoindexArchive: record.privateNoindexArchive,
    provisional: record.provisional,
    recentProvisionalHold: record.recentProvisionalHold,
    currentCanonicalMatchCount: record.currentCanonicalMatchCount,
    currentCanonicalMatchIds: [...record.currentCanonicalMatchIds],
    priorReviewedExactMatchCount: record.priorReviewedExactMatchCount,
    priorReviewedExactMatches: [...record.priorReviewedExactMatches],
    withinCavaliersCollisionCount: record.withinCavaliersCollisionCount,
    withinCavaliersCollisionIds: [...record.withinCavaliersCollisionIds],
    declaredPriorReviewedMatch: reviewedRecord.priorReviewedMatch,
    declaredPriorReviewedTeams: [...reviewedRecord.priorReviewedTeams],
    insufficientEvidence: reviewedRecord.verdict === "Insufficient Evidence",
    archiveImportReady,
    resolutionClass: resolution,
    blockers,
    blockerCount: blockers.length,
    phase8BBlocked: record.blocked === true,
    phase8CAdditionalHold:
      record.blocked === false && blockers.length > 0,
    directPackagingCandidate,
    routingCandidate,
    blockedOrReconciliation: !directPackagingCandidate,
    nextAction: nextAction(resolution),
    automaticMerge: false,
    automaticRoute: false,
    canonicalImport: false,
    playerImport: false,
    relationshipWrite: false,
    routeWrite: false,
  });
}

decisions.sort(
  (left, right) =>
    Number(left.sourceRow) - Number(right.sourceRow) ||
    left.sourceTradeId.localeCompare(right.sourceTradeId, "en"),
);

assert(decisions.length === 204, "Decision-record count drifted.");
assert(new Set(decisions.map((record) => record.sourceTradeId)).size === 204, "Decision IDs are not unique.");

const directCandidates = decisions.filter((record) => record.directPackagingCandidate);
const routingCandidates = decisions.filter((record) => record.routingCandidate);
const currentReconciliations = decisions.filter((record) =>
  ["existing-canonical-reconciliation", "ambiguous-current-canonical"].includes(
    record.resolutionClass,
  ),
);
const priorReconciliations = decisions.filter((record) =>
  [
    "shared-reviewed-candidate",
    "multiple-prior-reviewed-matches",
    "unresolved-cross-team-declaration",
  ].includes(record.resolutionClass),
);
const identityCollisions = decisions.filter(
  (record) => record.resolutionClass === "within-cavaliers-collision",
);
const administrative = decisions.filter(
  (record) => record.resolutionClass === "administrative-followup",
);
const recentHolds = decisions.filter(
  (record) => record.resolutionClass === "recent-provisional-hold",
);
const newCanonical = decisions.filter((record) =>
  ["new-canonical-candidate", "routing-candidate"].includes(record.resolutionClass),
);
const blocked = decisions.filter((record) => record.blockedOrReconciliation);
const archiveReady = decisions.filter((record) => record.archiveImportReady);

const counts = {
  sourceRows: decisions.length,
  standaloneRows: decisions.filter((record) => !record.mergeExclude).length,
  administrativeFollowups: administrative.length,
  directionalRows: decisions.filter((record) => record.outcomeScore !== null).length,
  publicCandidateRows: decisions.filter((record) => record.publicCandidate).length,
  privateNoindexRows: decisions.filter((record) => record.privateNoindexArchive).length,
  insufficientEvidenceRows: decisions.filter((record) => record.insufficientEvidence).length,
  archiveImportReadyRows: archiveReady.length,
  routingRequiredRows: decisions.filter((record) => record.routingRequired).length,
  routingCandidateRows: routingCandidates.length,
  currentMatchedSourceRows: decisions.filter((record) => record.currentCanonicalMatchCount > 0).length,
  priorReviewedExactMatchRows: decisions.filter((record) => record.priorReviewedExactMatchCount > 0).length,
  withinCavaliersCollisionRows: decisions.filter((record) => record.withinCavaliersCollisionCount > 0).length,
  recentProvisionalHoldRows: decisions.filter((record) => record.recentProvisionalHold).length,
  previewBlockerRows: preview.counts.blockerRows,
  phase8BBlockedRowsRetained: decisions.filter(
    (record) => record.phase8BBlocked && record.blockedOrReconciliation,
  ).length,
  phase8CAdditionalHoldRows: decisions.filter(
    (record) => record.phase8CAdditionalHold,
  ).length,
  unresolvedCrossTeamDeclarationRows: decisions.filter(
    (record) =>
      record.resolutionClass === "unresolved-cross-team-declaration",
  ).length,
  preBlockedUnresolvedCrossTeamDeclarationRows: decisions.filter(
    (record) =>
      record.phase8BBlocked &&
      record.resolutionClass === "unresolved-cross-team-declaration",
  ).length,
  additionalUnresolvedCrossTeamDeclarationRows: decisions.filter(
    (record) =>
      record.phase8CAdditionalHold &&
      record.resolutionClass === "unresolved-cross-team-declaration",
  ).length,
  directPackagingCandidateRows: directCandidates.length,
  blockedOrReconciliationRows: blocked.length,
  currentCanonicalReconciliationRows: currentReconciliations.length,
  priorReviewedReconciliationRows: priorReconciliations.length,
  identityCollisionRows: identityCollisions.length,
  newCanonicalCandidateRows: newCanonical.length,
  resolutionClassCounts: countBy(decisions.map((record) => record.resolutionClass)),
  blockerCounts: countBy(decisions.flatMap((record) => record.blockers)),
  nextActionCounts: countBy(decisions.map((record) => record.nextAction)),
};

assert(counts.sourceRows === 204, "Source-row count drifted.");
assert(counts.standaloneRows === 194, "Standalone count drifted.");
assert(counts.administrativeFollowups === 10, "Administrative count drifted.");
assert(counts.directionalRows === 188, "Directional count drifted.");
assert(counts.publicCandidateRows === 77, "Public-candidate count drifted.");
assert(counts.privateNoindexRows === 117, "Private/noindex count drifted.");
assert(counts.insufficientEvidenceRows === 6, "Insufficient-evidence count drifted.");
assert(counts.archiveImportReadyRows === 6, "Archive-import-ready count drifted.");
assert(counts.routingRequiredRows === 24, "Routing-required count drifted.");
assert(counts.currentMatchedSourceRows === 37, "Current-match count drifted.");
assert(counts.priorReviewedExactMatchRows === 31, "Prior-reviewed exact-match count drifted.");
assert(counts.withinCavaliersCollisionRows === 2, "Within-Cavaliers collision count drifted.");
assert(counts.recentProvisionalHoldRows === 6, "Recent provisional hold count drifted.");
assert(counts.previewBlockerRows === 70, "Phase 8B blocker count drifted.");
assert(
  counts.phase8BBlockedRowsRetained === 70,
  "One or more Phase 8B blocker rows escaped the held partition.",
);
assert(
  counts.phase8CAdditionalHoldRows ===
    counts.additionalUnresolvedCrossTeamDeclarationRows,
  "A newly added Phase 8C hold is not an unresolved cross-team declaration.",
);
assert(
  counts.unresolvedCrossTeamDeclarationRows ===
    counts.preBlockedUnresolvedCrossTeamDeclarationRows +
      counts.additionalUnresolvedCrossTeamDeclarationRows,
  "Unresolved cross-team declaration accounting does not close.",
);
assert(
  decisions
    .filter((record) => record.phase8CAdditionalHold)
    .every(
      (record) =>
        record.phase8BBlocked === false &&
        record.resolutionClass === "unresolved-cross-team-declaration" &&
        record.blockers.length === 1 &&
        record.blockers[0] ===
          "declared-prior-reviewed-match-without-exact-identity",
    ),
  "New Phase 8C holds are not limited to clean unresolved cross-team declarations.",
);
assert(
  decisions
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
  "A pre-blocked unresolved declaration lacks its Phase 8B routing blocker.",
);
assert(
  counts.directPackagingCandidateRows <= 134,
  "Direct packaging queue exceeds the 134 Phase 8B-clean rows.",
);
assert(
  counts.blockedOrReconciliationRows >= 70,
  "Blocked/reconciliation queue lost a Phase 8B blocker.",
);
assert(
  counts.directPackagingCandidateRows + counts.blockedOrReconciliationRows === 204,
  "Decision partition does not close.",
);
assert(
  counts.blockedOrReconciliationRows ===
    counts.previewBlockerRows + counts.phase8CAdditionalHoldRows,
  "Held partition does not equal Phase 8B blockers plus explicit Phase 8C additions.",
);
assert(
  decisions.every(
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

const hashes = {
  decisionRecordsSha256: sha256(JSON.stringify(decisions)),
  directCandidatesSha256: sha256(JSON.stringify(directCandidates)),
  routingCandidatesSha256: sha256(JSON.stringify(routingCandidates)),
  currentReconciliationsSha256: sha256(JSON.stringify(currentReconciliations)),
  priorReconciliationsSha256: sha256(JSON.stringify(priorReconciliations)),
  identityCollisionsSha256: sha256(JSON.stringify(identityCollisions)),
  administrativeFollowupsSha256: sha256(JSON.stringify(administrative)),
  recentProvisionalHoldsSha256: sha256(JSON.stringify(recentHolds)),
  newCanonicalCandidatesSha256: sha256(JSON.stringify(newCanonical)),
  blockedAndReconciliationSha256: sha256(JSON.stringify(blocked)),
  archiveImportReadySha256: sha256(JSON.stringify(archiveReady)),
  previewRecordsSha256: preview.hashes.previewRecordsSha256,
  reviewedRecordsSha256: reviewed.recordsSha256,
};

const matrix = {
  result: "PASS",
  phase: "8C",
  mode: "CANONICAL_DECISION_MATRIX_FREEZE",
  sourceTeam: "cleveland-cavaliers",
  counts,
  hashes,
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

const flattened = (records) =>
  records.map((record) => ({
    ...record,
    teams: record.teams.join(" | "),
    partnerTeams: record.partnerTeams.join(" | "),
    currentCanonicalMatchIds: record.currentCanonicalMatchIds.join(" | "),
    priorReviewedExactMatches: record.priorReviewedExactMatches.join(" | "),
    withinCavaliersCollisionIds: record.withinCavaliersCollisionIds.join(" | "),
    declaredPriorReviewedTeams: record.declaredPriorReviewedTeams.join(" | "),
    blockers: record.blockers.join(" | "),
  }));

const headers = [
  "decisionKey","sourceTradeId","sourceRow","tradeDate","canonicalIdentityKey",
  "teams","partnerTeams","declaredTeamCount","mergeExclude","parentTradeId",
  "routingRequired","explicitEdgeReview","verdict","outcomeScore","confidence",
  "tier","contentClass","publishStatus","databaseStatus",
  "databaseImportAuthorized","publicCandidate","privateNoindexArchive",
  "provisional","recentProvisionalHold","currentCanonicalMatchCount",
  "currentCanonicalMatchIds","priorReviewedExactMatchCount",
  "priorReviewedExactMatches","withinCavaliersCollisionCount",
  "withinCavaliersCollisionIds","declaredPriorReviewedMatch",
  "declaredPriorReviewedTeams","insufficientEvidence","archiveImportReady",
  "resolutionClass","blockers","blockerCount","phase8BBlocked",
  "phase8CAdditionalHold","directPackagingCandidate","routingCandidate",
  "blockedOrReconciliation","nextAction","automaticMerge",
  "automaticRoute",
];

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const files = {
  matrix: "cleveland-cavaliers-phase-8c-decision-matrix.json",
  all: "cleveland-cavaliers-phase-8c-all-decisions.csv",
  direct: "cleveland-cavaliers-phase-8c-next-phase-candidates.csv",
  routing: "cleveland-cavaliers-phase-8c-routing-candidates.csv",
  current: "cleveland-cavaliers-phase-8c-current-canonical-reconciliations.csv",
  prior: "cleveland-cavaliers-phase-8c-prior-reviewed-reconciliations.csv",
  identity: "cleveland-cavaliers-phase-8c-identity-collisions.csv",
  administrative: "cleveland-cavaliers-phase-8c-administrative-followups.csv",
  recent: "cleveland-cavaliers-phase-8c-recent-provisional-holds.csv",
  newCanonical: "cleveland-cavaliers-phase-8c-new-canonical-candidates.csv",
  blocked: "cleveland-cavaliers-phase-8c-blocked-and-reconciliation.csv",
  archive: "cleveland-cavaliers-phase-8c-private-archive-ready.csv",
  summary: "cleveland-cavaliers-phase-8c-summary.json",
};

await Promise.all([
  writeFile(path.join(outputDir, files.matrix), JSON.stringify(matrix, null, 2) + "\n"),
  writeFile(path.join(outputDir, files.all), toCsv(flattened(decisions), headers)),
  writeFile(path.join(outputDir, files.direct), toCsv(flattened(directCandidates), headers)),
  writeFile(path.join(outputDir, files.routing), toCsv(flattened(routingCandidates), headers)),
  writeFile(path.join(outputDir, files.current), toCsv(flattened(currentReconciliations), headers)),
  writeFile(path.join(outputDir, files.prior), toCsv(flattened(priorReconciliations), headers)),
  writeFile(path.join(outputDir, files.identity), toCsv(flattened(identityCollisions), headers)),
  writeFile(path.join(outputDir, files.administrative), toCsv(flattened(administrative), headers)),
  writeFile(path.join(outputDir, files.recent), toCsv(flattened(recentHolds), headers)),
  writeFile(path.join(outputDir, files.newCanonical), toCsv(flattened(newCanonical), headers)),
  writeFile(path.join(outputDir, files.blocked), toCsv(flattened(blocked), headers)),
  writeFile(path.join(outputDir, files.archive), toCsv(flattened(archiveReady), headers)),
  writeFile(
    path.join(outputDir, files.summary),
    JSON.stringify({
      result: "PASS",
      phase: "8C",
      counts,
      hashes,
      canonicalImports: 0,
      playerImports: 0,
      teamRegistryWrites: 0,
      relationshipWrites: 0,
      routeDataWrites: 0,
      automaticMerges: 0,
      automaticRoutes: 0,
      publicationAuthorized: false,
    }, null, 2) + "\n",
  ),
]);

console.log(JSON.stringify({
  result: matrix.result,
  phase: matrix.phase,
  mode: matrix.mode,
  counts: matrix.counts,
  hashes: matrix.hashes,
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
