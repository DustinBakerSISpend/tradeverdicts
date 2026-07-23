import { readFile } from "node:fs/promises";
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
import { normalizeNbaSubmission } from "../../src/lib/nba/normalize-submission.mjs";
import { findNbaCanonicalCandidates } from "../../src/lib/nba/match-candidates.mjs";

async function readJson(url) {
  return JSON.parse((await readFile(url, "utf8")).replace(/^\uFEFF/, ""));
}

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
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
        warnings.push(`Could not resolve explicit source-team label '${label}' in: ${asset.displayText}`);
      }
    }
  }

  const swapTeamMatch = asset.displayText.match(/^(.+?)\s+option\s+to\s+swap\b/i);
  if (asset.type === "pick_swap" && swapTeamMatch) {
    const slug = resolver.resolve(swapTeamMatch[1].trim());
    if (slug) enriched.swapWithTeam = slug;
  }

  return enriched;
}

function buildReviewIssues(record) {
  const issues = [...record.warnings];
  const receivedText = new Set(record.assetsReceived.map((asset) => asset.displayText.toLowerCase()));

  for (const asset of record.assetsSent) {
    if (receivedText.has(asset.displayText.toLowerCase())) {
      issues.push(`Same asset text appears on both sides: ${asset.displayText}`);
    }
  }

  if (!record.sourceTeamGrade) issues.push("Source-team grade not supplied in raw pilot.");
  if (!record.sourceTeamVerdict) issues.push("Source-team verdict not supplied in raw pilot.");
  if (!record.neutralSummary) issues.push("Neutral summary not supplied in raw pilot.");

  return [...new Set(issues)];
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error(
    "Usage: node scripts/nba/preview-legacy-team-batch.mjs <legacy-team-table.txt>",
  );
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), inputPath);
const inputText = await readFile(absolutePath, "utf8");
const teams = await loadNbaTeams();
const registry = createNbaTeamRegistry(teams);
const aliasConfig = await readJson(
  new URL("../../src/data/nba/team-input-aliases.json", import.meta.url),
);
const resolver = createLegacyTeamResolver(teams, aliasConfig);
const batchId = path.basename(inputPath, path.extname(inputPath));
const parsedBatch = parseLegacyNbaTeamTable(inputText, {
  batchId,
  sourceLabel: "User-provided legacy NFL-format NBA pilot batch",
  teams,
  aliasConfig,
});

const canonicalTrades = await readJson(
  new URL("../../src/data/nba/trades.json", import.meta.url),
);

const normalized = parsedBatch.submissions.map((submission) => {
  const base = normalizeNbaSubmission(submission, registry);
  const warnings = [...submission.warnings, ...base.warnings];
  const assetsReceived = base.assetsReceived.map((asset) =>
    enrichLegacyAsset(asset, resolver, warnings),
  );
  const assetsSent = base.assetsSent.map((asset) =>
    enrichLegacyAsset(asset, resolver, warnings),
  );
  const record = {
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

  return {
    ...record,
    reviewIssues: buildReviewIssues(record),
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
let reviewIssueCount = 0;
let multiTeamCount = 0;

for (const record of normalized) {
  if (record.partnerTeams.length > 1) multiTeamCount += 1;
  warningCount += record.warnings.length;
  reviewIssueCount += record.reviewIssues.length;
  receivedAssetCount += record.assetsReceived.length;
  sentAssetCount += record.assetsSent.length;

  for (const asset of [...record.assetsReceived, ...record.assetsSent]) {
    increment(assetTypeCounts, asset.type);
    if (asset.status === "unclassified") unclassifiedAssetCount += 1;
    if (asset.type === "player" && asset.status === "inferred") inferredPlayerCount += 1;
    if (!asset.fromTeam || !asset.toTeam) unresolvedDirectionCount += 1;
  }
}

const dateCounts = {};
for (const record of normalized) increment(dateCounts, record.tradeDate);
const repeatedDates = Object.fromEntries(
  Object.entries(dateCounts).filter(([, count]) => count > 1),
);

console.log(JSON.stringify({
  mode: "DRY_RUN_LEGACY_PILOT_ONLY",
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
  reviewIssueCount,
  repeatedDates,
  canonicalTradeCount: canonicalTrades.length,
  automaticMergesPerformed: false,
  writesPerformed: false,
  importsPerformed: false,
  normalized,
}, null, 2));
