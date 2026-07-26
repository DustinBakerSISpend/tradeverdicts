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
  return [...new Set(values.map(clean).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function teamSet(record) {
  const source = clean(record.sourceTeam ?? record.perspectiveTeam);
  const explicit = Array.isArray(record.teams)
    ? record.teams
    : Array.isArray(record.partnerTeams)
      ? [source, ...record.partnerTeams]
      : [];
  return sortedUnique(explicit);
}
function recordDate(record) {
  return clean(record.tradeDate ?? record.date);
}
function recordId(record) {
  return clean(record.sourceTradeId ?? record.tradeId ?? record.id);
}
function keyFor(date, teams) {
  return `${date}|${teams.join("|")}`;
}
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function toCsv(rows, headers) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}
function recordsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.records)) return value.records;
  return [];
}
function indexRecords(records, sourceLabel) {
  const index = new Map();
  for (const record of records) {
    const date = recordDate(record);
    const teams = teamSet(record);
    if (!date || teams.length < 2) continue;
    const key = keyFor(date, teams);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({
      source: sourceLabel,
      recordId: recordId(record),
      date,
      teams,
    });
  }
  return index;
}
function appendIndex(target, source) {
  for (const [key, values] of source.entries()) {
    if (!target.has(key)) target.set(key, []);
    target.get(key).push(...values);
  }
}

const args = parseArgs(process.argv);
for (const required of [
  "reviewed-json",
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
  tradesBytes,
  atlantaBytes,
  bostonBytes,
  brooklynBytes,
  charlotteBytes,
  chicagoBytes,
] = await Promise.all([
  readFile(args["reviewed-json"]),
  readFile(args["trades-json"]),
  readFile(args["atlanta-reviewed-json"]),
  readFile(args["boston-reviewed-json"]),
  readFile(args["brooklyn-reviewed-json"]),
  readFile(args["charlotte-reviewed-json"]),
  readFile(args["chicago-reviewed-json"]),
]);

const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const currentTrades = JSON.parse(tradesBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));
const boston = JSON.parse(bostonBytes.toString("utf8"));
const brooklyn = JSON.parse(brooklynBytes.toString("utf8"));
const charlotte = JSON.parse(charlotteBytes.toString("utf8"));
const chicago = JSON.parse(chicagoBytes.toString("utf8"));

assert(reviewed.result === "PASS" && reviewed.phase === "8A", "Invalid reviewed source.");
assert(Array.isArray(reviewed.records) && reviewed.records.length === 204, "Reviewed-row count drifted.");
assert(Array.isArray(currentTrades), "Canonical store is not an array.");

const currentIndex = indexRecords(currentTrades, "current-canonical");
const priorIndex = new Map();
appendIndex(priorIndex, indexRecords(recordsFrom(atlanta), "atlanta-reviewed"));
appendIndex(priorIndex, indexRecords(recordsFrom(boston), "boston-reviewed"));
appendIndex(priorIndex, indexRecords(recordsFrom(brooklyn), "brooklyn-reviewed"));
appendIndex(priorIndex, indexRecords(recordsFrom(charlotte), "charlotte-reviewed"));
appendIndex(priorIndex, indexRecords(recordsFrom(chicago), "chicago-reviewed"));

const candidates = [];
const crossTeam = [];
const routing = [];

for (const record of reviewed.records) {
  const teams = sortedUnique([record.sourceTeam, ...record.partnerTeams]);
  const dateTeamsKey = keyFor(record.tradeDate, teams);
  const currentMatches = currentIndex.get(dateTeamsKey) ?? [];
  const priorMatches = priorIndex.get(dateTeamsKey) ?? [];

  let candidateAction = "hold-new-canonical-candidate";
  let duplicateGuardStatus = "no-exact-date-team-match";

  if (record.mergeExclude) {
    candidateAction = "hold-merge-with-parent";
    duplicateGuardStatus = "linked-child-or-duplicate";
  } else if (record.publishStatus === "hold-recent-provisional") {
    candidateAction = "hold-recent-provisional";
    duplicateGuardStatus = currentMatches.length > 0
      ? "recent-provisional-with-current-date-team-match"
      : priorMatches.length > 0
        ? "recent-provisional-with-prior-reviewed-match"
        : "recent-provisional-no-exact-match";
  } else if (currentMatches.length === 1) {
    candidateAction = "hold-existing-canonical-review";
    duplicateGuardStatus = "one-exact-current-date-team-match";
  } else if (currentMatches.length > 1) {
    candidateAction = "hold-ambiguous-current-canonical";
    duplicateGuardStatus = "multiple-exact-current-date-team-matches";
  } else if (priorMatches.length > 0) {
    candidateAction = "hold-shared-reviewed-reconciliation";
    duplicateGuardStatus = "prior-reviewed-exact-date-team-match";
  }

  const candidate = {
    sourceTradeId: record.sourceTradeId,
    sourceRow: record.sourceRow,
    tradeDate: record.tradeDate,
    teams: teams.join(" | "),
    partnerTeams: record.partnerTeams.join(" | "),
    declaredTeamCount: record.declaredTeamCount,
    verdict: record.verdict,
    contentClass: record.contentClass,
    publishStatus: record.publishStatus,
    databaseStatus: record.databaseStatus,
    candidateAction,
    duplicateGuardStatus,
    currentCanonicalMatchCount: currentMatches.length,
    currentCanonicalMatchIds: currentMatches.map((match) => match.recordId).join(" | "),
    priorReviewedMatchCount: priorMatches.length,
    priorReviewedMatches: priorMatches
      .map((match) => `${match.source}:${match.recordId}`)
      .join(" | "),
    routingRequired: record.routingRequired,
    explicitEdgeReview: record.explicitEdgeReview,
    provisional: record.provisional,
    databaseImportAuthorized: record.databaseImportAuthorized,
    mergeExclude: record.mergeExclude,
    parentTradeId: record.parentTradeId ?? "",
    automaticMerge: false,
    automaticRoute: false,
  };
  candidates.push(candidate);

  if (
    currentMatches.length > 0 ||
    priorMatches.length > 0 ||
    record.priorReviewedMatch
  ) {
    crossTeam.push({
      sourceTradeId: record.sourceTradeId,
      tradeDate: record.tradeDate,
      teams: teams.join(" | "),
      declaredPriorReviewedTeams: record.priorReviewedTeams.join(" | "),
      currentCanonicalMatches: currentMatches
        .map((match) => match.recordId)
        .join(" | "),
      exactPriorReviewedMatches: priorMatches
        .map((match) => `${match.source}:${match.recordId}`)
        .join(" | "),
      candidateAction,
      automaticMerge: false,
    });
  }

  if (record.routingRequired) {
    routing.push({
      sourceTradeId: record.sourceTradeId,
      tradeDate: record.tradeDate,
      teams: teams.join(" | "),
      partnerTeams: record.partnerTeams.join(" | "),
      declaredTeamCount: record.declaredTeamCount,
      assetsReceived: record.assetsReceived.join(" || "),
      assetsSent: record.assetsSent.join(" || "),
      canonicalRoutingNotes: record.canonicalRoutingNotes,
      routingStatus: "reviewed-cavaliers-facing-edges-frozen",
      automaticRoute: false,
    });
  }
}

assert(candidates.length === 204, "Candidate queue count drifted.");
assert(routing.length === 24, "Routing queue count drifted.");
assert(candidates.filter((record) => record.mergeExclude).length === 10, "Merge queue count drifted.");
assert(candidates.every((record) => record.automaticMerge === false), "Automatic merge was enabled.");
assert(candidates.every((record) => record.automaticRoute === false), "Automatic route was enabled.");
assert(routing.every((record) => record.automaticRoute === false), "Automatic route was enabled in routing queue.");

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const files = {
  candidateQueue: "cleveland-cavaliers-phase-8a-candidate-queue.csv",
  crossTeamPreview: "cleveland-cavaliers-phase-8a-cross-team-match-preview.csv",
  routingQueue: "cleveland-cavaliers-phase-8a-routing-queue.csv",
  previewJson: "cleveland-cavaliers-phase-8a-preview.json",
};

const preview = {
  result: "PASS",
  phase: "8A",
  mode: "REVIEWED_INTAKE_AND_CROSS_TEAM_PREVIEW",
  reviewedRows: reviewed.records.length,
  directionalRows: reviewed.counts.directionalRows,
  publicCandidates: reviewed.counts.publicCandidates,
  privateNoindexArchive: reviewed.counts.privateNoindexArchive,
  mergeExclude: reviewed.counts.mergeExclude,
  routingRequiredRows: routing.length,
  priorReviewedFlagRows: reviewed.counts.priorReviewedMatchRows,
  provisionalRows: reviewed.counts.provisionalRows,
  recentProvisionalHolds: reviewed.counts.recentProvisionalHolds,
  candidateQueueRecords: candidates.length,
  crossTeamPreviewRecords: crossTeam.length,
  currentExactMatchRows: candidates.filter((record) => record.currentCanonicalMatchCount > 0).length,
  priorReviewedExactMatchRows: candidates.filter((record) => record.priorReviewedMatchCount > 0).length,
  actionCounts: Object.fromEntries(
    [...new Set(candidates.map((record) => record.candidateAction))]
      .sort()
      .map((action) => [
        action,
        candidates.filter((record) => record.candidateAction === action).length,
      ]),
  ),
  candidateRecordsSha256: sha256(JSON.stringify(candidates)),
  crossTeamRecordsSha256: sha256(JSON.stringify(crossTeam)),
  routingRecordsSha256: sha256(JSON.stringify(routing)),
  reviewedRecordsSha256: reviewed.recordsSha256,
  canonicalStoreSha256: sha256(tradesBytes),
  outputFiles: files,
  canonicalStoreWrites: 0,
  playerStoreWrites: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
};

await Promise.all([
  writeFile(
    path.join(outputDir, files.candidateQueue),
    toCsv(candidates, [
      "sourceTradeId", "sourceRow", "tradeDate", "teams", "partnerTeams",
      "declaredTeamCount", "verdict", "contentClass", "publishStatus",
      "databaseStatus", "candidateAction", "duplicateGuardStatus",
      "currentCanonicalMatchCount", "currentCanonicalMatchIds",
      "priorReviewedMatchCount", "priorReviewedMatches", "routingRequired",
      "explicitEdgeReview", "provisional", "databaseImportAuthorized",
      "mergeExclude", "parentTradeId", "automaticMerge", "automaticRoute",
    ]),
  ),
  writeFile(
    path.join(outputDir, files.crossTeamPreview),
    toCsv(crossTeam, [
      "sourceTradeId", "tradeDate", "teams", "declaredPriorReviewedTeams",
      "currentCanonicalMatches", "exactPriorReviewedMatches",
      "candidateAction", "automaticMerge",
    ]),
  ),
  writeFile(
    path.join(outputDir, files.routingQueue),
    toCsv(routing, [
      "sourceTradeId", "tradeDate", "teams", "partnerTeams",
      "declaredTeamCount", "assetsReceived", "assetsSent",
      "canonicalRoutingNotes", "routingStatus", "automaticRoute",
    ]),
  ),
  writeFile(
    path.join(outputDir, files.previewJson),
    JSON.stringify(preview, null, 2) + "\n",
  ),
]);

console.log(JSON.stringify(preview, null, 2));
