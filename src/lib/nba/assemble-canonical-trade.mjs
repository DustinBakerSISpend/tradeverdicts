import { createHash } from "node:crypto";
import { expandAuditedNbaAssetText } from "./parse-audited-asset-text.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function seasonLabel(tradeDate) {
  const [yearText, monthText] = String(tradeDate).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function makeSourceRecord(submission, sourceFileName, sourceLabel) {
  return {
    submissionId: submission.submissionId,
    batchId: submission.batchId,
    sourceTeam: submission.sourceTeam,
    sourceRowId: submission.sourceRowId,
    sourceFileName,
    sourceLabel,
    receivedAt: "2026-07-23T00:00:00.000Z",
    rawText: submission.rawText,
    rawFields: {
      tradeDate: submission.tradeDate,
      teams: submission.teams,
      partnerTeams: submission.partnerTeams,
      assetsReceived: submission.assetsReceived.map((asset) => asset.displayText),
      assetsSent: submission.assetsSent.map((asset) => asset.displayText),
      relationshipText: submission.relationshipText,
    },
    contentHash: submission.sourceContentHash ?? submission.contentHash,
  };
}

function enrichAsset(asset, {
  assetId,
  direction,
  sourceTeam,
  fromTeam = null,
  toTeam = null,
  possibleFromTeams = [],
  possibleToTeams = [],
  routingStatus,
}) {
  return {
    assetId,
    ...asset,
    direction,
    sourceTeam,
    fromTeam,
    toTeam,
    possibleFromTeams,
    possibleToTeams,
    routingStatus,
    auditStatus: "meta-grok-and-official-source-resolved",
  };
}

function parseSide(texts, context) {
  const parsedAssets = [];
  let ledgerIndex = 0;

  for (const text of texts) {
    const expanded = expandAuditedNbaAssetText(text, {
      legacyMode: true,
      fromTeam: context.fromTeam,
      toTeam: context.toTeam,
      tradeDate: context.tradeDate,
      draftYear: Number(String(context.tradeDate).slice(0, 4)),
      swapContracts: context.swapContracts ?? [],
    });

    for (const parsed of expanded) {
      ledgerIndex += 1;
      parsedAssets.push(enrichAsset(parsed, {
        assetId: `${context.tradeId}-${context.direction}-${String(ledgerIndex).padStart(2, "0")}`,
        direction: context.direction,
        sourceTeam: "washington-wizards",
        fromTeam: context.fromTeam,
        toTeam: context.toTeam,
        possibleFromTeams: context.possibleFromTeams ?? [],
        possibleToTeams: context.possibleToTeams ?? [],
        routingStatus: context.routingStatus,
      }));
    }
  }

  return parsedAssets;
}

export function assembleCanonicalTrades({
  candidates,
  auditRows,
  editorialRecords,
  wizardsPreview,
  lakersPreview,
  auditCsvSha256,
}) {
  const auditById = new Map(auditRows.map((row) => [row["Trade ID"], row]));
  const editorialById = new Map(editorialRecords.map((row) => [row.tradeId, row]));
  const wizardBySubmission = new Map(
    wizardsPreview.normalized.map((row) => [row.submissionId, row]),
  );
  const lakerBySubmission = new Map(
    lakersPreview.normalized.map((row) => [row.submissionId, row]),
  );

  const records = [];
  const issues = [];

  for (const candidate of candidates) {
    const audit = auditById.get(candidate.tradeId);
    const editorial = editorialById.get(candidate.tradeId);
    if (!audit) {
      issues.push(`${candidate.tradeId}: missing audited CSV row.`);
      continue;
    }
    if (!editorial) {
      issues.push(`${candidate.tradeId}: missing canonical editorial record.`);
      continue;
    }

    const washingtonPerspective = candidate.sourcePerspectives.find(
      (perspective) => perspective.sourceTeam === "washington-wizards",
    );
    const wizardSource = washingtonPerspective
      ? wizardBySubmission.get(washingtonPerspective.submissionId)
      : null;

    if (!wizardSource) {
      issues.push(`${candidate.tradeId}: missing Wizards source perspective.`);
      continue;
    }

    const teams = [...candidate.canonicalTeams];
    const washington = "washington-wizards";
    const partnerTeams = teams.filter((team) => team !== washington);
    const isTwoTeam = teams.length === 2;
    const directPartner = isTwoTeam ? partnerTeams[0] : null;

    const receivedTexts = candidate.assets.washingtonReceived.map(clean).filter(Boolean);
    const sentTexts = candidate.assets.washingtonSent.map(clean).filter(Boolean);
    const swapContracts = wizardSource.pickSwapContracts ?? [];

    const receivedAssets = parseSide(receivedTexts, {
      tradeId: candidate.tradeId,
      tradeDate: candidate.canonicalDate,
      direction: "received",
      fromTeam: directPartner,
      toTeam: washington,
      possibleFromTeams: isTwoTeam ? [] : partnerTeams,
      possibleToTeams: [],
      routingStatus: isTwoTeam ? "resolved" : "partially-resolved",
      swapContracts,
    });

    const sentAssets = parseSide(sentTexts, {
      tradeId: candidate.tradeId,
      tradeDate: candidate.canonicalDate,
      direction: "sent",
      fromTeam: washington,
      toTeam: directPartner,
      possibleFromTeams: [],
      possibleToTeams: isTwoTeam ? [] : partnerTeams,
      routingStatus: isTwoTeam ? "resolved" : "unresolved-counterparty",
      swapContracts,
    });

    for (const asset of [...receivedAssets, ...sentAssets]) {
      if (asset.type === "other" || asset.status === "unclassified") {
        issues.push(`${candidate.tradeId}: unclassified audited asset '${asset.displayText}'.`);
      }

      if (
        ["player", "draft_rights"].includes(asset.type) &&
        /[()#]/u.test(asset.playerName ?? "")
      ) {
        issues.push(`${candidate.tradeId}: contaminated player identity '${asset.playerName}'.`);
      }
    }

    const assetsReceived = Object.fromEntries(teams.map((team) => [team, []]));
    assetsReceived[washington] = receivedAssets;
    if (isTwoTeam) assetsReceived[directPartner] = sentAssets;

    const assetsSentByTeam = Object.fromEntries(teams.map((team) => [team, []]));
    assetsSentByTeam[washington] = sentAssets;
    if (isTwoTeam) assetsSentByTeam[directPartner] = receivedAssets;

    const unresolvedAssetRouting = isTwoTeam
      ? []
      : sentAssets.map((asset) => ({
          assetId: asset.assetId,
          displayText: asset.displayText,
          fromTeam: washington,
          possibleToTeams: partnerTeams,
          reason: "The audited Wizards perspective identifies the outgoing asset but not its final non-Washington recipient.",
        }));

    const perspectives = {};
    const sources = [];

    for (const perspective of candidate.sourcePerspectives) {
      const previewRow = perspective.sourceTeam === washington
        ? wizardBySubmission.get(perspective.submissionId)
        : lakerBySubmission.get(perspective.submissionId);

      if (!previewRow) {
        issues.push(`${candidate.tradeId}: missing preview row for ${perspective.submissionId}.`);
        continue;
      }

      const sourceFileName = perspective.sourceTeam === washington
        ? "src/data/nba/raw/wizards-pilot-001.txt"
        : "src/data/nba/raw/lakers-pilot-001.txt";

      sources.push(makeSourceRecord(
        previewRow,
        sourceFileName,
        perspective.sourceTeam === washington
          ? "User-provided Wizards NBA pilot batch"
          : "User-provided Lakers NBA pilot batch",
      ));

      perspectives[perspective.sourceTeam] = perspective.sourceTeam === washington
        ? {
            sourceSubmissionId: perspective.submissionId,
            editorialStatus: "meta-grok-and-official-source-resolved",
            grade: editorial.wizardsGrade,
            verdict: editorial.verdict,
            summary: editorial.summary,
            analysis: editorial.analysis,
            confidence: editorial.confidence,
            reviewStatus: editorial.reviewStatus,
            tradeTier: editorial.tradeTier,
          }
        : {
            sourceSubmissionId: perspective.submissionId,
            editorialStatus: "source-perspective-linked-editorial-pending",
            grade: null,
            verdict: null,
            summary: null,
            analysis: null,
            confidence: null,
            reviewStatus: "unresolved",
            tradeTier: null,
          };
    }

    sources.push({
      sourceType: "editorial_audit",
      sourceFileName: "src/data/nba/audit/wizards-pilot-001-meta-grok-resolved.csv",
      sourceLabel: "Meta/Grok and official-source reconciled Wizards audit",
      contentHash: auditCsvSha256,
      auditStatus: editorial.auditStatus,
    });

    const assetFingerprint = [...receivedAssets, ...sentAssets]
      .map((asset) => `${asset.direction}|${asset.type}|${asset.displayText.toLowerCase()}`)
      .sort()
      .join("||");
    const dateTeamsKey = `${candidate.canonicalDate}|${[...teams].sort().join("|")}`;
    const canonicalKey = `${dateTeamsKey}|${sha256(assetFingerprint).slice(0, 20)}`;
    const id = `nba-trade-${candidate.canonicalDate.replaceAll("-", "")}-${sha256(canonicalKey).slice(0, 12)}`;

    const grades = { [washington]: editorial.wizardsGrade };
    if (isTwoTeam) grades[directPartner] = editorial.partnerGrade;

    records.push({
      id,
      league: "nba",
      slug: editorial.slug,
      tradeDate: candidate.canonicalDate,
      seasonLabel: seasonLabel(candidate.canonicalDate),
      teams,
      sourceTeams: Object.keys(perspectives),
      assetsReceived,
      assetsSentByTeam,
      assetLedger: [...receivedAssets, ...sentAssets],
      unresolvedAssetRouting,
      routingCompleteness: isTwoTeam ? "complete" : "partial-source-perspective",
      summary: editorial.summary,
      verdict: editorial.verdict,
      grades,
      aggregatePartnerGrade: isTwoTeam ? null : editorial.partnerGrade,
      perspectives,
      sources,
      canonicalKey,
      dateTeamsKey,
      publishStatus: "private",
      reviewStatus: "manual-review",
      indexEligible: false,
      adEligible: false,
      createdAt: "2026-07-23T12:00:00.000Z",
      updatedAt: "2026-07-23T12:00:00.000Z",
      candidateAction: candidate.candidateAction,
      candidateId: candidate.candidateId,
      sourceTradeId: candidate.tradeId,
      canonicalDataReady: true,
      publicationReady: false,
      automaticMerge: false,
      canonicalImportPerformed: false,
      auditResolution: candidate.auditResolution,
      auditMetadata: {
        confidence: editorial.confidence,
        sourceReviewStatus: editorial.reviewStatus,
        tradeTier: editorial.tradeTier,
        cleanupNotes: audit["Cleanup Notes"],
        finalAuditNotes: audit["Final Audit / QA Notes"],
      },
    });
  }

  return { records, issues };
}
