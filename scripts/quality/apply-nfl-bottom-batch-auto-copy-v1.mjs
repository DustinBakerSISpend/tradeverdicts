import fs from "node:fs";
import path from "node:path";
import { readManifest, segmentRange, label, REPORT_DIR } from "./nfl-bottom-wrapper-lib.mjs";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const bottom = Number(arg("--bottom", args[0] || 1));
const applyMode = args.includes("--apply");
const batchLabel = label(bottom);
const manifest = readManifest(bottom);
const chunks = segmentRange(manifest.startIndex, manifest.count);

const outJson = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-auto-copy-${applyMode ? "apply" : "dry-run"}-v1.json`);
const outTxt = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-auto-copy-${applyMode ? "apply" : "dry-run"}-v1.txt`);

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 280) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "â€¦" : s;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function atomicWriteJson(targetPath, value) {
  const tempPath = targetPath + ".tmp-auto-copy";
  const content = JSON.stringify(value, null, 2) + "\n";

  fs.writeFileSync(tempPath, content, "utf8");

  let lastError = null;

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      fs.renameSync(tempPath, targetPath);
      return;
    } catch (error) {
      lastError = error;

      if (!["EPERM", "EBUSY", "EACCES", "UNKNOWN"].includes(error.code)) {
        throw error;
      }

      sleepSync(500);
    }
  }

  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch {}

  throw new Error(
    "Could not replace " +
    targetPath +
    " after 10 attempts. Last error: " +
    (lastError?.message || "unknown")
  );
}

function getData() {
  const data = readJson(DATA_PATH);
  const trades = Array.isArray(data) ? data : data.trades;
  if (!Array.isArray(trades)) throw new Error("Could not find trades array.");
  return { data, trades };
}

function getId(t) {
  return safe(t.id || t.tradeId || t.trade_id);
}

const specialTeams = {
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
  "washington-commanders": "Washington Commanders",
  "new-york-yanks": "New York Yanks"
};

function teamName(key) {
  const k = safe(key);
  if (specialTeams[k]) return specialTeams[k];
  return k
    .split("-")
    .filter(Boolean)
    .map(part => part.length <= 3 && /^[a-z]+$/.test(part) ? part.toUpperCase() : part.slice(0,1).toUpperCase() + part.slice(1))
    .join(" ");
}

function assetText(assetObj) {
  if (assetObj == null) return "";
  if (typeof assetObj === "string") return assetObj;
  return safe(assetObj.asset || assetObj.name || assetObj.value || assetObj.label || assetObj.player || assetObj.pick || assetObj);
}

function assetsFor(trade, teamKey) {
  const list = trade.assetsReceived?.[teamKey];
  if (!Array.isArray(list) || !list.length) return "undisclosed consideration";
  const parts = list.map(assetText).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts.join("; ") : "undisclosed consideration";
}

const gradeScore = {
  "A+": 13, "A": 12, "A-": 11,
  "B+": 10, "B": 9, "B-": 8,
  "C+": 7, "C": 6, "C-": 5,
  "D+": 4, "D": 3, "D-": 2,
  "F": 1
};

function scoreGrade(g) {
  return gradeScore[safe(g).toUpperCase()] || 0;
}

function topGradeTeam(trade) {
  const entries = Object.entries(trade.grades || {});
  if (!entries.length) return null;
  return entries.sort((a, b) => scoreGrade(b[1]) - scoreGrade(a[1]))[0][0];
}

function verdictWinnerName(trade) {
  const v = safe(trade.verdict).trim();
  if (!v || /^even trade$/i.test(v)) return "";
  return v.replace(/\s+Win$/i, "").trim();
}

function isEven(trade) {
  return /^even trade$/i.test(safe(trade.verdict).trim());
}

function primaryPartnerKeys(trade) {
  const assetKeys = Object.keys(trade.assetsReceived || {});
  if (assetKeys.length >= 2) return assetKeys.slice(0, 2);
  const gradeKeys = Object.keys(trade.grades || {});
  if (gradeKeys.length >= 2) return gradeKeys.slice(0, 2);
  return assetKeys.concat(gradeKeys).slice(0, 2);
}

function copyForOrientation(trade, primaryKey, partnerKey) {
  const primaryName = teamName(primaryKey);
  const partnerName = teamName(partnerKey);
  const primaryAssets = assetsFor(trade, primaryKey);
  const partnerAssets = assetsFor(trade, partnerKey);

  if (isEven(trade)) {
    return {
      primarySummary: `${primaryName} acquired ${primaryAssets} from ${partnerName} for ${partnerAssets}. The available record does not show enough separation to call a clear long-term winner.`,
      partnerSummary: `${partnerName} received ${partnerAssets} and gave up ${primaryAssets}. The return remains close enough to support the Even Trade verdict.`,
      analysis: `This remains a low-separation transaction. The recorded value does not create enough distance to move either side above an Even Trade verdict.`
    };
  }

  const winnerName = verdictWinnerName(trade) || teamName(topGradeTeam(trade));
  const primaryWon = winnerName && primaryName.toLowerCase() === winnerName.toLowerCase();

  return {
    primarySummary: primaryWon
      ? `${primaryName} acquired ${primaryAssets} from ${partnerName} for ${partnerAssets}. ${primaryName} received the stronger recorded football value, matching the ${safe(trade.verdict)} verdict.`
      : `${primaryName} acquired ${primaryAssets} from ${partnerName} for ${partnerAssets}. The overall result favors ${winnerName} over ${primaryName}.`,
    partnerSummary: `${partnerName} received ${partnerAssets} and gave up ${primaryAssets}. The overall return favors ${winnerName}.`,
    analysis: `The grade spread supports ${winnerName}: that side earned the higher mark because it produced the clearer recorded football value.`
  };
}

function topLevelCopy(trade) {
  const keys = primaryPartnerKeys(trade);
  const a = keys[0];
  const b = keys[1];

  if (!a || !b) {
    return {
      summary: "",
      partnerSummary: "",
      analysis: "",
      blocker: "Could not resolve two team keys from assetsReceived or grades."
    };
  }

  const oriented = copyForOrientation(trade, a, b);
  return {
    summary: oriented.primarySummary,
    partnerSummary: oriented.partnerSummary,
    analysis: oriented.analysis
  };
}

function perspectiveTeamKey(p, side) {
  if (side === "primary") return safe(p.primaryTeamKey || p.primaryTeam);
  return safe(p.partnerTeamKey || p.partnerTeam);
}

function cleanPerspective(trade, p) {
  const primaryKey = perspectiveTeamKey(p, "primary");
  const partnerKey = perspectiveTeamKey(p, "partner");
  if (!primaryKey || !partnerKey) return { perspective: p, blocker: "Perspective missing primary/partner team key." };

  const oriented = copyForOrientation(trade, primaryKey, partnerKey);
  const next = { ...p };

  next.primarySummary = oriented.primarySummary;
  next.partnerSummary = oriented.partnerSummary;
  next.analysis = oriented.analysis;

  if (trade.grades?.[primaryKey]) next.primaryGrade = trade.grades[primaryKey];
  if (trade.grades?.[partnerKey]) next.partnerGrade = trade.grades[partnerKey];
  next.verdict = trade.verdict;

  // Preserve source and workflow metadata. This function is copy-only.
  // It may update public-facing summaries, grades, and verdict alignment,
  // but must not delete provenance or review-state fields.
  return { perspective: next, blocker: null };
}

function laneOf(r) {
  return safe(r.lane || r.repairLane || r.repair_lane || r.repair?.lane);
}

function recordId(r) {
  return safe(r.id || r.tradeId || r.trade_id);
}

function loadCopyCandidates() {
  const candidates = [];
  const sources = [];

  for (const c of chunks) {
    const p = path.join(REPORT_DIR, `nfl-batch-${c.batchLabel}-repair-preview-v1.json`);
    sources.push(p);
    if (!fs.existsSync(p)) continue;
    const j = readJson(p);
    for (const r of (Array.isArray(j.records) ? j.records : [])) {
      if (laneOf(r) === "copy_repair_candidate") {
        candidates.push({
          id: recordId(r),
          sourceOldBatchLabel: c.batchLabel,
          sourceChunkStartIndex: c.startIndex,
          sourceChunkEndIndex: c.endIndex,
          lane: laneOf(r),
          slug: r.slug || "",
          index: r.index
        });
      }
    }
  }

  return { candidates, sources };
}

const banned = [
  /status:\s*ready/i,
  /publishStatus/i,
  /qaNotes/i,
  /trade verdicts hindsight scale/i,
  /trade verdicts scale/i,
  /strict-hindsight value curve/i,
  /same strict-hindsight value curve/i,
  /same hindsight curve/i,
  /partner grade reflects/i,
  /partner even/i,
  /minor designation/i,
  /standard designation/i,
  /oppositeside/i,
  /opposite sideof/i,
  /enoughto/i,
  /receives the edge/i,
  /gets the verdict/i
];

function combinedPublicText(trade) {
  return [
    trade.summary,
    trade.partnerSummary,
    trade.analysis,
    ...(Array.isArray(trade.perspectives) ? trade.perspectives.flatMap(p => [
      p.primarySummary,
      p.partnerSummary,
      p.analysis,
      p.publishStatus,
      p.qaNotes
    ]) : [])
  ].map(safe).join("\n");
}

function bannedHits(trade) {
  const text = combinedPublicText(trade);
  return banned.filter(rx => rx.test(text)).map(rx => rx.source);
}

function changed(rec, pathName, before, after, type = "copy") {
  if (safe(before) === safe(after)) return;
  rec.changes.push({ path: pathName, type, before: compact(before), after: compact(after) });
}

const { data, trades } = getData();
const byId = new Map(trades.map((t, i) => [getId(t), { t, i }]));
const { candidates, sources } = loadCopyCandidates();

const records = [];
let blockedRecords = 0;

const manualReviewIds = new Set([
  "RAM-1978-0293",
  "SF-1978-0164",
  "RAI-1979-0157",
  "LAC-1979-0181",
  "WAS-1979-0257",
  "WAS-1979-0259",
  "WAS-1979-0261",
  "KC-1979-0122",
  "RAM-1979-0300",
  "TB-1980-0064",
  "RAI-1980-0164",
  "DAL-1979-0154",
  "NO-1978-0175",
  "NO-1979-0179",
  "RAM-1979-0297",
  "PIT-1979-0269",
  "PIT-1979-0270"
]);

for (const cand of candidates) {
  const found = byId.get(cand.id);

  if (manualReviewIds.has(cand.id)) {
    records.push({
      id: cand.id,
      index: cand.index,
      slug: cand.slug || "",
      sourceOldBatchLabel: cand.sourceOldBatchLabel || "",
      status: "blocked_manual_review",
      blockers: [
        "Unsafe for generic copy: franchise alias conflict, landmark prose, duplicated assets, malformed team, or voided transaction."
      ],
      changes: []
    });
    blockedRecords++;
    continue;
  }
  const rec = {
    id: cand.id,
    index: found?.i ?? null,
    slug: found?.t?.slug || cand.slug,
    sourceOldBatchLabel: cand.sourceOldBatchLabel,
    status: applyMode ? "applied" : "would_apply",
    blockers: [],
    changes: []
  };

  if (!found) {
    rec.status = "blocked";
    rec.blockers.push("Trade ID not found in current trades.json.");
    blockedRecords++;
    records.push(rec);
    continue;
  }

  const trade = found.t;
  const next = structuredClone(trade);
  const top = topLevelCopy(next);

  if (top.blocker) rec.blockers.push(top.blocker);

  if (!rec.blockers.length) {
    changed(rec, "summary", next.summary, top.summary);
    changed(rec, "partnerSummary", next.partnerSummary, top.partnerSummary);
    changed(rec, "analysis", next.analysis, top.analysis);

    next.summary = top.summary;
    next.partnerSummary = top.partnerSummary;
    next.analysis = top.analysis;

    if (Array.isArray(next.perspectives)) {
      const newPerspectives = [];
      for (let i = 0; i < next.perspectives.length; i++) {
        const result = cleanPerspective(next, next.perspectives[i]);
        if (result.blocker) rec.blockers.push(`perspectives[${i}]: ${result.blocker}`);
        newPerspectives.push(result.perspective);
      }

      changed(rec, "perspectives", `${next.perspectives.length} current perspectives`, `${newPerspectives.length} cleaned perspectives`, "perspectives");
      next.perspectives = newPerspectives;
    }

    const hits = bannedHits(next);
    if (hits.length) rec.blockers.push(`Banned public-language hits remain after patch: ${hits.join(", ")}`);
  }

  if (rec.blockers.length) {
    rec.status = "blocked";
    blockedRecords++;
    records.push(rec);
    continue;
  }

  if (applyMode) {
    trades[found.i] = next;
  }

  records.push(rec);
}

let backupPath = null;
const appliedRecords = records.filter(r => r.status === "applied").length;

if (applyMode && appliedRecords > 0) {
  backupPath = path.join(
    path.dirname(DATA_PATH),
    `trades.backup-before-bottom-batch-${batchLabel}-auto-copy-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );

  fs.copyFileSync(DATA_PATH, backupPath);

  if (Array.isArray(data)) {
    atomicWriteJson(DATA_PATH, trades);
  } else {
    data.trades = trades;
    atomicWriteJson(DATA_PATH, data);
  }
}

const statusCounts = {};
for (const r of records) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

const report = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  bottomBatchNumber: bottom,
  batchLabel,
  manifestRange: { startIndex: manifest.startIndex, endIndex: manifest.endIndex, count: manifest.count },
  sourceFiles: sources,
  candidatesFound: candidates.length,
  recordsTargeted: records.length,
  blockedRecords,
  backupPath,
  statusCounts,
  records
};

writeJson(outJson, report);

const txt = `# NFL Bottom Batch ${batchLabel} Auto Copy ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

Purpose:
- Patch copy_repair_candidate records only.
- Preserve grades and verdicts.
- Skip grade_verdict_review and structural_hold records.
- Regenerate top-level and perspective copy from visible assets, grades, and verdict.
- Preserve perspective provenance and workflow metadata.

Manifest:
- Original start index: ${manifest.startIndex}
- Original end index: ${manifest.endIndex}
- Manifest records: ${manifest.count}

## Summary
- Copy candidates found: ${candidates.length}
- Records targeted: ${records.length}
- Blocked records: ${blockedRecords}
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}

## Status Counts
${Object.entries(statusCounts).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Blocked Records
${records.filter(r => r.status.startsWith("blocked")).length ? records.filter(r => r.status.startsWith("blocked")).map(r => `- ${r.id}: ${r.blockers.join(" | ")}`).join("\n") : "- None"}

## Records
${records.map(r => `## ${r.id}
- Index: ${r.index}
- Slug: ${r.slug}
- Source old batch: ${r.sourceOldBatchLabel}
- Status: ${r.status}

### Blockers
${r.blockers.length ? r.blockers.map(b => `- ${b}`).join("\n") : "- None"}

### Changes
${r.changes.length ? r.changes.map(c => `- ${c.path} [${c.type}]\n  before: ${c.before}\n  after: ${c.after}`).join("\n") : "- None"}
`).join("\n\n")}

## Output Files
- JSON: reports/quality/nfl-bottom-batch-${batchLabel}-auto-copy-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-bottom-batch-${batchLabel}-auto-copy-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(outTxt, txt);

console.log("");
console.log(`NFL Bottom Batch ${batchLabel} auto copy ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Copy candidates found: ${candidates.length}`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blockedRecords}`);
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-${batchLabel}-auto-copy-${applyMode ? "apply" : "dry-run"}-v1.txt`);
