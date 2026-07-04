const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const applyMode = process.argv.includes("--apply");
const batchLabel = "004";

const OUT_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-13-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-13-${applyMode ? "apply" : "dry-run"}-v1.txt`);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 340) {
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
  const list = t.assetsReceived && t.assetsReceived[teamKey];
  if (!Array.isArray(list) || !list.length) return "undisclosed consideration";
  const parts = list.map(assetText).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts.join("; ") : "undisclosed consideration";
}

function winnerName(verdict) {
  const v = safe(verdict).trim();
  if (!v || /^even trade$/i.test(v)) return "";
  return v.replace(/\s+Win$/i, "").trim();
}

function sentenceFor(t, primaryKey, otherKey) {
  const primary = teamName(primaryKey);
  const other = teamName(otherKey);
  const primaryAssets = assetsFor(t, primaryKey);
  const otherAssets = assetsFor(t, otherKey);
  const winner = winnerName(t.verdict);

  if (!winner) {
    return {
      primarySummary: `${primary} acquired ${primaryAssets} from ${other} for ${otherAssets}. The recorded return stays close enough for an Even Trade verdict.`,
      partnerSummary: `${other} received ${otherAssets} and gave up ${primaryAssets}. The exchange remains balanced after the recorded assets are weighed.`,
      analysis: `This remains an Even Trade because the recorded assets do not create enough separation for either side.`
    };
  }

  return {
    primarySummary: `${primary} acquired ${primaryAssets} from ${other} for ${otherAssets}. The stronger recorded return sits with ${winner}, matching the ${t.verdict} verdict.`,
    partnerSummary: `${other} received ${otherAssets} and gave up ${primaryAssets}. The overall value edge goes to ${winner}.`,
    analysis: `${winner} gets the edge because the recorded return is stronger than what it gave up.`
  };
}

function makePerspective(t, p) {
  const s = sentenceFor(t, p.primaryTeam, p.partnerTeam);
  return {
    sourceTeam: p.sourceTeam,
    sourceTradeId: p.sourceTradeId,
    sourceRow: p.sourceRow,
    primaryTeam: p.primaryTeam,
    partnerTeam: p.partnerTeam,
    primarySummary: p.primarySummary || s.primarySummary,
    partnerSummary: p.partnerSummary || s.partnerSummary,
    primaryGrade: t.grades && t.grades[p.primaryTeam] ? t.grades[p.primaryTeam] : "",
    partnerGrade: t.grades && t.grades[p.partnerTeam] ? t.grades[p.partnerTeam] : "",
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

  t.perspectives = patch.perspectives.map(p => makePerspective(t, p));
}

const patchSpecs = {
  "MIN-2022-0287": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Indianapolis Colts Win and align stale Minnesota-side copy to the Colts edge.",
    verdict: "Indianapolis Colts Win",
    grades: { "minnesota-vikings": "C-", "indianapolis-colts": "B-" },
    teamKeys: ["minnesota-vikings", "indianapolis-colts"],
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2022-0287", sourceRow: 288, primaryTeam: "minnesota-vikings", partnerTeam: "indianapolis-colts" },
      { sourceTeam: "indianapolis-colts", sourceTradeId: "IND-2022-0375", sourceRow: 376, primaryTeam: "indianapolis-colts", partnerTeam: "minnesota-vikings" }
    ]
  },

  "MIN-2022-0289": {
    action: "patch",
    reason: "Structural cleanup: keep the primary Minnesota/Raiders pick swap, remove the separate bundled trade perspective, and preserve Raiders Win.",
    assetsReceived: {
      "minnesota-vikings": [
        { type: "pick", asset: "2022 4th round pick (126th overall subsequently traded, Neil Farrell)" },
        { type: "pick", asset: "2022 7th round pick (227th overall, Nick Muse)" }
      ],
      "las-vegas-raiders": [
        { type: "pick", asset: "2022 4th round pick (122nd overall, Zamir White)" },
        { type: "pick", asset: "2022 7th round pick (250th overall, Brittain Brown)" }
      ]
    },
    verdict: "Las Vegas Raiders Win",
    grades: { "minnesota-vikings": "C", "las-vegas-raiders": "B-" },
    teamKeys: ["minnesota-vikings", "las-vegas-raiders"],
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2022-0289", sourceRow: 290, primaryTeam: "minnesota-vikings", partnerTeam: "las-vegas-raiders" },
      { sourceTeam: "las-vegas-raiders", sourceTradeId: "RAI-2022-0408", sourceRow: 409, primaryTeam: "las-vegas-raiders", partnerTeam: "minnesota-vikings" }
    ]
  },

  "TEN-2022-0258": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to Tennessee Titans Win; Tennessee received Tyree Gillespie while the conditional pick was not conveyed.",
    assetsReceived: {
      "tennessee-titans": [
        { type: "player", asset: "Tyree Gillespie" }
      ],
      "las-vegas-raiders": [
        { type: "pick", asset: "Conditional 2024 7th round pick (not conveyed)" }
      ]
    },
    verdict: "Tennessee Titans Win",
    grades: { "tennessee-titans": "C+", "las-vegas-raiders": "C-" },
    teamKeys: ["tennessee-titans", "las-vegas-raiders"],
    perspectives: [
      { sourceTeam: "tennessee-titans", sourceTradeId: "TEN-2022-0258", sourceRow: 259, primaryTeam: "tennessee-titans", partnerTeam: "las-vegas-raiders" }
    ]
  },

  "DEN-2022-08-30-0379": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Denver Broncos Win C+/C.",
    assetsReceived: {
      "denver-broncos": [
        { type: "pick", asset: "2023 6th round pick (195th overall subsequently traded, A.T. Perry)" }
      ],
      "pittsburgh-steelers": [
        { type: "player", asset: "Malik Reed" },
        { type: "pick", asset: "2023 7th round pick (241st overall, Cory Trice)" }
      ]
    },
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "pittsburgh-steelers": "C" },
    teamKeys: ["denver-broncos", "pittsburgh-steelers"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2022-08-30-0379", sourceRow: 369, primaryTeam: "denver-broncos", partnerTeam: "pittsburgh-steelers" },
      { sourceTeam: "pittsburgh-steelers", sourceTradeId: "PIT-2022-0375", sourceRow: 376, primaryTeam: "pittsburgh-steelers", partnerTeam: "denver-broncos" }
    ]
  },

  "MIN-2022-0293": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Houston Texans Win and replace stale Even copy/truncated Houston perspective.",
    assetsReceived: {
      "minnesota-vikings": [
        { type: "player", asset: "Ross Blacklock" },
        { type: "pick", asset: "2023 7th round pick (219th overall subsequently traded, Antoine Green)" }
      ],
      "houston-texans": [
        { type: "pick", asset: "2023 6th round pick (201st overall, Jarrett Patterson)" }
      ]
    },
    verdict: "Houston Texans Win",
    grades: { "minnesota-vikings": "C+", "houston-texans": "B" },
    teamKeys: ["minnesota-vikings", "houston-texans"],
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2022-0293", sourceRow: 294, primaryTeam: "minnesota-vikings", partnerTeam: "houston-texans" },
      { sourceTeam: "houston-texans", sourceTradeId: "HOU-2022-0090", sourceRow: 91, primaryTeam: "houston-texans", partnerTeam: "minnesota-vikings" }
    ]
  },

  "MIN-2022-08-30-0299": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to Pittsburgh Steelers Win; Pittsburgh received Jesse Davis while the conditional pick was not conveyed.",
    assetsReceived: {
      "minnesota-vikings": [
        { type: "pick", asset: "Conditional 2025 7th round pick (not conveyed)" }
      ],
      "pittsburgh-steelers": [
        { type: "player", asset: "Jesse Davis" }
      ]
    },
    verdict: "Pittsburgh Steelers Win",
    grades: { "minnesota-vikings": "C", "pittsburgh-steelers": "C+" },
    teamKeys: ["minnesota-vikings", "pittsburgh-steelers"],
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2022-0292", sourceRow: 293, primaryTeam: "minnesota-vikings", partnerTeam: "pittsburgh-steelers" },
      { sourceTeam: "pittsburgh-steelers", sourceTradeId: "PIT-2022-0374", sourceRow: 375, primaryTeam: "pittsburgh-steelers", partnerTeam: "minnesota-vikings" }
    ]
  },

  "DEN-2022-11-01-0381": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to New York Jets Win; the Jets received the higher pick while moving Jacob Martin and a fifth.",
    assetsReceived: {
      "denver-broncos": [
        { type: "player", asset: "Jacob Martin" },
        { type: "pick", asset: "2024 5th round pick (145th overall, Kris Abrams-Draine)" }
      ],
      "new-york-jets": [
        { type: "pick", asset: "2024 4th round pick (113th overall subsequently traded, Devontez Walker)" }
      ]
    },
    verdict: "New York Jets Win",
    grades: { "denver-broncos": "C", "new-york-jets": "C+" },
    teamKeys: ["denver-broncos", "new-york-jets"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2022-11-01-0381", sourceRow: 371, primaryTeam: "denver-broncos", partnerTeam: "new-york-jets" },
      { sourceTeam: "new-york-jets", sourceTradeId: "NYJ-2022-0293", sourceRow: 294, primaryTeam: "new-york-jets", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2023-01-31-0382": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspectives and preserve Saints Win B+/C- on the Sean Payton compensation trade.",
    verdict: "New Orleans Saints Win",
    grades: { "denver-broncos": "C-", "new-orleans-saints": "B+" },
    teamKeys: ["denver-broncos", "new-orleans-saints"],
    summary: "Denver sent premium draft compensation to New Orleans for the right to hire Sean Payton. Payton gave the Broncos a proven coach to reset the program, but New Orleans converted a coach's contractual rights into first- and second-round value.",
    partnerSummary: "New Orleans received 2023 1st round pick (29th overall, Bryan Bresee) and 2024 2nd round pick (45th overall subsequently traded, Edgerrin Cooper) while giving up Sean Payton and a 2024 third-round pick. The asset ledger favors the Saints.",
    analysis: "Coach compensation trades are harder to grade than player trades because Denver's return is leadership rather than direct on-field production. Still, New Orleans received major draft value for a coach no longer working for the franchise, so the Saints keep the stronger grade.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2023-01-31-0382", sourceRow: 372, primaryTeam: "denver-broncos", partnerTeam: "new-orleans-saints" },
      { sourceTeam: "new-orleans-saints", sourceTradeId: "NO-2023-0330", sourceRow: 331, primaryTeam: "new-orleans-saints", partnerTeam: "denver-broncos" }
    ]
  },

  "CAR-2023-0093": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Carolina perspective and strip internal GSC/indexing language from landmark Bears/Panthers trade.",
    verdict: "Chicago Bears Win",
    grades: { "chicago-bears": "A+", "carolina-panthers": "D-" },
    teamKeys: ["carolina-panthers", "chicago-bears"],
    summary: "Carolina moved up to No. 1 for Bryce Young, while Chicago turned the pick into D.J. Moore, multiple premium selections, and the 2024 No. 1 pick that became Caleb Williams. The value gap makes this a clear Chicago Bears win.",
    partnerSummary: "Chicago's trade down with Carolina became one of the most important modern draft hauls. The Bears received D.J. Moore, future premium picks, and the Caleb Williams pick, while Carolina took on the risk of a massive quarterback trade-up.",
    analysis: "This trade still matters because it links two No. 1 overall quarterback stories on one page: Carolina moved up for Bryce Young, then its future first became Caleb Williams for Chicago. The Bears received immediate help and future power. Carolina received the quarterback chance, but the price stripped away too much roster-building value.",
    perspectives: [
      {
        sourceTeam: "carolina-panthers",
        sourceTradeId: "CAR-2023-0093",
        sourceRow: 93,
        primaryTeam: "carolina-panthers",
        partnerTeam: "chicago-bears",
        primarySummary: "Carolina moved aggressively for Bryce Young, but Chicago received D.J. Moore, future premium picks, and the Caleb Williams selection while the Panthers took on most of the risk.",
        partnerSummary: "Chicago turned the No. 1 pick into one of the best modern draft hauls: D.J. Moore, multiple premium picks, and the 2024 No. 1 pick that became Caleb Williams."
      },
      {
        sourceTeam: "chicago-bears",
        sourceTradeId: "CHI-2023-0494",
        sourceRow: 494,
        primaryTeam: "chicago-bears",
        partnerTeam: "carolina-panthers",
        primarySummary: "Chicago turned the No. 1 pick into one of the best modern draft hauls: D.J. Moore, multiple premium picks, and the 2024 No. 1 pick that became Caleb Williams.",
        partnerSummary: "Carolina moved aggressively for Bryce Young, but Chicago received the safer and larger value package."
      }
    ]
  },

  "CLE-2023-0452": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Cleveland Browns Win and replace stale Even copy.",
    assetsReceived: {
      "cleveland-browns": [
        { type: "player", asset: "Elijah Moore" },
        { type: "pick", asset: "2023 3rd round pick (74th overall, Cedric Tillman)" }
      ],
      "new-york-jets": [
        { type: "pick", asset: "2023 2nd round pick (42nd overall subsequently traded, Luke Musgrave)" }
      ]
    },
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "B", "new-york-jets": "C" },
    teamKeys: ["cleveland-browns", "new-york-jets"],
    perspectives: [
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2023-0452", sourceRow: 450, primaryTeam: "cleveland-browns", partnerTeam: "new-york-jets" },
      { sourceTeam: "new-york-jets", sourceTradeId: "NYJ-2023-0295", sourceRow: 296, primaryTeam: "new-york-jets", partnerTeam: "cleveland-browns" }
    ]
  },

  "DEN-2023-04-28-0383": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspectives and preserve Denver Broncos Win B-/C+.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "detroit-lions": "C+" },
    teamKeys: ["denver-broncos", "detroit-lions"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2023-04-28-0383", sourceRow: 373, primaryTeam: "denver-broncos", partnerTeam: "detroit-lions" },
      { sourceTeam: "detroit-lions", sourceTradeId: "DET-2023-0400", sourceRow: 397, primaryTeam: "detroit-lions", partnerTeam: "denver-broncos" }
    ]
  },

  "JAX-2023-0098": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Chicago Bears Win and replace stale Even copy.",
    verdict: "Chicago Bears Win",
    grades: { "jacksonville-jaguars": "C", "chicago-bears": "B" },
    teamKeys: ["jacksonville-jaguars", "chicago-bears"],
    perspectives: [
      { sourceTeam: "jacksonville-jaguars", sourceTradeId: "JAX-2023-0098", sourceRow: 99, primaryTeam: "jacksonville-jaguars", partnerTeam: "chicago-bears" },
      { sourceTeam: "chicago-bears", sourceTradeId: "CHI-2023-0496", sourceRow: 496, primaryTeam: "chicago-bears", partnerTeam: "jacksonville-jaguars" }
    ]
  },

  "DEN-2023-04-29-0385": {
    action: "patch",
    reason: "Grade/verdict decision: flip New Orleans Saints Win to Denver Broncos Win; Denver received Adam Trautman plus Alex Forsyth's slot for the A.T. Perry sixth-rounder.",
    assetsReceived: {
      "denver-broncos": [
        { type: "player", asset: "Adam Trautman" },
        { type: "pick", asset: "2023 7th round pick (257th overall, Alex Forsyth)" }
      ],
      "new-orleans-saints": [
        { type: "pick", asset: "2023 6th round pick (195th overall, A.T. Perry)" }
      ]
    },
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "new-orleans-saints": "C" },
    teamKeys: ["denver-broncos", "new-orleans-saints"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2023-04-29-0385", sourceRow: 375, primaryTeam: "denver-broncos", partnerTeam: "new-orleans-saints" },
      { sourceTeam: "new-orleans-saints", sourceTradeId: "NO-2023-0333", sourceRow: 334, primaryTeam: "new-orleans-saints", partnerTeam: "denver-broncos" }
    ]
  }
};

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;
if (!Array.isArray(trades)) throw new Error("Could not find trades array.");

const byId = new Map(trades.map((t, i) => [getId(t), { t, i }]));
const records = [];
let blocked = 0;

for (const [id, spec] of Object.entries(patchSpecs)) {
  const found = byId.get(id);
  const rec = {
    id,
    action: spec.action,
    index: found ? found.i : null,
    slug: found && found.t ? found.t.slug || "" : "",
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
  const beforeSnapshot = clone(t);
  const next = clone(t);
  applyPatchObject(next, spec);

  changed(rec, "assetsReceived", JSON.stringify(beforeSnapshot.assetsReceived || {}), JSON.stringify(next.assetsReceived || {}), "assets");
  changed(rec, "verdict", beforeSnapshot.verdict, next.verdict, "verdict");
  changed(rec, "grades", JSON.stringify(beforeSnapshot.grades || {}), JSON.stringify(next.grades || {}), "grades");
  changed(rec, "summary", beforeSnapshot.summary, next.summary, "copy");
  changed(rec, "partnerSummary", beforeSnapshot.partnerSummary, next.partnerSummary, "copy");
  changed(rec, "analysis", beforeSnapshot.analysis, next.analysis, "copy");
  changed(rec, "perspectives", `${Array.isArray(beforeSnapshot.perspectives) ? beforeSnapshot.perspectives.length : 0} perspectives`, `${Array.isArray(next.perspectives) ? next.perspectives.length : 0} cleaned perspectives`, "perspectives");

  if (applyMode) Object.assign(t, next);
  records.push(rec);
}

let backupPath = null;

if (applyMode && blocked === 0) {
  backupPath = path.join(path.dirname(DATA_PATH), `trades.backup-before-bottom-batch-004-final-13-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.copyFileSync(DATA_PATH, backupPath);
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
}

if (applyMode && blocked > 0) {
  for (const r of records) {
    if (r.status === "applied") r.status = "blocked_no_write";
  }
}

const statusCounts = {};
for (const r of records) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

const trueFlips = [
  "TEN-2022-0258: Even Trade -> Tennessee Titans Win, Titans C+ / Raiders C-",
  "MIN-2022-08-30-0299: Even Trade -> Pittsburgh Steelers Win, Steelers C+ / Vikings C",
  "DEN-2022-11-01-0381: Even Trade -> New York Jets Win, Jets C+ / Broncos C",
  "DEN-2023-04-29-0385: New Orleans Saints Win -> Denver Broncos Win, Broncos B- / Saints C"
];

const report = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  bottomBatchNumber: 4,
  recordsTargeted: records.length,
  blockedRecords: blocked,
  quarantineRemovals: 0,
  trueGradeVerdictFlips: trueFlips,
  backupPath,
  statusCounts,
  records
};

writeJson(OUT_JSON, report);

const txt = `# NFL Bottom Batch 004 Final 13 ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

Purpose:
- Resolve the 7 structural holds and 6 grade/verdict reviews left after the copy-only pass.
- Remove duplicate/stale perspectives.
- Remove public backend/provisional fields from perspectives.
- Preserve or update visible grades/verdicts according to reviewed decisions.

## Summary
- Records targeted: ${records.length}
- Blocked records: ${blocked}
- Quarantine removals: 0
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}

## True Grade/Verdict Flips
${trueFlips.map(x => `- ${x}`).join("\n")}

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
- JSON: reports/quality/nfl-bottom-batch-004-final-13-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-bottom-batch-004-final-13-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Bottom Batch 004 final 13 ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blocked}`);
console.log(`Quarantine removals: 0`);
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-004-final-13-${applyMode ? "apply" : "dry-run"}-v1.txt`);
