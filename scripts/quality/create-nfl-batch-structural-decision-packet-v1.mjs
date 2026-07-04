import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const batchNumber = Number(process.argv[2] || 1);
const batchSize = Number(process.argv[3] || 100);
const startIndex = (batchNumber - 1) * batchSize;
const batchLabel = String(batchNumber).padStart(3, "0");

const REPAIR_PREVIEW_PATH = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-repair-preview-v1.json`);
const OUT_JSON = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-structural-decision-packet-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-structural-decision-packet-v1.txt`);

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 900) {
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

function assetSummary(trade) {
  const assets = trade.assetsReceived || {};
  return Object.entries(assets).map(([team, list]) => {
    const vals = Array.isArray(list)
      ? list.map(a => safe(a.asset || a.name || a.value || a)).filter(Boolean).join("; ")
      : safe(list);
    return `${team}: ${vals || "(none)"}`;
  });
}

function gradeSummary(grades) {
  return Object.entries(grades || {}).map(([team, grade]) => `${team}=${grade}`).join("; ");
}

function perspectiveSignature(p) {
  const primarySummary = compact(p?.primarySummary || "", 220);
  const partnerSummary = compact(p?.partnerSummary || "", 220);
  return `${safe(p?.primaryTeamKey || p?.primaryTeam || p?.teamKey || "")}|${safe(p?.partnerTeamKey || p?.partnerTeam || p?.opponentTeam || "")}|${safe(p?.primaryGrade)}|${safe(p?.partnerGrade)}|${safe(p?.verdict)}|${primarySummary}|${partnerSummary}`;
}

function repeatedPerspectiveStats(perspectives) {
  const counts = new Map();
  for (const p of perspectives || []) {
    const sig = perspectiveSignature(p);
    counts.set(sig, (counts.get(sig) || 0) + 1);
  }
  const repeats = [...counts.entries()].filter(([, count]) => count > 1);
  return {
    uniqueCount: counts.size,
    repeatedGroups: repeats.length,
    maxRepeat: repeats.length ? Math.max(...repeats.map(([, count]) => count)) : 1
  };
}

function likelyWrongPerspective(p, topText) {
  const text = `${safe(p?.primarySummary)} ${safe(p?.partnerSummary)} ${safe(p?.analysis)}`;
  const top = safe(topText);
  const suspiciousNames = [
    "Johnny McNally",
    "Johnny Blood",
    "Edgar Manske",
    "Eggs Manske",
    "Bill Pollock",
    "Tuffy Thompson",
    "Frank Butler",
    "Dave Smukler",
    "Ray George",
    "Joe Wendlick",
    "Joe Wendlich"
  ];

  return suspiciousNames.filter(name => text.includes(name) && !top.includes(name));
}

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;
if (!Array.isArray(trades)) throw new Error("Could not find NFL trades array.");

const preview = readJson(REPAIR_PREVIEW_PATH);
const structuralIndexes = new Set(
  (preview.records || [])
    .filter(r => r.lane === "structural_hold")
    .map(r => r.index)
);

const records = [];

for (const index of structuralIndexes) {
  const trade = trades[index];
  if (!trade) continue;

  const id = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  const slug = safe(getFirst(trade, ["slug", "urlSlug"]));
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));
  const perspectives = Array.isArray(trade.perspectives) ? trade.perspectives : [];
  const topText = `${safe(trade.summary)} ${safe(trade.partnerSummary)} ${safe(trade.analysis)}`;

  const repeatStats = repeatedPerspectiveStats(perspectives);
  const wrongPerspectiveFlags = perspectives.map((p, i) => ({
    perspectiveIndex: i,
    suspiciousNames: likelyWrongPerspective(p, topText)
  })).filter(x => x.suspiciousNames.length);

  let suggestedAction = "manual_review";
  let reason = "Structural issue needs human decision.";

  if (/unknown-partner|unknown-team/i.test(slug) || Object.keys(trade.grades || {}).some(k => /unknown/i.test(k))) {
    suggestedAction = "suppress_or_hold_source_needed";
    reason = "Record contains unknown team/partner data and should not be patched from copy rules.";
  } else if (perspectives.length > 2 && wrongPerspectiveFlags.length) {
    suggestedAction = "remove_wrong_extra_perspectives_then_reaudit";
    reason = "Record has extra perspectives that appear to belong to other trades.";
  } else if (perspectives.length > 2) {
    suggestedAction = "dedupe_or_trim_extra_perspectives_then_reaudit";
    reason = "Record has more than two perspectives and needs perspective cleanup.";
  }

  records.push({
    index,
    recordNumber: index + 1,
    id,
    slug,
    verdict,
    grades: trade.grades || {},
    perspectiveCount: perspectives.length,
    repeatStats,
    wrongPerspectiveFlags,
    suggestedAction,
    reason,
    topCopy: {
      summary: compact(trade.summary || ""),
      partnerSummary: compact(trade.partnerSummary || ""),
      analysis: compact(trade.analysis || "")
    },
    assets: assetSummary(trade),
    perspectives: perspectives.map((p, i) => ({
      index: i,
      primaryTeamKey: safe(p.primaryTeamKey || p.primaryTeam || p.teamKey || ""),
      partnerTeamKey: safe(p.partnerTeamKey || p.partnerTeam || p.opponentTeam || ""),
      primaryGrade: safe(p.primaryGrade),
      partnerGrade: safe(p.partnerGrade),
      verdict: safe(p.verdict),
      primarySummary: compact(p.primarySummary || "", 450),
      partnerSummary: compact(p.partnerSummary || "", 450),
      analysis: compact(p.analysis || "", 450),
      suspiciousNames: likelyWrongPerspective(p, topText)
    }))
  });
}

const actionCounts = {};
for (const r of records) actionCounts[r.suggestedAction] = (actionCounts[r.suggestedAction] || 0) + 1;

const out = {
  generatedAt: new Date().toISOString(),
  batchNumber,
  batchLabel,
  startIndex,
  endIndex: startIndex + batchSize - 1,
  count: records.length,
  actionCounts,
  records
};

fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));

function recordText(r) {
  const wrongFlags = r.wrongPerspectiveFlags.length
    ? r.wrongPerspectiveFlags.map(x => `  - perspective ${x.perspectiveIndex}: ${x.suspiciousNames.join(", ")}`).join("\n")
    : "  - None";

  const assets = r.assets.length ? r.assets.map(x => `  - ${x}`).join("\n") : "  - None";

  const perspectives = r.perspectives.map(p => `### Perspective ${p.index}
- primaryTeamKey: ${p.primaryTeamKey || "(missing)"}
- partnerTeamKey: ${p.partnerTeamKey || "(missing)"}
- grades: ${p.primaryGrade || "?"}/${p.partnerGrade || "?"}
- verdict: ${p.verdict || "(missing)"}
- suspicious names: ${p.suspiciousNames.length ? p.suspiciousNames.join(", ") : "none"}
- primarySummary: ${p.primarySummary}
- partnerSummary: ${p.partnerSummary}
- analysis: ${p.analysis}
`).join("\n");

  return `## #${r.recordNumber} / index ${r.index}: ${r.id}

- Slug: ${r.slug}
- Verdict: ${r.verdict}
- Grades: ${gradeSummary(r.grades)}
- Perspectives: ${r.perspectiveCount}
- Unique perspective signatures: ${r.repeatStats.uniqueCount}
- Repeated groups: ${r.repeatStats.repeatedGroups}
- Max repeat: ${r.repeatStats.maxRepeat}

### Suggested Action
- ${r.suggestedAction}
- Reason: ${r.reason}

### Assets Received
${assets}

### Top-Level Copy
- summary: ${r.topCopy.summary}
- partnerSummary: ${r.topCopy.partnerSummary}
- analysis: ${r.topCopy.analysis}

### Suspicious Perspective Content
${wrongFlags}

### Perspectives
${perspectives}

### Final Decision
- finalState: TODO
- structuralAction: TODO
- patchAction: TODO
- notes: TODO
`;
}

const txt = `# NFL Batch ${batchLabel} Structural Decision Packet v1

Generated: ${out.generatedAt}

Purpose:
- Review the remaining structural holds after copy and grade/verdict cleanup.
- Do not patch automatically from this file.
- Decide whether each hold should be suppressed, source-needed, deduped, or perspective-trimmed.

Batch:
- Start index: ${out.startIndex}
- End index: ${out.endIndex}
- Structural hold records: ${out.count}

## Suggested Action Counts

${Object.entries(actionCounts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Records

${records.map(recordText).join("\n\n")}

## Output Files

- JSON: reports/quality/nfl-batch-${batchLabel}-structural-decision-packet-v1.json
- TXT: reports/quality/nfl-batch-${batchLabel}-structural-decision-packet-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Batch ${batchLabel} structural decision packet created.`);
console.log(`Records: ${records.length}`);
console.log("");
console.log("Suggested action counts:");
for (const [k, v] of Object.entries(actionCounts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${k}: ${v}`);
}
console.log("");
console.log("Open:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-structural-decision-packet-v1.txt`);
