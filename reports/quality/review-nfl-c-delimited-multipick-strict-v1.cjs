const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 120);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const outTxt = path.join("reports", "quality", "nfl-c-delimited-multipick-strict-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-c-delimited-multipick-strict-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-c-delimited-multipick-strict-review-v1.csv");

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

function baseRiskFlags(s) {
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

function strictTextRiskFlags(s) {
  const raw = String(s || "");
  const risks = baseRiskFlags(raw);

  if (/\b(?:traded|trade|trades|sent|send|sends|received|receives|acquired|acquires|dealt|shipped)\b/i.test(raw)) {
    risks.push("transaction_verb_leak");
  }

  if (/\b(?:to|from|for|via)\s*$/i.test(raw)) risks.push("trailing_connector_fragment");
  if (/\)\s*(?:to|from|for|via)\b/i.test(raw)) risks.push("post_parenthetical_route_language");
  if (/\)\s*[A-Z][a-z]+/i.test(raw)) risks.push("word_glued_after_parenthetical");
  if (/[.]\s+[A-Z]/.test(raw)) risks.push("sentence_fragment_leak");

  if (/\b(?:redskins|commanders|dolphins|jets|browns|ravens|packers|seahawks|falcons|buccaneers|raiders|saints|vikings|cowboys|giants|eagles|bears|lions|steelers|bengals|bills|patriots|broncos|chiefs|chargers|colts|titans|oilers|texans|jaguars|panthers|rams|cardinals|49ers|niners)\b/i.test(raw) &&
      /\b(?:to|from|sent|traded|received)\b/i.test(raw)) {
    risks.push("team_route_language");
  }

  return [...new Set(risks)];
}

function isStrictSinglePickText(text) {
  const risks = strictTextRiskFlags(text);
  return {
    ok: countPickMentions(text) === 1 && hasPickSignal(text) && startsLikePick(text) && risks.length === 0,
    risks,
    pickMentions: countPickMentions(text)
  };
}

function topLevelSplit(text, mode) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const parts = [];
  let start = 0;
  let depth = 0;

  function pushPart(end) {
    const part = raw.slice(start, end).trim().replace(/^[,;|]\s*/g, "").replace(/[,;|]\s*$/g, "").trim();
    if (part) parts.push(part);
  }

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);

    if (depth !== 0) continue;

    if ((mode === "punct" || mode === "all") && (ch === ";" || ch === "," || ch === "|")) {
      const next = raw.slice(i + 1).trim();
      if (hasPickSignal(next) || /^(?:19|20)\d{2}\b/.test(next)) {
        pushPart(i);
        start = i + 1;
      }
    }

    if (mode === "and" || mode === "all") {
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

  const last = raw.slice(start).trim().replace(/^[,;|]\s*/g, "").replace(/[,;|]\s*$/g, "").trim();
  if (last) parts.push(last);

  return parts;
}

function bestDelimitedSplit(text) {
  const candidates = [
    { mode: "all", parts: topLevelSplit(text, "all") },
    { mode: "and", parts: topLevelSplit(text, "and") },
    { mode: "punct", parts: topLevelSplit(text, "punct") }
  ];

  for (const c of candidates) {
    c.checks = c.parts.map((part) => ({ text: part, ...isStrictSinglePickText(part) }));
    c.strictParts = c.checks.filter((x) => x.ok).length;
    c.allStrict = c.parts.length >= 2 && c.checks.every((x) => x.ok);
  }

  return candidates.sort((a, b) => {
    if (Number(b.allStrict) !== Number(a.allStrict)) return Number(b.allStrict) - Number(a.allStrict);
    if (b.strictParts !== a.strictParts) return b.strictParts - a.strictParts;
    return b.parts.length - a.parts.length;
  })[0];
}

function hasTopLevelDelimiterBetweenPickStarts(text) {
  const split = bestDelimitedSplit(text);
  return split.parts.length >= 2;
}

function getCurrentMatches(bucket, text, excludeIndex = null) {
  const target = norm(text);
  return bucket
    .map((asset, index) => ({ index, type: typeOf(asset), text: textOf(asset), key: looseKey(textOf(asset)), compact: compact(textOf(asset)), pickMentions: countPickMentions(textOf(asset)) }))
    .filter((asset) => (excludeIndex === null || asset.index !== excludeIndex) && norm(asset.text) === target);
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
      const before = textOf(asset);
      const assetType = typeOf(asset);
      const pickMentions = countPickMentions(before);

      if (pickMentions < 2) continue;
      if (!hasTopLevelDelimiterBetweenPickStarts(before)) continue;

      const split = bestDelimitedSplit(before);
      const originalRisks = strictTextRiskFlags(before);
      const originalHasTransactionLeak = originalRisks.some((r) => [
        "transaction_verb_leak",
        "sentence_fragment_leak",
        "team_route_language",
        "trailing_connector_fragment",
        "post_parenthetical_route_language",
        "word_glued_after_parenthetical"
      ].includes(r));

      const bundleMatches = getCurrentMatches(bucket, before, null);
      const exactCompactJoin = compact(split.parts.join(" ")) === compact(before);

      const partChecks = split.checks.map((check) => ({
        ...check,
        existingMatches: getCurrentMatches(bucket, check.text, assetIndex)
      }));

      const allPartsStrict = partChecks.every((p) => p.ok);
      const anyExistingParts = partChecks.some((p) => p.existingMatches.length > 0);
      const allPartsAlreadyExist = partChecks.every((p) => p.existingMatches.length > 0);
      const multipleExistingPartMatches = partChecks.some((p) => p.existingMatches.length > 1);

      ordinal++;

      const out = {
        ordinal,
        id: trade.id,
        slug: trade.slug,
        team,
        assetIndex,
        assetType,
        before,
        pickMentions,
        splitMode: split.mode,
        splitParts: split.parts,
        partChecks,
        originalRisks,
        originalHasTransactionLeak,
        bundleCurrentMatchCount: bundleMatches.length,
        exactCompactJoin,
        projectedPartsToCreate: partChecks.filter((p) => p.existingMatches.length === 0).length,
        projectedNetAssetChange: partChecks.filter((p) => p.existingMatches.length === 0).length - 1,
        reviewClass: "pending",
        lane: "pending",
        reason: "",
        errors: [],
        warnings: []
      };

      if (assetType && assetType !== "pick") out.warnings.push(`assetType_not_pick=${assetType}`);

      if (bundleMatches.length !== 1) {
        out.reviewClass = "blocked";
        out.lane = "CDEL_blocked_bundle_current_match_count_not_one";
        out.reason = `bundle current match count is ${bundleMatches.length}`;
      } else if (assetType && assetType !== "pick") {
        out.reviewClass = "manual";
        out.lane = "CDEL_manual_asset_type_not_pick";
        out.reason = `asset type is ${assetType}`;
      } else if (originalHasTransactionLeak) {
        out.reviewClass = "manual";
        out.lane = "CDEL_manual_original_has_transaction_or_sentence_context";
        out.reason = `original text risks: ${originalRisks.join("|")}`;
      } else if (!allPartsStrict) {
        out.reviewClass = "manual";
        out.lane = "CDEL_manual_split_parts_not_all_strict_single_picks";
        out.reason = "one or more split parts is not a strict single-pick asset";
      } else if (!exactCompactJoin) {
        out.reviewClass = "candidate_warning";
        out.lane = "CDEL_warning_parts_do_not_exactly_join_original";
        out.reason = "split parts do not compact-join to original";
      } else if (multipleExistingPartMatches) {
        out.reviewClass = "candidate_warning";
        out.lane = "CDEL_warning_multiple_existing_part_matches";
        out.reason = "one or more split parts already exists more than once";
      } else if (allPartsAlreadyExist) {
        out.reviewClass = "candidate_strict";
        out.lane = "CDEL1_strict_remove_bundle_all_parts_already_exist";
        out.reason = "delimited bundle exactly equals standalone pick assets already present";
      } else if (anyExistingParts) {
        out.reviewClass = "candidate_strict";
        out.lane = "CDEL2_strict_split_bundle_create_missing_parts_dedupe_existing_parts";
        out.reason = "delimited bundle splits into strict clean picks; create only missing parts";
      } else {
        out.reviewClass = "candidate_strict";
        out.lane = "CDEL3_strict_split_delimited_multipick_bundle";
        out.reason = "delimited bundle splits into strict clean standalone picks";
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
  totalDelimitedCandidatesReviewed: reviewed.length,
  candidateStrictCount: strict.length,
  candidateWarningCount: warning.length,
  manualCount: manual.length,
  blockedCount: blocked.length,
  strictRemoveBundleAllPartsAlreadyExist: strict.filter((x) => x.lane === "CDEL1_strict_remove_bundle_all_parts_already_exist").length,
  strictSplitCreateMissingDedupeExisting: strict.filter((x) => x.lane === "CDEL2_strict_split_bundle_create_missing_parts_dedupe_existing_parts").length,
  strictSplitDelimitedBundles: strict.filter((x) => x.lane === "CDEL3_strict_split_delimited_multipick_bundle").length,
  bundlesToReplaceOrRemoveIfStrictApplied: strict.length,
  standalonePickAssetsToCreateIfStrictApplied: strict.reduce((sum, x) => sum + x.projectedPartsToCreate, 0),
  netAssetChangeIfStrictApplied: strict.reduce((sum, x) => sum + x.projectedNetAssetChange, 0),
  errors: 0
};

const laneCounts = {};
const classCounts = {};
const assetTypeCounts = {};
const splitModeCounts = {};
const warningCounts = {};
const errorCounts = {};

for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  assetTypeCounts[item.assetType || "(blank)"] = (assetTypeCounts[item.assetType || "(blank)"] || 0) + 1;
  splitModeCounts[item.splitMode || "(none)"] = (splitModeCounts[item.splitMode || "(none)"] || 0) + 1;
  for (const warning of item.warnings) warningCounts[warning.split("=")[0]] = (warningCounts[warning.split("=")[0]] || 0) + 1;
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
  for (const part of item.partChecks) {
    if (!part.ok) {
      for (const risk of part.risks) errorCounts[`partRisk_${risk}`] = (errorCounts[`partRisk_${risk}`] || 0) + 1;
    }
  }
}

const lines = [];
lines.push("# NFL C Delimited Multi-Pick Strict Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Recheck remaining delimited multi-pick bundle assets using strict v2 contamination filters.");
lines.push("- Delimiters include top-level comma, semicolon, pipe, or 'and' before another pick.");
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
  lines.push("- A later apply script may target candidate_strict only after sample inspection.");
  lines.push("- CDEL1 removes a bundle when all split parts already exist.");
  lines.push("- CDEL2 replaces the bundle with only missing split parts and keeps existing standalone parts.");
  lines.push("- CDEL3 replaces the bundle with all split parts.");
  lines.push("- Do not apply warning/manual/blocked lanes without separate review.");
} else {
  lines.push("- No strict CDEL lane found.");
}
lines.push("");
lines.push("## Strict Candidate Samples");
for (const item of strict.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- splitMode: ${item.splitMode}`);
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
  lines.push(`- splitMode: ${item.splitMode}`);
  lines.push(`- reason: ${item.reason}`);
  lines.push(`- before: ${item.before}`);
  for (const part of item.partChecks) {
    lines.push(`- splitPart: ok=${part.ok} picks=${part.pickMentions} risks=${part.risks.join("|") || "none"} :: ${part.text}`);
  }
}

const csvRows = [];
csvRows.push([
  "ordinal",
  "reviewClass",
  "lane",
  "id",
  "team",
  "slug",
  "assetIndex",
  "assetType",
  "splitMode",
  "reason",
  "before",
  "splitParts",
  "existingPartMatches",
  "projectedPartsToCreate",
  "projectedNetAssetChange",
  "warnings",
  "originalRisks"
].map(csvEscape).join(","));

for (const item of reviewed) {
  csvRows.push([
    item.ordinal,
    item.reviewClass,
    item.lane,
    item.id,
    item.team,
    item.slug,
    item.assetIndex,
    item.assetType,
    item.splitMode,
    item.reason,
    item.before,
    item.partChecks.map((x) => x.text).join(" || "),
    item.partChecks.flatMap((x) => x.existingMatches.map((m) => `${x.text} => [${m.index}] ${m.text}`)).join(" || "),
    item.projectedPartsToCreate,
    item.projectedNetAssetChange,
    item.warnings.join("|"),
    item.originalRisks.join("|")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, assetTypeCounts, splitModeCounts, warningCounts, errorCounts, reviewed, candidateStrict: strict, candidateWarning: warning, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
