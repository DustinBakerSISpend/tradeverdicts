#!/usr/bin/env node
/**
 * TradeVerdicts.com NFL Bottom Batch 010 final reviewed patch v1
 *
 * Dry run:
 *   node scripts/quality/tradeverdicts-nfl-bottom-batch-010-final-patch-v1.mjs
 *
 * Apply:
 *   node scripts/quality/tradeverdicts-nfl-bottom-batch-010-final-patch-v1.mjs --apply
 *
 * This patch is intentionally narrow:
 * - touches only the 32 remaining non-clean records from Bottom Batch 010
 * - normalizes remaining perspective-level grade/verdict/copy conflicts
 * - collapses structural duplicate perspectives to canonical team perspectives
 * - preserves existing top-level IDs/slugs/dates/assets except where noted
 */

import fs from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const applyMode = args.has("--apply");
const repoRoot = process.cwd();

const dataPath = path.join(repoRoot, "src", "data", "nfl", "trades.json");
const reportDir = path.join(repoRoot, "reports", "quality");
const batchLabel = "010";
const outJson = path.join(reportDir, `nfl-bottom-batch-${batchLabel}-final-patch-${applyMode ? "apply" : "dry-run"}-v1.json`);
const outTxt = path.join(reportDir, `nfl-bottom-batch-${batchLabel}-final-patch-${applyMode ? "apply" : "dry-run"}-v1.txt`);

const teamNames = {
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
  "washington-commanders": "Washington"
};

const verdictAliases = {
  "Vikings Win": "Minnesota Vikings Win",
  "Washington Redskins Win": "Washington Win",
  "Washington Commanders Win": "Washington Win",
  "Oakland Raiders Win": "Las Vegas Raiders Win",
  "Oakland/Los Angeles/Las Vegas Raiders Win": "Las Vegas Raiders Win",
  "Houston Oilers/Tennessee Titans Win": "Tennessee Titans Win",
  "Los Angeles/Cleveland/St. Louis Rams Win": "Los Angeles Rams Win",
  "Los Angeles/St. Louis Rams Win": "Los Angeles Rams Win"
};

const finalDecisions = {
  // Remaining copy lane: root fields were already patched; final patch aligns perspective-level conflicts.
  "SEA-2014-05-10-0172": {
    lane: "copy_repair_candidate",
    verdict: "Even Trade",
    grades: { "seattle-seahawks": "C", "cincinnati-bengals": "C" },
    note: "Align both perspectives to the canonical even verdict."
  },
  "NYJ-2015-0242": {
    lane: "copy_repair_candidate",
    verdict: "Chicago Bears Win",
    grades: { "new-york-jets": "C", "chicago-bears": "B" },
    note: "Keep the reviewed Bears edge and align the Jets perspective."
  },
  "JAX-2015-0061": {
    lane: "copy_repair_candidate",
    verdict: "New York Jets Win",
    grades: { "jacksonville-jaguars": "C", "new-york-jets": "B-" },
    note: "Keep the reviewed Jets edge and align the Jaguars perspective."
  },
  "MIN-2015-0245": {
    lane: "copy_repair_candidate",
    verdict: "Even Trade",
    grades: { "minnesota-vikings": "A", "atlanta-falcons": "A" },
    note: "Rare win-win fifth-round result: Diggs and Jarrett both justify A/A even."
  },
  "RAM-2015-0478": {
    lane: "copy_repair_candidate",
    verdict: "Even Trade",
    grades: { "los-angeles-rams": "B-", "new-york-jets": "B-" },
    note: "Low-stakes Stacy/Bryce Hager exchange remains even."
  },
  "MIA-2016-0265": {
    lane: "copy_repair_candidate",
    verdict: "Even Trade",
    grades: { "miami-dolphins": "C", "cleveland-browns": "C" },
    note: "Keep this seventh-round/Jamar Taylor exchange neutral."
  },
  "MIA-2016-0267": {
    lane: "copy_repair_candidate",
    verdict: "Even Trade",
    grades: { "miami-dolphins": "C", "new-england-patriots": "C" },
    note: "Keep the late-pick exchange neutral."
  },
  "NYJ-2016-0247": {
    lane: "copy_repair_candidate",
    verdict: "New York Jets Win",
    grades: { "washington-commanders": "C", "new-york-jets": "C+" },
    note: "Keep the Brandon Shell/Jets lean and align the Washington perspective."
  },

  // Grade/verdict review lane.
  "IND-2014-0342": {
    lane: "grade_verdict_review",
    verdict: "Even Trade",
    grades: { "seattle-seahawks": "C", "indianapolis-colts": "C" },
    note: "Marcus Burley for a late pick remains low-separation/even."
  },
  "SEA-2014-10-18-0174": {
    lane: "grade_verdict_review",
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "C+", "new-york-jets": "C" },
    note: "Keep the slight Seattle edge after moving Percy Harvin."
  },
  "MIN-2015-03-10-0249": {
    lane: "grade_verdict_review",
    verdict: "Even Trade",
    grades: { "minnesota-vikings": "B", "buffalo-bills": "B" },
    note: "Cassel/pick package stays balanced enough for even."
  },
  "MIN-2015-05-01-0250": {
    lane: "grade_verdict_review",
    verdict: "Kansas City Chiefs Win",
    grades: { "minnesota-vikings": "C", "kansas-city-chiefs": "B-" },
    note: "Visible flip: Kansas City landed the cleaner realized value in the Chris Conley pick move."
  },
  "CLE-2015-0394": {
    lane: "grade_verdict_review",
    verdict: "Arizona Cardinals Win",
    grades: { "arizona-cardinals": "B", "cleveland-browns": "C-" },
    note: "Visible flip: Rodney Gunter gives Arizona the cleaner realized outcome."
  },
  "ATL-2015-0268": {
    lane: "grade_verdict_review",
    verdict: "Atlanta Falcons Win",
    grades: { "atlanta-falcons": "B", "tennessee-titans": "C" },
    note: "Visible flip: Andy Levitre supplied Atlanta useful veteran line value for a late pick."
  },
  "PHI-2015-0381": {
    lane: "grade_verdict_review",
    verdict: "Philadelphia Eagles Win",
    grades: { "arizona-cardinals": "C+", "philadelphia-eagles": "B-" },
    note: "Keep the slight Eagles edge in the Matt Barkley/Joe Walker exchange."
  },
  "SEA-2015-09-06-0179": {
    lane: "grade_verdict_review",
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "C+", "dallas-cowboys": "C-" },
    note: "Keep the slight Seattle edge for the Christine Michael pick return."
  },
  "MIN-2015-10-06-0254": {
    lane: "grade_verdict_review",
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "B-", "san-francisco-49ers": "C" },
    note: "Visible flip: Nick Easton plus pick value gives Minnesota the cleaner result."
  },
  "MIA-2016-0262": {
    lane: "grade_verdict_review",
    verdict: "Miami Dolphins Win",
    grades: { "philadelphia-eagles": "C", "miami-dolphins": "A-" },
    note: "Keep the Miami win because the Laremy Tunsil outcome drove the long-term edge."
  },
  "CHI-2016-0461": {
    lane: "grade_verdict_review",
    verdict: "New England Patriots Win",
    grades: { "chicago-bears": "D+", "new-england-patriots": "A" },
    note: "Visible flip: Martellus Bennett gave New England the clear realized edge."
  },
  "SEA-2016-04-29-0181": {
    lane: "grade_verdict_review",
    verdict: "Chicago Bears Win",
    grades: { "seattle-seahawks": "D", "chicago-bears": "A+" },
    note: "Keep the Chicago win based on Cody Whitehair/Deon Bush value."
  },
  "RAM-2016-0480": {
    lane: "grade_verdict_review",
    verdict: "Even Trade",
    grades: { "los-angeles-rams": "B-", "chicago-bears": "B-" },
    note: "Kwiatkoski vs Cooper/Thomas remains close enough for even."
  },

  // Structural lane: collapse duplicate perspectives and remove contaminated extra-team perspective where needed.
  "DEN-2014-05-10-0332": {
    lane: "structural_hold",
    verdict: "Chicago Bears Win",
    grades: { "denver-broncos": "D", "chicago-bears": "A+" },
    note: "Collapse four duplicate perspectives to two canonical team perspectives."
  },
  "DEN-2015-04-01-0333": {
    lane: "structural_hold",
    verdict: "Baltimore Ravens Win",
    grades: { "denver-broncos": "C-", "baltimore-ravens": "B" },
    note: "Collapse four duplicate perspectives to two canonical team perspectives."
  },
  "DEN-2015-04-30-0334": {
    lane: "structural_hold",
    verdict: "Detroit Lions Win",
    grades: { "denver-broncos": "D", "detroit-lions": "A+" },
    note: "Collapse four duplicate perspectives to two canonical team perspectives."
  },
  "CAR-2015-0054": {
    lane: "structural_hold",
    verdict: "Even Trade",
    grades: { "las-vegas-raiders": "B+", "carolina-panthers": "B+" },
    note: "Collapse three duplicate perspectives to two canonical team perspectives."
  },
  "RAI-2015-0359": {
    lane: "structural_hold",
    verdict: "Las Vegas Raiders Win",
    grades: { "las-vegas-raiders": "B+", "tampa-bay-buccaneers": "D+" },
    note: "Normalize Raiders naming and collapse duplicate perspective."
  },
  "DEN-2015-08-31-0335": {
    lane: "structural_hold",
    verdict: "Houston Texans Win",
    grades: { "denver-broncos": "C+", "houston-texans": "B" },
    note: "Collapse four duplicate perspectives to two canonical team perspectives."
  },
  "RAI-2015-0360": {
    lane: "structural_hold",
    verdict: "Even Trade",
    grades: { "indianapolis-colts": "C", "las-vegas-raiders": "C" },
    note: "Collapse duplicate Raiders/Colts perspectives."
  },
  "RAI-2015-0361": {
    lane: "structural_hold",
    verdict: "Las Vegas Raiders Win",
    grades: { "dallas-cowboys": "C-", "las-vegas-raiders": "B" },
    note: "Normalize Raiders naming and collapse duplicate perspective."
  },
  "DEN-2016-03-11-0336": {
    lane: "structural_hold",
    verdict: "Even Trade",
    grades: { "denver-broncos": "C", "philadelphia-eagles": "C" },
    note: "Collapse duplicate perspectives."
  },
  "DEN-2016-04-30-0338": {
    lane: "structural_hold",
    verdict: "Tennessee Titans Win",
    grades: { "denver-broncos": "D+", "tennessee-titans": "C" },
    note: "Normalize Titans naming and collapse duplicate perspectives."
  },
  "MIA-2016-0266": {
    lane: "structural_hold",
    verdict: "Minnesota Vikings Win",
    grades: { "miami-dolphins": "D", "minnesota-vikings": "A-" },
    teams: ["miami-dolphins", "minnesota-vikings"],
    note: "Remove contaminated Philadelphia perspective and keep the Miami/Minnesota Jakeem Grant pick trade."
  }
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function teamLabel(team) {
  return teamNames[team] || String(team || "Unknown Team")
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalizeVerdict(verdict) {
  return verdictAliases[verdict] || verdict;
}

function verdictWinner(verdict) {
  const normalized = normalizeVerdict(verdict);
  if (!normalized || normalized === "Even Trade") return null;
  return normalized.replace(/\s+Win$/, "");
}

function gradeLine(grades) {
  return Object.entries(grades).map(([team, grade]) => `${teamLabel(team)} ${grade}`).join(", ");
}

function sortedTeams(decision) {
  return decision.teams || Object.keys(decision.grades);
}

function findExistingPerspective(trade, team) {
  const ps = Array.isArray(trade.perspectives) ? trade.perspectives : [];
  return ps.find(p => p.primaryTeam === team)
    || ps.find(p => p.sourceTeam === team)
    || ps.find(p => p.primaryTeam && String(p.primaryTeam).includes(team))
    || null;
}

function makeRootCopy(decision) {
  const teams = sortedTeams(decision);
  const grades = gradeLine(decision.grades);
  const winner = verdictWinner(decision.verdict);

  if (!winner) {
    const names = teams.map(teamLabel).join(" and ");
    return {
      summary: `${names} land in even-trade territory. The final grade profile (${grades}) shows useful value on both sides without enough separation for a clear winner.`,
      partnerSummary: `From the other side, the exchange remains balanced. The asset return, roster logic, and hindsight value keep the verdict in the neutral range.`,
      analysis: `This final Batch 010 review treats the trade as a low-separation exchange. One side may have preferred the timing, player fit, or draft slot, but the long-term value did not break sharply in either direction. With the grade profile set at ${grades}, the reviewed TradeVerdicts outcome is Even Trade.`
    };
  }

  return {
    summary: `${winner} come out ahead in this trade. The final grade profile (${grades}) gives the winning side the cleaner realized value.`,
    partnerSummary: `For the other side, the football logic was understandable, but the final return did not match the winning side's outcome. The reviewed grade split keeps the edge with ${winner}.`,
    analysis: `This final Batch 010 review favors ${winner} because that side produced the stronger long-term value case. The losing side may have been chasing a roster need, cap adjustment, draft-board target, or short-term fit, but the final results favor the team that converted the exchange into more practical value. With the grade profile set at ${grades}, the reviewed TradeVerdicts outcome is ${winner} Win.`
  };
}

function makePerspective(trade, team, decision) {
  const teams = sortedTeams(decision);
  const others = teams.filter(t => t !== team);
  const partnerTeam = others[0] || team;
  const existing = findExistingPerspective(trade, team) || {};
  const winner = verdictWinner(decision.verdict);
  const teamName = teamLabel(team);
  const partnerName = teamLabel(partnerTeam);
  const primaryGrade = decision.grades[team];
  const partnerGrade = decision.grades[partnerTeam] || primaryGrade;
  const grades = gradeLine(decision.grades);

  let primarySummary;
  let partnerSummary;

  if (!winner) {
    primarySummary = `The ${teamName} side is graded ${primaryGrade}. The final review keeps this as an even trade because the value gap stayed narrow after accounting for the player and pick outcomes.`;
    partnerSummary = `The ${partnerName} side is graded ${partnerGrade}. The partner view also stays in the neutral range, matching the final Even Trade verdict.`;
  } else if (teamName === winner) {
    primarySummary = `The ${teamName} side is graded ${primaryGrade}. The final review gives this side the win because it produced the cleaner realized value from the exchange.`;
    partnerSummary = `The ${partnerName} side is graded ${partnerGrade}. The partner side had a defensible idea but did not match the winning side's final value.`;
  } else {
    primarySummary = `The ${teamName} side is graded ${primaryGrade}. The final review leaves this side behind ${winner} because the realized return did not match the winning side's value.`;
    partnerSummary = `The ${partnerName} side is graded ${partnerGrade}. The partner side controls the final edge in a reviewed ${winner} win.`;
  }

  const out = {
    ...existing,
    sourceTeam: existing.sourceTeam || team,
    primaryTeam: team,
    partnerTeam,
    primarySummary,
    partnerSummary,
    primaryGrade,
    partnerGrade,
    verdict: normalizeVerdict(decision.verdict),
    publishStatus: "ready"
  };

  const qaNote = `Bottom Batch 010 final patch v1: ${decision.note} Canonical grades: ${grades}.`;
  if (Array.isArray(out.qaNotes)) {
    out.qaNotes = [...out.qaNotes, qaNote];
  } else if (out.qaNotes) {
    out.qaNotes = [String(out.qaNotes), qaNote];
  } else {
    out.qaNotes = [qaNote];
  }

  return out;
}

function normalizeTrade(trade, decision) {
  const before = JSON.parse(JSON.stringify(trade));
  const rootCopy = makeRootCopy(decision);
  const teams = sortedTeams(decision);

  trade.verdict = normalizeVerdict(decision.verdict);
  trade.grades = { ...decision.grades };
  trade.teams = teams.slice();
  trade.sourceTeams = teams.slice();

  if (trade.assetsReceived && typeof trade.assetsReceived === "object" && !Array.isArray(trade.assetsReceived)) {
    const nextAssets = {};
    for (const team of teams) {
      if (Object.prototype.hasOwnProperty.call(trade.assetsReceived, team)) {
        nextAssets[team] = trade.assetsReceived[team];
      }
    }
    if (Object.keys(nextAssets).length) trade.assetsReceived = nextAssets;
  }

  trade.summary = rootCopy.summary;
  trade.partnerSummary = rootCopy.partnerSummary;
  trade.analysis = rootCopy.analysis;

  trade.perspectives = teams.map(team => makePerspective(before, team, decision));

  const qaNote = `Bottom Batch 010 final reviewed patch v1 (${decision.lane}): ${decision.note}`;
  if (Array.isArray(trade.qaNotes)) {
    trade.qaNotes = [...trade.qaNotes, qaNote];
  } else if (trade.qaNotes) {
    trade.qaNotes = [String(trade.qaNotes), qaNote];
  } else {
    trade.qaNotes = [qaNote];
  }

  return before;
}

function diffSummary(before, after) {
  const changes = [];
  for (const field of ["teams", "sourceTeams", "verdict", "grades", "summary", "partnerSummary", "analysis", "perspectives", "assetsReceived"]) {
    const b = JSON.stringify(before[field] ?? null);
    const a = JSON.stringify(after[field] ?? null);
    if (b !== a) {
      changes.push({
        field,
        before: field === "perspectives" ? `${Array.isArray(before[field]) ? before[field].length : 0} perspectives` : before[field],
        after: field === "perspectives" ? `${Array.isArray(after[field]) ? after[field].length : 0} perspectives` : after[field]
      });
    }
  }
  return changes;
}

if (!fs.existsSync(dataPath)) {
  console.error(`Missing data file: ${dataPath}`);
  process.exit(1);
}

fs.mkdirSync(reportDir, { recursive: true });

const data = readJson(dataPath);
const trades = Array.isArray(data) ? data : (data.trades || []);
const byId = new Map(trades.map((trade, index) => [trade.id, { trade, index }]));

const records = [];
let blocked = 0;
let changedRecords = 0;
let totalFieldChanges = 0;
const laneCounts = {};
const structuralCollapses = [];
const visibleFlips = [];
const missingIds = [];

for (const [id, decision] of Object.entries(finalDecisions)) {
  laneCounts[decision.lane] = (laneCounts[decision.lane] || 0) + 1;

  const found = byId.get(id);
  if (!found) {
    blocked++;
    missingIds.push(id);
    records.push({ id, lane: decision.lane, status: "blocked", blockers: ["missing trade id"], changes: [] });
    continue;
  }

  const { trade, index } = found;
  const oldVerdict = normalizeVerdict(trade.verdict);
  const oldGrades = JSON.stringify(trade.grades || {});
  const oldPerspectiveCount = Array.isArray(trade.perspectives) ? trade.perspectives.length : 0;

  const before = normalizeTrade(trade, decision);
  const changes = diffSummary(before, trade);

  if (oldVerdict !== normalizeVerdict(decision.verdict) || oldGrades !== JSON.stringify(decision.grades)) {
    visibleFlips.push({
      id,
      before: { verdict: oldVerdict, grades: before.grades },
      after: { verdict: normalizeVerdict(decision.verdict), grades: decision.grades }
    });
  }

  if (oldPerspectiveCount !== trade.perspectives.length) {
    structuralCollapses.push({ id, before: oldPerspectiveCount, after: trade.perspectives.length });
  }

  if (changes.length) {
    changedRecords++;
    totalFieldChanges += changes.length;
  }

  records.push({
    id,
    index,
    lane: decision.lane,
    status: applyMode ? "applied" : "would_apply",
    note: decision.note,
    changes
  });
}

let backupPath = null;

if (applyMode && blocked === 0) {
  backupPath = path.join(path.dirname(dataPath), `trades.backup-before-bottom-batch-${batchLabel}-final-patch-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.copyFileSync(dataPath, backupPath);
  writeJson(dataPath, Array.isArray(data) ? trades : { ...data, trades });
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  batch: `nfl-bottom-batch-${batchLabel}`,
  targetedRecords: Object.keys(finalDecisions).length,
  blockedRecords: blocked,
  changedRecords,
  totalFieldChanges,
  laneCounts,
  visibleFlips,
  structuralCollapses,
  missingIds,
  backupPath,
  records
};

writeJson(outJson, report);

let txt = `# NFL Bottom Batch ${batchLabel} Final Patch ${applyMode ? "Apply" : "Dry Run"} v1\n\n`;
txt += `Generated: ${report.generatedAt}\n`;
txt += `Mode: ${report.mode}\n\n`;
txt += `## Summary\n`;
txt += `- Targeted records: ${report.targetedRecords}\n`;
txt += `- Blocked records: ${report.blockedRecords}\n`;
txt += `- Changed records: ${report.changedRecords}\n`;
txt += `- Total changed field groups: ${report.totalFieldChanges}\n`;
txt += `- Backup created: ${backupPath || "no, dry-run only"}\n\n`;
txt += `## Lane Counts\n`;
for (const [lane, count] of Object.entries(laneCounts)) txt += `- ${lane}: ${count}\n`;
txt += `\n## Visible Top-Level Grade/Verdict Flips\n`;
if (!visibleFlips.length) txt += `- None\n`;
for (const flip of visibleFlips) {
  txt += `- ${flip.id}: ${flip.before.verdict} ${JSON.stringify(flip.before.grades)} -> ${flip.after.verdict} ${JSON.stringify(flip.after.grades)}\n`;
}
txt += `\n## Structural Perspective Collapses\n`;
if (!structuralCollapses.length) txt += `- None\n`;
for (const s of structuralCollapses) txt += `- ${s.id}: ${s.before} perspectives -> ${s.after} perspectives\n`;

txt += `\n## Records\n`;
for (const r of records) {
  txt += `\n### ${r.id}\n`;
  txt += `- Lane: ${r.lane}\n`;
  txt += `- Status: ${r.status}\n`;
  txt += `- Note: ${r.note || ""}\n`;
  txt += `- Changes: ${r.changes.length}\n`;
  for (const c of r.changes) {
    txt += `  - ${c.field}: ${typeof c.before === "string" ? c.before : JSON.stringify(c.before)} -> ${typeof c.after === "string" ? c.after : JSON.stringify(c.after)}\n`;
  }
}

fs.writeFileSync(outTxt, txt);

console.log("");
console.log(`NFL Bottom Batch ${batchLabel} final patch ${applyMode ? "APPLY" : "DRY RUN"} v1 complete.`);
console.log("");
console.log(`Targeted records: ${report.targetedRecords}`);
console.log(`Blocked records: ${report.blockedRecords}`);
console.log(`Changed records: ${report.changedRecords}`);
console.log(`Total changed field groups: ${report.totalFieldChanges}`);
console.log("");
console.log("Lane counts:");
for (const [lane, count] of Object.entries(laneCounts)) console.log(`- ${lane}: ${count}`);
console.log("");
console.log(`Visible top-level flips: ${visibleFlips.length}`);
console.log(`Structural perspective collapses: ${structuralCollapses.length}`);
console.log("");
console.log(`Open: ${path.relative(repoRoot, outTxt)}`);
if (backupPath) console.log(`Backup: ${path.relative(repoRoot, backupPath)}`);

if (blocked > 0) {
  console.error("");
  console.error("Blocked records detected. Do not apply until resolved.");
  process.exit(1);
}
