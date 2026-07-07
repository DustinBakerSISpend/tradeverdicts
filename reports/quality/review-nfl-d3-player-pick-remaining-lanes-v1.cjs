const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 100);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const lanePath = path.join("reports", "quality", "nfl-cd-reviewed-bundle-lanes-preview-v1.json");
const outTxt = path.join("reports", "quality", "nfl-d3-player-pick-remaining-lanes-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-d3-player-pick-remaining-lanes-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-d3-player-pick-remaining-lanes-review-v1.csv");

const D3_KEY = "D3_player_pick_review_no_clean_comma_split";

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

function normalizeForDupe(s) {
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

function roleOfPart(part) {
  const text = String(part || "").trim();
  const pickMentions = countPickMentions(text);
  const pickSignal = hasPickSignal(text);
  const risks = hardRiskFlags(text);

  const looksLikePlayer =
    !pickSignal &&
    !/\b(?:cash|considerations|ptbnl|player to be named later|rights|option|selection|swap|future|conditional|undisclosed)\b/i.test(text) &&
    /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4}$/.test(text);

  const looksLikePlayerWithDescriptor =
    !pickSignal &&
    !/\b(?:cash|considerations|ptbnl|player to be named later|future|conditional|undisclosed)\b/i.test(text) &&
    /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4}(?:\s*\([^)]+\))?$/.test(text);

  if (pickSignal || pickMentions > 0) {
    return {
      role: pickMentions === 1 && startsLikePick(text) && risks.length === 0 ? "clean_pick" : "pickish_manual",
      pickMentions,
      risks,
      startsLikePick: startsLikePick(text),
      text
    };
  }

  if (looksLikePlayer) {
    return { role: "clean_player", pickMentions, risks, startsLikePick: false, text };
  }

  if (looksLikePlayerWithDescriptor) {
    return { role: "player_with_descriptor", pickMentions, risks, startsLikePick: false, text };
  }

  return { role: "other_manual", pickMentions, risks, startsLikePick: false, text };
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
      if (next) {
        pushPart(i);
        start = i + 1;
      }
    }

    if (mode === "and") {
      const slice = raw.slice(i);
      const match = slice.match(/^\s+and\s+/i);
      if (match) {
        const next = raw.slice(i + match[0].length).trim();
        if (next) {
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

function classifyAssetText(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const assetRisks = hardRiskFlags(raw);
  const pickMentions = countPickMentions(raw);

  if (assetRisks.includes("unbalanced_parentheses")) {
    return { lane: "D3_blocked_unbalanced_parentheses", reviewClass: "blocked", reason: "unbalanced parentheses", parts: [], roles: [], assetRisks, pickMentions };
  }

  if (assetRisks.some((risk) => ["and_or", "dash_or", "or_word", "slash_alternative"].includes(risk))) {
    return { lane: "D3_blocked_alternative_wording", reviewClass: "blocked", reason: "alternative OR/slash wording", parts: [], roles: [], assetRisks, pickMentions };
  }

  if (assetRisks.includes("cash_consideration_ptbnl_conditional")) {
    return { lane: "D3_blocked_cash_ptbnl_conditional", reviewClass: "blocked", reason: "cash/consideration/PTBNL/conditional wording", parts: [], roles: [], assetRisks, pickMentions };
  }

  if (assetRisks.includes("explanatory_or_contingent")) {
    return { lane: "D3_blocked_explanatory_or_contingent", reviewClass: "blocked", reason: "explanatory/contingent wording", parts: [], roles: [], assetRisks, pickMentions };
  }

  const punctParts = topLevelSplit(raw, "punct");
  const andParts = topLevelSplit(raw, "and");

  function assess(parts, mode) {
    const roles = parts.map(roleOfPart);
    const playerCount = roles.filter((r) => r.role === "clean_player").length;
    const playerDescriptorCount = roles.filter((r) => r.role === "player_with_descriptor").length;
    const cleanPickCount = roles.filter((r) => r.role === "clean_pick").length;
    const pickishManualCount = roles.filter((r) => r.role === "pickish_manual").length;
    const otherManualCount = roles.filter((r) => r.role === "other_manual").length;

    return { mode, parts, roles, playerCount, playerDescriptorCount, cleanPickCount, pickishManualCount, otherManualCount };
  }

  const punct = assess(punctParts, "punct");
  const and = assess(andParts, "and");

  const assessments = [punct, and].sort((a, b) => {
    const aGood = a.playerCount + a.playerDescriptorCount + a.cleanPickCount;
    const bGood = b.playerCount + b.playerDescriptorCount + b.cleanPickCount;
    if (bGood !== aGood) return bGood - aGood;
    return b.parts.length - a.parts.length;
  });

  const best = assessments[0];

  if (best.parts.length >= 2 && best.parts.length <= 4 && best.playerCount === 1 && best.cleanPickCount >= 1 && best.pickishManualCount === 0 && best.otherManualCount === 0 && best.playerDescriptorCount === 0) {
    return {
      lane: best.mode === "and" ? "D3A_and_clean_player_plus_clean_pick_candidate" : "D3B_punct_clean_player_plus_clean_pick_candidate",
      reviewClass: "candidate_strict",
      reason: `${best.mode} split yields one clean player and clean pick part(s)`,
      parts: best.parts,
      roles: best.roles,
      assetRisks,
      pickMentions
    };
  }

  if (best.parts.length >= 2 && best.parts.length <= 4 && best.playerDescriptorCount === 1 && best.cleanPickCount >= 1 && best.pickishManualCount === 0 && best.otherManualCount === 0 && best.playerCount === 0) {
    return {
      lane: best.mode === "and" ? "D3C_and_player_descriptor_plus_clean_pick_review" : "D3D_punct_player_descriptor_plus_clean_pick_review",
      reviewClass: "candidate_warning",
      reason: `${best.mode} split yields one player-with-descriptor and clean pick part(s)`,
      parts: best.parts,
      roles: best.roles,
      assetRisks,
      pickMentions
    };
  }

  if (best.parts.length >= 2 && (best.playerCount + best.playerDescriptorCount) >= 1 && best.cleanPickCount >= 1) {
    return {
      lane: "D3E_mixed_player_pick_manual_review",
      reviewClass: "manual",
      reason: "some player/pick structure found but not strict enough",
      parts: best.parts,
      roles: best.roles,
      assetRisks,
      pickMentions
    };
  }

  return {
    lane: "D3Z_other_player_pick_manual_review",
    reviewClass: "manual",
    reason: "no strict player-plus-pick split pattern",
    parts: best.parts,
    roles: best.roles,
    assetRisks,
    pickMentions
  };
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const laneJson = readJson(lanePath);
const d3Source = ((laneJson && laneJson.results && laneJson.results[D3_KEY]) || []);

const reviewed = d3Source.map((item, idx) => {
  const cls = classifyAssetText(item.assetText);
  const out = {
    ordinal: idx + 1,
    id: item.id,
    team: item.team,
    sourceBucket: item.sourceBucket,
    sourceLaneKey: D3_KEY,
    slug: item.slug,
    assetIndex: item.assetIndex,
    assetType: item.assetType,
    before: item.assetText,
    currentAssetText: "",
    currentAssetType: "",
    currentMatch: false,
    duplicateAgainstExisting: [],
    ...cls
  };

  const trade = byId.get(item.id);
  if (trade && trade.assetsReceived && Array.isArray(trade.assetsReceived[item.team]) && item.assetIndex >= 0 && item.assetIndex < trade.assetsReceived[item.team].length) {
    const bucket = trade.assetsReceived[item.team];
    const currentAsset = bucket[item.assetIndex];
    out.currentAssetText = textOf(currentAsset);
    out.currentAssetType = typeOf(currentAsset);
    out.currentMatch = norm(out.currentAssetText) === norm(out.before);

    const otherAssetTexts = new Set(bucket
      .filter((_, index) => index !== item.assetIndex)
      .map((asset) => normalizeForDupe(textOf(asset))));

    out.duplicateAgainstExisting = (out.parts || []).filter((part) => otherAssetTexts.has(normalizeForDupe(part)));
  }

  if (!out.currentMatch) {
    out.reviewClass = out.reviewClass === "candidate_strict" ? "manual" : out.reviewClass;
    out.lane = "D3_current_text_mismatch_manual_review";
    out.reason = "current trades.json text does not match lane preview text";
  }

  if (out.duplicateAgainstExisting && out.duplicateAgainstExisting.length > 0) {
    out.reviewClass = out.reviewClass === "candidate_strict" ? "candidate_warning" : out.reviewClass;
    out.reason += "; proposed part already exists elsewhere in bucket";
  }

  return out;
});

const counts = {
  totalD3SourceItems: d3Source.length,
  totalReviewed: reviewed.length,
  candidateStrictCount: reviewed.filter((x) => x.reviewClass === "candidate_strict").length,
  candidateWarningCount: reviewed.filter((x) => x.reviewClass === "candidate_warning").length,
  manualCount: reviewed.filter((x) => x.reviewClass === "manual").length,
  blockedCount: reviewed.filter((x) => x.reviewClass === "blocked").length,
  currentTextMismatchCount: reviewed.filter((x) => !x.currentMatch).length,
  duplicateWarningCount: reviewed.filter((x) => x.duplicateAgainstExisting && x.duplicateAgainstExisting.length > 0).length,
  errors: 0
};

const laneCounts = {};
const classCounts = {};
const riskCounts = {};
const roleCounts = {};

for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;

  for (const risk of item.assetRisks || []) riskCounts[risk] = (riskCounts[risk] || 0) + 1;
  for (const role of item.roles || []) roleCounts[role.role] = (roleCounts[role.role] || 0) + 1;
}

const strict = reviewed.filter((x) => x.reviewClass === "candidate_strict");
const warning = reviewed.filter((x) => x.reviewClass === "candidate_warning");
const manual = reviewed.filter((x) => x.reviewClass === "manual");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked");

const lines = [];
lines.push("# NFL D3 Player+Pick Remaining Lanes Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Review remaining D3 player+pick bundles after C2/C3A/CEX cleanup.");
lines.push("- Find strict safe split candidates before any apply script.");
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
lines.push("## Risk Counts");
if (Object.keys(riskCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(riskCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Role Counts");
if (Object.keys(roleCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(roleCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Recommendation");
if (strict.length > 0) {
  lines.push("- A later apply script may target candidate_strict only.");
  lines.push("- Do not apply candidate_warning, manual, or blocked items without a separate review.");
} else {
  lines.push("- No strict D3 candidate lane found. Keep D3 manual/specialized.");
}
lines.push("");
lines.push("## Candidate Strict Samples");
for (const item of strict.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- reason: ${item.reason}`);
  for (const role of item.roles || []) lines.push(`- proposedPart: ${role.role} :: ${role.text}`);
}
lines.push("");
lines.push("## Candidate Warning Samples");
for (const item of warning.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- reason: ${item.reason}`);
  lines.push(`- duplicateAgainstExisting: ${(item.duplicateAgainstExisting || []).join(" | ") || "none"}`);
  for (const role of item.roles || []) lines.push(`- proposedPart: ${role.role} :: ${role.text}`);
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
  for (const role of item.roles || []) lines.push(`- part: ${role.role} :: ${role.text}`);
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
  lines.push(`- risks: ${(item.assetRisks || []).join(", ") || "none"}`);
}

const csvRows = [];
csvRows.push([
  "ordinal",
  "reviewClass",
  "lane",
  "reason",
  "id",
  "team",
  "slug",
  "assetIndex",
  "before",
  "parts",
  "roles",
  "assetRisks",
  "duplicateAgainstExisting"
].map(csvEscape).join(","));

for (const item of reviewed) {
  csvRows.push([
    item.ordinal,
    item.reviewClass,
    item.lane,
    item.reason,
    item.id,
    item.team,
    item.slug,
    item.assetIndex,
    item.before,
    (item.parts || []).join(" || "),
    (item.roles || []).map((role) => `${role.role}::${role.text}`).join(" || "),
    (item.assetRisks || []).join("|"),
    (item.duplicateAgainstExisting || []).join(" | ")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, riskCounts, roleCounts, reviewed, candidateStrict: strict, candidateWarning: warning, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
