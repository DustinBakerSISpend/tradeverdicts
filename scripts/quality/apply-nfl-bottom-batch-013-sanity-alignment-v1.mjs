import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "013";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-sanity-alignment-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-sanity-alignment-${apply ? "apply" : "dry-run"}-v1.json`;

const ids = [
  "PHI-2009-0324",
  "SEA-2009-04-26-0142",
  "NE-2009-0317",
  "NE-2009-0318",
  "MIA-2009-0232",
  "TB-2010-0210",
  "SEA-2010-03-16-0144",
  "PHI-2010-0331",
  "DET-2010-0342",
  "NE-2010-0325",
  "NE-2010-0328",
  "ATL-2010-0257",
  "SEA-2010-04-24-0148",
  "SEA-2010-08-17-0149"
];

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

function arr(x) { return Array.isArray(x) ? x : []; }
function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function cleanText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/Partner-side/gi, "Other-side")
    .replace(/\bpartner side\b/gi, "other side")
    .replace(/\bpartner grade\b/gi, "other-side grade")
    .replace(/\bPartner Win\b/g, "Reviewed win")
    .replace(/\bPartner Even\b/g, "Even")
    .replace(/\bpartner outcome\b/gi, "other-side outcome")
    .replace(/\btrade partner\b/gi, "other team")
    .replace(/\bpartner\b/gi, "other team")
    .replace(/same strict-hindsight value curve/gi, "same final review")
    .replace(/same hindsight value curve/gi, "same final review")
    .replace(/same value curve/gi, "same final review")
    .replace(/hindsight value curve/gi, "final review")
    .replace(/hindsight curve/gi, "final review")
    .replace(/rebalanced curve/gi, "reviewed grade split")
    .replace(/receives the edge/gi, "wins the review")
    .replace(/received the edge/gi, "won the review")
    .replace(/Browns's/g, "Browns'")
    .replace(/Seahawks's/g, "Seahawks'")
    .replace(/Patriots's/g, "Patriots'")
    .replace(/Eagles's/g, "Eagles'")
    .replace(/Falcons's/g, "Falcons'")
    .trim();
}

function normalizeTrade(t) {
  const next = JSON.parse(JSON.stringify(t));
  const changes = [];

  if (Array.isArray(next.teams) && !sameJson(next.sourceTeams, next.teams)) {
    next.sourceTeams = [...next.teams];
    changes.push("sourceTeams_aligned_to_teams");
  }

  next.summary = cleanText(next.summary);
  next.partnerSummary = cleanText(next.partnerSummary);
  next.analysis = cleanText(next.analysis);

  if (Array.isArray(next.perspectives)) {
    for (const [i, p] of next.perspectives.entries()) {
      const before = JSON.stringify(p);

      if (p.primaryTeam && next.grades?.[p.primaryTeam]) p.primaryGrade = next.grades[p.primaryTeam];
      if (p.partnerTeam && next.grades?.[p.partnerTeam]) p.partnerGrade = next.grades[p.partnerTeam];

      if (!p.verdict || /undefined|null/i.test(String(p.verdict))) p.verdict = next.verdict;
      if (/provisional/i.test(String(p.publishStatus || "")) || !p.publishStatus) p.publishStatus = "ready";

      p.primarySummary = cleanText(p.primarySummary);
      p.partnerSummary = cleanText(p.partnerSummary);

      if (JSON.stringify(p) !== before) changes.push(`perspective_${i + 1}_aligned`);
    }
  }

  return { next, changes: [...new Set(changes)] };
}

const results = [];
let changed = 0;
let blocked = 0;

for (const id of ids) {
  const t = trades.find(x => x.id === id);

  if (!t) {
    blocked++;
    results.push({ id, status: "blocked", reason: "missing from active trades.json" });
    continue;
  }

  const before = JSON.stringify(t);
  const { next, changes } = normalizeTrade(t);
  const after = JSON.stringify(next);

  if (before !== after) {
    changed++;
    if (apply) Object.assign(t, next);
    results.push({
      id,
      status: apply ? "applied" : "would_apply",
      changes
    });
  } else {
    results.push({ id, status: "no_change", changes: [] });
  }
}

let backup = "";
if (apply && changed) {
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-sanity-alignment-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Sanity Alignment ${apply ? "Apply" : "Dry Run"} v1\n\n`;
txt += `Generated: ${new Date().toISOString()}\n`;
txt += `Mode: ${apply ? "apply" : "dry-run"}\n\n`;
txt += `## Summary\n`;
txt += `- Targeted records: ${ids.length}\n`;
txt += `- Blocked records: ${blocked}\n`;
txt += `- Changed records: ${changed}\n`;
if (backup) txt += `- Backup created: ${backup}\n`;

txt += `\n## Status Counts\n`;
for (const [k, v] of Object.entries(counts)) txt += `- ${k}: ${v}\n`;

txt += `\n## Records\n`;
for (const r of results) {
  txt += `- ${r.id}: ${r.status}`;
  if (r.reason) txt += ` — ${r.reason}`;
  if (r.changes?.length) txt += ` — ${r.changes.join(", ")}`;
  txt += `\n`;
}

fs.writeFileSync(outJson, JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: apply ? "apply" : "dry-run",
  targeted: ids.length,
  blocked,
  changed,
  counts,
  results
}, null, 2) + "\n");

fs.writeFileSync(outTxt, txt);
console.log(txt);
console.log(`Wrote: ${outTxt}`);
