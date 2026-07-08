const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 120);

const sourcePath = path.join("reports", "quality", "nfl-c-no-delimiter-multipick-split-review-v1.json");
const outTxt = path.join("reports", "quality", "nfl-cnd-candidates-strict-review-v2.txt");
const outJson = path.join("reports", "quality", "nfl-cnd-candidates-strict-review-v2.json");
const outCsv = path.join("reports", "quality", "nfl-cnd-candidates-strict-review-v2.csv");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
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

function cndStrictPartRiskFlags(s) {
  const raw = String(s || "");
  const risks = baseRiskFlags(raw);

  // These are the transaction-text leaks that made v1 too permissive.
  if (/\b(?:traded|trade|trades|sent|send|sends|received|receives|acquired|acquires|dealt|shipped)\b/i.test(raw)) {
    risks.push("transaction_verb_leak");
  }

  // A clean asset should not end with connector fragments or route language.
  if (/\b(?:to|from|for|via)\s*$/i.test(raw)) risks.push("trailing_connector_fragment");
  if (/\)\s*(?:to|from|for|via)\b/i.test(raw)) risks.push("post_parenthetical_route_language");
  if (/\)\s*[A-Z][a-z]+/i.test(raw)) risks.push("word_glued_after_parenthetical");

  // Multiple sentence fragments inside one split part means this is not an asset split.
  if (/[.]\s+[A-Z]/.test(raw)) risks.push("sentence_fragment_leak");

  // Team-route language is usually a source note, not asset text.
  if (/\b(?:redskins|commanders|dolphins|jets|browns|ravens|packers|seahawks|falcons|buccaneers|raiders|saints|vikings|cowboys|giants|eagles|bears|lions|steelers|bengals|bills|patriots|broncos|chiefs|chargers|colts|titans|oilers|texans|jaguars|panthers|rams|cardinals|49ers|niners)\b/i.test(raw) &&
      /\b(?:to|from|sent|traded|received)\b/i.test(raw)) {
    risks.push("team_route_language");
  }

  return [...new Set(risks)];
}

function isStrictCleanPart(text) {
  const risks = cndStrictPartRiskFlags(text);
  return {
    ok: countPickMentions(text) === 1 && hasPickSignal(text) && startsLikePick(text) && risks.length === 0,
    risks,
    pickMentions: countPickMentions(text)
  };
}

function exactPartsJoinOriginal(parts, original) {
  return compact(parts.join(" ")) === compact(original);
}

const source = readJson(sourcePath);
const candidates = Array.isArray(source.candidateStrict) ? source.candidateStrict : [];

const reviewed = candidates.map((item, idx) => {
  const parts = (item.partChecks || []).map((p) => p.text || "");
  const partStrictChecks = parts.map((part) => ({ text: part, ...isStrictCleanPart(part) }));
  const allPartsStrict = partStrictChecks.every((p) => p.ok);
  const exactJoin = exactPartsJoinOriginal(parts, item.before || "");
  const beforeRisks = cndStrictPartRiskFlags(item.before || "");
  const beforeHasTransactionLeak = beforeRisks.some((r) => ["transaction_verb_leak", "sentence_fragment_leak", "team_route_language"].includes(r));

  const errors = [];
  const warnings = [];

  if (!allPartsStrict) errors.push("one_or_more_parts_not_strict_clean");
  if (!exactJoin) errors.push("parts_do_not_exactly_join_original");
  if (beforeHasTransactionLeak) errors.push("original_contains_transaction_or_sentence_context");
  if ((item.assetType || "") !== "pick") errors.push(`assetType_not_pick=${item.assetType || "(blank)"}`);

  let reviewClass = "candidate_strict_v2";
  let lane = item.lane;

  if (errors.length > 0) {
    reviewClass = "blocked_v2";
    lane = "CND_v2_blocked_transaction_text_or_non_clean_parts";
  }

  return {
    ordinal: item.ordinal ?? idx + 1,
    sourceLane: item.lane,
    reviewClass,
    lane,
    id: item.id,
    team: item.team,
    slug: item.slug,
    assetIndex: item.assetIndex,
    assetType: item.assetType,
    before: item.before,
    splitParts: parts,
    partStrictChecks,
    exactJoin,
    beforeRisks,
    projectedPartsToCreate: item.projectedPartsToCreate,
    projectedNetAssetChange: item.projectedNetAssetChange,
    errors,
    warnings
  };
});

const strict = reviewed.filter((x) => x.reviewClass === "candidate_strict_v2");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked_v2");

const counts = {
  sourceCandidateStrictV1: candidates.length,
  candidateStrictV2Count: strict.length,
  blockedV2Count: blocked.length,
  strictRemoveBundleAllPartsAlreadyExist: strict.filter((x) => x.sourceLane === "CND1_strict_remove_bundle_all_parts_already_exist").length,
  strictSplitCreateMissingDedupeExisting: strict.filter((x) => x.sourceLane === "CND2_strict_split_bundle_create_missing_parts_dedupe_existing_parts").length,
  strictSplitNoDelimiterBundles: strict.filter((x) => x.sourceLane === "CND3_strict_split_no_delimiter_multipick_bundle").length,
  bundlesToReplaceOrRemoveIfStrictApplied: strict.length,
  standalonePickAssetsToCreateIfStrictApplied: strict.reduce((sum, x) => sum + (x.projectedPartsToCreate || 0), 0),
  netAssetChangeIfStrictApplied: strict.reduce((sum, x) => sum + (x.projectedNetAssetChange || 0), 0),
  errors: 0
};

const errorCounts = {};
const sourceLaneCounts = {};
const strictSourceLaneCounts = {};
for (const item of reviewed) {
  sourceLaneCounts[item.sourceLane] = (sourceLaneCounts[item.sourceLane] || 0) + 1;
  if (item.reviewClass === "candidate_strict_v2") {
    strictSourceLaneCounts[item.sourceLane] = (strictSourceLaneCounts[item.sourceLane] || 0) + 1;
  }
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
  for (const check of item.partStrictChecks) {
    for (const risk of check.risks) {
      if (!check.ok) errorCounts[`partRisk_${risk}`] = (errorCounts[`partRisk_${risk}`] || 0) + 1;
    }
  }
}

const lines = [];
lines.push("# NFL CND Candidate Strict Review v2");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY STRICT SECOND PASS");
lines.push("");
lines.push("Purpose:");
lines.push("- Reclassify v1 CND candidate_strict items with stricter text-contamination filters.");
lines.push("- Blocks split parts containing transaction-route language like Traded, sent, to/from/for fragments, or sentence text.");
lines.push("- Does not modify trades.json.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Source Lane Counts");
for (const [k, v] of Object.entries(sourceLaneCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Strict V2 Source Lane Counts");
if (Object.keys(strictSourceLaneCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(strictSourceLaneCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Error Counts");
if (Object.keys(errorCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(errorCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Recommendation");
if (strict.length > 0) {
  lines.push("- A later apply script may target candidate_strict_v2 only after sample inspection.");
  lines.push("- Do not use the v1 strict list directly.");
} else {
  lines.push("- No CND strict apply lane survives v2. Do not apply the CND lane.");
}
lines.push("");
lines.push("## Strict V2 Samples");
for (const item of strict.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- sourceLane: ${item.sourceLane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  for (const part of item.partStrictChecks) lines.push(`- splitPart: ${part.text}`);
}
lines.push("");
lines.push("## Blocked V2 Samples");
for (const item of blocked.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- sourceLane: ${item.sourceLane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- errors: ${item.errors.join(" | ") || "none"}`);
  lines.push(`- beforeRisks: ${item.beforeRisks.join(" | ") || "none"}`);
  lines.push(`- before: ${item.before}`);
  for (const part of item.partStrictChecks) {
    lines.push(`- splitPart: ok=${part.ok} picks=${part.pickMentions} risks=${part.risks.join("|") || "none"} :: ${part.text}`);
  }
}

const csvRows = [];
csvRows.push([
  "ordinal",
  "reviewClass",
  "sourceLane",
  "lane",
  "id",
  "team",
  "slug",
  "assetIndex",
  "before",
  "splitParts",
  "errors",
  "beforeRisks"
].map(csvEscape).join(","));

for (const item of reviewed) {
  csvRows.push([
    item.ordinal,
    item.reviewClass,
    item.sourceLane,
    item.lane,
    item.id,
    item.team,
    item.slug,
    item.assetIndex,
    item.before,
    item.splitParts.join(" || "),
    item.errors.join("|"),
    item.beforeRisks.join("|")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, errorCounts, sourceLaneCounts, strictSourceLaneCounts, reviewed, candidateStrictV2: strict, blockedV2: blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
