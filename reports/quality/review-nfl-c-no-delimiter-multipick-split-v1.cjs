const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 120);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const outTxt = path.join("reports", "quality", "nfl-c-no-delimiter-multipick-split-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-c-no-delimiter-multipick-split-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-c-no-delimiter-multipick-split-review-v1.csv");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getTrades(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trades)) return raw.trades;
  throw new Error("Could not find trades array.");
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

function compact(s) {
  return norm(s)
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function looseKey(s) {
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
  return Math.max(yearRoundPickMatches.length, noYearRoundPickMatches.length, draftPickParentheticalMatches.length, hashMatches.length, overallMatches.length);
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
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) risks.push("explanatory_or_contingent");
  return [...new Set(risks)];
}

function isCleanSinglePickText(text) {
  return countPickMentions(text) === 1 && hasPickSignal(text) && startsLikePick(text) && hardRiskFlags(text).length === 0;
}

function getCurrentMatches(bucket, text, excludeIndex = null) {
  const target = norm(text);
  return bucket
    .map((asset, index) => ({ index, type: typeOf(asset), text: textOf(asset), key: looseKey(textOf(asset)), compact: compact(textOf(asset)), pickMentions: countPickMentions(textOf(asset)) }))
    .filter((asset) => (excludeIndex === null || asset.index !== excludeIndex) && norm(asset.text) === target);
}

function parseNoDelimiterYearRoundPicks(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const startRe = /\b(?:19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)[-\s]+round\s+pick\b/gi;
  const starts = [];
  let m;
  while ((m = startRe.exec(raw)) !== null) {
    starts.push({ index: m.index, text: m[0] });
  }
  if (starts.length < 2) return { ok: false, reason: "fewer_than_two_year_round_pick_starts", starts, parts: [] };
  const parts = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index;
    const end = i + 1 < starts.length ? starts[i + 1].index : raw.length;
    let part = raw.slice(start, end).trim();
    part = part.replace(/^(?:and|,|;|\|)\s+/i, "").trim();
    part = part.replace(/\s*(?:and|,|;|\|)$/i, "").trim();
    if (part) parts.push(part);
  }
  return { ok: parts.length >= 2, reason: parts.length >= 2 ? "parsed" : "no_parts", starts, parts };
}

function hasObviousDelimiterBetweenPickStarts(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  return /;\s*(?:19|20)\d{2}\s+/i.test(raw) ||
    /,\s*(?:19|20)\d{2}\s+/i.test(raw) ||
    /\sand\s+(?:19|20)\d{2}\s+/i.test(raw) ||
    /\|\s*(?:19|20)\d{2}\s+/i.test(raw);
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const reviewed = [];
let ordinal = 0;

for (const trade of trades) {
  const received = trade.assetsReceived || {};
  for (const [team, bucket] of Object.entries(received)) {
    if (!Array.isArray(bucket)) continue;
    for (let assetIndex = 0; assetIndex < bucket.length; assetIndex++) {
      const asset = bucket[assetIndex];
      const text = textOf(asset);
      const assetType = typeOf(asset);
      const pickMentions = countPickMentions(text);
      if (pickMentions < 2) continue;
      const parse = parseNoDelimiterYearRoundPicks(text);
      if (!parse.ok) continue;

      const hasObviousDelimiter = hasObviousDelimiterBetweenPickStarts(text);
      const partChecks = parse.parts.map((part) => ({
        text: part,
        cleanSinglePick: isCleanSinglePickText(part),
        pickMentions: countPickMentions(part),
        risks: hardRiskFlags(part),
        existingMatches: getCurrentMatches(bucket, part, assetIndex)
      }));

      const assetRisks = hardRiskFlags(text);
      const allPartsClean = partChecks.every((part) => part.cleanSinglePick);
      const allPartsExactJoin = compact(parse.parts.join(" ")) === compact(text);
      const anyExistingParts = partChecks.some((part) => part.existingMatches.length > 0);
      const allPartsAlreadyExist = partChecks.every((part) => part.existingMatches.length > 0);
      const multipleExistingPartMatches = partChecks.some((part) => part.existingMatches.length > 1);
      const bundleCurrentMatchCount = getCurrentMatches(bucket, text, null).length;

      ordinal++;
      const out = {
        ordinal, id: trade.id, slug: trade.slug, team, assetIndex, assetType, before: text,
        pickMentions, parse, partChecks, assetRisks, hasObviousDelimiter, bundleCurrentMatchCount,
        projectedPartsToCreate: partChecks.filter((part) => part.existingMatches.length === 0).length,
        projectedNetAssetChange: partChecks.filter((part) => part.existingMatches.length === 0).length - 1,
        reviewClass: "pending", lane: "pending", reason: "", errors: [], warnings: []
      };

      if (assetType && assetType !== "pick") out.warnings.push(`assetType_not_pick=${assetType}`);

      if (bundleCurrentMatchCount !== 1) {
        out.reviewClass = "blocked";
        out.lane = "CND_blocked_bundle_current_match_count_not_one";
        out.reason = `bundle current match count is ${bundleCurrentMatchCount}`;
      } else if (assetRisks.length > 0) {
        out.reviewClass = "manual";
        out.lane = "CND_manual_asset_has_risk_flags";
        out.reason = `asset risks: ${assetRisks.join("|")}`;
      } else if (hasObviousDelimiter) {
        out.reviewClass = "manual";
        out.lane = "CND_manual_has_obvious_delimiter_use_other_lane";
        out.reason = "asset has obvious delimiter between pick starts; should stay out of no-delimiter lane";
      } else if (!allPartsClean) {
        out.reviewClass = "manual";
        out.lane = "CND_manual_split_parts_not_all_clean_single_picks";
        out.reason = "one or more parsed parts is not a clean single pick";
      } else if (!allPartsExactJoin) {
        out.reviewClass = "candidate_warning";
        out.lane = "CND_warning_parsed_parts_do_not_exactly_join_original";
        out.reason = "parsed parts are clean but do not exactly compact-join to original";
      } else if (multipleExistingPartMatches) {
        out.reviewClass = "candidate_warning";
        out.lane = "CND_warning_multiple_existing_part_matches";
        out.reason = "one or more parsed split parts already exists more than once";
      } else if (allPartsAlreadyExist) {
        out.reviewClass = "candidate_strict";
        out.lane = "CND1_strict_remove_bundle_all_parts_already_exist";
        out.reason = "bundle exactly equals clean split parts that already exist as standalone assets";
      } else if (anyExistingParts) {
        out.reviewClass = "candidate_strict";
        out.lane = "CND2_strict_split_bundle_create_missing_parts_dedupe_existing_parts";
        out.reason = "bundle exactly splits into clean picks; some parts already exist, so create only missing parts";
      } else {
        out.reviewClass = "candidate_strict";
        out.lane = "CND3_strict_split_no_delimiter_multipick_bundle";
        out.reason = "bundle exactly splits into clean standalone picks with no existing duplicate parts";
      }

      reviewed.push(out);
    }
  }
}

const strict = reviewed.filter((x) => x.reviewClass === "candidate_strict");
const warning = reviewed.filter((x) => x.reviewClass === "candidate_warning");
const manual = reviewed.filter((x) => x.reviewClass === "manual");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked");

const counts = {
  totalReviewedNoDelimiterCandidates: reviewed.length,
  candidateStrictCount: strict.length,
  candidateWarningCount: warning.length,
  manualCount: manual.length,
  blockedCount: blocked.length,
  strictRemoveBundleAllPartsAlreadyExist: strict.filter((x) => x.lane === "CND1_strict_remove_bundle_all_parts_already_exist").length,
  strictSplitCreateMissingDedupeExisting: strict.filter((x) => x.lane === "CND2_strict_split_bundle_create_missing_parts_dedupe_existing_parts").length,
  strictSplitNoDelimiterBundles: strict.filter((x) => x.lane === "CND3_strict_split_no_delimiter_multipick_bundle").length,
  bundlesToReplaceOrRemoveIfStrictApplied: strict.length,
  standalonePickAssetsToCreateIfStrictApplied: strict.reduce((sum, x) => sum + x.projectedPartsToCreate, 0),
  netAssetChangeIfStrictApplied: strict.reduce((sum, x) => sum + x.projectedNetAssetChange, 0),
  errors: 0
};

const laneCounts = {};
const classCounts = {};
const assetTypeCounts = {};
const warningCounts = {};
const errorCounts = {};
for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  assetTypeCounts[item.assetType || "(blank)"] = (assetTypeCounts[item.assetType || "(blank)"] || 0) + 1;
  for (const warning of item.warnings) warningCounts[warning.split("=")[0]] = (warningCounts[warning.split("=")[0]] || 0) + 1;
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
}

const lines = [];
lines.push("# NFL C No-Delimiter Multi-Pick Split Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Find remaining multi-pick bundle assets where year/round pick phrases are jammed together without obvious delimiters.");
lines.push("- Classify strict split/remove opportunities before any apply step.");
lines.push("- Does not modify trades.json.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Lane Counts");
for (const [k, v] of Object.entries(laneCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Review Class Counts");
for (const [k, v] of Object.entries(classCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Asset Type Counts");
for (const [k, v] of Object.entries(assetTypeCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Warning Counts");
if (Object.keys(warningCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(warningCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Error Counts");
if (Object.keys(errorCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(errorCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Recommendation");
if (strict.length > 0) {
  lines.push("- A later apply script may target candidate_strict only after sample inspection.");
  lines.push("- CND1 removes a bundle when all split parts already exist.");
  lines.push("- CND2 replaces the bundle with only missing split parts and keeps existing standalone parts.");
  lines.push("- CND3 replaces the bundle with all parsed split parts.");
  lines.push("- Do not apply warning/manual/blocked lanes without separate review.");
} else {
  lines.push("- No strict no-delimiter multi-pick lane found.");
}
lines.push("");
lines.push("## Strict Candidate Samples");
for (const item of strict.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- reason: ${item.reason}`);
  lines.push(`- projectedPartsToCreate: ${item.projectedPartsToCreate}`);
  lines.push(`- projectedNetAssetChange: ${item.projectedNetAssetChange}`);
  lines.push(`- before: ${item.before}`);
  for (const part of item.partChecks) {
    lines.push(`- splitPart: ${part.text}`);
    if (part.existingMatches.length > 0) {
      for (const match of part.existingMatches) lines.push(`  - existingPartMatch: [${match.index}] ${match.type} :: ${match.text}`);
    }
  }
}
lines.push("");
lines.push("## Manual/Warning Samples");
for (const item of warning.concat(manual).slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- class: ${item.reviewClass}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- reason: ${item.reason}`);
  lines.push(`- before: ${item.before}`);
  for (const part of item.partChecks) lines.push(`- splitPart: clean=${part.cleanSinglePick} picks=${part.pickMentions} risks=${part.risks.join("|") || "none"} :: ${part.text}`);
}

const csvRows = [];
csvRows.push([
  "ordinal", "reviewClass", "lane", "id", "team", "slug", "assetIndex", "assetType", "reason",
  "before", "splitParts", "existingPartMatches", "projectedPartsToCreate", "projectedNetAssetChange", "warnings", "errors"
].map(csvEscape).join(","));
for (const item of reviewed) {
  csvRows.push([
    item.ordinal, item.reviewClass, item.lane, item.id, item.team, item.slug, item.assetIndex, item.assetType, item.reason,
    item.before,
    item.partChecks.map((x) => x.text).join(" || "),
    item.partChecks.flatMap((x) => x.existingMatches.map((m) => `${x.text} => [${m.index}] ${m.text}`)).join(" || "),
    item.projectedPartsToCreate,
    item.projectedNetAssetChange,
    item.warnings.join("|"),
    item.errors.join("|")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, assetTypeCounts, warningCounts, errorCounts, reviewed, candidateStrict: strict, candidateWarning: warning, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
