import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");
fs.mkdirSync(REPORT_DIR, { recursive: true });

const applyMode = process.argv.includes("--apply");
const mode = applyMode ? "apply" : "dry-run";

const OUT_TXT = path.join(REPORT_DIR, `nfl-batch-001-final-two-${mode}-v1.txt`);
const OUT_JSON = path.join(REPORT_DIR, `nfl-batch-001-final-two-${mode}-v1.json`);

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 260) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function getId(t) {
  return t.id || t.tradeId || t.trade_id || "";
}

function changed(changes, pathName, before, after, type) {
  if (safe(before) === safe(after)) return;
  changes.push({
    path: pathName,
    type,
    before: compact(before),
    after: compact(after)
  });
}

function backupName() {
  return path.join(ROOT, "src", "data", "nfl", `trades.backup-before-batch-001-final-two-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

if (!Array.isArray(trades)) {
  throw new Error("Could not find trades array.");
}

const byId = new Map();
trades.forEach((t, i) => byId.set(getId(t), { t, i }));

const patches = {
  "DET-1948-0017": function(t) {
    const after = {
      summary: "Detroit acquired rights to Doak Walker from New York Yanks for rights to Johnny Rauch. Walker became a Detroit franchise cornerstone and gives the Lions the clear long-term win.",
      partnerSummary: "New York Yanks received rights to Johnny Rauch and gave up rights to Doak Walker. The overall return favors Detroit over New York.",
      analysis: "Detroit earns the A+ because Walker became the defining asset in the deal, while Rauch did not return comparable long-term value to New York.",
      perspectives: [
        {
          sourceTeam: "detroit-lions",
          sourceTradeId: "DET-1948-0017",
          sourceRow: 17,
          primaryTeam: "detroit-lions",
          partnerTeam: "new-york-yanks",
          primarySummary: "Detroit acquired rights to Doak Walker from New York Yanks for rights to Johnny Rauch. Walker became a Detroit franchise cornerstone and gives the Lions the clear long-term win.",
          partnerSummary: "New York Yanks received rights to Johnny Rauch and gave up rights to Doak Walker. The overall return favors Detroit over New York.",
          primaryGrade: "A+",
          partnerGrade: "D",
          verdict: "Detroit Lions Win"
        }
      ]
    };

    return after;
  },

  "NYG-1949-0011": function(t) {
    const after = {
      assetsReceived: {
        "new-york-giants": [
          { type: "player", asset: "undisclosed consideration" },
          { type: "pick", asset: "1949 25th round pick (#250-Ralph Doran)" }
        ],
        "arizona-cardinals": [
          { type: "player", asset: "undisclosed consideration" }
        ]
      },
      verdict: "New York Giants Win",
      grades: {
        "arizona-cardinals": "C",
        "new-york-giants": "C+"
      },
      summary: "New York acquired undisclosed consideration; 1949 25th round pick (#250-Ralph Doran) from Arizona Cardinals for undisclosed consideration. New York received the slightly stronger recorded return, matching the New York Giants Win verdict.",
      partnerSummary: "Arizona Cardinals received undisclosed consideration and gave up undisclosed consideration; 1949 25th round pick (#250-Ralph Doran). The overall return favors New York over Arizona.",
      analysis: "New York earns the modest edge because the recorded pick gives the Giants a clearer return than Arizona's undisclosed side of the deal.",
      perspectives: [
        {
          sourceTeam: "new-york-giants",
          sourceTradeId: "NYG-1949-0011",
          sourceRow: 12,
          primaryTeam: "new-york-giants",
          partnerTeam: "arizona-cardinals",
          primarySummary: "New York Giants acquired undisclosed consideration; 1949 25th round pick (#250-Ralph Doran) from Arizona Cardinals for undisclosed consideration. New York Giants received the slightly stronger recorded return, matching the New York Giants Win verdict.",
          partnerSummary: "Arizona Cardinals received undisclosed consideration and gave up undisclosed consideration; 1949 25th round pick (#250-Ralph Doran). The overall return favors New York Giants over Arizona Cardinals.",
          primaryGrade: "C+",
          partnerGrade: "C",
          verdict: "New York Giants Win"
        },
        {
          sourceTeam: "arizona-cardinals",
          sourceTradeId: "ARI-1949-0021",
          sourceRow: 22,
          primaryTeam: "arizona-cardinals",
          partnerTeam: "new-york-giants",
          primarySummary: "Arizona Cardinals acquired undisclosed consideration from New York Giants for undisclosed consideration; 1949 25th round pick (#250-Ralph Doran). The overall result favors New York Giants over Arizona Cardinals.",
          partnerSummary: "New York Giants received undisclosed consideration; 1949 25th round pick (#250-Ralph Doran) and gave up undisclosed consideration. The overall return favors New York Giants over Arizona Cardinals.",
          primaryGrade: "C",
          partnerGrade: "C+",
          verdict: "New York Giants Win"
        }
      ]
    };

    return after;
  }
};

const records = [];
let blocked = 0;

for (const [id, patchFn] of Object.entries(patches)) {
  const found = byId.get(id);
  const rec = {
    id,
    index: found ? found.i : null,
    status: "would_apply",
    blockers: [],
    changes: []
  };

  if (!found) {
    rec.status = "blocked";
    rec.blockers.push("Trade ID not found.");
    blocked++;
    records.push(rec);
    continue;
  }

  const t = found.t;
  const after = patchFn(t);

  for (const field of ["verdict", "summary", "partnerSummary", "analysis"]) {
    if (field in after) {
      changed(rec.changes, field, t[field], after[field], field === "verdict" ? "verdict" : "copy");
      if (applyMode) t[field] = after[field];
    }
  }

  if (after.grades) {
    changed(rec.changes, "grades", JSON.stringify(t.grades || {}), JSON.stringify(after.grades), "grades");
    if (applyMode) t.grades = after.grades;
  }

  if (after.assetsReceived) {
    changed(rec.changes, "assetsReceived", JSON.stringify(t.assetsReceived || {}), JSON.stringify(after.assetsReceived), "assets");
    if (applyMode) t.assetsReceived = after.assetsReceived;
  }

  if (after.perspectives) {
    changed(rec.changes, "perspectives", `${Array.isArray(t.perspectives) ? t.perspectives.length : 0} perspectives`, `${after.perspectives.length} cleaned perspectives`, "perspectives");
    if (applyMode) t.perspectives = after.perspectives;
  }

  if (applyMode) rec.status = "applied";
  records.push(rec);
}

let backupPath = null;

if (applyMode && blocked === 0) {
  backupPath = backupName();
  fs.copyFileSync(DATA_PATH, backupPath);

  if (Array.isArray(data)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(trades, null, 2) + "\n");
  } else {
    data.trades = trades;
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
  }
}

const statusCounts = {};
for (const r of records) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

const report = {
  generatedAt: new Date().toISOString(),
  mode,
  recordsTargeted: records.length,
  blockedRecords: blocked,
  backupPath,
  statusCounts,
  records
};

fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

const txt = `# NFL Batch 001 Final Two ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${mode}

## Summary
- Records targeted: ${records.length}
- Blocked records: ${blocked}
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}

## Status Counts
${Object.entries(statusCounts).map(([k,v]) => `- ${k}: ${v}`).join("\n")}

## Records
${records.map(r => `## ${r.id}
- Index: ${r.index}
- Status: ${r.status}

### Blockers
${r.blockers.length ? r.blockers.map(b => `- ${b}`).join("\n") : "- None"}

### Changes
${r.changes.length ? r.changes.map(c => `- ${c.path} [${c.type}]\n  before: ${c.before}\n  after: ${c.after}`).join("\n") : "- None"}
`).join("\n\n")}

## Output Files
- JSON: reports/quality/nfl-batch-001-final-two-${mode}-v1.json
- TXT: reports/quality/nfl-batch-001-final-two-${mode}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Batch 001 final two ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blocked}`);
console.log("Status counts:");
for (const [k,v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-batch-001-final-two-${mode}-v1.txt`);
