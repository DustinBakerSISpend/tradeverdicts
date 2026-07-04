import fs from "node:fs";
import path from "node:path";
import { DATA_PATH, REPORT_DIR, parseArgs, readJson, writeJson, getTrades, getId, safe, readManifest, label } from "./nfl-batch-lib.mjs";

const args = parseArgs();
const bottom = Number(args.bottom || args._[0] || 1);
const applyMode = Boolean(args.apply);
const batchLabel = label(bottom);
const decisionPath = path.join(REPORT_DIR, "decisions", `nfl-bottom-batch-${batchLabel}-grade-decisions.json`);
const outJson = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-grade-${applyMode ? "apply" : "dry-run"}-v1.json`);
const outTxt = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-grade-${applyMode ? "apply" : "dry-run"}-v1.txt`);

readManifest(bottom);

if (!fs.existsSync(decisionPath)) {
  writeJson(decisionPath, {
    generatedAt: new Date().toISOString(),
    note: "Add only reviewed grade/verdict decisions. This generic applier preserves anything omitted.",
    records: [
      {
        id: "EXAMPLE-TRADE-ID",
        verdict: "Team Win or Even Trade",
        grades: { "team-key-a": "B", "team-key-b": "C" },
        summary: "Optional replacement summary.",
        partnerSummary: "Optional replacement partner summary.",
        analysis: "Optional replacement analysis.",
        perspectives: "optional full replacement perspectives array"
      }
    ]
  });
  console.log("");
  console.log("Created grade decisions template:");
  console.log(`reports\\quality\\decisions\\nfl-bottom-batch-${batchLabel}-grade-decisions.json`);
  console.log("");
  process.exit(0);
}

const decisions = readJson(decisionPath);
const { data, trades } = getTrades();
const byId = new Map(trades.map((t, i) => [getId(t), { t, i }]));
const records = [];
let blocked = 0;

function compact(v) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > 260 ? s.slice(0, 259) + "â€¦" : s;
}

function change(rec, pathName, before, after) {
  if (safe(before) === safe(after)) return;
  rec.changes.push({ path: pathName, before: compact(before), after: compact(after) });
}

for (const d of decisions.records || []) {
  if (!d.id || d.id === "EXAMPLE-TRADE-ID") continue;
  const found = byId.get(d.id);
  const rec = { id: d.id, index: found?.i ?? null, status: applyMode ? "applied" : "would_apply", blockers: [], changes: [] };

  if (!found) {
    rec.status = "blocked";
    rec.blockers.push("Trade ID not found.");
    blocked++;
    records.push(rec);
    continue;
  }

  const t = found.t;

  if (typeof d.verdict === "string") {
    change(rec, "verdict", t.verdict, d.verdict);
    if (applyMode) t.verdict = d.verdict;
  }

  if (d.grades && typeof d.grades === "object" && !Array.isArray(d.grades)) {
    change(rec, "grades", JSON.stringify(t.grades || {}), JSON.stringify(d.grades));
    if (applyMode) t.grades = d.grades;
  }

  for (const f of ["summary", "partnerSummary", "analysis"]) {
    if (typeof d[f] === "string") {
      change(rec, f, t[f], d[f]);
      if (applyMode) t[f] = d[f];
    }
  }

  if (Array.isArray(d.perspectives)) {
    change(rec, "perspectives", `${Array.isArray(t.perspectives) ? t.perspectives.length : 0} perspectives`, `${d.perspectives.length} replacement perspectives`);
    if (applyMode) t.perspectives = d.perspectives;
  }

  records.push(rec);
}

let backupPath = null;
if (applyMode && blocked === 0) {
  backupPath = path.join(path.dirname(DATA_PATH), `trades.backup-before-bottom-batch-${batchLabel}-grade-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.copyFileSync(DATA_PATH, backupPath);
  if (Array.isArray(data)) fs.writeFileSync(DATA_PATH, JSON.stringify(trades, null, 2) + "\n");
  else { data.trades = trades; fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n"); }
}

const statusCounts = {};
for (const r of records) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

const report = { generatedAt: new Date().toISOString(), mode: applyMode ? "apply" : "dry-run", decisionPath, blockedRecords: blocked, backupPath, statusCounts, records };
writeJson(outJson, report);

const txt = `# NFL Bottom Batch ${batchLabel} Grade/Verdict ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

## Summary
- Records targeted: ${records.length}
- Blocked records: ${blocked}
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}

## Status Counts
${Object.entries(statusCounts).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Records
${records.map(r => `## ${r.id}
- Index: ${r.index}
- Status: ${r.status}

### Blockers
${r.blockers.length ? r.blockers.map(b => `- ${b}`).join("\n") : "- None"}

### Changes
${r.changes.length ? r.changes.map(c => `- ${c.path}\n  before: ${c.before}\n  after: ${c.after}`).join("\n") : "- None"}
`).join("\n\n")}
`;
fs.writeFileSync(outTxt, txt);

console.log("");
console.log(`Grade/verdict ${applyMode ? "apply" : "dry-run"} complete.`);
console.log(`Open: reports\\quality\\nfl-bottom-batch-${batchLabel}-grade-${applyMode ? "apply" : "dry-run"}-v1.txt`);
