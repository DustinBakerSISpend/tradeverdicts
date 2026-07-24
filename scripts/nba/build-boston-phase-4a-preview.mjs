#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHistoricalNbaTeamResolver } from "../../src/lib/nba/resolve-historical-team.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument near ${key}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function teamKey(date, teams) {
  return `${date}|${[...new Set(teams)].sort().join("|")}`;
}

const args = parseArgs(process.argv);
for (const required of [
  "reviewed-json", "teams-json", "lineage-json", "trades-json",
  "atlanta-reviewed-json", "output-dir",
]) assert(args[required], `Missing --${required}`);

const [reviewedBytes, teamBytes, lineageBytes, tradeBytes, atlantaBytes] =
  await Promise.all([
    readFile(args["reviewed-json"]),
    readFile(args["teams-json"]),
    readFile(args["lineage-json"]),
    readFile(args["trades-json"]),
    readFile(args["atlanta-reviewed-json"]),
  ]);

const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));
const resolver = createHistoricalNbaTeamResolver({ teams, lineage });

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const currentByDateTeams = new Map();
for (const trade of trades) {
  const key = teamKey(trade.tradeDate, trade.teams ?? []);
  if (!currentByDateTeams.has(key)) currentByDateTeams.set(key, []);
  currentByDateTeams.get(key).push(trade);
}

const atlantaByDateTeams = new Map();
for (const record of atlanta.records) {
  const key = teamKey(record.tradeDate, [record.sourceTeam, ...record.partnerTeams]);
  if (!atlantaByDateTeams.has(key)) atlantaByDateTeams.set(key, []);
  atlantaByDateTeams.get(key).push(record);
}

const queue = [];
const matchRows = [];
const teamRows = [];
let currentCandidateRows = 0;
let ambiguousCurrentRows = 0;
let atlantaLineageOverlapRows = 0;
let atlantaExactReviewedMatchRows = 0;
const unmatchedAtlantaLineageTradeIds = [];

for (const record of reviewed.records) {
  const teamsForRecord = [record.sourceTeam, ...record.partnerTeams];
  const key = teamKey(record.tradeDate, teamsForRecord);
  const currentCandidates = currentByDateTeams.get(key) ?? [];
  const atlantaCandidates = atlantaByDateTeams.get(key) ?? [];
  const isNonStandalone = [
    "merge-followup", "retain-void-history", "exclude-duplicate", "hold-conflict",
  ].includes(record.canonicalDisposition);

  if (currentCandidates.length > 0) currentCandidateRows += 1;
  if (currentCandidates.length > 1) ambiguousCurrentRows += 1;

  if (record.canonicalDisposition === "atlanta-overlap-candidate") {
    atlantaLineageOverlapRows += 1;
    if (atlantaCandidates.length > 0) atlantaExactReviewedMatchRows += 1;
    else unmatchedAtlantaLineageTradeIds.push(record.tradeId);
  }

  let previewAction = "new-canonical-preview";
  if (isNonStandalone) previewAction = record.canonicalDisposition;
  else if (currentCandidates.length > 0) previewAction = "potential-existing-canonical";
  else if (
    record.canonicalDisposition === "atlanta-overlap-candidate" &&
    atlantaCandidates.length > 0
  ) previewAction = "shared-atlanta-reviewed-hold";
  else if (record.canonicalDisposition === "atlanta-overlap-candidate") {
    previewAction = "new-canonical-preview-unmatched-atlanta-lineage";
  }
  else if (record.canonicalDisposition !== "new-candidate") previewAction = record.canonicalDisposition;

  queue.push({
    tradeId: record.tradeId,
    tradeDate: record.tradeDate,
    partnerTeams: record.partnerTeams.join(" | "),
    teamCount: record.declaredTeamCount,
    sourceDisposition: record.canonicalDisposition,
    previewAction,
    potentialCanonicalIds: currentCandidates.map((trade) => trade.id).join(" | "),
    potentialAtlantaSourceRows: atlantaCandidates.map((row) => row.tradeId).join(" | "),
    sourceTeamGrade: record.sourceTeamGrade,
    partnerAggregateGrade: record.partnerAggregateGrade,
    verdict: record.verdict,
    confidence: record.confidence,
    reviewStatus: record.reviewStatus,
    publishStatus: record.publishStatus,
    dataQualityFlags: record.dataQualityFlags.join(" | "),
  });

  if (currentCandidates.length > 0 || atlantaCandidates.length > 0) {
    matchRows.push({
      tradeId: record.tradeId,
      tradeDate: record.tradeDate,
      teams: teamsForRecord.join(" | "),
      currentCanonicalCandidates: currentCandidates.map((trade) => trade.id).join(" | "),
      currentCandidateCount: currentCandidates.length,
      atlantaReviewedCandidates: atlantaCandidates.map((row) => row.tradeId).join(" | "),
      atlantaCandidateCount: atlantaCandidates.length,
      automaticMergeAuthorized: false,
    });
  }

  for (let index = 0; index < record.partnerLabels.length; index += 1) {
    const result = resolver.resolve(record.partnerLabels[index], record.tradeDate);
    assert(result.team, `${record.tradeId}: team resolution failed during preview.`);
    teamRows.push({
      tradeId: record.tradeId,
      tradeDate: record.tradeDate,
      sourceLabel: record.partnerLabels[index],
      resolvedTeam: result.team.slug,
      teamName: result.team.name,
      active: result.team.active,
      lineageKind: result.rule?.lineageKind ?? "fallback",
      ruleId: result.rule?.id ?? "",
      resolutionStatus: result.status,
    });
  }
}

assert(atlantaLineageOverlapRows === 14, `Expected 14 Atlanta-lineage overlap flags, found ${atlantaLineageOverlapRows}.`);
assert(atlantaExactReviewedMatchRows === 13, `Expected 13 exact Atlanta reviewed matches, found ${atlantaExactReviewedMatchRows}.`);
assert(
  unmatchedAtlantaLineageTradeIds.length === 1 &&
  unmatchedAtlantaLineageTradeIds[0] === "BOS-1949-0016",
  `Unexpected unmatched Atlanta-lineage rows: ${unmatchedAtlantaLineageTradeIds.join(", ")}`,
);

function toCsv(rows) {
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((key) => csv(row[key])).join(","))].join("\r\n") + "\r\n";
}

const candidatePath = path.join(outputDir, "boston-celtics-phase-4a-candidate-queue.csv");
const matchPath = path.join(outputDir, "boston-celtics-phase-4a-cross-team-match-preview.csv");
const teamPath = path.join(outputDir, "boston-celtics-phase-4a-team-resolution.csv");
const previewPath = path.join(outputDir, "boston-celtics-phase-4a-preview.json");

await writeFile(candidatePath, toCsv(queue), "utf8");
await writeFile(matchPath, toCsv(matchRows.length ? matchRows : [{
  tradeId: "", tradeDate: "", teams: "", currentCanonicalCandidates: "",
  currentCandidateCount: 0, atlantaReviewedCandidates: "", atlantaCandidateCount: 0,
  automaticMergeAuthorized: false,
}]), "utf8");
await writeFile(teamPath, toCsv(teamRows), "utf8");

const preview = {
  result: "PASS",
  phase: "4A",
  mode: "REVIEWED_INTAKE_AND_CROSS_TEAM_MATCH_PREVIEW",
  batchId: reviewed.batchId,
  reviewedRows: reviewed.records.length,
  potentialStandaloneRows: reviewed.records.filter((record) => ![
    "merge-followup", "retain-void-history", "exclude-duplicate", "hold-conflict",
  ].includes(record.canonicalDisposition)).length,
  newCanonicalCandidateFlags: reviewed.counts.newCanonicalCandidateFlags,
  atlantaOverlapCandidates: reviewed.counts.atlantaOverlapCandidates,
  mergeOrExclude: reviewed.counts.mergeOrExclude,
  insufficientEvidence: reviewed.counts.insufficientEvidence,
  registeredTeams: teams.length,
  resolvedPartnerReferences: teamRows.length,
  potentialCurrentCanonicalMatchRows: currentCandidateRows,
  ambiguousCurrentMatchRows: ambiguousCurrentRows,
  atlantaLineageOverlapRows,
  exactAtlantaReviewedMatchRows: atlantaExactReviewedMatchRows,
  unmatchedAtlantaLineageRows: unmatchedAtlantaLineageTradeIds.length,
  unmatchedAtlantaLineageTradeIds,
  automaticMerges: 0,
  canonicalStoreWrites: 0,
  playerStoreWrites: 0,
  routeWrites: 0,
  pushPerformed: false,
  deployPerformed: false,
  hashes: {
    reviewedBatchSha256: sha256(reviewedBytes),
    teamRegistrySha256: sha256(teamBytes),
    lineageRulesSha256: sha256(lineageBytes),
    canonicalStoreSha256: sha256(tradeBytes),
  },
  candidatePath,
  matchPath,
  teamPath,
  previewPath,
};
await writeFile(previewPath, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
console.log(JSON.stringify(preview, null, 2));
