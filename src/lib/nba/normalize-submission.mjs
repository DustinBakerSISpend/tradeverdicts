import { parseNbaAssetText } from "./parse-asset-text.mjs";

function sortedUnique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
    .sort();
}

function normalizeDirection(submission, direction) {
  const isReceived = direction === "received";
  const sourceTeam = submission.sourceTeam;
  const partners = submission.partnerTeams;
  const counterpart = partners.length === 1 ? partners[0] : null;
  const sourceLines = isReceived
    ? submission.assetsReceivedText
    : submission.assetsSentText;

  return sourceLines.map((line, index) => {
    const fromTeam = isReceived ? counterpart : sourceTeam;
    const toTeam = isReceived ? sourceTeam : counterpart;
    const parsed = parseNbaAssetText(line, {
      fromTeam,
      toTeam,
      legacyMode: submission.inputFormat === "legacy-team-table-v1",
    });

    return {
      assetIndex: index,
      direction,
      ...parsed,
    };
  });
}

export function normalizeNbaSubmission(submission, teamRegistry) {
  if (!submission || typeof submission !== "object") {
    throw new TypeError("Submission must be an object.");
  }

  if (!teamRegistry?.hasSlug(submission.sourceTeam)) {
    throw new Error(`Unknown source team: ${submission.sourceTeam}`);
  }

  for (const partner of submission.partnerTeams) {
    if (!teamRegistry.hasSlug(partner)) {
      throw new Error(`Unknown partner team: ${partner}`);
    }
  }

  const teams = sortedUnique([
    submission.sourceTeam,
    ...submission.partnerTeams,
  ]);

  const warnings = [];
  if (submission.partnerTeams.length > 1) {
    warnings.push(
      "Multi-team asset counterparties were left null unless explicitly resolvable.",
    );
  }

  const assetsReceived = normalizeDirection(submission, "received");
  const assetsSent = normalizeDirection(submission, "sent");

  for (const asset of [...assetsReceived, ...assetsSent]) {
    if (asset.status === "unclassified") {
      warnings.push(`Unclassified asset preserved: ${asset.displayText}`);
    }
  }

  return {
    normalizationVersion: 2,
    submissionId: submission.submissionId,
    sourceTeam: submission.sourceTeam,
    sourceRowId: submission.sourceRowId,
    tradeDate: submission.tradeDate,
    teams,
    partnerTeams: [...submission.partnerTeams],
    assetsReceived,
    assetsSent,
    sourceTeamGrade: submission.sourceTeamGrade,
    sourceTeamVerdict: submission.sourceTeamVerdict,
    neutralSummary: submission.neutralSummary,
    sourceReference: submission.sourceReference,
    uncertaintyNotes: submission.uncertaintyNotes,
    relatedKnownTradeId: submission.relatedKnownTradeId || null,
    sourceContentHash: submission.contentHash,
    contentHash: submission.contentHash,
    dateTeamsKey: `${submission.tradeDate}|${teams.join("|")}`,
    warnings: [...new Set(warnings)],
    reviewDecision: submission.reviewDecision ?? null,
    reviewStatus: "unresolved",
    publishStatus: "private",
    indexEligible: false,
    adEligible: false,
  };
}
