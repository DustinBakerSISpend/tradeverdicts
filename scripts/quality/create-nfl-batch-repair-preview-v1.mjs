import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const batchNumber = Number(process.argv[2] || 1);
const batchSize = Number(process.argv[3] || 100);
const startIndex = (batchNumber - 1) * batchSize;
const batchLabel = String(batchNumber).padStart(3, "0");

const V2_PATH = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-master-audit-v2.json`);
const V3_PATH = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-v3-calibration.json`);

const outJson = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-repair-preview-v1.json`);
const outTxt = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-repair-preview-v1.txt`);
const holdsTxt = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-structural-holds-v1.txt`);
const gradeReviewTxt = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-grade-verdict-review-v1.txt`);

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 520) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
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

function titleCaseTeam(key) {
  const special = {
    "chicago-bears": "Chicago Bears",
    "green-bay-packers": "Green Bay Packers",
    "arizona-cardinals": "Arizona Cardinals",
    "arizona-st-louis-cardinals": "Arizona/St. Louis Cardinals",
    "new-york-giants": "New York Giants",
    "detroit-lions": "Detroit Lions",
    "philadelphia-eagles": "Philadelphia Eagles",
    "pittsburgh-steelers": "Pittsburgh Steelers",
    "pittsburgh-pirates-steelers": "Pittsburgh Pirates/Steelers",
    "los-angeles-rams": "Los Angeles Rams",
    "los-angeles-st-louis-rams": "Los Angeles/St. Louis Rams",
    "brooklyn-dodgers": "Brooklyn Dodgers",
    "new-york-yankees": "New York Yankees",
    "racine-legion": "Racine Legion",
    "rock-island-independents": "Rock Island Independents",
    "milwaukee-badgers": "Milwaukee Badgers",
    "cincinnati-reds": "Cincinnati Reds",
    "boston-washington-braves": "Boston/Washington Braves",
    "pottsville-maroons": "Pottsville Maroons"
  };

  if (special[key]) return special[key];

  return safe(key)
    .split("-")
    .filter(Boolean)
    .map(w => {
      if (w === "st") return "St.";
      if (w === "ny") return "NY";
      if (w === "la") return "LA";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function cleanAsset(asset) {
  const s = safe(asset).trim();
  if (!s) return "undisclosed consideration";
  if (/^UNDISCLOSED$/i.test(s)) return "undisclosed consideration";
  if (/not disclosed/i.test(s)) return "undisclosed consideration";
  if (/No asset listed in raw source/i.test(s)) return "an unclear return";
  return s.replace(/\s+/g, " ").trim();
}

function assetListForTeam(trade, teamKey) {
  const assets = trade.assetsReceived?.[teamKey];
  if (!Array.isArray(assets) || !assets.length) return "undisclosed consideration";

  const list = assets
    .map(a => cleanAsset(a?.asset || a?.name || a?.value || ""))
    .filter(Boolean);

  return list.length ? list.join("; ") : "undisclosed consideration";
}

function gradeRank(g) {
  const x = safe(g).trim().toUpperCase();
  return {
    "A+": 13, "A": 12, "A-": 11,
    "B+": 10, "B": 9, "B-": 8,
    "C+": 7, "C": 6, "C-": 5,
    "D+": 4, "D": 3, "D-": 2,
    "F": 1
  }[x] ?? null;
}

function gradeRead(grades) {
  const entries = Object.entries(grades || {})
    .map(([team, grade]) => ({ team, grade, rank: gradeRank(grade) }))
    .filter(x => x.rank != null)
    .sort((a, b) => b.rank - a.rank);

  if (entries.length < 2) return null;

  return {
    topTeam: entries[0].team,
    topGrade: entries[0].grade,
    secondTeam: entries[1].team,
    secondGrade: entries[1].grade,
    spread: entries[0].rank - entries[1].rank,
    even: entries[0].rank === entries[1].rank
  };
}

function makeCanonicalCopy(trade) {
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));
  const grades = trade.grades || {};
  const teams = Object.keys(grades);

  const assetsTeams = Object.keys(trade.assetsReceived || {});
  const primaryTeam = assetsTeams[0] || teams[0] || "";
  const otherTeam = assetsTeams.find(t => t !== primaryTeam) || teams.find(t => t !== primaryTeam) || teams[1] || "";

  const primaryName = titleCaseTeam(primaryTeam);
  const otherName = titleCaseTeam(otherTeam);

  const primaryAssets = assetListForTeam(trade, primaryTeam);
  const otherAssets = assetListForTeam(trade, otherTeam);

  const read = gradeRead(grades);
  const evenVerdict = /even trade/i.test(verdict);

  let summary = `${primaryName} acquired ${primaryAssets} from ${otherName} for ${otherAssets}.`;
  let partnerSummary = `${otherName} received ${otherAssets} and gave up ${primaryAssets}.`;
  let analysis = "";

  if (evenVerdict || read?.even) {
    summary += ` The available record does not show enough separation to call a clear long-term winner.`;
    partnerSummary += ` The return remains close enough to support the even verdict.`;
    analysis = `Both sides received limited or comparable recorded value. The Even Trade verdict is preserved because the known football return does not create a clear winner.`;
  } else {
    const winnerKey = read?.topTeam || "";
    const winnerName = titleCaseTeam(winnerKey);
    const loserName = winnerKey === primaryTeam ? otherName : primaryName;

    summary += ` ${winnerName} received the stronger long-term football value, matching the ${verdict} verdict.`;
    partnerSummary += ` The overall return favors ${winnerName} over ${loserName}.`;
    analysis = `The grades favor ${winnerName} because that side produced the clearer long-term football value. The visible verdict remains ${verdict}.`;
  }

  return {
    summary,
    partnerSummary,
    analysis
  };
}

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;
if (!Array.isArray(trades)) throw new Error("Could not find NFL trades array.");

const v2 = fs.existsSync(V2_PATH) ? readJson(V2_PATH) : { records: [] };
const v3 = fs.existsSync(V3_PATH) ? readJson(V3_PATH) : { records: [] };

const v2ByIndex = new Map((v2.records || []).map(r => [r.index, r]));
const v3ByIndex = new Map((v3.records || []).map(r => [r.index, r]));

const records = [];

for (let index = startIndex; index < startIndex + batchSize && index < trades.length; index++) {
  const trade = trades[index];
  const v2r = v2ByIndex.get(index) || {};
  const v3r = v3ByIndex.get(index) || {};

  const id = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  const slug = safe(getFirst(trade, ["slug", "urlSlug"]));
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));

  let lane = "clean_after_v3";
  let action = "No repair proposed.";

  if (v2r.classification === "structural_hold") {
    lane = "structural_hold";
    action = "Do not patch from copy rules. Resolve team/assets/perspectives first.";
  } else if (v2r.classification === "grade_verdict_review") {
    lane = "grade_verdict_review";
    action = "Do not patch from copy rules until canonical grade/verdict decision is made.";
  } else if (
    v3r.v3Class === "must_patch_public_language" ||
    v3r.v3Class === "should_review_public_language" ||
    v2r.classification === "copy_patch_candidate"
  ) {
    lane = "copy_repair_candidate";
    action = "Eligible for copy-only repair preview. Preserve grades and verdict.";
  }

  const proposedCopy = lane === "copy_repair_candidate" ? makeCanonicalCopy(trade) : null;

  records.push({
    index,
    recordNumber: index + 1,
    id,
    slug,
    verdict,
    grades: trade.grades || {},
    perspectiveCount: Array.isArray(trade.perspectives) ? trade.perspectives.length : 0,
    v2Classification: v2r.classification || "",
    v3Class: v3r.v3Class || "",
    lane,
    action,
    currentCopy: {
      summary: compact(trade.summary || ""),
      partnerSummary: compact(trade.partnerSummary || ""),
      analysis: compact(trade.analysis || "")
    },
    proposedCopy,
    v2Issues: v2r.issueKeys || [],
    v3Hits: (v3r.hits || []).slice(0, 10)
  });
}

const counts = {};
for (const r of records) counts[r.lane] = (counts[r.lane] || 0) + 1;

const out = {
  generatedAt: new Date().toISOString(),
  batchNumber,
  batchLabel,
  startIndex,
  endIndex: startIndex + records.length - 1,
  count: records.length,
  counts,
  importantRule: "This is read-only. It previews copy repairs but does not patch trades.json.",
  records
};

fs.writeFileSync(outJson, JSON.stringify(out, null, 2));

function recordText(r) {
  const hits = r.v3Hits.length
    ? r.v3Hits.map(h => `  - ${h.severity || ""} ${h.key || ""} at ${h.path || ""}: ${compact(h.sample || "", 260)}`).join("\n")
    : "  - None";

  const proposed = r.proposedCopy
    ? `### Proposed Clean Public Copy
- summary: ${r.proposedCopy.summary}
- partnerSummary: ${r.proposedCopy.partnerSummary}
- analysis: ${r.proposedCopy.analysis}`
    : `### Proposed Clean Public Copy
- None. ${r.action}`;

  return `## #${r.recordNumber} / index ${r.index}: ${r.id}

- Slug: ${r.slug}
- Verdict: ${r.verdict}
- Grades: ${Object.entries(r.grades || {}).map(([k,v]) => `${k}=${v}`).join("; ") || "(missing)"}
- Perspectives: ${r.perspectiveCount}
- V2: ${r.v2Classification || "(missing)"}
- V3: ${r.v3Class || "(missing)"}
- Repair lane: ${r.lane}
- Action: ${r.action}

### Current Public Copy
- summary: ${r.currentCopy.summary}
- partnerSummary: ${r.currentCopy.partnerSummary}
- analysis: ${r.currentCopy.analysis}

${proposed}

### V3 Hits
${hits}
`;
}

const txt = `# NFL Batch ${batchLabel} Repair Preview v1

Generated: ${out.generatedAt}

READ-ONLY. This does not patch data.

Purpose:
- Separate structural holds from grade/verdict reviews.
- Create preview copy for high-confidence public-language cleanup.
- Preserve grades and verdicts unless the record is explicitly in grade_verdict_review.

Batch:
- Start index: ${out.startIndex}
- End index: ${out.endIndex}
- Records: ${out.count}

## Repair Lane Counts

${Object.entries(counts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n")}

## Records

${records.map(recordText).join("\n\n")}

## Output Files

- JSON: reports/quality/nfl-batch-${batchLabel}-repair-preview-v1.json
- TXT: reports/quality/nfl-batch-${batchLabel}-repair-preview-v1.txt
- Structural holds: reports/quality/nfl-batch-${batchLabel}-structural-holds-v1.txt
- Grade/verdict review: reports/quality/nfl-batch-${batchLabel}-grade-verdict-review-v1.txt
`;

fs.writeFileSync(outTxt, txt);

const holds = records.filter(r => r.lane === "structural_hold");
const gradeReviews = records.filter(r => r.lane === "grade_verdict_review");

fs.writeFileSync(
  holdsTxt,
  `# NFL Batch ${batchLabel} Structural Holds\n\n` +
  holds.map(r => `- #${r.recordNumber} index ${r.index}: ${r.id} — ${r.slug} — perspectives=${r.perspectiveCount} — issues=${r.v2Issues.join(", ")}`).join("\n") +
  "\n"
);

fs.writeFileSync(
  gradeReviewTxt,
  `# NFL Batch ${batchLabel} Grade/Verdict Reviews\n\n` +
  gradeReviews.map(r => `## #${r.recordNumber} index ${r.index}: ${r.id}
- Slug: ${r.slug}
- Verdict: ${r.verdict}
- Grades: ${Object.entries(r.grades || {}).map(([k,v]) => `${k}=${v}`).join("; ")}
- Current summary: ${r.currentCopy.summary}
- Current partnerSummary: ${r.currentCopy.partnerSummary}
- Current analysis: ${r.currentCopy.analysis}
- V2 issues: ${r.v2Issues.join(", ")}
`).join("\n\n") +
  "\n"
);

console.log("");
console.log(`NFL Batch ${batchLabel} repair preview v1 complete.`);
console.log(`Records: ${records.length}`);
console.log("");
console.log("Repair lanes:");
for (const [k, v] of Object.entries(counts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${k}: ${v}`);
}
console.log("");
console.log("Open:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-repair-preview-v1.txt`);
console.log("");
console.log("Also created:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-structural-holds-v1.txt`);
console.log(`reports\\quality\\nfl-batch-${batchLabel}-grade-verdict-review-v1.txt`);
