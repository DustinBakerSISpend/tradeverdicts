const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "audit-fast-player-duplicate-pages.json");

console.log("Loading trades...");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

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

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const nonName = new Set([
  "draft","pick","round","overall","subsequently","traded","cash","consideration","considerations",
  "rights","conditional","undisclosed","unknown","source","status","trade","acquired","sent","from",
  "for","and","or","the","with","future","rounder","selection","compensation","player","details",
  "unavailable","data","public","completeness","reviewed","retained","ready","provisional"
]);

const teamWords = new Set([
  "arizona","cardinals","houston","oilers","tennessee","titans","new","york","giants","jets",
  "green","bay","packers","san","francisco","49ers","los","angeles","rams","raiders","las","vegas",
  "minnesota","vikings","atlanta","falcons","washington","commanders","redskins","philadelphia",
  "eagles","dallas","cowboys","denver","broncos","cleveland","browns","cincinnati","bengals",
  "carolina","panthers","miami","dolphins","chicago","bears","detroit","lions","pittsburgh",
  "steelers","buffalo","bills","england","patriots","orleans","saints","seattle","seahawks",
  "kansas","city","chiefs","indianapolis","colts","baltimore","ravens","tampa","buccaneers",
  "jacksonville","jaguars","st","louis"
]);

function goodNameKey(key) {
  const words = norm(key).split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;
  if (words.some(w => nonName.has(w))) return null;
  if (words.every(w => teamWords.has(w))) return null;
  if (words.some(w => /^\d+$/.test(w))) return null;
  return words.join(" ");
}

function splitPlayerText(asset) {
  return String(asset || "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+and\s+|,|;|\//gi)
    .map(s => s.trim())
    .filter(Boolean);
}

function slugBigrams(slug) {
  const tokens = norm(slug)
    .split(" ")
    .filter(Boolean)
    .filter(w => !nonName.has(w))
    .filter(w => !teamWords.has(w))
    .filter(w => !/^\d+$/.test(w));

  const out = new Set();

  for (let i = 0; i < tokens.length - 1; i++) {
    const key = goodNameKey(`${tokens[i]} ${tokens[i + 1]}`);
    if (key) out.add(key);
  }

  return [...out];
}

function extractPlayers(t) {
  const out = new Set();

  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;

    for (const item of assets) {
      const type = String(item.type || "").toLowerCase();
      const asset = String(item.asset || "");

      if (type === "player") {
        for (const part of splitPlayerText(asset)) {
          const key = goodNameKey(part);
          if (key) out.add(key);
        }
      }
    }
  }

  for (const key of slugBigrams(slugOf(t))) out.add(key);

  return [...out].sort();
}

function pickSigs(t) {
  const text = JSON.stringify(t.assetsReceived || {});
  const out = new Set();
  const re = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)\s+round\s+pick\s+\((\d+)(?:st|nd|rd|th)?\s+overall/gi;
  let m;

  while ((m = re.exec(text))) {
    out.add(`${m[1]}-R${Number(m[2])}-P${Number(m[3])}`);
  }

  return [...out].sort();
}

function overlap(a, b) {
  const B = new Set(b);
  return a.filter(x => B.has(x));
}

function isSubset(a, b) {
  if (!a.length || !b.length) return false;
  const B = new Set(b);
  return a.every(x => B.has(x));
}

function daysApart(a, b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.tradeDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(b.tradeDate || "")) return null;
  return Math.abs((new Date(a.tradeDate + "T00:00:00Z") - new Date(b.tradeDate + "T00:00:00Z")) / 86400000);
}

function score(r) {
  let s = 0;
  s += r.players.length * 10;
  s += r.pickSigs.length * 4;
  s += Object.keys(r.assetsReceived || {}).length * 3;
  s += String(r.summary || "").length / 80;
  if (r.publishStatus === "ready") s += 2;
  if (r.slug.split("-").length > 8) s += 2;
  return s;
}

console.log("Precomputing active rows...");

const rows = trades
  .filter(t => t.suppressed !== true)
  .map((t, idx) => ({
    idx,
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    year: yearOf(t),
    teams: t.teams || [],
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    players: extractPlayers(t),
    pickSigs: pickSigs(t),
    assetsReceived: t.assetsReceived || {},
    summary: t.summary || null
  }))
  .filter(r => r.year && r.players.length);

console.log(`Active player rows: ${rows.length}`);

const byPlayerYear = new Map();

for (const r of rows) {
  for (const p of r.players) {
    const key = `${r.year}::${p}`;
    if (!byPlayerYear.has(key)) byPlayerYear.set(key, []);
    byPlayerYear.get(key).push(r);
  }
}

console.log(`Player/year keys: ${byPlayerYear.size}`);
console.log("Comparing indexed candidates...");

const pairMap = new Map();

for (const [key, bucket] of byPlayerYear.entries()) {
  if (bucket.length < 2) continue;
  if (bucket.length > 25) continue; // avoid noisy generic bad keys

  for (let i = 0; i < bucket.length; i++) {
    for (let j = i + 1; j < bucket.length; j++) {
      const a = bucket[i];
      const b = bucket[j];
      const pairKey = [a.slug, b.slug].sort().join("||");

      if (!pairMap.has(pairKey)) {
        pairMap.set(pairKey, { a, b, sharedKeys: new Set() });
      }

      pairMap.get(pairKey).sharedKeys.add(key.split("::")[1]);
    }
  }
}

const candidates = [];

for (const p of pairMap.values()) {
  const a = p.a;
  const b = p.b;

  const playerOverlap = [...p.sharedKeys].sort();
  const teamOverlap = overlap(a.teams, b.teams);
  const gap = daysApart(a, b);
  const exactDate = a.tradeDate && b.tradeDate && a.tradeDate === b.tradeDate;
  const nearDate = gap !== null && gap <= 21;

  const aSubsetB = isSubset(a.players, b.players);
  const bSubsetA = isSubset(b.players, a.players);

  const knownMatch =
    a.slug.includes("mike-mcgill") ||
    b.slug.includes("mike-mcgill") ||
    a.slug.includes("jim-tolbert") ||
    b.slug.includes("jim-tolbert");

  const include =
    knownMatch ||
    (exactDate && teamOverlap.length >= 1) ||
    (nearDate && teamOverlap.length >= 1) ||
    (teamOverlap.length >= 2 && (aSubsetB || bSubsetA)) ||
    (playerOverlap.length >= 2 && (nearDate || teamOverlap.length >= 1));

  if (!include) continue;

  const aScore = score(a);
  const bScore = score(b);
  const keeper = aScore >= bScore ? a : b;
  const suppress = aScore >= bScore ? b : a;

  let confidence = "review";
  let classification = "player-overlap-review";

  if (knownMatch) {
    confidence = "known";
    classification = "known-mcgill-example";
  } else if (exactDate && teamOverlap.length >= 1 && (aSubsetB || bSubsetA || playerOverlap.length >= 2)) {
    confidence = "high";
    classification = "same-date-player-duplicate";
  } else if (nearDate && teamOverlap.length >= 1 && (aSubsetB || bSubsetA || playerOverlap.length >= 2)) {
    confidence = "medium";
    classification = "near-date-player-duplicate";
  }

  candidates.push({
    classification,
    confidence,
    knownMatch,
    year: a.year,
    dateGapDays: gap,
    exactDate,
    teamOverlap,
    playerOverlap,
    recommendedKeeper: { slug: keeper.slug, id: keeper.id },
    recommendedSuppress: { slug: suppress.slug, id: suppress.id },
    scores: { a: Number(aScore.toFixed(2)), b: Number(bScore.toFixed(2)) },
    a,
    b
  });
}

candidates.sort((x, y) => {
  const rank = { known: 4, high: 3, medium: 2, review: 1 };
  if (rank[y.confidence] !== rank[x.confidence]) return rank[y.confidence] - rank[x.confidence];
  if (y.playerOverlap.length !== x.playerOverlap.length) return y.playerOverlap.length - x.playerOverlap.length;
  return (x.dateGapDays ?? 9999) - (y.dateGapDays ?? 9999);
});

const knownRows = rows.filter(r =>
  r.slug.includes("mike-mcgill") ||
  r.slug.includes("jim-tolbert") ||
  JSON.stringify(r.assetsReceived).toLowerCase().includes("mike mcgill") ||
  JSON.stringify(r.assetsReceived).toLowerCase().includes("jim tolbert")
);

const byConfidence = candidates.reduce((acc, c) => {
  acc[c.confidence] = (acc[c.confidence] || 0) + 1;
  return acc;
}, {});

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  activePlayerRows: rows.length,
  playerYearKeys: byPlayerYear.size,
  knownRows,
  candidatePairCount: candidates.length,
  byConfidence,
  candidates
}, null, 2));

console.log("");
console.log("AUDIT FAST PLAYER DUPLICATE PAGES");
console.log("=".repeat(80));
console.log(`active player rows: ${rows.length}`);
console.log(`candidate pairs: ${candidates.length}`);
console.log(`by confidence: ${JSON.stringify(byConfidence)}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Known McGill/Tolbert rows:");
for (const r of knownRows.slice(0, 20)) {
  console.log("-".repeat(80));
  console.log(`${r.slug} | ${r.id} | ${r.tradeDate} | status=${r.publishStatus} | suppressed=${r.suppressed}`);
  console.log(`teams=${JSON.stringify(r.teams)}`);
  console.log(`players=${JSON.stringify(r.players)}`);
  console.log(`summary=${r.summary || "(none)"}`);
  console.log("assetsReceived:");
  console.dir(r.assetsReceived, { depth: null });
}

console.log("");
console.log("Top candidates:");
for (const c of candidates.slice(0, 50)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${c.classification} | confidence=${c.confidence} | known=${c.knownMatch}`);
  console.log(`year=${c.year} | dateGapDays=${c.dateGapDays} | exactDate=${c.exactDate}`);
  console.log(`teamOverlap=${JSON.stringify(c.teamOverlap)} | playerOverlap=${JSON.stringify(c.playerOverlap)}`);
  console.log(`KEEP? ${c.recommendedKeeper.slug} | ${c.recommendedKeeper.id}`);
  console.log(`SUPPRESS? ${c.recommendedSuppress.slug} | ${c.recommendedSuppress.id}`);
  console.log(`A: ${c.a.slug} | ${c.a.id} | ${c.a.tradeDate} | teams=${JSON.stringify(c.a.teams)} | score=${c.scores.a}`);
  console.log(`B: ${c.b.slug} | ${c.b.id} | ${c.b.tradeDate} | teams=${JSON.stringify(c.b.teams)} | score=${c.scores.b}`);
}
