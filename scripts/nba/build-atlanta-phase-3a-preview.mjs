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

function assert(value, message) {
  if (!value) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const args = parseArgs(process.argv);
for (const required of [
  "reviewed-json",
  "teams-json",
  "lineage-json",
  "trades-json",
  "output-dir",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [reviewedBytes, teamBytes, lineageBytes, tradeBytes] = await Promise.all([
  readFile(args["reviewed-json"]),
  readFile(args["teams-json"]),
  readFile(args["lineage-json"]),
  readFile(args["trades-json"]),
]);
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const resolver = createHistoricalNbaTeamResolver({ teams, lineage });

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const queue = reviewed.records.map((record) => ({
  tradeId: record.tradeId,
  tradeDate: record.tradeDate,
  partnerTeams: record.partnerTeams.join(" | "),
  teamCount: record.declaredTeamCount,
  canonicalDisposition: record.canonicalDisposition,
  existingCanonicalMatch: record.existingCanonicalMatch ?? "",
  sourceTeamGrade: record.sourceTeamGrade,
  partnerAggregateGrade: record.partnerAggregateGrade,
  verdict: record.verdict,
  confidence: record.confidence,
  reviewStatus: record.reviewStatus,
  contentClass: record.contentClass,
  lowValueRisk: record.lowValueRisk,
  publishStatus: record.publishStatus,
  dataQualityFlags: record.dataQualityFlags.join(" | "),
}));

const teamRows = [];
for (const record of reviewed.records) {
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

const candidateHeader = Object.keys(queue[0]);
const candidateCsv = [candidateHeader.join(",")]
  .concat(queue.map((row) => candidateHeader.map((key) => csv(row[key])).join(",")))
  .join("\r\n") + "\r\n";

const teamHeader = Object.keys(teamRows[0]);
const teamCsv = [teamHeader.join(",")]
  .concat(teamRows.map((row) => teamHeader.map((key) => csv(row[key])).join(",")))
  .join("\r\n") + "\r\n";

const exactMatch = reviewed.records.find((record) => record.canonicalDisposition === "existing-perspective");
const canonicalMatch = trades.find((trade) => trade.id === exactMatch?.existingCanonicalMatch) ?? null;

const preview = {
  result: "PASS",
  phase: "3A",
  mode: "REVIEWED_INTAKE_AND_HISTORICAL_TEAM_PREVIEW",
  batchId: reviewed.batchId,
  counts: reviewed.counts,
  verdictCounts: reviewed.verdictCounts,
  reviewStatusCounts: reviewed.reviewStatusCounts,
  canonicalDispositionCounts: reviewed.canonicalDispositionCounts,
  teamResolutionCounts: reviewed.teamResolutionCounts,
  teamRegistry: {
    total: teams.length,
    active: teams.filter((team) => team.active === true).length,
    defunct: teams.filter((team) => team.active === false).length,
  },
  exactExistingPerspectiveMatch: exactMatch ? {
    sourceTradeId: exactMatch.tradeId,
    canonicalTradeId: exactMatch.existingCanonicalMatch,
    canonicalTradeDate: canonicalMatch?.tradeDate ?? null,
    canonicalTeams: canonicalMatch?.teams ?? [],
  } : null,
  hashes: {
    reviewedBatchSha256: sha256(reviewedBytes),
    teamRegistrySha256: sha256(teamBytes),
    lineageRulesSha256: sha256(lineageBytes),
    canonicalStoreSha256: sha256(tradeBytes),
  },
  safety: {
    canonicalStoreWrites: 0,
    playerStoreWrites: 0,
    routeWrites: 0,
    importAuthorized: false,
    publicationAuthorized: false,
    pushPerformed: false,
    previewDeploymentPerformed: false,
    productionDeploymentPerformed: false,
  },
};

const previewPath = path.join(outputDir, "atlanta-hawks-phase-3a-preview.json");
const candidatePath = path.join(outputDir, "atlanta-hawks-phase-3a-candidate-queue.csv");
const teamPath = path.join(outputDir, "atlanta-hawks-phase-3a-team-resolution.csv");
const reportPath = path.join(outputDir, "atlanta-hawks-phase-3a-report.txt");
const manifestPath = path.join(outputDir, "atlanta-hawks-phase-3a-manifest.json");

await writeFile(previewPath, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
await writeFile(candidatePath, candidateCsv, "utf8");
await writeFile(teamPath, teamCsv, "utf8");

const report = [
  "TRADEVERDICTS NBA PHASE 3A — ATLANTA REVIEWED INTAKE PREVIEW",
  "Result: PASS",
  "",
  `Reviewed rows: ${reviewed.counts.rows}`,
  `Two-team rows: ${reviewed.counts.twoTeamRows}`,
  `Multi-team rows: ${reviewed.counts.multiTeamRows}`,
  `New canonical candidates: ${reviewed.counts.newCanonicalCandidates}`,
  `Existing perspective matches: ${reviewed.counts.existingPerspectiveMatches}`,
  `Merge/exclude rows: ${reviewed.counts.mergeOrExclude}`,
  `Insufficient-evidence rows: ${reviewed.counts.insufficientEvidence}`,
  `Public candidates: ${reviewed.counts.publicCandidates}`,
  `Research before public: ${reviewed.counts.researchBeforePublic}`,
  `Private/noindex archive: ${reviewed.counts.privateNoindexArchive}`,
  "",
  `Team registry: ${teams.length} total / ${preview.teamRegistry.active} active / ${preview.teamRegistry.defunct} defunct`,
  `Resolved partner references: ${teamRows.length}`,
  "",
  "Canonical trades written: 0",
  "Players written: 0",
  "Routes written: 0",
  "Push/deploy: NO",
  "",
].join("\r\n");
await writeFile(reportPath, report, "utf8");

const artifactBytes = await Promise.all([
  readFile(previewPath),
  readFile(candidatePath),
  readFile(teamPath),
  readFile(reportPath),
]);
const manifest = {
  result: "PASS",
  phase: "3A",
  artifacts: [
    [previewPath, artifactBytes[0]],
    [candidatePath, artifactBytes[1]],
    [teamPath, artifactBytes[2]],
    [reportPath, artifactBytes[3]],
  ].map(([file, bytes]) => ({
    file: path.basename(file),
    bytes: bytes.length,
    sha256: sha256(bytes),
  })),
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  result: "PASS",
  phase: "3A",
  reviewedRows: reviewed.counts.rows,
  newCanonicalCandidates: reviewed.counts.newCanonicalCandidates,
  existingPerspectiveMatches: reviewed.counts.existingPerspectiveMatches,
  mergeOrExclude: reviewed.counts.mergeOrExclude,
  insufficientEvidence: reviewed.counts.insufficientEvidence,
  registeredTeams: teams.length,
  resolvedPartnerReferences: teamRows.length,
  outputDir,
  previewPath,
  candidatePath,
  teamPath,
  reportPath,
  manifestPath,
  repositoryWrites: false,
  canonicalImports: 0,
  playerImports: 0,
}, null, 2));
