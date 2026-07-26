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
function sortedUnique(values) {
  return [...new Set(values.map(clean).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}
function recordsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.records)) return value.records;
  return [];
}
function recordDate(record) {
  return clean(record.tradeDate ?? record.date);
}
function recordId(record) {
  return clean(record.sourceTradeId ?? record.tradeId ?? record.id);
}
function sourceTeam(record) {
  return clean(record.sourceTeam ?? record.perspectiveTeam);
}
function teamSet(record) {
  if (Array.isArray(record?.teams) && record.teams.length > 0) {
    return sortedUnique(record.teams);
  }
  const source = sourceTeam(record);
  if (Array.isArray(record?.partnerTeams)) {
    return sortedUnique([source, ...record.partnerTeams]);
  }
  return source ? [source] : [];
}
function identityKey(date, teams) {
  return `${date}|${teams.join("|")}`;
}
function canonicalIdProposal(sourceTradeId) {
  return `nba-trade-${clean(sourceTradeId).toLowerCase()}`;
}
function indexRecords(records, sourceLabel) {
  const index = new Map();
  for (const record of records) {
    const date = recordDate(record);
    const teams = teamSet(record);
    if (!date || teams.length < 2) continue;
    const key = identityKey(date, teams);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({
      source: sourceLabel,
      recordId: recordId(record),
      date,
      teams,
    });
  }
  for (const values of index.values()) {
    values.sort((left, right) =>
      `${left.source}|${left.recordId}`.localeCompare(
        `${right.source}|${right.recordId}`,
        "en",
      ),
    );
  }
  return index;
}
function appendIndex(target, source) {
  for (const [key, values] of source.entries()) {
    if (!target.has(key)) target.set(key, []);
    target.get(key).push(...values);
    target.get(key).sort((left, right) =>
      `${left.source}|${left.recordId}`.localeCompare(
        `${right.source}|${right.recordId}`,
        "en",
      ),
    );
  }
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

const args = parseArgs(process.argv);
for (const required of [
  "reviewed-json",
  "phase8a-preview-json",
  "trades-json",
  "atlanta-reviewed-json",
  "boston-reviewed-json",
  "brooklyn-reviewed-json",
  "charlotte-reviewed-json",
  "chicago-reviewed-json",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [
  reviewedBytes,
  phase8APreviewBytes,
  tradesBytes,
  atlantaBytes,
  bostonBytes,
  brooklynBytes,
  charlotteBytes,
  chicagoBytes,
] = await Promise.all([
  readFile(args["reviewed-json"]),
  readFile(args["phase8a-preview-json"]),
  readFile(args["trades-json"]),
  readFile(args["atlanta-reviewed-json"]),
  readFile(args["boston-reviewed-json"]),
  readFile(args["brooklyn-reviewed-json"]),
  readFile(args["charlotte-reviewed-json"]),
  readFile(args["chicago-reviewed-json"]),
]);

const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const phase8A = JSON.parse(phase8APreviewBytes.toString("utf8"));
const currentTrades = JSON.parse(tradesBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));
const boston = JSON.parse(bostonBytes.toString("utf8"));
const brooklyn = JSON.parse(brooklynBytes.toString("utf8"));
const charlotte = JSON.parse(charlotteBytes.toString("utf8"));
const chicago = JSON.parse(chicagoBytes.toString("utf8"));

assert(reviewed.result === "PASS" && reviewed.phase === "8A", "Invalid reviewed source.");
assert(Array.isArray(reviewed.records) && reviewed.records.length === 204, "Reviewed-row count drifted.");
assert(phase8A.result === "PASS" && phase8A.phase === "8A", "Invalid Phase 8A preview.");
assert(phase8A.reviewedRows === 204, "Phase 8A preview row count drifted.");
assert(phase8A.reviewedRecordsSha256 === reviewed.recordsSha256, "Phase 8A reviewed-record hash drifted.");
assert(Array.isArray(currentTrades), "Canonical store is not an array.");

const priorSources = [
  ["atlanta", recordsFrom(atlanta)],
  ["boston", recordsFrom(boston)],
  ["brooklyn", recordsFrom(brooklyn)],
  ["charlotte", recordsFrom(charlotte)],
  ["chicago", recordsFrom(chicago)],
];

const currentIndex = indexRecords(currentTrades, "current-canonical");
const priorIndexes = Object.fromEntries(
  priorSources.map(([label, records]) => [label, indexRecords(records, `${label}-reviewed`)]),
);
const combinedPriorIndex = new Map();
for (const index of Object.values(priorIndexes)) appendIndex(combinedPriorIndex, index);

const reviewedIdentityGroups = new Map();
for (const record of reviewed.records) {
  const date = recordDate(record);
  const teams = teamSet(record);
  const key = identityKey(date, teams);
  if (!reviewedIdentityGroups.has(key)) reviewedIdentityGroups.set(key, []);
  reviewedIdentityGroups.get(key).push(record.sourceTradeId);
}
for (const values of reviewedIdentityGroups.values()) {
  values.sort((left, right) => left.localeCompare(right, "en"));
}

const previewRecords = [];
const currentCanonicalMatches = [];
const overlapRows = {
  atlanta: [],
  boston: [],
  brooklyn: [],
  charlotte: [],
  chicago: [],
};
const withinCavaliers = [];
const routingHolds = [];
const linkedMergeRows = [];
const recentProvisionalHolds = [];
const blockers = [];

const orderedReviewed = [...reviewed.records].sort(
  (left, right) =>
    Number(left.sourceRow) - Number(right.sourceRow) ||
    clean(left.sourceTradeId).localeCompare(clean(right.sourceTradeId), "en"),
);

for (const record of orderedReviewed) {
  const teams = teamSet(record);
  const key = identityKey(record.tradeDate, teams);
  const currentMatches = currentIndex.get(key) ?? [];
  const priorMatches = combinedPriorIndex.get(key) ?? [];
  const withinMembers = (reviewedIdentityGroups.get(key) ?? []).filter(
    (sourceTradeId) => sourceTradeId !== record.sourceTradeId,
  );

  const perPrior = {};
  for (const [label] of priorSources) {
    perPrior[label] = priorIndexes[label].get(key) ?? [];
  }

  const blockerReasons = [];
  if (record.mergeExclude) blockerReasons.push("linked-merge-or-administrative-row");
  if (record.publishStatus === "hold-recent-provisional") {
    blockerReasons.push("recent-provisional-hold");
  }
  if (currentMatches.length === 1) blockerReasons.push("existing-canonical-exact-match");
  if (currentMatches.length > 1) blockerReasons.push("ambiguous-current-canonical");
  if (priorMatches.length === 1) blockerReasons.push("one-prior-reviewed-exact-match");
  if (priorMatches.length > 1) blockerReasons.push("multiple-prior-reviewed-exact-matches");
  if (withinMembers.length > 0) blockerReasons.push("within-cavaliers-date-team-collision");
  if (record.routingRequired) blockerReasons.push("multi-team-routing-required");

  let canonicalAction = "new-canonical-candidate";
  if (record.mergeExclude) {
    canonicalAction = "linked-merge-row";
  } else if (record.publishStatus === "hold-recent-provisional") {
    canonicalAction = "recent-provisional-hold";
  } else if (currentMatches.length > 1) {
    canonicalAction = "ambiguous-current-canonical";
  } else if (currentMatches.length === 1) {
    canonicalAction = "existing-canonical-reconciliation";
  } else if (withinMembers.length > 0) {
    canonicalAction = "within-cavaliers-collision";
  } else if (priorMatches.length > 1) {
    canonicalAction = "multiple-prior-reviewed-matches";
  } else if (priorMatches.length === 1) {
    canonicalAction = "shared-reviewed-candidate";
  } else if (record.routingRequired) {
    canonicalAction = "routing-hold";
  }

  const previewRecord = {
    previewKey: `cleveland-cavaliers:${record.sourceTradeId}`,
    sourceTradeId: record.sourceTradeId,
    sourceRow: record.sourceRow,
    tradeDate: record.tradeDate,
    sourceTeam: record.sourceTeam,
    teams,
    partnerTeams: [...record.partnerTeams],
    declaredTeamCount: record.declaredTeamCount,
    identityKey: key,
    canonicalIdProposal: canonicalIdProposal(record.sourceTradeId),
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
    mergeExclude: record.mergeExclude,
    parentTradeId: record.parentTradeId ?? null,
    routingRequired: record.routingRequired,
    explicitEdgeReview: record.explicitEdgeReview,
    provisional: record.provisional,
    recentProvisionalHold: record.publishStatus === "hold-recent-provisional",
    priorReviewedDeclared: record.priorReviewedMatch,
    priorReviewedDeclaredTeams: [...record.priorReviewedTeams],
    currentCanonicalMatchCount: currentMatches.length,
    currentCanonicalMatchIds: currentMatches.map((match) => match.recordId),
    priorReviewedExactMatchCount: priorMatches.length,
    priorReviewedExactMatches: priorMatches.map(
      (match) => `${match.source}:${match.recordId}`,
    ),
    atlantaMatchCount: perPrior.atlanta.length,
    bostonMatchCount: perPrior.boston.length,
    brooklynMatchCount: perPrior.brooklyn.length,
    charlotteMatchCount: perPrior.charlotte.length,
    chicagoMatchCount: perPrior.chicago.length,
    withinCavaliersCollisionCount: withinMembers.length,
    withinCavaliersCollisionIds: withinMembers,
    canonicalAction,
    blockerReasons,
    blocked: blockerReasons.length > 0,
    automaticMerge: false,
    automaticRoute: false,
    canonicalImport: false,
    playerImport: false,
    relationshipWrite: false,
    routeDataWrite: false,
  };
  previewRecords.push(previewRecord);

  for (const match of currentMatches) {
    currentCanonicalMatches.push({
      sourceTradeId: record.sourceTradeId,
      sourceRow: record.sourceRow,
      tradeDate: record.tradeDate,
      teams: teams.join(" | "),
      canonicalMatchId: match.recordId,
      canonicalAction,
      automaticMerge: false,
    });
  }

  for (const [label] of priorSources) {
    for (const match of perPrior[label]) {
      overlapRows[label].push({
        sourceTradeId: record.sourceTradeId,
        sourceRow: record.sourceRow,
        tradeDate: record.tradeDate,
        teams: teams.join(" | "),
        priorSource: match.source,
        priorRecordId: match.recordId,
        canonicalAction,
        automaticMerge: false,
      });
    }
  }

  if (withinMembers.length > 0) {
    withinCavaliers.push({
      sourceTradeId: record.sourceTradeId,
      sourceRow: record.sourceRow,
      tradeDate: record.tradeDate,
      teams: teams.join(" | "),
      collisionCount: withinMembers.length,
      collisionSourceTradeIds: withinMembers.join(" | "),
      mergeExclude: record.mergeExclude,
      parentTradeId: record.parentTradeId ?? "",
      canonicalAction,
      automaticMerge: false,
    });
  }

  if (record.routingRequired) {
    routingHolds.push({
      sourceTradeId: record.sourceTradeId,
      sourceRow: record.sourceRow,
      tradeDate: record.tradeDate,
      teams: teams.join(" | "),
      declaredTeamCount: record.declaredTeamCount,
      partnerTeams: record.partnerTeams.join(" | "),
      assetsReceived: record.assetsReceived.join(" || "),
      assetsSent: record.assetsSent.join(" || "),
      canonicalRoutingNotes: record.canonicalRoutingNotes,
      explicitEdgeReview: record.explicitEdgeReview,
      canonicalAction,
      automaticRoute: false,
    });
  }

  if (record.mergeExclude) {
    linkedMergeRows.push({
      sourceTradeId: record.sourceTradeId,
      sourceRow: record.sourceRow,
      tradeDate: record.tradeDate,
      teams: teams.join(" | "),
      parentTradeId: record.parentTradeId ?? "",
      verdict: record.verdict,
      databaseStatus: record.databaseStatus,
      canonicalAction,
      automaticMerge: false,
    });
  }

  if (record.publishStatus === "hold-recent-provisional") {
    recentProvisionalHolds.push({
      sourceTradeId: record.sourceTradeId,
      sourceRow: record.sourceRow,
      tradeDate: record.tradeDate,
      teams: teams.join(" | "),
      verdict: record.verdict,
      confidence: record.confidence,
      provisionalRevisitNote: record.provisionalRevisitNote,
      databaseImportAuthorized: record.databaseImportAuthorized,
      canonicalAction,
    });
  }

  if (blockerReasons.length > 0) {
    blockers.push({
      sourceTradeId: record.sourceTradeId,
      sourceRow: record.sourceRow,
      tradeDate: record.tradeDate,
      teams: teams.join(" | "),
      canonicalAction,
      blockerReasons: blockerReasons.join(" | "),
      currentCanonicalMatchCount: currentMatches.length,
      priorReviewedExactMatchCount: priorMatches.length,
      withinCavaliersCollisionCount: withinMembers.length,
      routingRequired: record.routingRequired,
      recentProvisionalHold: record.publishStatus === "hold-recent-provisional",
      mergeExclude: record.mergeExclude,
      automaticMerge: false,
      automaticRoute: false,
    });
  }
}

for (const rows of [
  currentCanonicalMatches,
  ...Object.values(overlapRows),
  withinCavaliers,
  routingHolds,
  linkedMergeRows,
  recentProvisionalHolds,
  blockers,
]) {
  rows.sort(
    (left, right) =>
      Number(left.sourceRow) - Number(right.sourceRow) ||
      clean(left.sourceTradeId).localeCompare(clean(right.sourceTradeId), "en") ||
      JSON.stringify(left).localeCompare(JSON.stringify(right), "en"),
  );
}

const counts = {
  sourceRows: previewRecords.length,
  standalonePreviewRows: previewRecords.filter((record) => !record.mergeExclude).length,
  nonStandaloneRows: previewRecords.filter((record) => record.mergeExclude).length,
  oneTeamRows: previewRecords.filter((record) => record.declaredTeamCount === 1).length,
  twoTeamRows: previewRecords.filter((record) => record.declaredTeamCount === 2).length,
  multiTeamRows: previewRecords.filter((record) => record.declaredTeamCount >= 3).length,
  partnerReferences: previewRecords.reduce(
    (sum, record) => sum + record.partnerTeams.length,
    0,
  ),
  directionalRows: reviewed.counts.directionalRows,
  publicCandidateRows: reviewed.counts.publicCandidates,
  privateNoindexRows: reviewed.counts.privateNoindexArchive,
  mergeExcludeRows: reviewed.counts.mergeExclude,
  routingRequiredRows: reviewed.counts.routingRequiredRows,
  insufficientEvidenceRows: reviewed.counts.insufficientEvidence,
  priorReviewedFlagRows: reviewed.counts.priorReviewedMatchRows,
  provisionalRows: reviewed.counts.provisionalRows,
  recentProvisionalHoldRows: reviewed.counts.recentProvisionalHolds,
  importAuthorizedRows: reviewed.counts.standaloneImportAuthorizedRows,
  currentMatchedSourceRows: previewRecords.filter(
    (record) => record.currentCanonicalMatchCount > 0,
  ).length,
  ambiguousCurrentMatchRows: previewRecords.filter(
    (record) => record.currentCanonicalMatchCount > 1,
  ).length,
  atlantaMatchedSourceRows: previewRecords.filter(
    (record) => record.atlantaMatchCount > 0,
  ).length,
  bostonMatchedSourceRows: previewRecords.filter(
    (record) => record.bostonMatchCount > 0,
  ).length,
  brooklynMatchedSourceRows: previewRecords.filter(
    (record) => record.brooklynMatchCount > 0,
  ).length,
  charlotteMatchedSourceRows: previewRecords.filter(
    (record) => record.charlotteMatchCount > 0,
  ).length,
  chicagoMatchedSourceRows: previewRecords.filter(
    (record) => record.chicagoMatchCount > 0,
  ).length,
  priorReviewedExactMatchRows: previewRecords.filter(
    (record) => record.priorReviewedExactMatchCount > 0,
  ).length,
  withinCavaliersCollisionRows: previewRecords.filter(
    (record) => record.withinCavaliersCollisionCount > 0,
  ).length,
  blockerRows: blockers.length,
  actionCounts: countBy(previewRecords.map((record) => record.canonicalAction)),
  blockerReasonCounts: countBy(
    previewRecords.flatMap((record) => record.blockerReasons),
  ),
};

assert(counts.sourceRows === 204, "Source-row count drifted.");
assert(counts.standalonePreviewRows === 194, "Standalone count drifted.");
assert(counts.nonStandaloneRows === 10, "Non-standalone count drifted.");
assert(counts.oneTeamRows === 0, "One-team count drifted.");
assert(counts.twoTeamRows === 180, "Two-team count drifted.");
assert(counts.multiTeamRows === 24, "Multi-team count drifted.");
assert(counts.partnerReferences === 229, "Partner-reference count drifted.");
assert(counts.directionalRows === 188, "Directional count drifted.");
assert(counts.publicCandidateRows === 77, "Public-candidate count drifted.");
assert(counts.privateNoindexRows === 117, "Private/noindex count drifted.");
assert(counts.mergeExcludeRows === 10, "Merge/exclude count drifted.");
assert(counts.routingRequiredRows === 24, "Routing-required count drifted.");
assert(counts.insufficientEvidenceRows === 6, "Insufficient-evidence count drifted.");
assert(counts.priorReviewedFlagRows === 41, "Prior-reviewed flag count drifted.");
assert(counts.provisionalRows === 7, "Provisional count drifted.");
assert(counts.recentProvisionalHoldRows === 6, "Recent provisional hold count drifted.");
assert(counts.importAuthorizedRows === 188, "Import-authorized count drifted.");
assert(routingHolds.length === 24, "Routing-hold queue count drifted.");
assert(linkedMergeRows.length === 10, "Linked-merge queue count drifted.");
assert(recentProvisionalHolds.length === 6, "Recent provisional queue count drifted.");
assert(
  previewRecords.every(
    (record) =>
      record.automaticMerge === false &&
      record.automaticRoute === false &&
      record.canonicalImport === false &&
      record.playerImport === false &&
      record.relationshipWrite === false &&
      record.routeDataWrite === false,
  ),
  "A preview record enabled a forbidden action.",
);

const hashes = {
  previewRecordsSha256: sha256(JSON.stringify(previewRecords)),
  currentCanonicalMatchesSha256: sha256(JSON.stringify(currentCanonicalMatches)),
  atlantaOverlapSha256: sha256(JSON.stringify(overlapRows.atlanta)),
  bostonOverlapSha256: sha256(JSON.stringify(overlapRows.boston)),
  brooklynOverlapSha256: sha256(JSON.stringify(overlapRows.brooklyn)),
  charlotteOverlapSha256: sha256(JSON.stringify(overlapRows.charlotte)),
  chicagoOverlapSha256: sha256(JSON.stringify(overlapRows.chicago)),
  withinCavaliersSha256: sha256(JSON.stringify(withinCavaliers)),
  routingHoldsSha256: sha256(JSON.stringify(routingHolds)),
  linkedMergeRowsSha256: sha256(JSON.stringify(linkedMergeRows)),
  recentProvisionalHoldsSha256: sha256(JSON.stringify(recentProvisionalHolds)),
  blockersSha256: sha256(JSON.stringify(blockers)),
  reviewedRecordsSha256: reviewed.recordsSha256,
  phase8APreviewFileSha256: sha256(phase8APreviewBytes),
  canonicalStoreSha256: sha256(tradesBytes),
};

const outputFiles = {
  previewJson: "cleveland-cavaliers-phase-8b-canonical-preview.json",
  candidatePreview: "cleveland-cavaliers-phase-8b-candidate-preview.csv",
  currentCanonicalMatches: "cleveland-cavaliers-phase-8b-current-canonical-matches.csv",
  atlantaOverlap: "cleveland-cavaliers-phase-8b-atlanta-overlap-matches.csv",
  bostonOverlap: "cleveland-cavaliers-phase-8b-boston-overlap-matches.csv",
  brooklynOverlap: "cleveland-cavaliers-phase-8b-brooklyn-overlap-matches.csv",
  charlotteOverlap: "cleveland-cavaliers-phase-8b-charlotte-overlap-matches.csv",
  chicagoOverlap: "cleveland-cavaliers-phase-8b-chicago-overlap-matches.csv",
  withinCavaliers: "cleveland-cavaliers-phase-8b-within-cavaliers-duplicate-audit.csv",
  routingHolds: "cleveland-cavaliers-phase-8b-routing-holds.csv",
  linkedMergeRows: "cleveland-cavaliers-phase-8b-linked-merge-rows.csv",
  recentProvisionalHolds: "cleveland-cavaliers-phase-8b-recent-provisional-holds.csv",
  blockers: "cleveland-cavaliers-phase-8b-blockers.csv",
};

const preview = {
  result: "PASS",
  phase: "8B",
  mode: "DETERMINISTIC_DUPLICATE_SAFE_CANONICAL_PREVIEW",
  sourceTeam: "cleveland-cavaliers",
  counts,
  hashes,
  outputFiles,
  previewRecords,
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

const candidateHeaders = [
  "previewKey","sourceTradeId","sourceRow","tradeDate","teams","partnerTeams",
  "declaredTeamCount","identityKey","canonicalIdProposal","verdict","confidence",
  "tier","contentClass","publishStatus","databaseStatus",
  "databaseImportAuthorized","publicCandidate","privateNoindexArchive",
  "mergeExclude","parentTradeId","routingRequired","explicitEdgeReview",
  "provisional","recentProvisionalHold","currentCanonicalMatchCount",
  "currentCanonicalMatchIds","priorReviewedExactMatchCount",
  "priorReviewedExactMatches","withinCavaliersCollisionCount",
  "withinCavaliersCollisionIds","canonicalAction","blockerReasons","blocked",
  "automaticMerge","automaticRoute",
];
const candidateRows = previewRecords.map((record) => ({
  ...record,
  teams: record.teams.join(" | "),
  partnerTeams: record.partnerTeams.join(" | "),
  currentCanonicalMatchIds: record.currentCanonicalMatchIds.join(" | "),
  priorReviewedExactMatches: record.priorReviewedExactMatches.join(" | "),
  withinCavaliersCollisionIds: record.withinCavaliersCollisionIds.join(" | "),
  blockerReasons: record.blockerReasons.join(" | "),
}));

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

await Promise.all([
  writeFile(
    path.join(outputDir, outputFiles.previewJson),
    JSON.stringify(preview, null, 2) + "\n",
  ),
  writeFile(
    path.join(outputDir, outputFiles.candidatePreview),
    toCsv(candidateRows, candidateHeaders),
  ),
  writeFile(
    path.join(outputDir, outputFiles.currentCanonicalMatches),
    toCsv(currentCanonicalMatches, [
      "sourceTradeId","sourceRow","tradeDate","teams","canonicalMatchId",
      "canonicalAction","automaticMerge",
    ]),
  ),
  ...Object.entries(overlapRows).map(([label, rows]) =>
    writeFile(
      path.join(outputDir, outputFiles[`${label}Overlap`]),
      toCsv(rows, [
        "sourceTradeId","sourceRow","tradeDate","teams","priorSource",
        "priorRecordId","canonicalAction","automaticMerge",
      ]),
    ),
  ),
  writeFile(
    path.join(outputDir, outputFiles.withinCavaliers),
    toCsv(withinCavaliers, [
      "sourceTradeId","sourceRow","tradeDate","teams","collisionCount",
      "collisionSourceTradeIds","mergeExclude","parentTradeId",
      "canonicalAction","automaticMerge",
    ]),
  ),
  writeFile(
    path.join(outputDir, outputFiles.routingHolds),
    toCsv(routingHolds, [
      "sourceTradeId","sourceRow","tradeDate","teams","declaredTeamCount",
      "partnerTeams","assetsReceived","assetsSent","canonicalRoutingNotes",
      "explicitEdgeReview","canonicalAction","automaticRoute",
    ]),
  ),
  writeFile(
    path.join(outputDir, outputFiles.linkedMergeRows),
    toCsv(linkedMergeRows, [
      "sourceTradeId","sourceRow","tradeDate","teams","parentTradeId",
      "verdict","databaseStatus","canonicalAction","automaticMerge",
    ]),
  ),
  writeFile(
    path.join(outputDir, outputFiles.recentProvisionalHolds),
    toCsv(recentProvisionalHolds, [
      "sourceTradeId","sourceRow","tradeDate","teams","verdict","confidence",
      "provisionalRevisitNote","databaseImportAuthorized","canonicalAction",
    ]),
  ),
  writeFile(
    path.join(outputDir, outputFiles.blockers),
    toCsv(blockers, [
      "sourceTradeId","sourceRow","tradeDate","teams","canonicalAction",
      "blockerReasons","currentCanonicalMatchCount",
      "priorReviewedExactMatchCount","withinCavaliersCollisionCount",
      "routingRequired","recentProvisionalHold","mergeExclude",
      "automaticMerge","automaticRoute",
    ]),
  ),
]);

console.log(JSON.stringify({
  result: preview.result,
  phase: preview.phase,
  mode: preview.mode,
  counts: preview.counts,
  hashes: preview.hashes,
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
