const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "audit-player-overlap-duplicate-pages.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const knownSlugs = [
  "cardinals-1973-04-24-houston-oilers-tennessee-titans-jim-tolbert-mike-mcgill-jim-hargrove",
  "mike-mcgill-arizona-st-louis-cardinals-1973"
];

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || "";
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPlayerName(s) {
  return String(s || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bsubsequently traded\b/gi, " ")
    .replace(/\bundisclosed\b/gi, " ")
    .replace(/\bconditional\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonPlayerAsset(s) {
  const x = norm(s);
  return (
    !x ||
    x.includes("draft pick") ||
    x.includes("round pick") ||
    x.includes("overall") ||
    x.includes("cash") ||
    x.includes("consideration") ||
    x.includes("compensation") ||
    x.includes("rights") ||
    x.includes("future") ||
    x.includes("not exercised") ||
    x.includes("undisclosed")
  );
}

function playerKey(name) {
  const x = norm(cleanPlayerName(name))
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = x.split(" ").filter(Boolean);

  if (words.length < 2 || words.length > 5) return null;
  if (words.some(w => ["draft", "pick", "cash", "round", "overall", "team", "unknown"].includes(w))) return null;

  return words.join(" ");
}

function splitPossiblePlayers(asset) {
  const raw = cleanPlayerName(asset);

  return raw
    .replace(/\s+\/\s+/g, " / ")
    .split(/\s+and\s+|,|;/gi)
    .flatMap(part => part.split(/\s+\/\s+/g))
    .map(s => s.trim())
    .filter(Boolean);
}

function extractPlayers(t) {
  const players = new Set();

  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;

    for (const item of assets) {
      const asset = String(item.asset || "");
      const type = String(item.type || "").toLowerCase();

      if (type !== "player" && isNonPlayerAsset(asset)) continue;

      for (const candidate of splitPossiblePlayers(asset)) {
        const key = playerKey(candidate);
        if (key) players.add(key);
      }
    }
  }

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
  return score;
}

const active = trades.filter(t => t.suppressed !== true);

const knownRows = knownSlugs.map(slug => {
  const t = trades.find(x => slugOf(x) === slug);
  return t ? compact(t) : { slug, missing: true };
});

const candidatePairs = [];

for (let i = 0; i < active.length; i++) {
  const a = compact(active[i]);
  if (!a.tradeDate || a.players.length === 0) continue;

  for (let j = i + 1; j < active.length; j++) {
    const b = compact(active[j]);
    if (!b.tradeDate || b.players.length === 0) continue;
    if (a.tradeDate !== b.tradeDate) continue;

    const teamOverlap = overlap(a.teams, b.teams);
    if (teamOverlap.length === 0) continue;

    const playerOverlap = overlap(a.players, b.players);
    if (playerOverlap.length === 0) continue;

    const exactTeamSet =
      JSON.stringify([...a.teams].sort()) === JSON.stringify([...b.teams].sort());

    const exactPlayerSet =
      JSON.stringify([...a.players].sort()) === JSON.stringify([...b.players].sort());

    const aSubsetB = isSubset(a.players, b.players);
    const bSubsetA = isSubset(b.players, a.players);

    const aScore = completenessScore(a);
    const bScore = completenessScore(b);

    let classification = "manual-shared-player-same-date";
    let confidence = "low";
    let recommendedKeeper = null;
    let recommendedSuppress = null;

    if (exactTeamSet && exactPlayerSet) {
      classification = "exact-player-duplicate";
      confidence = "high";
      recommendedKeeper = aScore >= bScore ? a : b;
      recommendedSuppress = aScore >= bScore ? b : a;
    } else if (exactTeamSet && (aSubsetB || bSubsetA)) {
      classification = "subset-player-duplicate-same-teams";
      confidence = "high";
      recommendedKeeper = aSubsetB ? b : a;
      recommendedSuppress = aSubsetB ? a : b;
    } else if (teamOverlap.length >= 2 && (aSubsetB || bSubsetA)) {
      classification = "subset-player-duplicate-overlap-teams";
      confidence = "medium";
      recommendedKeeper = aSubsetB ? b : a;
      recommendedSuppress = aSubsetB ? a : b;
    } else if (exactTeamSet && playerOverlap.length >= 1) {
      classification = "same-team-shared-player-review";
      confidence = "medium";
      recommendedKeeper = aScore >= bScore ? a : b;
      recommendedSuppress = aScore >= bScore ? b : a;
    }

    const knownMatch =
      knownSlugs.includes(a.slug) ||
      knownSlugs.includes(b.slug);

    if (
      confidence !== "low" ||
      knownMatch ||
      playerOverlap.length >= 2
    ) {
      candidatePairs.push({
        classification,
        confidence,
        knownMatch,
        sameDate: a.tradeDate,
        exactTeamSet,
        teamOverlap,
        playerOverlap,
        a,
        b,
        scores: {
          a: Number(aScore.toFixed(2)),
          b: Number(bScore.toFixed(2))
        },
        recommendedKeeper: recommendedKeeper ? {
          slug: recommendedKeeper.slug,
          id: recommendedKeeper.id
        } : null,
        recommendedSuppress: recommendedSuppress ? {
          slug: recommendedSuppress.slug,
          id: recommendedSuppress.id
        } : null
      });
    }
  }
}

candidatePairs.sort((x, y) => {
  const rank = { high: 3, medium: 2, low: 1 };
  if ((y.knownMatch ? 1 : 0) !== (x.knownMatch ? 1 : 0)) return (y.knownMatch ? 1 : 0) - (x.knownMatch ? 1 : 0);
  if (rank[y.confidence] !== rank[x.confidence]) return rank[y.confidence] - rank[x.confidence];
  if (y.playerOverlap.length !== x.playerOverlap.length) return y.playerOverlap.length - x.playerOverlap.length;
  return x.sameDate.localeCompare(y.sameDate);
});

const highConfidence = candidatePairs.filter(p => p.confidence === "high");
const mediumConfidence = candidatePairs.filter(p => p.confidence === "medium");

const report = {
  generatedAt: new Date().toISOString(),
  activeTradesScanned: active.length,
  knownExample: knownRows,
  candidatePairCount: candidatePairs.length,
  highConfidenceCount: highConfidence.length,
  mediumConfidenceCount: mediumConfidence.length,
  candidates: candidatePairs
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("AUDIT PLAYER-OVERLAP DUPLICATE PAGES");
console.log("=".repeat(80));
console.log(`active trades scanned: ${active.length}`);
console.log(`candidate pairs: ${candidatePairs.length}`);
console.log(`high confidence: ${highConfidence.length}`);
console.log(`medium confidence: ${mediumConfidence.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Known example rows:");
for (const row of knownRows) {
  console.log("-".repeat(80));
  if (row.missing) {
    console.log(`MISSING: ${row.slug}`);
    continue;
  }

  console.log(`${row.slug} | ${row.id} | ${row.tradeDate} | status=${row.publishStatus} | suppressed=${row.suppressed}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`players=${JSON.stringify(row.players)}`);
  console.log(`pickSigs=${JSON.stringify(row.pickSigs)}`);
  console.log(`summary=${row.summary || "(none)"}`);
  console.log("assetsReceived:");
  console.dir(row.assetsReceived, { depth: null });
}

console.log("");
console.log("Top duplicate candidates:");
for (const p of candidatePairs.slice(0, 60)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${p.classification} | confidence=${p.confidence} | knownMatch=${p.knownMatch}`);
  console.log(`date=${p.sameDate} | teamOverlap=${JSON.stringify(p.teamOverlap)} | playerOverlap=${JSON.stringify(p.playerOverlap)}`);
  console.log(`KEEP? ${p.recommendedKeeper ? `${p.recommendedKeeper.slug} | ${p.recommendedKeeper.id}` : "(manual)"}`);
  console.log(`SUPPRESS? ${p.recommendedSuppress ? `${p.recommendedSuppress.slug} | ${p.recommendedSuppress.id}` : "(manual)"}`);
  console.log(`A: ${p.a.slug} | ${p.a.id} | teams=${JSON.stringify(p.a.teams)} | players=${JSON.stringify(p.a.players)} | score=${p.scores.a}`);
  console.log(`B: ${p.b.slug} | ${p.b.id} | teams=${JSON.stringify(p.b.teams)} | players=${JSON.stringify(p.b.players)} | score=${p.scores.b}`);
}
