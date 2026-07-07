const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 80);

const lanePath = path.join("reports", "quality", "nfl-cd-reviewed-bundle-lanes-preview-v1.json");
const outTxt = path.join("reports", "quality", "nfl-c2-and-delimited-pick-list-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-c2-and-delimited-pick-list-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-c2-and-delimited-pick-list-review-v1.csv");

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

function countPickMentions(s) {
  const raw = String(s || "");
  const n = norm(raw);
  const roundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b/g) || [];
  const hashMatches = raw.match(/#\s*\d{1,3}\b/g) || [];
  const overallMatches = raw.match(/\b\d{1,3}(?:st|nd|rd|th)\s+overall\b/gi) || [];
  return Math.max(roundPickMatches.length, hashMatches.length, overallMatches.length);
}

function hasRiskText(s) {
  const raw = String(s || "");
  const risks = [];
  if (/\band\/or\b/i.test(raw)) risks.push("and_or");
  if (/-\s*OR\s*-/i.test(raw)) risks.push("dash_or");
  if (/\bor\b/i.test(raw)) risks.push("or_word");
  if (/\s\/\s/.test(raw)) risks.push("slash");
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) risks.push("explanatory");
  if (/\b(?:cash|future considerations|past considerations|considerations|player to be named later|ptbnl|conditional on|if )\b/i.test(raw)) risks.push("cash_consideration_ptbnl_conditional");
  if (/[([][^)\]]*$/.test(raw)) risks.push("unclosed_paren_or_bracket");
  if (/^[^([]*[)\]]/.test(raw)) risks.push("leading_close_paren_or_bracket");
  return risks;
}

function partLooksSafe(part) {
  const text = String(part || "").trim();
  const risks = hasRiskText(text);
  const pickMentions = countPickMentions(text);
  const startsLikePick = /^\s*(?:\d{4}|draft pick|conditional|future)/i.test(text);
  const hasPickSignal = /\bpick\b|\bround\b|\boverall\b|#\d{1,3}\b/i.test(text);
  return {
    text,
    safe: risks.length === 0 && pickMentions === 1 && startsLikePick && hasPickSignal,
    risks,
    pickMentions,
    startsLikePick,
    hasPickSignal
  };
}

const laneJson = JSON.parse(fs.readFileSync(lanePath, "utf8"));
const items = (((laneJson || {}).results || {}).C2_next_lane_and_delimited_pick_list_preview || []);

const reviewed = items.map((item, idx) => {
  const parts = Array.isArray(item.parts) ? item.parts : [];
  const partChecks = parts.map(partLooksSafe);
  const risks = [];

  if (parts.length < 2) risks.push("too_few_parts");
  if (parts.length > 4) risks.push("many_parts");
  if (hasRiskText(item.assetText).length) risks.push(...hasRiskText(item.assetText).map((risk) => `asset_${risk}`));
  if (partChecks.some((part) => !part.safe)) risks.push("unsafe_part_detected");
  if (partChecks.some((part) => part.pickMentions !== 1)) risks.push("part_pick_count_not_one");
  if (partChecks.some((part) => !part.startsLikePick)) risks.push("part_does_not_start_like_pick");
  if (partChecks.some((part) => !part.hasPickSignal)) risks.push("part_missing_pick_signal");

  return {
    ordinal: idx + 1,
    id: item.id,
    slug: item.slug,
    team: item.team,
    sourceBucket: item.sourceBucket,
    assetIndex: item.assetIndex,
    assetType: item.assetType,
    before: item.assetText,
    proposedParts: parts,
    partCount: parts.length,
    partChecks,
    riskFlags: [...new Set(risks)],
    reviewClass: risks.length === 0 ? "C2A_clean_review_candidate" : "C2B_needs_manual_review"
  };
});

const counts = {
  totalC2Items: reviewed.length,
  C2A_clean_review_candidate: reviewed.filter((x) => x.reviewClass === "C2A_clean_review_candidate").length,
  C2B_needs_manual_review: reviewed.filter((x) => x.reviewClass === "C2B_needs_manual_review").length,
  partCount2: reviewed.filter((x) => x.partCount === 2).length,
  partCount3: reviewed.filter((x) => x.partCount === 3).length,
  partCount4: reviewed.filter((x) => x.partCount === 4).length,
  partCount5Plus: reviewed.filter((x) => x.partCount >= 5).length,
  errors: 0
};

const riskCounts = {};
for (const item of reviewed) {
  for (const risk of item.riskFlags) riskCounts[risk] = (riskCounts[risk] || 0) + 1;
}

const clean = reviewed.filter((x) => x.reviewClass === "C2A_clean_review_candidate");
const manual = reviewed.filter((x) => x.reviewClass === "C2B_needs_manual_review");

const lines = [];
lines.push("# NFL C2 And-Delimited Pick List Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Review C2 candidates before any apply script.");
lines.push("- C2 means an asset looked like a clean pick list separated by top-level 'and'.");
lines.push("- This report does not modify trades.json.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Risk Flag Counts");
if (Object.keys(riskCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(riskCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${k}: ${v}`);
  }
}
lines.push("");
lines.push("## Recommendation");
if (counts.C2A_clean_review_candidate > 0 && counts.C2B_needs_manual_review === 0) {
  lines.push("- All C2 items passed this stricter read-only review.");
  lines.push("- Next step would be a dry-run apply script for C2A only, with before/after verification.");
} else if (counts.C2A_clean_review_candidate > 0) {
  lines.push("- Build any future apply script for C2A_clean_review_candidate only.");
  lines.push("- Keep C2B_needs_manual_review out of auto-apply.");
} else {
  lines.push("- Do not auto-apply C2. No clean C2A candidates were found.");
}
lines.push("");
lines.push("## Clean Candidate Samples");
for (const item of clean.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  for (const part of item.proposedParts) lines.push(`- proposedPart: ${part}`);
}
lines.push("");
lines.push("## Manual Review Samples");
for (const item of manual.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- assetIndex: ${item.assetIndex}`);
  lines.push(`- before: ${item.before}`);
  lines.push(`- riskFlags: ${item.riskFlags.join(", ") || "none"}`);
  for (const part of item.proposedParts) lines.push(`- proposedPart: ${part}`);
}

const csvRows = [];
csvRows.push([
  "ordinal",
  "reviewClass",
  "riskFlags",
  "partCount",
  "id",
  "team",
  "slug",
  "sourceBucket",
  "assetIndex",
  "before",
  "proposedParts"
].map(csvEscape).join(","));

for (const item of reviewed) {
  csvRows.push([
    item.ordinal,
    item.reviewClass,
    item.riskFlags.join("|"),
    item.partCount,
    item.id,
    item.team,
    item.slug,
    item.sourceBucket,
    item.assetIndex,
    item.before,
    item.proposedParts.join(" || ")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, riskCounts, reviewed, clean, manual }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
