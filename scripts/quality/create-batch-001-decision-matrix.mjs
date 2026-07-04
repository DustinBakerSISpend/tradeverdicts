import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const OUT_JSON = path.join(REPORT_DIR, "nfl-batch-001-decision-matrix.json");
const OUT_MD = path.join(REPORT_DIR, "nfl-batch-001-decision-matrix.md");
const OUT_TXT = path.join(REPORT_DIR, "nfl-batch-001-decision-matrix.txt");

const START_INDEX = 0;
const END_INDEX = 99;

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 500) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function getFirst(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
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

function winnerFromGrades(grades) {
  const entries = Object.entries(grades || {})
    .map(([team, grade]) => ({ team, grade, rank: gradeRank(grade) }))
    .filter(x => x.rank != null);

  if (entries.length < 2) return null;

  entries.sort((a, b) => b.rank - a.rank);

  if (entries[0].rank === entries[1].rank) return {
    type: "even",
    topTeam: null,
    spread: 0,
    topGrade: entries[0].grade,
    secondGrade: entries[1].grade
  };

  return {
    type: "winner",
    topTeam: entries[0].team,
    spread: entries[0].rank - entries[1].rank,
    topGrade: entries[0].grade,
    secondGrade: entries[1].grade
  };
}

function walkStrings(obj, pathParts = [], out = []) {
  if (obj == null) return out;

  if (typeof obj === "string") {
    out.push({ path: pathParts.join("."), text: obj });
    return out;
  }

  if (Array.isArray(obj)) {
    obj.forEach((x, i) => walkStrings(x, [...pathParts, String(i)], out));
    return out;
  }

  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) walkStrings(v, [...pathParts, k], out);
  }

  return out;
}

function publicCopy(trade) {
  const fields = [];
  for (const key of ["summary", "partnerSummary", "analysis"]) {
    if (trade[key]) fields.push({ path: key, text: safe(trade[key]) });
  }

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((p, i) => {
      for (const key of ["primarySummary", "partnerSummary", "analysis", "verdict"]) {
        if (p && p[key]) fields.push({ path: `perspectives.${i}.${key}`, text: safe(p[key]) });
      }
    });
  }

  return fields;
}

const badCopyPatterns = [
  { name: "partner side", re: /partner side/i },
  { name: "partner grade", re: /partner grade/i },
  { name: "partner outcome", re: /partner outcome/i },
  { name: "Partner Partner", re: /Partner Partner/i },
  { name: "Partner Loss", re: /Partner Loss/i },
  { name: "Partner Even", re: /Partner Even/i },
  { name: "opposite side", re: /opposite side/i },
  { name: "reassessed", re: /\breassessed\b/i },
  { name: "curve balance", re: /curve balance/i },
  { name: "true low-margin", re: /true low-margin/i },
  { name: "with High confidence", re: /with High confidence/i },
  { name: "Status leak", re: /\bStatus\s*:/i },
  { name: "Tier leak", re: /\bTier\s*:/i },
  { name: "Confidence leak", re: /\bConfidence\s*:/i },
  { name: "manual indexing", re: /manual indexing/i },
  { name: "priority GSC", re: /priority GSC/i },
  { name: "McKayuncertain", re: /McKayuncertain/i },
  { name: "gets the verdict", re: /gets the verdict/i },
  { name: "receives the edge", re: /receives the edge/i }
];

function analyzeTrade(trade, index) {
  const id = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  const slug = safe(getFirst(trade, ["slug", "urlSlug"]));
  const date = safe(getFirst(trade, ["date", "tradeDate", "year"]));
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));
  const grades = trade.grades || {};
  const gradeRead = winnerFromGrades(grades);
  const fields = publicCopy(trade);

  const allPublic = fields.map(f => f.text).join("\n");
  const allStrings = walkStrings(trade).map(x => x.text).join("\n");

  const publicCopyHits = [];
  for (const p of badCopyPatterns) {
    const hit = fields.find(f => p.re.test(f.text));
    if (hit) publicCopyHits.push({
      pattern: p.name,
      path: hit.path,
      sample: compact(hit.text, 260)
    });
  }

  const perspectiveCount = Array.isArray(trade.perspectives) ? trade.perspectives.length : 0;

  const perspectiveGradeConflicts = [];
  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((p, i) => {
      if (!p) return;

      const pg = safe(p.primaryGrade);
      const kg = safe(p.partnerGrade);
      const pv = safe(p.verdict);

      if (pg || kg || pv) {
        perspectiveGradeConflicts.push({
          index: i,
          primaryTeam: safe(p.primaryTeam || p.team || p.teamKey),
          partnerTeam: safe(p.partnerTeam || p.partner || p.opponentTeam),
          primaryGrade: pg,
          partnerGrade: kg,
          verdict: pv
        });
      }
    });
  }

  const conflictingPerspectiveCount = perspectiveGradeConflicts.filter(p => {
    const spread = Math.abs((gradeRank(p.primaryGrade) ?? 0) - (gradeRank(p.partnerGrade) ?? 0));
    if (/even trade/i.test(p.verdict) && spread >= 2) return true;
    if (!/even trade/i.test(p.verdict) && spread === 0) return true;
    return false;
  }).length;

  const unknownTeamLeak =
    /unknown-team/i.test(allStrings) ||
    /unknown partner/i.test(allPublic) ||
    /unknown-partner/i.test(slug);

  const weirdCharLeak = /ï¿½|�|Ã|Â|Arizonast Louis/i.test(allStrings);

  const verdictMismatch = (() => {
    if (!gradeRead) return null;

    if (/even trade/i.test(verdict) && gradeRead.type === "winner" && gradeRead.spread >= 2) {
      return `Top-level verdict says Even Trade but top-level grades suggest ${gradeRead.topTeam} edge (${gradeRead.topGrade} vs ${gradeRead.secondGrade}).`;
    }

    if (!/even trade/i.test(verdict) && gradeRead.type === "even") {
      return `Top-level verdict names a winner but top-level grades are even (${gradeRead.topGrade}/${gradeRead.secondGrade}).`;
    }

    return null;
  })();

  const clearCopyGradeContradiction = (() => {
    if (/even trade/i.test(verdict)) {
      if (/gets? the slight hindsight edge|stronger realized value|landed the stronger|aged disastrously|overwhelming winner|single worst|extracted the stronger/i.test(allPublic)) {
        return "Even verdict but copy says one side clearly won or lost.";
      }
    }

    if (!/even trade/i.test(verdict)) {
      if (/Partner Even|partner outcome remains neutral|not strong enough to force a winner|does not create a clear long-term winner/i.test(allPublic)) {
        return "Winner verdict but partner/analysis copy says the deal is even or neutral.";
      }
    }

    return null;
  })();

  const issues = [];

  if (unknownTeamLeak) issues.push("unknown_team_or_partner_leak");
  if (weirdCharLeak) issues.push("weird_character_or_franchise_text");
  if (publicCopyHits.length) issues.push("bad_public_copy_language");
  if (perspectiveCount > 2) issues.push("too_many_perspectives");
  if (conflictingPerspectiveCount > 0) issues.push("perspective_grade_or_verdict_conflict");
  if (verdictMismatch) issues.push("top_level_grade_verdict_mismatch");
  if (clearCopyGradeContradiction) issues.push("copy_contradicts_verdict_or_grade");

  let finalState = "confirmed_clean";
  let recommendedAction = "No change based on this scanner.";

  if (issues.includes("unknown_team_or_partner_leak") || issues.includes("too_many_perspectives")) {
    finalState = "hold_source_needed";
    recommendedAction = "Hold for structural/source review before patching. Do not copy-only patch until team/asset structure is resolved.";
  } else if (
    issues.includes("top_level_grade_verdict_mismatch") ||
    issues.includes("perspective_grade_or_verdict_conflict") ||
    issues.includes("copy_contradicts_verdict_or_grade")
  ) {
    finalState = "patch_candidate";
    recommendedAction = "Needs grade/verdict/perspective alignment review. Patch only after deciding canonical winner/grades.";
  } else if (issues.includes("bad_public_copy_language") || issues.includes("weird_character_or_franchise_text")) {
    finalState = "patch_candidate";
    recommendedAction = "Copy-only public cleanup candidate. Keep grades/verdict unless another issue is present.";
  }

  return {
    batchNumber: 1,
    index,
    recordNumber: index + 1,
    id,
    slug,
    date,
    verdict,
    grades,
    gradeRead,
    perspectiveCount,
    conflictingPerspectiveCount,
    issues,
    finalState,
    recommendedAction,
    verdictMismatch,
    clearCopyGradeContradiction,
    publicCopyHits,
    perspectiveGradeConflicts: perspectiveGradeConflicts.slice(0, 8),
    publicCopyPreview: {
      summary: compact(trade.summary || "", 420),
      partnerSummary: compact(trade.partnerSummary || "", 420),
      analysis: compact(trade.analysis || "", 420)
    }
  };
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

if (!Array.isArray(trades)) throw new Error("Could not find trades array.");

const batch = trades.slice(START_INDEX, END_INDEX + 1);
const records = batch.map((trade, offset) => analyzeTrade(trade, START_INDEX + offset));

const counts = {};
for (const r of records) {
  counts[r.finalState] = (counts[r.finalState] || 0) + 1;
}

const issueCounts = {};
for (const r of records) {
  for (const issue of r.issues) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
}

const out = {
  generatedAt: new Date().toISOString(),
  batchNumber: 1,
  startIndex: START_INDEX,
  endIndex: END_INDEX,
  count: records.length,
  counts,
  issueCounts,
  records
};

fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));

function mdRecord(r) {
  const hitText = r.publicCopyHits.length
    ? r.publicCopyHits.map(h => `  - ${h.pattern} at ${h.path}: ${h.sample}`).join("\n")
    : "  - None";

  const conflicts = r.perspectiveGradeConflicts.length
    ? r.perspectiveGradeConflicts.map(p => `  - perspective ${p.index}: ${p.primaryGrade || "?"}/${p.partnerGrade || "?"}; verdict="${p.verdict || ""}"`).join("\n")
    : "  - None";

  return `## #${r.recordNumber} / index ${r.index}: ${r.id}

- Slug: ${r.slug}
- Date: ${r.date}
- Verdict: ${r.verdict}
- Grades: ${Object.entries(r.grades || {}).map(([k,v]) => `${k}=${v}`).join("; ") || "(missing)"}
- Perspectives: ${r.perspectiveCount}
- Final state: ${r.finalState}
- Recommended action: ${r.recommendedAction}
- Issues: ${r.issues.join(", ") || "none"}
${r.verdictMismatch ? `- Verdict mismatch: ${r.verdictMismatch}\n` : ""}${r.clearCopyGradeContradiction ? `- Copy contradiction: ${r.clearCopyGradeContradiction}\n` : ""}
### Bad Public Copy Hits
${hitText}

### Perspective Grade/Verifier Snapshot
${conflicts}

### Public Copy Preview
- Summary: ${r.publicCopyPreview.summary}
- Partner summary: ${r.publicCopyPreview.partnerSummary}
- Analysis: ${r.publicCopyPreview.analysis}
`;
}

const md = `# NFL Batch 001 Decision Matrix

Generated: ${out.generatedAt}

Source: \`src/data/nfl/trades.json\`

Batch:
- Start index: ${START_INDEX}
- End index: ${END_INDEX}
- Records: ${records.length}

## Final State Counts

${Object.entries(counts).map(([k,v]) => `- ${k}: ${v}`).join("\n")}

## Issue Counts

${Object.entries(issueCounts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n")}

## Records

${records.map(mdRecord).join("\n\n")}

## Output Files

- JSON: \`reports/quality/nfl-batch-001-decision-matrix.json\`
- Markdown: \`reports/quality/nfl-batch-001-decision-matrix.md\`
- Text: \`reports/quality/nfl-batch-001-decision-matrix.txt\`
`;

fs.writeFileSync(OUT_MD, md);
fs.writeFileSync(OUT_TXT, md);

console.log("");
console.log("Batch 001 decision matrix created.");
console.log(`Records: ${records.length}`);
console.log("");
console.log("Final states:");
for (const [k, v] of Object.entries(counts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log("Issue counts:");
for (const [k, v] of Object.entries(issueCounts).sort((a,b) => b[1] - a[1])) console.log(`- ${k}: ${v}`);
console.log("");
console.log("Open:");
console.log("reports\\quality\\nfl-batch-001-decision-matrix.txt");
