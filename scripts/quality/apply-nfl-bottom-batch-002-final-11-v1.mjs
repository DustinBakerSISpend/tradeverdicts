import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const applyMode = process.argv.includes("--apply");
const batchLabel = "002";

const OUT_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-11-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-11-${applyMode ? "apply" : "dry-run"}-v1.txt`);
const QUARANTINE_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-quarantined-records-v1.json`);

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

function compact(v, max = 320) {
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

const TEAM_NAMES = {
  "arizona-cardinals": "Arizona Cardinals",
  "atlanta-falcons": "Atlanta Falcons",
  "baltimore-ravens": "Baltimore Ravens",
  "buffalo-bills": "Buffalo Bills",
  "carolina-panthers": "Carolina Panthers",
  "chicago-bears": "Chicago Bears",
  "cincinnati-bengals": "Cincinnati Bengals",
  "cleveland-browns": "Cleveland Browns",
  "dallas-cowboys": "Dallas Cowboys",
  "denver-broncos": "Denver Broncos",
  "detroit-lions": "Detroit Lions",
  "green-bay-packers": "Green Bay Packers",
  "houston-texans": "Houston Texans",
  "indianapolis-colts": "Indianapolis Colts",
  "jacksonville-jaguars": "Jacksonville Jaguars",
  "kansas-city-chiefs": "Kansas City Chiefs",
  "las-vegas-raiders": "Las Vegas Raiders",
  "los-angeles-chargers": "Los Angeles Chargers",
  "los-angeles-rams": "Los Angeles Rams",
  "miami-dolphins": "Miami Dolphins",
  "minnesota-vikings": "Minnesota Vikings",
  "new-england-patriots": "New England Patriots",
  "new-orleans-saints": "New Orleans Saints",
  "new-york-giants": "New York Giants",
  "new-york-jets": "New York Jets",
  "philadelphia-eagles": "Philadelphia Eagles",
  "pittsburgh-steelers": "Pittsburgh Steelers",
  "san-francisco-49ers": "San Francisco 49ers",
  "seattle-seahawks": "Seattle Seahawks",
  "tampa-bay-buccaneers": "Tampa Bay Buccaneers",
  "tennessee-titans": "Tennessee Titans",
  "washington-commanders": "Washington Commanders"
};

function teamName(key) {
  return TEAM_NAMES[key] || safe(key).split("-").filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1)).join(" ");
}

function assetText(a) {
  if (a == null) return "";
  if (typeof a === "string") return a;
  return safe(a.asset || a.name || a.value || a.label || a.player || a.pick || a);
}

function assetsFor(t, teamKey) {
  const list = t.assetsReceived?.[teamKey];
  if (!Array.isArray(list) || !list.length) return "undisclosed consideration";
  const parts = list.map(assetText).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts.join("; ") : "undisclosed consideration";
}

function winnerName(verdict) {
  const v = safe(verdict).trim();
  if (!v || /^even trade$/i.test(v)) return "";
  return v.replace(/\s+Win$/i, "").trim();
}

function sentenceFor(t, primaryKey, partnerKey) {
  const primary = teamName(primaryKey);
  const partner = teamName(partnerKey);
  const primaryAssets = assetsFor(t, primaryKey);
  const partnerAssets = assetsFor(t, partnerKey);
  const winner = winnerName(t.verdict);

  if (!winner) {
    return {
      primarySummary: `${primary} acquired ${primaryAssets} from ${partner} for ${partnerAssets}. The available record does not show enough separation to call a clear long-term winner.`,
      partnerSummary: `${partner} received ${partnerAssets} and gave up ${primaryAssets}. The return remains close enough to support the Even Trade verdict.`,
      analysis: `This remains a balanced exchange. The recorded value does not create enough distance to move either side above an Even Trade verdict.`
    };
  }

  const primaryWon = primary.toLowerCase() === winner.toLowerCase();

  return {
    primarySummary: primaryWon
      ? `${primary} acquired ${primaryAssets} from ${partner} for ${partnerAssets}. ${primary} received the stronger recorded return, matching the ${t.verdict} verdict.`
      : `${primary} acquired ${primaryAssets} from ${partner} for ${partnerAssets}. The overall result favors ${winner}.`,
    partnerSummary: `${partner} received ${partnerAssets} and gave up ${primaryAssets}. The overall return favors ${winner}.`,
    analysis: primaryWon
      ? `${primary} gets the edge because the recorded return is stronger than what it gave up.`
      : `${winner} gets the edge because the recorded return is stronger than what it gave up.`
  };
}

function makePerspective(t, sourceTeam, sourceTradeId, sourceRow, primaryTeam, partnerTeam) {
  const s = sentenceFor(t, primaryTeam, partnerTeam);
  return {
    sourceTeam,
    sourceTradeId,
    sourceRow,
    primaryTeam,
    partnerTeam,
    primarySummary: s.primarySummary,
    partnerSummary: s.partnerSummary,
    analysis: s.analysis,
    primaryGrade: t.grades?.[primaryTeam] || "",
    partnerGrade: t.grades?.[partnerTeam] || "",
    verdict: t.verdict
  };
}

function applyPatchObject(t, patch) {
  if (patch.assetsReceived) t.assetsReceived = patch.assetsReceived;
  if (patch.verdict) t.verdict = patch.verdict;
  if (patch.grades) t.grades = patch.grades;

  const keys = patch.teamKeys || Object.keys(t.assetsReceived || {});
  const a = keys[0];
  const b = keys[1];

  const top = sentenceFor(t, a, b);
  t.summary = patch.summary || top.primarySummary;
  t.partnerSummary = patch.partnerSummary || top.partnerSummary;
  t.analysis = patch.analysis || top.analysis;

  t.perspectives = patch.perspectives.map(p =>
    makePerspective(t, p.sourceTeam, p.sourceTradeId, p.sourceRow, p.primaryTeam, p.partnerTeam)
  );
}

const patchSpecs = {
  "SEA-2024-10-23-0237": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve conservative Even C/C and remove Seattle-win/provisional copy from perspectives.",
    verdict: "Even Trade",
    grades: { "seattle-seahawks": "C", "tennessee-titans": "C" },
    teamKeys: ["seattle-seahawks", "tennessee-titans"],
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2024-10-23-0237", sourceRow: 228, primaryTeam: "seattle-seahawks", partnerTeam: "tennessee-titans" },
      { sourceTeam: "tennessee-titans", sourceTradeId: "TEN-2024-0270", sourceRow: 271, primaryTeam: "tennessee-titans", partnerTeam: "seattle-seahawks" }
    ]
  },

  "DEN-2024-11-04-0393": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve top-level Even B-/B- result.",
    verdict: "Even Trade",
    grades: { "arizona-cardinals": "B-", "denver-broncos": "B-" },
    teamKeys: ["denver-broncos", "arizona-cardinals"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2024-11-04-0393", sourceRow: 383, primaryTeam: "denver-broncos", partnerTeam: "arizona-cardinals" },
      { sourceTeam: "arizona-cardinals", sourceTradeId: "ARI-2024-0344", sourceRow: 345, primaryTeam: "arizona-cardinals", partnerTeam: "denver-broncos" }
    ]
  },

  "CLE-2024-0465": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Detroit Lions Win A-/C- and clean stale Even perspective.",
    assetsReceived: {
      "cleveland-browns": [
        { type: "pick", asset: "2026 6th round pick (199th overall subsequently traded, Emmanuel Henderson)" },
        { type: "pick", asset: "2025 5th round pick (164th overall subsequently traded, Yahya Black)" }
      ],
      "detroit-lions": [
        { type: "player", asset: "Za'Darius Smith" },
        { type: "pick", asset: "2026 7th round pick (222nd overall, Tyre West)" }
      ]
    },
    verdict: "Detroit Lions Win",
    grades: { "cleveland-browns": "C-", "detroit-lions": "A-" },
    teamKeys: ["cleveland-browns", "detroit-lions"],
    perspectives: [
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2024-0465", sourceRow: 463, primaryTeam: "cleveland-browns", partnerTeam: "detroit-lions" },
      { sourceTeam: "detroit-lions", sourceTradeId: "DET-2024-0411", sourceRow: 408, primaryTeam: "detroit-lions", partnerTeam: "cleveland-browns" }
    ]
  },

  "DEN-2025-04-25-0394": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Carolina Panthers Win B-/C+.",
    verdict: "Carolina Panthers Win",
    grades: { "denver-broncos": "C+", "carolina-panthers": "B-" },
    teamKeys: ["denver-broncos", "carolina-panthers"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2025-04-25-0394", sourceRow: 384, primaryTeam: "denver-broncos", partnerTeam: "carolina-panthers" },
      { sourceTeam: "carolina-panthers", sourceTradeId: "CAR-2025-0106", sourceRow: 106, primaryTeam: "carolina-panthers", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2025-04-25-0395": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Detroit Lions Win B+/C.",
    verdict: "Detroit Lions Win",
    grades: { "denver-broncos": "C", "detroit-lions": "B+" },
    teamKeys: ["denver-broncos", "detroit-lions"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2025-04-25-0395", sourceRow: 385, primaryTeam: "denver-broncos", partnerTeam: "detroit-lions" },
      { sourceTeam: "detroit-lions", sourceTradeId: "DET-2025-0412", sourceRow: 409, primaryTeam: "detroit-lions", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2025-04-25-0396": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate/stale Denver perspectives and preserve Denver Broncos Win B-/C-.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "philadelphia-eagles": "C-" },
    teamKeys: ["denver-broncos", "philadelphia-eagles"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2025-04-25-0396", sourceRow: 386, primaryTeam: "denver-broncos", partnerTeam: "philadelphia-eagles" },
      { sourceTeam: "philadelphia-eagles", sourceTradeId: "PHI-2025-0466", sourceRow: 467, primaryTeam: "philadelphia-eagles", partnerTeam: "denver-broncos" }
    ]
  },

  "MIN-2025-0312": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve conservative Even C+/C+ and remove Houston-win copy/truncated perspective text.",
    verdict: "Even Trade",
    grades: { "minnesota-vikings": "C+", "houston-texans": "C+" },
    teamKeys: ["minnesota-vikings", "houston-texans"],
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2025-0312", sourceRow: 313, primaryTeam: "minnesota-vikings", partnerTeam: "houston-texans" },
      { sourceTeam: "houston-texans", sourceTradeId: "HOU-2025-0121", sourceRow: 122, primaryTeam: "houston-texans", partnerTeam: "minnesota-vikings" }
    ]
  },

  "DEN-2025-04-26-0397": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and repair truncated Houston perspective, preserving Even C+/C+.",
    verdict: "Even Trade",
    grades: { "denver-broncos": "C+", "houston-texans": "C+" },
    teamKeys: ["denver-broncos", "houston-texans"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2025-04-26-0397", sourceRow: 387, primaryTeam: "denver-broncos", partnerTeam: "houston-texans" },
      { sourceTeam: "houston-texans", sourceTradeId: "HOU-2025-0123", sourceRow: 124, primaryTeam: "houston-texans", partnerTeam: "denver-broncos" }
    ]
  },

  "DET-2025-0414": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve conservative Even C/C and remove Detroit-win copy from top/perspectives.",
    verdict: "Even Trade",
    grades: { "detroit-lions": "C", "new-england-patriots": "C" },
    teamKeys: ["detroit-lions", "new-england-patriots"],
    perspectives: [
      { sourceTeam: "detroit-lions", sourceTradeId: "DET-2025-0414", sourceRow: 411, primaryTeam: "detroit-lions", partnerTeam: "new-england-patriots" },
      { sourceTeam: "new-england-patriots", sourceTradeId: "NE-2025-0458", sourceRow: 459, primaryTeam: "new-england-patriots", partnerTeam: "detroit-lions" }
    ]
  },

  "IND-2025-0386": {
    action: "quarantine_remove",
    reason: "Unknown-team/unknown-partner placeholder with malformed asset text; remove from live data and save to quarantine report."
  },

  "DEN-2025-08-20-0398": {
    action: "patch",
    reason: "Grade/verdict cleanup: promote stale Even C/C to Denver Broncos Win B/C+ based on the recorded fourth-plus-seventh return for Devaughn Vele.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B", "new-orleans-saints": "C+" },
    teamKeys: ["denver-broncos", "new-orleans-saints"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2025-08-20-0398", sourceRow: 388, primaryTeam: "denver-broncos", partnerTeam: "new-orleans-saints" },
      { sourceTeam: "new-orleans-saints", sourceTradeId: "NO-2025-0340", sourceRow: 341, primaryTeam: "new-orleans-saints", partnerTeam: "denver-broncos" }
    ]
  }
};

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;
if (!Array.isArray(trades)) throw new Error("Could not find trades array.");

const byId = new Map(trades.map((t, i) => [getId(t), { t, i }]));

const records = [];
const quarantine = [];
let blocked = 0;

for (const [id, spec] of Object.entries(patchSpecs)) {
  const found = byId.get(id);
  const rec = {
    id,
    action: spec.action,
    index: found?.i ?? null,
    slug: found?.t?.slug || "",
    status: applyMode ? "applied" : "would_apply",
    reason: spec.reason,
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

  if (spec.action === "quarantine_remove") {
    rec.changes.push({
      path: "(record)",
      type: "quarantine",
      before: "present in live data",
      after: "removed from live data and saved to quarantine report"
    });
    quarantine.push({
      id,
      index: found.i,
      slug: t.slug,
      reason: spec.reason,
      trade: t
    });
    records.push(rec);
    continue;
  }

  const beforeSnapshot = structuredClone(t);
  const next = structuredClone(t);
  applyPatchObject(next, spec);

  changed(rec, "assetsReceived", JSON.stringify(beforeSnapshot.assetsReceived || {}), JSON.stringify(next.assetsReceived || {}), "assets");
  changed(rec, "verdict", beforeSnapshot.verdict, next.verdict, "verdict");
  changed(rec, "grades", JSON.stringify(beforeSnapshot.grades || {}), JSON.stringify(next.grades || {}), "grades");
  changed(rec, "summary", beforeSnapshot.summary, next.summary, "copy");
  changed(rec, "partnerSummary", beforeSnapshot.partnerSummary, next.partnerSummary, "copy");
  changed(rec, "analysis", beforeSnapshot.analysis, next.analysis, "copy");
  changed(rec, "perspectives", `${Array.isArray(beforeSnapshot.perspectives) ? beforeSnapshot.perspectives.length : 0} perspectives`, `${Array.isArray(next.perspectives) ? next.perspectives.length : 0} cleaned perspectives`, "perspectives");

  if (applyMode) {
    Object.assign(t, next);
  }

  records.push(rec);
}

let backupPath = null;

if (applyMode && blocked === 0) {
  backupPath = path.join(path.dirname(DATA_PATH), `trades.backup-before-bottom-batch-002-final-11-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.copyFileSync(DATA_PATH, backupPath);

  if (quarantine.length) {
    writeJson(QUARANTINE_JSON, {
      generatedAt: new Date().toISOString(),
      bottomBatchNumber: 2,
      records: quarantine
    });
  }

  const removeIds = new Set(quarantine.map(q => q.id));
  const filtered = trades.filter(t => !removeIds.has(getId(t)));

  if (Array.isArray(data)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(filtered, null, 2) + "\n");
  } else {
    data.trades = filtered;
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
  bottomBatchNumber: 2,
  recordsTargeted: records.length,
  blockedRecords: blocked,
  quarantineRemovals: quarantine.length,
  backupPath,
  quarantinePath: quarantine.length ? QUARANTINE_JSON : null,
  statusCounts,
  records
};

writeJson(OUT_JSON, report);

const txt = `# NFL Bottom Batch 002 Final 11 ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

Purpose:
- Resolve the 7 structural holds and 4 grade/verdict reviews left after the copy-only pass.
- Remove duplicate/stale perspectives.
- Remove public backend/provisional fields from perspectives.
- Quarantine the malformed unknown-team Indianapolis placeholder.
- Preserve or update visible grades/verdicts according to reviewed decisions.

## Decision Summary
- SEA-2024-10-23-0237: preserve Even C/C, neutralize Seattle-win copy.
- DEN-2024-11-04-0393: preserve Even B-/B-, remove duplicate Denver perspective.
- CLE-2024-0465: preserve Detroit Lions Win A-/C-, clean stale Cleveland Even side.
- DEN-2025-04-25-0394: preserve Carolina Panthers Win B-/C+, remove duplicate Denver perspective.
- DEN-2025-04-25-0395: preserve Detroit Lions Win B+/C, remove duplicate Denver perspective.
- DEN-2025-04-25-0396: preserve Denver Broncos Win B-/C-, remove extra Denver perspectives.
- MIN-2025-0312: preserve Even C+/C+, neutralize Houston-win copy.
- DEN-2025-04-26-0397: preserve Even C+/C+, repair Houston perspective.
- DET-2025-0414: preserve Even C/C, neutralize Detroit-win copy.
- IND-2025-0386: quarantine/remove unknown-team placeholder.
- DEN-2025-08-20-0398: update to Denver Broncos Win B/C+ based on recorded return.

## Summary
- Records targeted: ${records.length}
- Blocked records: ${blocked}
- Quarantine removals: ${quarantine.length}
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}
${quarantine.length ? `- Quarantine file: ${QUARANTINE_JSON}` : "- Quarantine file: no quarantine records"}

## Status Counts
${Object.entries(statusCounts).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Blocked Records
${records.filter(r => r.status.startsWith("blocked")).length ? records.filter(r => r.status.startsWith("blocked")).map(r => `- ${r.id}: ${r.blockers.join(" | ")}`).join("\n") : "- None"}

## Records
${records.map(r => `## ${r.id}
- Index: ${r.index}
- Slug: ${r.slug}
- Action: ${r.action}
- Status: ${r.status}
- Reason: ${r.reason}

### Blockers
${r.blockers.length ? r.blockers.map(b => `- ${b}`).join("\n") : "- None"}

### Changes
${r.changes.length ? r.changes.map(c => `- ${c.path} [${c.type}]\n  before: ${c.before}\n  after: ${c.after}`).join("\n") : "- None"}
`).join("\n\n")}

## Output Files
- JSON: reports/quality/nfl-bottom-batch-002-final-11-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-bottom-batch-002-final-11-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Bottom Batch 002 final 11 ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blocked}`);
console.log(`Quarantine removals: ${quarantine.length}`);
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-002-final-11-${applyMode ? "apply" : "dry-run"}-v1.txt`);
