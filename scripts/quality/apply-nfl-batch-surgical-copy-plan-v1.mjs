import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const args = process.argv.slice(2);
const batchNumber = Number(args.find(a => /^\d+$/.test(a)) || 1);
const applyMode = args.includes("--apply");
const batchLabel = String(batchNumber).padStart(3, "0");

const PLAN_PATH = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-surgical-copy-plan-v1.json`);
const OUT_JSON = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-surgical-copy-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-surgical-copy-${applyMode ? "apply" : "dry-run"}-v1.txt`);

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 500) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getFirst(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) return obj[key];
  }
  return "";
}

function getPath(obj, pathText) {
  const parts = pathText.split(".");
  let cur = obj;

  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }

  return cur;
}

function setPath(obj, pathText, value) {
  const parts = pathText.split(".");
  let cur = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];

    if (cur == null || !(part in cur)) {
      throw new Error(`Cannot set missing path segment "${part}" in ${pathText}`);
    }

    cur = cur[part];
  }

  const last = parts[parts.length - 1];

  if (cur == null || !(last in cur)) {
    throw new Error(`Cannot set missing final path "${last}" in ${pathText}`);
  }

  cur[last] = value;
}

function bannedHits(text) {
  const s = safe(text);
  const hits = [];

  const patterns = [
    ["partner", /\bpartner\b/i],
    ["hindsight/value curve", /hindsight value curve|same hindsight curve|same value curve|value curve|rebalanced curve/i],
    ["Trade Verdicts scale", /Trade Verdicts hindsight scale/i],
    ["status/tier/confidence leak", /\b(Status|Tier|Confidence)\s*:/i],
    ["minor/major designation", /\b(minor|major) designation reflects/i],
    ["reassessed/public viewable", /\breassessed\b|public,\s*viewable/i],
    ["second pass/regrade", /second pass|\bregrade\b|\bregraded\b|\bregrading\b/i],
    ["manual/GSC", /manual indexing|priority GSC/i],
    ["gets/receives/keeps edge phrasing", /gets the verdict|receives the edge|keeps the edge/i],
    ["asset conversion", /asset conversion/i],
    ["raw source", /No asset listed in raw source/i],
    ["uncertain spacing", /[A-Za-z]uncertain\b/i],
    ["truncated Hal Eri", /\bHal Eri\b/i],
    ["missing semicolon space", /;[A-Za-z0-9]/]
  ];

  for (const [name, re] of patterns) {
    if (re.test(s)) hits.push(name);
  }

  return hits;
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const tradesData = readJson(DATA_PATH);
const trades = Array.isArray(tradesData) ? tradesData : tradesData.trades;

if (!Array.isArray(trades)) {
  throw new Error("Could not find NFL trades array.");
}

const plan = readJson(PLAN_PATH);
const readyRecords = (plan.records || []).filter(r => r.status === "surgical_copy_patch_ready");

const results = [];
let plannedFieldChanges = 0;
let applicableFieldChanges = 0;
let skippedFieldChanges = 0;
let blockedRecords = 0;

for (const planRecord of readyRecords) {
  const trade = trades[planRecord.index];

  const recordResult = {
    index: planRecord.index,
    recordNumber: planRecord.recordNumber,
    id: planRecord.id,
    slug: planRecord.slug,
    status: "ready",
    fieldChanges: [],
    blockers: []
  };

  if (!trade) {
    recordResult.status = "blocked";
    recordResult.blockers.push("Trade index not found in trades array.");
    blockedRecords++;
    results.push(recordResult);
    continue;
  }

  const actualId = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  const actualSlug = safe(getFirst(trade, ["slug", "urlSlug"]));

  if (actualId !== planRecord.id) {
    recordResult.status = "blocked";
    recordResult.blockers.push(`ID mismatch. Plan=${planRecord.id}; actual=${actualId}`);
  }

  if (actualSlug !== planRecord.slug) {
    recordResult.status = "blocked";
    recordResult.blockers.push(`Slug mismatch. Plan=${planRecord.slug}; actual=${actualSlug}`);
  }

  if (planRecord.riskFlagCount !== 0 || (planRecord.riskFlags || []).length !== 0) {
    recordResult.status = "blocked";
    recordResult.blockers.push("Plan record has risk flags.");
  }

  if (planRecord.unchangedFlaggedFieldCount !== 0 || (planRecord.unchangedFlaggedFields || []).length !== 0) {
    recordResult.status = "blocked";
    recordResult.blockers.push("Plan record has unchanged flagged fields.");
  }

  if (recordResult.blockers.length) {
    blockedRecords++;
    results.push(recordResult);
    continue;
  }

  for (const change of planRecord.changedFields || []) {
    plannedFieldChanges++;

    const beforeActual = safe(getPath(trade, change.path));
    const beforeExpected = safe(change.before);
    const after = safe(change.after);
    const afterHits = bannedHits(after);

    const fieldResult = {
      path: change.path,
      action: "ready",
      beforePreview: compact(beforeActual, 280),
      afterPreview: compact(after, 280),
      blockers: []
    };

    if (beforeActual !== beforeExpected) {
      fieldResult.action = "skipped";
      fieldResult.blockers.push("Current field text does not exactly match plan before-text.");
    }

    if (afterHits.length) {
      fieldResult.action = "skipped";
      fieldResult.blockers.push(`After-text still has banned hits: ${afterHits.join(", ")}`);
    }

    if (!after.trim()) {
      fieldResult.action = "skipped";
      fieldResult.blockers.push("After-text is empty.");
    }

    if (fieldResult.action === "ready") {
      applicableFieldChanges++;

      if (applyMode) {
        setPath(trade, change.path, after);
        fieldResult.action = "applied";
      } else {
        fieldResult.action = "would_apply";
      }
    } else {
      skippedFieldChanges++;
    }

    recordResult.fieldChanges.push(fieldResult);
  }

  if (recordResult.fieldChanges.some(f => f.action === "skipped")) {
    recordResult.status = "has_skipped_fields";
  } else {
    recordResult.status = applyMode ? "applied" : "would_apply";
  }

  results.push(recordResult);
}

let backupPath = null;

if (applyMode) {
  backupPath = path.join(
    ROOT,
    "src",
    "data",
    "nfl",
    `trades.backup-before-batch-${batchLabel}-surgical-copy-${timestampForFile()}.json`
  );

  fs.copyFileSync(DATA_PATH, backupPath);

  if (Array.isArray(tradesData)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(trades, null, 2) + "\n");
  } else {
    tradesData.trades = trades;
    fs.writeFileSync(DATA_PATH, JSON.stringify(tradesData, null, 2) + "\n");
  }
}

const statusCounts = {};
for (const result of results) {
  statusCounts[result.status] = (statusCounts[result.status] || 0) + 1;
}

const out = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  batchNumber,
  batchLabel,
  sourcePlan: `reports/quality/nfl-batch-${batchLabel}-surgical-copy-plan-v1.json`,
  readyRecords: readyRecords.length,
  plannedFieldChanges,
  applicableFieldChanges,
  skippedFieldChanges,
  blockedRecords,
  statusCounts,
  backupPath,
  results
};

fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));

function resultText(r) {
  const blockers = r.blockers.length
    ? r.blockers.map(b => `  - ${b}`).join("\n")
    : "  - None";

  const fields = r.fieldChanges.length
    ? r.fieldChanges.map(f => {
        const fBlockers = f.blockers.length ? `\n  Blockers: ${f.blockers.join("; ")}` : "";
        return `  - ${f.path}: ${f.action}${fBlockers}`;
      }).join("\n")
    : "  - None";

  return `## #${r.recordNumber} / index ${r.index}: ${r.id}

- Slug: ${r.slug}
- Status: ${r.status}

### Record Blockers
${blockers}

### Field Changes
${fields}
`;
}

const txt = `# NFL Batch ${batchLabel} Surgical Copy ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${out.generatedAt}

Mode: ${out.mode}

Source plan:
- reports/quality/nfl-batch-${batchLabel}-surgical-copy-plan-v1.json

## Summary

- Ready records from plan: ${out.readyRecords}
- Planned field changes: ${out.plannedFieldChanges}
- Applicable field changes: ${out.applicableFieldChanges}
- Skipped field changes: ${out.skippedFieldChanges}
- Blocked records: ${out.blockedRecords}
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}

## Status Counts

${Object.entries(statusCounts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Records

${results.map(resultText).join("\n\n")}

## Output Files

- JSON: reports/quality/nfl-batch-${batchLabel}-surgical-copy-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-batch-${batchLabel}-surgical-copy-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Batch ${batchLabel} surgical copy ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log("");
console.log(`Ready records from plan: ${out.readyRecords}`);
console.log(`Planned field changes: ${out.plannedFieldChanges}`);
console.log(`Applicable field changes: ${out.applicableFieldChanges}`);
console.log(`Skipped field changes: ${out.skippedFieldChanges}`);
console.log(`Blocked records: ${out.blockedRecords}`);
console.log("");
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${k}: ${v}`);
}
console.log("");
console.log("Report:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-surgical-copy-${applyMode ? "apply" : "dry-run"}-v1.txt`);

if (backupPath) {
  console.log("");
  console.log("Backup:");
  console.log(path.relative(ROOT, backupPath));
}
