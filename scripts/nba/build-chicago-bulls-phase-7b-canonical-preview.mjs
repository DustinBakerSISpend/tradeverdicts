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
function slug(value) {
  return clean(value)
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/['’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
function teamValue(value) {
  if (typeof value === "string") return slug(value);
  if (!value || typeof value !== "object") return "";
  return slug(
    value.slug ??
      value.id ??
      value.teamId ??
      value.teamSlug ??
      value.abbreviation ??
      value.name,
  );
}
function uniqueSorted(values) {
  return [...new Set(values.map(teamValue).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}
function recordsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.records)) return value.records;
  return [];
}
function recordDate(record) {
  const value =
    record.tradeDate ??
    record.date ??
    record.transactionDate ??
    record.occurredAt ??
    record.completedAt;
  return clean(value).slice(0, 10);
}
function recordId(record) {
  return clean(
    record.sourceTradeId ??
      record.tradeId ??
      record.id ??
      record.canonicalTradeId ??
      record.slug,
  );
}
function perspectiveTeams(record) {
  const value = record?.perspectives;
  if (Array.isArray(value)) {
    return value.flatMap((entry) => [
      entry?.sourceTeam,
      entry?.team,
      entry?.teamId,
      entry?.perspectiveTeam,
    ]);
  }
  if (value && typeof value === "object") {
    const direct = [
      value.sourceTeam,
      value.team,
      value.teamId,
      value.perspectiveTeam,
    ].filter(Boolean);
    if (direct.length) return direct;
    return Object.values(value).flatMap((entry) => {
      if (Array.isArray(entry)) {
        return entry.flatMap((item) => [
          item?.sourceTeam,
          item?.team,
          item?.teamId,
          item?.perspectiveTeam,
        ]);
      }
      return [
        entry?.sourceTeam,
        entry?.team,
        entry?.teamId,
        entry?.perspectiveTeam,
      ];
    });
  }
  return [];
}
function recordTeams(record) {
  const values = [];
  if (Array.isArray(record.teams)) values.push(...record.teams);
  if (Array.isArray(record.partnerTeams)) {
    values.push(record.sourceTeam ?? record.perspectiveTeam, ...record.partnerTeams);
  }
  if (Array.isArray(record.sourceTeams)) values.push(...record.sourceTeams);
  values.push(...perspectiveTeams(record));

  for (const asset of Array.isArray(record.assetLedger) ? record.assetLedger : []) {
    values.push(asset?.fromTeam, asset?.toTeam, asset?.sourceTeam, asset?.destinationTeam);
  }
  if (record.assetsReceived && typeof record.assetsReceived === "object") {
    values.push(...Object.keys(record.assetsReceived));
  }
  if (record.assetsSent && typeof record.assetsSent === "object") {
    values.push(...Object.keys(record.assetsSent));
  }

  return uniqueSorted(values);
}
function identityKey(date, teams) {
  return `${date}|${teams.join("|")}`;
}
function addIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}
function buildIndex(records, source) {
  const index = new Map();
  for (const record of records) {
    const date = recordDate(record);
    const teams = recordTeams(record);
    if (!date || teams.length < 2) continue;
    addIndex(index, identityKey(date, teams), {
      source,
      recordId: recordId(record),
      tradeDate: date,
      teams,
    });
  }
  return index;
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
  "phase7a-preview-json",
  "trades-json",
  "teams-json",
  "lineage-json",
  "atlanta-reviewed-json",
  "boston-reviewed-json",
  "brooklyn-reviewed-json",
  "charlotte-reviewed-json",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [
  reviewedBytes,
  phase7ABytes,
  tradesBytes,
  teamsBytes,
  lineageBytes,
  atlantaBytes,
  bostonBytes,
  brooklynBytes,
  charlotteBytes,
] = await Promise.all([
  readFile(args["reviewed-json"]),
  readFile(args["phase7a-preview-json"]),
  readFile(args["trades-json"]),
  readFile(args["teams-json"]),
  readFile(args["lineage-json"]),
  readFile(args["atlanta-reviewed-json"]),
  readFile(args["boston-reviewed-json"]),
  readFile(args["brooklyn-reviewed-json"]),
  readFile(args["charlotte-reviewed-json"]),
]);

const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const phase7A = JSON.parse(phase7ABytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const teams = JSON.parse(teamsBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const priorBatches = {
  atlanta: JSON.parse(atlantaBytes.toString("utf8")),
  boston: JSON.parse(bostonBytes.toString("utf8")),
  brooklyn: JSON.parse(brooklynBytes.toString("utf8")),
  charlotte: JSON.parse(charlotteBytes.toString("utf8")),
};

assert(reviewed.result === "PASS" && reviewed.phase === "7A", "Invalid Phase 7A reviewed batch.");
assert(Array.isArray(reviewed.records) && reviewed.records.length === 219, "Expected 219 Bulls rows.");
assert(phase7A.result === "PASS" && phase7A.phase === "7A", "Invalid Phase 7A preview.");
assert(phase7A.reviewedRows === 219, "Phase 7A preview row count drifted.");
assert(Array.isArray(trades), "Canonical trade store is not an array.");
assert(Array.isArray(teams), "Team registry is not an array.");
assert(lineage && typeof lineage === "object", "Historical lineage is unavailable.");

const currentIndex = buildIndex(trades, "current-canonical");
const priorIndexes = Object.fromEntries(
  Object.entries(priorBatches).map(([name, batch]) => [
    name,
    buildIndex(recordsFrom(batch), `${name}-reviewed`),
  ]),
);

const withinIndex = new Map();
for (const record of reviewed.records) {
  const key = identityKey(record.tradeDate, uniqueSorted([record.sourceTeam, ...record.partnerTeams]));
  addIndex(withinIndex, key, record.sourceTradeId);
}

const previewRecords = [];
const currentMatches = [];
const overlapRows = {
  atlanta: [],
  boston: [],
  brooklyn: [],
  charlotte: [],
};
const withinDuplicateRows = [];
const routingHolds = [];
const linkedMergeRows = [];
const blockerRows = [];

for (const record of reviewed.records) {
  const explicitTeams = uniqueSorted([record.sourceTeam, ...record.partnerTeams]);
  const key = identityKey(record.tradeDate, explicitTeams);
  const canonicalMatches = currentIndex.get(key) ?? [];
  const priorMatches = Object.fromEntries(
    Object.entries(priorIndexes).map(([name, index]) => [name, index.get(key) ?? []]),
  );
  const allPriorMatches = Object.values(priorMatches).flat();
  const withinMatches = withinIndex.get(key) ?? [];

  let canonicalAction = "hold-new-canonical-candidate";
  let decisionReason = "No exact current or prior-reviewed date/team identity match.";
  if (record.mergeExclude) {
    canonicalAction = "hold-merge-with-parent";
    decisionReason = "Reviewed child, completion, reversal or duplicate row must remain linked to its parent.";
  } else if (canonicalMatches.length > 1) {
    canonicalAction = "hold-ambiguous-current-canonical";
    decisionReason = "Multiple current canonical trades share the exact date/team identity.";
  } else if (canonicalMatches.length === 1) {
    canonicalAction = "hold-existing-canonical-review";
    decisionReason = "Exactly one current canonical trade shares the exact date/team identity.";
  } else if (allPriorMatches.length > 0) {
    canonicalAction = "hold-shared-reviewed-reconciliation";
    decisionReason = "One or more prior reviewed team batches share the exact date/team identity.";
  } else if (withinMatches.length > 1) {
    canonicalAction = "hold-within-bulls-collision-review";
    decisionReason = "Multiple Bulls source rows share the exact date/team identity.";
  }

  const previewRecord = {
    sourceTradeId: record.sourceTradeId,
    sourceRow: record.sourceRow,
    tradeDate: record.tradeDate,
    canonicalIdentityKey: key,
    sourceTeam: record.sourceTeam,
    partnerTeams: record.partnerTeams,
    teams: explicitTeams,
    declaredTeamCount: record.declaredTeamCount,
    standalone: !record.mergeExclude,
    mergeExclude: record.mergeExclude,
    parentTradeId: record.parentTradeId,
    routingRequired: record.routingRequired,
    verdict: record.verdict,
    outcomeScore: record.outcomeScore,
    confidence: record.confidence,
    tier: record.tier,
    contentClass: record.contentClass,
    publishStatus: record.publishStatus,
    databaseStatus: record.databaseStatus,
    databaseImportAuthorized: record.databaseImportAuthorized,
    currentCanonicalMatchCount: canonicalMatches.length,
    currentCanonicalMatchIds: canonicalMatches.map((match) => match.recordId),
    atlantaMatchCount: priorMatches.atlanta.length,
    atlantaMatchIds: priorMatches.atlanta.map((match) => match.recordId),
    bostonMatchCount: priorMatches.boston.length,
    bostonMatchIds: priorMatches.boston.map((match) => match.recordId),
    brooklynMatchCount: priorMatches.brooklyn.length,
    brooklynMatchIds: priorMatches.brooklyn.map((match) => match.recordId),
    charlotteMatchCount: priorMatches.charlotte.length,
    charlotteMatchIds: priorMatches.charlotte.map((match) => match.recordId),
    priorReviewedExactMatchCount: allPriorMatches.length,
    withinBullsIdentityCount: withinMatches.length,
    withinBullsSourceTradeIds: withinMatches,
    canonicalAction,
    decisionReason,
    automaticMerge: false,
    automaticRoute: false,
    canonicalImport: false,
    playerImport: false,
    relationshipWrite: false,
    routeWrite: false,
  };
  previewRecords.push(previewRecord);

  if (canonicalMatches.length > 0) {
    currentMatches.push({
      sourceTradeId: record.sourceTradeId,
      tradeDate: record.tradeDate,
      teams: explicitTeams.join(" | "),
      matchCount: canonicalMatches.length,
      currentCanonicalMatchIds: canonicalMatches.map((match) => match.recordId).join(" | "),
      canonicalAction,
      automaticMerge: false,
    });
  }

  for (const [name, matches] of Object.entries(priorMatches)) {
    if (matches.length === 0) continue;
    overlapRows[name].push({
      sourceTradeId: record.sourceTradeId,
      tradeDate: record.tradeDate,
      teams: explicitTeams.join(" | "),
      declaredPriorReviewedTeams: record.priorReviewedTeams.join(" | "),
      matchCount: matches.length,
      priorReviewedMatchIds: matches.map((match) => match.recordId).join(" | "),
      canonicalAction,
      automaticMerge: false,
    });
  }

  if (withinMatches.length > 1) {
    withinDuplicateRows.push({
      sourceTradeId: record.sourceTradeId,
      tradeDate: record.tradeDate,
      teams: explicitTeams.join(" | "),
      identityCount: withinMatches.length,
      sourceTradeIds: withinMatches.join(" | "),
      mergeExclude: record.mergeExclude,
      parentTradeId: record.parentTradeId ?? "",
      canonicalAction,
    });
  }

  if (record.routingRequired) {
    routingHolds.push({
      sourceTradeId: record.sourceTradeId,
      tradeDate: record.tradeDate,
      teams: explicitTeams.join(" | "),
      declaredTeamCount: record.declaredTeamCount,
      assetsReceived: record.assetsReceived.join(" || "),
      assetsSent: record.assetsSent.join(" || "),
      canonicalRoutingNotes: record.canonicalRoutingNotes,
      routingStatus: "reviewed-bulls-facing-edges-frozen",
      canonicalAction,
      automaticRoute: false,
    });
  }

  if (record.mergeExclude) {
    linkedMergeRows.push({
      sourceTradeId: record.sourceTradeId,
      tradeDate: record.tradeDate,
      parentTradeId: record.parentTradeId ?? "",
      teams: explicitTeams.join(" | "),
      summary: record.summary,
      canonicalAction,
      automaticMerge: false,
    });
  }

  if (
    canonicalAction !== "hold-new-canonical-candidate" ||
    record.routingRequired
  ) {
    blockerRows.push({
      sourceTradeId: record.sourceTradeId,
      tradeDate: record.tradeDate,
      teams: explicitTeams.join(" | "),
      canonicalAction,
      decisionReason,
      currentCanonicalMatchCount: canonicalMatches.length,
      priorReviewedExactMatchCount: allPriorMatches.length,
      withinBullsIdentityCount: withinMatches.length,
      routingRequired: record.routingRequired,
      mergeExclude: record.mergeExclude,
      parentTradeId: record.parentTradeId ?? "",
      automaticMerge: false,
      automaticRoute: false,
    });
  }
}

const counts = {
  sourceRows: previewRecords.length,
  standalonePreviewRows: previewRecords.filter((record) => record.standalone).length,
  nonStandaloneRows: previewRecords.filter((record) => !record.standalone).length,
  oneTeamRows: previewRecords.filter((record) => record.declaredTeamCount === 1).length,
  twoTeamRows: previewRecords.filter((record) => record.declaredTeamCount === 2).length,
  multiTeamRows: previewRecords.filter((record) => record.declaredTeamCount > 2).length,
  partnerReferences: reviewed.records.reduce(
    (sum, record) => sum + record.partnerTeams.length,
    0,
  ),
  directionalRows: previewRecords.filter((record) => record.outcomeScore != null).length,
  publicCandidateRows: previewRecords.filter((record) => record.contentClass === "Public Candidate").length,
  privateNoindexRows: previewRecords.filter((record) => record.contentClass === "Private/Noindex Archive").length,
  mergeExcludeRows: previewRecords.filter((record) => record.mergeExclude).length,
  routingRequiredRows: routingHolds.length,
  insufficientEvidenceRows: previewRecords.filter((record) => record.verdict === "Insufficient Evidence").length,
  priorReviewedFlagRows: reviewed.records.filter((record) => record.priorReviewedMatch).length,
  currentMatchedSourceRows: previewRecords.filter((record) => record.currentCanonicalMatchCount > 0).length,
  ambiguousCurrentMatchRows: previewRecords.filter((record) => record.currentCanonicalMatchCount > 1).length,
  atlantaMatchedSourceRows: overlapRows.atlanta.length,
  bostonMatchedSourceRows: overlapRows.boston.length,
  brooklynMatchedSourceRows: overlapRows.brooklyn.length,
  charlotteMatchedSourceRows: overlapRows.charlotte.length,
  priorReviewedExactMatchRows: previewRecords.filter((record) => record.priorReviewedExactMatchCount > 0).length,
  withinBullsCollisionRows: withinDuplicateRows.length,
  blockerRows: blockerRows.length,
  actionCounts: countBy(previewRecords.map((record) => record.canonicalAction)),
};

assert(counts.sourceRows === 219, "Source-row count drifted.");
assert(counts.standalonePreviewRows === 212, "Standalone-row count drifted.");
assert(counts.nonStandaloneRows === 7, "Non-standalone count drifted.");
assert(counts.oneTeamRows === 3, "One-team row count drifted.");
assert(counts.twoTeamRows === 201, "Two-team row count drifted.");
assert(counts.multiTeamRows === 15, "Multi-team row count drifted.");
assert(counts.partnerReferences === 232, "Partner-reference count drifted.");
assert(counts.directionalRows === 197, "Directional-row count drifted.");
assert(counts.publicCandidateRows === 87, "Public-candidate count drifted.");
assert(counts.privateNoindexRows === 125, "Private/noindex count drifted.");
assert(counts.mergeExcludeRows === 7, "Merge/exclude count drifted.");
assert(counts.routingRequiredRows === 15, "Routing count drifted.");
assert(counts.insufficientEvidenceRows === 15, "Insufficient-evidence count drifted.");
assert(counts.priorReviewedFlagRows === 23, "Prior-reviewed flag count drifted.");
assert(previewRecords.every((record) => record.automaticMerge === false), "Automatic merge enabled.");
assert(previewRecords.every((record) => record.automaticRoute === false), "Automatic route enabled.");

const hashes = {
  previewRecordsSha256: sha256(JSON.stringify(previewRecords)),
  currentMatchRecordsSha256: sha256(JSON.stringify(currentMatches)),
  atlantaOverlapSha256: sha256(JSON.stringify(overlapRows.atlanta)),
  bostonOverlapSha256: sha256(JSON.stringify(overlapRows.boston)),
  brooklynOverlapSha256: sha256(JSON.stringify(overlapRows.brooklyn)),
  charlotteOverlapSha256: sha256(JSON.stringify(overlapRows.charlotte)),
  withinBullsDuplicateSha256: sha256(JSON.stringify(withinDuplicateRows)),
  routingHoldRecordsSha256: sha256(JSON.stringify(routingHolds)),
  linkedMergeRecordsSha256: sha256(JSON.stringify(linkedMergeRows)),
  blockerRecordsSha256: sha256(JSON.stringify(blockerRows)),
};

const outputFiles = {
  previewJson: "chicago-bulls-phase-7b-canonical-preview.json",
  candidatePreview: "chicago-bulls-phase-7b-candidate-preview.csv",
  currentCanonicalMatches: "chicago-bulls-phase-7b-current-canonical-matches.csv",
  atlantaOverlapMatches: "chicago-bulls-phase-7b-atlanta-overlap-matches.csv",
  bostonOverlapMatches: "chicago-bulls-phase-7b-boston-overlap-matches.csv",
  brooklynOverlapMatches: "chicago-bulls-phase-7b-brooklyn-overlap-matches.csv",
  charlotteOverlapMatches: "chicago-bulls-phase-7b-charlotte-overlap-matches.csv",
  withinBullsDuplicateAudit: "chicago-bulls-phase-7b-within-bulls-duplicate-audit.csv",
  routingHolds: "chicago-bulls-phase-7b-routing-holds.csv",
  linkedMergeRows: "chicago-bulls-phase-7b-linked-merge-rows.csv",
  blockers: "chicago-bulls-phase-7b-blockers.csv",
};

const preview = {
  result: "PASS",
  phase: "7B",
  mode: "DUPLICATE_SAFE_CANONICAL_PREVIEW",
  sourceTeam: "chicago-bulls",
  counts,
  hashes,
  sourceHashes: {
    reviewedJsonSha256: sha256(reviewedBytes),
    phase7APreviewSha256: sha256(phase7ABytes),
    canonicalStoreSha256: sha256(tradesBytes),
    teamRegistrySha256: sha256(teamsBytes),
    lineageSha256: sha256(lineageBytes),
    atlantaReviewedSha256: sha256(atlantaBytes),
    bostonReviewedSha256: sha256(bostonBytes),
    brooklynReviewedSha256: sha256(brooklynBytes),
    charlotteReviewedSha256: sha256(charlotteBytes),
  },
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

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const candidateHeaders = [
  "sourceTradeId", "sourceRow", "tradeDate", "canonicalIdentityKey",
  "teams", "declaredTeamCount", "standalone", "routingRequired", "verdict",
  "contentClass", "databaseStatus", "currentCanonicalMatchCount",
  "currentCanonicalMatchIds", "priorReviewedExactMatchCount",
  "withinBullsIdentityCount", "withinBullsSourceTradeIds", "canonicalAction",
  "decisionReason", "automaticMerge", "automaticRoute",
];
const candidateRows = previewRecords.map((record) => ({
  ...record,
  teams: record.teams.join(" | "),
  currentCanonicalMatchIds: record.currentCanonicalMatchIds.join(" | "),
  withinBullsSourceTradeIds: record.withinBullsSourceTradeIds.join(" | "),
}));

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
    toCsv(currentMatches, [
      "sourceTradeId", "tradeDate", "teams", "matchCount",
      "currentCanonicalMatchIds", "canonicalAction", "automaticMerge",
    ]),
  ),
  ...Object.entries(overlapRows).map(([name, rows]) =>
    writeFile(
      path.join(outputDir, outputFiles[`${name}OverlapMatches`]),
      toCsv(rows, [
        "sourceTradeId", "tradeDate", "teams", "declaredPriorReviewedTeams",
        "matchCount", "priorReviewedMatchIds", "canonicalAction", "automaticMerge",
      ]),
    ),
  ),
  writeFile(
    path.join(outputDir, outputFiles.withinBullsDuplicateAudit),
    toCsv(withinDuplicateRows, [
      "sourceTradeId", "tradeDate", "teams", "identityCount",
      "sourceTradeIds", "mergeExclude", "parentTradeId", "canonicalAction",
    ]),
  ),
  writeFile(
    path.join(outputDir, outputFiles.routingHolds),
    toCsv(routingHolds, [
      "sourceTradeId", "tradeDate", "teams", "declaredTeamCount",
      "assetsReceived", "assetsSent", "canonicalRoutingNotes",
      "routingStatus", "canonicalAction", "automaticRoute",
    ]),
  ),
  writeFile(
    path.join(outputDir, outputFiles.linkedMergeRows),
    toCsv(linkedMergeRows, [
      "sourceTradeId", "tradeDate", "parentTradeId", "teams",
      "summary", "canonicalAction", "automaticMerge",
    ]),
  ),
  writeFile(
    path.join(outputDir, outputFiles.blockers),
    toCsv(blockerRows, [
      "sourceTradeId", "tradeDate", "teams", "canonicalAction",
      "decisionReason", "currentCanonicalMatchCount",
      "priorReviewedExactMatchCount", "withinBullsIdentityCount",
      "routingRequired", "mergeExclude", "parentTradeId",
      "automaticMerge", "automaticRoute",
    ]),
  ),
]);

console.log(JSON.stringify({
  result: preview.result,
  phase: preview.phase,
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
