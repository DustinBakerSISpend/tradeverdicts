import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");
fs.mkdirSync(REPORT_DIR, { recursive: true });

const args = process.argv.slice(2);
const batchNumber = Number(args.find(a => /^\d+$/.test(a)) || 1);
const applyMode = args.includes("--apply");
const batchLabel = String(batchNumber).padStart(3, "0");

const OUT_JSON = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-grade-verdict-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-grade-verdict-${applyMode ? "apply" : "dry-run"}-v1.txt`);

const specialTeams = {
  "arizona-cardinals": "Arizona Cardinals",
  "arizona-st-louis-cardinals": "Arizona/St. Louis Cardinals",
  "baltimore-indianapolis-colts": "Baltimore/Indianapolis Colts",
  "boston-yanks": "Boston Yanks",
  "brooklyn-dodgers": "Brooklyn Dodgers",
  "brooklyn-rockets": "Brooklyn Rockets",
  "buffalo-bills": "Buffalo Bills",
  "chicago-bears": "Chicago Bears",
  "cleveland-browns": "Cleveland Browns",
  "detroit-lions": "Detroit Lions",
  "green-bay-packers": "Green Bay Packers",
  "indianapolis-colts": "Baltimore/Indianapolis Colts",
  "los-angeles-rams": "Los Angeles Rams",
  "los-angeles-st-louis-rams": "Los Angeles/St. Louis Rams",
  "new-york-giants": "New York Giants",
  "pittsburgh-steelers": "Pittsburgh Steelers",
  "rock-island-independents": "Rock Island Independents"
};

const decisions = {
  "ARI-1926-0002": { mode: "winner", verdict: "Arizona Cardinals Win", winnerKey: "arizona-cardinals", loserKey: "rock-island-independents", gradeAction: "preserve" },
  "ARI-1928-0004": { mode: "winner", verdict: "Arizona Cardinals Win", winnerKey: "arizona-cardinals", loserKey: "green-bay-packers", gradeAction: "preserve" },
  "PIT-1936-0003": { mode: "winner", verdict: "Pittsburgh Steelers Win", winnerKey: "pittsburgh-steelers", loserKey: "arizona-cardinals", gradeAction: "preserve" },
  "PIT-1938-0004": { mode: "winner", verdict: "Pittsburgh Steelers Win", winnerKey: "pittsburgh-steelers", loserKey: "green-bay-packers", gradeAction: "preserve" },
  "PIT-1940-0016": { mode: "winner", verdict: "Pittsburgh Steelers Win", winnerKey: "pittsburgh-steelers", loserKey: "green-bay-packers", gradeAction: "preserve" },
  "NYG-1943-0006": { mode: "winner", verdict: "Arizona/St. Louis Cardinals Win", winnerKey: "arizona-cardinals", loserKey: "new-york-giants", gradeAction: "preserve" },
  "ARI-1943-0013": { mode: "winner", verdict: "Arizona Cardinals Win", winnerKey: "arizona-cardinals", loserKey: "brooklyn-dodgers", gradeAction: "preserve" },
  "DET-1945-0011": { mode: "winner", verdict: "Detroit Lions Win", winnerKey: "detroit-lions", loserKey: "chicago-bears", gradeAction: "preserve" },
  "CHI-1946-0031": {
    mode: "winner",
    verdict: "Chicago Bears Win",
    winnerKey: "chicago-bears",
    loserKey: "green-bay-packers",
    gradeAction: "update",
    grades: { "chicago-bears": "B", "green-bay-packers": "C" },
    customCopy: {
      summary: "Chicago acquired Tom Farris / Tommy Farris from Green Bay Packers for undisclosed compensation. Chicago received the clearer recorded football value, matching the Chicago Bears Win verdict.",
      partnerSummary: "Green Bay Packers received undisclosed compensation and gave up Tom Farris / Tommy Farris. The overall return favors Chicago over Green Bay.",
      analysis: "Chicago earns the higher grade because Farris supplied the clearer known football value in an otherwise modest transaction."
    }
  },
  "RAM-1947-0012": { mode: "even", verdict: "Even Trade", gradeAction: "preserve" },
  "CLE-1947-0001": { mode: "winner", verdict: "Cleveland Browns Win", winnerKey: "cleveland-browns", loserKey: "brooklyn-rockets", gradeAction: "preserve" },
  "CLE-1947-0002": { mode: "winner", verdict: "Cleveland Browns Win", winnerKey: "cleveland-browns", loserKey: "buffalo-bills", gradeAction: "preserve" },
  "PIT-1947-0022": {
    mode: "winner",
    verdict: "Chicago Bears Win",
    winnerKey: "chicago-bears",
    loserKey: "pittsburgh-steelers",
    gradeAction: "update",
    grades: { "pittsburgh-steelers": "D", "chicago-bears": "A" },
    customCopy: {
      summary: "Pittsburgh traded Bobby Layne's draft rights to Chicago for rights to Ray Evans. Layne became a Hall of Fame quarterback, while Evans never delivered comparable NFL value, making Chicago the clear winner.",
      partnerSummary: "Chicago Bears received Bobby Layne's draft rights and gave up rights to Ray Evans. The Bears' return carries overwhelming long-term football value.",
      analysis: "Chicago's side aged into a major win because Layne became a Hall of Fame quarterback and Pittsburgh surrendered a future star for minimal return."
    }
  },
  "CLE-1948-0003": { mode: "winner", verdict: "Cleveland Browns Win", winnerKey: "cleveland-browns", loserKey: "indianapolis-colts", gradeAction: "preserve" },
  "CLE-1948-0005": { mode: "winner", verdict: "Cleveland Browns Win", winnerKey: "cleveland-browns", loserKey: "brooklyn-dodgers", gradeAction: "preserve" },
  "DET-1948-0016": {
    mode: "winner",
    verdict: "Arizona Cardinals Win",
    winnerKey: "arizona-cardinals",
    loserKey: "detroit-lions",
    gradeAction: "update",
    grades: { "arizona-cardinals": "B", "detroit-lions": "C-" },
    customCopy: {
      summary: "Detroit acquired undisclosed consideration from Arizona/St. Louis Cardinals for 1949 seventh round pick (#62-Myrl Greathouse). Arizona held the clearer recorded value through the draft return, matching the Arizona Cardinals Win verdict.",
      partnerSummary: "Arizona/St. Louis Cardinals received the 1949 seventh round pick (#62-Myrl Greathouse) and gave up undisclosed consideration. The overall return favors Arizona over Detroit.",
      analysis: "Arizona earns the stronger grade because the recorded pick return is clearer and more valuable than Detroit's undisclosed side of the exchange."
    }
  }
};

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 260) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "â€¦" : s;
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
  let cur = obj;
  for (const part of pathText.split(".")) {
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

function titleTeam(key) {
  if (specialTeams[key]) return specialTeams[key];
  return safe(key).split("-").filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function cleanAsset(asset) {
  const s = safe(asset).trim();
  if (!s || /^UNDISCLOSED$/i.test(s) || /^\?$/.test(s) || /not disclosed/i.test(s)) return "undisclosed consideration";
  if (/No asset listed in raw source/i.test(s)) return "an unclear return";
  return s.replace(/\s+/g, " ").trim();
}

function assetListForTeam(trade, teamKey) {
  const assets = trade.assetsReceived?.[teamKey];
  if (!Array.isArray(assets) || !assets.length) return "undisclosed consideration";
  const list = assets.map(a => cleanAsset(a?.asset || a?.name || a?.value || "")).filter(Boolean);
  return list.length ? list.join("; ") : "undisclosed consideration";
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

function normalizeTeamValue(v) {
  return safe(v).toLowerCase().replace(/\/+/g, "-").replace(/\./g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function resolveTeamKey(value, grades) {
  const direct = safe(value);
  if (direct && Object.prototype.hasOwnProperty.call(grades, direct)) return direct;
  const normalized = normalizeTeamValue(value);
  if (!normalized) return "";
  for (const key of Object.keys(grades || {})) {
    if (normalizeTeamValue(key) === normalized) return key;
    if (normalizeTeamValue(titleTeam(key)) === normalized) return key;
  }
  return "";
}

function getPrimaryTeamKey(p, grades) {
  return resolveTeamKey(p?.primaryTeamKey || p?.primaryTeam || p?.teamKey || p?.team || "", grades);
}

function getPartnerTeamKey(p, grades) {
  return resolveTeamKey(p?.partnerTeamKey || p?.partnerTeam || p?.opponentTeam || p?.partner || "", grades);
}

function addChange(changes, pathText, before, after, type = "field") {
  if (safe(before) === safe(after)) return;
  changes.push({ type, path: pathText, before: safe(before), after: safe(after), beforeHits: bannedHits(before), afterHits: bannedHits(after) });
}

function makeCanonicalCopy(trade, decision, finalGrades) {
  if (decision.customCopy) return decision.customCopy;
  const gradeKeys = Object.keys(finalGrades || {});
  const assetKeys = Object.keys(trade.assetsReceived || {});
  const primaryKey = assetKeys[0] || gradeKeys[0] || "";
  const otherKey = assetKeys.find(k => k !== primaryKey) || gradeKeys.find(k => k !== primaryKey) || gradeKeys[1] || "";
  const primaryName = titleTeam(primaryKey);
  const otherName = titleTeam(otherKey);
  const primaryAssets = assetListForTeam(trade, primaryKey);
  const otherAssets = assetListForTeam(trade, otherKey);

  if (decision.mode === "even") {
    return {
      summary: `${primaryName} acquired ${primaryAssets} from ${otherName} for ${otherAssets}. The available record does not show enough separation to call a clear long-term winner.`,
      partnerSummary: `${otherName} received ${otherAssets} and gave up ${primaryAssets}. The return remains close enough to support the Even Trade verdict.`,
      analysis: "Both sides received limited or comparable recorded value. The Even Trade verdict is preserved because the known football return does not create a clear winner."
    };
  }

  const winnerName = titleTeam(decision.winnerKey);
  const loserName = titleTeam(decision.loserKey || gradeKeys.find(k => k !== decision.winnerKey) || "");
  return {
    summary: `${primaryName} acquired ${primaryAssets} from ${otherName} for ${otherAssets}. ${winnerName} received the stronger long-term football value, matching the ${decision.verdict} verdict.`,
    partnerSummary: `${otherName} received ${otherAssets} and gave up ${primaryAssets}. The overall return favors ${winnerName} over ${loserName}.`,
    analysis: `The grade spread supports ${winnerName}: that side earned the higher mark because it produced the clearer recorded football value.`
  };
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const tradesData = readJson(DATA_PATH);
const trades = Array.isArray(tradesData) ? tradesData : tradesData.trades;
if (!Array.isArray(trades)) throw new Error("Could not find NFL trades array.");

const indexById = new Map();
trades.forEach((trade, index) => {
  const id = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  if (id) indexById.set(id, index);
});

const planRecords = [];
let blockedRecords = 0;
let plannedFieldChanges = 0;
let applicableFieldChanges = 0;
let skippedFieldChanges = 0;

for (const [id, decision] of Object.entries(decisions)) {
  const index = indexById.get(id);
  const trade = trades[index];
  const record = {
    id,
    index,
    recordNumber: typeof index === "number" ? index + 1 : null,
    slug: trade ? safe(getFirst(trade, ["slug", "urlSlug"])) : "",
    status: "ready",
    blockers: [],
    changes: []
  };

  if (!trade) {
    record.status = "blocked";
    record.blockers.push("Trade ID not found.");
    blockedRecords++;
    planRecords.push(record);
    continue;
  }

  const finalGrades = decision.gradeAction === "update" ? { ...(trade.grades || {}), ...(decision.grades || {}) } : { ...(trade.grades || {}) };
  const canonicalCopy = makeCanonicalCopy(trade, decision, finalGrades);

  addChange(record.changes, "verdict", trade.verdict, decision.verdict, "verdict");

  if (decision.gradeAction === "update") {
    for (const [teamKey, grade] of Object.entries(decision.grades || {})) {
      addChange(record.changes, `grades.${teamKey}`, trade.grades?.[teamKey], grade, "grade");
    }
  }

  addChange(record.changes, "summary", trade.summary, canonicalCopy.summary, "copy");
  addChange(record.changes, "partnerSummary", trade.partnerSummary, canonicalCopy.partnerSummary, "copy");
  addChange(record.changes, "analysis", trade.analysis, canonicalCopy.analysis, "copy");

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((p, i) => {
      if (!p || typeof p !== "object") return;
      if (typeof p.primarySummary === "string") addChange(record.changes, `perspectives.${i}.primarySummary`, p.primarySummary, canonicalCopy.summary, "copy");
      if (typeof p.partnerSummary === "string") addChange(record.changes, `perspectives.${i}.partnerSummary`, p.partnerSummary, canonicalCopy.partnerSummary, "copy");
      if (typeof p.analysis === "string") addChange(record.changes, `perspectives.${i}.analysis`, p.analysis, canonicalCopy.analysis, "copy");
      if (typeof p.verdict === "string") addChange(record.changes, `perspectives.${i}.verdict`, p.verdict, decision.verdict, "perspectiveVerdict");

      const primaryKey = getPrimaryTeamKey(p, finalGrades);
      const partnerKey = getPartnerTeamKey(p, finalGrades);

      if (primaryKey && Object.prototype.hasOwnProperty.call(finalGrades, primaryKey) && typeof p.primaryGrade === "string") {
        addChange(record.changes, `perspectives.${i}.primaryGrade`, p.primaryGrade, finalGrades[primaryKey], "perspectiveGrade");
      }
      if (partnerKey && Object.prototype.hasOwnProperty.call(finalGrades, partnerKey) && typeof p.partnerGrade === "string") {
        addChange(record.changes, `perspectives.${i}.partnerGrade`, p.partnerGrade, finalGrades[partnerKey], "perspectiveGrade");
      }
    });
  }

  const badAfter = [];
  for (const change of record.changes) {
    plannedFieldChanges++;
    if (change.type === "copy") {
      const hits = bannedHits(change.after);
      if (hits.length) badAfter.push({ path: change.path, hits });
    }
  }

  if (badAfter.length) {
    record.status = "blocked";
    record.blockers.push(`After-copy still has banned hits: ${badAfter.map(x => `${x.path}=${x.hits.join("|")}`).join("; ")}`);
    blockedRecords++;
  } else {
    applicableFieldChanges += record.changes.length;
  }

  planRecords.push(record);
}

let backupPath = null;

if (applyMode && blockedRecords === 0) {
  backupPath = path.join(ROOT, "src", "data", "nfl", `trades.backup-before-batch-${batchLabel}-grade-verdict-v1-${timestampForFile()}.json`);
  fs.copyFileSync(DATA_PATH, backupPath);

  for (const record of planRecords) {
    const trade = trades[record.index];
    for (const change of record.changes) setPath(trade, change.path, change.after);
    record.status = "applied";
  }

  if (Array.isArray(tradesData)) fs.writeFileSync(DATA_PATH, JSON.stringify(trades, null, 2) + "\n");
  else {
    tradesData.trades = trades;
    fs.writeFileSync(DATA_PATH, JSON.stringify(tradesData, null, 2) + "\n");
  }
} else if (applyMode && blockedRecords > 0) {
  skippedFieldChanges = plannedFieldChanges;
}

if (!applyMode) {
  for (const record of planRecords) {
    if (record.status === "ready") record.status = "would_apply";
  }
}

const statusCounts = {};
for (const r of planRecords) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

const out = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  batchNumber,
  batchLabel,
  recordCount: planRecords.length,
  plannedFieldChanges,
  applicableFieldChanges,
  skippedFieldChanges,
  blockedRecords,
  statusCounts,
  backupPath,
  records: planRecords
};

fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));

function changeText(change) {
  return `  - ${change.path} [${change.type}]\n    before: ${compact(change.before)}\n    after: ${compact(change.after)}\n`;
}

function recordText(record) {
  const blockers = record.blockers.length ? record.blockers.map(b => `  - ${b}`).join("\n") : "  - None";
  const changes = record.changes.length ? record.changes.map(changeText).join("") : "  - None\n";
  return `## #${record.recordNumber} / index ${record.index}: ${record.id}\n\n- Slug: ${record.slug}\n- Status: ${record.status}\n\n### Blockers\n${blockers}\n\n### Changes\n${changes}\n`;
}

const txt = `# NFL Batch ${batchLabel} Grade/Verdict ${applyMode ? "Apply" : "Dry Run"} v1\n\nGenerated: ${out.generatedAt}\n\nMode: ${out.mode}\n\n## Summary\n\n- Records: ${out.recordCount}\n- Planned field changes: ${out.plannedFieldChanges}\n- Applicable field changes: ${out.applicableFieldChanges}\n- Skipped field changes: ${out.skippedFieldChanges}\n- Blocked records: ${out.blockedRecords}\n${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}\n\n## Status Counts\n\n${Object.entries(statusCounts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}\n\n## Records\n\n${planRecords.map(recordText).join("\n\n")}\n\n## Output Files\n\n- JSON: reports/quality/nfl-batch-${batchLabel}-grade-verdict-${applyMode ? "apply" : "dry-run"}-v1.json\n- TXT: reports/quality/nfl-batch-${batchLabel}-grade-verdict-${applyMode ? "apply" : "dry-run"}-v1.txt\n`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Batch ${batchLabel} grade/verdict ${applyMode ? "APPLY" : "DRY RUN"} v1 complete.`);
console.log("");
console.log(`Records: ${out.recordCount}`);
console.log(`Planned field changes: ${out.plannedFieldChanges}`);
console.log(`Applicable field changes: ${out.applicableFieldChanges}`);
console.log(`Skipped field changes: ${out.skippedFieldChanges}`);
console.log(`Blocked records: ${out.blockedRecords}`);
console.log("");
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts).sort((a,b) => b[1] - a[1])) console.log(`- ${k}: ${v}`);
console.log("");
console.log("Open:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-grade-verdict-${applyMode ? "apply" : "dry-run"}-v1.txt`);
if (backupPath) {
  console.log("");
  console.log("Backup:");
  console.log(path.relative(ROOT, backupPath));
}

