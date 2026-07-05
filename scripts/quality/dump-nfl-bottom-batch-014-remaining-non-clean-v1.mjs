import fs from "node:fs";

const label = "014";
const previewPath = `reports/quality/nfl-bottom-batch-${label}-repair-preview-v1.json`;
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-remaining-non-clean-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-remaining-non-clean-v1.json`;

const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const lanes = new Set(["grade_verdict_review", "structural_hold", "copy_repair_candidate"]);

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

function short(v, n = 540) {
  return String(v || "").replace(/\s+/g, " ").slice(0, n);
}

const rows = walk(preview);
const byLane = {};
for (const r of rows) {
  byLane[r.lane] ||= [];
  const t = trades.find(x => x.id === r.id);

  byLane[r.lane].push({
    preview: r,
    current: t ? {
      id: t.id,
      slug: t.slug,
      teams: t.teams,
      sourceTeams: t.sourceTeams,
      verdict: t.verdict,
      grades: t.grades,
      assetsReceived: t.assetsReceived,
      summary: short(t.summary),
      partnerSummary: short(t.partnerSummary),
      analysis: short(t.analysis),
      perspectiveCount: Array.isArray(t.perspectives) ? t.perspectives.length : 0,
      perspectives: Array.isArray(t.perspectives) ? t.perspectives.map((p, i) => ({
        n: i + 1,
        primaryTeam: p.primaryTeam,
        partnerTeam: p.partnerTeam,
        primaryGrade: p.primaryGrade,
        partnerGrade: p.partnerGrade,
        verdict: p.verdict,
        publishStatus: p.publishStatus,
        primarySummary: short(p.primarySummary),
        partnerSummary: short(p.partnerSummary)
      })) : []
    } : null
  });
}

const counts = Object.fromEntries(Object.entries(byLane).map(([k, v]) => [k, v.length]));
fs.writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), counts, byLane }, null, 2) + "\n");

let txt = `# NFL Bottom Batch ${label} Remaining Non-Clean v1\n\n`;
txt += `Generated: ${new Date().toISOString()}\n\n`;
txt += `## Counts\n`;
for (const lane of ["grade_verdict_review", "structural_hold", "copy_repair_candidate"]) {
  txt += `- ${lane}: ${(byLane[lane] || []).length}\n`;
}

for (const lane of ["grade_verdict_review", "structural_hold", "copy_repair_candidate"]) {
  txt += `\n## ${lane}\n`;
  for (const row of byLane[lane] || []) {
    const r = row.preview;
    const t = row.current;
    txt += `\n### ${r.id}\n`;
    txt += `- index: ${r.index}\n`;
    txt += `- slug: ${r.slug}\n`;
    txt += `- preview verdict: ${r.verdict}\n`;
    txt += `- preview grades: ${JSON.stringify(r.grades)}\n`;
    txt += `- v2Classification: ${r.v2Classification || ""}\n`;
    txt += `- v3Class: ${r.v3Class || ""}\n`;
    txt += `- action: ${r.action || ""}\n`;
    txt += `- current teams: ${JSON.stringify(t?.teams)}\n`;
    txt += `- current sourceTeams: ${JSON.stringify(t?.sourceTeams)}\n`;
    txt += `- current verdict: ${t?.verdict}\n`;
    txt += `- current grades: ${JSON.stringify(t?.grades)}\n`;
    txt += `- perspectiveCount: ${t?.perspectiveCount}\n`;
    txt += `- summary: ${t?.summary || ""}\n`;
    txt += `- partnerSummary: ${t?.partnerSummary || ""}\n`;
    txt += `- analysis: ${t?.analysis || ""}\n`;
    txt += `- assetsReceived: ${JSON.stringify(t?.assetsReceived)}\n`;

    if (t?.perspectives?.length) {
      txt += `- perspectives:\n`;
      for (const p of t.perspectives) {
        txt += `  - #${p.n}: ${p.primaryTeam} vs ${p.partnerTeam}; grades ${p.primaryGrade}/${p.partnerGrade}; verdict ${p.verdict}; status ${p.publishStatus}\n`;
        txt += `    primarySummary: ${p.primarySummary}\n`;
        txt += `    partnerSummary: ${p.partnerSummary}\n`;
      }
    }

    if (r.v3Hits?.length) {
      txt += `- v3Hits:\n`;
      for (const h of r.v3Hits) txt += `  - ${h.key} ${h.path || ""}: ${short(h.sample, 300)}\n`;
    }
  }
}

fs.writeFileSync(outTxt, txt);
console.log(`Remaining non-clean records: ${rows.length}`);
console.log(`Counts: ${JSON.stringify(counts)}`);
console.log(`IDs: ${rows.map(r => r.id).join(", ")}`);
console.log(`Wrote: ${outTxt}`);
