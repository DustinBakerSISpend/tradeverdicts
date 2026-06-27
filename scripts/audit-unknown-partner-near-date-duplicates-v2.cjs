const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "audit-unknown-partner-near-date-duplicates-v2.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

const seedSlugs = new Set([
  "cardinals-1983-07-19-unknown-partner-al-baker-bubba-baker-unknown-not-disclosed",
  "mike-dawson-arizona-st-louis-cardinals-1983-07-18",
  "not-specified-unknown-partner-1983-07-19",
  "1984-third-round-pick-62-eric-williams-michael-arizona-st-louis-cardinals-1983-0"
]);

const teamWords = new Set([
  "cardinals","rams","chargers","raiders","eagles","bills","dolphins","falcons","bears","saints",
  "packers","steelers","vikings","cowboys","commanders","redskins","colts","browns","bengals",
  "patriots","seahawks","buccaneers","panthers","jaguars","chiefs","ravens","lions","jets",
  "giants","broncos","titans","oilers","49ers","arizona","los","angeles","las","vegas","st",
  "louis","san","diego","kansas","city","tampa","bay","indianapolis","cleveland","cincinnati",
  "pittsburgh","buffalo","miami","minnesota","atlanta","philadelphia","dallas","washington",
  "chicago","detroit","seattle","jacksonville","new","york","houston","tennessee","denver",
  "green","orleans","england"
]);

const badNameWords = new Set([
  "unknown","partner","not","disclosed","undisclosed","consideration","future","rights","draft",
  "pick","round","overall","possibly","probably","conditional","cash","terms","source","raw",
  "trade","traded","from","to","and","or","with","for","the","involving","physical","when",
  "compensation","retiring","after","being","past"
]);

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || "";
}

function ms(t) {
  const d = dateOf(t);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return Date.parse(d + "T00:00:00Z");
}

function dayDiff(a, b) {
  const am = ms(a);
  const bm = ms(b);
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
    x.includes("not specified") ||
    x.includes("not disclosed") ||
    x.includes("not-disclosed") ||
    x.includes("unknown undisclosed") ||
    x.includes("unknown consideration") ||
    x.includes("undisclosed consideration") ||
    /unknown/.test(teams)
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

function addName(out, raw) {
  let key = norm(raw)
    .replace(/\b(jr|sr|ii|iii|iv|v|a|b|c)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const words = key.split(" ").filter(Boolean);

  if (words.length < 2 || words.length > 4) return;
  if (words.some(w => teamWords.has(w) || badNameWords.has(w))) return;

  out.add(words.join(" "));
}

function namesFromAssets(t) {
  const out = new Set();

  for (const item of assetEntries(t)) {
    const asset = String(item.asset || "");
    const type = String(item.type || "").toLowerCase();

    if (type !== "player") continue;

    const n = norm(asset);
    if (
      !n ||
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

function namesFromSlug(t) {
  const out = new Set();
  const tokens = norm(slugOf(t)).split(" ").filter(Boolean);
  const stop = new Set([...teamWords, ...badNameWords]);

  const cleaned = tokens.filter(w => !stop.has(w) && !/^\d+$/.test(w));

  for (let i = 0; i < cleaned.length - 1; i++) {
    addName(out, `${cleaned[i]} ${cleaned[i + 1]}`);
  }

  for (let i = 0; i < cleaned.length - 2; i++) {
    addName(out, `${cleaned[i]} ${cleaned[i + 1]} ${cleaned[i + 2]}`);
  }

  return out;
}

function aliasExpand(names) {
  const out = new Set(names);

  for (const n of names) {
    if (n === "al baker" || n === "bubba baker" || n === "al bubba baker") {
      out.add("al baker");
      out.add("bubba baker");
      out.add("al bubba baker");
    }
  }

  return [...out].sort();
}

function playerNames(t) {
  const out = new Set();

  for (const n of namesFromAssets(t)) out.add(n);
  for (const n of namesFromSlug(t)) out.add(n);

  return aliasExpand([...out]);
}

function pickSigs(t) {
  const out = new Set();
  const text = sourceText(t)
    .replace(/[-_]+/g, " ")
    .replace(/\(/g, " ")
    .replace(/\)/g, " ");

  const roundWords = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
    eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
    fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17
  };

  let m;

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

function sameTeamSet(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

function score(r) {
  let s = 0;
  s += r.nonUnknownTeams.length * 8;
  s += r.playerNames.length * 4;
  s += r.pickSigs.length * 5;
  s += String(r.summary || "").length / 80;
  if (r.publishStatus === "publish" || r.publishStatus === "ready") s += 3;
  if (r.publishStatus === "provisional") s -= 2;
  if (r.publishStatus === "hold-conflict" || r.publishStatus === "hold-review") s -= 8;
  if (r.unknownish) s -= 10;
  if (r.slug.includes("unknown-partner") || r.slug.includes("unknown-not-disclosed")) s -= 6;
  return Number(s.toFixed(2));
}

function compact(t) {
  const r = {
    raw: t,
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

  r.score = score(r);
  return r;
}

const active = trades
  .filter(t => t.suppressed !== true && dateOf(t))
  .map(compact)
  .filter(r => r.year);

const unknownRows = active.filter(r => r.unknownish || seedSlugs.has(r.slug));

const pairs = [];
const pairKeys = new Set();

for (const u of unknownRows) {
  for (const r of active) {
    if (u.slug === r.slug) continue;
    if (u.year !== r.year) continue;

    const dd = dayDiff(u.raw, r.raw);
    if (dd == null || dd > 3) continue;

    const teamOverlap = overlap(u.nonUnknownTeams, r.nonUnknownTeams);
    const playerOverlap = overlap(u.playerNames, r.playerNames);
    const pickOverlap = overlap(u.pickSigs, r.pickSigs);

    const bothConcreteSameTeams =
      u.nonUnknownTeams.length >= 2 &&
      r.nonUnknownTeams.length >= 2 &&
      sameTeamSet(u.nonUnknownTeams, r.nonUnknownTeams);

    const unknownPlayerCovered =
      u.unknownish &&
      playerOverlap.length >= 1 &&
      teamOverlap.length >= 1;

    const concreteCounterpartCovered =
      bothConcreteSameTeams &&
      (pickOverlap.length >= 1 || playerOverlap.length >= 1);

    const seedCluster =
      (seedSlugs.has(u.slug) || seedSlugs.has(r.slug)) &&
      (
        playerOverlap.length >= 1 ||
        pickOverlap.length >= 1 ||
        teamOverlap.length >= 1 ||
        bothConcreteSameTeams
      );

    if (!unknownPlayerCovered && !concreteCounterpartCovered && !seedCluster) continue;

    const key = [u.slug, r.slug].sort().join("||");
    if (pairKeys.has(key)) continue;
    pairKeys.add(key);

    const keeper = u.score >= r.score ? u : r;
    const suppress = u.score >= r.score ? r : u;

    let confidence = "review";
    let classification = "near-date-unknown-partner-review";

    if (seedCluster) {
      confidence = "known";
      classification = "known-baker-dawson-near-date-cluster";
    } else if (unknownPlayerCovered || concreteCounterpartCovered) {
      confidence = "high";
      classification = "near-date-unknown-partner-covered-duplicate";
    }

    pairs.push({
      classification,
      confidence,
      dayDiff: dd,
      teamOverlap,
      playerOverlap,
      pickOverlap,
      recommendedKeeper: { slug: keeper.slug, id: keeper.id, score: keeper.score },
      recommendedSuppress: { slug: suppress.slug, id: suppress.id, score: suppress.score },
      a: u,
      b: r
    });
  }
}

const parent = new Map();

function root(x) {
  if (!parent.has(x)) parent.set(x, x);
  while (parent.get(x) !== parent.get(parent.get(x))) {
    parent.set(x, parent.get(parent.get(x)));
  }
  return parent.get(x);
}

function union(a, b) {
  const ra = root(a);
  const rb = root(b);
  if (ra !== rb) parent.set(rb, ra);
}

for (const p of pairs) union(p.a.slug, p.b.slug);

const rowBySlug = new Map(active.map(r => [r.slug, r]));
const comps = new Map();

for (const p of pairs) {
  for (const slug of [p.a.slug, p.b.slug]) {
    const rt = root(slug);
    if (!comps.has(rt)) comps.set(rt, new Set());
    comps.get(rt).add(slug);
  }
}

const components = [...comps.values()].map(set => {
  const members = [...set].map(s => rowBySlug.get(s)).filter(Boolean);
  const componentPairs = pairs.filter(p => set.has(p.a.slug) && set.has(p.b.slug));
  const keeper = members.slice().sort((a, b) => b.score - a.score)[0];

  return {
    size: members.length,
    hasSeed: members.some(m => seedSlugs.has(m.slug)),
    topConfidence: componentPairs.some(p => p.confidence === "known") ? "known" :
      componentPairs.some(p => p.confidence === "high") ? "high" : "review",
    keeper: keeper ? { slug: keeper.slug, id: keeper.id, score: keeper.score } : null,
    suppressCandidates: members
      .filter(m => m.slug !== keeper?.slug)
      .sort((a, b) => a.score - b.score)
      .map(m => ({ slug: m.slug, id: m.id, score: m.score, unknownish: m.unknownish })),
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
      recommendedKeeper: p.recommendedKeeper,
      recommendedSuppress: p.recommendedSuppress,
      a: { slug: p.a.slug, id: p.a.id },
      b: { slug: p.b.slug, id: p.b.id }
    }))
  };
}).sort((a, b) => {
  if ((b.hasSeed ? 1 : 0) !== (a.hasSeed ? 1 : 0)) return (b.hasSeed ? 1 : 0) - (a.hasSeed ? 1 : 0);
  return b.size - a.size;
});

const byConfidence = pairs.reduce((acc, p) => {
  acc[p.confidence] = (acc[p.confidence] || 0) + 1;
  return acc;
}, {});

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  activeRows: active.length,
  unknownRows: unknownRows.length,
  pairCount: pairs.length,
  byConfidence,
  componentCount: components.length,
  seedSlugs: [...seedSlugs],
  components,
  pairs
}, null, 2));

console.log("");
console.log("AUDIT UNKNOWN-PARTNER NEAR-DATE DUPLICATES V2");
console.log("=".repeat(80));
console.log(`active rows: ${active.length}`);
console.log(`unknown/seed rows: ${unknownRows.length}`);
console.log(`candidate pairs: ${pairs.length}`);
console.log(`by confidence: ${JSON.stringify(byConfidence)}`);
console.log(`components: ${components.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("SEED COMPONENTS:");
for (const c of components.filter(c => c.hasSeed)) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`component size=${c.size} confidence=${c.topConfidence}`);
  console.log(`KEEPER: ${c.keeper?.slug} | ${c.keeper?.id} | score=${c.keeper?.score}`);
  console.log("SUPPRESS:");
  for (const s of c.suppressCandidates) {
    console.log(`- ${s.slug} | ${s.id} | score=${s.score} | unknownish=${s.unknownish}`);
  }
  console.log("MEMBERS:");
  for (const m of c.members) {
    console.log(`- ${m.slug} | ${m.id} | ${m.tradeDate} | status=${m.publishStatus} | unknownish=${m.unknownish} | score=${m.score}`);
    console.log(`  teams=${JSON.stringify(m.teams)}`);
    console.log(`  players=${JSON.stringify(m.playerNames)}`);
    console.log(`  picks=${JSON.stringify(m.pickSigs)}`);
  }
  console.log("PAIRS:");
  for (const p of c.pairs) {
    console.log(`- ${p.confidence} | dayDiff=${p.dayDiff} | players=${JSON.stringify(p.playerOverlap)} | teams=${JSON.stringify(p.teamOverlap)} | picks=${JSON.stringify(p.pickOverlap)}`);
    console.log(`  keep=${p.recommendedKeeper.slug}`);
    console.log(`  suppress=${p.recommendedSuppress.slug}`);
  }
}

console.log("");
console.log("OTHER COMPONENTS:");
for (const c of components.filter(c => !c.hasSeed).slice(0, 30)) {
  console.log("-".repeat(80));
  console.log(`size=${c.size} confidence=${c.topConfidence}`);
  console.log(`KEEPER: ${c.keeper?.slug} | ${c.keeper?.id}`);
  console.log(`SUPPRESS: ${c.suppressCandidates.map(s => `${s.slug} | ${s.id}`).join(" || ")}`);
}
