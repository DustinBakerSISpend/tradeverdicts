import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const batchNumber = Number(process.argv[2] || 1);
const batchSize = Number(process.argv[3] || 100);
const startIndex = (batchNumber - 1) * batchSize;
const endIndex = startIndex + batchSize - 1;
const batchLabel = String(batchNumber).padStart(3, "0");

const outJson = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-master-audit-v2.json`);
const outTxt = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-master-audit-v2.txt`);
const patchPlanJson = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-patch-plan-v2.json`);
const completionTemplateJson = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-completion-template.json`);

function safe(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function compact(value, max = 500) {
  const s = safe(value).replace(/\s+/g, " ").trim();
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

function gradeRank(grade) {
  const g = safe(grade).trim().toUpperCase();
  return {
    "A+": 13, "A": 12, "A-": 11,
    "B+": 10, "B": 9, "B-": 8,
    "C+": 7, "C": 6, "C-": 5,
    "D+": 4, "D": 3, "D-": 2,
    "F": 1
  }[g] ?? null;
}

function walkStrings(obj, pathParts = [], out = []) {
  if (obj == null) return out;

  if (typeof obj === "string") {
    out.push({ path: pathParts.join("."), text: obj });
    return out;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkStrings(item, [...pathParts, String(i)], out));
    return out;
  }

  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      walkStrings(value, [...pathParts, key], out);
    }
  }

  return out;
}

function publicFields(trade) {
  const fields = [];

  for (const key of ["title", "headline", "summary", "partnerSummary", "analysis", "description", "verdict"]) {
    if (trade[key]) fields.push({ path: key, text: safe(trade[key]) });
  }

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((p, i) => {
      if (!p || typeof p !== "object") return;
      for (const key of ["primarySummary", "partnerSummary", "summary", "analysis", "description", "verdict"]) {
        if (p[key]) fields.push({ path: `perspectives.${i}.${key}`, text: safe(p[key]) });
      }
    });
  }

  return fields;
}

function assetFields(trade) {
  const fields = [];

  function walkAssets(obj, pathParts = []) {
    if (obj == null) return;

    const pathText = pathParts.join(".").toLowerCase();

    if (typeof obj === "string") {
      if (
        pathText.includes("asset") ||
        pathText.includes("player") ||
        pathText.includes("pick") ||
        pathText.includes("received") ||
        pathText.includes("sent")
      ) {
        fields.push({ path: pathParts.join("."), text: obj });
      }
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walkAssets(item, [...pathParts, String(i)]));
      return;
    }

    if (typeof obj === "object") {
      for (const [key, value] of Object.entries(obj)) {
        walkAssets(value, [...pathParts, key]);
      }
    }
  }

  walkAssets(trade);
  return fields;
}

function normalizeAssetText(value) {
  return safe(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^\w\s#.$/'?-]/g, "")
    .trim();
}

function getTopGradeRead(grades) {
  const entries = Object.entries(grades || {})
    .map(([team, grade]) => ({ team, grade: safe(grade), rank: gradeRank(grade) }))
    .filter(x => x.rank != null);

  if (entries.length < 2) return null;

  entries.sort((a, b) => b.rank - a.rank);

  return {
    topTeam: entries[0].team,
    topGrade: entries[0].grade,
    secondTeam: entries[1].team,
    secondGrade: entries[1].grade,
    spread: entries[0].rank - entries[1].rank,
    evenGrades: entries[0].rank === entries[1].rank,
    entries
  };
}

const badPublicCopyPatterns = [
  { key: "second_pass", label: "second pass", re: /second pass/i, severity: "P0" },
  { key: "partner_side", label: "partner side", re: /partner side/i, severity: "P0" },
  { key: "partner_grade", label: "partner grade", re: /partner grade/i, severity: "P0" },
  { key: "partner_assessment", label: "partner assessment", re: /partner assessment/i, severity: "P0" },
  { key: "opposite_side", label: "opposite side", re: /opposite side/i, severity: "P0" },
  { key: "opposite_value_judgment", label: "opposite value judgment", re: /opposite value judgment/i, severity: "P0" },
  { key: "revised_outcome", label: "revised outcome", re: /revised outcome/i, severity: "P0" },
  { key: "original_grade", label: "original grade language", re: /original [A-F][+-]?/i, severity: "P0" },
  { key: "regrade", label: "regrade language", re: /\bregrade\b|\bregraded\b|\bregrading\b/i, severity: "P0" },
  { key: "priority_gsc", label: "priority GSC", re: /priority GSC/i, severity: "P0" },
  { key: "manual_indexing", label: "manual indexing", re: /manual indexing/i, severity: "P0" },
  { key: "status_leak", label: "Status leak", re: /\bStatus\s*:/i, severity: "P0" },
  { key: "tier_leak", label: "Tier leak", re: /\bTier\s*:/i, severity: "P0" },
  { key: "confidence_leak", label: "Confidence leak", re: /\bConfidence\s*:/i, severity: "P0" },
  { key: "partner_partner", label: "Partner Partner", re: /Partner Partner/i, severity: "P0" },
  { key: "partner_loss_win_even", label: "Partner Win/Loss/Even language", re: /Partner (Win|Loss|Even)\b/i, severity: "P0" },
  { key: "partner_outcome", label: "partner outcome", re: /partner outcome/i, severity: "P0" },
  { key: "reassessed", label: "reassessed public language", re: /\breassessed\b/i, severity: "P1" },
  { key: "curve_balance", label: "curve balance", re: /curve balance/i, severity: "P1" },
  { key: "true_low_margin", label: "true low-margin", re: /true low-margin/i, severity: "P1" },
  { key: "strict_hindsight", label: "strict-hindsight", re: /strict-hindsight/i, severity: "P1" },
  { key: "public_viewable", label: "public/viewable process language", re: /public,\s*viewable/i, severity: "P1" },
  { key: "graded_under_scale", label: "graded under scale", re: /graded under the Trade Verdicts hindsight scale/i, severity: "P1" },
  { key: "minor_designation", label: "minor designation", re: /minor designation reflects/i, severity: "P1" },
  { key: "gets_verdict", label: "gets the verdict", re: /gets the verdict/i, severity: "P1" },
  { key: "receives_edge", label: "receives the edge", re: /receives the edge/i, severity: "P1" },
  { key: "mckayuncertain", label: "missing spacing around uncertain", re: /McKayuncertain/i, severity: "P1" }
];

const brokenTextPatterns = [
  { key: "replacement_char", label: "replacement character", re: /ï¿½|�/i, severity: "P0" },
  { key: "mojibake", label: "mojibake", re: /Ã|Â/i, severity: "P1" },
  { key: "arizonast_louis", label: "Arizonast Louis", re: /Arizonast Louis/i, severity: "P1" },
  { key: "year_pick_spacing", label: "20215th-style broken spacing", re: /\b\d{4}\d+(st|nd|rd|th)\b/i, severity: "P1" },
  { key: "overall_spacing", label: "13overall-style broken spacing", re: /\b\d+overall\b/i, severity: "P1" },
  { key: "space_before_paren", label: "extra space before parenthesis", re: /\s+\)/, severity: "P2" },
  { key: "missing_space_after_semicolon", label: "missing space after semicolon", re: /;[A-Za-z0-9]/, severity: "P2" }
];

function findPatternHits(fields, patterns) {
  const hits = [];

  for (const pattern of patterns) {
    for (const field of fields) {
      if (pattern.re.test(field.text)) {
        hits.push({
          key: pattern.key,
          label: pattern.label,
          severity: pattern.severity,
          path: field.path,
          sample: compact(field.text, 280)
        });
      }
    }
  }

  return hits;
}

function perspectiveSignature(p) {
  if (!p || typeof p !== "object") return "";
  return [
    safe(p.primaryTeam || p.team || p.teamKey),
    safe(p.partnerTeam || p.partner || p.opponentTeam),
    safe(p.primaryGrade),
    safe(p.partnerGrade),
    safe(p.verdict),
    compact(p.primarySummary || "", 120),
    compact(p.partnerSummary || "", 120)
  ].join("|").toLowerCase();
}

function perspectiveConflicts(trade, topVerdict) {
  const conflicts = [];
  if (!Array.isArray(trade.perspectives)) return conflicts;

  trade.perspectives.forEach((p, i) => {
    if (!p || typeof p !== "object") return;

    const pg = safe(p.primaryGrade);
    const kg = safe(p.partnerGrade);
    const pv = safe(p.verdict || topVerdict);

    const pr = gradeRank(pg);
    const kr = gradeRank(kg);

    if (pr == null || kr == null) return;

    const spread = Math.abs(pr - kr);

    if (/even trade/i.test(pv) && spread >= 2) {
      conflicts.push({
        perspectiveIndex: i,
        type: "perspective_even_verdict_with_large_grade_spread",
        primaryGrade: pg,
        partnerGrade: kg,
        verdict: pv
      });
    }

    if (!/even trade/i.test(pv) && spread === 0) {
      conflicts.push({
        perspectiveIndex: i,
        type: "perspective_winner_verdict_with_equal_grades",
        primaryGrade: pg,
        partnerGrade: kg,
        verdict: pv
      });
    }
  });

  return conflicts;
}

function topVerdictGradeMismatch(trade) {
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));
  const read = getTopGradeRead(trade.grades || {});
  if (!read) return null;

  if (/even trade/i.test(verdict) && !read.evenGrades && read.spread >= 2) {
    return {
      type: "top_even_verdict_with_large_grade_spread",
      verdict,
      topTeam: read.topTeam,
      topGrade: read.topGrade,
      secondTeam: read.secondTeam,
      secondGrade: read.secondGrade,
      spread: read.spread
    };
  }

  if (!/even trade/i.test(verdict) && read.evenGrades) {
    return {
      type: "top_winner_verdict_with_equal_grades",
      verdict,
      topGrade: read.topGrade,
      secondGrade: read.secondGrade,
      spread: read.spread
    };
  }

  return null;
}

function copyContradiction(trade) {
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));
  const text = publicFields(trade).map(x => x.text).join("\n");

  if (/even trade/i.test(verdict)) {
    if (/clearer football value|stronger realized value|landed the stronger|extracted the stronger|single worst|overwhelming winner|aged disastrously|gave .* the edge|keeps? the edge|wins? the deal/i.test(text)) {
      return "Even verdict but public copy suggests a directional winner.";
    }
  }

  if (!/even trade/i.test(verdict)) {
    if (/not strong enough to force a winner|does not create a clear long-term winner|balanced exchange|balanced or unresolved|partner outcome remains neutral|low-separation exchange/i.test(text)) {
      return "Winner verdict but public copy says the trade is even, neutral, or unresolved.";
    }
  }

  return null;
}

function duplicateAssetIssues(trade) {
  const issues = [];
  const assetsReceived = trade.assetsReceived;

  if (!assetsReceived || typeof assetsReceived !== "object") return issues;

  for (const [team, assets] of Object.entries(assetsReceived)) {
    if (!Array.isArray(assets)) continue;

    const seen = new Map();

    assets.forEach((assetObj, i) => {
      const assetText = normalizeAssetText(assetObj?.asset || assetObj?.name || assetObj?.value || "");
      if (!assetText) return;

      if (!seen.has(assetText)) seen.set(assetText, []);
      seen.get(assetText).push(i);
    });

    for (const [assetText, indexes] of seen.entries()) {
      if (indexes.length > 1) {
        issues.push({
          team,
          assetText,
          indexes,
          type: "duplicate_asset_within_same_receiving_side"
        });
      }
    }
  }

  return issues;
}

function makeTradeFingerprint(trade) {
  const date = safe(getFirst(trade, ["date", "tradeDate", "year"]));
  const teams = Object.keys(trade.grades || {}).sort().join("|");

  const assets = assetFields(trade)
    .map(x => normalizeAssetText(x.text))
    .filter(Boolean)
    .sort()
    .join("|");

  return `${date}::${teams}::${assets}`;
}

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;

if (!Array.isArray(trades)) {
  throw new Error("Could not find NFL trades array.");
}

const fingerprintMap = new Map();
const slugMap = new Map();

trades.forEach((trade, index) => {
  const fp = makeTradeFingerprint(trade);
  if (fp.replace(/[:|]/g, "").trim()) {
    if (!fingerprintMap.has(fp)) fingerprintMap.set(fp, []);
    fingerprintMap.get(fp).push(index);
  }

  const slug = safe(getFirst(trade, ["slug", "urlSlug"]));
  if (slug) {
    if (!slugMap.has(slug)) slugMap.set(slug, []);
    slugMap.get(slug).push(index);
  }
});

function classifyTrade(trade, index) {
  const id = safe(getFirst(trade, ["id", "tradeId", "trade_id"]));
  const slug = safe(getFirst(trade, ["slug", "urlSlug"]));
  const date = safe(getFirst(trade, ["date", "tradeDate", "year"]));
  const verdict = safe(getFirst(trade, ["verdict", "winner", "outcome"]));

  const pFields = publicFields(trade);
  const allStringFields = walkStrings(trade);
  const allText = allStringFields.map(x => x.text).join("\n");

  const badPublicCopyHits = findPatternHits(pFields, badPublicCopyPatterns);
  const brokenTextHits = findPatternHits(allStringFields, brokenTextPatterns);

  const perspectiveCount = Array.isArray(trade.perspectives) ? trade.perspectives.length : 0;

  const duplicatePerspectiveIssues = [];
  if (Array.isArray(trade.perspectives)) {
    const seen = new Map();

    trade.perspectives.forEach((p, i) => {
      const sig = perspectiveSignature(p);
      if (!sig) return;
      if (!seen.has(sig)) seen.set(sig, []);
      seen.get(sig).push(i);
    });

    for (const [sig, indexes] of seen.entries()) {
      if (indexes.length > 1) {
        duplicatePerspectiveIssues.push({
          type: "duplicate_perspective_signature",
          indexes,
          signaturePreview: compact(sig, 220)
        });
      }
    }
  }

  const unknownLeak =
    /unknown-team/i.test(allText) ||
    /unknown partner/i.test(allText) ||
    /unknown-partner/i.test(slug);

  const topMismatch = topVerdictGradeMismatch(trade);
  const perspectiveMismatch = perspectiveConflicts(trade, verdict);
  const contradiction = copyContradiction(trade);
  const assetDupes = duplicateAssetIssues(trade);

  const fp = makeTradeFingerprint(trade);
  const duplicateFingerprintIndexes = (fingerprintMap.get(fp) || []).filter(i => i !== index);
  const duplicateSlugIndexes = (slugMap.get(slug) || []).filter(i => i !== index);

  const missingCoreFields = [];
  if (!id) missingCoreFields.push("id");
  if (!slug) missingCoreFields.push("slug");
  if (!date) missingCoreFields.push("date");
  if (!verdict) missingCoreFields.push("verdict");
  if (!trade.grades || Object.keys(trade.grades).length < 2) missingCoreFields.push("grades");

  const issueKeys = [];

  if (missingCoreFields.length) issueKeys.push("missing_core_fields");
  if (unknownLeak) issueKeys.push("unknown_team_or_partner_leak");
  if (perspectiveCount > 2) issueKeys.push("too_many_perspectives");
  if (duplicatePerspectiveIssues.length) issueKeys.push("duplicate_perspectives");
  if (topMismatch) issueKeys.push("top_level_grade_verdict_mismatch");
  if (perspectiveMismatch.length) issueKeys.push("perspective_grade_verdict_mismatch");
  if (contradiction) issueKeys.push("copy_contradicts_verdict_or_grade");
  if (badPublicCopyHits.length) issueKeys.push("bad_public_copy_language");
  if (brokenTextHits.length) issueKeys.push("broken_or_weird_text");
  if (assetDupes.length) issueKeys.push("duplicate_asset_within_trade");
  if (duplicateFingerprintIndexes.length || duplicateSlugIndexes.length) issueKeys.push("duplicate_merge_review");

  let classification = "confirmed_clean_candidate";
  let recommendedAction = "No patch recommended by v2 scanner.";

  if (
    issueKeys.includes("missing_core_fields") ||
    issueKeys.includes("unknown_team_or_partner_leak") ||
    issueKeys.includes("too_many_perspectives") ||
    issueKeys.includes("duplicate_perspectives")
  ) {
    classification = "structural_hold";
    recommendedAction = "Hold before copy patching. Resolve structure/perspective/team integrity first.";
  } else if (issueKeys.includes("duplicate_merge_review")) {
    classification = "duplicate_merge_review";
    recommendedAction = "Review duplicate/near-duplicate candidate before patching.";
  } else if (
    issueKeys.includes("top_level_grade_verdict_mismatch") ||
    issueKeys.includes("perspective_grade_verdict_mismatch") ||
    issueKeys.includes("copy_contradicts_verdict_or_grade")
  ) {
    classification = "grade_verdict_review";
    recommendedAction = "Review canonical grades/verdict before copy patching.";
  } else if (
    issueKeys.includes("bad_public_copy_language") ||
    issueKeys.includes("broken_or_weird_text") ||
    issueKeys.includes("duplicate_asset_within_trade")
  ) {
    classification = "copy_patch_candidate";
    recommendedAction = "High-confidence copy/text cleanup candidate. Preserve grades/verdict unless manually escalated.";
  }

  return {
    batchNumber,
    index,
    recordNumber: index + 1,
    id,
    slug,
    date,
    verdict,
    grades: trade.grades || {},
    perspectiveCount,
    classification,
    recommendedAction,
    issueKeys,
    missingCoreFields,
    unknownLeak,
    badPublicCopyHits,
    brokenTextHits,
    topMismatch,
    perspectiveMismatch,
    contradiction,
    duplicatePerspectiveIssues,
    assetDupes,
    duplicateFingerprintIndexes,
    duplicateSlugIndexes,
    publicCopyPreview: {
      summary: compact(trade.summary || "", 420),
      partnerSummary: compact(trade.partnerSummary || "", 420),
      analysis: compact(trade.analysis || "", 420)
    }
  };
}

const batch = trades.slice(startIndex, startIndex + batchSize);
const records = batch.map((trade, offset) => classifyTrade(trade, startIndex + offset));

const classificationCounts = {};
const issueCounts = {};

for (const record of records) {
  classificationCounts[record.classification] = (classificationCounts[record.classification] || 0) + 1;
  for (const issue of record.issueKeys) {
    issueCounts[issue] = (issueCounts[issue] || 0) + 1;
  }
}

const patchPlan = {
  generatedAt: new Date().toISOString(),
  batchNumber,
  batchLabel,
  startIndex,
  endIndex: startIndex + batch.length - 1,
  rule: "This is a plan only. It does not patch data. Patch by ID only after review.",
  copyPatchCandidates: records
    .filter(r => r.classification === "copy_patch_candidate")
    .map(r => ({
      index: r.index,
      recordNumber: r.recordNumber,
      id: r.id,
      slug: r.slug,
      verdict: r.verdict,
      grades: r.grades,
      badPublicCopyHits: r.badPublicCopyHits,
      brokenTextHits: r.brokenTextHits,
      assetDupes: r.assetDupes,
      recommendedAction: r.recommendedAction
    })),
  gradeVerdictReview: records
    .filter(r => r.classification === "grade_verdict_review")
    .map(r => ({
      index: r.index,
      recordNumber: r.recordNumber,
      id: r.id,
      slug: r.slug,
      verdict: r.verdict,
      grades: r.grades,
      topMismatch: r.topMismatch,
      perspectiveMismatch: r.perspectiveMismatch,
      contradiction: r.contradiction,
      badPublicCopyHits: r.badPublicCopyHits,
      recommendedAction: r.recommendedAction
    })),
  structuralHolds: records
    .filter(r => r.classification === "structural_hold")
    .map(r => ({
      index: r.index,
      recordNumber: r.recordNumber,
      id: r.id,
      slug: r.slug,
      issueKeys: r.issueKeys,
      perspectiveCount: r.perspectiveCount,
      missingCoreFields: r.missingCoreFields,
      unknownLeak: r.unknownLeak,
      duplicatePerspectiveIssues: r.duplicatePerspectiveIssues,
      recommendedAction: r.recommendedAction
    })),
  duplicateMergeReview: records
    .filter(r => r.classification === "duplicate_merge_review")
    .map(r => ({
      index: r.index,
      recordNumber: r.recordNumber,
      id: r.id,
      slug: r.slug,
      duplicateFingerprintIndexes: r.duplicateFingerprintIndexes,
      duplicateSlugIndexes: r.duplicateSlugIndexes,
      recommendedAction: r.recommendedAction
    }))
};

const auditOut = {
  generatedAt: new Date().toISOString(),
  source: "src/data/nfl/trades.json",
  batchNumber,
  batchLabel,
  batchSize,
  startIndex,
  endIndex: startIndex + batch.length - 1,
  requestedEndIndex: endIndex,
  totalTrades: trades.length,
  actualBatchCount: batch.length,
  classificationCounts,
  issueCounts,
  records
};

const completionTemplate = {
  batchNumber,
  batchLabel,
  startIndex,
  endIndex: startIndex + batch.length - 1,
  status: "not_complete",
  completionRule: "Every record must be patched_verified, confirmed_clean, reviewed_left_alone, or hold_source_needed before completion.",
  records: records.map(r => ({
    index: r.index,
    recordNumber: r.recordNumber,
    id: r.id,
    slug: r.slug,
    initialClassification: r.classification,
    finalState: "TODO",
    patchApplied: false,
    verificationPassed: false,
    notes: ""
  }))
};

fs.writeFileSync(outJson, JSON.stringify(auditOut, null, 2));
fs.writeFileSync(patchPlanJson, JSON.stringify(patchPlan, null, 2));
fs.writeFileSync(completionTemplateJson, JSON.stringify(completionTemplate, null, 2));

function recordText(r) {
  const badHits = r.badPublicCopyHits.length
    ? r.badPublicCopyHits.slice(0, 8).map(h => `  - ${h.severity} ${h.label} at ${h.path}: ${h.sample}`).join("\n")
    : "  - None";

  const brokenHits = r.brokenTextHits.length
    ? r.brokenTextHits.slice(0, 8).map(h => `  - ${h.severity} ${h.label} at ${h.path}: ${h.sample}`).join("\n")
    : "  - None";

  return `## #${r.recordNumber} / index ${r.index}: ${r.id || "(missing id)"}

- Slug: ${r.slug || "(missing slug)"}
- Date: ${r.date || "(missing date)"}
- Verdict: ${r.verdict || "(missing verdict)"}
- Grades: ${Object.entries(r.grades || {}).map(([k,v]) => `${k}=${v}`).join("; ") || "(missing grades)"}
- Perspectives: ${r.perspectiveCount}
- Classification: ${r.classification}
- Recommended action: ${r.recommendedAction}
- Issue keys: ${r.issueKeys.join(", ") || "none"}

${r.topMismatch ? `### Top-Level Grade/Verdict Mismatch\n- ${r.topMismatch.type}: verdict="${r.topMismatch.verdict}", grades=${r.topMismatch.topTeam || "?"} ${r.topMismatch.topGrade || "?"} vs ${r.topMismatch.secondTeam || "?"} ${r.topMismatch.secondGrade || "?"}\n` : ""}${r.contradiction ? `### Copy Contradiction\n- ${r.contradiction}\n` : ""}### Bad Public Copy Hits
${badHits}

### Broken / Weird Text Hits
${brokenHits}

### Public Copy Preview
- Summary: ${r.publicCopyPreview.summary}
- Partner summary: ${r.publicCopyPreview.partnerSummary}
- Analysis: ${r.publicCopyPreview.analysis}
`;
}

const txt = `# NFL Batch ${batchLabel} Master Audit v2

Generated: ${auditOut.generatedAt}

Source: src/data/nfl/trades.json

Batch:
- Batch number: ${batchNumber}
- Start index: ${auditOut.startIndex}
- End index: ${auditOut.endIndex}
- Actual records: ${auditOut.actualBatchCount}
- Total NFL trades: ${auditOut.totalTrades}

## Classification Counts

${Object.entries(classificationCounts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Issue Counts

${Object.entries(issueCounts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Records

${records.map(recordText).join("\n\n")}

## Output Files

- JSON audit: reports/quality/nfl-batch-${batchLabel}-master-audit-v2.json
- Text audit: reports/quality/nfl-batch-${batchLabel}-master-audit-v2.txt
- Patch plan: reports/quality/nfl-batch-${batchLabel}-patch-plan-v2.json
- Completion template: reports/quality/nfl-batch-${batchLabel}-completion-template.json
`;

fs.writeFileSync(outTxt, txt);

console.log("");
console.log(`NFL Batch ${batchLabel} master audit v2 complete.`);
console.log(`Indexes: ${auditOut.startIndex}-${auditOut.endIndex}`);
console.log(`Records: ${auditOut.actualBatchCount}`);
console.log("");
console.log("Classification counts:");
for (const [key, value] of Object.entries(classificationCounts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${key}: ${value}`);
}
console.log("");
console.log("Issue counts:");
for (const [key, value] of Object.entries(issueCounts).sort((a,b) => b[1] - a[1])) {
  console.log(`- ${key}: ${value}`);
}
console.log("");
console.log("Open:");
console.log(`reports\\quality\\nfl-batch-${batchLabel}-master-audit-v2.txt`);
