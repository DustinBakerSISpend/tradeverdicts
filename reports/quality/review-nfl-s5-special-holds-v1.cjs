const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 120);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const splitJsonPath = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.json");
const outTxt = path.join("reports", "quality", "nfl-s5-special-holds-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-s5-special-holds-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-s5-special-holds-review-v1.csv");

const S5 = "S5_cash_consideration_ptbnl_or_conditional_review";

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

function keyOf(asset) {
  return `${typeOf(asset) || "(blank)"}|||${norm(textOf(asset))}`;
}

function compact(s) {
  return norm(s).replace(/[^a-z0-9]+/g, "").trim();
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

function specialFlags(text) {
  const raw = String(text || "");
  const flags = [];

  if (/\b(?:cash|money|undisclosed cash|cash considerations?)\b/i.test(raw)) flags.push("cash");
  if (/\b(?:future considerations?|past considerations?|considerations?)\b/i.test(raw)) flags.push("considerations");
  if (/\b(?:player to be named later|players to be named later|ptbnl)\b/i.test(raw)) flags.push("ptbnl");
  if (/\b(?:conditional|condition|if|unless|provided that|depending on)\b/i.test(raw)) flags.push("conditional");
  if (/\bor\b/i.test(raw) || /\//.test(raw) || /\band\/or\b/i.test(raw)) flags.push("alternative_or_slash");
  if (/\b(?:rights|option|swap|compensatory|compensation)\b/i.test(raw)) flags.push("special_rights_compensation");
  if (/\b(?:traded|trade|trades|sent|send|sends|received|receives|acquired|acquires|dealt|shipped)\b/i.test(raw)) flags.push("transaction_verb_leak");
  if (/[.]\s+[A-Z]/.test(raw)) flags.push("sentence_fragment_leak");
  if (/\b(?:to|from|for|via)\s*$/i.test(raw)) flags.push("trailing_connector_fragment");
  if (/\)\s*(?:to|from|for|via)\b/i.test(raw)) flags.push("post_parenthetical_route_language");

  return [...new Set(flags)];
}

function isPlainSpecialAsset(text) {
  const flags = specialFlags(text);
  const t = norm(text);

  // This is for duplicate-removal confidence only, not for splitting.
  const plainPatterns = [
    /^cash$/,
    /^cash considerations?$/,
    /^undisclosed cash$/,
    /^future considerations?$/,
    /^past considerations?$/,
    /^player to be named later$/,
    /^players to be named later$/,
    /^ptbnl$/,
    /^conditional pick$/,
    /^conditional draft pick$/,
    /^undisclosed draft pick$/,
    /^draft pick compensation$/
  ];

  return {
    ok: plainPatterns.some((re) => re.test(t)) && !flags.includes("transaction_verb_leak") && !flags.includes("sentence_fragment_leak"),
    flags
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
    specialFlags: specialFlags(text),
    plainSpecial: isPlainSpecialAsset(text).ok
  };
}

function collectS5Items(splitReport) {
  const arr = (((splitReport || {}).buckets || {})[S5]) || [];
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

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const splitReport = readJson(splitJsonPath);
const s5Items = collectS5Items(splitReport);

const reviewed = [];

for (const [idx, item] of s5Items.entries()) {
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
    s5AssetsFoundCurrent: 0,
    s5AssetsMissingCurrent: 0,
    allDuplicateGroupsPlainSpecialOrExactPick: false,
    errors: [],
    warnings: []
  };

  if (!trade) {
    out.reviewClass = "blocked";
    out.lane = "S5_blocked_trade_not_found";
    out.reason = "trade not found";
    out.errors.push("trade_not_found");
    reviewed.push(out);
    continue;
  }

  if (out.slug && trade.slug !== out.slug) out.warnings.push(`slug_mismatch_current=${trade.slug}`);

  const bucket = trade.assetsReceived && trade.assetsReceived[out.team];

  if (!Array.isArray(bucket)) {
    out.reviewClass = "blocked";
    out.lane = "S5_blocked_team_bucket_missing";
    out.reason = "team bucket missing";
    out.errors.push("team_bucket_missing_or_not_array");
    reviewed.push(out);
    continue;
  }

  out.currentBucketFound = true;
  out.currentAssets = bucket.map(assetSummary);

  // Match the S5 report assets against the current team bucket.
  const reportAssets = out.reportAssets.map((asset) => {
    const matches = out.currentAssets.filter((cur) => norm(cur.text) === norm(asset.text));
    return {
      ...asset,
      currentMatchIndexes: matches.map((m) => m.index),
      currentMatchCount: matches.length,
      specialFlags: specialFlags(asset.text),
      pickMentions: countPickMentions(asset.text),
      plainSpecial: isPlainSpecialAsset(asset.text).ok
    };
  });

  out.reportAssets = reportAssets;
  out.s5AssetsFoundCurrent = reportAssets.filter((a) => a.currentMatchCount > 0).length;
  out.s5AssetsMissingCurrent = reportAssets.filter((a) => a.currentMatchCount === 0).length;

  const groupMap = new Map();

  for (const asset of out.currentAssets) {
    const key = `${asset.type || "(blank)"}|||${asset.norm}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(asset);
  }

  const duplicateGroups = [...groupMap.entries()]
    .map(([key, assets]) => ({ key, assets }))
    .filter((group) => group.assets.length > 1);

  out.duplicateGroups = duplicateGroups.map((group) => {
    const flags = [...new Set(group.assets.flatMap((a) => a.specialFlags))];
    const pickMentions = Math.max(...group.assets.map((a) => a.pickMentions));
    const plainSpecial = group.assets.every((a) => a.plainSpecial);
    const exactType = new Set(group.assets.map((a) => a.type)).size === 1;
    const type = group.assets[0].type;
    const text = group.assets[0].text;

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
      plainSpecial,
      exactType,
      safeExactDuplicate: exactType && (
        plainSpecial ||
        (type === "pick" && pickMentions <= 1 && !flags.includes("transaction_verb_leak") && !flags.includes("sentence_fragment_leak")) ||
        (type === "cash" && !flags.includes("transaction_verb_leak") && !flags.includes("sentence_fragment_leak"))
      )
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
  out.allDuplicateGroupsPlainSpecialOrExactPick = out.duplicateGroups.length > 0 && unsafeDuplicateGroups.length === 0;

  if (out.exactDuplicateRemovalCount > 0 && unsafeDuplicateGroups.length === 0) {
    out.reviewClass = "candidate_strict";
    out.lane = "S5D1_strict_remove_safe_exact_duplicate_special_assets";
    out.reason = "team bucket has safe exact duplicate special/pick assets; keep first and remove later duplicate(s)";
  } else if (out.exactDuplicateRemovalCount > 0 && unsafeDuplicateGroups.length > 0) {
    out.reviewClass = "candidate_warning";
    out.lane = "S5D_warning_mixed_safe_and_unsafe_duplicate_groups";
    out.reason = "safe exact duplicate removals exist, but unsafe duplicate groups also exist";
  } else if (out.duplicateGroups.length > 0) {
    out.reviewClass = "manual";
    out.lane = "S5_manual_duplicate_groups_not_safe_exact_special";
    out.reason = "duplicate groups exist but are not safe exact special/pick duplicate removals";
  } else if (reportAssets.some((a) => a.specialFlags.includes("transaction_verb_leak") || a.specialFlags.includes("sentence_fragment_leak"))) {
    out.reviewClass = "manual";
    out.lane = "S5_manual_transaction_or_sentence_context";
    out.reason = "S5 report asset has transaction/source sentence context";
  } else if (reportAssets.some((a) => a.specialFlags.includes("alternative_or_slash") || a.specialFlags.includes("conditional"))) {
    out.reviewClass = "manual";
    out.lane = "S5_manual_conditional_or_alternative_asset";
    out.reason = "conditional/or/slash asset requires manual source interpretation";
  } else if (reportAssets.some((a) => a.specialFlags.includes("cash") || a.specialFlags.includes("considerations") || a.specialFlags.includes("ptbnl"))) {
    out.reviewClass = "manual";
    out.lane = "S5_manual_plain_special_asset_no_duplicate_action";
    out.reason = "plain special asset appears current but no duplicate action is available";
  } else {
    out.reviewClass = "manual";
    out.lane = "S5_manual_other_special_hold_no_action";
    out.reason = "special hold has no strict duplicate action";
  }

  reviewed.push(out);
}

const strict = reviewed.filter((x) => x.reviewClass === "candidate_strict");
const warning = reviewed.filter((x) => x.reviewClass === "candidate_warning");
const manual = reviewed.filter((x) => x.reviewClass === "manual");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked");

const counts = {
  sourceS5Items: s5Items.length,
  totalReviewed: reviewed.length,
  candidateStrictCount: strict.length,
  candidateWarningCount: warning.length,
  manualCount: manual.length,
  blockedCount: blocked.length,
  strictExactDuplicateSpecialGroups: strict.reduce((sum, x) => sum + x.duplicateGroups.filter((g) => g.safeExactDuplicate).length, 0),
  exactDuplicateAssetsToRemoveIfStrictApplied: strict.reduce((sum, x) => sum + x.exactDuplicateRemovalCount, 0),
  tradesTouchedIfStrictApplied: new Set(strict.map((x) => x.id)).size,
  teamBucketsTouchedIfStrictApplied: new Set(strict.map((x) => `${x.id}|||${x.team}`)).size,
  netAssetChangeIfStrictApplied: -strict.reduce((sum, x) => sum + x.exactDuplicateRemovalCount, 0),
  errors: 0
};

const laneCounts = {};
const classCounts = {};
const sourceBucketCounts = {};
const flagCounts = {};
const warningCounts = {};
const errorCounts = {};

for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  sourceBucketCounts[item.sourceBucket || "(blank)"] = (sourceBucketCounts[item.sourceBucket || "(blank)"] || 0) + 1;
  for (const asset of item.reportAssets) {
    for (const flag of asset.specialFlags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
  }
  for (const warning of item.warnings) warningCounts[warning.split("=")[0]] = (warningCounts[warning.split("=")[0]] || 0) + 1;
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
}

const lines = [];
lines.push("# NFL S5 Special Holds Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Review S5 cash/consideration/PTBNL/conditional holds.");
lines.push("- Identify only safe exact duplicate special/pick asset removals.");
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
lines.push("## Special Flag Counts");
if (Object.keys(flagCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(flagCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
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
  lines.push("- S5D1 removes exact duplicate special/pick assets only, keeping the first occurrence.");
  lines.push("- Do not split conditional, PTBNL, cash, or consideration bundles automatically.");
} else {
  lines.push("- No strict S5 duplicate-removal lane found.");
  lines.push("- Treat remaining S5 records as manual/source-interpretation holds.");
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
  lines.push(`- s5AssetsFoundCurrent: ${item.s5AssetsFoundCurrent}`);
  lines.push(`- s5AssetsMissingCurrent: ${item.s5AssetsMissingCurrent}`);
  for (const asset of item.reportAssets.slice(0, 8)) {
    lines.push(`- reportAsset: matches=${asset.currentMatchCount} type=${asset.type} picks=${asset.pickMentions} flags=${asset.specialFlags.join("|") || "none"} plainSpecial=${asset.plainSpecial} :: ${asset.text}`);
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
  "duplicateGroups",
  "reportAssets",
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
    item.duplicateGroups.map((g) => `${g.safeExactDuplicate ? "SAFE" : "UNSAFE"} ${g.type} keep ${g.keepIndex} remove ${g.removeIndexes.join("|")} :: ${g.text}`).join(" || "),
    item.reportAssets.map((a) => `${a.type} matches=${a.currentMatchCount} flags=${a.specialFlags.join("|") || "none"} :: ${a.text}`).join(" || "),
    item.warnings.join("|"),
    item.errors.join("|")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, sourceBucketCounts, flagCounts, warningCounts, errorCounts, reviewed, candidateStrict: strict, candidateWarning: warning, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
