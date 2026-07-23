import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  createNbaTeamRegistry,
  loadNbaTeams,
} from "../../src/lib/nba/team-registry.mjs";
import {
  createLegacyTeamResolver,
  parseLegacyNbaTeamTable,
} from "../../src/lib/nba/parse-legacy-team-table.mjs";
import { applyNbaIntakeDecisions } from "../../src/lib/nba/apply-intake-decisions.mjs";
import { normalizeNbaSubmission } from "../../src/lib/nba/normalize-submission.mjs";
import { findNbaCanonicalCandidates } from "../../src/lib/nba/match-candidates.mjs";
import {
  buildNbaPickSwapContracts,
  enrichNbaPickSwapAsset,
} from "../../src/lib/nba/normalize-pick-swaps.mjs";

async function readJson(url) {
  return JSON.parse((await readFile(url, "utf8")).replace(/^\uFEFF/, ""));
}

async function readOptionalJson(url) {
  try {
    await access(url);
    return await readJson(url);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function parseArguments(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--output") {
      options.outputPath = argv[index + 1];
      index += 1;
    } else if (value === "--decisions") {
      options.decisionsPath = argv[index + 1];
      index += 1;
    } else {
      positional.push(value);
    }
  }

  return {
    inputPath: positional[0] ?? null,
    outputPath: options.outputPath ?? null,
    decisionsPath: options.decisionsPath ?? null,
  };
}

function warningCode(message) {
  if (/unmatched parentheses/i.test(message)) return "unmatched-parentheses";
  if (/unresolved source notation|unknown explicit source team|could not resolve explicit source-team label/i.test(message)) return "unresolved-source-notation";
  if (/fused bullet/i.test(message)) return "fused-bullet";
  if (/slash-separated player-name alias/i.test(message)) return "slash-alias";
  if (/multi-team asset counterparties/i.test(message)) return "multi-team-direction";
  if (/unclassified asset/i.test(message)) return "unclassified-asset";
  return "other";
}

function enrichLegacyAsset(asset, resolver, warnings) {
  const enriched = { ...asset };
  const fromMatch = asset.displayText.match(/\bfrom\s+([^),]+)(?=\)|,|$)/i);

  if (fromMatch) {
    const label = fromMatch[1].trim();
    if (label === "?") {
      warnings.push(`Unknown explicit source team preserved: ${asset.displayText}`);
    } else {
      const slug = resolver.resolve(label);
      if (slug) {
        enriched.explicitSourceTeam = slug;
        if (asset.direction === "received") {
          enriched.fromTeam = slug;
        }
      } else {
        warnings.push(
          `Could not resolve explicit source-team label '${label}' in: ${asset.displayText}`,
        );
      }
    }
  }

  if (asset.type === "pick_swap") {
    return enrichNbaPickSwapAsset(enriched, resolver);
  }

  return enriched;
}

function buildIssueGroups(record) {
  const acceptedCodes = new Set(
    record.reviewDecision?.acceptedWarningCodes ?? [],
  );
  const acceptedSourceWarnings = [];
  const parserIssues = [];
  const sourceFormattingIssues = [];
  const dataUncertaintyIssues = [];
  const directionReviewIssues = [];

  for (const warning of record.warnings) {
    const code = warningCode(warning);

    if (acceptedCodes.has(code)) {
      acceptedSourceWarnings.push(warning);
    } else if (code === "multi-team-direction") {
      directionReviewIssues.push(warning);
    } else if (code === "unresolved-source-notation") {
      dataUncertaintyIssues.push(warning);
    } else if (
      code === "fused-bullet" ||
      code === "slash-alias" ||
      code === "unmatched-parentheses"
    ) {
      sourceFormattingIssues.push(warning);
    } else {
      parserIssues.push(warning);
    }
  }

  const receivedText = new Set(
    record.assetsReceived.map((asset) => asset.displayText.toLowerCase()),
  );

  const duplicateNonSwapText = record.assetsSent
    .filter(
      (asset) =>
        asset.type !== "pick_swap" &&
        receivedText.has(asset.displayText.toLowerCase()),
    )
    .map((asset) => asset.displayText);

  const editorialEnrichmentIssues = [];
  if (!record.sourceTeamGrade) {
    editorialEnrichmentIssues.push(
      "Source-team grade not supplied in raw pilot.",
    );
  }
  if (!record.sourceTeamVerdict) {
    editorialEnrichmentIssues.push(
      "Source-team verdict not supplied in raw pilot.",
    );
  }
  if (!record.neutralSummary) {
    editorialEnrichmentIssues.push(
      "Neutral summary not supplied in raw pilot.",
    );
  }

  const sourceDecisionIssues = [];
  if (
    record.reviewDecision &&
    record.reviewDecision.canonicalImportReady !== true
  ) {
    sourceDecisionIssues.push(
      `Source decision remains non-importable: ${record.reviewDecision.status}`,
    );
  }

  for (const displayText of duplicateNonSwapText) {
    sourceDecisionIssues.push(
      `Same non-swap asset text appears on both sides and requires source confirmation: ${displayText}`,
    );
  }

  return {
    acceptedSourceWarnings: [...new Set(acceptedSourceWarnings)],
    parserIssues: [...new Set(parserIssues)],
    sourceFormattingIssues: [...new Set(sourceFormattingIssues)],
    dataUncertaintyIssues: [...new Set(dataUncertaintyIssues)],
    directionReviewIssues: [...new Set(directionReviewIssues)],
    editorialEnrichmentIssues: [...new Set(editorialEnrichmentIssues)],
    sourceDecisionIssues: [...new Set(sourceDecisionIssues)],
  };
}

const args = parseArguments(process.argv.slice(2));

if (!args.inputPath) {
  console.error(
    "Usage: node scripts/nba/preview-legacy-team-batch.mjs <legacy-team-table.txt> [--output preview.json] [--decisions decisions.json]",
  );
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), args.inputPath);
const inputText = await readFile(absolutePath, "utf8");
const teams = await loadNbaTeams();
const registry = createNbaTeamRegistry(teams);
const aliasConfig = await readJson(
  new URL("../../src/data/nba/team-input-aliases.json", import.meta.url),
);
const resolver = createLegacyTeamResolver(teams, aliasConfig);
const batchId = path.basename(args.inputPath, path.extname(args.inputPath));

const defaultDecisionUrl = new URL(
  `../../src/data/nba/review/${batchId}-decisions.json`,
  import.meta.url,
);
const decisionDocument = args.decisionsPath
  ? await readJson(path.resolve(process.cwd(), args.decisionsPath))
  : await readOptionalJson(defaultDecisionUrl);

const parsedBatch = parseLegacyNbaTeamTable(inputText, {
  batchId,
  sourceLabel: "User-provided legacy NFL-format NBA pilot batch",
  teams,
  aliasConfig,
});

const decidedSubmissions = applyNbaIntakeDecisions(
  parsedBatch.submissions,
  decisionDocument,
);

const canonicalTrades = await readJson(
  new URL("../../src/data/nba/trades.json", import.meta.url),
);

const normalized = decidedSubmissions.map((submission) => {
  const base = normalizeNbaSubmission(submission, registry);
  const warnings = [...submission.warnings, ...base.warnings];
  const assetsReceived = base.assetsReceived.map((asset) =>
    enrichLegacyAsset(asset, resolver, warnings),
  );
  const assetsSent = base.assetsSent.map((asset) =>
    enrichLegacyAsset(asset, resolver, warnings),
  );

  const initialRecord = {
    ...base,
    inputFormat: submission.inputFormat,
    batchId: submission.batchId,
    sourceTeamLabel: submission.sourceTeamLabel,
    partnerTeamLabels: submission.partnerTeamLabels,
    declaredTeamCount: submission.declaredTeamCount,
    relationshipText: submission.relationshipText,
    assetsReceived,
    assetsSent,
    warnings: [...new Set(warnings)],
    rawText: submission.rawText,
  };

  const pickSwapContracts = buildNbaPickSwapContracts(initialRecord);
  const issueGroups = buildIssueGroups(initialRecord);
  const reviewIssues = [
    ...issueGroups.parserIssues,
    ...issueGroups.sourceFormattingIssues,
    ...issueGroups.dataUncertaintyIssues,
    ...issueGroups.directionReviewIssues,
    ...issueGroups.sourceDecisionIssues,
  ];

  const record = {
    ...initialRecord,
    pickSwapContracts,
    ...issueGroups,
    reviewIssues: [...new Set(reviewIssues)],
  };

  return {
    ...record,
    matchReview: findNbaCanonicalCandidates(record, canonicalTrades),
  };
});

const assetTypeCounts = {};
let receivedAssetCount = 0;
let sentAssetCount = 0;
let unclassifiedAssetCount = 0;
let inferredPlayerCount = 0;
let unresolvedDirectionCount = 0;
let warningCount = 0;
let parserReviewIssueCount = 0;
let sourceFormattingIssueCount = 0;
let dataUncertaintyIssueCount = 0;
let directionReviewIssueCount = 0;
let editorialEnrichmentIssueCount = 0;
let sourceDecisionIssueCount = 0;
let canonicalSwapContractCount = 0;
let duplicateSwapSourceRepresentationCount = 0;
let multiTeamCount = 0;

for (const record of normalized) {
  if (record.partnerTeams.length > 1) multiTeamCount += 1;
  warningCount += record.warnings.length;
  parserReviewIssueCount += record.parserIssues.length;
  sourceFormattingIssueCount += record.sourceFormattingIssues.length;
  dataUncertaintyIssueCount += record.dataUncertaintyIssues.length;
  directionReviewIssueCount += record.directionReviewIssues.length;
  editorialEnrichmentIssueCount += record.editorialEnrichmentIssues.length;
  sourceDecisionIssueCount += record.sourceDecisionIssues.length;
  canonicalSwapContractCount += record.pickSwapContracts.length;
  duplicateSwapSourceRepresentationCount += record.pickSwapContracts.filter(
    (contract) => contract.duplicateSourceRepresentation,
  ).length;
  receivedAssetCount += record.assetsReceived.length;
  sentAssetCount += record.assetsSent.length;

  for (const asset of [...record.assetsReceived, ...record.assetsSent]) {
    increment(assetTypeCounts, asset.type);
    if (asset.status === "unclassified") unclassifiedAssetCount += 1;
    if (asset.type === "player" && asset.status === "inferred") {
      inferredPlayerCount += 1;
    }

    if (
      asset.type !== "pick_swap" &&
      (!asset.fromTeam || !asset.toTeam)
    ) {
      unresolvedDirectionCount += 1;
    }
  }
}

const dateCounts = {};
for (const record of normalized) increment(dateCounts, record.tradeDate);
const repeatedDates = Object.fromEntries(
  Object.entries(dateCounts).filter(([, count]) => count > 1),
);

const payload = {
  mode: "DRY_RUN_LEGACY_PILOT_ONLY",
  normalizationVersion: 2,
  valid: true,
  inputPath: absolutePath,
  batchId,
  sourceTeam: normalized[0]?.sourceTeam ?? null,
  submissionCount: normalized.length,
  twoTeamCount: normalized.length - multiTeamCount,
  multiTeamCount,
  receivedAssetCount,
  sentAssetCount,
  totalAssetCount: receivedAssetCount + sentAssetCount,
  assetTypeCounts,
  inferredPlayerCount,
  unclassifiedAssetCount,
  unresolvedDirectionCount,
  warningCount,
  parserReviewIssueCount,
  sourceFormattingIssueCount,
  dataUncertaintyIssueCount,
  directionReviewIssueCount,
  editorialEnrichmentIssueCount,
  sourceDecisionIssueCount,
  reviewIssueCount:
    parserReviewIssueCount +
    sourceFormattingIssueCount +
    dataUncertaintyIssueCount +
    directionReviewIssueCount +
    sourceDecisionIssueCount,
  canonicalSwapContractCount,
  duplicateSwapSourceRepresentationCount,
  repeatedDates,
  decisionDocumentApplied: Boolean(decisionDocument),
  canonicalTradeCount: canonicalTrades.length,
  automaticMergesPerformed: false,
  writesPerformed: false,
  importsPerformed: false,
  normalized,
};

const serialized = `${JSON.stringify(payload, null, 2)}\n`;

if (args.outputPath) {
  const outputPath = path.resolve(process.cwd(), args.outputPath);
  await writeFile(outputPath, serialized, "utf8");

  console.log(JSON.stringify({
    result: "PASS",
    phase: "2E",
    outputPath,
    normalizationVersion: payload.normalizationVersion,
    submissionCount: payload.submissionCount,
    totalAssetCount: payload.totalAssetCount,
    canonicalSwapContractCount: payload.canonicalSwapContractCount,
    canonicalTradeCount: payload.canonicalTradeCount,
    importsPerformed: payload.importsPerformed,
    writesPerformed: payload.writesPerformed,
  }, null, 2));
} else {
  process.stdout.write(serialized);
}
