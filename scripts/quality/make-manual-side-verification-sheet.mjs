import fs from "node:fs";
import path from "node:path";

const REPORT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const latestPack = fs.readdirSync(REPORT_DIR)
  .filter(f => /^likely-data-grade-inspection-pack-.*\.json$/.test(f))
  .sort()
  .at(-1);

if (!latestPack) {
  throw new Error("No likely-data-grade-inspection-pack JSON found.");
}

const pack = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latestPack), "utf8"));
const rows = pack.rows || [];

function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function short(v, n = 260) {
  return norm(typeof v === "string" ? v : JSON.stringify(v ?? "")).slice(0, n);
}

function assetsByTeam(row) {
  const assets = row.assetsReceived || {};
  return Object.entries(assets).map(([team, vals]) => {
    const txt = Array.isArray(vals)
      ? vals.map(v => v.asset || v.name || JSON.stringify(v)).join("; ")
      : JSON.stringify(vals);
    return `${team}: ${txt}`;
  });
}

function gradeValue(g) {
  const map = {
    "A+": 12, "A": 11, "A-": 10,
    "B+": 9, "B": 8, "B-": 7,
    "C+": 6, "C": 5, "C-": 4,
    "D+": 3, "D": 2, "D-": 1,
    "F": 0
  };
  return map[String(g || "").toUpperCase()] ?? null;
}

function bestGrade(grades) {
  return Object.entries(grades || {})
    .map(([team, grade]) => ({ team, grade, value: gradeValue(grade) }))
    .filter(x => x.value !== null)
    .sort((a,b) => b.value - a.value)[0] || null;
}

function worstGrade(grades) {
  return Object.entries(grades || {})
    .map(([team, grade]) => ({ team, grade, value: gradeValue(grade) }))
    .filter(x => x.value !== null)
    .sort((a,b) => a.value - b.value)[0] || null;
}

function recommend(row) {
  const assets = assetsByTeam(row).join(" | ");
  const evidence = (row.candidateEvidence || []).join(", ");
  const b = bestGrade(row.grades);
  const w = worstGrade(row.grades);

  if (/2025|2026|2027/.test(String(row.year))) {
    return "HOLD — current/future outcome; do not patch from projection.";
  }

  if (/unknown-team|unknown-undisclosed|packers-involving|unknown-team/i.test(`${row.slug} ${JSON.stringify(row.grades)} ${assets}`)) {
    return "STRUCTURE FIRST — malformed/unknown team key or slug.";
  }

  if (b && b.value >= gradeValue("A-") && /Hall of Fame|All-Pro|Pro Bowl|franchise quarterback|MVP/i.test(evidence + " " + assets)) {
    return "LIKELY COPY/DETECTOR ISSUE — strong grade already exists somewhere; verify side before touching grades.";
  }

  if (w && w.value <= gradeValue("D+") && /starter|played|seasons|yards|touchdowns|sacks|1st-round pick|overall/i.test(evidence + " " + assets)) {
    return "POSSIBLE PATCH — low-graded side has outcome signal; inspect side ownership and body copy.";
  }

  if (b && b.value <= gradeValue("C+")) {
    return "POSSIBLE PATCH — no side has a strong grade despite notable asset signal.";
  }

  return "MANUAL REVIEW — not safe enough for automatic patch.";
}

const enriched = rows.map(r => ({
  ...r,
  assetsFlat: assetsByTeam(r),
  recommendation: recommend(r),
  bestGrade: bestGrade(r.grades),
  worstGrade: worstGrade(r.grades),
  summary: r.publicCopy?.summary || "",
  partnerSummary: r.publicCopy?.partnerSummary || "",
  analysis: r.publicCopy?.analysis || ""
}));

const buckets = {};
for (const r of enriched) {
  const key = r.recommendation.split(" — ")[0];
  buckets[key] ||= [];
  buckets[key].push(r);
}

const out = {
  generatedAt: new Date().toISOString(),
  sourcePack: latestPack,
  count: enriched.length,
  bucketCounts: Object.fromEntries(Object.entries(buckets).map(([k,v]) => [k, v.length])),
  rows: enriched
};

const jsonPath = path.join(REPORT_DIR, `manual-side-verification-sheet-${RUN_ID}.json`);
const mdPath = path.join(REPORT_DIR, `manual-side-verification-sheet-${RUN_ID}.md`);
const csvPath = path.join(REPORT_DIR, `manual-side-verification-sheet-${RUN_ID}.csv`);

fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

function cell(v, n = 340) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

function table(list, limit = 100) {
  return [
    "| Rank | ID | Year | Grades | Recommendation | Evidence | Assets Received | Summary |",
    "|---:|---|---:|---|---|---|---|---|",
    ...list.slice(0, limit).map(r =>
      `| ${r.rank} | ${cell(r.id)} | ${cell(r.year || "")} | ${cell(JSON.stringify(r.grades), 180)} | ${cell(r.recommendation)} | ${cell((r.candidateEvidence || []).join(", "), 220)} | ${cell((r.assetsFlat || []).join(" / "), 420)} | ${cell(r.summary || r.analysis || r.partnerSummary, 420)} |`
    )
  ].join("\n");
}

fs.writeFileSync(mdPath, [
  "# Manual Side Verification Sheet",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Source pack: ${latestPack}`,
  `Rows: ${enriched.length}`,
  "",
  "## Bucket Counts",
  "",
  "| Recommendation | Count |",
  "|---|---:|",
  ...Object.entries(out.bucketCounts).map(([k,v]) => `| ${k} | ${v} |`),
  "",
  "## All Rows",
  "",
  table(enriched, 100),
  "",
  "## Possible Patches",
  "",
  table(enriched.filter(r => r.recommendation.startsWith("POSSIBLE PATCH")), 100),
  "",
  "## Likely Copy / Detector Issues",
  "",
  table(enriched.filter(r => r.recommendation.startsWith("LIKELY COPY")), 100),
  "",
  "## Structure First",
  "",
  table(enriched.filter(r => r.recommendation.startsWith("STRUCTURE FIRST")), 100),
  "",
  "## Holds",
  "",
  table(enriched.filter(r => r.recommendation.startsWith("HOLD")), 100)
].join("\n"));

const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
fs.writeFileSync(csvPath, [
  ["rank","id","slug","year","grades","recommendation","evidence","assetsReceived","summary","partnerSummary","analysis"].map(esc).join(","),
  ...enriched.map(r => [
    r.rank,
    r.id,
    r.slug,
    r.year || "",
    JSON.stringify(r.grades),
    r.recommendation,
    (r.candidateEvidence || []).join("; "),
    (r.assetsFlat || []).join(" / "),
    r.summary,
    r.partnerSummary,
    r.analysis
  ].map(esc).join(","))
].join("\n"));

console.log(`\nManual side verification sheet created.`);
console.log(`Source pack: ${latestPack}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${csvPath}`);
console.log(`- ${mdPath}\n`);

console.log("Recommendation counts:");
console.table(out.bucketCounts);

console.log("\nPossible patches:");
console.table(enriched.filter(r => r.recommendation.startsWith("POSSIBLE PATCH")).slice(0, 30).map(r => ({
  rank: r.rank,
  id: r.id,
  year: r.year,
  grades: JSON.stringify(r.grades),
  recommendation: r.recommendation,
  evidence: (r.candidateEvidence || []).join(", ").slice(0, 90),
  assets: (r.assetsFlat || []).join(" / ").slice(0, 140)
})));

console.log("\nLikely copy/detector issues:");
console.table(enriched.filter(r => r.recommendation.startsWith("LIKELY COPY")).slice(0, 30).map(r => ({
  rank: r.rank,
  id: r.id,
  year: r.year,
  grades: JSON.stringify(r.grades),
  recommendation: r.recommendation,
  evidence: (r.candidateEvidence || []).join(", ").slice(0, 90),
  assets: (r.assetsFlat || []).join(" / ").slice(0, 140)
})));

console.log("\nStructure/hold rows:");
console.table(enriched.filter(r => r.recommendation.startsWith("STRUCTURE") || r.recommendation.startsWith("HOLD")).slice(0, 30).map(r => ({
  rank: r.rank,
  id: r.id,
  year: r.year,
  grades: JSON.stringify(r.grades),
  recommendation: r.recommendation,
  evidence: (r.candidateEvidence || []).join(", ").slice(0, 90)
})));
