const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "audit-unknown-partner-near-date-duplicates.json");

console.log("Loading trades...");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

const knownSlugs = [
  "cardinals-1983-07-19-unknown-partner-al-baker-bubba-baker-unknown-not-disclosed",
  "mike-dawson-arizona-st-louis-cardinals-1983-07-18"
];

const teamWords = new Set([
  "cardinals","rams","chargers","raiders","eagles","bills","dolphins","falcons","bears","saints",
  "packers","steelers","vikings","cowboys","commanders","redskins","colts","browns","bengals",
  "patriots","seahawks","buccaneers","panthers","jaguars","chiefs","ravens","lions","jets",
  "giants","broncos","titans","oilers","49ers","arizona","los","angeles","las","vegas","st",
  "louis","san","diego","kansas","city","tampa","bay","indianapolis","cleveland","cincinnati",
  "pittsburgh","buffalo","miami","minnesota","atlanta","philadelphia","dallas","washington",
  "chicago","detroit","seattle","jacksonville","new","york","houston","tennessee","denver",
  "green","bay","new","orleans","new","england"
]);

const badNameWords = new Set([
  "unknown","partner","not","disclosed","undisclosed","consideration","future","rights","draft",
  "pick","round","overall","possibly","probably","conditional","cash","terms","source","raw",
  "trade","traded","from","to","and","or","with","for","the","a","b","c","sr","jr","ii","iii","iv",
  "unknowns","unknownteam"
]);

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || "";
}

function dateMs(t) {
  const d = dateOf(t);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return Date.parse(d + "T00:00:00Z");
}

function dayDiff(a, b) {
  const am = dateMs(a);
  const bm = dateMs(b);
  if (am == null || bm == null) return null;
  return Math.round(Math.abs(am - bm) / 86400000);
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
    .replace(/[-_]+/g, " ")
    .replace(/#/g, " #")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function sourceText(t) {
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

function isUnknownish(t) {
  const x = norm(sourceText(t));
  const teams = (t.teams || []).map(String).join(" ");
  return (
    x.includes("unknown partner") ||
    x.includes("unknown not disclosed") ||
    x.includes("unknown not-disclosed") ||
    x.includes("unknown team") ||
    x.includes("not disclosed") ||
    x.includes("not-disclosed") ||
    x.includes("unknown undisclosed") ||
    x.includes("unknown consideration") ||
    x.includes("undisclosed consideration") ||
    /unknown/.test(teams) ||
    /not specified/.test(x)
  );
}

function nonUnknownTeams(t) {
  return (t.teams || [])
    .map(String)
    .filter(team =>
      team &&
      !team.includes("unknown") &&
      !team.includes("not-specified") &&
      !team.includes("tbd")
    )
    .sort();
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

function cleanNameKey(s) {
  return norm(s)
    .replace(/\b(jr|sr|ii|iii|iv|v|a|b|c)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addName(out, raw) {
  const key = cleanNameKey(raw);
  const words = key.split(" ").filter(Boolean);

  if (words.length < 2 || words.length > 4) return;
  if (words.some(w => teamWords.has(w) || badNameWords.has(w))) return;

  out.add(words.join(" "));
}

function playerNamesFromAssets(t) {
  const out = new Set();

  for (const item of assetEntries(t)) {
    const type = String(item.type || "").toLowerCase();
    const asset = String(item.asset || "");
    const n = norm(asset);

    if (type !== "player") continue;
    if (!n) continue;
    if (
      n.includes("undisclosed") ||
      n.includes("unknown") ||
      n.includes("consideration") ||
      n.includes("draft") ||
      n.includes("pick") ||
      n.includes("rights") ||
      n.includes("future") ||
      n.includes("not specified")
    ) continue;

    for (const part of asset.split(/\s+and\s+|,|;|\//gi)) {
      addName(out, part);
    }
  }

  return out;
}

function playerNamesFromSlug(t) {
  const out = new Set();
  const toks = norm(slugOf(t)).split(" ").filter(Boolean);

  const stop = new Set([...teamWords, ...badNameWords]);
  const cleaned = toks.filter(w => !stop.has(w) && !/^\d+$/.test(w));

  for (let i = 0; i < cleaned.length - 1; i++) {
    addName(out, `${cleaned[i]} ${cleaned[i + 1]}`);
  }

  for (let i = 0; i < cleaned.length - 2; i++) {
    addName(out, `${cleaned[i]} ${cleaned[i + 1]} ${cleaned[i + 2]}`);
  }

  return out;
}

function aliasNames(names) {
  const out = new Set(names);

  for (const n of names) {
    // al baker / bubba baker are the same known style of alias in this class.
    if (n === "al baker" || n === "bubba baker") {
      out.add("al baker");
      out.add("bubba baker");
      out.add("al bubba baker");
    }
  }

  return [...out].sort();
}

function playerNames(t) {
  const out = new Set();

  for (const n of playerNamesFromAssets(t)) out.add(n);
  for (const n of playerNamesFromSlug(t)) out.add(n);

  return aliasNames([...out]);
}

function pickSigs(t) {
  const out = new Set();
  const text = sourceText(t)
    .replace(/[-_]+/g, " ")
    .replace(/\(/g, " ")
    .replace(/\)/g, " ");

  let m;

  const roundWords = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
    eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
    fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17
  };

  const word = /\b((?:19|20)\d{2})\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth)\s+round\s+pick\s+#?\s*(\d+)/gi;
  while ((m = word.exec(text))) {
    out.add(`${m[1]}-R${roundWords[m[2].toLowerCase()]}-P${Number(m[3])}`);
  }

  const numeric = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)?\s+round\s+pick\s+#?\s*(\d+)(?:st|nd|rd|th)?/gi;
  while ((m = numeric.exec(text))) {
    out.add(`${m[1]}-R${Number(m[2])}-P${Number(m[3])}`);
  }

  return [...out].sort();
}

function overlap(a, b) {
  const B = new Set(b || []);
  return (a || []).filter(x => B.has(x));
}

function completenessScore(r) {
  let s = 0;
  s += r.nonUnknownTeams.length * 8;
  s += r.playerNames.length * 5;
  s += r.pickSigs.length * 4;
  s += Object.keys(r.assetsReceived || {}).length * 2;
  s += String(r.summary || "").length / 100;
  if (r.publishStatus === "ready" || r.publishStatus === "publish") s += 3;
  if (r.publishStatus === "provisional") s -= 2;
  if (r.publishStatus === "hold-conflict" || r.publishStatus === "hold-review") s -= 5;
  if (r.unknownish) s -= 8;
  if (r.slug.includes("unknown-partner") || r.slug.includes("unknown-not-disclosed")) s -= 6;
  if (r.suppressed === true) s -= 1000;
  return Number(s.toFixed(2));
}

function compact(t) {
  if (!t) return null;

  const row = {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    year: yearOf(t),
    teams: t.teams || [],
    nonUnknownTeams: nonUnknownTeams(t),
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    unknownish: isUnknownish(t),
    playerNames: playerNames(t),
    pickSigs: pickSigs(t),
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null
  };

  row.score = completenessScore(row);
  return row;
}

function candidatePair(a, b) {
  const dd = dayDiff(a.raw, b.raw);
  const sameYear = a.year && a.year === b.year;
  const teamOverlap = overlap(a.nonUnknownTeams, b.nonUnknownTeams);
  const playerOverlap = overlap(a.playerNames, b.playerNames);
  const pickOverlap = overlap(a.pickSigs, b.pickSigs);
  const knownMatch = knownSlugs.includes(a.slug) || knownSlugs.includes(b.slug);

  const nearDate = dd != null && dd <= 2;
  const oneUnknownish = a.unknownish || b.unknownish;

  const include =
    knownMatch ||
    (
      oneUnknownish &&
      sameYear &&
      nearDate &&
      (
        playerOverlap.length >= 1 ||
        (teamOverlap.length >= 1 && pickOverlap.length >= 1) ||
        (teamOverlap.length >= 1 && a.playerNames.length && b.playerNames.length)
      )
    );

  if (!include) return null;

  let confidence = "review";
  let classification = "unknown-partner-near-date-review";

  if (knownMatch) {
    confidence = "known";
    classification = "known-baker-dawson-unknown-partner-cluster";
  } else if (nearDate && playerOverlap.length >= 1 && teamOverlap.length >= 1) {
    confidence = "high";
    classification = "near-date-team-player-overlap-unknown-partner-duplicate";
  } else if (nearDate && playerOverlap.length >= 1) {
    confidence = "medium";
    classification = "near-date-player-overlap-unknown-partner-review";
  }

  const keeper = a.score >= b.score ? a : b;
  const suppress = a.score >= b.score ? b : a;

  return {
    classification,
    confidence,
    knownMatch,
    dayDiff: dd,
    teamOverlap,
    playerOverlap,
    pickOverlap,
    recommendedKeeper: { slug: keeper.slug, id: keeper.id },
    recommendedSuppress: { slug: suppress.slug, id: suppress.id },
    a,
    b,
    keeper,
    suppress
  };
}

console.log("Precomputing active rows...");

const rows = trades
  .filter(t => t.suppressed !== true && dateOf(t))
  .map(t => ({ ...compact(t), raw: t }))
  .filter(r => r.year);

const unknownRows = rows.filter(r => r.unknownish || knownSlugs.includes(r.slug));

console.log(`active rows with dates: ${rows.length}`);
console.log(`unknownish rows: ${unknownRows.length}`);

console.log("Building year index...");

const byYear = new Map();
for (const r of rows) {
  if (!byYear.has(r.year)) byYear.set(r.year, []);
  byYear.get(r.year).push(r);
}

console.log("Comparing unknownish rows to same-year/near-date rows...");

const pairMap = new Map();

for (const u of unknownRows) {
  const bucket = byYear.get(u.year) || [];

  for (const r of bucket) {
    if (u.slug === r.slug) continue;

    const pair = candidatePair(u, r);
    if (!pair) continue;

    const key = [pair.a.slug, pair.b.slug].sort().join("||");
    if (!pairMap.has(key)) pairMap.set(key, pair);
  }
}

const pairs = [...pairMap.values()].sort((x, y) => {
  const rank = { known: 4, high: 3, medium: 2, review: 1 };
  if (rank[y.confidence] !== rank[x.confidence]) return rank[y.confidence] - rank[x.confidence];
  return String(x.keeper.tradeDate).localeCompare(String(y.keeper.tradeDate));
});

// Connected components.
const parent = new Map();

function make(x) {
  if (!parent.has(x)) parent.set(x, x);
}

function root(x) {
  make(x);
  let p = parent.get(x);
  while (p !== parent.get(p)) {
    p = parent.get(p);
  }
  return p;
}

function union(a, b) {
  const ra = root(a);
  const rb = root(b);
  if (ra !== rb) parent.set(rb, ra);
}

for (const p of pairs) {
  union(p.a.slug, p.b.slug);
}

const componentMap = new Map();
for (const p of pairs) {
  for (const slug of [p.a.slug, p.b.slug]) {
    const r = root(slug);
    if (!componentMap.has(r)) componentMap.set(r, new Set());
    componentMap.get(r).add(slug);
  }
}

const rowBySlug = new Map(rows.map(r => [r.slug, r]));

const components = [...componentMap.values()].map(set => {
  const members = [...set].map(slug => rowBySlug.get(slug)).filter(Boolean);
  const componentPairs = pairs.filter(p => set.has(p.a.slug) && set.has(p.b.slug));
  const keeper = [...members].sort((a, b) => b.score - a.score)[0];
  const suppressCandidates = members.filter(m => m.slug !== keeper.slug && (m.unknownish || m.score < keeper.score));

  return {
    size: members.length,
    hasKnownSlug: members.some(m => knownSlugs.includes(m.slug)),
    topConfidence: componentPairs.some(p => p.confidence === "known") ? "known" :
      componentPairs.some(p => p.confidence === "high") ? "high" :
      componentPairs.some(p => p.confidence === "medium") ? "medium" : "review",
    keeper: keeper ? { slug: keeper.slug, id: keeper.id, score: keeper.score } : null,
    suppressCandidates: suppressCandidates.map(m => ({ slug: m.slug, id: m.id, score: m.score, unknownish: m.unknownish })),
    members: members
      .sort((a, b) => b.score - a.score)
      .map(m => ({
        id: m.id,
        slug: m.slug,
        tradeDate: m.tradeDate,
        teams: m.teams,
        nonUnknownTeams: m.nonUnknownTeams,
        publishStatus: m.publishStatus,
        suppressed: m.suppressed,
        unknownish: m.unknownish,
        playerNames: m.playerNames,
        pickSigs: m.pickSigs,
        score: m.score,
        assetsReceived: m.assetsReceived,
        summary: m.summary,
        qaNotes: m.qaNotes
      })),
    pairs: componentPairs.map(p => ({
      classification: p.classification,
      confidence: p.confidence,
      dayDiff: p.dayDiff,
      teamOverlap: p.teamOverlap,
      playerOverlap: p.playerOverlap,
      pickOverlap: p.pickOverlap,
      a: { slug: p.a.slug, id: p.a.id },
      b: { slug: p.b.slug, id: p.b.id },
      recommendedKeeper: p.recommendedKeeper,
      recommendedSuppress: p.recommendedSuppress
    }))
  };
}).sort((a, b) => {
  if ((b.hasKnownSlug ? 1 : 0) !== (a.hasKnownSlug ? 1 : 0)) return (b.hasKnownSlug ? 1 : 0) - (a.hasKnownSlug ? 1 : 0);
  const rank = { known: 4, high: 3, medium: 2, review: 1 };
  if (rank[b.topConfidence] !== rank[a.topConfidence]) return rank[b.topConfidence] - rank[a.topConfidence];
  return b.size - a.size;
});

const knownRows = knownSlugs.map(slug => {
  const t = find(slug);
  return t ? compact(t) : { slug, missing: true };
});

const byConfidence = pairs.reduce((acc, p) => {
  acc[p.confidence] = (acc[p.confidence] || 0) + 1;
  return acc;
}, {});

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  activeRowsWithDates: rows.length,
  unknownishRows: unknownRows.length,
  knownSlugs,
  knownRows,
  pairCount: pairs.length,
  byConfidence,
  componentCount: components.length,
  components,
  pairs
}, null, 2));

console.log("");
console.log("AUDIT UNKNOWN-PARTNER NEAR-DATE DUPLICATES");
console.log("=".repeat(80));
console.log(`active rows with dates: ${rows.length}`);
console.log(`unknownish rows: ${unknownRows.length}`);
console.log(`candidate pairs: ${pairs.length}`);
console.log(`by confidence: ${JSON.stringify(byConfidence)}`);
console.log(`components: ${components.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Known rows:");
for (const r of knownRows) {
  console.log("-".repeat(80));
  if (r.missing) {
    console.log(`MISSING: ${r.slug}`);
    continue;
  }
  console.log(`${r.slug} | ${r.id} | ${r.tradeDate} | status=${r.publishStatus} | suppressed=${r.suppressed} | unknownish=${r.unknownish} | score=${r.score}`);
  console.log(`teams=${JSON.stringify(r.teams)}`);
  console.log(`nonUnknownTeams=${JSON.stringify(r.nonUnknownTeams)}`);
  console.log(`playerNames=${JSON.stringify(r.playerNames)}`);
  console.log(`pickSigs=${JSON.stringify(r.pickSigs)}`);
  console.log("assetsReceived:");
  console.dir(r.assetsReceived, { depth: null });
  console.log("summary:");
  console.log(r.summary || "(none)");
}

console.log("");
console.log("Top components:");
for (const c of components.slice(0, 40)) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`component size=${c.size} confidence=${c.topConfidence} known=${c.hasKnownSlug}`);
  console.log(`KEEPER: ${c.keeper?.slug} | ${c.keeper?.id} | score=${c.keeper?.score}`);
  console.log(`SUPPRESS candidates=${c.suppressCandidates.map(s => `${s.slug} | ${s.id} | score=${s.score} | unknownish=${s.unknownish}`).join(" || ")}`);

  for (const m of c.members) {
    console.log("-".repeat(80));
    console.log(`${m.slug} | ${m.id} | ${m.tradeDate} | status=${m.publishStatus} | unknownish=${m.unknownish} | score=${m.score}`);
    console.log(`teams=${JSON.stringify(m.teams)}`);
    console.log(`players=${JSON.stringify(m.playerNames)}`);
    console.log(`picks=${JSON.stringify(m.pickSigs)}`);
  }

  console.log("Pairs:");
  for (const p of c.pairs) {
    console.log(`- ${p.classification} | confidence=${p.confidence} | dayDiff=${p.dayDiff} | teamOverlap=${JSON.stringify(p.teamOverlap)} | playerOverlap=${JSON.stringify(p.playerOverlap)} | KEEP=${p.recommendedKeeper.slug} | SUPPRESS=${p.recommendedSuppress.slug}`);
  }
}
