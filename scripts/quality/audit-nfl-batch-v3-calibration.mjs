import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const batchNumber = Number(process.argv[2] || 1);
const batchSize = Number(process.argv[3] || 100);
const startIndex = (batchNumber - 1) * batchSize;
const batchLabel = String(batchNumber).padStart(3, "0");

const outJson = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-v3-calibration.json`);
const outTxt = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-v3-calibration.txt`);

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 420) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function getFirst(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) return obj[key];
  }
  return "";
}

function publicFields(trade) {
  const fields = [];

  for (const key of ["summary", "partnerSummary", "analysis", "description", "verdict"]) {
    if (trade[key]) fields.push({ path: key, text: safe(trade[key]) });
  }

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((p, i) => {
      if (!p || typeof p !== "object") return;
      for (const key of ["primarySummary", "partnerSummary", "summary", "analysis", "description", "verdict"]) {
        if (p[key]) fields.push({ path: `perspectives.${i}.${key}`, text: safe(p[key]) });
      }
    });
  }

  return fields;
}

const bannedPublicPatterns = [
  { key: "any_partner_language", severity: "P0", re: /\bpartner\b/i },
  { key: "rebalanced_curve", severity: "P0", re: /rebalanced curve/i },
  { key: "same_hindsight_curve", severity: "P0", re: /same hindsight curve|same value curve/i },
  { key: "asset_conversion", severity: "P1", re: /asset conversion/i },
  { key: "hindsight_value_curve", severity: "P0", re: /hindsight value curve|value curve/i },
  { key: "trade_verdicts_scale", severity: "P0", re: /Trade Verdicts hindsight scale/i },
  { key: "minor_designation", severity: "P0", re: /minor designation reflects/i },
  { key: "public_viewable", severity: "P0", re: /public,\s*viewable/i },
  { key: "reassessed", severity: "P0", re: /\breassessed\b/i },
  { key: "second_pass", severity: "P0", re: /second pass/i },
  { key: "manual_indexing", severity: "P0", re: /manual indexing|priority GSC/i },
  { key: "status_tier_confidence", severity: "P0", re: /\b(Status|Tier|Confidence)\s*:/i },
  { key: "gets_verdict", severity: "P1", re: /gets the verdict/i },
  { key: "receives_edge", severity: "P1", re: /receives the edge/i },
  { key: "keeps_edge", severity: "P1", re: /keeps the edge/i },
  { key: "no_asset_listed_raw", severity: "P1", re: /No asset listed in raw source/i },
  { key: "uncertain_spacing", severity: "P1", re: /[A-Za-z]uncertain\b/i },
  { key: "malformed_semicolon_spacing", severity: "P2", re: /;[A-Za-z0-9]/ },
  { key: "truncated_player_name", severity: "P1", re: /\bHal Eri\b/i }
];

function scanTrade(trade, index) {
  const fields = publicFields(trade);
  const hits = [];

  for (const pattern of bannedPublicPatterns) {
    for (const field of fields) {
      if (pattern.re.test(field.text)) {
        hits.push({
          key: pattern.key,
          severity: pattern.severity,
          path: field.path,
          sample: compact(field.text)
        });
      }
    }
  }

  const id = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  const slug = safe(getFirst(trade, ["slug", "urlSlug"]));
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));

  let v3Class = "clean_after_v3_language_scan";
  if (hits.some(h => h.severity === "P0")) v3Class = "must_patch_public_language";
  else if (hits.length) v3Class = "should_review_public_language";

  return {
    index,
    recordNumber: index + 1,
    id,
    slug,
    verdict,
    grades: trade.grades || {},
    perspectiveCount: Array.isArray(trade.perspectives) ? trade.perspectives.length : 0,
    v3Class,
    hitCount: hits.length,
    hits,
    publicCopyPreview: {
      summary: compact(trade.summary || ""),
      partnerSummary: compact(trade.partnerSummary || ""),
      analysis: compact(trade.analysis || "")
    }
  };
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

if (!Array.isArray(trades)) throw new Error("Could not find trades array.");

const records = trades
  .slice(startIndex, startIndex + batchSize)
  .map((trade, offset) => scanTrade(trade, startIndex + offset));

const counts = {};
for (const r of records) counts[r.v3Class] = (counts[r.v3Class] || 0) + 1;

const hitCounts = {};
for (const r of records) {
  for (const h of r.hits) hitCounts[h.key] = (hitCounts[h.key] || 0) + 1;
}

const out = {
  generatedAt: new Date().toISOString(),
  batchNumber,
  batchLabel,
  startIndex,
  endIndex: startIndex + records.length - 1,
  count: records.length,
  counts,
  hitCounts,
  records
};

fs.writeFileSync(outJson, JSON.stringify(out, null, 2));

function recordText(r) {
  const hits = r.hits.length
    ? r.hits.slice(0, 12).map(h => `  - ${h.severity} ${h.key} at ${h.path}: ${h.sample}`).join("\n")
    : "  - None";

  return `## #${r.recordNumber} / index ${r.index}: ${r.id}

- Slug: ${r.slug}
- Verdict: ${r.verdict}
- Grades: ${Object.entries(r.grades || {}).map(([k,v]) => `${k}=${v}`).join("; ") || "(missing)"}
- Perspectives: ${r.perspectiveCount}
- V3 class: ${r.v3Class}
- Hit count: ${r.hitCount}

### V3 Public-Language Hits
${hits}

### Public Copy Preview
- Summary: ${r.publicCopyPreview.summary}
- Partner summary: ${r.publicCopyPreview.partnerSummary}
- Analysis: ${r.publicCopyPreview.analysis}
`;
}

const txt = `# NFL Batch ${batchLabel} V3 Public-Language Calibration

Generated: ${out.generatedAt}

This is read-only. It is designed to catch false-cleans and tighten the reusable audit process before Batch 001 patching.

Batch:
- Start index: ${out.startIndex}
- End index: ${out.endIndex}
- Records: ${out.count}

## V3 Class Counts

${Object.entries(counts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n")}

## Hit Counts

${Object.entries(hitCounts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Records

${records.map(recordText).join("\n\n")}

## Output Files

- JSON: reports/quality/nfl-batch-${batchLabel}-v3-calibration.json
- TXT: reports/quality/nfl-batch-${batchLabel}-v3-calibration.txt
`;

fs.writeFileSync(outTxt, txt);

console.log("");
console.log(`NFL Batch ${batchLabel} V3 calibration complete.`);
console.log(`Records: ${records.length}`);
console.log("");
console.log("V3 class counts:");
for (const [k, v] of Object.entries(counts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${k}: ${v}`);
}
console.log("");
console.log("Hit counts:");
for (const [k, v] of Object.entries(hitCounts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${k}: ${v}`);
}
console.log("");
console.log("Open:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-v3-calibration.txt`);
