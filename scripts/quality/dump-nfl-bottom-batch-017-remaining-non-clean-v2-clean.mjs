import fs from "node:fs";

const label = "017";
const previewPath = `reports/quality/nfl-bottom-batch-${label}-repair-preview-v1.json`;
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-remaining-non-clean-v2-clean.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-remaining-non-clean-v2-clean.json`;

const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const lanes = new Set(["grade_verdict_review", "structural_hold"]);

function walk(x, out = []) {
  if (Array.isArray(x)) {
    for (const item of x) walk(item, out);
    return out;
  }
  if (!x || typeof x !== "object") return out;
  if (x.id && lanes.has(x.lane)) out.push(x);
  for (const v of Object.values(x)) walk(v, out);
  return out;
}

function oneLine(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function pretty(v) {
  return JSON.stringify(v, null, 2);
}

const rowsFromPreview = walk(preview);
const ids = rowsFromPreview.map(r => r.id);

const rows = ids.map(id => {
  const r = rowsFromPreview.find(x => x.id === id);
  const t = trades.find(x => x.id === id);
  return {
    id,
    lane: r?.lane || "",
    index: r?.index ?? "",
    found: !!t,
    slug: t?.slug || r?.slug || "",
    teams: t?.teams,
    sourceTeams: t?.sourceTeams,
    verdict: t?.verdict,
    grades: t?.grades,
    assetsReceived: t?.assetsReceived,
    summary: oneLine(t?.summary),
    partnerSummary: oneLine(t?.partnerSummary),
    analysis: oneLine(t?.analysis),
    perspectiveCount: Array.isArray(t?.perspectives) ? t.perspectives.length : 0,
    perspectives: Array.isArray(t?.perspectives) ? t.perspectives.map((p, i) => ({
      n: i + 1,
      primaryTeam: p.primaryTeam,
      partnerTeam: p.partnerTeam,
      primaryGrade: p.primaryGrade,
      partnerGrade: p.partnerGrade,
      verdict: p.verdict,
      publishStatus: p.publishStatus,
      primarySummary: oneLine(p.primarySummary),
      partnerSummary: oneLine(p.partnerSummary)
    })) : []
  };
});

const lines = [];
lines.push(`# NFL Bottom Batch ${label} Remaining Non-Clean v2 Clean`);
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Targeted IDs: ${ids.length}`);
lines.push(`Found: ${rows.filter(r => r.found).length}`);
lines.push(`Missing: ${rows.filter(r => !r.found).length}`);
lines.push("");
lines.push(`## Counts`);
for (const lane of ["grade_verdict_review", "structural_hold"]) {
  lines.push(`- ${lane}: ${rows.filter(r => r.lane === lane).length}`);
}
lines.push("");

for (const r of rows) {
  lines.push("=".repeat(90));
  lines.push(`ID: ${r.id}`);
  lines.push(`Lane: ${r.lane}`);
  lines.push(`Index: ${r.index}`);
  lines.push(`Found: ${r.found}`);
  lines.push(`Slug: ${r.slug || ""}`);
  lines.push(`Teams: ${JSON.stringify(r.teams || [])}`);
  lines.push(`SourceTeams: ${JSON.stringify(r.sourceTeams || [])}`);
  lines.push(`Verdict: ${r.verdict || ""}`);
  lines.push(`Grades: ${JSON.stringify(r.grades || {})}`);
  lines.push(`PerspectiveCount: ${r.perspectiveCount}`);
  lines.push("");
  lines.push(`AssetsReceived:`);
  lines.push(pretty(r.assetsReceived || {}));
  lines.push("");
  lines.push(`Summary: ${r.summary || ""}`);
  lines.push("");
  lines.push(`PartnerSummary: ${r.partnerSummary || ""}`);
  lines.push("");
  lines.push(`Analysis: ${r.analysis || ""}`);
  lines.push("");
  lines.push(`Perspectives:`);
  for (const p of r.perspectives) {
    lines.push(`  #${p.n}`);
    lines.push(`  primaryTeam: ${p.primaryTeam || ""}`);
    lines.push(`  partnerTeam: ${p.partnerTeam || ""}`);
    lines.push(`  grades: ${p.primaryGrade || ""}/${p.partnerGrade || ""}`);
    lines.push(`  verdict: ${p.verdict || ""}`);
    lines.push(`  publishStatus: ${p.publishStatus || ""}`);
    lines.push(`  primarySummary: ${p.primarySummary || ""}`);
    lines.push(`  partnerSummary: ${p.partnerSummary || ""}`);
    lines.push("");
  }
  lines.push("");
}

fs.writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), counts: {
  grade_verdict_review: rows.filter(r => r.lane === "grade_verdict_review").length,
  structural_hold: rows.filter(r => r.lane === "structural_hold").length
}, rows }, null, 2) + "\n");

fs.writeFileSync(outTxt, lines.join("\r\n") + "\r\n");

console.log(`Wrote clean TXT: ${outTxt}`);
console.log(`Wrote clean JSON: ${outJson}`);
console.log(`Found ${rows.filter(r => r.found).length}/${ids.length}`);
console.log(`IDs: ${ids.join(", ")}`);
