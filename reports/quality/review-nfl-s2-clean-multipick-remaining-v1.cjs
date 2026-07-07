const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 60);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const splitJsonPath = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.json");
const outTxt = path.join("reports", "quality", "nfl-s2-clean-multipick-remaining-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-s2-clean-multipick-remaining-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-s2-clean-multipick-remaining-review-v1.csv");

const S2 = "S2_clean_multi_pick_split_candidate";

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

function isCleanSinglePickText(text) {
  return countPickMentions(text) === 1 &&
    hasPickSignal(text) &&
    startsLikePick(text) &&
    hardRiskFlags(text).length === 0;
}

function topLevelSplit(text, mode) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const parts = [];
  let start = 0;
  let depth = 0;

  function pushPart(end) {
    const part = raw.slice(start, end).trim().replace(/[;,]\s*$/g, "");
    if (part) parts.push(part);
  }

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);

    if (depth !== 0) continue;

    if (mode === "punct" && (ch === ";" || ch === ",")) {
      const next = raw.slice(i + 1).trim();
      if (hasPickSignal(next) || /^(?:19|20)\d{2}\b/.test(next)) {
        pushPart(i);
        start = i + 1;
      }
    }

    if (mode === "and") {
      const slice = raw.slice(i);
      const match = slice.match(/^\s+and\s+/i);
      if (match) {
        const next = raw.slice(i + match[0].length).trim();
        if (hasPickSignal(next) || /^(?:19|20)\d{2}\b/.test(next)) {
          pushPart(i);
          start = i + match[0].length;
          i = start - 1;
        }
      }
    }
  }

  const last = raw.slice(start).trim().replace(/[;,]\s*$/g, "");
  if (last) parts.push(last);

  return parts;
}

function bestSplit(text) {
  const candidates = [
    { mode: "and", parts: topLevelSplit(text, "and") },
    { mode: "punct", parts: topLevelSplit(text, "punct") }
  ];

  for (const c of candidates) {
    c.partChecks = c.parts.map((part) => ({
      text: part,
      cleanSinglePick: isCleanSinglePickText(part),
      pickMentions: countPickMentions(part),
      risks: hardRiskFlags(part)
    }));
    c.cleanParts = c.partChecks.filter((x) => x.cleanSinglePick).length;
    c.allClean = c.parts.length >= 2 && c.partChecks.every((x) => x.cleanSinglePick);
  }

  return candidates.sort((a, b) => {
    if (Number(b.allClean) !== Number(a.allClean)) return Number(b.allClean) - Number(a.allClean);
    if (b.cleanParts !== a.cleanParts) return b.cleanParts - a.cleanParts;
    return b.parts.length - a.parts.length;
  })[0];
}

function getCurrentMatches(bucket, text) {
  const target = norm(text);
  return bucket
    .map((asset, index) => ({ index, type: typeOf(asset), text: textOf(asset), key: looseKey(textOf(asset)), compact: compact(textOf(asset)), pickMentions: countPickMentions(textOf(asset)) }))
    .filter((asset) => norm(asset.text) === target);
}

function shortPreview(obj, max = 700) {
  const s = JSON.stringify(obj, null, 2);
  return s.length > max ? s.slice(0, max) + "...<truncated>" : s;
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const splitReport = readJson(splitJsonPath);
const s2Items = (((splitReport || {}).buckets || {})[S2]) || [];

const reviewed = [];

for (const [idx, item] of s2Items.entries()) {
  const reportAssets = Array.isArray(item.assets) ? item.assets.map((a) => ({
    type: a.type || "",
    text: a.text || textOf(a.raw),
    raw: a.raw || a
  })) : [];

  const out = {
    ordinal: idx + 1,
    id: item.id || item.tradeId || "",
    slug: item.slug || "",
    team: item.team || item.teamKey || "",
    sourceBucket: item.sourceBucket || "",
    itemKeys: Object.keys(item),
    rawPreview: shortPreview(item),
    reviewClass: "pending",
    lane: "pending",
    reason: "",
    reportAssets,
    currentBucketFound: false,
    bundleAsset: null,
    splitMode: "",
    splitParts: [],
    projectedNetAssetChange: 0,
    errors: [],
    warnings: []
  };

  const trade = byId.get(out.id);

  if (!trade) {
    out.reviewClass = "blocked";
    out.lane = "S2_blocked_trade_not_found";
    out.errors.push("trade_not_found");
    reviewed.push(out);
    continue;
  }

  if (out.slug && trade.slug !== out.slug) {
    out.warnings.push(`slug_mismatch_current=${trade.slug}`);
  }

  const bucket = trade.assetsReceived && trade.assetsReceived[out.team];

  if (!Array.isArray(bucket)) {
    out.reviewClass = "blocked";
    out.lane = "S2_blocked_team_bucket_missing";
    out.errors.push("team_bucket_missing_or_not_array");
    reviewed.push(out);
    continue;
  }

  out.currentBucketFound = true;

  const hydratedReportAssets = reportAssets.map((asset) => {
    const matches = getCurrentMatches(bucket, asset.text);
    return {
      ...asset,
      foundCurrent: matches.length > 0,
      currentMatches: matches,
      pickMentions: countPickMentions(asset.text),
      risks: hardRiskFlags(asset.text),
      isCleanSinglePick: isCleanSinglePickText(asset.text)
    };
  });

  out.reportAssets = hydratedReportAssets;

  const bundleCandidates = hydratedReportAssets.filter((asset) => asset.pickMentions >= 2);

  if (bundleCandidates.length !== 1) {
    out.reviewClass = "manual";
    out.lane = "S2_manual_not_exactly_one_bundle_asset";
    out.reason = `expected exactly one bundled multi-pick asset, found ${bundleCandidates.length}`;
    reviewed.push(out);
    continue;
  }

  const bundle = bundleCandidates[0];
  out.bundleAsset = bundle;

  if (bundle.currentMatches.length !== 1) {
    out.reviewClass = "blocked";
    out.lane = "S2_blocked_bundle_current_match_count_not_one";
    out.errors.push(`bundle_current_match_count=${bundle.currentMatches.length}`);
    reviewed.push(out);
    continue;
  }

  if (bundle.type && bundle.type !== "pick") {
    out.reviewClass = "candidate_warning";
    out.lane = "S2_warning_bundle_report_type_not_pick";
    out.reason = `bundle report type is ${bundle.type}`;
  }

  const best = bestSplit(bundle.text);
  out.splitMode = best.mode;
  out.splitParts = best.parts;
  out.projectedNetAssetChange = best.parts.length - 1;

  if (!best.allClean) {
    out.reviewClass = "manual";
    out.lane = "S2_manual_split_parts_not_all_clean_single_picks";
    out.reason = "split produced one or more non-clean single-pick parts";
    reviewed.push(out);
    continue;
  }

  if (bundle.risks.length > 0) {
    out.reviewClass = "candidate_warning";
    out.lane = "S2_warning_bundle_has_risk_flags";
    out.reason = `bundle risks: ${bundle.risks.join("|")}`;
    reviewed.push(out);
    continue;
  }

  const existingPartMatches = [];
  for (const part of best.parts) {
    const matches = getCurrentMatches(bucket, part).filter((match) => match.index !== bundle.currentMatches[0].index);
    if (matches.length > 0) existingPartMatches.push({ part, matches });
  }

  if (existingPartMatches.length > 0) {
    out.reviewClass = "candidate_warning";
    out.lane = "S2_warning_split_part_already_exists";
    out.reason = "one or more split parts already exists separately; should be S1/B-style dedupe, not S2 split";
    out.existingPartMatches = existingPartMatches;
    reviewed.push(out);
    continue;
  }

  if (out.reviewClass === "candidate_warning") {
    reviewed.push(out);
    continue;
  }

  out.reviewClass = "candidate_strict";
  out.lane = "S2A_strict_split_clean_multipick_bundle";
  out.reason = "one current bundled pick asset splits into clean standalone pick assets; no duplicate split parts already exist";
  reviewed.push(out);
}

const strict = reviewed.filter((x) => x.reviewClass === "candidate_strict");
const warning = reviewed.filter((x) => x.reviewClass === "candidate_warning");
const manual = reviewed.filter((x) => x.reviewClass === "manual");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked");

const counts = {
  reportS2Items: s2Items.length,
  totalReviewed: reviewed.length,
  candidateStrictCount: strict.length,
  candidateWarningCount: warning.length,
  manualCount: manual.length,
  blockedCount: blocked.length,
  bundlesToSplitIfStrictApplied: strict.length,
  standalonePickAssetsToCreateIfStrictApplied: strict.reduce((sum, x) => sum + x.splitParts.length, 0),
  netAssetChangeIfStrictApplied: strict.reduce((sum, x) => sum + x.projectedNetAssetChange, 0),
  errors: 0
};

const laneCounts = {};
const classCounts = {};
const sourceBucketCounts = {};
const splitModeCounts = {};
const warningCounts = {};
const errorCounts = {};

for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  sourceBucketCounts[item.sourceBucket] = (sourceBucketCounts[item.sourceBucket] || 0) + 1;
  splitModeCounts[item.splitMode || "(none)"] = (splitModeCounts[item.splitMode || "(none)"] || 0) + 1;
  for (const warning of item.warnings) warningCounts[warning.split("=")[0]] = (warningCounts[warning.split("=")[0]] || 0) + 1;
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
}

const lines = [];
lines.push("# NFL S2 Clean Multi-Pick Remaining Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Inspect the remaining S2 clean multi-pick split candidates.");
lines.push("- Strict candidate means one current bundled pick asset can be split into clean standalone pick assets with no duplicate split parts already present.");
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
for (const [k, v] of Object.entries(sourceBucketCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k || "(blank)"}: ${v}`);
lines.push("");
lines.push("## Split Mode Counts");
for (const [k, v] of Object.entries(splitModeCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
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
  lines.push("- A later apply script may target candidate_strict only.");
  lines.push("- Apply should replace the bundled pick asset with the clean split pick parts.");
  lines.push("- Do not apply warning/manual/blocked lanes without separate review.");
} else {
  lines.push("- No strict S2 split lane found.");
}
lines.push("");
lines.push("## Strict Candidate Samples");
for (const item of strict.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceBucket: ${item.sourceBucket}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- splitMode: ${item.splitMode}`);
  lines.push(`- reason: ${item.reason}`);
  lines.push(`- before: ${item.bundleAsset.text}`);
  lines.push(`- bundleCurrentIndex: ${item.bundleAsset.currentMatches[0].index}`);
  for (const part of item.splitParts) lines.push(`- splitPart: ${part}`);
}
lines.push("");
lines.push("## Warning Samples");
for (const item of warning.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceBucket: ${item.sourceBucket}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- reason: ${item.reason}`);
  if (item.bundleAsset) lines.push(`- before: ${item.bundleAsset.text}`);
  for (const part of item.splitParts || []) lines.push(`- splitPart: ${part}`);
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
  for (const asset of item.reportAssets) lines.push(`- reportAsset: found=${asset.foundCurrent} picks=${asset.pickMentions} risks=${asset.risks.join("|") || "none"} :: ${asset.text}`);
  for (const part of item.splitParts || []) lines.push(`- splitPart: ${part}`);
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
  lines.push(`- rawPreview: ${item.rawPreview.replace(/\n/g, " ")}`);
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
  "before",
  "splitMode",
  "splitParts",
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
    item.bundleAsset ? item.bundleAsset.text : "",
    item.splitMode,
    (item.splitParts || []).join(" || "),
    item.warnings.join("|"),
    item.errors.join("|")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, sourceBucketCounts, splitModeCounts, warningCounts, errorCounts, reviewed, candidateStrict: strict, candidateWarning: warning, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
