const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const applyMode = process.argv.includes("--apply");
const batchLabel = "006";

const OUT_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-9-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-9-${applyMode ? "apply" : "dry-run"}-v1.txt`);

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

function compact(v, max = 360) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
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

function listJoin(parts) {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] + " and " + parts[1];
  return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
}

function assetsFor(t, teamKey) {
  const list = t.assetsReceived && t.assetsReceived[teamKey];
  if (!Array.isArray(list) || !list.length) return "undisclosed consideration";
  const parts = list.map(assetText).map(s => s.trim()).filter(Boolean);
  return parts.length ? listJoin(parts) : "undisclosed consideration";
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
    analysis: `The value edge goes to ${winner} because the recorded return is stronger than what it gave up.`
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
  "DEN-2020-03-17-0361": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspectives and preserve Denver Broncos Win C+/C.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "cleveland-browns": "C" },
    teamKeys: ["denver-broncos", "cleveland-browns"],
    summary: "Denver converted Andy Janovich into a 2021 seventh-round pick, a practical roster-management move with limited but positive value. Cleveland received the useful player, but the recorded hindsight edge stays slightly with Denver.",
    partnerSummary: "Cleveland received Andy Janovich and gave up 2021 7th round pick (253rd overall, Marquiss Spencer). The value gap is small, but Denver keeps the slight edge.",
    analysis: "Denver holds a slight edge because it turned a replaceable roster piece into draft capital. Cleveland received a useful fullback, so the grade gap stays narrow.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2020-03-17-0361", sourceRow: 352, primaryTeam: "denver-broncos", partnerTeam: "cleveland-browns" },
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2020-0437", sourceRow: 435, primaryTeam: "cleveland-browns", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2020-03-18-0362": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective, fill Tennessee-side blank copy, and preserve Denver Broncos Win A/C.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "A", "tennessee-titans": "C" },
    teamKeys: ["denver-broncos", "tennessee-titans"],
    summary: "Denver acquired Jurrell Casey from Tennessee for a seventh-round pick, buying a decorated defensive lineman at minimal draft cost. The injury outcome limited the payoff, but the acquisition price made the process attractive.",
    partnerSummary: "Tennessee received 2020 7th round pick (237th overall subsequently traded, Thakarius Keyes) and gave up Jurrell Casey. The Titans cleared the veteran contract, but Denver received the stronger football value.",
    analysis: "Denver holds the edge because the cost was only a seventh-round pick for a proven defensive lineman. Casey's injury limited the return, but the acquisition process was still favorable.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2020-03-18-0362", sourceRow: 353, primaryTeam: "denver-broncos", partnerTeam: "tennessee-titans" },
      { sourceTeam: "tennessee-titans", sourceTradeId: "TEN-2020-0246", sourceRow: 247, primaryTeam: "tennessee-titans", partnerTeam: "denver-broncos" }
    ]
  },

  "PIT-2020-0368": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Pittsburgh Steelers Win and replace stale balanced copy.",
    assetsReceived: {
      "pittsburgh-steelers": [
        { type: "player", asset: "Chris Wormley" },
        { type: "pick", asset: "2021 7th round pick (254th overall, Pressley Harvin)" }
      ],
      "baltimore-ravens": [
        { type: "pick", asset: "2021 5th round pick (168th overall subsequently traded, Zach Davidson)" }
      ]
    },
    verdict: "Pittsburgh Steelers Win",
    grades: { "pittsburgh-steelers": "B", "baltimore-ravens": "C-" },
    teamKeys: ["pittsburgh-steelers", "baltimore-ravens"],
    perspectives: [
      { sourceTeam: "pittsburgh-steelers", sourceTradeId: "PIT-2020-0368", sourceRow: 369, primaryTeam: "pittsburgh-steelers", partnerTeam: "baltimore-ravens" },
      { sourceTeam: "baltimore-ravens", sourceTradeId: "BAL-2020-0091", sourceRow: 92, primaryTeam: "baltimore-ravens", partnerTeam: "pittsburgh-steelers" }
    ]
  },

  "SEA-2020-04-24-0214": {
    action: "patch",
    reason: "Grade/verdict decision: flip Jets Win to Seattle Seahawks Win; Darrell Taylor became the stronger realized asset than the Jets' return.",
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "B", "new-york-jets": "C-" },
    teamKeys: ["seattle-seahawks", "new-york-jets"],
    summary: "Seattle moved up for Darrell Taylor, sending New York the picks tied to Denzel Mims and Dalton Keene. Taylor became the most useful realized player in the exchange, giving Seattle the better hindsight result.",
    partnerSummary: "New York received 2020 2nd round pick (59th overall, Denzel Mims) and 2020 3rd round pick (101st overall subsequently traded, Dalton Keene) while giving up the pick that became Darrell Taylor. The extra draft volume did not turn into enough value.",
    analysis: "Seattle holds the edge because Darrell Taylor delivered more realized football value than the package New York received. The Jets gained extra draft capital, but the outcomes did not match the Seahawks' player return.",
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2020-04-24-0214", sourceRow: 205, primaryTeam: "seattle-seahawks", partnerTeam: "new-york-jets" },
      { sourceTeam: "new-york-jets", sourceTradeId: "NYJ-2020-0274", sourceRow: 275, primaryTeam: "new-york-jets", partnerTeam: "seattle-seahawks" }
    ]
  },

  "SEA-2020-04-25-0216": {
    action: "patch",
    reason: "Structural cleanup: remove unrelated KC/TEN and NO/HOU contamination and preserve Even Trade C/C.",
    verdict: "Even Trade",
    grades: { "miami-dolphins": "C", "seattle-seahawks": "C" },
    teamKeys: ["seattle-seahawks", "miami-dolphins"],
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2020-04-25-0216", sourceRow: 207, primaryTeam: "seattle-seahawks", partnerTeam: "miami-dolphins" },
      { sourceTeam: "miami-dolphins", sourceTradeId: "MIA-2020-0294", sourceRow: 295, primaryTeam: "miami-dolphins", partnerTeam: "seattle-seahawks" }
    ]
  },

  "DEN-2020-09-02-0363": {
    action: "patch",
    reason: "Grade/verdict decision: flip Giants Win to Denver Broncos Win; Denver's seventh-rounder became Jonathon Cooper.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "A-", "new-york-giants": "C" },
    teamKeys: ["denver-broncos", "new-york-giants"],
    summary: "Denver traded Isaac Yiadom for the 2021 seventh-round pick that became Jonathon Cooper. Cooper developed into the best realized asset in the exchange, turning a minor roster move into a clear Denver win.",
    partnerSummary: "New York received Isaac Yiadom and gave up 2021 7th round pick (239th overall, Jonathon Cooper). The Giants got cornerback depth, but Denver's pick outcome proved much stronger.",
    analysis: "Denver holds the edge because the acquired pick became Jonathon Cooper. Yiadom gave New York depth, but Cooper's value pushed the trade clearly toward the Broncos.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2020-09-02-0363", sourceRow: 354, primaryTeam: "denver-broncos", partnerTeam: "new-york-giants" },
      { sourceTeam: "new-york-giants", sourceTradeId: "NYG-2020-0290", sourceRow: 291, primaryTeam: "new-york-giants", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2020-09-04-0364": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective, strip truncated/internal copy, and preserve Even Trade C/C.",
    verdict: "Even Trade",
    grades: { "denver-broncos": "C", "cincinnati-bengals": "C" },
    teamKeys: ["denver-broncos", "cincinnati-bengals"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2020-09-04-0364", sourceRow: 355, primaryTeam: "denver-broncos", partnerTeam: "cincinnati-bengals" },
      { sourceTeam: "cincinnati-bengals", sourceTradeId: "CIN-2020-0143", sourceRow: 144, primaryTeam: "cincinnati-bengals", partnerTeam: "denver-broncos" }
    ]
  },

  "TB-2020-0249": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to Tampa Bay Buccaneers Win and repair malformed duplicated assets.",
    assetsReceived: {
      "tampa-bay-buccaneers": [
        { type: "player", asset: "Steve McLendon" },
        { type: "pick", asset: "2023 7th round pick (230th overall subsequently traded, Nick Broeker)" }
      ],
      "new-york-jets": [
        { type: "pick", asset: "2022 6th round pick (206th overall subsequently traded, Matt Henningsen)" }
      ]
    },
    verdict: "Tampa Bay Buccaneers Win",
    grades: { "tampa-bay-buccaneers": "B-", "new-york-jets": "C+" },
    teamKeys: ["tampa-bay-buccaneers", "new-york-jets"],
    perspectives: [
      { sourceTeam: "tampa-bay-buccaneers", sourceTradeId: "TB-2020-0249", sourceRow: 250, primaryTeam: "tampa-bay-buccaneers", partnerTeam: "new-york-jets" },
      { sourceTeam: "new-york-jets", sourceTradeId: "NYJ-2020-0278", sourceRow: 279, primaryTeam: "new-york-jets", partnerTeam: "tampa-bay-buccaneers" }
    ]
  },

  "DEN-2021-04-28-0365": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Denver Broncos Win B-/C+.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "carolina-panthers": "C+" },
    teamKeys: ["denver-broncos", "carolina-panthers"],
    summary: "Denver acquired Teddy Bridgewater from Carolina for a sixth-round pick, adding a credible bridge quarterback at a low acquisition cost. The move did not solve the long-term quarterback problem, but the price was reasonable.",
    partnerSummary: "Carolina received 2021 6th round pick (191st overall subsequently traded, Tarron Jackson) and gave up Teddy Bridgewater. The Panthers moved on from the contract, but Denver received the more useful football return.",
    analysis: "Denver holds the edge because Bridgewater gave the Broncos credible bridge-quarterback play for a low acquisition price. Carolina received a late-round pick, keeping the loss modest.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2021-04-28-0365", sourceRow: 356, primaryTeam: "denver-broncos", partnerTeam: "carolina-panthers" },
      { sourceTeam: "carolina-panthers", sourceTradeId: "CAR-2021-0074", sourceRow: 74, primaryTeam: "carolina-panthers", partnerTeam: "denver-broncos" }
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
  backupPath = path.join(path.dirname(DATA_PATH), `trades.backup-before-bottom-batch-006-final-9-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
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
  "SEA-2020-04-24-0214: New York Jets Win -> Seattle Seahawks Win, Seahawks B / Jets C-",
  "DEN-2020-09-02-0363: New York Giants Win -> Denver Broncos Win, Broncos A- / Giants C",
  "TB-2020-0249: Even Trade -> Tampa Bay Buccaneers Win, Buccaneers B- / Jets C+"
];

const report = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  bottomBatchNumber: 6,
  recordsTargeted: records.length,
  blockedRecords: blocked,
  quarantineRemovals: 0,
  trueGradeVerdictFlips: trueFlips,
  backupPath,
  statusCounts,
  records
};

writeJson(OUT_JSON, report);

const txt = `# NFL Bottom Batch 006 Final 9 ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

Purpose:
- Resolve the 6 structural holds and 3 grade/verdict reviews left after the copy-only pass.
- Remove duplicate/stale perspectives and unrelated perspective contamination.
- Remove public backend/provisional/internal language from perspectives.
- Repair malformed assets on Steve McLendon and other split player/pick records.
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
- JSON: reports/quality/nfl-bottom-batch-006-final-9-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-bottom-batch-006-final-9-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Bottom Batch 006 final 9 ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blocked}`);
console.log(`Quarantine removals: 0`);
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-006-final-9-${applyMode ? "apply" : "dry-run"}-v1.txt`);
