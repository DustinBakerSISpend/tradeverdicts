const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "audit-fuzzy-player-duplicate-pages.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

const knownNeedles = [
  "cardinals-1973-04-24-houston-oilers-tennessee-titans-jim-tolbert-mike-mcgill-jim-hargrove",
  "mike-mcgill-arizona-st-louis-cardinals-1973"
];

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || "";
}

function yearOf(t) {
  const m = String(dateOf(t) || slugOf(t)).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : "";
}

function parseDate(t) {
  const d = String(dateOf(t) || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const x = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(x.getTime()) ? null : x;
}

function dateGapDays(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return null;
  return Math.abs((da.getTime() - db.getTime()) / 86400000);
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const teamWordBlacklist = new Set([
  "arizona", "st", "louis", "cardinals",
  "houston", "oilers", "tennessee", "titans",
  "new", "york", "giants", "jets",
  "green", "bay", "packers",
  "san", "francisco", "49ers",
  "los", "angeles", "rams", "raiders", "chargers",
  "las", "vegas",
  "minnesota", "vikings",
  "atlanta", "falcons",
  "washington", "commanders", "redskins",
  "philadelphia", "eagles",
  "dallas", "cowboys",
  "denver", "broncos",
  "cleveland", "browns",
  "cincinnati", "bengals",
  "carolina", "panthers",
  "miami", "dolphins",
  "chicago", "bears",
  "detroit", "lions",
  "pittsburgh", "steelers",
  "buffalo", "bills",
  "new", "england", "patriots",
  "new", "orleans", "saints",
  "seattle", "seahawks",
  "kansas", "city", "chiefs",
  "indianapolis", "colts",
  "baltimore", "ravens",
  "tampa", "bay", "buccaneers",
  "jacksonville", "jaguars"
]);

const nonNameWords = new Set([
  "draft", "pick", "round", "overall", "subsequently", "traded",
  "cash", "consideration", "considerations", "rights", "conditional",
  "undisclosed", "unknown", "source", "status", "trade", "acquired",
  "sent", "from", "for", "and", "or", "the", "with", "future",
  "rounder", "selection", "compensation", "player", "details",
  "unavailable", "data", "public", "completeness", "reviewed",
  "retained", "ready", "provisional"
]);

function isBadNameKey(key) {
  const words = norm(key).split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return true;
  if (words.some(w => nonNameWords.has(w))) return true;

  // Do not allow obvious team/city names to become fake player keys.
  const teamWordCount = words.filter(w => teamWordBlacklist.has(w)).length;
  if (teamWordCount >= Math.min(2, words.length)) return true;

  // Avoid all-numeric or pick-ish keys.
  if (words.some(w => /^\d+$/.test(w))) return true;

  return false;
}

function keyName(s) {
  const cleaned = norm(String(s || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bJr\.?\b/g, " Jr")
    .replace(/\bSr\.?\b/g, " Sr"));

  const words = cleaned
    .split(" ")
    .filter(Boolean)
    .filter(w => !["jr", "sr", "ii", "iii", "iv", "v"].includes(w));

  const key = words.join(" ").trim();
  if (!key || isBadNameKey(key)) return null;
  return key;
}

function splitPlayerAsset(asset) {
  return String(asset || "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+and\s+|,|;|\//gi)
    .map(s => s.trim())
    .filter(Boolean);
}

function blob(t) {
  return [
    t.id,
    t.slug,
    t.tradeDate,
    t.date,
    t.summary,
    t.qaNotes,
    JSON.stringify(t.teams || []),
    JSON.stringify(t.assetsReceived || {})
  ].join(" ");
}

function extractCapitalizedNames(text) {
  const found = new Set();
  const s = String(text || "");

  const re = /\b[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?(?:\s+(?:[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?|[A-Z]\.)){1,3}\b/g;
  let m;

  while ((m = re.exec(s))) {
    const key = keyName(m[0]);
    if (key) found.add(key);
  }

  return [...found];
}

function slugNameBigrams(slug) {
  const tokens = norm(slug)
    .split(" ")
    .filter(Boolean)
    .filter(w => !nonNameWords.has(w))
    .filter(w => !teamWordBlacklist.has(w))
    .filter(w => !/^\d+$/.test(w));

  const found = new Set();

  for (let i = 0; i < tokens.length - 1; i++) {
    const key = keyName(`${tokens[i]} ${tokens[i + 1]}`);
    if (key) found.add(key);
  }

  return [...found];
}

function extractPlayers(t) {
  const players = new Set();

  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;

    for (const item of assets) {
      const asset = String(item.asset || "");
      const type = String(item.type || "").toLowerCase();

      if (type === "player") {
        for (const part of splitPlayerAsset(asset)) {
          const key = keyName(part);
          if (key) players.add(key);
        }
      }
    }
  }

  for (const key of extractCapitalizedNames(blob(t))) players.add(key);
  for (const key of slugNameBigrams(slugOf(t))) players.add(key);

  return [...players].sort();
}

function extractPickSigs(t) {
  const sigs = [];
  const text = JSON.stringify(t.assetsReceived || {});

  const re = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)\s+round\s+pick\s+\((\d+)(?:st|nd|rd|th)?\s+overall/gi;
  let m;

  while ((m = re.exec(text))) {
    sigs.push(`${m[1]}-R${Number(m[2])}-P${Number(m[3])}`);
  }

  return [...new Set(sigs)].sort();
}

function overlap(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  return [...A].filter(x => B.has(x));
}

function isSubset(a, b) {
  if (!a.length || !b.length) return false;
  const B = new Set(b);
  return a.every(x => B.has(x));
}

function compact(t) {
  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    year: yearOf(t),
    teams: t.teams || [],
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    players: extractPlayers(t),
    pickSigs: extractPickSigs(t),
    summary: t.summary || null,
    assetsReceived: t.assetsReceived || null
  };
}

function completenessScore(c) {
  let score = 0;
  score += c.players.length * 10;
  score += c.pickSigs.length * 4;
  score += Object.keys(c.assetsReceived || {}).length * 3;
  score += String(c.summary || "").length / 80;
  if (c.publishStatus === "ready") score += 2;
  if (c.slug.split("-").length > 8) score += 2;
  return score;
}

function findNeedleMatches(needle) {
  const n = norm(needle);
  return trades
    .filter(t => norm(slugOf(t)).includes(n) || n.includes(norm(slugOf(t))) || norm(blob(t)).includes(n))
    .map(compact);
}

const active = trades.filter(t => t.suppressed !== true);

const knownMatches = knownNeedles.map(needle => ({
  needle,
  matches: findNeedleMatches(needle)
}));

const knownFlat = knownMatches.flatMap(x => x.matches);
const knownSlugsFound = new Set(knownFlat.map(x => x.slug));

const candidatePairs = [];

for (let i = 0; i < active.length; i++) {
  const a = compact(active[i]);
  if (!a.year || a.players.length === 0) continue;

  for (let j = i + 1; j < active.length; j++) {
    const b = compact(active[j]);
    if (!b.year || b.players.length === 0) continue;
    if (a.year !== b.year) continue;

    const teamOverlap = overlap(a.teams, b.teams);
    const playerOverlap = overlap(a.players, b.players);
    if (playerOverlap.length === 0) continue;

    const gap = dateGapDays(active[i], active[j]);
    const exactDate = a.tradeDate && b.tradeDate && a.tradeDate === b.tradeDate;
    const nearDate = gap !== null && gap <= 14;
    const knownMatch = knownSlugsFound.has(a.slug) || knownSlugsFound.has(b.slug);

    const exactTeamSet =
      JSON.stringify([...a.teams].sort()) === JSON.stringify([...b.teams].sort());

    const exactPlayerSet =
      JSON.stringify([...a.players].sort()) === JSON.stringify([...b.players].sort());

    const aSubsetB = isSubset(a.players, b.players);
    const bSubsetA = isSubset(b.players, a.players);

    // Broader than the old audit, but still filters noise.
    const include =
      knownMatch ||
      (exactDate && teamOverlap.length >= 1) ||
      (nearDate && teamOverlap.length >= 1 && (aSubsetB || bSubsetA || playerOverlap.length >= 1)) ||
      (teamOverlap.length >= 2 && (aSubsetB || bSubsetA)) ||
      (playerOverlap.length >= 2 && (nearDate || teamOverlap.length >= 1));

    if (!include) continue;

    const aScore = completenessScore(a);
    const bScore = completenessScore(b);

    let classification = "review-player-overlap-possible-duplicate";
    let confidence = "review";

    if (knownMatch) {
      classification = "known-example-match";
      confidence = "known";
    } else if (exactDate && exactTeamSet && (exactPlayerSet || aSubsetB || bSubsetA)) {
      classification = "same-date-same-team-player-duplicate";
      confidence = "high";
    } else if (nearDate && teamOverlap.length >= 1 && (aSubsetB || bSubsetA)) {
      classification = "near-date-subset-player-duplicate";
      confidence = "high";
    } else if (exactDate && teamOverlap.length >= 1 && playerOverlap.length >= 1) {
      classification = "same-date-shared-player-review";
      confidence = "medium";
    } else if (nearDate && teamOverlap.length >= 1 && playerOverlap.length >= 1) {
      classification = "near-date-shared-player-review";
      confidence = "medium";
    }

    const recommendedKeeper = aScore >= bScore ? a : b;
    const recommendedSuppress = aScore >= bScore ? b : a;

    candidatePairs.push({
      classification,
      confidence,
      knownMatch,
      year: a.year,
      dateGapDays: gap,
      exactDate,
      exactTeamSet,
      teamOverlap,
      playerOverlap,
      scores: {
        a: Number(aScore.toFixed(2)),
        b: Number(bScore.toFixed(2))
      },
      recommendedKeeper: {
        slug: recommendedKeeper.slug,
        id: recommendedKeeper.id
      },
      recommendedSuppress: {
        slug: recommendedSuppress.slug,
        id: recommendedSuppress.id
      },
      a,
      b
    });
  }
}

candidatePairs.sort((x, y) => {
  const rank = { known: 4, high: 3, medium: 2, review: 1 };
  if (rank[y.confidence] !== rank[x.confidence]) return rank[y.confidence] - rank[x.confidence];
  if ((y.knownMatch ? 1 : 0) !== (x.knownMatch ? 1 : 0)) return (y.knownMatch ? 1 : 0) - (x.knownMatch ? 1 : 0);
  if (y.playerOverlap.length !== x.playerOverlap.length) return y.playerOverlap.length - x.playerOverlap.length;
  const gx = x.dateGapDays ?? 9999;
  const gy = y.dateGapDays ?? 9999;
  return gx - gy;
});

const byConfidence = candidatePairs.reduce((acc, p) => {
  acc[p.confidence] = (acc[p.confidence] || 0) + 1;
  return acc;
}, {});

const report = {
  generatedAt: new Date().toISOString(),
  activeTradesScanned: active.length,
  knownNeedles,
  knownMatches,
  candidatePairCount: candidatePairs.length,
  byConfidence,
  candidates: candidatePairs
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("AUDIT FUZZY PLAYER DUPLICATE PAGES");
console.log("=".repeat(80));
console.log(`active trades scanned: ${active.length}`);
console.log(`candidate pairs: ${candidatePairs.length}`);
console.log(`by confidence: ${JSON.stringify(byConfidence)}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Known example search:");
for (const km of knownMatches) {
  console.log("-".repeat(80));
  console.log(`needle=${km.needle}`);
  console.log(`matches=${km.matches.length}`);
  for (const row of km.matches.slice(0, 10)) {
    console.log(`  ${row.slug} | ${row.id} | ${row.tradeDate} | status=${row.publishStatus} | suppressed=${row.suppressed}`);
    console.log(`    teams=${JSON.stringify(row.teams)}`);
    console.log(`    players=${JSON.stringify(row.players)}`);
    console.log(`    summary=${row.summary || "(none)"}`);
  }
}

console.log("");
console.log("Top duplicate candidates:");
for (const p of candidatePairs.slice(0, 80)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${p.classification} | confidence=${p.confidence} | knownMatch=${p.knownMatch}`);
  console.log(`year=${p.year} | dateGapDays=${p.dateGapDays} | exactDate=${p.exactDate} | teamOverlap=${JSON.stringify(p.teamOverlap)} | playerOverlap=${JSON.stringify(p.playerOverlap)}`);
  console.log(`KEEP? ${p.recommendedKeeper.slug} | ${p.recommendedKeeper.id}`);
  console.log(`SUPPRESS? ${p.recommendedSuppress.slug} | ${p.recommendedSuppress.id}`);
  console.log(`A: ${p.a.slug} | ${p.a.id} | ${p.a.tradeDate} | teams=${JSON.stringify(p.a.teams)} | players=${JSON.stringify(p.a.players)} | score=${p.scores.a}`);
  console.log(`B: ${p.b.slug} | ${p.b.id} | ${p.b.tradeDate} | teams=${JSON.stringify(p.b.teams)} | players=${JSON.stringify(p.b.players)} | score=${p.scores.b}`);
}
