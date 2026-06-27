const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "audit-fast-generic-rights-player-duplicates.json");

console.log("Loading trades...");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

const knownSlugs = [
  "future-draft-rights-rights-to-undisclosed-player-new-york-titans-jets",
  "bill-mathis-houston-oilers-tennessee-titans-1960"
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

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
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

const genericPhrases = [
  "future draft rights",
  "rights to undisclosed player",
  "undisclosed player",
  "undisclosed consideration",
  "unspecified consideration",
  "future considerations",
  "draft rights",
  "not disclosed",
  "unknown undisclosed",
  "unknown pick",
  "undisclosed terms"
];

function genericStrength(t) {
  const x = norm(blob(t));
  let score = 0;
  for (const phrase of genericPhrases) {
    if (x.includes(phrase)) score++;
  }
  return score;
}

function isGeneric(t) {
  return genericStrength(t) > 0;
}

const badPlayerWords = [
  "undisclosed", "unknown", "consideration", "rights", "draft", "future",
  "pick", "not disclosed", "unspecified", "cash", "terms"
];

function cleanPlayerName(s) {
  return String(s || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bJr\.?\b/g, "")
    .replace(/\bSr\.?\b/g, "")
    .replace(/\bII\b/g, "")
    .replace(/\bIII\b/g, "")
    .replace(/\bIV\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function concretePlayers(t) {
  const out = new Set();

  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;

    for (const item of assets) {
      const type = String(item.type || "").toLowerCase();
      const asset = String(item.asset || "");
      const n = norm(asset);

      if (type !== "player") continue;
      if (!n) continue;
      if (badPlayerWords.some(w => n.includes(w))) continue;

      for (const part of asset.split(/\s+and\s+|,|;|\//gi)) {
        const cleaned = cleanPlayerName(part);
        const key = norm(cleaned);
        const words = key.split(" ").filter(Boolean);

        if (words.length >= 2 && words.length <= 4) {
          out.add(words.join(" "));
        }
      }
    }
  }

  return [...out].sort();
}

function pickSigs(t) {
  const text = JSON.stringify(t.assetsReceived || {});
  const out = new Set();

  let m;
  const numeric = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)\s+round\s+pick\s+\((\d+)(?:st|nd|rd|th)?\s+overall/gi;
  while ((m = numeric.exec(text))) {
    out.add(`${m[1]}-R${Number(m[2])}-P${Number(m[3])}`);
  }

  const wordRound = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
    eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
    fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17
  };

  const words = /\b((?:19|20)\d{2})\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth)\s+round\s+pick\s+\(#?(\d+)/gi;
  while ((m = words.exec(text))) {
    out.add(`${m[1]}-R${wordRound[m[2].toLowerCase()]}-P${Number(m[3])}`);
  }

  return [...out].sort();
}

function sameSet(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

function overlap(a, b) {
  const B = new Set(b || []);
  return (a || []).filter(x => B.has(x));
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
    genericStrength: genericStrength(t),
    concretePlayers: concretePlayers(t),
    pickSigs: pickSigs(t),
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null
  };
}

function score(r) {
  let s = 0;
  s += (r.concretePlayers || []).length * 12;
  s += (r.pickSigs || []).length * 5;
  s += Object.keys(r.assetsReceived || {}).length * 3;
  s += String(r.summary || "").length / 80;
  if (r.publishStatus === "ready" || r.publishStatus === "publish") s += 3;
  s -= (r.genericStrength || 0) * 4;
  return Number(s.toFixed(2));
}

console.log("Precomputing rows...");

const active = trades.filter(t => t.suppressed !== true);
const rows = active.map(compact).filter(r => r.year);

const genericRows = rows.filter(r => r.genericStrength > 0);
const concreteRows = rows.filter(r => r.concretePlayers.length > 0 || r.pickSigs.length > 0);

console.log(`active rows: ${active.length}`);
console.log(`generic rows: ${genericRows.length}`);
console.log(`concrete rows: ${concreteRows.length}`);

console.log("Building year/team index...");

const byYearTeam = new Map();

for (const r of concreteRows) {
  for (const team of r.teams || []) {
    const key = `${r.year}::${team}`;
    if (!byYearTeam.has(key)) byYearTeam.set(key, []);
    byYearTeam.get(key).push(r);
  }
}

console.log(`year/team buckets: ${byYearTeam.size}`);
console.log("Comparing indexed candidates...");

const pairMap = new Map();

for (const g of genericRows) {
  const bucketMap = new Map();

  for (const team of g.teams || []) {
    const bucket = byYearTeam.get(`${g.year}::${team}`) || [];
    for (const c of bucket) bucketMap.set(c.slug, c);
  }

  for (const c of bucketMap.values()) {
    if (c.slug === g.slug) continue;

    const gTrade = find(g.slug);
    const cTrade = find(c.slug);

    const sameDate = !!g.tradeDate && !!c.tradeDate && g.tradeDate === c.tradeDate;
    const exactTeams = sameSet(g.teams, c.teams);
    const teamOverlap = overlap(g.teams, c.teams);

    const knownMatch = knownSlugs.includes(g.slug) || knownSlugs.includes(c.slug);

    const genericPickCovered = (g.pickSigs || []).every(sig => (c.pickSigs || []).includes(sig));

    const include =
      knownMatch ||
      (sameDate && exactTeams) ||
      (sameDate && teamOverlap.length >= 2 && g.genericStrength >= 2) ||
      (sameDate && teamOverlap.length >= 1 && g.genericStrength >= 3 && c.concretePlayers.length >= 1);

    if (!include) continue;

    const key = `${g.slug}||${c.slug}`;
    if (pairMap.has(key)) continue;

    let confidence = "review";
    let classification = "generic-rights-player-review";

    if (knownMatch) {
      confidence = "known";
      classification = "known-bill-mathis-generic-rights-duplicate";
    } else if (sameDate && exactTeams && g.pickSigs.length === 0 && c.concretePlayers.length >= 1) {
      confidence = "high";
      classification = "same-date-same-team-generic-rights-player-duplicate";
    } else if (sameDate && exactTeams && genericPickCovered && c.concretePlayers.length >= 1) {
      confidence = "high";
      classification = "same-date-same-team-generic-rights-covered-pick-duplicate";
    } else if (sameDate && teamOverlap.length >= 2 && c.concretePlayers.length >= 1) {
      confidence = "medium";
      classification = "same-date-team-overlap-generic-rights-review";
    }

    pairMap.set(key, {
      classification,
      confidence,
      knownMatch,
      sameDate,
      exactTeams,
      teamOverlap,
      genericPickCovered,
      recommendedKeeper: { slug: c.slug, id: c.id },
      recommendedSuppress: { slug: g.slug, id: g.id },
      generic: { ...g, score: score(g) },
      concrete: { ...c, score: score(c) }
    });
  }
}

const candidates = [...pairMap.values()].sort((a, b) => {
  const rank = { known: 4, high: 3, medium: 2, review: 1 };
  if (rank[b.confidence] !== rank[a.confidence]) return rank[b.confidence] - rank[a.confidence];
  return String(a.generic.tradeDate).localeCompare(String(b.generic.tradeDate));
});

const knownRows = knownSlugs.map(slug => {
  const t = find(slug);
  return t ? compact(t) : { slug, missing: true };
});

const byConfidence = candidates.reduce((acc, c) => {
  acc[c.confidence] = (acc[c.confidence] || 0) + 1;
  return acc;
}, {});

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  activeRows: active.length,
  genericRows: genericRows.length,
  concreteRows: concreteRows.length,
  knownSlugs,
  knownRows,
  candidateCount: candidates.length,
  byConfidence,
  candidates
}, null, 2));

console.log("");
console.log("AUDIT FAST GENERIC-RIGHTS PLAYER DUPLICATES");
console.log("=".repeat(80));
console.log(`active rows: ${active.length}`);
console.log(`generic rows: ${genericRows.length}`);
console.log(`concrete rows: ${concreteRows.length}`);
console.log(`candidate pairs: ${candidates.length}`);
console.log(`by confidence: ${JSON.stringify(byConfidence)}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Known rows:");
for (const r of knownRows) {
  console.log("-".repeat(80));
  if (r.missing) {
    console.log(`MISSING: ${r.slug}`);
    continue;
  }
  console.log(`${r.slug} | ${r.id} | ${r.tradeDate} | status=${r.publishStatus} | suppressed=${r.suppressed}`);
  console.log(`teams=${JSON.stringify(r.teams)}`);
  console.log(`genericStrength=${r.genericStrength}`);
  console.log(`concretePlayers=${JSON.stringify(r.concretePlayers)}`);
  console.log(`pickSigs=${JSON.stringify(r.pickSigs)}`);
  console.log("assetsReceived:");
  console.dir(r.assetsReceived, { depth: null });
  console.log("summary:");
  console.log(r.summary || "(none)");
}

console.log("");
console.log("Top candidates:");
for (const c of candidates.slice(0, 80)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${c.classification} | confidence=${c.confidence} | known=${c.knownMatch}`);
  console.log(`sameDate=${c.sameDate} exactTeams=${c.exactTeams} teamOverlap=${JSON.stringify(c.teamOverlap)} genericPickCovered=${c.genericPickCovered}`);
  console.log(`KEEP:     ${c.recommendedKeeper.slug} | ${c.recommendedKeeper.id}`);
  console.log(`SUPPRESS: ${c.recommendedSuppress.slug} | ${c.recommendedSuppress.id}`);
  console.log(`GENERIC:  ${c.generic.slug} | ${c.generic.id} | ${c.generic.tradeDate} | status=${c.generic.publishStatus} | strength=${c.generic.genericStrength} | picks=${JSON.stringify(c.generic.pickSigs)} | score=${c.generic.score}`);
  console.log(`CONCRETE: ${c.concrete.slug} | ${c.concrete.id} | ${c.concrete.tradeDate} | status=${c.concrete.publishStatus} | players=${JSON.stringify(c.concrete.concretePlayers)} | picks=${JSON.stringify(c.concrete.pickSigs)} | score=${c.concrete.score}`);
}
