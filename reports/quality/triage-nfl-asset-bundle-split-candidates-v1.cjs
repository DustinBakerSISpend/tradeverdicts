const fs = require("fs");
const path = require("path");

const samplePerBucket = Number(process.argv[2] || 30);

const triagePath = path.join("reports", "quality", "nfl-global-asset-structure-holds-triage-v1.json");
const bPath = path.join("reports", "quality", "nfl-b-probable-duplicate-pick-subtriage-v1.json");
const outTxt = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.txt");
const outJson = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.json");

const triage = JSON.parse(fs.readFileSync(triagePath, "utf8"));
const bSub = fs.existsSync(bPath) ? JSON.parse(fs.readFileSync(bPath, "utf8")) : { buckets: {} };

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[â€“â€”]/g, "-")
    .replace(/[;:|()[\]{}.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqByKey(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\d{1,3}\b/i.test(String(s || ""));
}

function countPickMentions(s) {
  const raw = String(s || "");
  const n = norm(raw);
  const roundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b/g) || [];
  const hashMatches = raw.match(/#\s*\d{1,3}\b/g) || [];
  return Math.max(roundPickMatches.length, hashMatches.length);
}

function assetTexts(item) {
  return (Array.isArray(item.assets) ? item.assets : []).map(a => String(a.text || "")).filter(Boolean);
}

function startsLikePick(s) {
  return /^\s*(?:\d{4}|draft pick|conditional|future|past|undisclosed|unspecified)/i.test(String(s || ""));
}

function likelyPlayerPlusPick(s) {
  const raw = String(s || "").trim();
  if (!hasPickSignal(raw)) return false;
  if (/^\d{4}\b/.test(raw)) return false;
  if (/^[A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+){1,5}\s+/.test(raw)) return true;
  return false;
}

function hasUnsafeConnectors(s) {
  return /\b(cash|future considerations|past considerations|considerations|player to be named later|ptbnl| or |option|conditional on|if )\b/i.test(String(s || ""));
}

function multiPickSegments(s) {
  const raw = String(s || "").replace(/\s+/g, " ").trim();
  const marker = /(?=(?:\b(?:19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b|\bdraft pick\s*\(|\bconditional\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b))/ig;
  const indices = [];
  let m;
  while ((m = marker.exec(raw)) !== null) {
    if (!indices.includes(m.index)) indices.push(m.index);
    marker.lastIndex = m.index + 1;
  }
  if (indices.length < 2) return [];
  const parts = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : raw.length;
    parts.push(raw.slice(start, end).replace(/[;,]\s*$/g, "").trim());
  }
  return parts.filter(Boolean);
}

function pickKeyText(s) {
  const raw = String(s || "");
  const n = norm(raw);
  if (!hasPickSignal(raw)) return "";
  const year = (n.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  const overall =
    (n.match(/#\s*(\d{1,3})\b/) || [])[1] ||
    (n.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/) || [])[1] ||
    "";
  const round =
    (n.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+round\b/) || [])[1] ||
    (n.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+round\b/) || [])[1] ||
    "";
  if (!year || (!round && !overall)) return "";
  return `${year}:${round || "r?"}:${overall || "o?"}`;
}

function hasDuplicatePickKey(texts) {
  const keys = texts.map(pickKeyText).filter(Boolean);
  return keys.length !== new Set(keys).size;
}

function classify(item) {
  const texts = assetTexts(item);
  const pickTexts = texts.filter(hasPickSignal);
  const bundled = pickTexts.filter(t => countPickMentions(t) > 1 || likelyPlayerPlusPick(t) || hasUnsafeConnectors(t));

  const multiSegments = pickTexts.flatMap(t => multiPickSegments(t));
  const hasCleanMultiPickSplit = pickTexts.some(t => {
    const segs = multiPickSegments(t);
    return segs.length >= 2 && segs.every(startsLikePick) && !hasUnsafeConnectors(t) && !likelyPlayerPlusPick(t);
  });

  if (hasCleanMultiPickSplit && hasDuplicatePickKey(texts.concat(multiSegments))) {
    return "S1_clean_multi_pick_split_plus_dedupe_candidate";
  }

  if (hasCleanMultiPickSplit) {
    return "S2_clean_multi_pick_split_candidate";
  }

  if (pickTexts.some(t => countPickMentions(t) > 1)) {
    return "S3_multi_pick_bundle_complex_review";
  }

  if (pickTexts.some(likelyPlayerPlusPick)) {
    return "S4_player_plus_pick_bundle_review";
  }

  if (pickTexts.some(hasUnsafeConnectors)) {
    return "S5_cash_consideration_ptbnl_or_conditional_review";
  }

  return "S6_other_split_review";
}

const baseBuckets = (triage || {}).buckets || {};
let candidates = [];

for (const bucket of [
  "B_probable_duplicate_pick_manual_patch",
  "C_multi_pick_bundle_needs_split",
  "D_player_plus_pick_bundle_needs_split",
  "E_ptbnl_historical_bundle_review",
  "F_considerations_bundle_review",
  "G_cash_bundle_review",
  "H_or_alternative_source_conflict",
  "I_other_asset_structure_review"
]) {
  for (const item of baseBuckets[bucket] || []) {
    candidates.push({ ...item, sourceBucket: bucket });
  }
}

// Include B subtriage details by deduping to avoid accidental omissions.
for (const bucket of Object.keys((bSub || {}).buckets || {})) {
  for (const item of bSub.buckets[bucket] || []) {
    candidates.push({ ...item, sourceBucket: `B_sub:${bucket}` });
  }
}

candidates = uniqByKey(candidates, h => `${h.id}|||${h.team}|||${h.slug}`);

const order = [
  "S1_clean_multi_pick_split_plus_dedupe_candidate",
  "S2_clean_multi_pick_split_candidate",
  "S3_multi_pick_bundle_complex_review",
  "S4_player_plus_pick_bundle_review",
  "S5_cash_consideration_ptbnl_or_conditional_review",
  "S6_other_split_review"
];

const buckets = new Map(order.map(k => [k, []]));
for (const item of candidates) {
  buckets.get(classify(item)).push(item);
}

const summary = Object.fromEntries(order.map(k => [k, buckets.get(k).length]));
const out = {
  generatedAt: new Date().toISOString(),
  sources: { triagePath, bPath },
  totalCandidates: candidates.length,
  summary,
  buckets: Object.fromEntries(order.map(k => [k, buckets.get(k)]))
};

const lines = [];
lines.push("# NFL Asset Bundle Split Candidates v1");
lines.push(`Generated: ${out.generatedAt}`);
lines.push("");
lines.push("Purpose:");
lines.push("- No data changes.");
lines.push("- Reclassifies B/C/D and small review buckets into split-workflow lanes.");
lines.push("- S1/S2 are the only possible automation lanes, and still need dry-run review before apply.");
lines.push("- S3/S4/S5/S6 should remain manual/batch QA unless a narrower parser is built.");
lines.push("");
lines.push("## Summary");
lines.push(`- totalCandidates: ${candidates.length}`);
for (const k of order) lines.push(`- ${k}: ${summary[k]}`);
lines.push("");

for (const k of order) {
  const items = buckets.get(k);
  lines.push(`## ${k}`);
  lines.push(`- count: ${items.length}`);
  lines.push("");
  for (const h of items.slice(0, samplePerBucket)) {
    lines.push(`### ${h.id || "unknown"} / ${h.team || ""}`);
    lines.push(`- sourceBucket: ${h.sourceBucket || ""}`);
    lines.push(`- slug: ${h.slug || ""}`);
    for (const a of h.assets || []) lines.push(`- asset: [${a.type || ""}] ${a.text || ""}`);
    lines.push("");
  }
  if (items.length > samplePerBucket) {
    lines.push(`... ${items.length - samplePerBucket} more in this bucket. See JSON for complete list.`);
    lines.push("");
  }
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify(out, null, 2) + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
