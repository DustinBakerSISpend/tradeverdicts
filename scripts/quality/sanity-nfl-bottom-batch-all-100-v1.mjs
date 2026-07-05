import fs from "node:fs";

const arg = process.argv.find(a => /^\d+$/.test(a)) || process.argv[process.argv.indexOf("--bottom") + 1];
if (!arg || !/^\d+$/.test(arg)) {
  console.error("Usage: node scripts/quality/sanity-nfl-bottom-batch-all-100-v1.mjs --bottom 13");
  process.exit(1);
}

const label = String(arg).padStart(3, "0");
const dataPath = "src/data/nfl/trades.json";
const manifestPath = `reports/quality/nfl-bottom-batch-${label}-manifest.json`;
const outTxt = `reports/quality/nfl-bottom-batch-${label}-all-100-sanity-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-all-100-sanity-v1.json`;

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function collectIds(x, out = []) {
  if (Array.isArray(x)) {
    for (const item of x) collectIds(item, out);
    return out;
  }
  if (!x || typeof x !== "object") return out;
  if (typeof x.id === "string" && /^[A-Z]{2,4}-\d{4}/.test(x.id)) out.push(x.id);
  for (const v of Object.values(x)) collectIds(v, out);
  return out;
}

const ids = [...new Set(collectIds(manifest))];

const badPublic = /Partner-side|\bpartner side\b|\bpartner grade\b|\bPartner Win\b|\bPartner Even\b|\bpartner outcome\b|\btrade partner\b|\bpartner\b|same strict-hindsight value curve|same hindsight value curve|same value curve|hindsight value curve|hindsight curve|rebalanced curve|receives the edge|received the edge|Unknown\/undisclosed partner|Bears's|Jets's|Falcons's|Vikings's|Cardinals's|Patriots's|Raiders's|Titans's|Eagles's|Seahawks's|Chiefs's|Dolphins's|Rams's|Colts's|Broncos's|Ravens's|49ers's|Browns's/i;

function arr(x) { return Array.isArray(x) ? x : []; }
function keys(x) { return x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x) : []; }

function sameSet(a, b) {
  const aa = [...new Set(arr(a))].sort();
  const bb = [...new Set(arr(b))].sort();
  return JSON.stringify(aa) === JSON.stringify(bb);
}

function publicBlob(t) {
  return [
    t.summary,
    t.partnerSummary,
    t.analysis,
    ...arr(t.perspectives).flatMap(p => [p.primarySummary, p.partnerSummary])
  ].join("\n");
}

const rows = [];

for (const id of ids) {
  const t = trades.find(x => x.id === id);
  const issues = [];

  if (!t) {
    rows.push({ id, status: "quarantined_or_missing", issues: [] });
    continue;
  }

  const teams = arr(t.teams);
  const sourceTeams = arr(t.sourceTeams);
  const gradeTeams = keys(t.grades);
  const assetTeams = keys(t.assetsReceived);
  const perspectives = arr(t.perspectives);

  if (teams.length < 2) issues.push("fewer_than_two_teams");
  if (!sameSet(teams, sourceTeams)) issues.push("teams_sourceTeams_mismatch");
  if (!sameSet(teams, gradeTeams)) issues.push("teams_grades_mismatch");
  if (!sameSet(teams, assetTeams)) issues.push("teams_assetsReceived_mismatch");
  if (!t.verdict || /undefined|null/i.test(String(t.verdict))) issues.push("bad_top_level_verdict");
  if (badPublic.test(publicBlob(t))) issues.push("bad_public_language_or_artifact");

  const seenPairs = new Set();
  for (const [i, p] of perspectives.entries()) {
    const pair = `${p.primaryTeam}__${p.partnerTeam}`;
    if (seenPairs.has(pair)) issues.push(`duplicate_perspective_pair_${pair}`);
    seenPairs.add(pair);

    if (!teams.includes(p.primaryTeam)) issues.push(`perspective_${i + 1}_primaryTeam_not_in_teams`);
    if (!teams.includes(p.partnerTeam)) issues.push(`perspective_${i + 1}_partnerTeam_not_in_teams`);
    if (p.primaryTeam && t.grades?.[p.primaryTeam] && p.primaryGrade !== t.grades[p.primaryTeam]) issues.push(`perspective_${i + 1}_primaryGrade_mismatch`);
    if (p.partnerTeam && t.grades?.[p.partnerTeam] && p.partnerGrade !== t.grades[p.partnerTeam]) issues.push(`perspective_${i + 1}_partnerGrade_mismatch`);
    if (!p.verdict || /undefined|null/i.test(String(p.verdict))) issues.push(`perspective_${i + 1}_bad_verdict`);
    if (/provisional/i.test(String(p.publishStatus || ""))) issues.push(`perspective_${i + 1}_provisional_status`);
  }

  if (perspectives.length > teams.length) issues.push(`extra_perspectives_${perspectives.length}_for_${teams.length}_teams`);

  rows.push({
    id,
    slug: t.slug,
    status: issues.length ? "needs_review" : "sanity_clean",
    issues
  });
}

const counts = rows.reduce((m, r) => {
  m[r.status] = (m[r.status] || 0) + 1;
  return m;
}, {});

let txt = `# NFL Bottom Batch ${label} All-100 Sanity Sweep v1\n\n`;
txt += `Generated: ${new Date().toISOString()}\n\n`;
txt += `## Counts\n`;
txt += `- manifest_ids: ${ids.length}\n`;
for (const [k, v] of Object.entries(counts)) txt += `- ${k}: ${v}\n`;

txt += `\n## Needs Review\n`;
const bad = rows.filter(r => r.status === "needs_review");
if (!bad.length) txt += `- None\n`;
else for (const r of bad) txt += `- ${r.id}: ${r.issues.join(", ")}\n`;

fs.writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), counts, rows }, null, 2) + "\n");
fs.writeFileSync(outTxt, txt);

console.log(txt);
console.log(`Wrote: ${outTxt}`);

