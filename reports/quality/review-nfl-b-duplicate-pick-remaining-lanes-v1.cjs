const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 100);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const bJsonPath = path.join("reports", "quality", "nfl-b-probable-duplicate-pick-subtriage-v1.json");
const outTxt = path.join("reports", "quality", "nfl-b-duplicate-pick-remaining-lanes-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-b-duplicate-pick-remaining-lanes-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-b-duplicate-pick-remaining-lanes-review-v1.csv");

const B_BUCKETS = [
  "B1_exact_duplicate_single_pick_auto_candidate",
  "B2_same_pick_single_pick_wording_candidate",
  "B3_duplicate_inside_multi_pick_bundle_needs_split",
  "B4_duplicate_inside_player_plus_pick_bundle_needs_split",
  "B5_duplicate_inside_other_bundle_review",
  "B6_unclear_probable_duplicate_review"
];

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

function getCurrentMatches(bucket, text) {
  const target = norm(text);
  return bucket
    .map((asset, index) => ({ index, type: typeOf(asset), text: textOf(asset), key: looseKey(textOf(asset)), pickMentions: countPickMentions(textOf(asset)) }))
    .filter((asset) => norm(asset.text) === target);
}

function collectBucketItems(obj) {
  const out = [];

  if (!obj || typeof obj !== "object") return out;

  if (obj.buckets && typeof obj.buckets === "object") {
    for (const bucketName of B_BUCKETS) {
      const arr = obj.buckets[bucketName];
      if (Array.isArray(arr)) {
        for (const item of arr) out.push({ sourceBucket: bucketName, item });
      }
    }
  }

  // Fallback for unexpected shape.
  if (out.length === 0) {
    function walk(value, pathParts = []) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const [i, child] of value.entries()) walk(child, pathParts.concat(String(i)));
        return;
      }

      for (const [k, v] of Object.entries(value)) {
        if (B_BUCKETS.includes(k) && Array.isArray(v)) {
          for (const item of v) out.push({ sourceBucket: k, item });
        } else {
          walk(v, pathParts.concat(k));
        }
      }
    }

    walk(obj);
  }

  return out;
}

function shortPreview(obj, max = 700) {
  const s = JSON.stringify(obj, null, 2);
  return s.length > max ? s.slice(0, max) + "...<truncated>" : s;
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const bReport = readJson(bJsonPath);
const bItems = collectBucketItems(bReport);

const reviewed = [];

for (const [idx, wrapped] of bItems.entries()) {
  const item = wrapped.item || {};
  const sourceBucket = wrapped.sourceBucket || item.sourceBucket || "unknown";

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
    sourceBucket,
    itemKeys: Object.keys(item),
    rawPreview: shortPreview(item),
    reviewClass: "pending",
    lane: "pending",
    reason: "",
    reportAssets,
    currentBucketFound: false,
    allReportAssetsFoundCurrent: false,
    exactDuplicateSinglePicks: [],
    bundleAssets: [],
    standaloneSingles: [],
    maybeRemoveStandaloneDuplicate: [],
    maybeRemoveBundleDuplicate: [],
    errors: [],
    warnings: []
  };

  const trade = byId.get(out.id);

  if (!trade) {
    out.reviewClass = "blocked";
    out.lane = "B_blocked_trade_not_found";
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
    out.lane = "B_blocked_team_bucket_missing";
    out.errors.push("team_bucket_missing_or_not_array");
    reviewed.push(out);
    continue;
  }

  out.currentBucketFound = true;

  const bucketSummaries = bucket.map((asset, index) => ({
    index,
    type: typeOf(asset),
    text: textOf(asset),
    key: looseKey(textOf(asset)),
    compact: compact(textOf(asset)),
    pickMentions: countPickMentions(textOf(asset)),
    risks: hardRiskFlags(textOf(asset)),
    cleanSinglePick: isCleanSinglePickText(textOf(asset))
  }));

  const hydratedReportAssets = reportAssets.map((asset) => {
    const matches = getCurrentMatches(bucket, asset.text);
    const pickMentions = countPickMentions(asset.text);
    const risks = hardRiskFlags(asset.text);
    return {
      ...asset,
      foundCurrent: matches.length > 0,
      currentMatches: matches,
      pickMentions,
      risks,
      cleanSinglePick: isCleanSinglePickText(asset.text),
      isBundle: pickMentions >= 2 || risks.length > 0 || compact(asset.text).length > 0 && bucketSummaries.some((b) => b.cleanSinglePick && compact(asset.text).includes(b.compact) && compact(asset.text) !== b.compact)
    };
  });

  out.reportAssets = hydratedReportAssets;
  out.allReportAssetsFoundCurrent = hydratedReportAssets.every((asset) => asset.foundCurrent);

  // Current-bucket duplicate groups by exact normalized text.
  const byExact = new Map();
  for (const asset of bucketSummaries) {
    if (!byExact.has(norm(asset.text))) byExact.set(norm(asset.text), []);
    byExact.get(norm(asset.text)).push(asset);
  }

  out.exactDuplicateSinglePicks = [...byExact.values()]
    .filter((group) => group.length > 1 && group.every((asset) => asset.type === "pick" && asset.cleanSinglePick))
    .map((group) => ({ text: group[0].text, matches: group }));

  // Current-bucket bundle/single containment.
  const singles = bucketSummaries.filter((asset) => asset.type === "pick" && asset.cleanSinglePick);
  const bundles = bucketSummaries.filter((asset) => asset.type === "pick" && asset.pickMentions >= 2 || asset.pickMentions >= 2);

  out.standaloneSingles = singles;
  out.bundleAssets = bundles;

  for (const bundle of bundles) {
    const containedSingles = singles.filter((single) => bundle.compact.includes(single.compact) && bundle.compact !== single.compact);
    if (containedSingles.length > 0) {
      out.maybeRemoveStandaloneDuplicate.push({
        bundle,
        containedSingles
      });

      // If bundle is exact concatenation of all contained singles, then bundle can be removed instead.
      const joined = compact(containedSingles.map((x) => x.text).join(" "));
      if (joined === bundle.compact) {
        out.maybeRemoveBundleDuplicate.push({
          bundle,
          containedSingles
        });
      }
    }
  }

  // Classify.
  if (out.exactDuplicateSinglePicks.length > 0) {
    out.reviewClass = "candidate_strict";
    out.lane = "B1R_strict_remove_exact_duplicate_single_pick_copy";
    out.reason = "current bucket has exact duplicate standalone clean pick copies";
  } else if (out.maybeRemoveBundleDuplicate.length === 1 && out.maybeRemoveBundleDuplicate[0].containedSingles.length >= 2) {
    const candidate = out.maybeRemoveBundleDuplicate[0];
    const duplicateBundleMatchedReport = hydratedReportAssets.some((asset) => norm(asset.text) === norm(candidate.bundle.text));
    if (duplicateBundleMatchedReport) {
      out.reviewClass = "candidate_strict";
      out.lane = "B3R_strict_remove_duplicate_bundle_already_represented_by_standalones";
      out.reason = "bundle exactly equals standalone clean pick assets already present";
    } else {
      out.reviewClass = "candidate_warning";
      out.lane = "BR_warning_bundle_duplicate_detected_but_not_in_report_assets";
      out.reason = "bundle duplicate detected from current bucket, but bundle text is not present in report assets";
    }
  } else if (out.maybeRemoveStandaloneDuplicate.length > 0) {
    out.reviewClass = "manual";
    out.lane = "BR_manual_bundle_contains_standalone_pick_but_bundle_not_exact_join";
    out.reason = "bundle contains standalone pick text, but not a strict exact duplicate bundle";
  } else if (!out.allReportAssetsFoundCurrent) {
    out.reviewClass = "manual";
    out.lane = "BR_manual_report_assets_not_all_found_current";
    out.reason = "one or more report assets were not found as exact current assets";
  } else {
    out.reviewClass = "manual";
    out.lane = "BR_manual_no_strict_duplicate_action_detected";
    out.reason = "no exact duplicate standalone pick or exact duplicate bundle action detected";
  }

  reviewed.push(out);
}

const strict = reviewed.filter((x) => x.reviewClass === "candidate_strict");
const warning = reviewed.filter((x) => x.reviewClass === "candidate_warning");
const manual = reviewed.filter((x) => x.reviewClass === "manual");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked");

const counts = {
  totalBItemsFromReport: bItems.length,
  totalReviewed: reviewed.length,
  candidateStrictCount: strict.length,
  candidateWarningCount: warning.length,
  manualCount: manual.length,
  blockedCount: blocked.length,
  exactDuplicateSinglePickGroups: reviewed.reduce((sum, x) => sum + x.exactDuplicateSinglePicks.length, 0),
  strictBundleDuplicateRemovalCandidates: strict.filter((x) => x.lane === "B3R_strict_remove_duplicate_bundle_already_represented_by_standalones").length,
  strictExactSinglePickDuplicateRemovalCandidates: strict.filter((x) => x.lane === "B1R_strict_remove_exact_duplicate_single_pick_copy").length,
  errors: 0
};

const laneCounts = {};
const classCounts = {};
const sourceBucketCounts = {};
const keyShapeCounts = {};
const warningCounts = {};
const errorCounts = {};

for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  sourceBucketCounts[item.sourceBucket] = (sourceBucketCounts[item.sourceBucket] || 0) + 1;
  keyShapeCounts[item.itemKeys.sort().join(",")] = (keyShapeCounts[item.itemKeys.sort().join(",")] || 0) + 1;
  for (const warning of item.warnings) warningCounts[warning.split("=")[0]] = (warningCounts[warning.split("=")[0]] || 0) + 1;
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
}

const lines = [];
lines.push("# NFL B Duplicate Pick Remaining Lanes Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Inspect remaining B probable duplicate-pick items.");
lines.push("- Hydrate B report objects against current trades.json.");
lines.push("- Identify whether any strict cleanup lane exists.");
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
lines.push("## Key Shape Counts");
for (const [k, v] of Object.entries(keyShapeCounts).sort((a, b) => b[1] - a[1]).slice(0, 20)) lines.push(`- ${v}x keys: ${k}`);
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
  lines.push("- A later apply script may target candidate_strict only, after sample inspection.");
  lines.push("- Be especially cautious: B items can mean either remove an exact duplicate standalone copy or remove a combined duplicate bundle.");
  lines.push("- Do not apply warning/manual/blocked lanes without separate review.");
} else {
  lines.push("- No strict B cleanup lane found. Remaining B should stay manual or be handled through C/D split lanes.");
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
  for (const group of item.exactDuplicateSinglePicks) {
    lines.push(`- exactDuplicateSinglePick: ${group.text}`);
    for (const match of group.matches) lines.push(`  - currentIndex: ${match.index} ${match.type} :: ${match.text}`);
  }
  for (const candidate of item.maybeRemoveBundleDuplicate) {
    lines.push(`- duplicateBundleCandidate: [${candidate.bundle.index}] ${candidate.bundle.type} :: ${candidate.bundle.text}`);
    for (const single of candidate.containedSingles) lines.push(`  - containedStandalone: [${single.index}] ${single.type} :: ${single.text}`);
  }
  for (const asset of item.reportAssets) lines.push(`- reportAsset: found=${asset.foundCurrent} picks=${asset.pickMentions} risks=${asset.risks.join("|") || "none"} :: ${asset.text}`);
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
  for (const asset of item.reportAssets) lines.push(`- reportAsset: found=${asset.foundCurrent} picks=${asset.pickMentions} risks=${asset.risks.join("|") || "none"} :: ${asset.text}`);
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
  for (const candidate of item.maybeRemoveStandaloneDuplicate.slice(0, 2)) {
    lines.push(`- bundleContainsStandaloneCandidate: [${candidate.bundle.index}] ${candidate.bundle.type} :: ${candidate.bundle.text}`);
    for (const single of candidate.containedSingles) lines.push(`  - containedStandalone: [${single.index}] ${single.type} :: ${single.text}`);
  }
  for (const asset of item.reportAssets.slice(0, 8)) lines.push(`- reportAsset: found=${asset.foundCurrent} picks=${asset.pickMentions} risks=${asset.risks.join("|") || "none"} :: ${asset.text}`);
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
  "reportAssetTexts",
  "exactDuplicateSinglePicks",
  "duplicateBundleCandidates",
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
    item.reportAssets.map((x) => x.text).join(" || "),
    item.exactDuplicateSinglePicks.map((x) => x.text).join(" || "),
    item.maybeRemoveBundleDuplicate.map((x) => x.bundle.text).join(" || "),
    item.warnings.join("|"),
    item.errors.join("|")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, sourceBucketCounts, keyShapeCounts, warningCounts, errorCounts, reviewed, candidateStrict: strict, candidateWarning: warning, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
