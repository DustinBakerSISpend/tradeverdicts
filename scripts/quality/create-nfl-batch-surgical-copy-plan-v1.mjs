import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const batchNumber = Number(process.argv[2] || 1);
const batchSize = Number(process.argv[3] || 100);
const startIndex = (batchNumber - 1) * batchSize;
const batchLabel = String(batchNumber).padStart(3, "0");

const REPAIR_PREVIEW = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-repair-preview-v1.json`);

const outJson = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-surgical-copy-plan-v1.json`);
const outTxt = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-surgical-copy-plan-v1.txt`);

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 700) {
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
    winnerKey: entries[0].team,
    winnerName: titleCaseTeam(entries[0].team),
    loserKey: entries[1].team,
    loserName: titleCaseTeam(entries[1].team),
    winnerGrade: entries[0].grade,
    loserGrade: entries[1].grade,
    spread: entries[0].rank - entries[1].rank,
    even: entries[0].rank === entries[1].rank
  };
}

function getPath(obj, pathText) {
  const parts = pathText.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function publicFieldPaths(trade) {
  const paths = [];

  for (const key of ["summary", "partnerSummary", "analysis"]) {
    if (typeof trade[key] === "string") paths.push(key);
  }

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((p, i) => {
      if (!p || typeof p !== "object") return;
      for (const key of ["primarySummary", "partnerSummary", "analysis"]) {
        if (typeof p[key] === "string") paths.push(`perspectives.${i}.${key}`);
      }
    });
  }

  return paths;
}

function bannedHits(text) {
  const s = safe(text);
  const hits = [];

  const patterns = [
    ["partner", /\bpartner\b/i],
    ["hindsight/value curve", /hindsight value curve|same hindsight curve|same value curve|value curve|rebalanced curve/i],
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

  for (const [name, re] of patterns) {
    if (re.test(s)) hits.push(name);
  }

  return hits;
}

function sentenceClean(text, trade) {
  const read = gradeRead(trade.grades || {});
  const winner = read?.winnerName || "the winning side";

  let s = safe(text);

  // Remove obvious backend/process sentences.
  s = s.replace(/\s*This is graded under the Trade Verdicts hindsight scale\./gi, "");
  s = s.replace(/\s*The (minor|major) designation reflects[^.]*\./gi, "");
  s = s.replace(/\s*Status\s*:\s*Ready\.?/gi, "");
  s = s.replace(/\s*Tier\s*:\s*[^.]*\.?/gi, "");
  s = s.replace(/\s*Confidence\s*:\s*[^.]*\.?/gi, "");
  s = s.replace(/\s*The earlier even grade was too conservative\./gi, "");

  // Replace public process/reassessment language.
  s = s.replace(/Reassessed for curve balance as a true low-margin exchange\./gi, "");
  s = s.replace(/Reassessed as a public,\s*viewable even trade because/gi, "The record supports the even verdict because");
  s = s.replace(/public,\s*viewable/gi, "recorded");

  // Remove direct partner/meta labels.
  s = s.replace(/Partner Partner (Win|Loss|Even) because\s*/gi, "");
  s = s.replace(/Partner (Win|Loss|Even) because\s*/gi, "");
  s = s.replace(/The partner grade reflects the same hindsight value curve from the opposite side of the transaction\.?/gi, "The return supports the visible grade.");
  s = s.replace(/The partner grade reflects the same strict-hindsight value curve from the opposite side of the transaction\.?/gi, "The return supports the visible grade.");
  s = s.replace(/The partner grade reflects the same value curve from the opposite side of the transaction\.?/gi, "The return supports the visible grade.");
  s = s.replace(/The partner grade reflects a balanced, minor, or unresolved exchange\.?/gi, "The return supports the even verdict.");
  s = s.replace(/The partner side landed the stronger realized value, so its grade is higher on the same hindsight curve\.?/gi, "That return produced the stronger realized value, so the visible grade is higher.");
  s = s.replace(/The partner receives the higher grade because its side of the transaction produced the clearer hindsight value or better asset conversion\.?/gi, `${winner} receives the higher grade because that side produced the clearer long-term football value.`);
  s = s.replace(/The partner still received value, but the rebalanced curve gives ([^.]+?) the edge because the return did not match ([^.]+?) realized benefit\.?/gi, "The return did not match the stronger side's realized football value.");
  s = s.replace(/The partner outcome remains neutral for the same reason ([^.]+?) does\.?/gi, "The return remains close enough to support the even verdict.");

  // Replace broad meta phrases.
  s = s.replace(/Hindsight favors the partner based on greater cumulative production and roster impact\.?/gi, `${winner} produced the stronger long-term football value.`);
  s = s.replace(/so this moves to a partner edge/gi, `so this supports ${winner}`);
  s = s.replace(/partner edge/gi, `${winner} edge`);
  s = s.replace(/partner grade/gi, "visible grade");
  s = s.replace(/partner outcome/gi, "return");
  s = s.replace(/partner side/gi, "that side");
  s = s.replace(/opposite side of the transaction/gi, "other side of the deal");
  s = s.replace(/same hindsight value curve|same value curve|hindsight value curve|rebalanced curve|value curve/gi, "long-term value");
  s = s.replace(/asset conversion/gi, "football value");
  s = s.replace(/No asset listed in raw source/gi, "an unclear return");

  // Grammar cleanup.
  s = s.replace(/([A-Z][A-Za-z ./'-]+) receives the edge because/gi, "$1 has the edge because");
  s = s.replace(/([A-Z][A-Za-z ./'-]+) keeps the edge because/gi, "$1 has the edge because");
  s = s.replace(/([A-Z][A-Za-z ./'-]+) gets the verdict based on/gi, "$1 has the stronger case based on");
  s = s.replace(/\bHal Eri\b/g, "Hal Erickson");
  s = s.replace(/;([A-Za-z0-9])/g, "; $1");
  s = s.replace(/([A-Za-z])uncertain\b/g, "$1 uncertain");

  // Remove duplicated whitespace and awkward punctuation.
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\s+\./g, ".");
  s = s.replace(/\. \./g, ".");
  s = s.replace(/,,/g, ",");
  s = s.replace(/\s+,/g, ",");

  return s;
}

const tradesData = readJson(DATA_PATH);
const trades = Array.isArray(tradesData) ? tradesData : tradesData.trades;
if (!Array.isArray(trades)) throw new Error("Could not find trades array.");

const repairPreview = readJson(REPAIR_PREVIEW);
const previewByIndex = new Map((repairPreview.records || []).map(r => [r.index, r]));

const records = [];

for (let index = startIndex; index < startIndex + batchSize && index < trades.length; index++) {
  const trade = trades[index];
  const preview = previewByIndex.get(index);

  if (!preview || preview.lane !== "copy_repair_candidate") {
    continue;
  }

  const id = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  const slug = safe(getFirst(trade, ["slug", "urlSlug"]));
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));

  const changedFields = [];
  const unchangedFlaggedFields = [];
  const riskFlags = [];

  for (const fieldPath of publicFieldPaths(trade)) {
    const before = safe(getPath(trade, fieldPath));
    const beforeHits = bannedHits(before);

    if (!beforeHits.length) continue;

    const after = sentenceClean(before, trade);
    const afterHits = bannedHits(after);

    if (before !== after) {
      const shrinkRatio = before.length ? after.length / before.length : 1;

      if (shrinkRatio < 0.45) {
        riskFlags.push({
          type: "large_text_reduction",
          path: fieldPath,
          beforeLength: before.length,
          afterLength: after.length,
          shrinkRatio
        });
      }

      if (afterHits.length) {
        riskFlags.push({
          type: "banned_language_remains_after_cleanup",
          path: fieldPath,
          remainingHits: afterHits
        });
      }

      changedFields.push({
        path: fieldPath,
        before,
        after,
        beforeHits,
        afterHits
      });
    } else {
      unchangedFlaggedFields.push({
        path: fieldPath,
        text: before,
        beforeHits
      });
    }
  }

  records.push({
    index,
    recordNumber: index + 1,
    id,
    slug,
    verdict,
    grades: trade.grades || {},
    perspectiveCount: Array.isArray(trade.perspectives) ? trade.perspectives.length : 0,
    changedFieldCount: changedFields.length,
    unchangedFlaggedFieldCount: unchangedFlaggedFields.length,
    riskFlagCount: riskFlags.length,
    status: riskFlags.length || unchangedFlaggedFields.length ? "review_before_apply" : "surgical_copy_patch_ready",
    changedFields,
    unchangedFlaggedFields,
    riskFlags
  });
}

const counts = {};
for (const r of records) counts[r.status] = (counts[r.status] || 0) + 1;

const out = {
  generatedAt: new Date().toISOString(),
  batchNumber,
  batchLabel,
  startIndex,
  endIndex: startIndex + batchSize - 1,
  rule: "READ-ONLY surgical copy plan. Does not patch data. Uses field-level cleanup rather than wholesale proposed copy replacement.",
  counts,
  recordCount: records.length,
  records
};

fs.writeFileSync(outJson, JSON.stringify(out, null, 2));

function recordText(r) {
  const changes = r.changedFields.length
    ? r.changedFields.slice(0, 12).map(f => `### ${f.path}
Before: ${compact(f.before, 900)}

After: ${compact(f.after, 900)}

Before hits: ${f.beforeHits.join(", ")}
After hits: ${f.afterHits.join(", ") || "none"}
`).join("\n")
    : "No proposed field changes.";

  const risks = r.riskFlags.length
    ? r.riskFlags.map(x => `- ${x.type} at ${x.path}${x.remainingHits ? `: ${x.remainingHits.join(", ")}` : ""}`).join("\n")
    : "- None";

  const unchanged = r.unchangedFlaggedFields.length
    ? r.unchangedFlaggedFields.map(x => `- ${x.path}: ${x.beforeHits.join(", ")}`).join("\n")
    : "- None";

  return `## #${r.recordNumber} / index ${r.index}: ${r.id}

- Slug: ${r.slug}
- Verdict: ${r.verdict}
- Grades: ${Object.entries(r.grades || {}).map(([k,v]) => `${k}=${v}`).join("; ")}
- Perspectives: ${r.perspectiveCount}
- Status: ${r.status}
- Changed fields: ${r.changedFieldCount}
- Unchanged flagged fields: ${r.unchangedFlaggedFieldCount}
- Risk flags: ${r.riskFlagCount}

## Risk Flags
${risks}

## Unchanged Flagged Fields
${unchanged}

## Proposed Surgical Field Changes
${changes}
`;
}

const txt = `# NFL Batch ${batchLabel} Surgical Copy Plan v1

Generated: ${out.generatedAt}

READ-ONLY. This does not patch data.

Important:
- This does NOT use the generic repair-preview copy wholesale.
- It only proposes surgical field-level cleanup.
- Structural holds and grade/verdict-review records are excluded.
- Anything with risk flags must be reviewed before apply.

Batch:
- Start index: ${out.startIndex}
- End index: ${out.endIndex}
- Copy-repair records inspected: ${out.recordCount}

## Status Counts

${Object.entries(counts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Records

${records.map(recordText).join("\n\n")}

## Output Files

- JSON: reports/quality/nfl-batch-${batchLabel}-surgical-copy-plan-v1.json
- TXT: reports/quality/nfl-batch-${batchLabel}-surgical-copy-plan-v1.txt
`;

fs.writeFileSync(outTxt, txt);

console.log("");
console.log(`NFL Batch ${batchLabel} surgical copy plan v1 complete.`);
console.log(`Copy-repair records inspected: ${records.length}`);
console.log("");
console.log("Status counts:");
for (const [k, v] of Object.entries(counts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${k}: ${v}`);
}
console.log("");
console.log("Open:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-surgical-copy-plan-v1.txt`);
