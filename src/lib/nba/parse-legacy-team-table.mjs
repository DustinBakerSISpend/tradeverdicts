import { createHash } from "node:crypto";

function normalizeAlias(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[.’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function createLegacyTeamResolver(teams, aliasConfig = {}) {
  if (!Array.isArray(teams)) {
    throw new TypeError("teams must be an array.");
  }

  const byAlias = new Map();

  for (const team of teams) {
    const aliases = new Set([
      team.slug,
      team.name,
      team.abbreviation,
      ...(aliasConfig[team.slug] ?? []),
    ]);

    for (const alias of aliases) {
      const key = normalizeAlias(alias);
      if (!key) continue;

      const existing = byAlias.get(key);
      if (existing && existing !== team.slug) {
        throw new Error(
          `Ambiguous NBA input alias '${alias}' maps to both '${existing}' and '${team.slug}'.`,
        );
      }

      byAlias.set(key, team.slug);
    }
  }

  return Object.freeze({
    resolve(value) {
      return byAlias.get(normalizeAlias(value)) ?? null;
    },
    normalizeAlias,
  });
}

function countCharacter(value, character) {
  return [...String(value ?? "")].filter((item) => item === character).length;
}

function splitAssetCell(value, label) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  const warnings = [];

  if (!text) {
    return { assets: [], warnings: [`${label} was empty.`] };
  }

  if (/\S•/.test(text)) {
    warnings.push(`${label} contained a fused bullet and was split conservatively.`);
  }

  if (countCharacter(text, "(") !== countCharacter(text, ")")) {
    warnings.push(`${label} contained unmatched parentheses.`);
  }

  const parts = text.split("•");
  const preamble = parts.shift()?.trim();
  if (preamble) {
    warnings.push(`${label} contained text before its first bullet: ${preamble}`);
  }

  const assets = parts
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  for (const asset of assets) {
    if (/\s\/\s/.test(asset)) {
      warnings.push(`${label} preserved a slash-separated player-name alias: ${asset}`);
    }

    if (/\(\?-\?\)/.test(asset) || /from \?/i.test(asset)) {
      warnings.push(`${label} preserved unresolved source notation: ${asset}`);
    }
  }

  return { assets, warnings };
}

function parseRelationship(value, resolver) {
  const raw = String(value ?? "").trim();
  const warnings = [];
  const match = raw.match(/^(?:(\d+)-team\s+)?trade\s+with\s+(.+)$/i);

  if (!match) {
    return {
      raw,
      declaredTeamCount: null,
      partnerLabels: [],
      partnerTeams: [],
      warnings: [`Relationship note could not be parsed: ${raw || "(empty)"}`],
    };
  }

  const declaredTeamCount = match[1] ? Number(match[1]) : 2;
  const partnerLabels = match[2]
    .split(/\s*,\s*|\s+and\s+/i)
    .map((value) => value.trim())
    .filter(Boolean);

  const partnerTeams = [];
  for (const label of partnerLabels) {
    const slug = resolver.resolve(label);
    if (!slug) {
      warnings.push(`Unknown partner-team label: ${label}`);
      continue;
    }
    partnerTeams.push(slug);
  }

  if (declaredTeamCount !== partnerLabels.length + 1) {
    warnings.push(
      `Declared ${declaredTeamCount}-team trade but found ${partnerLabels.length} partner labels.`,
    );
  }

  if (new Set(partnerTeams).size !== partnerTeams.length) {
    warnings.push("Relationship note resolved duplicate partner teams.");
  }

  return {
    raw,
    declaredTeamCount,
    partnerLabels,
    partnerTeams: [...new Set(partnerTeams)],
    warnings,
  };
}

function splitRecordBlocks(text) {
  const normalized = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!normalized) return [];

  const lines = normalized.split("\n");
  const starts = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (/^\d{4}-\d{2}-\d{2}\t/.test(lines[index])) {
      starts.push(index);
    }
  }

  if (starts.length === 0) {
    throw new Error("No legacy NBA rows beginning with YYYY-MM-DD and a tab were found.");
  }

  return starts.map((start, position) => {
    const end = starts[position + 1] ?? lines.length;
    return lines.slice(start, end).join("\n").trim();
  });
}

export function parseLegacyNbaTeamTable(
  text,
  { batchId, sourceLabel, teams, aliasConfig },
) {
  if (!batchId) throw new Error("batchId is required.");
  if (!sourceLabel) throw new Error("sourceLabel is required.");

  const resolver = createLegacyTeamResolver(teams, aliasConfig);
  const blocks = splitRecordBlocks(text);
  const submissions = [];
  const batchWarnings = [];

  for (const [index, block] of blocks.entries()) {
    const columns = block.split("\t");
    if (columns.length !== 5) {
      throw new Error(
        `Legacy row ${index + 1} must contain exactly five tab-delimited columns; found ${columns.length}.`,
      );
    }

    const [tradeDate, sourceTeamLabel, receivedCell, sentCell, relationshipCell] =
      columns.map((value) => value.trim());

    const warnings = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
      warnings.push(`Invalid trade date format: ${tradeDate}`);
    }

    const sourceTeam = resolver.resolve(sourceTeamLabel);
    if (!sourceTeam) {
      warnings.push(`Unknown source-team label: ${sourceTeamLabel}`);
    }

    const received = splitAssetCell(receivedCell, "Assets received");
    const sent = splitAssetCell(sentCell, "Assets sent");
    const relationship = parseRelationship(relationshipCell, resolver);

    warnings.push(...received.warnings, ...sent.warnings, ...relationship.warnings);

    if (sourceTeam && relationship.partnerTeams.includes(sourceTeam)) {
      warnings.push("Source team also appeared in the partner-team list.");
    }

    const submissionId = `${batchId}-${String(index + 1).padStart(3, "0")}`;
    const contentHash = createHash("sha256").update(block, "utf8").digest("hex");

    submissions.push({
      inputFormat: "legacy-team-table-v1",
      batchId,
      submissionId,
      sourceRowId: String(index + 1),
      sourceTeamLabel,
      sourceTeam,
      tradeDate,
      partnerTeams: relationship.partnerTeams,
      partnerTeamLabels: relationship.partnerLabels,
      declaredTeamCount: relationship.declaredTeamCount,
      relationshipText: relationship.raw,
      assetsReceivedText: received.assets,
      assetsSentText: sent.assets,
      sourceTeamGrade: null,
      sourceTeamVerdict: null,
      neutralSummary: null,
      sourceReference: sourceLabel,
      uncertaintyNotes: warnings,
      relatedKnownTradeId: null,
      rawFields: {
        tradeDate,
        sourceTeamLabel,
        assetsReceived: receivedCell,
        assetsSent: sentCell,
        relationship: relationshipCell,
      },
      rawText: block,
      contentHash,
      warnings: [...new Set(warnings)],
    });
  }

  const duplicateHashes = submissions
    .filter((submission, index) =>
      submissions.findIndex((candidate) => candidate.contentHash === submission.contentHash) !== index,
    )
    .map((submission) => submission.submissionId);

  if (duplicateHashes.length > 0) {
    batchWarnings.push(`Duplicate raw row hashes detected: ${duplicateHashes.join(", ")}`);
  }

  return {
    format: "legacy-team-table-v1",
    batchId,
    sourceLabel,
    submissionCount: submissions.length,
    submissions,
    warnings: batchWarnings,
  };
}
