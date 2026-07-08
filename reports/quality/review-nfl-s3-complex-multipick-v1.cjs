const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 120);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const splitJsonPath = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.json");
const outTxt = path.join("reports", "quality", "nfl-s3-complex-multipick-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-s3-complex-multipick-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-s3-complex-multipick-review-v1.csv");

const S3 = "S3_multi_pick_bundle_complex_review";

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
  return norm(s).replace(/[^a-z0-9]+/g, "").trim();
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

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\s*\d{1,3}\b/i.test(String(s || ""));
}

function startsLikePick(s) {
  return /^\s*(?:\d{4}|draft pick|conditional|future|past|undisclosed|unspecified)/i.test(String(s || ""));
}

function riskFlags(text) {
  const raw = String(text || "");
  const risks = [];

  if (!balancedParens(raw)) risks.push("unbalanced_parentheses");
  if (/\band\/or\b/i.test(raw)) risks.push("and_or");
  if (/-\s*OR\s*-/i.test(raw)) risks.push("dash_or");
  if (/\bor\b/i.test(raw)) risks.push("or_word");
  if (/\s\/\s/.test(raw)) risks.push("slash_alternative");
  if (/\b(?:cash|future considerations|past considerations|considerations|player to be named later|ptbnl|conditional on|if|unless|depending on)\b/i.test(raw)) risks.push("conditional_or_special");
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) risks.push("explanatory_or_contingent");
  if (/\b(?:traded|trade|trades|sent|send|sends|received|receives|acquired|acquires|dealt|shipped)\b/i.test(raw)) risks.push("transaction_verb_leak");
  if (/[.]\s+[A-Z]/.test(raw)) risks.push("sentence_fragment_leak");
  if (/\b(?:to|from|for|via)\s*$/i.test(raw)) risks.push("trailing_connector_fragment");
  if (/\)\s*(?:to|from|for|via)\b/i.test(raw)) risks.push("post_parenthetical_route_language");
  if (/\)\s*[A-Z][a-z]+/i.test(raw)) risks.push("word_glued_after_parenthetical");

  return [...new Set(risks)];
}

function isStrictSinglePick(text) {
  const risks = riskFlags(text);
  return {
    ok: countPickMentions(text) === 1 && hasPickSignal(text) && startsLikePick(text) && risks.length === 0,
    risks,
    pickMentions: countPickMentions(text)
  };
}

function assetSummary(asset, index) {
  const text = textOf(asset);
  return {
    index,
    type: typeOf(asset),
    text,
    norm: norm(text),
    compact: compact(text),
    pickMentions: countPickMentions(text),
    risks: riskFlags(text),
    strictSinglePick: isStrictSinglePick(text).ok
  };
}

function collectS3Items(splitReport) {
  const arr = (((splitReport || {}).buckets || {})[S3]) || [];
  return Array.isArray(arr) ? arr : [];
}

function reportItemAssets(item) {
  return Array.isArray(item.assets)
    ? item.assets.map((a) => ({
        type: a.type || "",
        text: a.text || textOf(a.raw),
        raw: a.raw || a
      }))
    : [];
}

function topLevelSplit(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const parts = [];
  let start = 0;
  let depth = 0;

  function pushPart(end) {
    const part = raw.slice(start, end).trim()
      .replace(/^(?:and|,|;|\+|\|)\s+/i, "")
      .replace(/\s*(?:and|,|;|\+|\|)$/i, "")
      .trim();
    if (part) parts.push(part);
  }

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);

    if (depth !== 0) continue;

    if (ch === ";" || ch === "|" || ch === "+") {
      pushPart(i);
      start = i + 1;
      continue;
    }

    if (ch === ",") {
      const next = raw.slice(i + 1).trim();
      if (hasPickSignal(next) || /^(?:19|20)\d{2}\b/.test(next)) {
        pushPart(i);
        start = i + 1;
        continue;
      }
    }

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

  const last = raw.slice(start).trim()
    .replace(/^(?:and|,|;|\+|\|)\s+/i, "")
    .replace(/\s*(?:and|,|;|\+|\|)$/i, "")
    .trim();
  if (last) parts.push(last);
  return parts;
}

function currentMatches(currentAssets, text, excludeIndex = null) {
  return currentAssets.filter((asset) => (excludeIndex === null || asset.index !== excludeIndex) && norm(asset.text) === norm(text));
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const splitReport = readJson(splitJsonPath);
const s3Items = collectS3Items(splitReport);

const reviewed = [];

for (const [idx, item] of s3Items.entries()) {
  const trade = byId.get(item.id);
  const out = {
    ordinal: idx + 1,
    id: item.id || "",
    slug: item.slug || "",
    team: item.team || "",
    sourceBucket: item.sourceBucket || "",
    reviewClass: "pending",
    lane: "pending",
    reason: "",
    reportAssets: reportItemAssets(item),
    currentBucketFound: false,
    currentAssets: [],
    targetBundles: [],
    duplicateGroups: [],
    exactDuplicateRemovalPlan: [],
    exactDuplicateRemovalCount: 0,
    bundlesToSplitIfStrictApplied: 0,
    standalonePickAssetsToCreateIfStrictApplied: 0,
    netAssetChangeIfStrictApplied: 0,
    errors: [],
    warnings: []
  };

  if (!trade) {
    out.reviewClass = "blocked";
    out.lane = "S3_blocked_trade_not_found";
    out.reason = "trade not found";
    out.errors.push("trade_not_found");
    reviewed.push(out);
    continue;
  }

  if (out.slug && trade.slug !== out.slug) out.warnings.push(`slug_mismatch_current=${trade.slug}`);

  const bucket = trade.assetsReceived && trade.assetsReceived[out.team];

  if (!Array.isArray(bucket)) {
    out.reviewClass = "blocked";
    out.lane = "S3_blocked_team_bucket_missing";
    out.reason = "team bucket missing";
    out.errors.push("team_bucket_missing_or_not_array");
    reviewed.push(out);
    continue;
  }

  out.currentBucketFound = true;
  out.currentAssets = bucket.map(assetSummary);

  const reportAssets = out.reportAssets.map((asset) => {
    const matches = currentMatches(out.currentAssets, asset.text);
    const parts = topLevelSplit(asset.text);
    const partChecks = parts.map((part) => ({
      text: part,
      ...isStrictSinglePick(part),
      existingMatches: currentMatches(out.currentAssets, part)
    }));

    return {
      ...asset,
      currentMatchIndexes: matches.map((m) => m.index),
      currentMatchCount: matches.length,
      pickMentions: countPickMentions(asset.text),
      risks: riskFlags(asset.text),
      parts,
      partChecks,
      allPartsStrict: parts.length >= 2 && partChecks.every((p) => p.ok),
      exactCompactJoin: compact(parts.join(" ")) === compact(asset.text)
    };
  });

  out.reportAssets = reportAssets;

  // Exact duplicate removal inside the current bucket is the only safe S3 action unless bundle split is perfectly clean.
  const groupMap = new Map();
  for (const asset of out.currentAssets) {
    const key = `${asset.type || "(blank)"}|||${asset.norm}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(asset);
  }

  out.duplicateGroups = [...groupMap.entries()]
    .map(([key, assets]) => ({ key, assets }))
    .filter((group) => group.assets.length > 1)
    .map((group) => {
      const type = group.assets[0].type;
      const text = group.assets[0].text;
      const flags = [...new Set(group.assets.flatMap((a) => a.risks))];
      const pickMentions = Math.max(...group.assets.map((a) => a.pickMentions));
      const exactType = new Set(group.assets.map((a) => a.type)).size === 1;
      const safeExactDuplicate = exactType &&
        type === "pick" &&
        pickMentions <= 1 &&
        flags.length === 0;

      return {
        key: group.key,
        type,
        text,
        indexes: group.assets.map((a) => a.index),
        keepIndex: group.assets[0].index,
        removeIndexes: group.assets.slice(1).map((a) => a.index),
        count: group.assets.length,
        removalCount: group.assets.length - 1,
        flags,
        pickMentions,
        exactType,
        safeExactDuplicate
      };
    });

  const safeDuplicateGroups = out.duplicateGroups.filter((group) => group.safeExactDuplicate);
  const unsafeDuplicateGroups = out.duplicateGroups.filter((group) => !group.safeExactDuplicate);

  out.exactDuplicateRemovalPlan = safeDuplicateGroups.flatMap((group) => group.removeIndexes.map((removeIndex) => ({
    type: group.type,
    text: group.text,
    keepIndex: group.keepIndex,
    removeIndex,
    groupKey: group.key
  })));
  out.exactDuplicateRemovalCount = out.exactDuplicateRemovalPlan.length;

  const strictSplitTargets = reportAssets
    .filter((asset) =>
      asset.currentMatchCount === 1 &&
      (asset.type === "pick" || asset.type === "") &&
      asset.pickMentions >= 2 &&
      asset.risks.length === 0 &&
      asset.parts.length >= 2 &&
      asset.allPartsStrict &&
      asset.exactCompactJoin
    )
    .map((asset) => {
      const currentIndex = asset.currentMatchIndexes[0];
      const missingParts = asset.partChecks.filter((part) => part.existingMatches.filter((m) => m.index !== currentIndex).length === 0);
      const duplicatePartCounts = asset.partChecks.map((part) => part.existingMatches.filter((m) => m.index !== currentIndex).length);
      return {
        ...asset,
        currentIndex,
        missingParts,
        duplicatePartCounts,
        multipleExistingPartMatches: duplicatePartCounts.some((count) => count > 1),
        createCount: missingParts.length,
        netAssetChange: missingParts.length - 1
      };
    });

  const strictSplitReady = strictSplitTargets.filter((target) => !target.multipleExistingPartMatches);

  out.targetBundles = strictSplitTargets;
  out.bundlesToSplitIfStrictApplied = strictSplitReady.length;
  out.standalonePickAssetsToCreateIfStrictApplied = strictSplitReady.reduce((sum, x) => sum + x.createCount, 0);

  if (strictSplitReady.length > 0 && unsafeDuplicateGroups.length === 0) {
    out.reviewClass = "candidate_strict";
    out.lane = "S3S1_strict_split_complex_multipick_or_dedupe";
    out.reason = "complex multi-pick bundle has clean strict split parts and no unsafe duplicate groups";
    out.netAssetChangeIfStrictApplied =
      strictSplitReady.reduce((sum, x) => sum + x.netAssetChange, 0) - out.exactDuplicateRemovalCount;
  } else if (out.exactDuplicateRemovalCount > 0 && unsafeDuplicateGroups.length === 0) {
    out.reviewClass = "candidate_strict";
    out.lane = "S3D1_strict_remove_safe_exact_duplicate_single_pick_assets";
    out.reason = "safe exact duplicate single-pick assets exist; keep first and remove later duplicate(s)";
    out.netAssetChangeIfStrictApplied = -out.exactDuplicateRemovalCount;
  } else if (strictSplitReady.length > 0 || out.exactDuplicateRemovalCount > 0) {
    out.reviewClass = "candidate_warning";
    out.lane = "S3_warning_safe_action_mixed_with_unsafe_duplicate_or_split_context";
    out.reason = "a possible safe action exists but mixed context requires manual review";
    out.netAssetChangeIfStrictApplied =
      strictSplitReady.reduce((sum, x) => sum + x.netAssetChange, 0) - out.exactDuplicateRemovalCount;
  } else if (reportAssets.some((a) => a.risks.includes("transaction_verb_leak") || a.risks.includes("sentence_fragment_leak"))) {
    out.reviewClass = "manual";
    out.lane = "S3_manual_transaction_or_sentence_context";
    out.reason = "complex multi-pick asset has transaction/source narrative text";
  } else if (reportAssets.some((a) => a.risks.includes("conditional_or_special") || a.risks.includes("or_word") || a.risks.includes("slash_alternative"))) {
    out.reviewClass = "manual";
    out.lane = "S3_manual_conditional_or_alternative_complex_pick";
    out.reason = "complex multi-pick asset has conditional/or/special source interpretation";
  } else if (out.duplicateGroups.length > 0) {
    out.reviewClass = "manual";
    out.lane = "S3_manual_duplicate_groups_not_safe_exact_single_pick";
    out.reason = "duplicate groups exist but are not safe exact single-pick removals";
  } else {
    out.reviewClass = "manual";
    out.lane = "S3_manual_complex_multipick_no_strict_action";
    out.reason = "complex multi-pick hold has no strict action";
  }

  reviewed.push(out);
}

const strict = reviewed.filter((x) => x.reviewClass === "candidate_strict");
const warning = reviewed.filter((x) => x.reviewClass === "candidate_warning");
const manual = reviewed.filter((x) => x.reviewClass === "manual");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked");

const counts = {
  sourceS3Items: s3Items.length,
  totalReviewed: reviewed.length,
  candidateStrictCount: strict.length,
  candidateWarningCount: warning.length,
  manualCount: manual.length,
  blockedCount: blocked.length,
  strictSplitBundles: strict.reduce((sum, x) => sum + x.bundlesToSplitIfStrictApplied, 0),
  strictExactDuplicateGroups: strict.reduce((sum, x) => sum + x.duplicateGroups.filter((g) => g.safeExactDuplicate).length, 0),
  standalonePickAssetsToCreateIfStrictApplied: strict.reduce((sum, x) => sum + x.standalonePickAssetsToCreateIfStrictApplied, 0),
  exactDuplicateAssetsToRemoveIfStrictApplied: strict.reduce((sum, x) => sum + x.exactDuplicateRemovalCount, 0),
  tradesTouchedIfStrictApplied: new Set(strict.map((x) => x.id)).size,
  teamBucketsTouchedIfStrictApplied: new Set(strict.map((x) => `${x.id}|||${x.team}`)).size,
  netAssetChangeIfStrictApplied: strict.reduce((sum, x) => sum + x.netAssetChangeIfStrictApplied, 0),
  errors: 0
};

const laneCounts = {};
const classCounts = {};
const sourceBucketCounts = {};
const riskCounts = {};
const warningCounts = {};
const errorCounts = {};

for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  sourceBucketCounts[item.sourceBucket || "(blank)"] = (sourceBucketCounts[item.sourceBucket || "(blank)"] || 0) + 1;
  for (const asset of item.reportAssets) {
    for (const risk of asset.risks) riskCounts[risk] = (riskCounts[risk] || 0) + 1;
  }
  for (const warning of item.warnings) warningCounts[warning.split("=")[0]] = (warningCounts[warning.split("=")[0]] || 0) + 1;
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
}

const lines = [];
lines.push("# NFL S3 Complex Multi-Pick Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Review S3 complex multi-pick bundle holds.");
lines.push("- Identify only strict clean splits or safe exact duplicate single-pick removals.");
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
lines.push("## Risk Counts");
if (Object.keys(riskCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(riskCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
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
  lines.push("- Do not apply warning/manual/blocked lanes.");
} else {
  lines.push("- No strict S3 apply lane found.");
  lines.push("- Treat remaining S3 records as manual/source-interpretation holds.");
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
  lines.push(`- netAssetChangeIfStrictApplied: ${item.netAssetChangeIfStrictApplied}`);
  for (const target of item.targetBundles) {
    lines.push(`- splitTarget: index=${target.currentIndex} create=${target.createCount} net=${target.netAssetChange} :: ${target.text}`);
    for (const part of target.partChecks) lines.push(`  - part: ok=${part.ok} existing=${part.existingMatches.length} :: ${part.text}`);
  }
  for (const group of item.duplicateGroups.filter((g) => g.safeExactDuplicate)) {
    lines.push(`- duplicateGroup: type=${group.type} count=${group.count} keep=${group.keepIndex} remove=${group.removeIndexes.join(",")} :: ${group.text}`);
  }
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
  lines.push(`- netAssetChangeIfStrictApplied: ${item.netAssetChangeIfStrictApplied}`);
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
  for (const asset of item.reportAssets.slice(0, 8)) {
    lines.push(`- reportAsset: matches=${asset.currentMatchCount} type=${asset.type} picks=${asset.pickMentions} risks=${asset.risks.join("|") || "none"} parts=${asset.parts.length} allPartsStrict=${asset.allPartsStrict} :: ${asset.text}`);
  }
  for (const group of item.duplicateGroups.slice(0, 5)) {
    lines.push(`- duplicateGroup: safe=${group.safeExactDuplicate} type=${group.type} count=${group.count} keep=${group.keepIndex} remove=${group.removeIndexes.join(",")} :: ${group.text}`);
    lines.push(`  - flags: ${group.flags.join("|") || "none"}`);
  }
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
  "strictSplitBundles",
  "exactDuplicateRemovalCount",
  "netAssetChangeIfStrictApplied",
  "reportAssets",
  "duplicateGroups",
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
    item.bundlesToSplitIfStrictApplied,
    item.exactDuplicateRemovalCount,
    item.netAssetChangeIfStrictApplied,
    item.reportAssets.map((a) => `${a.type} matches=${a.currentMatchCount} risks=${a.risks.join("|") || "none"} parts=${a.parts.length} :: ${a.text}`).join(" || "),
    item.duplicateGroups.map((g) => `${g.safeExactDuplicate ? "SAFE" : "UNSAFE"} ${g.type} keep ${g.keepIndex} remove ${g.removeIndexes.join("|")} :: ${g.text}`).join(" || "),
    item.warnings.join("|"),
    item.errors.join("|")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, sourceBucketCounts, riskCounts, warningCounts, errorCounts, reviewed, candidateStrict: strict, candidateWarning: warning, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
