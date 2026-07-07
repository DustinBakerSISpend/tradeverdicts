const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 80);

const lanePath = path.join("reports", "quality", "nfl-cd-reviewed-bundle-lanes-preview-v1.json");
const outTxt = path.join("reports", "quality", "nfl-c-explanatory-remaining-lanes-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-c-explanatory-remaining-lanes-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-c-explanatory-remaining-lanes-review-v1.csv");

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

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\s*\d{1,3}\b/i.test(String(s || ""));
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

function balancedParens(s) {
  let depth = 0;
  for (const ch of String(s || "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function getRiskFlags(s) {
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
      if (hasPickSignal(next)) {
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

function startsLikePick(part) {
  return /^\s*(?:\d{4}|draft pick|conditional|future|past|undisclosed|unspecified)/i.test(String(part || ""));
}

function partIsCleanPick(part) {
  const text = String(part || "").trim();
  const risks = getRiskFlags(text).filter((risk) => risk !== "explanatory_or_contingent");

  return {
    text,
    ok: risks.length === 0 && startsLikePick(text) && hasPickSignal(text) && countPickMentions(text) === 1,
    risks,
    startsLikePick: startsLikePick(text),
    hasPickSignal: hasPickSignal(text),
    pickMentions: countPickMentions(text),
    explanatory: /\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(text)
  };
}

function classifyText(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const risks = getRiskFlags(raw);
  const pickMentions = countPickMentions(raw);

  const hasSubsequently = /\bsubsequently\b/i.test(raw);
  const hasTradedTo = /\btraded to\b/i.test(raw);
  const hasAwarded = /\bawarded\b/i.test(raw);
  const hasReplaced = /\breplaced\b/i.test(raw);
  const hasBecauseAfterLater = /\b(?:because|after|later)\b/i.test(raw);
  const hasProperty = /\b(?:property of|ruled property)\b/i.test(raw);
  const hasVoidForfeit = /\b(?:void|forfeited)\b/i.test(raw);
  const hasProbablyInstead = /\b(?:probably|instead)\b/i.test(raw);

  if (risks.includes("unbalanced_parentheses")) {
    return { lane: "CEX_blocked_unbalanced_parentheses", reviewClass: "blocked", reason: "unbalanced parentheses", risks, parts: [] };
  }

  if (risks.includes("and_or") || risks.includes("dash_or") || risks.includes("or_word") || risks.includes("slash_alternative")) {
    return { lane: "CEX_blocked_alternative_wording", reviewClass: "blocked", reason: "alternative OR/slash wording", risks, parts: [] };
  }

  if (risks.includes("cash_consideration_ptbnl_conditional")) {
    return { lane: "CEX_blocked_cash_ptbnl_conditional", reviewClass: "blocked", reason: "cash/consideration/PTBNL/conditional wording", risks, parts: [] };
  }

  if (pickMentions < 2) {
    return { lane: "CEX_not_multipick_after_review", reviewClass: "manual", reason: "less than two pick mentions", risks, parts: [] };
  }

  const punctParts = topLevelSplit(raw, "punct");
  const andParts = topLevelSplit(raw, "and");

  const punctChecks = punctParts.map(partIsCleanPick);
  const andChecks = andParts.map(partIsCleanPick);

  // Possible narrow lane: explanatory text is inside parentheticals, but top-level delimiter gives clean single-pick parts.
  if (punctParts.length >= 2 && punctChecks.every((part) => part.ok || (part.explanatory && part.pickMentions === 1 && part.startsLikePick && part.hasPickSignal))) {
    return {
      lane: "CEX1_punct_delimited_explanatory_pick_parts_review_candidate",
      reviewClass: "candidate_review",
      reason: "top-level punctuation yields single-pick parts with explanatory parentheticals",
      risks,
      parts: punctParts,
      partChecks: punctChecks
    };
  }

  if (andParts.length === 2 && andChecks.every((part) => part.ok || (part.explanatory && part.pickMentions === 1 && part.startsLikePick && part.hasPickSignal))) {
    return {
      lane: "CEX2_and_delimited_explanatory_pick_parts_review_candidate",
      reviewClass: "candidate_review",
      reason: "top-level and yields two single-pick parts with explanatory parentheticals",
      risks,
      parts: andParts,
      partChecks: andChecks
    };
  }

  if (hasSubsequently && hasTradedTo) {
    return { lane: "CEX3_subsequently_traded_to_manual_review", reviewClass: "manual", reason: "subsequently traded to wording", risks, parts: punctParts.length > 1 ? punctParts : andParts };
  }

  if (hasAwarded || hasReplaced) {
    return { lane: "CEX4_awarded_replaced_manual_review", reviewClass: "manual", reason: "awarded/replaced wording", risks, parts: punctParts.length > 1 ? punctParts : andParts };
  }

  if (hasBecauseAfterLater) {
    return { lane: "CEX5_because_after_later_manual_review", reviewClass: "manual", reason: "because/after/later explanatory wording", risks, parts: punctParts.length > 1 ? punctParts : andParts };
  }

  if (hasProperty) {
    return { lane: "CEX6_property_of_manual_review", reviewClass: "manual", reason: "property-of wording", risks, parts: punctParts.length > 1 ? punctParts : andParts };
  }

  if (hasVoidForfeit || hasProbablyInstead) {
    return { lane: "CEX7_void_forfeit_probably_instead_manual_review", reviewClass: "manual", reason: "void/forfeit/probably/instead wording", risks, parts: punctParts.length > 1 ? punctParts : andParts };
  }

  return { lane: "CEXZ_other_explanatory_manual_review", reviewClass: "manual", reason: "other explanatory multi-pick wording", risks, parts: punctParts.length > 1 ? punctParts : andParts };
}

const laneJson = JSON.parse(fs.readFileSync(lanePath, "utf8"));
const results = (laneJson && laneJson.results) || {};

const keys = Object.keys(results).filter((key) =>
  /^C_blocked_/.test(key) ||
  key === "C4_multi_pick_other_review" ||
  key === "C3_and_word_multi_pick_review"
);

const sourceItems = [];
for (const key of keys) {
  for (const item of results[key] || []) {
    const text = String(item.assetText || "");
    if (hasPickSignal(text) && countPickMentions(text) >= 2) {
      sourceItems.push({ ...item, sourceLaneKey: key });
    }
  }
}

const reviewed = sourceItems.map((item, idx) => {
  const classified = classifyText(item.assetText);

  return {
    ordinal: idx + 1,
    id: item.id,
    slug: item.slug,
    team: item.team,
    sourceBucket: item.sourceBucket,
    sourceLaneKey: item.sourceLaneKey,
    assetIndex: item.assetIndex,
    assetType: item.assetType,
    before: item.assetText,
    pickMentions: countPickMentions(item.assetText),
    ...classified
  };
});

const counts = {
  sourceLaneKeys: keys.length,
  totalSourceItems: sourceItems.length,
  totalReviewed: reviewed.length,
  candidateReviewCount: reviewed.filter((x) => x.reviewClass === "candidate_review").length,
  manualCount: reviewed.filter((x) => x.reviewClass === "manual").length,
  blockedCount: reviewed.filter((x) => x.reviewClass === "blocked").length,
  errors: 0
};

const laneCounts = {};
const sourceKeyCounts = {};
const classCounts = {};
const riskCounts = {};

for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  sourceKeyCounts[item.sourceLaneKey] = (sourceKeyCounts[item.sourceLaneKey] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  for (const risk of item.risks || []) riskCounts[risk] = (riskCounts[risk] || 0) + 1;
}

const candidates = reviewed.filter((x) => x.reviewClass === "candidate_review");
const manual = reviewed.filter((x) => x.reviewClass === "manual");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked");

const lines = [];
lines.push("# NFL C Explanatory Remaining Lanes Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Review remaining C-blocked/C3/C4 multi-pick assets after C2 and C3A cleanup.");
lines.push("- Classify explanatory/contingent historical pick wording into narrower lanes.");
lines.push("- Does not modify trades.json.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Source Lane Counts");
for (const [k, v] of Object.entries(sourceKeyCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## New Lane Counts");
for (const [k, v] of Object.entries(laneCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Review Class Counts");
for (const [k, v] of Object.entries(classCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Risk Counts");
if (Object.keys(riskCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(riskCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Recommendation");
if (candidates.length > 0) {
  lines.push("- Candidate-review lanes exist, but they are NOT auto-apply lanes yet.");
  lines.push("- Inspect candidate samples and build a second stricter review before any apply script.");
} else {
  lines.push("- No candidate-review lane found. Keep this group manual/specialized.");
}
lines.push("");
lines.push("## Candidate Review Samples");
for (const item of candidates.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceLaneKey: ${item.sourceLaneKey}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- reason: ${item.reason}`);
  lines.push(`- risks: ${(item.risks || []).join(", ") || "none"}`);
  for (const part of item.parts || []) lines.push(`- proposedPartForReview: ${part}`);
}
lines.push("");
lines.push("## Manual Samples");
for (const item of manual.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceLaneKey: ${item.sourceLaneKey}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- reason: ${item.reason}`);
  lines.push(`- risks: ${(item.risks || []).join(", ") || "none"}`);
  for (const part of item.parts || []) lines.push(`- part: ${part}`);
}
lines.push("");
lines.push("## Blocked Samples");
for (const item of blocked.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceLaneKey: ${item.sourceLaneKey}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- reason: ${item.reason}`);
  lines.push(`- risks: ${(item.risks || []).join(", ") || "none"}`);
}

const csvRows = [];
csvRows.push([
  "ordinal",
  "reviewClass",
  "lane",
  "sourceLaneKey",
  "risks",
  "pickMentions",
  "id",
  "team",
  "slug",
  "assetIndex",
  "before",
  "parts",
  "reason"
].map(csvEscape).join(","));

for (const item of reviewed) {
  csvRows.push([
    item.ordinal,
    item.reviewClass,
    item.lane,
    item.sourceLaneKey,
    (item.risks || []).join("|"),
    item.pickMentions,
    item.id,
    item.team,
    item.slug,
    item.assetIndex,
    item.before,
    (item.parts || []).join(" || "),
    item.reason
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, sourceKeyCounts, laneCounts, classCounts, riskCounts, reviewed, candidates, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
