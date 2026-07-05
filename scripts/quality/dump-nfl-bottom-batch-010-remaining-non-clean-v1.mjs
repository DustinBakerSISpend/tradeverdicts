import fs from "node:fs";
import path from "node:path";

const label = "010";
const previewPath = `reports/quality/nfl-bottom-batch-${label}-repair-preview-v1.json`;
const dataPath = "src/data/nfl/trades.json";
const outJson = `reports/quality/nfl-bottom-batch-${label}-remaining-non-clean-v1.json`;
const outTxt = `reports/quality/nfl-bottom-batch-${label}-remaining-non-clean-v1.txt`;

const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const lanes = new Set(["copy_repair_candidate", "structural_hold", "grade_verdict_review"]);

function collect(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;

  if (lanes.has(node.lane) && node.id) out.push(node);

  for (const value of Object.values(node)) collect(value, out);
  return out;
}

function oneLine(v, n = 260) {
  return String(v || "").replace(/\s+/g, " ").slice(0, n);
}

const found = collect(preview);
const byLane = {};
for (const r of found) {
  byLane[r.lane] ||= [];
  const t = trades.find(x => x.id === r.id);
  byLane[r.lane].push({
    ...r,
    current: t ? {
      teams: t.teams,
      sourceTeams: t.sourceTeams,
      assetsReceived: t.assetsReceived,
      summary: oneLine(t.summary),
      partnerSummary: oneLine(t.partnerSummary),
      analysis: oneLine(t.analysis),
      perspectiveCount: Array.isArray(t.perspectives) ? t.perspectives.length : 0,
      perspectives: Array.isArray(t.perspectives)
        ? t.perspectives.map((p, i) => ({
            n: i + 1,
            primaryTeam: p.primaryTeam,
            partnerTeam: p.partnerTeam,
            primaryGrade: p.primaryGrade,
            partnerGrade: p.partnerGrade,
            verdict: p.verdict,
            primarySummary: oneLine(p.primarySummary),
            partnerSummary: oneLine(p.partnerSummary),
            publishStatus: p.publishStatus
          }))
        : []
    } : null
  });
}

const counts = Object.fromEntries(Object.entries(byLane).map(([k, v]) => [k, v.length]));

fs.writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), counts, byLane }, null, 2) + "\n");

let txt = `# NFL Bottom Batch ${label} Remaining Non-Clean v1\n\n`;
txt += `Generated: ${new Date().toISOString()}\n\n`;
txt += `## Counts\n`;
for (const [lane, count] of Object.entries(counts)) txt += `- ${lane}: ${count}\n`;

for (const lane of ["copy_repair_candidate", "grade_verdict_review", "structural_hold"]) {
  txt += `\n## ${lane}\n`;
  for (const r of byLane[lane] || []) {
    txt += `\n### ${r.id}\n`;
    txt += `- index: ${r.index}\n`;
    txt += `- slug: ${r.slug}\n`;
    txt += `- verdict: ${r.verdict}\n`;
    txt += `- grades: ${JSON.stringify(r.grades)}\n`;
    txt += `- preview perspectives: ${r.perspectives}\n`;
    txt += `- current teams: ${JSON.stringify(r.current?.teams)}\n`;
    txt += `- sourceTeams: ${JSON.stringify(r.current?.sourceTeams)}\n`;
    txt += `- current perspectiveCount: ${r.current?.perspectiveCount}\n`;
    txt += `- summary: ${r.current?.summary || ""}\n`;
    txt += `- partnerSummary: ${r.current?.partnerSummary || ""}\n`;
    txt += `- analysis: ${r.current?.analysis || ""}\n`;
    if (r.current?.perspectives?.length) {
      txt += `- perspectives:\n`;
      for (const p of r.current.perspectives) {
        txt += `  - #${p.n}: ${p.primaryTeam} vs ${p.partnerTeam}; grades ${p.primaryGrade}/${p.partnerGrade}; verdict ${p.verdict}; status ${p.publishStatus}\n`;
        txt += `    primarySummary: ${p.primarySummary}\n`;
        txt += `    partnerSummary: ${p.partnerSummary}\n`;
      }
    }
  }
}

fs.writeFileSync(outTxt, txt);
console.log(`Wrote ${found.length} remaining non-clean records.`);
console.log(outTxt);
