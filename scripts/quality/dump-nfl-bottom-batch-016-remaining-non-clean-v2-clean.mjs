import fs from "node:fs";

const label = "016";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-remaining-non-clean-v2-clean.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-remaining-non-clean-v2-clean.json`;

const ids = [
  "CHI-2004-0426",
  "RAI-2004-0314",
  "PIT-2004-0335",
  "DEN-2004-09-24-0278",
  "DEN-2005-03-03-0279",
  "SEA-2005-03-07-0123",
  "DEN-2005-03-18-0280",
  "NYJ-2005-0189",
  "DEN-2005-04-20-0281",
  "RAI-2005-0321",
  "DEN-2005-05-19-0282",
  "DEN-2005-07-15-0283",
  "JAX-2005-0028",
  "MIN-2005-09-03-0210",
  "MIN-2005-0204",
  "DEN-2006-04-19-0285",
  "DEN-2006-04-29-0287",
  "MIN-2006-04-29-0213"
];

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

function oneLine(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function pretty(v) {
  return JSON.stringify(v, null, 2);
}

const rows = ids.map(id => {
  const t = trades.find(x => x.id === id);
  return {
    id,
    found: !!t,
    slug: t?.slug,
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

for (const r of rows) {
  lines.push("=".repeat(90));
  lines.push(`ID: ${r.id}`);
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

fs.writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2) + "\n");
fs.writeFileSync(outTxt, lines.join("\r\n") + "\r\n");

console.log(`Wrote clean TXT: ${outTxt}`);
console.log(`Wrote clean JSON: ${outJson}`);
console.log(`Found ${rows.filter(r => r.found).length}/${ids.length}`);
