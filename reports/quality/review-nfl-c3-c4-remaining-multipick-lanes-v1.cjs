const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 80);

const lanePath = path.join("reports", "quality", "nfl-cd-reviewed-bundle-lanes-preview-v1.json");
const outTxt = path.join("reports", "quality", "nfl-c3-c4-remaining-multipick-lanes-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-c3-c4-remaining-multipick-lanes-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-c3-c4-remaining-multipick-lanes-review-v1.csv");

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
  return norm(s)
    .replace(/[;:|()[\]{}.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\s*\d{1,3}\b/i.test(String(s || ""));
}

function hasYear(s) {
  return /\b(19|20)\d{2}\b/.test(String(s || ""));
}

function firstYear(s) {
  const m = String(s || "").match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : "";
}

function countPickMentions(s) {
  const raw = String(s || "");
  const n = norm(raw);
  const roundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b/g) || [];
  const noYearRoundPickMatches = n.match(/\b(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b/g) || [];
  const hashMatches = raw.match(/#\s*\d{1,3}\b/g) || [];
  const overallMatches = raw.match(/\b\d{1,3}(?:st|nd|rd|th)\s+overall\b/gi) || [];

  return Math.max(roundPickMatches.length, noYearRoundPickMatches.length, hashMatches.length, overallMatches.length);
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

function riskFlags(s) {
  const raw = String(s || "");
  const risks = [];

  if (!balancedParens(raw)) risks.push("unbalanced_parentheses");
  if (/\band\/or\b/i.test(raw)) risks.push("and_or");
  if (/-\s*OR\s*-/i.test(raw)) risks.push("dash_or");
  if (/\bor\b/i.test(raw)) risks.push("or_word");
  if (/\s\/\s/.test(raw)) risks.push("slash_alternative");
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) risks.push("explanatory_or_contingent");
  if (/\b(?:cash|future considerations|past considerations|considerations|player to be named later|ptbnl|conditional on|if )\b/i.test(raw)) risks.push("cash_consideration_ptbnl_conditional");

  return risks;
}

function splitTopLevelAnd(text) {
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

    const slice = raw.slice(i);
    const match = slice.match(/^\s+and\s+/i);

    if (match) {
      pushPart(i);
      start = i + match[0].length;
      i = start - 1;
    }
  }

  const last = raw.slice(start).trim().replace(/[;,]\s*$/g, "");
  if (last) parts.push(last);

  return parts;
}

function splitTopLevelPunct(text) {
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

    if (ch === ";" || ch === ",") {
      const next = raw.slice(i + 1).trim();
      if (hasPickSignal(next)) {
        pushPart(i);
        start = i + 1;
      }
    }
  }

  const last = raw.slice(start).trim().replace(/[;,]\s*$/g, "");
  if (last) parts.push(last);

  return parts;
}

function startsLikeFullPick(part) {
  return /^\s*(?:\d{4}|draft pick|conditional|future)\s+/i.test(String(part || ""));
}

function startsLikeNoYearPick(part) {
  return /^\s*(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b/i.test(String(part || ""));
}

function normalizeInheritedYearPart(part, year) {
  const raw = String(part || "").trim();
  if (!year || hasYear(raw) || !startsLikeNoYearPick(raw)) return raw;
  return `${year} ${raw}`;
}

function partCheck(part) {
  const risks = riskFlags(part);
  return {
    text: String(part || "").trim(),
    hasPickSignal: hasPickSignal(part),
    hasYear: hasYear(part),
    startsLikeFullPick: startsLikeFullPick(part),
    startsLikeNoYearPick: startsLikeNoYearPick(part),
    pickMentions: countPickMentions(part),
    riskFlags: risks
  };
}

function classifyItem(item) {
  const text = String(item.assetText || "").replace(/\s+/g, " ").trim();
  const baseRisks = riskFlags(text);

  if (baseRisks.length) {
    return {
      lane: `C34_blocked_${baseRisks[0]}`,
      reviewClass: "blocked",
      riskFlags: baseRisks,
      parts: [],
      normalizedParts: [],
      reason: "asset_level_risk"
    };
  }

  const andParts = splitTopLevelAnd(text);
  const andChecks = andParts.map(partCheck);
  const year = firstYear(text);
  const inherited = andParts.map((part) => normalizeInheritedYearPart(part, year));
  const inheritedChecks = inherited.map(partCheck);

  if (andParts.length === 2) {
    const allDirectFullSafe = andChecks.every((check) =>
      check.riskFlags.length === 0 &&
      check.hasPickSignal &&
      check.hasYear &&
      check.startsLikeFullPick &&
      check.pickMentions === 1
    );

    if (allDirectFullSafe) {
      return {
        lane: "C3A_direct_two_part_and_split_candidate",
        reviewClass: "candidate",
        riskFlags: [],
        parts: andParts,
        normalizedParts: andParts,
        reason: "two direct full pick parts"
      };
    }

    const firstFull = andChecks[0]?.riskFlags.length === 0 &&
      andChecks[0]?.hasPickSignal &&
      andChecks[0]?.hasYear &&
      andChecks[0]?.startsLikeFullPick &&
      andChecks[0]?.pickMentions === 1;

    const secondNoYear = andChecks[1]?.riskFlags.length === 0 &&
      andChecks[1]?.hasPickSignal &&
      !andChecks[1]?.hasYear &&
      andChecks[1]?.startsLikeNoYearPick &&
      andChecks[1]?.pickMentions === 1;

    const inheritedSafe = inheritedChecks.every((check) =>
      check.riskFlags.length === 0 &&
      check.hasPickSignal &&
      check.hasYear &&
      (check.startsLikeFullPick || /^\s*\d{4}\s+/i.test(check.text)) &&
      check.pickMentions === 1
    );

    if (firstFull && secondNoYear && inheritedSafe) {
      return {
        lane: "C3B_inherit_year_two_part_and_split_candidate",
        reviewClass: "candidate",
        riskFlags: [],
        parts: andParts,
        normalizedParts: inherited,
        reason: "second pick omits year but cleanly inherits first year"
      };
    }
  }

  if (andParts.length > 2) {
    return {
      lane: "C3C_many_and_parts_manual_review",
      reviewClass: "manual",
      riskFlags: ["many_and_parts"],
      parts: andParts,
      normalizedParts: inherited,
      reason: "more than two top-level and parts"
    };
  }

  const punctParts = splitTopLevelPunct(text);
  if (punctParts.length > 1) {
    return {
      lane: "C4A_punct_or_mixed_remaining_review",
      reviewClass: "manual",
      riskFlags: [],
      parts: punctParts,
      normalizedParts: punctParts,
      reason: "remaining punct/mixed multi-pick pattern"
    };
  }

  return {
    lane: "C34Z_other_manual_review",
    reviewClass: "manual",
    riskFlags: [],
    parts: andParts,
    normalizedParts: inherited,
    reason: "no clean remaining split lane detected"
  };
}

const laneJson = JSON.parse(fs.readFileSync(lanePath, "utf8"));
const results = (laneJson && laneJson.results) || {};
const sourceItems = [
  ...((results.C3_and_word_multi_pick_review) || []),
  ...((results.C4_multi_pick_other_review) || [])
];

const reviewed = sourceItems.map((item, idx) => {
  const classified = classifyItem(item);

  return {
    ordinal: idx + 1,
    id: item.id,
    slug: item.slug,
    team: item.team,
    sourceBucket: item.sourceBucket,
    sourceLane: item.reason ? item.reason : "",
    assetIndex: item.assetIndex,
    assetType: item.assetType,
    before: item.assetText,
    ...classified
  };
});

const laneCounts = {};
const classCounts = {};
const riskCounts = {};

for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  for (const risk of item.riskFlags || []) riskCounts[risk] = (riskCounts[risk] || 0) + 1;
}

const candidate = reviewed.filter((item) => item.reviewClass === "candidate");
const manual = reviewed.filter((item) => item.reviewClass === "manual");
const blocked = reviewed.filter((item) => item.reviewClass === "blocked");

const counts = {
  totalSourceItems: sourceItems.length,
  totalReviewed: reviewed.length,
  candidateCount: candidate.length,
  manualCount: manual.length,
  blockedCount: blocked.length,
  errors: 0
};

const lines = [];
lines.push("# NFL C3/C4 Remaining Multi-Pick Lanes Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Review remaining C3/C4 multi-pick assets after C2 cleanup.");
lines.push("- Find narrow next candidates, especially two-part 'and' assets where the second pick omits the year.");
lines.push("- Does not modify trades.json.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Lane Counts");
for (const [k, v] of Object.entries(laneCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Review Class Counts");
for (const [k, v] of Object.entries(classCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Risk Counts");
if (Object.keys(riskCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(riskCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${k}: ${v}`);
  }
}
lines.push("");
lines.push("## Recommendation");
if (candidate.length > 0) {
  lines.push("- Build any future apply script for candidate lanes only.");
  lines.push("- Review samples below before applying anything.");
  lines.push("- Keep manual/blocked lanes out of auto-apply.");
} else {
  lines.push("- No candidate lane found. Stay manual/specialized review.");
}
lines.push("");
lines.push("## Candidate Samples");
for (const item of candidate.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- reason: ${item.reason}`);
  for (const part of item.parts || []) lines.push(`- originalPart: ${part}`);
  for (const part of item.normalizedParts || []) lines.push(`- proposedPart: ${part}`);
}
lines.push("");
lines.push("## Manual Samples");
for (const item of manual.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- reason: ${item.reason}`);
  if (item.riskFlags && item.riskFlags.length) lines.push(`- riskFlags: ${item.riskFlags.join(", ")}`);
  for (const part of item.parts || []) lines.push(`- part: ${part}`);
}
lines.push("");
lines.push("## Blocked Samples");
for (const item of blocked.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- reason: ${item.reason}`);
  if (item.riskFlags && item.riskFlags.length) lines.push(`- riskFlags: ${item.riskFlags.join(", ")}`);
}

const csvRows = [];
csvRows.push([
  "ordinal",
  "reviewClass",
  "lane",
  "riskFlags",
  "id",
  "team",
  "slug",
  "sourceBucket",
  "assetIndex",
  "before",
  "originalParts",
  "proposedParts",
  "reason"
].map(csvEscape).join(","));

for (const item of reviewed) {
  csvRows.push([
    item.ordinal,
    item.reviewClass,
    item.lane,
    (item.riskFlags || []).join("|"),
    item.id,
    item.team,
    item.slug,
    item.sourceBucket,
    item.assetIndex,
    item.before,
    (item.parts || []).join(" || "),
    (item.normalizedParts || []).join(" || "),
    item.reason
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, riskCounts, reviewed, candidate, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
