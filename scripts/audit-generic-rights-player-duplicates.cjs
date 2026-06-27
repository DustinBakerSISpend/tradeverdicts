const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "audit-generic-rights-player-duplicates.json");

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

function findBySlug(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function active(t) {
  return t && t.suppressed !== true;
}

function exactDate(a, b) {
  return !!dateOf(a) && !!dateOf(b) && dateOf(a) === dateOf(b);
}

function sameYear(a, b) {
  return !!yearOf(a) && yearOf(a) === yearOf(b);
}

function overlap(a, b) {
  const B = new Set(b || []);
  return (a || []).filter(x => B.has(x));
}

function sameTeamSet(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

function hasGenericRightsLanguage(t) {
  const x = norm(blob(t));
  return (
    x.includes("future draft rights") ||
    x.includes("rights to undisclosed player") ||
    x.includes("undisclosed player") ||
    x.includes("unspecified consideration") ||
    x.includes("undisclosed consideration") ||
    x.includes("future considerations") ||
    x.includes("draft rights") ||
    x.includes("unknown pick") ||
    x.includes("unknown undisclosed") ||
    x.includes("not disclosed")
  );
}

function genericStrength(t) {
  const x = norm(blob(t));
  let score = 0;
  for (const phrase of [
    "future draft rights",
    "rights to undisclosed player",
    "undisclosed player",
    "unspecified consideration",
    "undisclosed consideration",
    "future considerations",
    "draft rights",
    "unknown pick",
    "unknown undisclosed",
    "not disclosed"
  ]) {
    if (x.includes(phrase)) score++;
  }
  return score;
}

function assetEntries(t) {
  const out = [];
  for (const [team, assets] of Object.entries(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;
    for (const item of assets) {
      out.push({
        team,
        type: String(item.type || ""),
        asset: String(item.asset || "")
      });
    }
  }
  return out;
}

function concretePlayers(t) {
  const out = new Set();

  for (const item of assetEntries(t)) {
    if (String(item.type || "").toLowerCase() !== "player") continue;

    const a = norm(item.asset);
    if (!a) continue;
    if (
      a.includes("undisclosed") ||
      a.includes("unknown") ||
      a.includes("consideration") ||
      a.includes("rights") ||
      a.includes("draft") ||
      a.includes("future")
    ) continue;

    for (const part of String(item.asset || "").split(/\s+and\s+|,|;|\//gi)) {
      const key = norm(part)
        .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();

      const words = key.split(" ").filter(Boolean);
      if (words.length >= 2 && words.length <= 4) out.add(words.join(" "));
    }
  }

  return [...out].sort();
}

function pickSigs(t) {
  const text = JSON.stringify(t.assetsReceived || {});
  const out = new Set();

  let m;
  const re1 = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)\s+round\s+pick\s+\((\d+)(?:st|nd|rd|th)?\s+overall/gi;
  while ((m = re1.exec(text))) out.add(`${m[1]}-R${Number(m[2])}-P${Number(m[3])}`);

  const re2 = /\b((?:19|20)\d{2})\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth)\s+round\s+pick\s+\(#?(\d+)/gi;
  const wordRound = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
    tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17
  };
  while ((m = re2.exec(text))) out.add(`${m[1]}-R${wordRound[m[2].toLowerCase()]}-P${Number(m[3])}`);

  return [...out].sort();
}

function compact(t) {
  if (!t) return null;
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

function completenessScore(c) {
  let s = 0;
  s += (c.concretePlayers || []).length * 12;
  s += (c.pickSigs || []).length * 5;
  s += Object.keys(c.assetsReceived || {}).length * 3;
  s += String(c.summary || "").length / 80;
  if (c.publishStatus === "ready" || c.publishStatus === "publish") s += 3;
  s -= (c.genericStrength || 0) * 4;
  return s;
}

const knownRows = knownSlugs.map(slug => compact(findBySlug(slug)));

const rows = trades.filter(active).map(compact).filter(Boolean);

const candidates = [];

for (let i = 0; i < rows.length; i++) {
  const a = rows[i];
  if (!a.year) continue;

  for (let j = i + 1; j < rows.length; j++) {
    const b = rows[j];
    if (!b.year || a.year !== b.year) continue;

    const aTrade = findBySlug(a.slug);
    const bTrade = findBySlug(b.slug);

    const teamOverlap = overlap(a.teams, b.teams);
    if (!teamOverlap.length) continue;

    const exactTeams = sameTeamSet(a.teams, b.teams);
    const sameDate = exactDate(aTrade, bTrade);

    const aGeneric = hasGenericRightsLanguage(aTrade);
    const bGeneric = hasGenericRightsLanguage(bTrade);
    if (aGeneric === bGeneric) continue;

    const generic = aGeneric ? a : b;
    const concrete = aGeneric ? b : a;

    const knownMatch = knownSlugs.includes(a.slug) || knownSlugs.includes(b.slug);

    const include =
      knownMatch ||
      (sameDate && exactTeams) ||
      (sameDate && teamOverlap.length >= 2) ||
      (sameDate && generic.genericStrength >= 2 && concrete.concretePlayers.length >= 1);

    if (!include) continue;

    const genericPickSigs = generic.pickSigs || [];
    const concretePickSigs = concrete.pickSigs || [];
    const genericPickCovered = genericPickSigs.every(sig => concretePickSigs.includes(sig));

    let confidence = "review";
    let classification = "generic-rights-vs-player-review";

    if (knownMatch) {
      confidence = "known";
      classification = "known-generic-rights-player-duplicate";
    } else if (sameDate && exactTeams && genericPickSigs.length === 0 && concrete.concretePlayers.length >= 1) {
      confidence = "high";
      classification = "same-date-same-team-generic-rights-player-duplicate";
    } else if (sameDate && exactTeams && genericPickCovered && concrete.concretePlayers.length >= 1) {
      confidence = "high";
      classification = "same-date-same-team-generic-rights-covered-pick-duplicate";
    } else if (sameDate && teamOverlap.length >= 2 && generic.concretePlayers.length === 0 && concrete.concretePlayers.length >= 1) {
      confidence = "medium";
      classification = "same-date-overlap-team-generic-rights-player-review";
    }

    candidates.push({
      classification,
      confidence,
      knownMatch,
      sameDate,
      exactTeams,
      teamOverlap,
      genericPickCovered,
      generic: {
        ...generic,
        score: Number(completenessScore(generic).toFixed(2))
      },
      concrete: {
        ...concrete,
        score: Number(completenessScore(concrete).toFixed(2))
      },
      recommendedKeeper: {
        slug: concrete.slug,
        id: concrete.id
      },
      recommendedSuppress: {
        slug: generic.slug,
        id: generic.id
      }
    });
  }
}

candidates.sort((x, y) => {
  const rank = { known: 4, high: 3, medium: 2, review: 1 };
  if (rank[y.confidence] !== rank[x.confidence]) return rank[y.confidence] - rank[x.confidence];
  if ((y.knownMatch ? 1 : 0) !== (x.knownMatch ? 1 : 0)) return (y.knownMatch ? 1 : 0) - (x.knownMatch ? 1 : 0);
  return String(x.generic.tradeDate).localeCompare(String(y.generic.tradeDate));
});

const byConfidence = candidates.reduce((acc, c) => {
  acc[c.confidence] = (acc[c.confidence] || 0) + 1;
  return acc;
}, {});

const output = {
  generatedAt: new Date().toISOString(),
  activeRowsScanned: rows.length,
  knownSlugs,
  knownRows,
  candidateCount: candidates.length,
  byConfidence,
  candidates
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log("");
console.log("AUDIT GENERIC-RIGHTS PLAYER DUPLICATES");
console.log("=".repeat(80));
console.log(`active rows scanned: ${rows.length}`);
console.log(`candidate pairs: ${candidates.length}`);
console.log(`by confidence: ${JSON.stringify(byConfidence)}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Known rows:");
for (const r of knownRows) {
  console.log("-".repeat(80));
  if (!r) {
    console.log("MISSING known row");
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
