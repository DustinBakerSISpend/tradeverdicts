#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expandAuditedNbaAssetText } from "../../src/lib/nba/parse-audited-asset-text.mjs";
import {
  buildWithinBatchDuplicateAudit,
  canonicalTradeIdentity,
  compareSourceToCanonical,
  provisionalCanonicalIdentity,
  sha256,
  sourcePerspectiveIdentity,
} from "../../src/lib/nba/canonical-transaction-identity.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key}`);
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

function normalizedTextHash(bytes) {
  const text = Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  return sha256(text);
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csv(row[header])).join(","))].join("\r\n") + "\r\n";
}

function seasonLabel(tradeDate) {
  const [yearText, monthText] = String(tradeDate).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function parseAssets(record, direction) {
  const texts = direction === "received" ? record.assetsReceivedText : record.assetsSentText;
  const isTwoTeam = record.partnerTeams.length === 1;
  const directPartner = isTwoTeam ? record.partnerTeams[0] : null;
  const fromTeam = direction === "received" ? directPartner : record.sourceTeam;
  const toTeam = direction === "received" ? record.sourceTeam : directPartner;
  const possibleFromTeams = direction === "received" && !isTwoTeam ? record.partnerTeams : [];
  const possibleToTeams = direction === "sent" && !isTwoTeam ? record.partnerTeams : [];
  const results = [];
  let index = 0;

  for (const text of texts) {
    let expanded;
    try {
      expanded = expandAuditedNbaAssetText(text, {
        legacyMode: true,
        tradeDate: record.tradeDate,
        draftYear: Number(record.tradeDate.slice(0, 4)),
        fromTeam,
        toTeam,
        swapContracts: [],
      });
    } catch (error) {
      expanded = [{
        type: "other",
        displayText: text,
        status: "unclassified",
        notes: [`Parser error: ${error.message}`],
      }];
    }

    for (const asset of expanded) {
      index += 1;
      results.push({
        assetId: `${record.tradeId}-${direction}-${String(index).padStart(2, "0")}`,
        ...asset,
        displayText: clean(asset.displayText || text),
        direction,
        sourceTeam: record.sourceTeam,
        fromTeam,
        toTeam,
        possibleFromTeams,
        possibleToTeams,
        routingStatus: isTwoTeam ? "resolved" : direction === "received" ? "partially-resolved" : "unresolved-counterparty",
        previewOnly: true,
      });
    }
  }

  return results;
}

const args = parseArgs(process.argv);
for (const required of ["reviewed-json", "trades-json", "output-dir"]) {
  assert(args[required], `Missing --${required}`);
}

const [reviewedBytes, tradesBytes] = await Promise.all([
  readFile(args["reviewed-json"]),
  readFile(args["trades-json"]),
]);
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const canonicalTrades = JSON.parse(tradesBytes.toString("utf8"));
assert(reviewed.batchId === "atlanta-hawks-phase-3a", `Unexpected batch ID ${reviewed.batchId}`);
assert(reviewed.records.length === 308, `Expected 308 reviewed rows, found ${reviewed.records.length}`);
assert(Array.isArray(canonicalTrades) && canonicalTrades.length === 27, `Expected 27 canonical trades, found ${canonicalTrades.length}`);

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const canonicalIdentities = canonicalTrades.map((trade) => ({
  trade,
  identity: canonicalTradeIdentity(trade),
}));
const canonicalById = new Map(canonicalTrades.map((trade) => [trade.id, trade]));
const withinBatchPairs = buildWithinBatchDuplicateAudit(reviewed.records);
const withinBatchByTrade = new Map();
for (const pair of withinBatchPairs) {
  for (const tradeId of [pair.leftTradeId, pair.rightTradeId]) {
    if (!withinBatchByTrade.has(tradeId)) withinBatchByTrade.set(tradeId, []);
    withinBatchByTrade.get(tradeId).push(pair);
  }
}

const records = [];
const matchMatrix = [];
const duplicateBlockers = [];
const typedAssetCounts = {};
let typedAssetTotal = 0;
let unclassifiedAssetCount = 0;

for (const record of reviewed.records) {
  const sourceIdentity = sourcePerspectiveIdentity(record);
  sourceIdentity.tradeDate = record.tradeDate;
  const provisional = provisionalCanonicalIdentity(record, sourceIdentity);
  const receivedAssets = parseAssets(record, "received");
  const sentAssets = parseAssets(record, "sent");
  const assetLedger = [...receivedAssets, ...sentAssets];

  for (const asset of assetLedger) {
    typedAssetTotal += 1;
    typedAssetCounts[asset.type] = (typedAssetCounts[asset.type] ?? 0) + 1;
    if (asset.type === "other" || asset.status === "unclassified") unclassifiedAssetCount += 1;
  }

  const explicitExistingId = record.existingCanonicalMatch || null;
  const explicitExisting = explicitExistingId ? canonicalById.get(explicitExistingId) : null;
  if (explicitExistingId) assert(explicitExisting, `${record.tradeId}: missing explicit canonical match ${explicitExistingId}`);

  const comparisons = canonicalIdentities
    .map(({ trade, identity }) => ({
      canonicalTradeId: trade.id,
      canonicalTradeDate: trade.tradeDate,
      canonicalTeams: identity.teams,
      ...compareSourceToCanonical(sourceIdentity, identity),
    }))
    .filter((comparison) => comparison.classification !== "no-match")
    .sort((left, right) =>
      right.similarity - left.similarity ||
      Math.abs(left.deltaDays ?? 9999) - Math.abs(right.deltaDays ?? 9999) ||
      left.canonicalTradeId.localeCompare(right.canonicalTradeId)
    );

  const explicitComparison = explicitExistingId
    ? comparisons.find((comparison) => comparison.canonicalTradeId === explicitExistingId)
    : null;
  if (explicitExistingId) {
    assert(explicitComparison, `${record.tradeId}: explicit canonical match did not survive semantic/date/team comparison.`);
    assert(explicitComparison.exactTeams && explicitComparison.exactDate, `${record.tradeId}: explicit match has wrong date or team set.`);
  }

  const semanticMatches = comparisons.filter((comparison) => comparison.classification === "semantic-existing-match");
  const dateVariants = comparisons.filter((comparison) => comparison.classification === "probable-date-variant");
  const dateTeamCollisions = comparisons.filter((comparison) => comparison.classification === "date-team-collision");

  let duplicateGuardStatus = "clear-new-candidate";
  let candidateAction = "create-new-canonical-preview";
  let existingCanonicalMatch = null;
  const blockers = [];

  if (["merge-followup", "exclude-duplicate", "hold-conflict"].includes(record.canonicalDisposition)) {
    duplicateGuardStatus = record.canonicalDisposition;
    candidateAction = "exclude-from-standalone-canonical-preview";
    blockers.push(record.canonicalAction);
  } else if (explicitExistingId) {
    duplicateGuardStatus = "explicit-existing-perspective-match";
    candidateAction = "add-source-perspective-to-existing-canonical";
    existingCanonicalMatch = explicitExistingId;
  } else if (semanticMatches.length === 1) {
    duplicateGuardStatus = "unannounced-existing-semantic-match";
    candidateAction = "hold-for-existing-canonical-reconciliation";
    existingCanonicalMatch = semanticMatches[0].canonicalTradeId;
    blockers.push("A semantic existing-canonical match was found without an explicit reviewed match ID.");
  } else if (semanticMatches.length > 1) {
    duplicateGuardStatus = "ambiguous-existing-semantic-match";
    candidateAction = "hold-for-existing-canonical-reconciliation";
    blockers.push("More than one existing canonical trade satisfies the semantic match threshold.");
  } else if (dateVariants.length > 0) {
    duplicateGuardStatus = "probable-existing-date-variant";
    candidateAction = "hold-for-date-reconciliation";
    existingCanonicalMatch = dateVariants[0].canonicalTradeId;
    blockers.push("Potential existing transaction with a near-date variant requires manual reconciliation.");
  } else if (dateTeamCollisions.length > 0) {
    duplicateGuardStatus = "existing-date-team-collision";
    candidateAction = "hold-for-same-day-collision-review";
    blockers.push("An existing canonical trade has the same date and team set but materially different asset tokens.");
  }

  const batchPairs = withinBatchByTrade.get(record.tradeId) ?? [];
  const dangerousBatchPairs = batchPairs.filter((pair) => [
    "exact-source-perspective-duplicate",
    "probable-same-day-duplicate",
    "probable-date-variant",
  ].includes(pair.classification));
  if (dangerousBatchPairs.length > 0 && !["merge-followup", "exclude-duplicate"].includes(record.canonicalDisposition)) {
    candidateAction = "hold-for-within-batch-duplicate-review";
    duplicateGuardStatus = "within-batch-duplicate-risk";
    blockers.push(`Within-batch duplicate risk: ${dangerousBatchPairs.map((pair) => `${pair.classification}:${pair.leftTradeId}/${pair.rightTradeId}`).join(" | ")}`);
  }

  const isNonStandalone = ["merge-followup", "exclude-duplicate", "hold-conflict"].includes(record.canonicalDisposition);
  const hasEvidenceHold = record.canonicalDisposition === "new-candidate-evidence-hold";
  const hasRoutingHold = record.canonicalDisposition === "new-candidate-routing-hold";
  const unclassifiedAssets = assetLedger.filter((asset) => asset.type === "other" || asset.status === "unclassified");
  const canonicalDataReady = !isNonStandalone && !hasEvidenceHold && !hasRoutingHold && unclassifiedAssets.length === 0 && blockers.length === 0;

  const preview = {
    sourceTradeId: record.tradeId,
    sourceBatchId: reviewed.batchId,
    sourceTeam: record.sourceTeam,
    tradeDate: record.tradeDate,
    seasonLabel: seasonLabel(record.tradeDate),
    teams: sourceIdentity.teams,
    partnerTeams: record.partnerTeams,
    declaredTeamCount: record.declaredTeamCount,
    dateTeamsKey: sourceIdentity.dateTeamsKey,
    sourcePerspectiveKey: sourceIdentity.sourcePerspectiveKey,
    transactionFingerprint: sourceIdentity.transactionFingerprint,
    provisionalCanonicalKey: provisional.canonicalKey,
    provisionalCanonicalId: provisional.provisionalId,
    candidateAction,
    duplicateGuardStatus,
    existingCanonicalMatch,
    canonicalDisposition: record.canonicalDisposition,
    canonicalInstruction: record.canonicalAction,
    assetsReceived: receivedAssets,
    assetsSent: sentAssets,
    assetLedger,
    unclassifiedAssetCount: unclassifiedAssets.length,
    summary: record.summary,
    analysis: record.analysis,
    verdict: record.verdict,
    grades: {
      [record.sourceTeam]: record.sourceTeamGrade,
      ...(record.partnerTeams.length === 1 ? { [record.partnerTeams[0]]: record.partnerAggregateGrade } : {}),
    },
    aggregatePartnerGrade: record.partnerTeams.length > 1 ? record.partnerAggregateGrade : null,
    confidence: record.confidence,
    reviewStatus: record.reviewStatus,
    publishStatus: "private",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    canonicalDataReady,
    automaticMerge: false,
    blockers,
    dataQualityFlags: record.dataQualityFlags,
    existingComparisons: comparisons,
    withinBatchComparisons: batchPairs,
  };
  records.push(preview);

  for (const comparison of comparisons) {
    matchMatrix.push({
      sourceTradeId: record.tradeId,
      sourceDate: record.tradeDate,
      sourceTeams: sourceIdentity.teams.join(" | "),
      canonicalTradeId: comparison.canonicalTradeId,
      canonicalDate: comparison.canonicalTradeDate,
      canonicalTeams: comparison.canonicalTeams.join(" | "),
      classification: comparison.classification,
      deltaDays: comparison.deltaDays,
      similarity: comparison.similarity,
      coreSimilarity: comparison.coreSimilarity,
      explicitReviewedMatch: explicitExistingId === comparison.canonicalTradeId,
      automaticMerge: false,
    });
  }

  if (blockers.length > 0) {
    duplicateBlockers.push({
      sourceTradeId: record.tradeId,
      tradeDate: record.tradeDate,
      teams: sourceIdentity.teams.join(" | "),
      candidateAction,
      duplicateGuardStatus,
      existingCanonicalMatch: existingCanonicalMatch ?? "",
      blockers: blockers.join(" | "),
      canonicalDisposition: record.canonicalDisposition,
    });
  }
}

const standaloneRecords = records.filter((record) => record.candidateAction !== "exclude-from-standalone-canonical-preview");
const canonicalReadyRecords = standaloneRecords.filter((record) => record.canonicalDataReady);
const actionCounts = Object.fromEntries([...new Set(records.map((record) => record.candidateAction))].sort().map((action) => [
  action,
  records.filter((record) => record.candidateAction === action).length,
]));
const guardCounts = Object.fromEntries([...new Set(records.map((record) => record.duplicateGuardStatus))].sort().map((status) => [
  status,
  records.filter((record) => record.duplicateGuardStatus === status).length,
]));

const provisionalIds = standaloneRecords.map((record) => record.provisionalCanonicalId);
const duplicateProvisionalIds = provisionalIds.filter((value, index) => provisionalIds.indexOf(value) !== index);
const duplicatePerspectiveKeys = standaloneRecords
  .map((record) => record.sourcePerspectiveKey)
  .filter((value, index, values) => values.indexOf(value) !== index);

assert(duplicateProvisionalIds.length === 0, `Duplicate provisional canonical IDs: ${[...new Set(duplicateProvisionalIds)].join(", ")}`);
assert(duplicatePerspectiveKeys.length === 0, `Duplicate source perspective keys: ${[...new Set(duplicatePerspectiveKeys)].join(", ")}`);
assert(records.filter((record) => record.duplicateGuardStatus === "explicit-existing-perspective-match").length === 1, "Expected exactly one explicit existing perspective match.");
assert(records.filter((record) => record.candidateAction === "exclude-from-standalone-canonical-preview").length === 9, "Expected exactly nine non-standalone records.");
assert(records.filter((record) => record.candidateAction === "create-new-canonical-preview").length === 298, "Expected exactly 298 clear new canonical previews.");
assert(records.filter((record) => record.duplicateGuardStatus.startsWith("unannounced-existing") || record.duplicateGuardStatus.startsWith("ambiguous-existing") || record.duplicateGuardStatus.startsWith("probable-existing") || record.duplicateGuardStatus === "existing-date-team-collision").length === 0, "Unexpected unreviewed existing-canonical duplicate risk detected.");

const result = {
  result: "PASS",
  phase: "3B",
  mode: "DUPLICATE_SAFE_CANONICAL_CONVERSION_PREVIEW",
  batchId: reviewed.batchId,
  counts: {
    sourceRows: records.length,
    standalonePreviewRows: standaloneRecords.length,
    clearNewCanonicalPreviews: records.filter((record) => record.candidateAction === "create-new-canonical-preview").length,
    existingPerspectiveMatches: records.filter((record) => record.candidateAction === "add-source-perspective-to-existing-canonical").length,
    nonStandaloneRows: records.filter((record) => record.candidateAction === "exclude-from-standalone-canonical-preview").length,
    canonicalDataReady: canonicalReadyRecords.length,
    canonicalDataBlocked: standaloneRecords.length - canonicalReadyRecords.length,
    typedAssetTotal,
    unclassifiedAssetCount,
    existingComparisonRows: matchMatrix.length,
    withinBatchComparisonPairs: withinBatchPairs.length,
    blockerRows: duplicateBlockers.length,
  },
  actionCounts,
  duplicateGuardCounts: guardCounts,
  typedAssetCounts,
  hashes: {
    reviewedBatchSha256: normalizedTextHash(reviewedBytes),
    canonicalStoreSha256: normalizedTextHash(tradesBytes),
    previewRecordsSha256: sha256(JSON.stringify(records)),
  },
  automaticMerges: 0,
  canonicalImports: 0,
  playerImports: 0,
  repositoryDataWrites: 0,
  routesCreated: 0,
  pushPerformed: false,
  deployPerformed: false,
  records,
};

const candidateRows = records.map((record) => ({
  sourceTradeId: record.sourceTradeId,
  tradeDate: record.tradeDate,
  teams: record.teams.join(" | "),
  candidateAction: record.candidateAction,
  duplicateGuardStatus: record.duplicateGuardStatus,
  existingCanonicalMatch: record.existingCanonicalMatch ?? "",
  provisionalCanonicalId: record.provisionalCanonicalId,
  canonicalDataReady: record.canonicalDataReady,
  reviewStatus: record.reviewStatus,
  unclassifiedAssetCount: record.unclassifiedAssetCount,
  blockers: record.blockers.join(" | "),
}));

const withinBatchRows = withinBatchPairs.map((pair) => ({
  ...pair,
  teams: pair.teams.join(" | "),
}));

await Promise.all([
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3b-canonical-preview.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3b-candidate-preview.csv"), toCsv(candidateRows), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3b-existing-match-matrix.csv"), toCsv(matchMatrix), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3b-within-batch-duplicate-audit.csv"), toCsv(withinBatchRows), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3b-blockers.csv"), toCsv(duplicateBlockers), "utf8"),
]);

console.log(JSON.stringify({
  result: result.result,
  phase: result.phase,
  counts: result.counts,
  actionCounts: result.actionCounts,
  duplicateGuardCounts: result.duplicateGuardCounts,
  typedAssetCounts: result.typedAssetCounts,
  automaticMerges: result.automaticMerges,
  canonicalImports: result.canonicalImports,
  repositoryDataWrites: result.repositoryDataWrites,
  pushPerformed: result.pushPerformed,
  deployPerformed: result.deployPerformed,
}, null, 2));
