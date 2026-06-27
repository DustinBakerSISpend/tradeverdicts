const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "trade-page-duplicate-candidates.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || t.transactionDate || "";
}

function keysOf(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/houston oilers\/tennessee titans/g, "tennessee titans")
    .replace(/los angeles\/cleveland\/st\.? louis rams/g, "los angeles rams")
    .replace(/arizona\/st\.? louis cardinals/g, "arizona cardinals")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeam(team) {
  return normalizeText(team);
}

function assetRows(t) {
  const rows = [];
  const ar = t.assetsReceived || {};

  for (const team of keysOf(ar)) {
    const assets = Array.isArray(ar[team]) ? ar[team] : [];
    assets.forEach((item, index) => {
      rows.push({
        team,
        index,
        type: item && item.type ? item.type : null,
        asset: item && item.asset ? item.asset : ""
      });
    });
  }

  return rows;
}

function pickKeys(asset) {
  const text = String(asset || "");
  const keys = [];

  const rx1 = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)?\s+round pick\s*\((\d+)(?:st|nd|rd|th)?\s+overall/gi;
  let m;
  while ((m = rx1.exec(text))) {
    keys.push(`PICK:${m[1]}-${Number(m[2])}-${Number(m[3])}`);
  }

  const wordToRound = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12
  };

  const rx2 = /\b((?:19|20)\d{2})\s+([a-z]+)\s+round pick\s*\(#(\d+)/gi;
  while ((m = rx2.exec(text))) {
    const round = wordToRound[String(m[2]).toLowerCase()];
    if (round) keys.push(`PICK:${m[1]}-${round}-${Number(m[3])}`);
  }

  return [...new Set(keys)];
}

function assetSignature(row) {
  const n = normalizeText(row.asset);

  // Generic assets are too noisy by themselves.
  if (
    n === "cash" ||
    n === "1 cash" ||
    n === "draft pick" ||
    n === "undisclosed draft pick" ||
    n === "past considerations" ||
    n.includes("details unavailable from source data")
  ) {
    return [];
  }

  const keys = pickKeys(row.asset);
  if (keys.length) return keys;

  if (n.length >= 8) return [`ASSET:${n}`];

  return [];
}

function tradeFeatures(t) {
  const teams = Array.isArray(t.teams) ? t.teams.map(normalizeTeam).filter(Boolean).sort() : [];
  const rows = assetRows(t);

  const sigs = [];
  for (const row of rows) {
    for (const sig of assetSignature(row)) sigs.push(sig);
  }

  return {
    slug: slugOf(t),
    id: t.id || null,
    date: dateOf(t),
    season: t.season || null,
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed === true,
    teams,
    teamKeyCount: keysOf(t.assetsReceived).length,
    assetCount: rows.length,
    sigs: [...new Set(sigs)].sort(),
    assets: rows,
    verdict: t.verdict || null,
    grades: t.grades || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null
  };
}

function overlapScore(a, b) {
  const aSigs = new Set(a.sigs);
  const bSigs = new Set(b.sigs);
  const shared = [...aSigs].filter(x => bSigs.has(x));

  const aTeams = new Set(a.teams);
  const bTeams = new Set(b.teams);
  const sharedTeams = [...aTeams].filter(x => bTeams.has(x));

  const sameDate = a.date && b.date && a.date === b.date;
  const nearSameDate = a.date && b.date && a.date.slice(0, 7) === b.date.slice(0, 7);
  const sameTeamSet = a.teams.join("|") === b.teams.join("|");

  let score = 0;
  if (sameDate) score += 5;
  else if (nearSameDate) score += 2;

  score += shared.length * 4;
  score += sharedTeams.length * 2;

  if (sameTeamSet) score += 6;
  if (a.id && b.id && String(a.id).slice(0, 3) === String(b.id).slice(0, 3)) score += 1;

  // Heavily prioritize suspicious synthetic-looking rows.
  const uglySlug = /reviewed-and-retained|unknown|undisclosed|draft-pick-trade|cash|past-considerations|subsequently-traded/.test(a.slug + " " + b.slug);
  if (uglySlug) score += 2;

  return {
    score,
    sameDate,
    nearSameDate,
    sameTeamSet,
    shared,
    sharedTeams
  };
}

const active = trades
  .map(tradeFeatures)
  .filter(t => !t.suppressed);

const sigIndex = new Map();

for (const t of active) {
  for (const sig of t.sigs) {
    if (!sigIndex.has(sig)) sigIndex.set(sig, []);
    sigIndex.get(sig).push(t.slug);
  }
}

const slugToTrade = new Map(active.map(t => [t.slug, t]));
const candidatePairs = new Map();

function addPair(aSlug, bSlug) {
  if (!aSlug || !bSlug || aSlug === bSlug) return;
  const [x, y] = [aSlug, bSlug].sort();
  candidatePairs.set(`${x}|||${y}`, [x, y]);
}

// Pair by shared non-generic asset/pick signatures.
for (const slugs of sigIndex.values()) {
  if (slugs.length < 2 || slugs.length > 30) continue;
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      addPair(slugs[i], slugs[j]);
    }
  }
}

// Pair by exact same date plus overlapping teams, to catch generic/cash pages.
const byDate = new Map();
for (const t of active) {
  if (!t.date) continue;
  if (!byDate.has(t.date)) byDate.set(t.date, []);
  byDate.get(t.date).push(t.slug);
}

for (const slugs of byDate.values()) {
  if (slugs.length < 2 || slugs.length > 50) continue;

  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const a = slugToTrade.get(slugs[i]);
      const b = slugToTrade.get(slugs[j]);

      const sharedTeams = a.teams.filter(team => b.teams.includes(team));
      if (sharedTeams.length > 0) addPair(slugs[i], slugs[j]);
    }
  }
}

const rows = [];

for (const [aSlug, bSlug] of candidatePairs.values()) {
  const a = slugToTrade.get(aSlug);
  const b = slugToTrade.get(bSlug);
  const score = overlapScore(a, b);

  if (score.score < 8) continue;

  rows.push({
    score: score.score,
    sameDate: score.sameDate,
    nearSameDate: score.nearSameDate,
    sameTeamSet: score.sameTeamSet,
    sharedSignatureCount: score.shared.length,
    sharedTeamCount: score.sharedTeams.length,
    sharedSignatures: score.shared,
    sharedTeams: score.sharedTeams,
    a,
    b
  });
}

rows.sort((x, y) =>
  y.score - x.score ||
  y.sharedSignatureCount - x.sharedSignatureCount ||
  String(y.sameDate).localeCompare(String(x.sameDate)) ||
  x.a.date.localeCompare(y.a.date)
);

const topRows = rows.slice(0, 250);

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  activeTradeCount: active.length,
  candidatePairCount: rows.length,
  returnedPairCount: topRows.length,
  rows: topRows
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("TRADE-PAGE DUPLICATE CANDIDATE AUDIT");
console.log("=".repeat(80));
console.log(`Active trades scanned: ${active.length}`);
console.log(`Candidate duplicate/overlap pairs: ${rows.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Top 20 candidate pairs:");
for (const row of topRows.slice(0, 20)) {
  console.log("-".repeat(80));
  console.log(`score=${row.score} sameDate=${row.sameDate} sameTeamSet=${row.sameTeamSet} sharedSigs=${row.sharedSignatureCount} sharedTeams=${row.sharedTeamCount}`);
  console.log(`A: ${row.a.slug} | ${row.a.id} | ${row.a.date} | status=${row.a.publishStatus}`);
  console.log(`   teams=${JSON.stringify(row.a.teams)}`);
  console.log(`B: ${row.b.slug} | ${row.b.id} | ${row.b.date} | status=${row.b.publishStatus}`);
  console.log(`   teams=${JSON.stringify(row.b.teams)}`);
  console.log(`sharedTeams=${JSON.stringify(row.sharedTeams)}`);
  console.log(`sharedSignatures=${JSON.stringify(row.sharedSignatures.slice(0, 8))}`);
}
