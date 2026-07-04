import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");
fs.mkdirSync(REPORT_DIR, { recursive: true });

const args = process.argv.slice(2);
const applyMode = args.includes("--apply");
const batchLabel = "001";

const OUT_JSON = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-structural-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-structural-${applyMode ? "apply" : "dry-run"}-v1.txt`);
const QUARANTINE_JSON = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-structural-quarantined-records-v1.json`);

const decisions = {
  "CHI-1900-0008": {
    action: "quarantine_remove",
    reason: "Placeholder 1900 record with unknown partner/team and 131 duplicate perspectives."
  },
  "CHI-1938-0011": {
    action: "quarantine_remove",
    reason: "Unknown partner/team record. Hold for source; do not keep public."
  },
  "PIT-1934-0001": {
    action: "trim_patch",
    keepAssets: {
      "pittsburgh-steelers": ["Ben Smith (a)"],
      "green-bay-packers": ["cash"]
    },
    verdict: "Pittsburgh Steelers Win",
    grades: { "pittsburgh-steelers": "B-", "green-bay-packers": "C" },
    copy: {
      summary: "Pittsburgh acquired Ben Smith (a) from Green Bay Packers for cash. Pittsburgh received the stronger recorded football value, matching the Pittsburgh Steelers Win verdict.",
      partnerSummary: "Green Bay Packers received cash and gave up Ben Smith (a). The overall return favors Pittsburgh over Green Bay.",
      analysis: "Pittsburgh earns the higher grade because Ben Smith supplied the clearer recorded value in a modest cash-for-player transaction."
    }
  },
  "PHI-1937-0003": {
    action: "trim_patch",
    keepAssets: {
      "philadelphia-eagles": ["Ted Rosequist"],
      "chicago-bears": ["cash"]
    },
    verdict: "Philadelphia Eagles Win",
    grades: { "philadelphia-eagles": "B", "chicago-bears": "C" },
    copy: {
      summary: "Philadelphia acquired Ted Rosequist from Chicago Bears for cash. Philadelphia received the stronger recorded football value, matching the Philadelphia Eagles Win verdict.",
      partnerSummary: "Chicago Bears received cash and gave up Ted Rosequist. The overall return favors Philadelphia over Chicago.",
      analysis: "Philadelphia earns the higher grade because Rosequist provided the clearer recorded football value than the cash return."
    }
  },
  "PIT-1939-0011": {
    action: "trim_patch",
    keepAssets: {
      "pittsburgh-steelers": ["Bernie Scherer"],
      "green-bay-packers": ["cash"]
    },
    verdict: "Even Trade",
    grades: { "pittsburgh-steelers": "C", "green-bay-packers": "C" },
    copy: {
      summary: "Pittsburgh acquired Bernie Scherer from Green Bay Packers for cash. The available record does not show enough separation to call a clear long-term winner.",
      partnerSummary: "Green Bay Packers received cash and gave up Bernie Scherer. The return remains close enough to support the Even Trade verdict.",
      analysis: "This remains a low-separation cash-for-player transaction. The recorded value does not create enough distance to move either side above an Even Trade verdict."
    }
  },
  "PHI-1940-0006": {
    action: "trim_patch",
    keepAssets: {
      "philadelphia-eagles": ["Ray George", "Joe Wendlick"],
      "detroit-lions": ["Dave Smukler"]
    },
    verdict: "Philadelphia Eagles Win",
    grades: { "philadelphia-eagles": "B", "detroit-lions": "C+" },
    copy: {
      summary: "Philadelphia acquired Ray George; Joe Wendlick from Detroit Lions for Dave Smukler. Philadelphia received the stronger recorded football value, matching the Philadelphia Eagles Win verdict.",
      partnerSummary: "Detroit Lions received Dave Smukler and gave up Ray George; Joe Wendlick. The overall return favors Philadelphia over Detroit.",
      analysis: "Philadelphia earns the higher grade because the recorded return of Ray George and Joe Wendlick carries more durable value than Detroit's side of the exchange."
    }
  }
};

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function getFirst(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) return obj[key];
  }
  return "";
}

function compact(v, max = 240) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function teamName(key) {
  return {
    "pittsburgh-steelers": "Pittsburgh Steelers",
    "green-bay-packers": "Green Bay Packers",
    "philadelphia-eagles": "Philadelphia Eagles",
    "chicago-bears": "Chicago Bears",
    "detroit-lions": "Detroit Lions"
  }[key] || key;
}

function gradeRank(g) {
  return {
    "A+": 13, "A": 12, "A-": 11,
    "B+": 10, "B": 9, "B-": 8,
    "C+": 7, "C": 6, "C-": 5,
    "D+": 4, "D": 3, "D-": 2,
    "F": 1
  }[safe(g).toUpperCase()] || 0;
}

function assetText(a) {
  return safe(a?.asset || a?.name || a?.value || a).trim();
}

function keepAssetList(existing, keepNames) {
  const source = Array.isArray(existing) ? existing : [];
  return keepNames.map(wanted => {
    const found = source.find(a => assetText(a).toLowerCase() === wanted.toLowerCase());
    return found || { asset: wanted };
  });
}

function makePerspective(decision, primary, partner) {
  const primaryAssets = decision.keepAssets[primary].join("; ");
  const partnerAssets = decision.keepAssets[partner].join("; ");
  const primaryName = teamName(primary);
  const partnerName = teamName(partner);
  const isEven = decision.verdict === "Even Trade";
  const winnerKey = Object.entries(decision.grades).sort((a,b) => gradeRank(b[1]) - gradeRank(a[1]))[0][0];
  const winnerName = teamName(winnerKey);

  if (isEven) {
    return {
      primaryTeamKey: primary,
      partnerTeamKey: partner,
      primaryGrade: decision.grades[primary],
      partnerGrade: decision.grades[partner],
      verdict: decision.verdict,
      primarySummary: `${primaryName} acquired ${primaryAssets} from ${partnerName} for ${partnerAssets}. The available record does not show enough separation to call a clear long-term winner.`,
      partnerSummary: `${partnerName} received ${partnerAssets} and gave up ${primaryAssets}. The return remains close enough to support the Even Trade verdict.`,
      analysis: "This remains a low-separation transaction. The recorded value does not create enough distance to move either side above an Even Trade verdict."
    };
  }

  return {
    primaryTeamKey: primary,
    partnerTeamKey: partner,
    primaryGrade: decision.grades[primary],
    partnerGrade: decision.grades[partner],
    verdict: decision.verdict,
    primarySummary: primary === winnerKey
      ? `${primaryName} acquired ${primaryAssets} from ${partnerName} for ${partnerAssets}. ${primaryName} received the stronger recorded football value, matching the ${decision.verdict} verdict.`
      : `${primaryName} acquired ${primaryAssets} from ${partnerName} for ${partnerAssets}. The overall result favors ${winnerName} over ${primaryName}.`,
    partnerSummary: `${partnerName} received ${partnerAssets} and gave up ${primaryAssets}. The overall return favors ${winnerName}.`,
    analysis: `${winnerName} earns the higher grade because that side produced the clearer recorded football value.`
  };
}

function changed(pathName, before, after, type) {
  if (safe(before) === safe(after)) return null;
  return { path: pathName, type, before: compact(before), after: compact(after) };
}

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;
if (!Array.isArray(trades)) throw new Error("Could not find NFL trades array.");

const indexById = new Map();
trades.forEach((trade, index) => {
  const id = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  if (id) indexById.set(id, index);
});

const records = [];
const quarantined = [];
let blocked = 0;

for (const [id, decision] of Object.entries(decisions)) {
  const index = indexById.get(id);
  const trade = typeof index === "number" ? trades[index] : null;

  const rec = {
    id,
    index,
    slug: trade ? safe(getFirst(trade, ["slug", "urlSlug"])) : "",
    action: decision.action,
    status: "ready",
    reason: decision.reason || "",
    changes: [],
    blockers: []
  };

  if (!trade) {
    rec.status = "blocked";
    rec.blockers.push("Trade ID not found.");
    blocked++;
    records.push(rec);
    continue;
  }

  if (decision.action === "quarantine_remove") {
    rec.changes.push({
      path: "(record)",
      type: "quarantine_remove",
      before: "present in live data",
      after: "removed from live data and saved to quarantine report"
    });
    quarantined.push({ id, index, slug: rec.slug, reason: decision.reason, trade });
    records.push(rec);
    continue;
  }

  for (const [team, grade] of Object.entries(decision.grades)) {
    const c = changed(`grades.${team}`, trade.grades?.[team], grade, "grade");
    if (c) rec.changes.push(c);
    if (applyMode) {
      if (!trade.grades) trade.grades = {};
      trade.grades[team] = grade;
    }
  }

  const verdictChange = changed("verdict", trade.verdict, decision.verdict, "verdict");
  if (verdictChange) rec.changes.push(verdictChange);
  if (applyMode) trade.verdict = decision.verdict;

  for (const [team, keepNames] of Object.entries(decision.keepAssets)) {
    const before = JSON.stringify(trade.assetsReceived?.[team] || []);
    const afterList = keepAssetList(trade.assetsReceived?.[team], keepNames);
    const after = JSON.stringify(afterList);
    const c = changed(`assetsReceived.${team}`, before, after, "asset_trim");
    if (c) rec.changes.push(c);
    if (applyMode) {
      if (!trade.assetsReceived) trade.assetsReceived = {};
      trade.assetsReceived[team] = afterList;
    }
  }

  for (const field of ["summary", "partnerSummary", "analysis"]) {
    const c = changed(field, trade[field], decision.copy[field], "copy");
    if (c) rec.changes.push(c);
    if (applyMode) trade[field] = decision.copy[field];
  }

  const teams = Object.keys(decision.keepAssets);
  const newPerspectives = [
    makePerspective(decision, teams[0], teams[1]),
    makePerspective(decision, teams[1], teams[0])
  ];

  rec.changes.push({
    path: "perspectives",
    type: "perspective_replace",
    before: `${Array.isArray(trade.perspectives) ? trade.perspectives.length : 0} perspectives`,
    after: "2 cleaned perspectives"
  });

  if (applyMode) trade.perspectives = newPerspectives;

  records.push(rec);
}

let backupPath = null;
let quarantinePath = null;

if (applyMode && blocked === 0) {
  backupPath = path.join(ROOT, "src", "data", "nfl", `trades.backup-before-batch-001-structural-v1-${timestampForFile()}.json`);
  fs.copyFileSync(DATA_PATH, backupPath);

  if (quarantined.length) {
    quarantinePath = QUARANTINE_JSON;
    fs.writeFileSync(QUARANTINE_JSON, JSON.stringify({
      generatedAt: new Date().toISOString(),
      records: quarantined
    }, null, 2));
  }

  const removeIds = new Set(quarantined.map(r => r.id));
  const filtered = trades.filter(t => !removeIds.has(safe(getFirst(t, ["id", "tradeId", "trade_id"]))));

  if (Array.isArray(data)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(filtered, null, 2) + "\n");
  } else {
    data.trades = filtered;
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
  }

  for (const r of records) if (r.status === "ready") r.status = "applied";
} else {
  for (const r of records) if (r.status === "ready") r.status = "would_apply";
}

const statusCounts = {};
for (const r of records) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

const out = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  recordsTargeted: records.length,
  blockedRecords: blocked,
  quarantineRemovals: quarantined.length,
  statusCounts,
  backupPath,
  quarantinePath,
  records
};

fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));

function recordText(r) {
  return `## ${r.id}
- Index before patch: ${r.index}
- Slug: ${r.slug}
- Action: ${r.action}
- Status: ${r.status}
- Reason: ${r.reason || "(none)"}

### Blockers
${r.blockers.length ? r.blockers.map(b => `- ${b}`).join("\n") : "- None"}

### Changes
${r.changes.length ? r.changes.map(c => `- ${c.path} [${c.type}]\n  before: ${c.before}\n  after: ${c.after}`).join("\n") : "- None"}
`;
}

const txt = `# NFL Batch 001 Structural ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${out.generatedAt}
Mode: ${out.mode}

## Summary
- Records targeted: ${out.recordsTargeted}
- Blocked records: ${out.blockedRecords}
- Quarantine removals: ${out.quarantineRemovals}
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}
${quarantinePath ? `- Quarantine file: ${quarantinePath}` : "- Quarantine file: no, dry-run only"}

## Status Counts
${Object.entries(statusCounts).map(([k,v]) => `- ${k}: ${v}`).join("\n")}

## Records
${records.map(recordText).join("\n\n")}

## Output Files
- JSON: reports/quality/nfl-batch-001-structural-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-batch-001-structural-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Batch 001 structural ${applyMode ? "APPLY" : "DRY RUN"} v1 complete.`);
console.log("");
console.log(`Records targeted: ${out.recordsTargeted}`);
console.log(`Blocked records: ${out.blockedRecords}`);
console.log(`Quarantine removals: ${out.quarantineRemovals}`);
console.log("");
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log("Open:");
console.log(`reports\\quality\\nfl-batch-001-structural-${applyMode ? "apply" : "dry-run"}-v1.txt`);
