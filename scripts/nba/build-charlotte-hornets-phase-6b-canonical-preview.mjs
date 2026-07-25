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
function splitPipe(value) {
  return String(value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
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
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("Unterminated quoted CSV field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length && rows.at(-1).every((value) => value === "")) rows.pop();
  assert(rows.length > 0, "CSV input is empty.");

  const headers = rows[0];
  assert(new Set(headers).size === headers.length, "CSV headers are duplicated.");

  return rows.slice(1).map((values, rowIndex) => {
    assert(
      values.length === headers.length,
      `CSV row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length}.`,
    );
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}
function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}
function stableRecordHash(records) {
  return sha256(JSON.stringify(records));
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
  "phase6a-preview-json",
  "candidate-csv",
  "cross-team-csv",
  "team-resolution-csv",
  "routing-csv",
  "reviewed-json",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  phase6aBytes,
  candidateBytes,
  crossTeamBytes,
  teamResolutionBytes,
  routingBytes,
  reviewedBytes,
] = await Promise.all([
  readFile(args["phase6a-preview-json"]),
  readFile(args["candidate-csv"]),
  readFile(args["cross-team-csv"]),
  readFile(args["team-resolution-csv"]),
  readFile(args["routing-csv"]),
  readFile(args["reviewed-json"]),
]);

const phase6a = JSON.parse(phase6aBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const candidates = parseCsv(candidateBytes.toString("utf8"));
const crossTeamRows = parseCsv(crossTeamBytes.toString("utf8"));
const teamResolutionRows = parseCsv(teamResolutionBytes.toString("utf8"));
const routingRows = parseCsv(routingBytes.toString("utf8"));

assert(phase6a.result === "PASS", "Phase 6A source preview did not pass.");
assert(phase6a.phase === "6A", "Unexpected source preview phase.");
assert(Array.isArray(reviewed.records), "Charlotte reviewed records are unavailable.");
assert(reviewed.records.length === 125, "Expected 125 reviewed Charlotte rows.");
assert(candidates.length === 125, "Expected 125 Phase 6A candidate rows.");
assert(teamResolutionRows.length === 140, "Expected 140 team-resolution rows.");
assert(routingRows.length === 10, "Expected 10 routing rows.");

const reviewedById = new Map(reviewed.records.map((record) => [record.tradeId, record]));
assert(reviewedById.size === 125, "Duplicate reviewed Charlotte trade IDs.");

const routingIds = new Set(routingRows.map((row) => row.tradeId));
const collisionGroups = new Map();
for (const candidate of candidates) {
  const key = `${candidate.tradeDate}|${candidate.partnerTeams}`;
  if (!collisionGroups.has(key)) collisionGroups.set(key, []);
  collisionGroups.get(key).push(candidate.tradeId);
}
const collisionIdSet = new Set();
const duplicateAuditRows = [];
for (const [identityKey, tradeIds] of [...collisionGroups.entries()].sort()) {
  if (tradeIds.length < 2) continue;
  for (const tradeId of tradeIds) collisionIdSet.add(tradeId);
  duplicateAuditRows.push({
    identityKey,
    tradeIds: tradeIds.join(" | "),
    sourceRowCount: tradeIds.length,
    automaticMergeAuthorized: false,
    auditStatus: "manual-same-date-team-review",
  });
}

const previewRecords = [];
for (const candidate of candidates) {
  const source = reviewedById.get(candidate.tradeId);
  assert(source, `Reviewed record missing for ${candidate.tradeId}.`);

  const currentCandidates = splitPipe(candidate.currentCanonicalCandidates);
  const atlantaCandidates = splitPipe(candidate.atlantaReviewedCandidates);
  const bostonCandidates = splitPipe(candidate.bostonReviewedCandidates);
  const brooklynCandidates = splitPipe(candidate.brooklynReviewedCandidates);
  const priorCandidates = [
    ...atlantaCandidates,
    ...bostonCandidates,
    ...brooklynCandidates,
  ];
  const crossTeamRequired =
    source.canonicalDisposition.includes("overlap-candidate") ||
    Boolean(source.sharedLineage);

  const blockers = [];
  if (source.canonicalDisposition === "merge-followup") {
    blockers.push("non-standalone-followup");
  }
  if (currentCandidates.length > 1) {
    blockers.push("ambiguous-current-canonical");
  }
  if (crossTeamRequired && currentCandidates.length === 0 && priorCandidates.length === 0) {
    blockers.push("cross-team-match-unresolved");
  }
  if (routingIds.has(source.tradeId)) {
    blockers.push("explicit-routing-required");
  }
  if (source.verdict === "Insufficient Evidence") {
    blockers.push("insufficient-evidence");
  }
  if (collisionIdSet.has(source.tradeId)) {
    blockers.push("same-date-team-collision-review");
  }

  let previewAction = "new-canonical-preview";
  if (source.canonicalDisposition === "merge-followup") {
    previewAction = "excluded-non-standalone";
  } else if (currentCandidates.length > 0) {
    previewAction = "potential-existing-canonical";
  } else if (priorCandidates.length > 0) {
    previewAction = "prior-reviewed-match-hold";
  } else if (crossTeamRequired) {
    previewAction = "unresolved-cross-team-hold";
  }

  previewRecords.push({
    tradeId: source.tradeId,
    tradeDate: source.tradeDate,
    sourceTeam: source.sourceTeam,
    partnerTeams: candidate.partnerTeams,
    teamCount: Number(candidate.teamCount),
    sourceDisposition: source.canonicalDisposition,
    previewAction,
    currentCanonicalCandidates: currentCandidates,
    atlantaReviewedCandidates: atlantaCandidates,
    bostonReviewedCandidates: bostonCandidates,
    brooklynReviewedCandidates: brooklynCandidates,
    crossTeamRequired,
    routingRequired: routingIds.has(source.tradeId),
    sameDateTeamCollision: collisionIdSet.has(source.tradeId),
    sourceTeamGrade: source.sourceTeamGrade,
    partnerAggregateGrade: source.partnerAggregateGrade,
    verdict: source.verdict,
    confidence: source.confidence,
    contentClass: source.contentClass,
    lowValueRisk: source.lowValueRisk,
    publishStatus: source.publishStatus,
    blockers,
    automaticMergeAuthorized: false,
    automaticRoutingAuthorized: false,
  });
}

previewRecords.sort((left, right) =>
  left.tradeDate.localeCompare(right.tradeDate) ||
  left.tradeId.localeCompare(right.tradeId)
);

const currentRows = previewRecords
  .filter((record) => record.currentCanonicalCandidates.length > 0)
  .map((record) => ({
    tradeId: record.tradeId,
    tradeDate: record.tradeDate,
    partnerTeams: record.partnerTeams,
    currentCanonicalCandidates: record.currentCanonicalCandidates.join(" | "),
    candidateCount: record.currentCanonicalCandidates.length,
    automaticMergeAuthorized: false,
  }));

function priorRowsFor(field) {
  return previewRecords
    .filter((record) => record[field].length > 0)
    .map((record) => ({
      tradeId: record.tradeId,
      tradeDate: record.tradeDate,
      partnerTeams: record.partnerTeams,
      reviewedCandidates: record[field].join(" | "),
      candidateCount: record[field].length,
      automaticMergeAuthorized: false,
    }));
}

const atlantaRows = priorRowsFor("atlantaReviewedCandidates");
const bostonRows = priorRowsFor("bostonReviewedCandidates");
const brooklynRows = priorRowsFor("brooklynReviewedCandidates");
const blockerRows = previewRecords
  .filter((record) => record.blockers.length > 0)
  .map((record) => ({
    tradeId: record.tradeId,
    tradeDate: record.tradeDate,
    previewAction: record.previewAction,
    blockers: record.blockers.join(" | "),
    currentCanonicalCandidates: record.currentCanonicalCandidates.join(" | "),
    atlantaReviewedCandidates: record.atlantaReviewedCandidates.join(" | "),
    bostonReviewedCandidates: record.bostonReviewedCandidates.join(" | "),
    brooklynReviewedCandidates: record.brooklynReviewedCandidates.join(" | "),
    automaticResolutionAuthorized: false,
  }));

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const outputFiles = {
  previewJson: "charlotte-hornets-phase-6b-canonical-preview.json",
  candidateCsv: "charlotte-hornets-phase-6b-candidate-preview.csv",
  currentCsv: "charlotte-hornets-phase-6b-current-canonical-matches.csv",
  atlantaCsv: "charlotte-hornets-phase-6b-atlanta-overlap-matches.csv",
  bostonCsv: "charlotte-hornets-phase-6b-boston-overlap-matches.csv",
  brooklynCsv: "charlotte-hornets-phase-6b-brooklyn-overlap-matches.csv",
  duplicateCsv: "charlotte-hornets-phase-6b-within-charlotte-duplicate-audit.csv",
  routingCsv: "charlotte-hornets-phase-6b-routing-holds.csv",
  blockersCsv: "charlotte-hornets-phase-6b-blockers.csv",
};

const candidateOutput = previewRecords.map((record) => ({
  tradeId: record.tradeId,
  tradeDate: record.tradeDate,
  partnerTeams: record.partnerTeams,
  teamCount: record.teamCount,
  sourceDisposition: record.sourceDisposition,
  previewAction: record.previewAction,
  currentCanonicalCandidates: record.currentCanonicalCandidates.join(" | "),
  atlantaReviewedCandidates: record.atlantaReviewedCandidates.join(" | "),
  bostonReviewedCandidates: record.bostonReviewedCandidates.join(" | "),
  brooklynReviewedCandidates: record.brooklynReviewedCandidates.join(" | "),
  routingRequired: record.routingRequired,
  sameDateTeamCollision: record.sameDateTeamCollision,
  verdict: record.verdict,
  confidence: record.confidence,
  contentClass: record.contentClass,
  lowValueRisk: record.lowValueRisk,
  blockers: record.blockers.join(" | "),
}));

const counts = {
  sourceRows: previewRecords.length,
  standalonePreviewRows: previewRecords.filter(
    (record) => record.sourceDisposition !== "merge-followup",
  ).length,
  nonStandaloneRows: previewRecords.filter(
    (record) => record.sourceDisposition === "merge-followup",
  ).length,
  twoTeamRows: previewRecords.filter((record) => record.teamCount === 2).length,
  multiTeamRows: previewRecords.filter((record) => record.teamCount > 2).length,
  partnerReferences: teamResolutionRows.length,
  currentMatchedSourceRows: currentRows.length,
  ambiguousCurrentMatchRows: currentRows.filter((row) => row.candidateCount > 1).length,
  atlantaMatchedSourceRows: atlantaRows.length,
  bostonMatchedSourceRows: bostonRows.length,
  brooklynMatchedSourceRows: brooklynRows.length,
  crossTeamRequiredRows: previewRecords.filter((record) => record.crossTeamRequired).length,
  unmatchedCrossTeamRequiredRows: previewRecords.filter(
    (record) =>
      record.crossTeamRequired &&
      record.currentCanonicalCandidates.length === 0 &&
      record.atlantaReviewedCandidates.length === 0 &&
      record.bostonReviewedCandidates.length === 0 &&
      record.brooklynReviewedCandidates.length === 0,
  ).length,
  routingRequiredRows: previewRecords.filter((record) => record.routingRequired).length,
  insufficientEvidenceRows: previewRecords.filter(
    (record) => record.verdict === "Insufficient Evidence",
  ).length,
  sameDateTeamCollisionGroups: duplicateAuditRows.length,
  sameDateTeamCollisionRows: collisionIdSet.size,
  blockerRows: blockerRows.length,
  actionCounts: countBy(previewRecords.map((record) => record.previewAction)),
  dispositionCounts: countBy(previewRecords.map((record) => record.sourceDisposition)),
  contentClassCounts: countBy(previewRecords.map((record) => record.contentClass)),
};

assert(counts.sourceRows === 125, "Phase 6B source-row count drifted.");
assert(counts.standalonePreviewRows === 123, "Phase 6B standalone count drifted.");
assert(counts.nonStandaloneRows === 2, "Phase 6B non-standalone count drifted.");
assert(counts.twoTeamRows === 115, "Phase 6B two-team count drifted.");
assert(counts.multiTeamRows === 10, "Phase 6B multi-team count drifted.");
assert(counts.partnerReferences === 140, "Phase 6B partner-reference count drifted.");
assert(counts.crossTeamRequiredRows === 13, "Phase 6B cross-team requirement drifted.");
assert(counts.routingRequiredRows === 10, "Phase 6B routing count drifted.");
assert(counts.insufficientEvidenceRows === 9, "Phase 6B evidence count drifted.");

const hashes = {
  phase6aPreviewSemanticSha256: sha256(
    JSON.stringify(stablePhase6APreview(phase6a)),
  ),
  phase6aCandidateCsvSha256: sha256(candidateBytes),
  phase6aCrossTeamCsvSha256: sha256(crossTeamBytes),
  phase6aTeamResolutionCsvSha256: sha256(teamResolutionBytes),
  phase6aRoutingCsvSha256: sha256(routingBytes),
  reviewedBatchSha256: sha256(reviewedBytes),
  previewRecordsSha256: stableRecordHash(previewRecords),
};

const preview = {
  result: "PASS",
  phase: "6B",
  mode: "DUPLICATE_SAFE_CANONICAL_PREVIEW",
  batchId: reviewed.batchId,
  counts,
  hashes,
  records: previewRecords,
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

await Promise.all([
  writeFile(
    path.join(outputDir, outputFiles.previewJson),
    JSON.stringify(preview, null, 2) + "\n",
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.candidateCsv),
    toCsv(candidateOutput, Object.keys(candidateOutput[0])),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.currentCsv),
    toCsv(currentRows, [
      "tradeId", "tradeDate", "partnerTeams", "currentCanonicalCandidates",
      "candidateCount", "automaticMergeAuthorized",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.atlantaCsv),
    toCsv(atlantaRows, [
      "tradeId", "tradeDate", "partnerTeams", "reviewedCandidates",
      "candidateCount", "automaticMergeAuthorized",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.bostonCsv),
    toCsv(bostonRows, [
      "tradeId", "tradeDate", "partnerTeams", "reviewedCandidates",
      "candidateCount", "automaticMergeAuthorized",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.brooklynCsv),
    toCsv(brooklynRows, [
      "tradeId", "tradeDate", "partnerTeams", "reviewedCandidates",
      "candidateCount", "automaticMergeAuthorized",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.duplicateCsv),
    toCsv(duplicateAuditRows, [
      "identityKey", "tradeIds", "sourceRowCount",
      "automaticMergeAuthorized", "auditStatus",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.routingCsv),
    toCsv(routingRows, Object.keys(routingRows[0])),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.blockersCsv),
    toCsv(blockerRows, [
      "tradeId", "tradeDate", "previewAction", "blockers",
      "currentCanonicalCandidates", "atlantaReviewedCandidates",
      "bostonReviewedCandidates", "brooklynReviewedCandidates",
      "automaticResolutionAuthorized",
    ]),
    "utf8",
  ),
]);

console.log(JSON.stringify({
  result: preview.result,
  phase: preview.phase,
  mode: preview.mode,
  counts: preview.counts,
  hashes: preview.hashes,
  outputFiles: preview.outputFiles,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
}, null, 2));
