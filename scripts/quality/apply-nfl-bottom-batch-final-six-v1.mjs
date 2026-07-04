import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const applyMode = process.argv.includes("--apply");
const batchLabel = "001";

const OUT_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-six-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-six-${applyMode ? "apply" : "dry-run"}-v1.txt`);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 300) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "â€¦" : s;
}

function getId(t) {
  return safe(t.id || t.tradeId || t.trade_id);
}

function changed(rec, pathName, before, after, type) {
  if (safe(before) === safe(after)) return;
  rec.changes.push({
    path: pathName,
    type,
    before: compact(before),
    after: compact(after)
  });
}

function backupName() {
  return path.join(path.dirname(DATA_PATH), `trades.backup-before-bottom-batch-001-final-six-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

const patches = {
  "DEN-2026-04-24-0400": {
    reason: "Structural cleanup: remove duplicate Denver perspective, keep the valid Denver/Buffalo trade, preserve Even C+/C+.",
    verdict: "Even Trade",
    grades: {
      "denver-broncos": "C+",
      "buffalo-bills": "C+"
    },
    summary: "Denver Broncos acquired 2026 3rd round pick (66th overall, Tyler Onyedim) and 2026 6th round pick (182nd overall, subsequently traded, Taylen Green) from Buffalo Bills for 2026 2nd round pick (62nd overall, Davison Igbinosun). The available record does not show enough separation to call a clear long-term winner.",
    partnerSummary: "Buffalo Bills received 2026 2nd round pick (62nd overall, Davison Igbinosun) and gave up 2026 3rd round pick (66th overall, Tyler Onyedim) and 2026 6th round pick (182nd overall, subsequently traded, Taylen Green). The return remains close enough to support the Even Trade verdict.",
    analysis: "This remains a balanced draft-capital exchange. Denver added volume while Buffalo moved up for a higher pick, and the recorded value does not create enough distance to move either side above an Even Trade verdict.",
    perspectives: [
      {
        sourceTeam: "denver-broncos",
        sourceTradeId: "DEN-2026-04-24-0400",
        sourceRow: 390,
        primaryTeam: "denver-broncos",
        partnerTeam: "buffalo-bills",
        primarySummary: "Denver Broncos acquired 2026 3rd round pick (66th overall, Tyler Onyedim) and 2026 6th round pick (182nd overall, subsequently traded, Taylen Green) from Buffalo Bills for 2026 2nd round pick (62nd overall, Davison Igbinosun). The available record does not show enough separation to call a clear long-term winner.",
        partnerSummary: "Buffalo Bills received 2026 2nd round pick (62nd overall, Davison Igbinosun) and gave up 2026 3rd round pick (66th overall, Tyler Onyedim) and 2026 6th round pick (182nd overall, subsequently traded, Taylen Green). The return remains close enough to support the Even Trade verdict.",
        analysis: "This remains a balanced draft-capital exchange. Denver added volume while Buffalo moved up for a higher pick, and the recorded value does not create enough distance to move either side above an Even Trade verdict.",
        primaryGrade: "C+",
        partnerGrade: "C+",
        verdict: "Even Trade"
      },
      {
        sourceTeam: "buffalo-bills",
        sourceTradeId: "BUF-2026-0350",
        sourceRow: 351,
        primaryTeam: "buffalo-bills",
        partnerTeam: "denver-broncos",
        primarySummary: "Buffalo Bills acquired 2026 2nd round pick (62nd overall, Davison Igbinosun) from Denver Broncos for 2026 3rd round pick (66th overall, Tyler Onyedim) and 2026 6th round pick (182nd overall, subsequently traded, Taylen Green). The available record does not show enough separation to call a clear long-term winner.",
        partnerSummary: "Denver Broncos received 2026 3rd round pick (66th overall, Tyler Onyedim) and 2026 6th round pick (182nd overall, subsequently traded, Taylen Green) and gave up 2026 2nd round pick (62nd overall, Davison Igbinosun). The return remains close enough to support the Even Trade verdict.",
        analysis: "This remains a balanced draft-capital exchange. Buffalo moved up for a higher pick while Denver added volume, and the recorded value does not create enough distance to move either side above an Even Trade verdict.",
        primaryGrade: "C+",
        partnerGrade: "C+",
        verdict: "Even Trade"
      }
    ]
  },

  "DEN-2026-04-25-0401": {
    reason: "Structural cleanup: remove Buffalo/Detroit contamination, keep the actual Denver/Cleveland Day 3 move-up, preserve Even C/C.",
    assetsReceived: {
      "denver-broncos": [
        { type: "pick", asset: "2026 5th round pick (152nd overall, Justin Joly)" }
      ],
      "cleveland-browns": [
        { type: "pick", asset: "2026 5th round pick (170th overall, Joe Royer)" },
        { type: "pick", asset: "2026 6th round pick (182nd overall, Taylen Green)" }
      ]
    },
    verdict: "Even Trade",
    grades: {
      "denver-broncos": "C",
      "cleveland-browns": "C"
    },
    summary: "Denver Broncos acquired 2026 5th round pick (152nd overall, Justin Joly) from Cleveland Browns for 2026 5th round pick (170th overall, Joe Royer) and 2026 6th round pick (182nd overall, Taylen Green). The available record does not show enough separation to call a clear long-term winner.",
    partnerSummary: "Cleveland Browns received 2026 5th round pick (170th overall, Joe Royer) and 2026 6th round pick (182nd overall, Taylen Green) and gave up 2026 5th round pick (152nd overall, Justin Joly). The return remains close enough to support the Even Trade verdict.",
    analysis: "Denver moved up for a preferred Day 3 target while Cleveland added an extra late-round pick. The recorded value remains close enough to keep the trade even.",
    perspectives: [
      {
        sourceTeam: "denver-broncos",
        sourceTradeId: "DEN-2026-04-25-0401",
        sourceRow: 391,
        primaryTeam: "denver-broncos",
        partnerTeam: "cleveland-browns",
        primarySummary: "Denver Broncos acquired 2026 5th round pick (152nd overall, Justin Joly) from Cleveland Browns for 2026 5th round pick (170th overall, Joe Royer) and 2026 6th round pick (182nd overall, Taylen Green). The available record does not show enough separation to call a clear long-term winner.",
        partnerSummary: "Cleveland Browns received 2026 5th round pick (170th overall, Joe Royer) and 2026 6th round pick (182nd overall, Taylen Green) and gave up 2026 5th round pick (152nd overall, Justin Joly). The return remains close enough to support the Even Trade verdict.",
        analysis: "Denver moved up for a preferred Day 3 target while Cleveland added an extra late-round pick. The recorded value remains close enough to keep the trade even.",
        primaryGrade: "C",
        partnerGrade: "C",
        verdict: "Even Trade"
      },
      {
        sourceTeam: "cleveland-browns",
        sourceTradeId: "CLE-2026-0483",
        sourceRow: 481,
        primaryTeam: "cleveland-browns",
        partnerTeam: "denver-broncos",
        primarySummary: "Cleveland Browns acquired 2026 5th round pick (170th overall, Joe Royer) and 2026 6th round pick (182nd overall, Taylen Green) from Denver Broncos for 2026 5th round pick (152nd overall, Justin Joly). The available record does not show enough separation to call a clear long-term winner.",
        partnerSummary: "Denver Broncos received 2026 5th round pick (152nd overall, Justin Joly) and gave up 2026 5th round pick (170th overall, Joe Royer) and 2026 6th round pick (182nd overall, Taylen Green). The return remains close enough to support the Even Trade verdict.",
        analysis: "Cleveland moved down on Day 3 and added an extra late-round pick while Denver targeted a specific player. The recorded value remains close enough to keep the trade even.",
        primaryGrade: "C",
        partnerGrade: "C",
        verdict: "Even Trade"
      }
    ]
  },

  "MIN-2026-0321": {
    reason: "Grade/verdict cleanup: top-level Even C/C is more conservative for a recent late-round pick exchange; rewrite copy to stop implying a Minnesota win.",
    verdict: "Even Trade",
    grades: {
      "minnesota-vikings": "C",
      "new-england-patriots": "C"
    },
    summary: "Minnesota Vikings acquired 2026 6th round pick (198th overall, Demond Claiborne) from New England Patriots for 2026 7th round pick (234th overall, Behren Morton) and a 2027 6th round pick. The available record does not show enough separation to call a clear long-term winner.",
    partnerSummary: "New England Patriots received 2026 7th round pick (234th overall, Behren Morton) and a 2027 6th round pick and gave up 2026 6th round pick (198th overall, Demond Claiborne). The return remains close enough to support the Even Trade verdict.",
    analysis: "Minnesota moved up for a current sixth-round selection, while New England received a later pick plus future draft value. The recorded value remains close enough to keep the trade even.",
    perspectives: [
      {
        sourceTeam: "minnesota-vikings",
        sourceTradeId: "MIN-2026-0321",
        sourceRow: 322,
        primaryTeam: "minnesota-vikings",
        partnerTeam: "new-england-patriots",
        primarySummary: "Minnesota Vikings acquired 2026 6th round pick (198th overall, Demond Claiborne) from New England Patriots for 2026 7th round pick (234th overall, Behren Morton) and a 2027 6th round pick. The available record does not show enough separation to call a clear long-term winner.",
        partnerSummary: "New England Patriots received 2026 7th round pick (234th overall, Behren Morton) and a 2027 6th round pick and gave up 2026 6th round pick (198th overall, Demond Claiborne). The return remains close enough to support the Even Trade verdict.",
        analysis: "Minnesota moved up for a current sixth-round selection, while New England received a later pick plus future draft value. The recorded value remains close enough to keep the trade even.",
        primaryGrade: "C",
        partnerGrade: "C",
        verdict: "Even Trade"
      },
      {
        sourceTeam: "new-england-patriots",
        sourceTradeId: "NE-2026-0468",
        sourceRow: 469,
        primaryTeam: "new-england-patriots",
        partnerTeam: "minnesota-vikings",
        primarySummary: "New England Patriots acquired 2026 7th round pick (234th overall, Behren Morton) and a 2027 6th round pick from Minnesota Vikings for 2026 6th round pick (198th overall, Demond Claiborne). The available record does not show enough separation to call a clear long-term winner.",
        partnerSummary: "Minnesota Vikings received 2026 6th round pick (198th overall, Demond Claiborne) and gave up 2026 7th round pick (234th overall, Behren Morton) and a 2027 6th round pick. The return remains close enough to support the Even Trade verdict.",
        analysis: "New England added future draft value while Minnesota moved up for a current sixth-round selection. The recorded value remains close enough to keep the trade even.",
        primaryGrade: "C",
        partnerGrade: "C",
        verdict: "Even Trade"
      }
    ]
  },

  "PIT-2026-0396": {
    reason: "Grade/verdict cleanup: preserve visible Pittsburgh C+/C win and rewrite stale even-style copy.",
    verdict: "Pittsburgh Steelers Win",
    grades: {
      "pittsburgh-steelers": "C+",
      "kansas-city-chiefs": "C"
    },
    summary: "Pittsburgh Steelers acquired 2026 5th round pick (169th overall, Riley Nowakowski) and 2026 6th round pick (210th overall, Gabriel Rubio) from Kansas City Chiefs for 2026 5th round pick (161st overall, Emmett Johnson) and 2026 7th round pick (249th overall, Garrett Nussmeier). Pittsburgh received the slightly stronger late-round return, matching the Pittsburgh Steelers Win verdict.",
    partnerSummary: "Kansas City Chiefs received 2026 5th round pick (161st overall, Emmett Johnson) and 2026 7th round pick (249th overall, Garrett Nussmeier) and gave up 2026 5th round pick (169th overall, Riley Nowakowski) and 2026 6th round pick (210th overall, Gabriel Rubio). The overall return favors Pittsburgh.",
    analysis: "Pittsburgh moved down slightly in the fifth round but upgraded a seventh-rounder into a sixth-rounder. That gives the Steelers the modest edge reflected in the visible grades.",
    perspectives: [
      {
        sourceTeam: "pittsburgh-steelers",
        sourceTradeId: "PIT-2026-0396",
        sourceRow: 397,
        primaryTeam: "pittsburgh-steelers",
        partnerTeam: "kansas-city-chiefs",
        primarySummary: "Pittsburgh Steelers acquired 2026 5th round pick (169th overall, Riley Nowakowski) and 2026 6th round pick (210th overall, Gabriel Rubio) from Kansas City Chiefs for 2026 5th round pick (161st overall, Emmett Johnson) and 2026 7th round pick (249th overall, Garrett Nussmeier). Pittsburgh received the slightly stronger late-round return, matching the Pittsburgh Steelers Win verdict.",
        partnerSummary: "Kansas City Chiefs received 2026 5th round pick (161st overall, Emmett Johnson) and 2026 7th round pick (249th overall, Garrett Nussmeier) and gave up 2026 5th round pick (169th overall, Riley Nowakowski) and 2026 6th round pick (210th overall, Gabriel Rubio). The overall return favors Pittsburgh.",
        analysis: "Pittsburgh moved down slightly in the fifth round but upgraded a seventh-rounder into a sixth-rounder. That gives the Steelers the modest edge reflected in the visible grades.",
        primaryGrade: "C+",
        partnerGrade: "C",
        verdict: "Pittsburgh Steelers Win"
      },
      {
        sourceTeam: "kansas-city-chiefs",
        sourceTradeId: "KC-2026-0303",
        sourceRow: 304,
        primaryTeam: "kansas-city-chiefs",
        partnerTeam: "pittsburgh-steelers",
        primarySummary: "Kansas City Chiefs acquired 2026 5th round pick (161st overall, Emmett Johnson) and 2026 7th round pick (249th overall, Garrett Nussmeier) from Pittsburgh Steelers for 2026 5th round pick (169th overall, Riley Nowakowski) and 2026 6th round pick (210th overall, Gabriel Rubio). The overall result favors Pittsburgh.",
        partnerSummary: "Pittsburgh Steelers received 2026 5th round pick (169th overall, Riley Nowakowski) and 2026 6th round pick (210th overall, Gabriel Rubio) and gave up 2026 5th round pick (161st overall, Emmett Johnson) and 2026 7th round pick (249th overall, Garrett Nussmeier). The overall return favors Pittsburgh.",
        analysis: "Kansas City moved up slightly in the fifth round, but Pittsburgh's added sixth-rounder creates the better overall return.",
        primaryGrade: "C",
        partnerGrade: "C+",
        verdict: "Pittsburgh Steelers Win"
      }
    ]
  },

  "SEA-2026-04-25-0249": {
    reason: "Grade/verdict cleanup plus asset de-duplication: preserve Seattle B/C+ win, remove duplicated Andre Fuller asset, align both perspectives.",
    assetsReceived: {
      "seattle-seahawks": [
        { type: "pick", asset: "2026 7th round pick (236th overall, Andre Fuller)" },
        { type: "pick", asset: "2026 7th round pick (255th overall, Michael Dansby)" }
      ],
      "green-bay-packers": [
        { type: "pick", asset: "2026 6th round pick (216th overall, Trey Smack)" }
      ]
    },
    verdict: "Seattle Seahawks Win",
    grades: {
      "seattle-seahawks": "B",
      "green-bay-packers": "C+"
    },
    summary: "Seattle Seahawks acquired 2026 7th round pick (236th overall, Andre Fuller) and 2026 7th round pick (255th overall, Michael Dansby) from Green Bay Packers for 2026 6th round pick (216th overall, Trey Smack). Seattle received the stronger recorded return, matching the Seattle Seahawks Win verdict.",
    partnerSummary: "Green Bay Packers received 2026 6th round pick (216th overall, Trey Smack) and gave up 2026 7th round pick (236th overall, Andre Fuller) and 2026 7th round pick (255th overall, Michael Dansby). The overall return favors Seattle.",
    analysis: "Seattle turned one sixth-round pick slot into two seventh-round selections. The margin is not huge, but the recorded return gives Seattle the better grade.",
    perspectives: [
      {
        sourceTeam: "seattle-seahawks",
        sourceTradeId: "SEA-2026-04-25-0249",
        sourceRow: 240,
        primaryTeam: "seattle-seahawks",
        partnerTeam: "green-bay-packers",
        primarySummary: "Seattle Seahawks acquired 2026 7th round pick (236th overall, Andre Fuller) and 2026 7th round pick (255th overall, Michael Dansby) from Green Bay Packers for 2026 6th round pick (216th overall, Trey Smack). Seattle received the stronger recorded return, matching the Seattle Seahawks Win verdict.",
        partnerSummary: "Green Bay Packers received 2026 6th round pick (216th overall, Trey Smack) and gave up 2026 7th round pick (236th overall, Andre Fuller) and 2026 7th round pick (255th overall, Michael Dansby). The overall return favors Seattle.",
        analysis: "Seattle turned one sixth-round pick slot into two seventh-round selections. The margin is not huge, but the recorded return gives Seattle the better grade.",
        primaryGrade: "B",
        partnerGrade: "C+",
        verdict: "Seattle Seahawks Win"
      },
      {
        sourceTeam: "green-bay-packers",
        sourceTradeId: "GB-2026-0459",
        sourceRow: 460,
        primaryTeam: "green-bay-packers",
        partnerTeam: "seattle-seahawks",
        primarySummary: "Green Bay Packers acquired 2026 6th round pick (216th overall, Trey Smack) from Seattle Seahawks for 2026 7th round pick (236th overall, Andre Fuller) and 2026 7th round pick (255th overall, Michael Dansby). The overall result favors Seattle.",
        partnerSummary: "Seattle Seahawks received 2026 7th round pick (236th overall, Andre Fuller) and 2026 7th round pick (255th overall, Michael Dansby) and gave up 2026 6th round pick (216th overall, Trey Smack). The overall return favors Seattle.",
        analysis: "Green Bay moved up into the sixth round, but Seattle's two-pick return gives the Seahawks the stronger recorded value.",
        primaryGrade: "C+",
        partnerGrade: "B",
        verdict: "Seattle Seahawks Win"
      }
    ]
  },

  "SEA-2026-05-27-0250": {
    reason: "Grade/verdict cleanup plus asset de-duplication: preserve Seattle B-/C win, align copy and both perspectives.",
    assetsReceived: {
      "seattle-seahawks": [
        { type: "player", asset: "Irvin Charles" }
      ],
      "new-york-jets": [
        { type: "pick", asset: "conditional 2028 7th round pick" }
      ]
    },
    verdict: "Seattle Seahawks Win",
    grades: {
      "seattle-seahawks": "B-",
      "new-york-jets": "C"
    },
    summary: "Seattle Seahawks acquired Irvin Charles from New York Jets for a conditional 2028 7th round pick. Seattle received the stronger recorded return, matching the Seattle Seahawks Win verdict.",
    partnerSummary: "New York Jets received a conditional 2028 7th round pick and gave up Irvin Charles. The overall return favors Seattle.",
    analysis: "This remains a modest roster trade, but Seattle received the identifiable player while New York's return was limited to conditional late-round value. That supports the narrow Seattle edge.",
    perspectives: [
      {
        sourceTeam: "seattle-seahawks",
        sourceTradeId: "SEA-2026-05-27-0250",
        sourceRow: 241,
        primaryTeam: "seattle-seahawks",
        partnerTeam: "new-york-jets",
        primarySummary: "Seattle Seahawks acquired Irvin Charles from New York Jets for a conditional 2028 7th round pick. Seattle received the stronger recorded return, matching the Seattle Seahawks Win verdict.",
        partnerSummary: "New York Jets received a conditional 2028 7th round pick and gave up Irvin Charles. The overall return favors Seattle.",
        analysis: "This remains a modest roster trade, but Seattle received the identifiable player while New York's return was limited to conditional late-round value. That supports the narrow Seattle edge.",
        primaryGrade: "B-",
        partnerGrade: "C",
        verdict: "Seattle Seahawks Win"
      },
      {
        sourceTeam: "new-york-jets",
        sourceTradeId: "NYJ-2026-0331",
        sourceRow: 332,
        primaryTeam: "new-york-jets",
        partnerTeam: "seattle-seahawks",
        primarySummary: "New York Jets acquired a conditional 2028 7th round pick from Seattle Seahawks for Irvin Charles. The overall result favors Seattle.",
        partnerSummary: "Seattle Seahawks received Irvin Charles and gave up a conditional 2028 7th round pick. The overall return favors Seattle.",
        analysis: "New York gained conditional late-round value, but Seattle received the clearer roster asset. That supports the narrow Seattle edge.",
        primaryGrade: "C",
        partnerGrade: "B-",
        verdict: "Seattle Seahawks Win"
      }
    ]
  }
};

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;
if (!Array.isArray(trades)) throw new Error("Could not find trades array.");

const byId = new Map(trades.map((t, i) => [getId(t), { t, i }]));

const records = [];
let blocked = 0;

for (const [id, patch] of Object.entries(patches)) {
  const found = byId.get(id);
  const rec = {
    id,
    index: found?.i ?? null,
    slug: found?.t?.slug || "",
    status: applyMode ? "applied" : "would_apply",
    reason: patch.reason,
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

  if (patch.assetsReceived) {
    changed(rec, "assetsReceived", JSON.stringify(t.assetsReceived || {}), JSON.stringify(patch.assetsReceived), "assets");
    if (applyMode) t.assetsReceived = patch.assetsReceived;
  }

  if (patch.verdict) {
    changed(rec, "verdict", t.verdict, patch.verdict, "verdict");
    if (applyMode) t.verdict = patch.verdict;
  }

  if (patch.grades) {
    changed(rec, "grades", JSON.stringify(t.grades || {}), JSON.stringify(patch.grades), "grades");
    if (applyMode) t.grades = patch.grades;
  }

  for (const field of ["summary", "partnerSummary", "analysis"]) {
    if (typeof patch[field] === "string") {
      changed(rec, field, t[field], patch[field], "copy");
      if (applyMode) t[field] = patch[field];
    }
  }

  if (Array.isArray(patch.perspectives)) {
    changed(rec, "perspectives", `${Array.isArray(t.perspectives) ? t.perspectives.length : 0} perspectives`, `${patch.perspectives.length} cleaned perspectives`, "perspectives");
    if (applyMode) t.perspectives = patch.perspectives;
  }

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

if (applyMode && blocked > 0) {
  for (const r of records) {
    if (r.status === "applied") r.status = "blocked_no_write";
  }
}

const statusCounts = {};
for (const r of records) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

const report = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  bottomBatchNumber: 1,
  recordsTargeted: records.length,
  blockedRecords: blocked,
  backupPath,
  statusCounts,
  records
};

writeJson(OUT_JSON, report);

const txt = `# NFL Bottom Batch 001 Final Six ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

Purpose:
- Resolve the 2 structural holds and 4 grade/verdict reviews left after the copy-only pass.
- Preserve or update visible grades/verdicts according to the reviewed decision.
- Remove wrong extra perspectives, duplicated assets, stale backend copy, and public publishStatus/qaNotes fields.

## Decision Summary
- DEN-2026-04-24-0400: keep Even C+/C+, remove duplicate Denver perspective.
- DEN-2026-04-25-0401: keep actual Denver/Cleveland trade only, remove Buffalo/Detroit contamination, set Even C/C.
- MIN-2026-0321: preserve conservative Even C/C, neutralize Minnesota-win copy.
- PIT-2026-0396: preserve Pittsburgh C+/C win, rewrite stale even-style copy.
- SEA-2026-04-25-0249: preserve Seattle B/C+ win, remove duplicated Andre Fuller asset.
- SEA-2026-05-27-0250: preserve Seattle B-/C win, remove duplicated conditional-pick asset.

## Summary
- Records targeted: ${records.length}
- Blocked records: ${blocked}
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}

## Status Counts
${Object.entries(statusCounts).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Blocked Records
${records.filter(r => r.status.startsWith("blocked")).length ? records.filter(r => r.status.startsWith("blocked")).map(r => `- ${r.id}: ${r.blockers.join(" | ")}`).join("\n") : "- None"}

## Records
${records.map(r => `## ${r.id}
- Index: ${r.index}
- Slug: ${r.slug}
- Status: ${r.status}
- Reason: ${r.reason}

### Blockers
${r.blockers.length ? r.blockers.map(b => `- ${b}`).join("\n") : "- None"}

### Changes
${r.changes.length ? r.changes.map(c => `- ${c.path} [${c.type}]\n  before: ${c.before}\n  after: ${c.after}`).join("\n") : "- None"}
`).join("\n\n")}

## Output Files
- JSON: reports/quality/nfl-bottom-batch-001-final-six-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-bottom-batch-001-final-six-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Bottom Batch 001 final six ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blocked}`);
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-001-final-six-${applyMode ? "apply" : "dry-run"}-v1.txt`);
