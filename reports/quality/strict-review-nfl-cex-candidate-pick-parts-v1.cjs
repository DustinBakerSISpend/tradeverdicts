const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 80);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const cexPath = path.join("reports", "quality", "nfl-c-explanatory-remaining-lanes-review-v1.json");
const outTxt = path.join("reports", "quality", "nfl-cex-candidate-pick-parts-strict-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-cex-candidate-pick-parts-strict-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-cex-candidate-pick-parts-strict-review-v1.csv");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getTrades(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trades)) return raw.trades;
  throw new Error("Could not locate trades array.");
}

function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function textOf(asset) {
  if (asset == null) return "";
  if (typeof asset === "string") return asset;
  if (typeof asset !== "object") return String(asset);
  return asset.asset || asset.name || asset.label || asset.description || asset.value || asset.title || "";
}

function typeOf(asset) {
  if (asset && typeof asset === "object" && asset.type) return String(asset.type);
  return "";
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[â€“â€”]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForDupe(s) {
  return norm(s)
    .replace(/[;:|()[\]{}.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function balancedParens(s) {
  let depth = 0;
  for (const ch of String(s || "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\s*\d{1,3}\b/i.test(String(s || ""));
}

function startsLikePick(s) {
  return /^\s*(?:\d{4}|draft pick|conditional|future|past|undisclosed|unspecified)/i.test(String(s || ""));
}

function countPickMentions(s) {
  const raw = String(s || "");
  const n = norm(raw);

  const yearRoundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)[-\s]+round\s+pick\b/g) || [];
  const noYearRoundPickMatches = n.match(/\b(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)[-\s]+round\s+pick\b/g) || [];
  const draftPickParentheticalMatches = raw.match(/\bdraft pick\s*\(/gi) || [];
  const hashMatches = raw.match(/#\s*\d{1,3}\b/g) || [];
  const overallMatches = raw.match(/\b\d{1,3}(?:st|nd|rd|th)\s+overall\b/gi) || [];

  return Math.max(
    yearRoundPickMatches.length,
    noYearRoundPickMatches.length,
    draftPickParentheticalMatches.length,
    hashMatches.length,
    overallMatches.length
  );
}

function hardRiskFlags(s) {
  const raw = String(s || "");
  const risks = [];

  if (!balancedParens(raw)) risks.push("unbalanced_parentheses");
  if (/\band\/or\b/i.test(raw)) risks.push("and_or");
  if (/-\s*OR\s*-/i.test(raw)) risks.push("dash_or");
  if (/\bor\b/i.test(raw)) risks.push("or_word");
  if (/\s\/\s/.test(raw)) risks.push("slash_alternative");
  if (/\b(?:cash|future considerations|past considerations|considerations|player to be named later|ptbnl|conditional on|if )\b/i.test(raw)) risks.push("cash_consideration_ptbnl_conditional");

  return [...new Set(risks)];
}

function explanatoryFlags(s) {
  const raw = String(s || "");
  const flags = [];

  if (/\bsubsequently\b/i.test(raw)) flags.push("subsequently");
  if (/\btraded to\b/i.test(raw)) flags.push("traded_to");
  if (/\bawarded\b/i.test(raw)) flags.push("awarded");
  if (/\breplaced\b/i.test(raw)) flags.push("replaced");
  if (/\bbecause\b/i.test(raw)) flags.push("because");
  if (/\bafter\b/i.test(raw)) flags.push("after");
  if (/\blater\b/i.test(raw)) flags.push("later");
  if (/\b(?:property of|ruled property)\b/i.test(raw)) flags.push("property");
  if (/\bvoid\b/i.test(raw)) flags.push("void");
  if (/\bforfeited\b/i.test(raw)) flags.push("forfeited");
  if (/\bprobably\b/i.test(raw)) flags.push("probably");
  if (/\binstead\b/i.test(raw)) flags.push("instead");

  return [...new Set(flags)];
}

function partStrictCheck(part) {
  const text = String(part || "").trim();
  const hardRisks = hardRiskFlags(text);
  const exFlags = explanatoryFlags(text);
  const pickMentions = countPickMentions(text);
  const starts = startsLikePick(text);
  const pickSignal = hasPickSignal(text);

  const errors = [];

  if (hardRisks.length > 0) errors.push(`hardRisk=${hardRisks.join("|")}`);
  if (!starts) errors.push("does_not_start_like_pick");
  if (!pickSignal) errors.push("missing_pick_signal");
  if (pickMentions !== 1) errors.push(`pickMentions=${pickMentions}`);

  return {
    text,
    ok: errors.length === 0,
    errors,
    hardRisks,
    explanatoryFlags: exFlags,
    pickMentions,
    startsLikePick: starts,
    hasPickSignal: pickSignal
  };
}

function makeLane(item) {
  const parts = Array.isArray(item.parts) ? item.parts.map((part) => String(part || "").trim()).filter(Boolean) : [];
  const partChecks = parts.map(partStrictCheck);
  const errors = [];
  const warnings = [];

  if (!/^CEX[12]_/.test(item.lane || "")) {
    errors.push(`unexpected_lane=${item.lane}`);
  }

  if (parts.length < 2) {
    errors.push(`too_few_parts=${parts.length}`);
  }

  if (parts.length > 4) {
    errors.push(`too_many_parts=${parts.length}`);
  }

  if (hardRiskFlags(item.before).length > 0) {
    errors.push(`asset_hard_risk=${hardRiskFlags(item.before).join("|")}`);
  }

  for (const check of partChecks) {
    if (!check.ok) errors.push(`part_not_strict_safe=[${check.text}] ${check.errors.join("|")}`);
  }

  const partKeys = parts.map(normalizeForDupe);
  const uniqueKeys = new Set(partKeys);
  if (uniqueKeys.size !== partKeys.length) {
    errors.push("duplicate_proposed_parts");
  }

  const allExFlags = [...new Set(partChecks.flatMap((check) => check.explanatoryFlags))];

  let sublane = "CEXS_other_candidate_review";

  if (allExFlags.length === 0) {
    sublane = item.lane.startsWith("CEX1")
      ? "CEXS1_punct_clean_no_explanatory_flags"
      : "CEXS2_and_clean_no_explanatory_flags";
  } else if (allExFlags.every((flag) => ["subsequently", "traded_to"].includes(flag))) {
    sublane = item.lane.startsWith("CEX1")
      ? "CEXS3_punct_subsequently_traded_to_only"
      : "CEXS4_and_subsequently_traded_to_only";
  } else if (allExFlags.some((flag) => ["awarded", "replaced"].includes(flag))) {
    sublane = "CEXS5_awarded_replaced_review";
  } else if (allExFlags.some((flag) => ["after", "later", "because"].includes(flag))) {
    sublane = "CEXS6_after_later_because_review";
  } else {
    sublane = "CEXS7_other_explanatory_review";
  }

  return {
    errors,
    warnings,
    partChecks,
    explanatoryFlags: allExFlags,
    sublane
  };
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const cex = readJson(cexPath);
const candidates = Array.isArray(cex.candidates) ? cex.candidates : [];

const reviewed = [];

for (const item of candidates) {
  const review = makeLane(item);
  const current = {
    ordinal: item.ordinal,
    id: item.id,
    team: item.team,
    slug: item.slug,
    sourceLane: item.lane,
    sourceLaneKey: item.sourceLaneKey,
    assetIndex: item.assetIndex,
    before: item.before,
    parts: item.parts || [],
    reason: item.reason,
    strictClass: "pending",
    sublane: review.sublane,
    errors: [...review.errors],
    warnings: [...review.warnings],
    explanatoryFlags: review.explanatoryFlags,
    partChecks: review.partChecks,
    currentAssetText: "",
    currentAssetType: "",
    duplicateAgainstExisting: []
  };

  const trade = byId.get(item.id);

  if (!trade) {
    current.errors.push("trade_not_found");
  } else if (trade.slug !== item.slug) {
    current.errors.push(`slug_mismatch_current=${trade.slug}`);
  } else {
    const bucket = trade.assetsReceived && trade.assetsReceived[item.team];

    if (!Array.isArray(bucket)) {
      current.errors.push("team_bucket_missing_or_not_array");
    } else if (item.assetIndex < 0 || item.assetIndex >= bucket.length) {
      current.errors.push(`asset_index_out_of_range_currentLength=${bucket.length}`);
    } else {
      const currentAsset = bucket[item.assetIndex];
      current.currentAssetText = textOf(currentAsset);
      current.currentAssetType = typeOf(currentAsset);

      if (norm(current.currentAssetText) !== norm(item.before)) {
        current.errors.push(`asset_text_mismatch_current=${current.currentAssetText}`);
      }

      const otherAssetTexts = new Set(bucket
        .filter((_, index) => index !== item.assetIndex)
        .map((asset) => normalizeForDupe(textOf(asset))));

      current.duplicateAgainstExisting = current.parts.filter((part) => otherAssetTexts.has(normalizeForDupe(part)));

      if (current.duplicateAgainstExisting.length > 0) {
        current.warnings.push(`split_part_already_exists_elsewhere=${current.duplicateAgainstExisting.join(" | ")}`);
      }
    }
  }

  if (current.errors.length > 0) {
    current.strictClass = "blocked";
  } else if (current.warnings.length > 0) {
    current.strictClass = "ready_with_warnings";
  } else {
    current.strictClass = "ready_no_warnings";
  }

  reviewed.push(current);
}

const counts = {
  sourceCandidateItems: candidates.length,
  totalReviewed: reviewed.length,
  readyNoWarnings: reviewed.filter((x) => x.strictClass === "ready_no_warnings").length,
  readyWithWarnings: reviewed.filter((x) => x.strictClass === "ready_with_warnings").length,
  blocked: reviewed.filter((x) => x.strictClass === "blocked").length,
  errors: reviewed.filter((x) => x.errors.length > 0).length,
  warnings: reviewed.filter((x) => x.warnings.length > 0).length
};

const sublaneCounts = {};
const strictClassCounts = {};
const sourceLaneCounts = {};
const explanatoryFlagCounts = {};
const errorCounts = {};
const warningCounts = {};

for (const item of reviewed) {
  sublaneCounts[item.sublane] = (sublaneCounts[item.sublane] || 0) + 1;
  strictClassCounts[item.strictClass] = (strictClassCounts[item.strictClass] || 0) + 1;
  sourceLaneCounts[item.sourceLane] = (sourceLaneCounts[item.sourceLane] || 0) + 1;

  for (const flag of item.explanatoryFlags) explanatoryFlagCounts[flag] = (explanatoryFlagCounts[flag] || 0) + 1;
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
  for (const warning of item.warnings) {
    const k = warning.split("=")[0];
    warningCounts[k] = (warningCounts[k] || 0) + 1;
  }
}

const readyNoWarnings = reviewed.filter((x) => x.strictClass === "ready_no_warnings");
const readyWithWarnings = reviewed.filter((x) => x.strictClass === "ready_with_warnings");
const blocked = reviewed.filter((x) => x.strictClass === "blocked");

const lines = [];
lines.push("# NFL CEX Candidate Pick Parts Strict Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY STRICT REVIEW");
lines.push("");
lines.push("Purpose:");
lines.push("- Second-pass review of CEX1/CEX2 candidate-review lanes.");
lines.push("- Confirms current trades.json still matches candidate report.");
lines.push("- Separates candidates into ready-no-warning, ready-with-warning, and blocked groups.");
lines.push("- Does not modify trades.json.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Source Lane Counts");
for (const [k, v] of Object.entries(sourceLaneCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Sublane Counts");
for (const [k, v] of Object.entries(sublaneCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Strict Class Counts");
for (const [k, v] of Object.entries(strictClassCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Explanatory Flag Counts");
if (Object.keys(explanatoryFlagCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(explanatoryFlagCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Error Counts");
if (Object.keys(errorCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(errorCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Warning Counts");
if (Object.keys(warningCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(warningCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Recommendation");
if (counts.readyNoWarnings > 0) {
  lines.push("- Next apply script, if used, should target ready_no_warnings only.");
  lines.push("- Do not include ready_with_warnings until duplicate warning details are reviewed.");
  lines.push("- Do not include blocked items.");
} else {
  lines.push("- No clean ready_no_warnings lane found. Keep this group review-only.");
}
lines.push("");
lines.push("## Ready No-Warnings Samples");
for (const item of readyNoWarnings.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- sublane: ${item.sublane}`);
  lines.push(`- sourceLane: ${item.sourceLane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- explanatoryFlags: ${item.explanatoryFlags.join(", ") || "none"}`);
  for (const part of item.parts) lines.push(`- proposedPart: ${part}`);
}
lines.push("");
lines.push("## Ready With Warnings Samples");
for (const item of readyWithWarnings.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- sublane: ${item.sublane}`);
  lines.push(`- sourceLane: ${item.sourceLane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- warnings: ${item.warnings.join(" | ")}`);
  for (const part of item.parts) lines.push(`- proposedPart: ${part}`);
}
lines.push("");
lines.push("## Blocked Samples");
for (const item of blocked.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- sublane: ${item.sublane}`);
  lines.push(`- sourceLane: ${item.sourceLane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- errors: ${item.errors.join(" | ")}`);
  for (const part of item.parts) lines.push(`- proposedPart: ${part}`);
}

const csvRows = [];
csvRows.push([
  "ordinal",
  "strictClass",
  "sublane",
  "sourceLane",
  "explanatoryFlags",
  "errors",
  "warnings",
  "id",
  "team",
  "slug",
  "assetIndex",
  "before",
  "parts"
].map(csvEscape).join(","));

for (const item of reviewed) {
  csvRows.push([
    item.ordinal,
    item.strictClass,
    item.sublane,
    item.sourceLane,
    item.explanatoryFlags.join("|"),
    item.errors.join("|"),
    item.warnings.join("|"),
    item.id,
    item.team,
    item.slug,
    item.assetIndex,
    item.before,
    item.parts.join(" || ")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, sourceLaneCounts, sublaneCounts, strictClassCounts, explanatoryFlagCounts, errorCounts, warningCounts, reviewed, readyNoWarnings, readyWithWarnings, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
