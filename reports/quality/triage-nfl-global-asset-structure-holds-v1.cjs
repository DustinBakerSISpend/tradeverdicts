const fs = require("fs");
const path = require("path");

const samplePerBucket = Number(process.argv[2] || 25);

const holdsPath = path.join("reports", "quality", "nfl-global-asset-structure-holds-v3-ultrasafe.json");
const outTxt = path.join("reports", "quality", "nfl-global-asset-structure-holds-triage-v1.txt");
const outJson = path.join("reports", "quality", "nfl-global-asset-structure-holds-triage-v1.json");

const holds = JSON.parse(fs.readFileSync(holdsPath, "utf8"));

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[â€“â€”]/g, "-")
    .replace(/[;:|()[\]{}.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countPickMentions(s) {
  const raw = String(s || "");
  const n = norm(raw);
  const roundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b/g) || [];
  const hashMatches = raw.match(/#\s*\d{1,3}\b/g) || [];
  return Math.max(roundPickMatches.length, hashMatches.length);
}

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\d{1,3}\b/i.test(String(s || ""));
}

function hasPlayerToBeNamed(s) {
  return /\bplayer to be named later\b|\bptbnl\b/i.test(String(s || ""));
}

function hasFutureConsiderations(s) {
  return /\bfuture considerations\b|\bpast considerations\b|\bconsiderations\b/i.test(String(s || ""));
}

function hasCash(s) {
  return /\bcash\b/i.test(String(s || ""));
}

function hasOrAlternative(s) {
  return /\sOR\s|(?:\bor\b.*\bpick\b)|(?:\bpick\b.*\bor\b)/i.test(String(s || ""));
}

function hasUnavailableSuffix(s) {
  return /additional draft-pick details unavailable from source data|player details unavailable from source data|details unavailable from source data/i.test(String(s || ""));
}

function likelyNameBeforePick(s) {
  const raw = String(s || "").trim();
  if (!hasPickSignal(raw)) return false;
  return /^[A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+){1,4}\s+/.test(raw) && !/^\d{4}\b/.test(raw);
}

function normalizedPickKey(s) {
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

function classifyHold(hold) {
  const assets = Array.isArray(hold.assets) ? hold.assets : [];
  const texts = assets.map(a => String(a.text || ""));
  const pickTexts = texts.filter(hasPickSignal);

  const pickKeys = new Map();
  for (const text of pickTexts) {
    const key = normalizedPickKey(text);
    if (!key) continue;
    if (!pickKeys.has(key)) pickKeys.set(key, []);
    pickKeys.get(key).push(text);
  }

  const duplicatePickKeys = [...pickKeys.entries()].filter(([, arr]) => arr.length > 1);

  if (texts.some(hasUnavailableSuffix)) return "A_clean_unavailable_suffix_then_reaudit";
  if (duplicatePickKeys.length) return "B_probable_duplicate_pick_manual_patch";
  if (texts.some(t => countPickMentions(t) > 1)) return "C_multi_pick_bundle_needs_split";
  if (texts.some(likelyNameBeforePick)) return "D_player_plus_pick_bundle_needs_split";
  if (texts.some(hasPlayerToBeNamed)) return "E_ptbnl_historical_bundle_review";
  if (texts.some(hasFutureConsiderations)) return "F_considerations_bundle_review";
  if (texts.some(hasCash)) return "G_cash_bundle_review";
  if (texts.some(hasOrAlternative)) return "H_or_alternative_source_conflict";
  return "I_other_asset_structure_review";
}

const buckets = new Map();

for (const hold of holds) {
  const bucket = classifyHold(hold);
  if (!buckets.has(bucket)) buckets.set(bucket, []);
  buckets.get(bucket).push(hold);
}

const bucketOrder = [
  "A_clean_unavailable_suffix_then_reaudit",
  "B_probable_duplicate_pick_manual_patch",
  "C_multi_pick_bundle_needs_split",
  "D_player_plus_pick_bundle_needs_split",
  "E_ptbnl_historical_bundle_review",
  "F_considerations_bundle_review",
  "G_cash_bundle_review",
  "H_or_alternative_source_conflict",
  "I_other_asset_structure_review"
];

const summary = {};
for (const bucket of bucketOrder) summary[bucket] = (buckets.get(bucket) || []).length;

const out = {
  generatedAt: new Date().toISOString(),
  source: holdsPath,
  totalHolds: holds.length,
  summary,
  buckets: Object.fromEntries(bucketOrder.map(bucket => [bucket, buckets.get(bucket) || []]))
};

const lines = [];
lines.push("# NFL Global Asset Structure Holds Triage v1");
lines.push(`Generated: ${out.generatedAt}`);
lines.push(`Source: ${holdsPath}`);
lines.push("");
lines.push("Purpose:");
lines.push("- This does not fix records.");
lines.push("- It sorts the 1,638 manual holds into workable lanes so they are not ignored.");
lines.push("- Use this to decide which buckets are safe for a targeted patch script before build and which should fold into normal 100-record QA.");
lines.push("");
lines.push("## Summary");
lines.push(`- totalHolds: ${holds.length}`);
for (const bucket of bucketOrder) {
  lines.push(`- ${bucket}: ${summary[bucket]}`);
}
lines.push("");

for (const bucket of bucketOrder) {
  const items = buckets.get(bucket) || [];
  lines.push(`## ${bucket}`);
  lines.push(`- count: ${items.length}`);
  lines.push("");
  for (const h of items.slice(0, samplePerBucket)) {
    lines.push(`### ${h.id || "unknown"} / ${h.team || ""}`);
    lines.push(`- slug: ${h.slug || ""}`);
    lines.push(`- reason: ${h.reason || ""}`);
    for (const a of h.assets || []) {
      lines.push(`- asset: [${a.type || ""}] ${a.text || ""}`);
    }
    lines.push("");
  }
  if (items.length > samplePerBucket) {
    lines.push(`... ${items.length - samplePerBucket} more in this bucket. See JSON for complete list.`);
    lines.push("");
  }
}

fs.writeFileSync(outJson, JSON.stringify(out, null, 2) + "\n");
fs.writeFileSync(outTxt, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
