import { createHash } from "node:crypto";

const FIELD_PATTERN = /^([A-Z][A-Z0-9_]*):\s*(.*)$/;

const LIST_FIELDS = new Set([
  "ASSETS_RECEIVED",
  "ASSETS_SENT",
  "PARTNER_TEAMS",
]);

const REQUIRED_FIELDS = [
  "SUBMISSION_ID",
  "SOURCE_TEAM",
  "SOURCE_ROW_ID",
  "TRADE_DATE",
  "PARTNER_TEAMS",
  "ASSETS_RECEIVED",
  "ASSETS_SENT",
  "SOURCE_TEAM_GRADE",
  "SOURCE_TEAM_VERDICT",
  "NEUTRAL_SUMMARY",
  "SOURCE_REFERENCE",
  "UNCERTAINTY_NOTES",
  "RELATED_KNOWN_TRADE_ID",
];

function normalizeLineEndings(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n").trim();
}

function splitBlocks(text) {
  const normalized = normalizeLineEndings(text);
  if (!normalized) {
    return [];
  }

  const starts = [];
  const lines = normalized.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith("SUBMISSION_ID:")) {
      starts.push(index);
    }
  }

  if (starts.length === 0) {
    throw new Error("No SUBMISSION_ID blocks were found.");
  }

  return starts.map((start, position) => {
    const end = starts[position + 1] ?? lines.length;
    return lines.slice(start, end).join("\n").trim();
  });
}

function parseBlock(block) {
  const fields = Object.create(null);
  let currentField = null;

  for (const rawLine of block.split("\n")) {
    const match = rawLine.match(FIELD_PATTERN);

    if (match) {
      currentField = match[1];
      fields[currentField] = match[2].trim();
      continue;
    }

    if (!currentField) {
      if (rawLine.trim()) {
        throw new Error(`Unexpected text before the first field: ${rawLine}`);
      }
      continue;
    }

    const continuation = rawLine.trim();
    if (!continuation) {
      continue;
    }

    fields[currentField] = fields[currentField]
      ? `${fields[currentField]}\n${continuation}`
      : continuation;
  }

  const missing = REQUIRED_FIELDS.filter(
    (field) => !(field in fields),
  );

  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }

  const normalizedFields = {};

  for (const field of REQUIRED_FIELDS) {
    const value = String(fields[field] ?? "").trim();

    if (LIST_FIELDS.has(field)) {
      normalizedFields[field] = value
        .split(/\n|,\s*(?=[a-z0-9-]+$)/i)
        .map((item) => item.replace(/^-\s*/, "").trim())
        .filter(Boolean);
    } else {
      normalizedFields[field] = value;
    }
  }

  return {
    submissionId: normalizedFields.SUBMISSION_ID,
    sourceTeam: normalizedFields.SOURCE_TEAM,
    sourceRowId: normalizedFields.SOURCE_ROW_ID,
    tradeDate: normalizedFields.TRADE_DATE,
    partnerTeams: normalizedFields.PARTNER_TEAMS,
    assetsReceivedText: normalizedFields.ASSETS_RECEIVED,
    assetsSentText: normalizedFields.ASSETS_SENT,
    sourceTeamGrade: normalizedFields.SOURCE_TEAM_GRADE,
    sourceTeamVerdict: normalizedFields.SOURCE_TEAM_VERDICT,
    neutralSummary: normalizedFields.NEUTRAL_SUMMARY,
    sourceReference: normalizedFields.SOURCE_REFERENCE,
    uncertaintyNotes: normalizedFields.UNCERTAINTY_NOTES,
    relatedKnownTradeId: normalizedFields.RELATED_KNOWN_TRADE_ID,
    rawFields: normalizedFields,
    rawText: block,
    contentHash: createHash("sha256").update(block, "utf8").digest("hex"),
  };
}

export function parseNbaTeamIntake(text) {
  const submissions = splitBlocks(text).map(parseBlock);
  const seenIds = new Set();

  for (const submission of submissions) {
    if (!submission.submissionId) {
      throw new Error("Every submission requires SUBMISSION_ID.");
    }

    if (seenIds.has(submission.submissionId)) {
      throw new Error(
        `Duplicate SUBMISSION_ID in intake: ${submission.submissionId}`,
      );
    }

    seenIds.add(submission.submissionId);
  }

  return submissions;
}

export function validateParsedIntake(submissions, teamRegistry) {
  const errors = [];

  for (const [index, submission] of submissions.entries()) {
    const label = submission.submissionId || `row-${index + 1}`;

    if (!teamRegistry.hasSlug(submission.sourceTeam)) {
      errors.push(`${label}: unknown SOURCE_TEAM '${submission.sourceTeam}'.`);
    }

    for (const partnerTeam of submission.partnerTeams) {
      if (!teamRegistry.hasSlug(partnerTeam)) {
        errors.push(`${label}: unknown PARTNER_TEAM '${partnerTeam}'.`);
      }

      if (partnerTeam === submission.sourceTeam) {
        errors.push(`${label}: source team may not also be a partner team.`);
      }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(submission.tradeDate)) {
      errors.push(`${label}: TRADE_DATE must use YYYY-MM-DD.`);
    }

    if (submission.assetsReceivedText.length === 0) {
      errors.push(`${label}: ASSETS_RECEIVED must not be empty.`);
    }

    if (submission.assetsSentText.length === 0) {
      errors.push(`${label}: ASSETS_SENT must not be empty.`);
    }
  }

  return { valid: errors.length === 0, errors };
}
