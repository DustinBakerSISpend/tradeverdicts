import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const AUDIT_PATH = path.join(ROOT, "reports", "quality", "nfl-batch-001-audit.json");
const OUT_MD = path.join(ROOT, "reports", "quality", "nfl-batch-001-full-human-review.md");
const OUT_JSON = path.join(ROOT, "reports", "quality", "nfl-batch-001-full-human-review.json");

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 900) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function getFirst(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
  }
  return "";
}

function walkStrings(obj, pathParts = [], out = []) {
  if (obj == null) return out;

  if (typeof obj === "string") {
    out.push({ path: pathParts.join("."), text: obj });
    return out;
  }

  if (Array.isArray(obj)) {
    obj.forEach((x, i) => walkStrings(x, [...pathParts, String(i)], out));
    return out;
  }

  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) walkStrings(v, [...pathParts, k], out);
  }

  return out;
}

function publicCopyFields(trade) {
  const strings = walkStrings(trade);
  return strings.filter(x => {
    const p = x.path.toLowerCase();
    return (
      p.includes("summary") ||
      p.includes("analysis") ||
      p.includes("description") ||
      p.includes("verdict") ||
      p.includes("content") ||
      p.includes("body") ||
      p.includes("title")
    );
  });
}

function gradeFields(trade) {
  const strings = walkStrings(trade);
  return strings.filter(x => x.path.toLowerCase().includes("grade"));
}

function assetFields(trade) {
  const strings = walkStrings(trade);
  return strings.filter(x => {
    const p = x.path.toLowerCase();
    return (
      p.includes("asset") ||
      p.includes("received") ||
      p.includes("sent") ||
      p.includes("player") ||
      p.includes("pick")
    );
  });
}

function topLevelSnapshot(trade) {
  const keep = {};
  for (const key of Object.keys(trade)) {
    const v = trade[key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v == null) {
      keep[key] = v;
    }
  }
  return keep;
}

const tradesData = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const trades = Array.isArray(tradesData) ? tradesData : tradesData.trades;
const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf8"));

const start = audit.startIndex ?? 0;
const end = audit.endIndex ?? 99;
const batchTrades = trades.slice(start, end + 1);

const auditByIndex = new Map(audit.audited.map(x => [x.index, x]));

const records = batchTrades.map((trade, offset) => {
  const index = start + offset;
  const auditItem = auditByIndex.get(index) || {};

  const publicFields = publicCopyFields(trade);
  const grades = gradeFields(trade);
  const assets = assetFields(trade);

  return {
    index,
    recordNumber: index + 1,
    id: safe(getFirst(trade, ["id", "tradeId", "trade_id"])),
    slug: safe(getFirst(trade, ["slug", "urlSlug"])),
    title: safe(getFirst(trade, ["title", "headline", "name"])),
    date: safe(getFirst(trade, ["date", "tradeDate", "year"])),
    verdict: safe(getFirst(trade, ["verdict", "winner", "outcome"])),
    auditStatus: auditItem.status || "not-audited",
    auditIssueCount: auditItem.issueCount || 0,
    auditIssues: auditItem.issues || [],
    topLevel: topLevelSnapshot(trade),
    gradeFields: grades,
    assetFields: assets.slice(0, 30),
    publicCopyFields: publicFields
  };
});

const finalStateTemplate = {
  allowedFinalStates: [
    "confirmed_clean",
    "patch_candidate",
    "patched_verified",
    "reviewed_left_alone",
    "hold_source_needed"
  ],
  rule: "Every one of the 100 records must receive a final state before the batch is considered complete."
};

const out = {
  generatedAt: new Date().toISOString(),
  sourceData: "src/data/nfl/trades.json",
  sourceAudit: "reports/quality/nfl-batch-001-audit.json",
  batchNumber: 1,
  startIndex: start,
  endIndex: end,
  count: records.length,
  finalStateTemplate,
  records
};

fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));

function issueText(issue) {
  const pattern = issue.pattern ? `\n    - Pattern: ${issue.pattern}` : "";
  const reason = issue.reason ? `\n    - Reason: ${issue.reason}` : "";
  const sample = issue.sample ? `\n    - Sample: ${compact(issue.sample, 600)}` : "";
  return `  - ${issue.severity || "P?"} ${issue.bucket || "issue"}: ${issue.type || "unspecified"}${pattern}${reason}${sample}`;
}

const mdRecords = records.map(r => {
  const issues = r.auditIssues.length
    ? r.auditIssues.map(issueText).join("\n")
    : "  - None flagged by heuristic audit.";

  const grades = r.gradeFields.length
    ? r.gradeFields.map(g => `  - ${g.path}: ${safe(g.text)}`).join("\n")
    : "  - No grade fields found by scanner.";

  const assets = r.assetFields.length
    ? r.assetFields.slice(0, 20).map(a => `  - ${a.path}: ${compact(a.text, 260)}`).join("\n")
    : "  - No asset fields found by scanner.";

  const copy = r.publicCopyFields.length
    ? r.publicCopyFields.map(c => `  - ${c.path}: ${compact(c.text, 700)}`).join("\n")
    : "  - No public copy fields found by scanner.";

  return `## #${r.recordNumber} / index ${r.index}: ${r.id || "(missing id)"}

- Slug: ${r.slug || "(missing slug)"}
- Title: ${r.title || "(missing title)"}
- Date: ${r.date || "(missing date)"}
- Verdict: ${r.verdict || "(missing verdict)"}
- Audit status: ${r.auditStatus}
- Audit issue count: ${r.auditIssueCount}
- Final review state: TODO

### Audit Issues
${issues}

### Grade Fields
${grades}

### Asset / Player / Pick Fields
${assets}

### Public Copy Fields
${copy}

### Reviewer Notes
- TODO:
`;
}).join("\n\n");

const md = `# NFL Batch 001 Full Human Review Packet

Generated: ${out.generatedAt}

Source data: \`src/data/nfl/trades.json\`  
Source audit: \`reports/quality/nfl-batch-001-audit.json\`

Batch:
- Batch 001
- Start index: ${start}
- End index: ${end}
- Trade records: ${records.length}

## Completion Rule

This batch is not done until all 100 records have one final state:

- confirmed_clean
- patch_candidate
- patched_verified
- reviewed_left_alone
- hold_source_needed

No issue bucket should be silently ignored.

${mdRecords}

## Output Files

- JSON: \`reports/quality/nfl-batch-001-full-human-review.json\`
- Markdown: \`reports/quality/nfl-batch-001-full-human-review.md\`
`;

fs.writeFileSync(OUT_MD, md);

console.log("");
console.log("Batch 001 full human-review packet created.");
console.log(`Records included: ${records.length}`);
console.log("");
console.log("Open this:");
console.log("reports\\quality\\nfl-batch-001-full-human-review.md");
console.log("");
console.log("Or copy it:");
console.log("Get-Content reports\\quality\\nfl-batch-001-full-human-review.md -Raw | Set-Clipboard");
