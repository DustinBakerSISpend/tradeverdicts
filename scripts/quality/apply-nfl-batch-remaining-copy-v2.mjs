import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const args = process.argv.slice(2);
const batchNumber = Number(args.find(a => /^\d+$/.test(a)) || 1);
const applyMode = args.includes("--apply");
const batchLabel = String(batchNumber).padStart(3, "0");

const REPAIR_PREVIEW = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-repair-preview-v1.json`);

const PLAN_JSON = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-remaining-copy-plan-v2.json`);
const PLAN_TXT = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-remaining-copy-plan-v2.txt`);
const RUN_JSON = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-remaining-copy-${applyMode ? "apply" : "dry-run"}-v2.json`);
const RUN_TXT = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-remaining-copy-${applyMode ? "apply" : "dry-run"}-v2.txt`);

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 700) {
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
    cur = cur[parts[i]];
    if (cur == null) throw new Error(`Cannot set path ${pathText}`);
  }
  cur[parts[parts.length - 1]] = value;
}

function bannedHits(text) {
  const s = safe(text);
  const patterns = [
    ["partner", /\bpartner\b/i],
    ["hindsight/value curve", /hindsight value curve|same hindsight curve|same hindsight value curve|same value curve|value curve|rebalanced curve/i],
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

  return patterns.filter(([, re]) => re.test(s)).map(([name]) => name);
}

function publicFieldPaths(trade) {
  const paths = [];

  for (const key of ["summary", "partnerSummary", "analysis"]) {
    if (typeof trade[key] === "string") paths.push(key);
  }

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((p, i) => {
      if (!p || typeof p !== "object") return;
      for (const key of ["primarySummary", "partnerSummary", "analysis"]) {
        if (typeof p[key] === "string") paths.push(`perspectives.${i}.${key}`);
      }
    });
  }

  return paths;
}

function cleanText(text) {
  let s = safe(text);

  // Remove backend/process sentences.
  s = s.replace(/\s*This is graded under the Trade Verdicts hindsight scale\./gi, "");
  s = s.replace(/\s*The (minor|major) designation reflects[^.]*\./gi, "");
  s = s.replace(/\s*Status\s*:\s*Ready\.?/gi, "");
  s = s.replace(/\s*Tier\s*:\s*[^.]*\.?/gi, "");
  s = s.replace(/\s*Confidence\s*:\s*[^.]*\.?/gi, "");
  s = s.replace(/\s*The earlier even grade was too conservative\./gi, "");

  // Remove/rewrite reassessment language.
  s = s.replace(/Reassessed for curve balance as a true low-margin exchange\.\s*/gi, "");
  s = s.replace(/Reassessed as a public,\s*viewable even trade because/gi, "The record supports the even verdict because");
  s = s.replace(/public,\s*viewable/gi, "recorded");

  // Kill public "partner" language without bulldozing substance.
  s = s.replace(/the partner's return/gi, "the other team's return");
  s = s.replace(/partner's return/gi, "the other team's return");
  s = s.replace(/the partner return/gi, "the other team's return");
  s = s.replace(/Partner Partner (Win|Loss|Even) because\s*/gi, "");
  s = s.replace(/Partner (Win|Loss|Even) because\s*/gi, "");
  s = s.replace(/The partner outcome remains neutral for the same reason [^.]+ does\.?/gi, "The return remains close enough to support the even verdict.");
  s = s.replace(/The partner grade reflects the same strict-hindsight value curve from the opposite side of the transaction\.?/gi, "The return supports the visible grade.");
  s = s.replace(/The partner grade reflects the same hindsight value curve from the opposite side of the transaction\.?/gi, "The return supports the visible grade.");
  s = s.replace(/The partner grade reflects the same value curve from the opposite side of the transaction\.?/gi, "The return supports the visible grade.");
  s = s.replace(/The partner grade reflects a balanced, minor, or unresolved exchange\.?/gi, "The return supports the even verdict.");
  s = s.replace(/The partner side landed the stronger realized value, so its grade is higher on the same hindsight curve\.?/gi, "That return produced the stronger realized value, so the visible grade is higher.");
  s = s.replace(/The partner receives the higher grade because its side of the transaction produced the clearer hindsight value or better asset conversion\.?/gi, "The receiving side earned the higher grade because it produced the clearer long-term football value.");
  s = s.replace(/The partner still received value, but the rebalanced curve gives ([^.]+?) the edge because the return did not match ([^.]+?) realized benefit\.?/gi, "The return did not match the stronger side's realized football value.");
  s = s.replace(/Hindsight favors the partner based on greater cumulative production and roster impact\.?/gi, "The other side produced the stronger long-term football value.");
  s = s.replace(/so this moves to a partner edge/gi, "so this supports the higher-graded side");
  s = s.replace(/partner edge/gi, "higher-graded side");
  s = s.replace(/partner grade/gi, "visible grade");
  s = s.replace(/partner outcome/gi, "return");
  s = s.replace(/partner side/gi, "that side");
  s = s.replace(/\bpartner\b/gi, "other side");

  // Remove remaining curve/meta phrases.
  s = s.replace(/same hindsight value curve|same hindsight curve|same value curve|hindsight value curve|rebalanced curve|value curve/gi, "long-term value");
  s = s.replace(/on the same long-term value/gi, "");
  s = s.replace(/asset conversion/gi, "football value");
  s = s.replace(/No asset listed in raw source/gi, "an unclear return");

  // Style/grammar cleanup.
  s = s.replace(/([A-Z][A-Za-z ./'-]+) receives the edge because/gi, "$1 has the edge because");
  s = s.replace(/([A-Z][A-Za-z ./'-]+) keeps the edge because/gi, "$1 has the edge because");
  s = s.replace(/([A-Z][A-Za-z ./'-]+) gets the verdict based on/gi, "$1 has the stronger case based on");
  s = s.replace(/\bHal Eri\b/g, "Hal Erickson");
  s = s.replace(/;([A-Za-z0-9])/g, "; $1");
  s = s.replace(/([A-Za-z])uncertain\b/g, "$1 uncertain");
  s = s.replace(/(^|\. )the known value gap/g, "$1The known value gap");

  // Final whitespace/punctuation cleanup.
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\s+\./g, ".");
  s = s.replace(/\. \./g, ".");
  s = s.replace(/,,/g, ",");
  s = s.replace(/\s+,/g, ",");
  s = s.replace(/because the historical record/gi, "because the historical record");

  return s;
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const tradesData = readJson(DATA_PATH);
const trades = Array.isArray(tradesData) ? tradesData : tradesData.trades;
if (!Array.isArray(trades)) throw new Error("Could not find trades array.");

const preview = readJson(REPAIR_PREVIEW);
const remainingCopyIndexes = new Set(
  (preview.records || [])
    .filter(r => r.lane === "copy_repair_candidate")
    .map(r => r.index)
);

const planRecords = [];

for (const index of remainingCopyIndexes) {
  const trade = trades[index];
  if (!trade) continue;

  const id = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  const slug = safe(getFirst(trade, ["slug", "urlSlug"]));

  const changedFields = [];
  const riskFlags = [];

  for (const fieldPath of publicFieldPaths(trade)) {
    const before = safe(getPath(trade, fieldPath));
    const beforeHits = bannedHits(before);
    if (!beforeHits.length) continue;

    const after = cleanText(before);
    const afterHits = bannedHits(after);

    if (before !== after) {
      if (afterHits.length) {
        riskFlags.push({
          type: "banned_language_remains_after_cleanup",
          path: fieldPath,
          remainingHits: afterHits
        });
      }

      if (!after.trim()) {
        riskFlags.push({
          type: "empty_after_cleanup",
          path: fieldPath
        });
      }

      const shrinkRatio = before.length ? after.length / before.length : 1;
      const largeReductionNotice = shrinkRatio < 0.45;

      changedFields.push({
        path: fieldPath,
        before,
        after,
        beforeHits,
        afterHits,
        largeReductionNotice
      });
    }
  }

  let status = "surgical_copy_patch_ready";
  if (!changedFields.length) status = "no_remaining_public_copy_hits";
  if (riskFlags.length) status = "review_before_apply";

  planRecords.push({
    index,
    recordNumber: index + 1,
    id,
    slug,
    verdict: safe(getFirst(trade, ["verdict", "winner", "outcome"])),
    grades: trade.grades || {},
    status,
    changedFieldCount: changedFields.length,
    riskFlagCount: riskFlags.length,
    changedFields,
    riskFlags
  });
}

const planCounts = {};
for (const r of planRecords) planCounts[r.status] = (planCounts[r.status] || 0) + 1;

const planOut = {
  generatedAt: new Date().toISOString(),
  batchNumber,
  batchLabel,
  sourceRepairPreview: `reports/quality/nfl-batch-${batchLabel}-repair-preview-v1.json`,
  remainingCopyRecordsInspected: planRecords.length,
  statusCounts: planCounts,
  records: planRecords
};

fs.writeFileSync(PLAN_JSON, JSON.stringify(planOut, null, 2));

function planRecordText(r) {
  const risks = r.riskFlags.length
    ? r.riskFlags.map(x => `- ${x.type} at ${x.path}${x.remainingHits ? `: ${x.remainingHits.join(", ")}` : ""}`).join("\n")
    : "- None";

  const changes = r.changedFields.length
    ? r.changedFields.map(f => `### ${f.path}
Before: ${compact(f.before)}
After: ${compact(f.after)}
Before hits: ${f.beforeHits.join(", ")}
After hits: ${f.afterHits.join(", ") || "none"}
Large reduction notice: ${f.largeReductionNotice ? "yes" : "no"}
`).join("\n")
    : "No changes.";

  return `## #${r.recordNumber} / index ${r.index}: ${r.id}
- Slug: ${r.slug}
- Status: ${r.status}
- Changed fields: ${r.changedFieldCount}
- Risk flags: ${r.riskFlagCount}

### Risks
${risks}

### Changes
${changes}
`;
}

fs.writeFileSync(
  PLAN_TXT,
  `# NFL Batch ${batchLabel} Remaining Copy Plan v2

Generated: ${planOut.generatedAt}

READ-ONLY plan unless this same script is run with --apply.

## Status Counts

${Object.entries(planCounts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Records

${planRecords.map(planRecordText).join("\n\n")}
`
);

const readyRecords = planRecords.filter(r => r.status === "surgical_copy_patch_ready");

const runResults = [];
let plannedFieldChanges = 0;
let applicableFieldChanges = 0;
let skippedFieldChanges = 0;
let blockedRecords = 0;

for (const record of readyRecords) {
  const trade = trades[record.index];

  const result = {
    index: record.index,
    recordNumber: record.recordNumber,
    id: record.id,
    slug: record.slug,
    status: "ready",
    blockers: [],
    fieldChanges: []
  };

  if (!trade) {
    result.status = "blocked";
    result.blockers.push("Trade index not found.");
    blockedRecords++;
    runResults.push(result);
    continue;
  }

  const actualId = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  const actualSlug = safe(getFirst(trade, ["slug", "urlSlug"]));

  if (actualId !== record.id) result.blockers.push(`ID mismatch: ${actualId}`);
  if (actualSlug !== record.slug) result.blockers.push(`Slug mismatch: ${actualSlug}`);

  if (result.blockers.length) {
    result.status = "blocked";
    blockedRecords++;
    runResults.push(result);
    continue;
  }

  for (const change of record.changedFields) {
    plannedFieldChanges++;

    const beforeActual = safe(getPath(trade, change.path));
    const afterHits = bannedHits(change.after);

    const fieldResult = {
      path: change.path,
      action: "ready",
      blockers: []
    };

    if (beforeActual !== change.before) {
      fieldResult.action = "skipped";
      fieldResult.blockers.push("Current text does not match plan before-text.");
    }

    if (afterHits.length) {
      fieldResult.action = "skipped";
      fieldResult.blockers.push(`After-text still has banned hits: ${afterHits.join(", ")}`);
    }

    if (!safe(change.after).trim()) {
      fieldResult.action = "skipped";
      fieldResult.blockers.push("After-text is empty.");
    }

    if (fieldResult.action === "ready") {
      applicableFieldChanges++;
      if (applyMode) {
        setPath(trade, change.path, change.after);
        fieldResult.action = "applied";
      } else {
        fieldResult.action = "would_apply";
      }
    } else {
      skippedFieldChanges++;
    }

    result.fieldChanges.push(fieldResult);
  }

  if (result.fieldChanges.some(f => f.action === "skipped")) {
    result.status = "has_skipped_fields";
  } else {
    result.status = applyMode ? "applied" : "would_apply";
  }

  runResults.push(result);
}

let backupPath = null;

if (applyMode) {
  backupPath = path.join(
    ROOT,
    "src",
    "data",
    "nfl",
    `trades.backup-before-batch-${batchLabel}-remaining-copy-v2-${timestampForFile()}.json`
  );

  fs.copyFileSync(DATA_PATH, backupPath);

  if (Array.isArray(tradesData)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(trades, null, 2) + "\n");
  } else {
    tradesData.trades = trades;
    fs.writeFileSync(DATA_PATH, JSON.stringify(tradesData, null, 2) + "\n");
  }
}

const runStatusCounts = {};
for (const r of runResults) runStatusCounts[r.status] = (runStatusCounts[r.status] || 0) + 1;

const runOut = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  batchNumber,
  batchLabel,
  readyRecords: readyRecords.length,
  plannedFieldChanges,
  applicableFieldChanges,
  skippedFieldChanges,
  blockedRecords,
  statusCounts: runStatusCounts,
  backupPath,
  results: runResults
};

fs.writeFileSync(RUN_JSON, JSON.stringify(runOut, null, 2));

function runRecordText(r) {
  const blockers = r.blockers.length ? r.blockers.map(b => `  - ${b}`).join("\n") : "  - None";
  const fields = r.fieldChanges.length
    ? r.fieldChanges.map(f => `  - ${f.path}: ${f.action}${f.blockers.length ? ` — ${f.blockers.join("; ")}` : ""}`).join("\n")
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

fs.writeFileSync(
  RUN_TXT,
  `# NFL Batch ${batchLabel} Remaining Copy ${applyMode ? "Apply" : "Dry Run"} v2

Generated: ${runOut.generatedAt}

Mode: ${runOut.mode}

## Summary

- Ready records from v2 plan: ${runOut.readyRecords}
- Planned field changes: ${runOut.plannedFieldChanges}
- Applicable field changes: ${runOut.applicableFieldChanges}
- Skipped field changes: ${runOut.skippedFieldChanges}
- Blocked records: ${runOut.blockedRecords}
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}

## Status Counts

${Object.entries(runStatusCounts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Records

${runResults.map(runRecordText).join("\n\n")}
`
);

console.log("");
console.log(`NFL Batch ${batchLabel} remaining copy ${applyMode ? "APPLY" : "DRY RUN"} v2 complete.`);
console.log("");
console.log("Plan status counts:");
for (const [k, v] of Object.entries(planCounts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${k}: ${v}`);
}
console.log("");
console.log("Run summary:");
console.log(`Ready records from v2 plan: ${runOut.readyRecords}`);
console.log(`Planned field changes: ${runOut.plannedFieldChanges}`);
console.log(`Applicable field changes: ${runOut.applicableFieldChanges}`);
console.log(`Skipped field changes: ${runOut.skippedFieldChanges}`);
console.log(`Blocked records: ${runOut.blockedRecords}`);
console.log("");
console.log("Run status counts:");
for (const [k, v] of Object.entries(runStatusCounts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${k}: ${v}`);
}
console.log("");
console.log("Open:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-remaining-copy-${applyMode ? "apply" : "dry-run"}-v2.txt`);
console.log("");
console.log("Plan:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-remaining-copy-plan-v2.txt`);
