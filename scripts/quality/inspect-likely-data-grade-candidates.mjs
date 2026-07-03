import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const REPORT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const latestTriage = fs.readdirSync(REPORT_DIR)
  .filter(f => /^outcome-grade-patchability-triage-.*\.json$/.test(f))
  .sort()
  .at(-1);

if (!latestTriage) {
  throw new Error("No outcome-grade-patchability-triage JSON found.");
}

const triage = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latestTriage), "utf8"));
const likelyData = triage.buckets?.["likely data-grade patch"] || [];

function getId(t) {
  return t.id || t.tradeId || "";
}

function getSlug(t) {
  return t.slug || "";
}

function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function allText(obj) {
  const seen = new Set();
  const parts = [];

  function walk(x) {
    if (x == null) return;
    if (typeof x === "string" || typeof x === "number") {
      parts.push(String(x));
      return;
    }
    if (typeof x !== "object") return;
    if (seen.has(x)) return;
    seen.add(x);

    if (Array.isArray(x)) x.forEach(walk);
    else Object.values(x).forEach(walk);
  }

  walk(obj);
  return parts.join("\n");
}

function findTrade(c) {
  return trades.find(t =>
    getId(t) === c.id ||
    getSlug(t) === c.slug ||
    getId(t) === c.slug ||
    getSlug(t) === c.id
  );
}

function publicCopyFields(t) {
  const keys = [
    "summary","partnerSummary","analysis","description","verdictSummary",
    "shortSummary","longSummary","winnerSummary","loserSummary","excerpt",
    "seoTitle","seoDescription","metaTitle","metaDescription"
  ];

  const out = {};
  for (const key of keys) {
    if (typeof t[key] === "string" && t[key].trim()) out[key] = t[key];
  }

  if (Array.isArray(t.perspectives)) {
    out.perspectives = t.perspectives.map((p, i) => ({
      index: i,
      team: p.team || p.teamKey || p.franchise || "",
      grade: p.grade || p.letterGrade || "",
      primarySummary: p.primarySummary || "",
      partnerSummary: p.partnerSummary || "",
      summary: p.summary || "",
      analysis: p.analysis || ""
    }));
  }

  return out;
}

function inferYear(t, c) {
  const hay = `${t.date || ""} ${t.tradeDate || ""} ${t.year || ""} ${getId(t)} ${getSlug(t)} ${c.slug || ""}`;
  const m = hay.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function classifyManualAction(c, t) {
  const year = inferYear(t, c);
  const text = allText(t);
  const grades = t.grades || {};
  const evidence = (c.evidenceTerms || []).join(" ");

  if (year && year >= 2025) {
    return {
      action: "manual/current-or-future review",
      reason: "Recent/future trade or outcome still developing; do not auto-patch from asset score alone."
    };
  }

  if (/unknown-team|unknown-undisclosed|undisclosed-partner|packers-involving/i.test(`${getSlug(t)} ${JSON.stringify(grades)}`)) {
    return {
      action: "manual/data-normalization review",
      reason: "Unknown or malformed team key/slug appears; fix structure before changing grades."
    };
  }

  if (/Eric Dickerson|Randy Moss|Brett Favre|Aaron Rodgers|Jalen Ramsey|Khalil Mack|Laremy Tunsil|Champ Bailey|Marshawn Lynch|Brandin Cooks|Stefon Diggs|Julio Jones/i.test(evidence)) {
    return {
      action: "manual superstar-side verification",
      reason: "High-value name appears, but verify which side actually received the player/pick before patching grades."
    };
  }

  if ((c.flags || []).some(f => /Winner\/useful outcome grade-too-low signal/i.test(f))) {
    return {
      action: "probable grade patch after one-record review",
      reason: "Winner/useful-outcome signal is the closest match to the Chuba-style class."
    };
  }

  if ((c.assetSides || []).some(s => /grade [DF]|grade D\+|grade C-|grade C\+|grade C/i.test(`${s.grade}`) && Number(s.assetScore || 0) >= 60)) {
    return {
      action: "possible grade patch after side verification",
      reason: "Low-graded side has strong asset signal, but side ownership must be confirmed."
    };
  }

  return {
    action: "manual source/context",
    reason: "Signals are not strong enough for automatic grade movement."
  };
}

const rows = likelyData.map((c, index) => {
  const t = findTrade(c);
  if (!t) {
    return {
      rank: index + 1,
      id: c.id,
      slug: c.slug,
      missing: true,
      triageScore: c.score,
      manualAction: "missing record",
      manualReason: "Candidate not found in trades.json"
    };
  }

  const action = classifyManualAction(c, t);

  return {
    rank: index + 1,
    id: getId(t),
    slug: getSlug(t),
    year: inferYear(t, c),
    triageScore: c.score,
    manualAction: action.action,
    manualReason: action.reason,
    grades: t.grades || {},
    verdict: t.verdict || t.result || t.outcome || "",
    title: t.title || t.headline || "",
    candidateFlags: c.flags || [],
    candidateEvidence: c.evidenceTerms || [],
    candidateAssetSides: c.assetSides || [],
    assetsReceived: t.assetsReceived || t.received || t.assets || {},
    publicCopy: publicCopyFields(t),
    qaNotes: t.qaNotes || "",
    rawPreview: norm(allText(t)).slice(0, 1400)
  };
});

const buckets = {};
for (const row of rows) {
  buckets[row.manualAction] ||= [];
  buckets[row.manualAction].push(row);
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceTriage: latestTriage,
  inspectedCount: rows.length,
  actionCounts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  rows,
  buckets
};

const jsonPath = path.join(REPORT_DIR, `likely-data-grade-inspection-pack-${RUN_ID}.json`);
const mdPath = path.join(REPORT_DIR, `likely-data-grade-inspection-pack-${RUN_ID}.md`);
const csvPath = path.join(REPORT_DIR, `likely-data-grade-inspection-pack-${RUN_ID}.csv`);

fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

function cell(v, n = 320) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

function table(list, limit = 80) {
  return [
    "| Rank | Score | ID | Slug | Year | Grades | Manual Action | Reason | Evidence |",
    "|---:|---:|---|---|---:|---|---|---|---|",
    ...list.slice(0, limit).map(r => `| ${r.rank} | ${Math.round(r.triageScore || 0)} | ${cell(r.id)} | ${cell(r.slug)} | ${cell(r.year || "")} | ${cell(JSON.stringify(r.grades), 200)} | ${cell(r.manualAction)} | ${cell(r.manualReason)} | ${cell((r.candidateEvidence || []).join(", "), 260)} |`)
  ].join("\n");
}

fs.writeFileSync(mdPath, [
  "# Likely Data-Grade Inspection Pack",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Source triage: ${latestTriage}`,
  `Inspected candidates: ${rows.length}`,
  "",
  "## Action Counts",
  "",
  "| Action | Count |",
  "|---|---:|",
  ...Object.entries(out.actionCounts).map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "## All Likely Data-Grade Candidates",
  "",
  table(rows, 100),
  "",
  "## Probable Grade Patch After One-Record Review",
  "",
  table(buckets["probable grade patch after one-record review"] || [], 100),
  "",
  "## Possible Grade Patch After Side Verification",
  "",
  table(buckets["possible grade patch after side verification"] || [], 100),
  "",
  "## Manual Superstar-Side Verification",
  "",
  table(buckets["manual superstar-side verification"] || [], 100),
  "",
  "## Current/Future Review",
  "",
  table(buckets["manual/current-or-future review"] || [], 100),
  "",
  "## Data Normalization Review",
  "",
  table(buckets["manual/data-normalization review"] || [], 100)
].join("\n"));

const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
fs.writeFileSync(csvPath, [
  ["rank","triageScore","id","slug","year","grades","manualAction","manualReason","evidence","flags","assetsReceived","summary","partnerSummary","analysis"].map(esc).join(","),
  ...rows.map(r => [
    r.rank,
    Math.round(r.triageScore || 0),
    r.id,
    r.slug,
    r.year || "",
    JSON.stringify(r.grades),
    r.manualAction,
    r.manualReason,
    (r.candidateEvidence || []).join("; "),
    (r.candidateFlags || []).join("; "),
    JSON.stringify(r.assetsReceived),
    r.publicCopy?.summary || "",
    r.publicCopy?.partnerSummary || "",
    r.publicCopy?.analysis || ""
  ].map(esc).join(","))
].join("\n"));

console.log(`\nLikely data-grade inspection pack created.`);
console.log(`Source triage: ${latestTriage}`);
console.log(`Inspected candidates: ${rows.length}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${csvPath}`);
console.log(`- ${mdPath}\n`);

console.log("Action counts:");
console.table(out.actionCounts);

console.log("\nProbable grade patches after one-record review:");
console.table((buckets["probable grade patch after one-record review"] || []).slice(0, 40).map(r => ({
  rank: r.rank,
  score: Math.round(r.triageScore || 0),
  id: r.id,
  slug: r.slug,
  year: r.year,
  grades: JSON.stringify(r.grades),
  evidence: (r.candidateEvidence || []).join(", ").slice(0, 100)
})));

console.log("\nPossible grade patches after side verification:");
console.table((buckets["possible grade patch after side verification"] || []).slice(0, 40).map(r => ({
  rank: r.rank,
  score: Math.round(r.triageScore || 0),
  id: r.id,
  slug: r.slug,
  year: r.year,
  grades: JSON.stringify(r.grades),
  evidence: (r.candidateEvidence || []).join(", ").slice(0, 100)
})));

console.log("\nManual superstar-side verification:");
console.table((buckets["manual superstar-side verification"] || []).slice(0, 40).map(r => ({
  rank: r.rank,
  score: Math.round(r.triageScore || 0),
  id: r.id,
  slug: r.slug,
  year: r.year,
  grades: JSON.stringify(r.grades),
  evidence: (r.candidateEvidence || []).join(", ").slice(0, 100)
})));
