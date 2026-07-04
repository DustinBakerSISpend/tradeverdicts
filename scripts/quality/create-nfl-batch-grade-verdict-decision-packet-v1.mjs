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
const OUT_JSON = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-grade-verdict-decision-packet-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-grade-verdict-decision-packet-v1.txt`);

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

function titleTeam(key) {
  return safe(key)
    .split("-")
    .filter(Boolean)
    .map(w => {
      if (w === "st") return "St.";
      if (w === "los") return "Los";
      if (w === "new") return "New";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ")
    .replace("Arizona Cardinals", "Arizona Cardinals")
    .replace("St. Louis", "St. Louis");
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
    even: entries[0].rank === entries[1].rank,
    entries
  };
}

function publicText(trade) {
  const pieces = [];
  for (const key of ["summary", "partnerSummary", "analysis"]) {
    if (trade[key]) pieces.push(`${key}: ${safe(trade[key])}`);
  }
  return pieces.join("\n");
}

function recommendDecision(trade) {
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));
  const read = gradeRead(trade.grades || {});
  const text = publicText(trade);

  const rec = {
    decisionType: "manual_review",
    reason: "",
    suggestedVerdict: verdict,
    suggestedGradeAction: "preserve_current_grades_until_review",
    confidence: "medium"
  };

  if (!read) {
    rec.reason = "Missing or unreadable grade spread.";
    rec.confidence = "low";
    return rec;
  }

  if (/even trade/i.test(verdict) && !read.even && read.spread >= 2) {
    rec.decisionType = "likely_stale_even_verdict";
    rec.reason = `Visible grades favor ${read.topTeam} by ${read.spread} grade steps (${read.topGrade} vs ${read.secondGrade}), but verdict is Even Trade.`;
    rec.suggestedVerdict = `${titleTeam(read.topTeam)} Win`;
    rec.suggestedGradeAction = "preserve_grades_update_verdict_and_copy";
    rec.confidence = read.spread >= 3 ? "high" : "medium";
    return rec;
  }

  if (!/even trade/i.test(verdict) && read.even) {
    rec.decisionType = "likely_stale_winner_verdict";
    rec.reason = `Visible grades are equal (${read.topGrade}/${read.secondGrade}), but verdict names a winner.`;
    rec.suggestedVerdict = "Even Trade";
    rec.suggestedGradeAction = "preserve_grades_update_verdict_and_copy";
    rec.confidence = "high";
    return rec;
  }

  if (!/even trade/i.test(verdict) && /does not show enough|not strong enough|neutral|even verdict|comparable|balanced/i.test(text)) {
    rec.decisionType = "copy_conflicts_with_winner_verdict";
    rec.reason = "Verdict names a winner, but public copy says the record is balanced, neutral, or not strong enough to force a winner.";
    rec.suggestedVerdict = verdict;
    rec.suggestedGradeAction = "preserve_verdict_and_grades_rewrite_copy_to_match_winner";
    rec.confidence = "medium";
    return rec;
  }

  if (/even trade/i.test(verdict) && /stronger long-term|has the edge|higher grade|outproduced|clearer football value/i.test(text)) {
    rec.decisionType = "copy_conflicts_with_even_verdict";
    rec.reason = "Verdict is Even Trade, but public copy suggests a directional winner.";
    rec.suggestedVerdict = verdict;
    rec.suggestedGradeAction = "preserve_even_verdict_rewrite_copy_neutral_or_escalate_if_grades_disagree";
    rec.confidence = "medium";
    return rec;
  }

  rec.decisionType = "review_left_alone_possible";
  rec.reason = "Flagged by earlier audit, but no obvious grade/verdict action from this packet alone.";
  rec.suggestedGradeAction = "manual_review";
  rec.confidence = "low";
  return rec;
}

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;
if (!Array.isArray(trades)) throw new Error("Could not find trades array.");

const preview = readJson(REPAIR_PREVIEW);
const gradeIndexes = new Set(
  (preview.records || [])
    .filter(r => r.lane === "grade_verdict_review")
    .map(r => r.index)
);

const records = [];

for (const index of gradeIndexes) {
  const trade = trades[index];
  if (!trade) continue;

  const id = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  const slug = safe(getFirst(trade, ["slug", "urlSlug"]));
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));
  const read = gradeRead(trade.grades || {});
  const rec = recommendDecision(trade);

  records.push({
    index,
    recordNumber: index + 1,
    id,
    slug,
    verdict,
    grades: trade.grades || {},
    gradeRead: read,
    recommendation: rec,
    currentCopy: {
      summary: compact(trade.summary || ""),
      partnerSummary: compact(trade.partnerSummary || ""),
      analysis: compact(trade.analysis || "")
    },
    perspectives: Array.isArray(trade.perspectives)
      ? trade.perspectives.map((p, i) => ({
          index: i,
          primaryGrade: safe(p.primaryGrade),
          partnerGrade: safe(p.partnerGrade),
          verdict: safe(p.verdict),
          primarySummary: compact(p.primarySummary || "", 400),
          partnerSummary: compact(p.partnerSummary || "", 400)
        }))
      : []
  });
}

const decisionCounts = {};
for (const r of records) {
  const k = r.recommendation.decisionType;
  decisionCounts[k] = (decisionCounts[k] || 0) + 1;
}

const out = {
  generatedAt: new Date().toISOString(),
  batchNumber,
  batchLabel,
  startIndex,
  endIndex: startIndex + batchSize - 1,
  count: records.length,
  decisionCounts,
  records
};

fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));

function recordText(r) {
  const perspectives = r.perspectives.length
    ? r.perspectives.map(p => `  - perspective ${p.index}: grades ${p.primaryGrade || "?"}/${p.partnerGrade || "?"}; verdict="${p.verdict || ""}"`).join("\n")
    : "  - None";

  return `## #${r.recordNumber} / index ${r.index}: ${r.id}

- Slug: ${r.slug}
- Current verdict: ${r.verdict}
- Current grades: ${Object.entries(r.grades || {}).map(([k,v]) => `${k}=${v}`).join("; ")}
- Grade read: ${r.gradeRead ? `${r.gradeRead.topTeam} ${r.gradeRead.topGrade} vs ${r.gradeRead.secondTeam} ${r.gradeRead.secondGrade}; spread=${r.gradeRead.spread}` : "(missing)"}

### Recommendation
- Decision type: ${r.recommendation.decisionType}
- Suggested verdict: ${r.recommendation.suggestedVerdict}
- Suggested grade action: ${r.recommendation.suggestedGradeAction}
- Confidence: ${r.recommendation.confidence}
- Reason: ${r.recommendation.reason}

### Current Public Copy
- summary: ${r.currentCopy.summary}
- partnerSummary: ${r.currentCopy.partnerSummary}
- analysis: ${r.currentCopy.analysis}

### Perspective Snapshot
${perspectives}

### Final Decision
- finalState: TODO
- verdictAction: TODO
- gradeAction: TODO
- copyAction: TODO
- notes: TODO
`;
}

const txt = `# NFL Batch ${batchLabel} Grade/Verdict Decision Packet v1

Generated: ${out.generatedAt}

Purpose:
- Review the remaining grade/verdict records after copy-only cleanup.
- Do not apply anything from this file automatically.
- Every record needs a final decision before Batch ${batchLabel} is complete.

Batch:
- Start index: ${out.startIndex}
- End index: ${out.endIndex}
- Grade/verdict records: ${out.count}

## Decision Counts

${Object.entries(decisionCounts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Records

${records.map(recordText).join("\n\n")}

## Output Files

- JSON: reports/quality/nfl-batch-${batchLabel}-grade-verdict-decision-packet-v1.json
- TXT: reports/quality/nfl-batch-${batchLabel}-grade-verdict-decision-packet-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Batch ${batchLabel} grade/verdict decision packet created.`);
console.log(`Records: ${records.length}`);
console.log("");
console.log("Decision counts:");
for (const [k, v] of Object.entries(decisionCounts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${k}: ${v}`);
}
console.log("");
console.log("Open:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-grade-verdict-decision-packet-v1.txt`);
