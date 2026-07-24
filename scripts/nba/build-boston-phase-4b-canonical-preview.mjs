#!/usr/bin/env node
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

function normalizedTextHash(bytes) {
  const text = Buffer.from(bytes)
    .toString("utf8")
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n");
  return sha256(text);
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

function seasonLabel(tradeDate) {
  const [yearText, monthText] = String(tradeDate).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

const nonStandaloneDispositions = new Set([
  "merge-followup",
  "retain-void-history",
  "exclude-duplicate",
  "hold-conflict",
]);

function sourceAsComparableCanonical(record) {
  const identity = sourcePerspectiveIdentity(record);
  return {
    id: record.tradeId,
    tradeDate: record.tradeDate,
    teams: identity.teams,
    dateTeamsKey: identity.dateTeamsKey,
    directionlessTokens: identity.directionlessTokens,
    transactionFingerprint: identity.transactionFingerprint,
    sourceTradeId: record.tradeId,
  };
}

function parseAssets(record, direction) {
  const texts = direction === "received"
    ? record.assetsReceivedText
    : record.assetsSentText;
  const isTwoTeam = record.partnerTeams.length === 1;
  const directPartner = isTwoTeam ? record.partnerTeams[0] : null;
  const fromTeam = direction === "received" ? directPartner : record.sourceTeam;
  const toTeam = direction === "received" ? record.sourceTeam : directPartner;
  const possibleFromTeams =
    direction === "received" && !isTwoTeam ? record.partnerTeams : [];
  const possibleToTeams =
    direction === "sent" && !isTwoTeam ? record.partnerTeams : [];

  const results = [];
  let index = 0;

  for (const text of texts ?? []) {
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
        routingStatus: isTwoTeam
          ? "resolved"
          : direction === "received"
            ? "partially-resolved"
            : "unresolved-counterparty",
        previewOnly: true,
      });
    }
  }

  return results;
}

const args = parseArgs(process.argv);
for (const required of [
  "reviewed-json",
  "trades-json",
  "atlanta-reviewed-json",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}`);
}

const [reviewedBytes, tradesBytes, atlantaBytes] = await Promise.all([
  readFile(args["reviewed-json"]),
  readFile(args["trades-json"]),
  readFile(args["atlanta-reviewed-json"]),
]);

const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const canonicalTrades = JSON.parse(tradesBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));

assert(
  reviewed.batchId === "boston-celtics-phase-4a",
  `Unexpected Boston batch ID ${reviewed.batchId}`,
);
assert(
  reviewed.records.length === 223,
  `Expected 223 Boston reviewed rows, found ${reviewed.records.length}`,
);
assert(
  atlanta.batchId === "atlanta-hawks-phase-3a",
  `Unexpected Atlanta batch ID ${atlanta.batchId}`,
);
assert(
  atlanta.records.length === 308,
  `Expected 308 Atlanta reviewed rows, found ${atlanta.records.length}`,
);
assert(
  Array.isArray(canonicalTrades) && canonicalTrades.length === 256,
  `Expected 256 canonical trades, found ${canonicalTrades.length}`,
);

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const canonicalIdentities = canonicalTrades.map((trade) => ({
  trade,
  identity: canonicalTradeIdentity(trade),
}));

const atlantaComparables = atlanta.records.map((record) => ({
  record,
  identity: sourceAsComparableCanonical(record),
}));

const standaloneInput = reviewed.records.filter(
  (record) => !nonStandaloneDispositions.has(record.canonicalDisposition),
);
const withinBatchPairs = buildWithinBatchDuplicateAudit(standaloneInput);
const withinBatchByTrade = new Map();

for (const pair of withinBatchPairs) {
  for (const tradeId of [pair.leftTradeId, pair.rightTradeId]) {
    if (!withinBatchByTrade.has(tradeId)) withinBatchByTrade.set(tradeId, []);
    withinBatchByTrade.get(tradeId).push(pair);
  }
}

const records = [];
const currentMatchMatrix = [];
const atlantaMatchMatrix = [];
const blockerRows = [];
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
    if (asset.type === "other" || asset.status === "unclassified") {
      unclassifiedAssetCount += 1;
    }
  }

  const currentComparisons = canonicalIdentities
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

  const atlantaComparisons = atlantaComparables
    .map(({ record: atlantaRecord, identity }) => ({
      atlantaSourceTradeId: atlantaRecord.tradeId,
      atlantaTradeDate: atlantaRecord.tradeDate,
      atlantaTeams: identity.teams,
      atlantaCanonicalDisposition: atlantaRecord.canonicalDisposition,
      ...compareSourceToCanonical(sourceIdentity, identity),
    }))
    .filter((comparison) => comparison.classification !== "no-match")
    .sort((left, right) =>
      right.similarity - left.similarity ||
      Math.abs(left.deltaDays ?? 9999) - Math.abs(right.deltaDays ?? 9999) ||
      left.atlantaSourceTradeId.localeCompare(right.atlantaSourceTradeId)
    );

  const currentSemantic = currentComparisons.filter(
    (comparison) => comparison.classification === "semantic-existing-match",
  );
  const currentDateVariants = currentComparisons.filter(
    (comparison) => comparison.classification === "probable-date-variant",
  );
  const currentDateTeamCollisions = currentComparisons.filter(
    (comparison) => comparison.classification === "date-team-collision",
  );

  const atlantaSemantic = atlantaComparisons.filter(
    (comparison) => comparison.classification === "semantic-existing-match",
  );
  const atlantaExactDateTeam = atlantaComparisons.filter(
    (comparison) =>
      comparison.exactDate === true && comparison.exactTeams === true,
  );
  const atlantaDateVariants = atlantaComparisons.filter(
    (comparison) => comparison.classification === "probable-date-variant",
  );

  const blockers = [];
  let candidateAction = "create-new-canonical-preview";
  let duplicateGuardStatus = "clear-new-candidate";
  let existingCanonicalMatch = null;
  let atlantaSourceMatch = null;

  if (nonStandaloneDispositions.has(record.canonicalDisposition)) {
    candidateAction = "exclude-from-standalone-canonical-preview";
    duplicateGuardStatus = record.canonicalDisposition;
    blockers.push(record.canonicalAction || record.canonicalDisposition);
  } else if (currentSemantic.length === 1) {
    candidateAction = "add-boston-perspective-to-existing-canonical-preview";
    duplicateGuardStatus = "unique-existing-canonical-semantic-match";
    existingCanonicalMatch = currentSemantic[0].canonicalTradeId;
  } else if (currentSemantic.length > 1) {
    candidateAction = "hold-for-ambiguous-existing-canonical-match";
    duplicateGuardStatus = "ambiguous-existing-canonical-semantic-match";
    blockers.push(
      `Multiple canonical trades satisfy the semantic threshold: ${
        currentSemantic.map((item) => item.canonicalTradeId).join(", ")
      }`,
    );
  } else if (currentDateVariants.length > 0) {
    candidateAction = "hold-for-existing-date-reconciliation";
    duplicateGuardStatus = "probable-existing-date-variant";
    existingCanonicalMatch = currentDateVariants[0].canonicalTradeId;
    blockers.push("A near-date existing canonical candidate requires reconciliation.");
  } else if (currentDateTeamCollisions.length > 0) {
    candidateAction = "hold-for-existing-same-day-collision-review";
    duplicateGuardStatus = "existing-date-team-collision";
    blockers.push(
      "An existing canonical trade has the same date and team set but different semantic assets.",
    );
  } else if (atlantaSemantic.length === 1) {
    candidateAction = "hold-for-shared-atlanta-reviewed-resolution";
    duplicateGuardStatus = "unique-atlanta-reviewed-semantic-match";
    atlantaSourceMatch = atlantaSemantic[0].atlantaSourceTradeId;
    blockers.push(
      "The same transaction exists in the Atlanta reviewed batch and must share one canonical identity.",
    );
  } else if (atlantaSemantic.length > 1) {
    candidateAction = "hold-for-ambiguous-atlanta-reviewed-match";
    duplicateGuardStatus = "ambiguous-atlanta-reviewed-semantic-match";
    blockers.push(
      `Multiple Atlanta rows satisfy the semantic threshold: ${
        atlantaSemantic.map((item) => item.atlantaSourceTradeId).join(", ")
      }`,
    );
  } else if (atlantaExactDateTeam.length > 0) {
    candidateAction = "hold-for-atlanta-source-reconciliation";
    duplicateGuardStatus = "atlanta-reviewed-date-team-collision";
    atlantaSourceMatch =
      atlantaExactDateTeam.length === 1
        ? atlantaExactDateTeam[0].atlantaSourceTradeId
        : null;
    blockers.push(
      "The Atlanta reviewed batch contains the same date/team transaction, but semantic assets require reconciliation.",
    );
  } else if (atlantaDateVariants.length > 0) {
    candidateAction = "hold-for-atlanta-date-reconciliation";
    duplicateGuardStatus = "probable-atlanta-reviewed-date-variant";
    atlantaSourceMatch = atlantaDateVariants[0].atlantaSourceTradeId;
    blockers.push(
      "A near-date Atlanta reviewed transaction requires cross-team reconciliation.",
    );
  } else if (record.canonicalDisposition === "new-candidate-evidence-hold") {
    candidateAction = "hold-new-canonical-evidence";
    duplicateGuardStatus = "evidence-hold";
    blockers.push("Missing or unresolved consideration must be verified.");
  } else if (record.canonicalDisposition === "new-candidate-routing-hold") {
    candidateAction = "hold-new-canonical-routing";
    duplicateGuardStatus = "multi-team-routing-hold";
    blockers.push("Explicit team-by-team asset routing is required.");
  } else if (record.canonicalDisposition === "new-candidate-provisional") {
    candidateAction = "hold-new-canonical-provisional";
    duplicateGuardStatus = "recent-outcome-provisional-hold";
    blockers.push("The recent transaction remains provisional.");
  }

  const batchPairs = withinBatchByTrade.get(record.tradeId) ?? [];
  const dangerousBatchPairs = batchPairs.filter((pair) => [
    "exact-source-perspective-duplicate",
    "probable-same-day-duplicate",
    "probable-date-variant",
  ].includes(pair.classification));

  if (
    dangerousBatchPairs.length > 0 &&
    !nonStandaloneDispositions.has(record.canonicalDisposition)
  ) {
    candidateAction = "hold-for-within-boston-duplicate-review";
    duplicateGuardStatus = "within-boston-duplicate-risk";
    blockers.push(
      `Within-Boston duplicate risk: ${
        dangerousBatchPairs
          .map(
            (pair) =>
              `${pair.classification}:${pair.leftTradeId}/${pair.rightTradeId}`,
          )
          .join(" | ")
      }`,
    );
  }

  const unclassifiedAssets = assetLedger.filter(
    (asset) => asset.type === "other" || asset.status === "unclassified",
  );

  if (
    unclassifiedAssets.length > 0 &&
    candidateAction === "create-new-canonical-preview"
  ) {
    candidateAction = "hold-new-canonical-parser";
    duplicateGuardStatus = "unclassified-asset-hold";
    blockers.push(
      `${unclassifiedAssets.length} asset ledger entr${
        unclassifiedAssets.length === 1 ? "y is" : "ies are"
      } unclassified.`,
    );
  }

  const canonicalCreateReady =
    candidateAction === "create-new-canonical-preview" &&
    unclassifiedAssets.length === 0 &&
    blockers.length === 0;

  const perspectiveReconciliationReady =
    candidateAction === "add-boston-perspective-to-existing-canonical-preview" &&
    unclassifiedAssets.length === 0 &&
    blockers.length === 0;

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
    atlantaSourceMatch,
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
      ...(record.partnerTeams.length === 1
        ? { [record.partnerTeams[0]]: record.partnerAggregateGrade }
        : {}),
    },
    aggregatePartnerGrade:
      record.partnerTeams.length > 1 ? record.partnerAggregateGrade : null,
    confidence: record.confidence,
    reviewStatus: record.reviewStatus,
    publishStatus: "private",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    canonicalCreateReady,
    perspectiveReconciliationReady,
    automaticMerge: false,
    blockers,
    dataQualityFlags: record.dataQualityFlags,
    currentCanonicalComparisons: currentComparisons,
    atlantaReviewedComparisons: atlantaComparisons,
    withinBostonComparisons: batchPairs,
  };

  records.push(preview);

  for (const comparison of currentComparisons) {
    currentMatchMatrix.push({
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
      automaticMerge: false,
    });
  }

  for (const comparison of atlantaComparisons) {
    atlantaMatchMatrix.push({
      sourceTradeId: record.tradeId,
      sourceDate: record.tradeDate,
      sourceTeams: sourceIdentity.teams.join(" | "),
      atlantaSourceTradeId: comparison.atlantaSourceTradeId,
      atlantaDate: comparison.atlantaTradeDate,
      atlantaTeams: comparison.atlantaTeams.join(" | "),
      atlantaCanonicalDisposition: comparison.atlantaCanonicalDisposition,
      classification: comparison.classification,
      deltaDays: comparison.deltaDays,
      similarity: comparison.similarity,
      coreSimilarity: comparison.coreSimilarity,
      automaticMerge: false,
    });
  }

  if (blockers.length > 0) {
    blockerRows.push({
      sourceTradeId: record.tradeId,
      tradeDate: record.tradeDate,
      teams: sourceIdentity.teams.join(" | "),
      candidateAction,
      duplicateGuardStatus,
      existingCanonicalMatch: existingCanonicalMatch ?? "",
      atlantaSourceMatch: atlantaSourceMatch ?? "",
      canonicalDisposition: record.canonicalDisposition,
      blockers: blockers.join(" | "),
    });
  }
}

const standaloneRecords = records.filter(
  (record) =>
    record.candidateAction !== "exclude-from-standalone-canonical-preview",
);

const provisionalIds = standaloneRecords.map(
  (record) => record.provisionalCanonicalId,
);
const duplicateProvisionalIds = provisionalIds.filter(
  (value, index, values) => values.indexOf(value) !== index,
);

const perspectiveKeys = standaloneRecords.map(
  (record) => record.sourcePerspectiveKey,
);
const duplicatePerspectiveKeys = perspectiveKeys.filter(
  (value, index, values) => values.indexOf(value) !== index,
);

assert(
  duplicateProvisionalIds.length === 0,
  `Duplicate provisional canonical IDs: ${
    [...new Set(duplicateProvisionalIds)].join(", ")
  }`,
);
assert(
  duplicatePerspectiveKeys.length === 0,
  `Duplicate Boston perspective keys: ${
    [...new Set(duplicatePerspectiveKeys)].join(", ")
  }`,
);

const currentTargetGroups = new Map();
for (const record of records.filter(
  (item) =>
    item.candidateAction ===
    "add-boston-perspective-to-existing-canonical-preview",
)) {
  if (!currentTargetGroups.has(record.existingCanonicalMatch)) {
    currentTargetGroups.set(record.existingCanonicalMatch, []);
  }
  currentTargetGroups.get(record.existingCanonicalMatch).push(
    record.sourceTradeId,
  );
}

const duplicatePerspectiveTargets = [...currentTargetGroups.entries()]
  .filter(([, sourceTradeIds]) => sourceTradeIds.length > 1)
  .map(([canonicalTradeId, sourceTradeIds]) => ({
    canonicalTradeId,
    sourceTradeIds,
  }));

assert(
  duplicatePerspectiveTargets.length === 0,
  `Multiple Boston rows target one canonical perspective: ${
    JSON.stringify(duplicatePerspectiveTargets)
  }`,
);

const actionCounts = Object.fromEntries(
  [...new Set(records.map((record) => record.candidateAction))]
    .sort()
    .map((action) => [
      action,
      records.filter((record) => record.candidateAction === action).length,
    ]),
);

const guardCounts = Object.fromEntries(
  [...new Set(records.map((record) => record.duplicateGuardStatus))]
    .sort()
    .map((status) => [
      status,
      records.filter((record) => record.duplicateGuardStatus === status).length,
    ]),
);

const atlantaLineageRecords = records.filter(
  (record) => record.canonicalDisposition === "atlanta-overlap-candidate",
);
const atlantaDateTeamOverlapRecords = atlantaLineageRecords.filter(
  (record) =>
    record.atlantaReviewedComparisons.some(
      (comparison) =>
        comparison.exactDate === true && comparison.exactTeams === true,
    ),
);
const unmatchedAtlantaLineageRecords = atlantaLineageRecords.filter(
  (record) =>
    !record.atlantaReviewedComparisons.some(
      (comparison) =>
        comparison.exactDate === true && comparison.exactTeams === true,
    ),
);

assert(
  atlantaLineageRecords.length === 14,
  `Expected 14 Atlanta-lineage flags, found ${atlantaLineageRecords.length}`,
);
assert(
  atlantaDateTeamOverlapRecords.length === 13,
  `Expected 13 exact Atlanta date/team overlaps, found ${
    atlantaDateTeamOverlapRecords.length
  }`,
);
assert(
  unmatchedAtlantaLineageRecords.length === 1 &&
    unmatchedAtlantaLineageRecords[0].sourceTradeId === "BOS-1949-0016",
  `Unexpected unmatched Atlanta-lineage rows: ${
    unmatchedAtlantaLineageRecords.map((record) => record.sourceTradeId).join(", ")
  }`,
);

const unreviewedAtlantaOverlapRisks = records.filter(
  (record) =>
    record.canonicalDisposition !== "atlanta-overlap-candidate" &&
    record.atlantaReviewedComparisons.some(
      (comparison) =>
        comparison.exactDate === true && comparison.exactTeams === true,
    ),
);

assert(
  unreviewedAtlantaOverlapRisks.length === 0,
  `Unreviewed Atlanta overlap risks: ${
    unreviewedAtlantaOverlapRisks.map((record) => record.sourceTradeId).join(", ")
  }`,
);

const counts = {
  sourceRows: records.length,
  standalonePreviewRows: standaloneRecords.length,
  nonStandaloneRows: records.filter(
    (record) =>
      record.candidateAction ===
      "exclude-from-standalone-canonical-preview",
  ).length,
  clearNewCanonicalPreviews: records.filter(
    (record) => record.candidateAction === "create-new-canonical-preview",
  ).length,
  existingCanonicalPerspectiveRecommendations: records.filter(
    (record) =>
      record.candidateAction ===
      "add-boston-perspective-to-existing-canonical-preview",
  ).length,
  sharedAtlantaReviewedHolds: records.filter(
    (record) =>
      record.candidateAction ===
      "hold-for-shared-atlanta-reviewed-resolution",
  ).length,
  atlantaSourceReconciliationHolds: records.filter(
    (record) =>
      record.candidateAction === "hold-for-atlanta-source-reconciliation",
  ).length,
  canonicalCreateReady: records.filter(
    (record) => record.canonicalCreateReady,
  ).length,
  perspectiveReconciliationReady: records.filter(
    (record) => record.perspectiveReconciliationReady,
  ).length,
  canonicalDataBlocked: standaloneRecords.filter(
    (record) =>
      !record.canonicalCreateReady &&
      !record.perspectiveReconciliationReady,
  ).length,
  typedAssetTotal,
  unclassifiedAssetCount,
  currentComparisonRows: currentMatchMatrix.length,
  atlantaComparisonRows: atlantaMatchMatrix.length,
  withinBostonComparisonPairs: withinBatchPairs.length,
  blockerRows: blockerRows.length,
  atlantaLineageFlags: atlantaLineageRecords.length,
  atlantaDateTeamReviewedOverlaps: atlantaDateTeamOverlapRecords.length,
  unmatchedAtlantaLineageRows: unmatchedAtlantaLineageRecords.length,
};

assert(counts.sourceRows === 223, "Boston source-row count changed.");
assert(counts.standalonePreviewRows === 211, "Expected 211 standalone Boston rows.");
assert(counts.nonStandaloneRows === 12, "Expected 12 non-standalone Boston rows.");
assert(
  Object.values(actionCounts).reduce((sum, count) => sum + count, 0) === 223,
  "Candidate-action counts do not account for all Boston rows.",
);

const result = {
  result: "PASS",
  phase: "4B",
  mode: "DUPLICATE_SAFE_BOSTON_CANONICAL_AND_CROSS_TEAM_PREVIEW",
  batchId: reviewed.batchId,
  counts,
  actionCounts,
  duplicateGuardCounts: guardCounts,
  typedAssetCounts,
  unmatchedAtlantaLineageTradeIds: unmatchedAtlantaLineageRecords.map(
    (record) => record.sourceTradeId,
  ),
  duplicatePerspectiveTargets,
  hashes: {
    reviewedBatchSha256: normalizedTextHash(reviewedBytes),
    canonicalStoreSha256: normalizedTextHash(tradesBytes),
    atlantaReviewedBatchSha256: normalizedTextHash(atlantaBytes),
    previewRecordsSha256: sha256(JSON.stringify(records)),
  },
  automaticMerges: 0,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  publicationAuthorized: false,
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
  atlantaSourceMatch: record.atlantaSourceMatch ?? "",
  provisionalCanonicalId: record.provisionalCanonicalId,
  canonicalCreateReady: record.canonicalCreateReady,
  perspectiveReconciliationReady: record.perspectiveReconciliationReady,
  reviewStatus: record.reviewStatus,
  unclassifiedAssetCount: record.unclassifiedAssetCount,
  blockers: record.blockers.join(" | "),
}));

const withinBostonRows = withinBatchPairs.map((pair) => ({
  ...pair,
  teams: pair.teams.join(" | "),
}));

await Promise.all([
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4b-canonical-preview.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4b-candidate-preview.csv"),
    toCsv(candidateRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4b-current-canonical-matches.csv"),
    toCsv(currentMatchMatrix),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4b-atlanta-overlap-matches.csv"),
    toCsv(atlantaMatchMatrix),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4b-within-boston-duplicate-audit.csv"),
    toCsv(withinBostonRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4b-blockers.csv"),
    toCsv(blockerRows),
    "utf8",
  ),
]);

console.log(JSON.stringify({
  result: result.result,
  phase: result.phase,
  counts: result.counts,
  actionCounts: result.actionCounts,
  duplicateGuardCounts: result.duplicateGuardCounts,
  typedAssetCounts: result.typedAssetCounts,
  unmatchedAtlantaLineageTradeIds:
    result.unmatchedAtlantaLineageTradeIds,
  automaticMerges: result.automaticMerges,
  canonicalImports: result.canonicalImports,
  playerImports: result.playerImports,
  relationshipWrites: result.relationshipWrites,
  routeDataWrites: result.routeDataWrites,
  pushPerformed: result.pushPerformed,
  deployPerformed: result.deployPerformed,
}, null, 2));
