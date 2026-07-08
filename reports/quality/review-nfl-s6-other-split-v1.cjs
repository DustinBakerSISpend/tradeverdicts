const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 120);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const splitJsonPath = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.json");
const outTxt = path.join("reports", "quality", "nfl-s6-other-split-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-s6-other-split-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-s6-other-split-review-v1.csv");

const S6 = "S6_other_split_review";

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

function riskFlags(text) {
  const raw = String(text || "");
  const risks = [];

  if (!balancedParens(raw)) risks.push("unbalanced_parentheses");
  if (/\band\/or\b/i.test(raw)) risks.push("and_or");
  if (/-\s*OR\s*-/i.test(raw)) risks.push("dash_or");
  if (/\bor\b/i.test(raw)) risks.push("or_word");
  if (/\s\/\s/.test(raw)) risks.push("slash_alternative");
  if (/\b(?:cash|money|future considerations?|past considerations?|considerations?|player to be named later|players to be named later|ptbnl)\b/i.test(raw)) risks.push("special_asset");
  if (/\b(?:conditional|condition|if|unless|provided that|depending on)\b/i.test(raw)) risks.push("conditional");
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) risks.push("explanatory_or_contingent");
  if (/\b(?:traded|trade|trades|sent|send|sends|received|receives|acquired|acquires|dealt|shipped)\b/i.test(raw)) risks.push("transaction_verb_leak");
  if (/[.]\s+[A-Z]/.test(raw)) risks.push("sentence_fragment_leak");
  if (/\b(?:to|from|for|via)\s*$/i.test(raw)) risks.push("trailing_connector_fragment");
  if (/\)\s*(?:to|from|for|via)\b/i.test(raw)) risks.push("post_parenthetical_route_language");
  if (/\)\s*[A-Z][a-z]+/i.test(raw)) risks.push("word_glued_after_parenthetical");
  if (/\b(?:rights|option|swap|compensatory|compensation|protected|protection)\b/i.test(raw)) risks.push("rights_or_compensation_language");
  if (/\b(?:unavailable|unknown|not available|n\/a)\b/i.test(raw)) risks.push("unavailable_unknown");

  return [...new Set(risks)];
}

function isNameLike(text) {
  const raw = String(text || "").trim();
  const cleaned = raw
    .replace(/^(?:and|plus|,|;|\+|\|)\s+/i, "")
    .replace(/\s+(?:and|plus|,|;|\+|\|)$/i, "")
    .trim();

  const nameRe = /^[A-Z][A-Za-z.'â€™-]*(?:\s+(?:[A-Z][A-Za-z.'â€™-]*|Jr\.?|Sr\.?|II|III|IV|V)){0,4}$/;

  return nameRe.test(cleaned) && riskFlags(cleaned).length === 0 && countPickMentions(cleaned) === 0;
}

function isSafeExactDuplicateGroup(group) {
  const first = group.assets[0];
  const type = first.type;
  const text = first.text;
  const flags = [...new Set(group.assets.flatMap((a) => a.risks))];
  const pickMentions = Math.max(...group.assets.map((a) => a.pickMentions));
  const exactType = new Set(group.assets.map((a) => a.type)).size === 1;

  if (!exactType) return false;
  if (flags.includes("transaction_verb_leak") || flags.includes("sentence_fragment_leak") || flags.includes("unbalanced_parentheses")) return false;
  if (type === "pick" && pickMentions <= 1 && !flags.includes("or_word") && !flags.includes("slash_alternative")) return true;
  if (type === "player" && isNameLike(text)) return true;
  if ((type === "cash" || type === "consideration") && flags.length <= 1) return true;

  return false;
}

function assetSummary(asset, index) {
  const text = textOf(asset);
  const type = typeOf(asset);
  return {
    index,
    type,
    text,
    norm: norm(text),
    compact: compact(text),
    pickMentions: countPickMentions(text),
    risks: riskFlags(text),
    nameLike: isNameLike(text)
  };
}

function collectS6Items(splitReport) {
  const arr = (((splitReport || {}).buckets || {})[S6]) || [];
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

function topLevelDelimiterCount(text) {
  const raw = String(text || "");
  let depth = 0;
  let count = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ";" || ch === "|" || ch === "+" || ch === ",")) count++;
  }
  const ands = raw.match(/\s+and\s+/gi) || [];
  return count + ands.length;
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const splitReport = readJson(splitJsonPath);
const s6Items = collectS6Items(splitReport);

const reviewed = [];

for (const [idx, item] of s6Items.entries()) {
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
    duplicateGroups: [],
    exactDuplicateRemovalPlan: [],
    exactDuplicateRemovalCount: 0,
    reportStats: {
      reportAssetCount: 0,
      foundCurrentCount: 0,
      missingCurrentCount: 0,
      maxPickMentions: 0,
      riskSet: [],
      typeSet: [],
      nameLikeCount: 0,
      delimiterSignalCount: 0
    },
    errors: [],
    warnings: []
  };

  if (!trade) {
    out.reviewClass = "blocked";
    out.lane = "S6_blocked_trade_not_found";
    out.reason = "trade not found";
    out.errors.push("trade_not_found");
    reviewed.push(out);
    continue;
  }

  if (out.slug && trade.slug !== out.slug) out.warnings.push(`slug_mismatch_current=${trade.slug}`);

  const bucket = trade.assetsReceived && trade.assetsReceived[out.team];

  if (!Array.isArray(bucket)) {
    out.reviewClass = "blocked";
    out.lane = "S6_blocked_team_bucket_missing";
    out.reason = "team bucket missing";
    out.errors.push("team_bucket_missing_or_not_array");
    reviewed.push(out);
    continue;
  }

  out.currentBucketFound = true;
  out.currentAssets = bucket.map(assetSummary);

  const reportAssets = out.reportAssets.map((asset) => {
    const matches = out.currentAssets.filter((cur) => norm(cur.text) === norm(asset.text));
    const risks = riskFlags(asset.text);
    const pickMentions = countPickMentions(asset.text);
    const delimiterSignalCount = topLevelDelimiterCount(asset.text);
    return {
      ...asset,
      currentMatchIndexes: matches.map((m) => m.index),
      currentMatchCount: matches.length,
      pickMentions,
      risks,
      nameLike: isNameLike(asset.text),
      delimiterSignalCount
    };
  });

  out.reportAssets = reportAssets;

  out.reportStats.reportAssetCount = reportAssets.length;
  out.reportStats.foundCurrentCount = reportAssets.filter((a) => a.currentMatchCount > 0).length;
  out.reportStats.missingCurrentCount = reportAssets.filter((a) => a.currentMatchCount === 0).length;
  out.reportStats.maxPickMentions = Math.max(0, ...reportAssets.map((a) => a.pickMentions));
  out.reportStats.riskSet = [...new Set(reportAssets.flatMap((a) => a.risks))].sort();
  out.reportStats.typeSet = [...new Set(reportAssets.map((a) => a.type || "(blank)"))].sort();
  out.reportStats.nameLikeCount = reportAssets.filter((a) => a.nameLike).length;
  out.reportStats.delimiterSignalCount = reportAssets.reduce((sum, a) => sum + a.delimiterSignalCount, 0);

  const groupMap = new Map();

  for (const asset of out.currentAssets) {
    const key = `${asset.type || "(blank)"}|||${asset.norm}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(asset);
  }

  const duplicateGroupsRaw = [...groupMap.entries()]
    .map(([key, assets]) => ({ key, assets }))
    .filter((group) => group.assets.length > 1);

  out.duplicateGroups = duplicateGroupsRaw.map((group) => {
    const first = group.assets[0];
    const flags = [...new Set(group.assets.flatMap((a) => a.risks))];
    const safeExactDuplicate = isSafeExactDuplicateGroup(group);
    return {
      key: group.key,
      type: first.type,
      text: first.text,
      indexes: group.assets.map((a) => a.index),
      keepIndex: group.assets[0].index,
      removeIndexes: group.assets.slice(1).map((a) => a.index),
      count: group.assets.length,
      removalCount: group.assets.length - 1,
      flags,
      pickMentions: Math.max(...group.assets.map((a) => a.pickMentions)),
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

  if (out.exactDuplicateRemovalCount > 0 && unsafeDuplicateGroups.length === 0) {
    out.reviewClass = "candidate_strict";
    out.lane = "S6D1_strict_remove_safe_exact_duplicate_assets";
    out.reason = "safe exact duplicate assets exist in current team bucket; keep first and remove later duplicate(s)";
  } else if (out.exactDuplicateRemovalCount > 0 && unsafeDuplicateGroups.length > 0) {
    out.reviewClass = "candidate_warning";
    out.lane = "S6D_warning_mixed_safe_and_unsafe_duplicate_groups";
    out.reason = "safe exact duplicate removals exist, but unsafe duplicate groups also exist";
  } else if (out.duplicateGroups.length > 0) {
    out.reviewClass = "manual";
    out.lane = "S6_manual_duplicate_groups_not_safe_exact";
    out.reason = "duplicate groups exist but are not safe exact duplicate removals";
  } else if (out.reportStats.riskSet.includes("transaction_verb_leak") || out.reportStats.riskSet.includes("sentence_fragment_leak")) {
    out.reviewClass = "manual";
    out.lane = "S6_manual_transaction_or_sentence_context";
    out.reason = "report assets include transaction/source sentence context";
  } else if (out.reportStats.riskSet.includes("conditional") || out.reportStats.riskSet.includes("or_word") || out.reportStats.riskSet.includes("slash_alternative") || out.reportStats.riskSet.includes("special_asset")) {
    out.reviewClass = "manual";
    out.lane = "S6_manual_conditional_special_or_alternative";
    out.reason = "report assets include conditional/special/or language requiring source interpretation";
  } else if (out.reportStats.maxPickMentions >= 2 || out.reportStats.delimiterSignalCount > 0) {
    out.reviewClass = "manual";
    out.lane = "S6_manual_complex_bundle_no_strict_split";
    out.reason = "bundle-like or multi-pick signals remain, but no strict split action was found";
  } else if (out.reportStats.nameLikeCount > 0) {
    out.reviewClass = "manual";
    out.lane = "S6_manual_player_or_name_like_no_strict_action";
    out.reason = "player/name-like asset hold has no safe duplicate action";
  } else if (out.reportStats.missingCurrentCount > 0) {
    out.reviewClass = "manual";
    out.lane = "S6_manual_report_assets_missing_current_no_action";
    out.reason = "some report assets no longer match current bucket; likely overlap already cleaned";
  } else {
    out.reviewClass = "manual";
    out.lane = "S6_manual_other_no_strict_action";
    out.reason = "other asset-structure hold has no strict action";
  }

  reviewed.push(out);
}

const strict = reviewed.filter((x) => x.reviewClass === "candidate_strict");
const warning = reviewed.filter((x) => x.reviewClass === "candidate_warning");
const manual = reviewed.filter((x) => x.reviewClass === "manual");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked");

const counts = {
  sourceS6Items: s6Items.length,
  totalReviewed: reviewed.length,
  candidateStrictCount: strict.length,
  candidateWarningCount: warning.length,
  manualCount: manual.length,
  blockedCount: blocked.length,
  strictExactDuplicateGroups: strict.reduce((sum, x) => sum + x.duplicateGroups.filter((g) => g.safeExactDuplicate).length, 0),
  exactDuplicateAssetsToRemoveIfStrictApplied: strict.reduce((sum, x) => sum + x.exactDuplicateRemovalCount, 0),
  tradesTouchedIfStrictApplied: new Set(strict.map((x) => x.id)).size,
  teamBucketsTouchedIfStrictApplied: new Set(strict.map((x) => `${x.id}|||${x.team}`)).size,
  netAssetChangeIfStrictApplied: -strict.reduce((sum, x) => sum + x.exactDuplicateRemovalCount, 0),
  errors: 0
};

const laneCounts = {};
const classCounts = {};
const sourceBucketCounts = {};
const riskCounts = {};
const typeSetCounts = {};
const warningCounts = {};
const errorCounts = {};

for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  sourceBucketCounts[item.sourceBucket || "(blank)"] = (sourceBucketCounts[item.sourceBucket || "(blank)"] || 0) + 1;
  for (const risk of item.reportStats.riskSet) riskCounts[risk] = (riskCounts[risk] || 0) + 1;
  typeSetCounts[item.reportStats.typeSet.join("|") || "(none)"] = (typeSetCounts[item.reportStats.typeSet.join("|") || "(none)"] || 0) + 1;
  for (const warning of item.warnings) warningCounts[warning.split("=")[0]] = (warningCounts[warning.split("=")[0]] || 0) + 1;
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
}

const lines = [];
lines.push("# NFL S6 Other Split Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Review S6 other split/asset-structure holds.");
lines.push("- Identify only safe exact duplicate removals.");
lines.push("- Do not split complex S6 records automatically.");
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
lines.push("## Risk Counts By Item");
if (Object.keys(riskCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(riskCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Type Set Counts");
for (const [k, v] of Object.entries(typeSetCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
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
  lines.push("- S6D1 removes safe exact duplicate assets only, keeping the first occurrence.");
  lines.push("- Do not split S6 bundles automatically.");
} else {
  lines.push("- No strict S6 duplicate-removal lane found.");
  lines.push("- Treat remaining S6 records as manual/junk-drawer asset-structure holds.");
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
  lines.push(`- exactDuplicateRemovalCount: ${item.exactDuplicateRemovalCount}`);
  for (const group of item.duplicateGroups.filter((g) => g.safeExactDuplicate)) {
    lines.push(`- duplicateGroup: type=${group.type} count=${group.count} keep=${group.keepIndex} remove=${group.removeIndexes.join(",")} :: ${group.text}`);
    lines.push(`  - flags: ${group.flags.join("|") || "none"}`);
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
  lines.push(`- exactDuplicateRemovalCount: ${item.exactDuplicateRemovalCount}`);
  for (const group of item.duplicateGroups) {
    lines.push(`- duplicateGroup: safe=${group.safeExactDuplicate} type=${group.type} count=${group.count} keep=${group.keepIndex} remove=${group.removeIndexes.join(",")} :: ${group.text}`);
    lines.push(`  - flags: ${group.flags.join("|") || "none"}`);
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
  lines.push(`- reportStats: found=${item.reportStats.foundCurrentCount} missing=${item.reportStats.missingCurrentCount} maxPicks=${item.reportStats.maxPickMentions} types=${item.reportStats.typeSet.join("|")} risks=${item.reportStats.riskSet.join("|") || "none"}`);
  for (const asset of item.reportAssets.slice(0, 8)) {
    lines.push(`- reportAsset: matches=${asset.currentMatchCount} type=${asset.type} picks=${asset.pickMentions} nameLike=${asset.nameLike} risks=${asset.risks.join("|") || "none"} :: ${asset.text}`);
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
  "exactDuplicateRemovalCount",
  "reportAssetCount",
  "foundCurrentCount",
  "missingCurrentCount",
  "maxPickMentions",
  "typeSet",
  "riskSet",
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
    item.exactDuplicateRemovalCount,
    item.reportStats.reportAssetCount,
    item.reportStats.foundCurrentCount,
    item.reportStats.missingCurrentCount,
    item.reportStats.maxPickMentions,
    item.reportStats.typeSet.join("|"),
    item.reportStats.riskSet.join("|"),
    item.reportAssets.map((a) => `${a.type} matches=${a.currentMatchCount} risks=${a.risks.join("|") || "none"} :: ${a.text}`).join(" || "),
    item.duplicateGroups.map((g) => `${g.safeExactDuplicate ? "SAFE" : "UNSAFE"} ${g.type} keep ${g.keepIndex} remove ${g.removeIndexes.join("|")} :: ${g.text}`).join(" || "),
    item.warnings.join("|"),
    item.errors.join("|")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, sourceBucketCounts, riskCounts, typeSetCounts, warningCounts, errorCounts, reviewed, candidateStrict: strict, candidateWarning: warning, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
