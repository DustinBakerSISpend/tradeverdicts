const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 120);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const splitJsonPath = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.json");
const outTxt = path.join("reports", "quality", "nfl-s1-report-bundle-dedupe-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-s1-report-bundle-dedupe-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-s1-report-bundle-dedupe-review-v1.csv");

const S1 = "S1_clean_multi_pick_split_plus_dedupe_candidate";

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
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) risks.push("explanatory_or_contingent");

  return [...new Set(risks)];
}

function normalizedKey(s) {
  return norm(s)
    .replace(/[;:|()[\]{}.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCleanSinglePickText(text) {
  return countPickMentions(text) === 1 &&
    hasPickSignal(text) &&
    startsLikePick(text) &&
    hardRiskFlags(text).length === 0;
}

function bundleContainsSinglesInOrder(bundleText, singleTexts) {
  const b = compact(bundleText);
  let cursor = 0;

  for (const single of singleTexts) {
    const s = compact(single);
    const found = b.indexOf(s, cursor);
    if (found < 0) return false;
    cursor = found + s.length;
  }

  return true;
}

function exactJoinEqualsBundle(bundleText, singleTexts) {
  const joined = compact(singleTexts.join(" "));
  return compact(bundleText) === joined;
}

function getCurrentMatches(bucket, text) {
  const target = norm(text);
  return bucket
    .map((asset, index) => ({ index, type: typeOf(asset), text: textOf(asset), key: normalizedKey(textOf(asset)) }))
    .filter((asset) => norm(asset.text) === target);
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const split = readJson(splitJsonPath);
const s1Items = (((split || {}).buckets || {})[S1]) || [];

const reviewed = [];

for (const [idx, item] of s1Items.entries()) {
  const trade = byId.get(item.id);
  const reportAssets = Array.isArray(item.assets) ? item.assets.map((a) => ({
    type: a.type || "",
    text: a.text || textOf(a.raw),
    raw: a.raw || a
  })) : [];

  const out = {
    ordinal: idx + 1,
    id: item.id,
    slug: item.slug,
    team: item.team,
    sourceBucket: item.sourceBucket,
    lane: "pending",
    reviewClass: "pending",
    reason: "",
    reportAssets,
    currentBucketFound: false,
    allReportAssetsFoundCurrent: false,
    bundleCandidates: [],
    singlePickAssets: [],
    removalCandidates: [],
    keepAssets: [],
    errors: [],
    warnings: []
  };

  if (!trade) {
    out.reviewClass = "blocked";
    out.lane = "S1_blocked_trade_not_found";
    out.errors.push("trade_not_found");
    reviewed.push(out);
    continue;
  }

  if (trade.slug !== item.slug) {
    out.warnings.push(`slug_mismatch_current=${trade.slug}`);
  }

  const bucket = trade.assetsReceived && trade.assetsReceived[item.team];

  if (!Array.isArray(bucket)) {
    out.reviewClass = "blocked";
    out.lane = "S1_blocked_team_bucket_missing";
    out.errors.push("team_bucket_missing_or_not_array");
    reviewed.push(out);
    continue;
  }

  out.currentBucketFound = true;

  const hydratedAssets = reportAssets.map((asset) => {
    const matches = getCurrentMatches(bucket, asset.text);
    const pickMentions = countPickMentions(asset.text);
    const risks = hardRiskFlags(asset.text);

    return {
      ...asset,
      currentMatches: matches,
      foundCurrent: matches.length > 0,
      pickMentions,
      risks,
      isBundle: pickMentions >= 2,
      isCleanSinglePick: isCleanSinglePickText(asset.text)
    };
  });

  out.reportAssets = hydratedAssets;
  out.allReportAssetsFoundCurrent = hydratedAssets.every((asset) => asset.foundCurrent);
  out.bundleCandidates = hydratedAssets.filter((asset) => asset.isBundle);
  out.singlePickAssets = hydratedAssets.filter((asset) => asset.isCleanSinglePick);

  if (!out.allReportAssetsFoundCurrent) {
    out.reviewClass = "blocked";
    out.lane = "S1_blocked_report_asset_missing_current";
    out.errors.push("one_or_more_report_assets_missing_current");
    reviewed.push(out);
    continue;
  }

  if (out.bundleCandidates.length !== 1) {
    out.reviewClass = "manual";
    out.lane = "S1_manual_not_exactly_one_bundle";
    out.reason = `expected exactly one bundle candidate, found ${out.bundleCandidates.length}`;
    reviewed.push(out);
    continue;
  }

  const bundle = out.bundleCandidates[0];
  const singles = out.singlePickAssets;

  if (singles.length < 2) {
    out.reviewClass = "manual";
    out.lane = "S1_manual_not_enough_clean_single_pick_assets";
    out.reason = `expected at least two clean single pick assets, found ${singles.length}`;
    reviewed.push(out);
    continue;
  }

  const singleTexts = singles.map((a) => a.text);

  if (bundle.risks.length > 0) {
    out.reviewClass = "candidate_warning";
    out.lane = "S1B_warning_bundle_has_risk_flags";
    out.reason = `bundle has risks: ${bundle.risks.join("|")}`;
  } else if (bundle.pickMentions !== singles.length) {
    out.reviewClass = "candidate_warning";
    out.lane = "S1C_warning_pick_count_differs_from_single_count";
    out.reason = `bundle pick mentions ${bundle.pickMentions}; single pick assets ${singles.length}`;
  } else if (!bundleContainsSinglesInOrder(bundle.text, singleTexts)) {
    out.reviewClass = "candidate_warning";
    out.lane = "S1D_warning_bundle_does_not_contain_singles_in_order";
    out.reason = "bundle text does not contain all clean single pick assets in order";
  } else if (!exactJoinEqualsBundle(bundle.text, singleTexts)) {
    out.reviewClass = "candidate_warning";
    out.lane = "S1E_warning_bundle_contains_extra_text";
    out.reason = "bundle contains all singles in order but is not exact compact join";
  } else {
    out.reviewClass = "candidate_strict";
    out.lane = "S1A_strict_remove_duplicate_combined_bundle";
    out.reason = "combined bundle exactly equals the standalone clean pick assets already present";
  }

  out.removalCandidates = [{
    text: bundle.text,
    matches: bundle.currentMatches
  }];

  out.keepAssets = singles.map((single) => ({
    text: single.text,
    matches: single.currentMatches
  }));

  // If any current text appears more than once, do not auto-apply. It means indexes may be ambiguous.
  if (bundle.currentMatches.length !== 1) {
    out.reviewClass = "candidate_warning";
    out.lane = "S1F_warning_bundle_match_count_not_one";
    out.reason = `bundle current match count is ${bundle.currentMatches.length}`;
  }

  if (singles.some((single) => single.currentMatches.length !== 1)) {
    out.reviewClass = "candidate_warning";
    out.lane = "S1G_warning_single_match_count_not_one";
    out.reason = "one or more single pick assets has current match count not equal to one";
  }

  reviewed.push(out);
}

const strict = reviewed.filter((x) => x.reviewClass === "candidate_strict");
const warning = reviewed.filter((x) => x.reviewClass === "candidate_warning");
const manual = reviewed.filter((x) => x.reviewClass === "manual");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked");

const counts = {
  reportS1Items: s1Items.length,
  totalReviewed: reviewed.length,
  candidateStrictCount: strict.length,
  candidateWarningCount: warning.length,
  manualCount: manual.length,
  blockedCount: blocked.length,
  removalAssetsIfStrictApplied: strict.reduce((sum, item) => sum + item.removalCandidates.length, 0),
  keepAssetsVerifiedIfStrictApplied: strict.reduce((sum, item) => sum + item.keepAssets.length, 0),
  netAssetChangeIfStrictApplied: -1 * strict.reduce((sum, item) => sum + item.removalCandidates.length, 0),
  errors: 0
};

const laneCounts = {};
const classCounts = {};
const sourceBucketCounts = {};
const warningCounts = {};
const errorCounts = {};

for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  sourceBucketCounts[item.sourceBucket] = (sourceBucketCounts[item.sourceBucket] || 0) + 1;

  for (const warning of item.warnings) warningCounts[warning.split("=")[0]] = (warningCounts[warning.split("=")[0]] || 0) + 1;
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
}

const lines = [];
lines.push("# NFL S1 Report Bundle Dedupe Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Review itemized S1 report objects as bundle-dedupe candidates.");
lines.push("- Strict candidate means the combined bundle exactly equals standalone clean pick assets already present in the same bucket.");
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
lines.push("## Source Bucket Counts");
for (const [k, v] of Object.entries(sourceBucketCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Warning Counts");
if (Object.keys(warningCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(warningCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Error Counts");
if (Object.keys(errorCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(errorCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Recommendation");
if (strict.length > 0) {
  lines.push("- A later apply script may target candidate_strict only.");
  lines.push("- That apply should remove exactly one combined bundle asset per strict record and keep the standalone pick assets already present.");
  lines.push("- Do not apply warning/manual/blocked lanes without separate review.");
} else {
  lines.push("- No strict S1 bundle-dedupe lane found.");
}
lines.push("");
lines.push("## Strict Candidate Samples");
for (const item of strict.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceBucket: ${item.sourceBucket}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- reason: ${item.reason}`);
  for (const remove of item.removalCandidates) {
    lines.push(`- removeBundle: ${remove.text}`);
    for (const match of remove.matches) lines.push(`  - currentRemoveIndex: ${match.index} ${match.type} :: ${match.text}`);
  }
  for (const keep of item.keepAssets) {
    lines.push(`- keepStandalone: ${keep.text}`);
    for (const match of keep.matches) lines.push(`  - currentKeepIndex: ${match.index} ${match.type} :: ${match.text}`);
  }
}
lines.push("");
lines.push("## Warning Candidate Samples");
for (const item of warning.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceBucket: ${item.sourceBucket}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- reason: ${item.reason}`);
  for (const asset of item.reportAssets) {
    lines.push(`- reportAsset: ${asset.pickMentions} picks / risks=${asset.risks.join("|") || "none"} / found=${asset.foundCurrent} :: ${asset.text}`);
    for (const match of asset.currentMatches || []) lines.push(`  - currentIndex: ${match.index} ${match.type} :: ${match.text}`);
  }
}
lines.push("");
lines.push("## Manual Samples");
for (const item of manual.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceBucket: ${item.sourceBucket}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- reason: ${item.reason}`);
  for (const asset of item.reportAssets) lines.push(`- reportAsset: ${asset.pickMentions} picks :: ${asset.text}`);
}
lines.push("");
lines.push("## Blocked Samples");
for (const item of blocked.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceBucket: ${item.sourceBucket}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- errors: ${item.errors.join(" | ") || "none"}`);
  for (const asset of item.reportAssets) lines.push(`- reportAsset: found=${asset.foundCurrent} :: ${asset.text}`);
}

const csvRows = [];
csvRows.push([
  "ordinal",
  "reviewClass",
  "lane",
  "sourceBucket",
  "id",
  "team",
  "slug",
  "reason",
  "removeBundleTexts",
  "keepStandaloneTexts",
  "warnings",
  "errors"
].map(csvEscape).join(","));

for (const item of reviewed) {
  csvRows.push([
    item.ordinal,
    item.reviewClass,
    item.lane,
    item.sourceBucket,
    item.id,
    item.team,
    item.slug,
    item.reason,
    item.removalCandidates.map((x) => x.text).join(" || "),
    item.keepAssets.map((x) => x.text).join(" || "),
    item.warnings.join("|"),
    item.errors.join("|")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, sourceBucketCounts, warningCounts, errorCounts, reviewed, candidateStrict: strict, candidateWarning: warning, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
