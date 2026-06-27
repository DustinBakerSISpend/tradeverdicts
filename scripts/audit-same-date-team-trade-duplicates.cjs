const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "audit-same-date-team-trade-duplicates.json");

console.log("Loading trades...");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

const knownSlugs = [
  "butch-johnson-houston-oilers-tennessee-titans-1984",
  "1985-third-round-pick-82-mike-kelley-c-denver-broncos-1984"
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
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/#/g, " #")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function teamKey(t) {
  return JSON.stringify([...(t.teams || [])].sort());
}

function groupKey(t) {
  return `${dateOf(t)}::${teamKey(t)}`;
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

const roundWords = {
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
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17
};

function pickSigsFromAsset(asset) {
  const out = new Set();
  const text = String(asset || "");
  let m;

  const numeric = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)\s+round\s+pick\s+\((\d+)(?:st|nd|rd|th)?\s+overall/gi;
  while ((m = numeric.exec(text))) {
    out.add(`${m[1]}-R${Number(m[2])}-P${Number(m[3])}`);
  }

  const word = /\b((?:19|20)\d{2})\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth)\s+round\s+pick\s+\(#?(\d+)/gi;
  while ((m = word.exec(text))) {
    out.add(`${m[1]}-R${roundWords[m[2].toLowerCase()]}-P${Number(m[3])}`);
  }

  const shortHash = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)\s+round\s+pick\s+\(#?(\d+)/gi;
  while ((m = shortHash.exec(text))) {
    out.add(`${m[1]}-R${Number(m[2])}-P${Number(m[3])}`);
  }

  return [...out];
}

function namesFromAsset(asset) {
  const out = new Set();
  const text = String(asset || "");

  // Names in pick strings like (#82-Mike Kelley C), (#178-Al Dixon), etc.
  let m;
  const afterHashDash = /#\d+\s*[-–]\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})/g;
  while ((m = afterHashDash.exec(text))) {
    const key = norm(m[1])
      .replace(/\b(jr|sr|ii|iii|iv|v|c|a|b)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const words = key.split(" ").filter(Boolean);
    if (words.length >= 2 && words.length <= 4) out.add(words.join(" "));
  }

  // Plain player asset.
  for (const part of text.split(/\s+and\s+|,|;|\//gi)) {
    const key = norm(part)
      .replace(/\b(jr|sr|ii|iii|iv|v|c|a|b)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (
      !key ||
      key.includes("draft") ||
      key.includes("pick") ||
      key.includes("round") ||
      key.includes("overall") ||
      key.includes("undisclosed") ||
      key.includes("unknown") ||
      key.includes("consideration") ||
      key.includes("rights") ||
      key.includes("future") ||
      key.includes("not exercised")
    ) continue;

    const words = key.split(" ").filter(Boolean);
    if (words.length >= 2 && words.length <= 4) out.add(words.join(" "));
  }

  return [...out];
}

function slugNameBigrams(slug) {
  const bad = new Set([
    "round","pick","overall","subsequently","traded","houston","oilers","tennessee","titans",
    "denver","broncos","new","york","jets","giants","cardinals","rams","chargers","raiders",
    "eagles","bills","dolphins","falcons","bears","saints","packers","steelers","vikings",
    "cowboys","commanders","redskins","colts","browns","bengals","patriots","seahawks",
    "49ers","buccaneers","panthers","jaguars","chiefs","ravens","lions","arizona","los",
    "angeles","las","vegas","st","louis","san","diego","kansas","city","tampa","bay",
    "indianapolis","cleveland","cincinnati","pittsburgh","buffalo","miami","minnesota",
    "atlanta","philadelphia","dallas","washington","chicago","detroit","seattle","jacksonville"
  ]);

  const tokens = norm(slug)
    .split(" ")
    .filter(Boolean)
    .filter(w => !bad.has(w))
    .filter(w => !/^\d+$/.test(w));

  const out = new Set();

  for (let i = 0; i < tokens.length - 1; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }

  return [...out];
}

function tradeTokens(t) {
  const out = new Set();

  for (const item of assetEntries(t)) {
    for (const sig of pickSigsFromAsset(item.asset)) out.add(`PICK:${sig}`);
    for (const name of namesFromAsset(item.asset)) out.add(`NAME:${name}`);

    const assetNorm = norm(item.asset);
    if (assetNorm && assetNorm.length > 5) out.add(`ASSET:${assetNorm}`);
  }

  for (const name of slugNameBigrams(slugOf(t))) out.add(`SLUGNAME:${name}`);

  return [...out].sort();
}

function pickSigs(t) {
  const out = new Set();
  for (const item of assetEntries(t)) {
    for (const sig of pickSigsFromAsset(item.asset)) out.add(sig);
  }
  return [...out].sort();
}

function playerNames(t) {
  const out = new Set();
  for (const item of assetEntries(t)) {
    for (const name of namesFromAsset(item.asset)) out.add(name);
  }
  return [...out].sort();
}

function overlap(a, b) {
  const B = new Set(b || []);
  return (a || []).filter(x => B.has(x));
}

function subset(a, b) {
  const B = new Set(b || []);
  return (a || []).every(x => B.has(x));
}

function score(row) {
  let s = 0;
  s += row.players.length * 8;
  s += row.pickSigs.length * 5;
  s += Object.keys(row.assetsReceived || {}).length * 3;
  s += String(row.summary || "").length / 80;
  if (row.publishStatus === "ready" || row.publishStatus === "publish") s += 2;
  if (row.publishStatus === "hold-conflict") s -= 5;
  if (row.slug.includes("unspecified") || row.slug.includes("undisclosed") || row.slug.includes("unknown")) s -= 4;
  return Number(s.toFixed(2));
}

function compact(t) {
  const players = playerNames(t);
  const sigs = pickSigs(t);

  const row = {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    teams: t.teams || [],
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    players,
    pickSigs: sigs,
    tokens: tradeTokens(t),
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null
  };

  row.score = score(row);
  return row;
}

console.log("Grouping active rows by exact date/team set...");

const active = trades.filter(t => t.suppressed !== true && dateOf(t) && Array.isArray(t.teams) && t.teams.length >= 2);
const groups = new Map();

for (const t of active) {
  const key = groupKey(t);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(t);
}

const duplicateGroups = [...groups.entries()].filter(([key, rows]) => rows.length > 1);

console.log(`active rows: ${active.length}`);
console.log(`same-date/team groups with 2+ rows: ${duplicateGroups.length}`);
console.log("Comparing rows inside groups...");

const candidates = [];

for (const [key, group] of duplicateGroups) {
  const rows = group.map(compact);

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];

      const tokenOverlap = overlap(a.tokens, b.tokens);
      const pickOverlap = overlap(a.pickSigs, b.pickSigs);
      const playerOverlap = overlap(a.players, b.players);

      const knownMatch = knownSlugs.includes(a.slug) || knownSlugs.includes(b.slug);

      const aAssetCount = Object.values(a.assetsReceived || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
      const bAssetCount = Object.values(b.assetsReceived || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);

      const complementaryPackage =
        a.players.length + a.pickSigs.length > 0 &&
        b.players.length + b.pickSigs.length > 0 &&
        (pickOverlap.length > 0 || playerOverlap.length > 0 || tokenOverlap.length > 0);

      const exactPackageSubset =
        subset(a.pickSigs, b.pickSigs) && subset(a.players, b.players) ||
        subset(b.pickSigs, a.pickSigs) && subset(b.players, a.players);

      const include =
        knownMatch ||
        tokenOverlap.length >= 2 ||
        pickOverlap.length >= 1 ||
        playerOverlap.length >= 1 ||
        complementaryPackage ||
        (group.length === 2 && aAssetCount > 0 && bAssetCount > 0);

      if (!include) continue;

      let keeper = a.score >= b.score ? a : b;
      let suppress = a.score >= b.score ? b : a;

      // Prefer suppressing lower-status / generic-looking row when scores are close.
      const aGeneric = /unspecified|undisclosed|unknown|future-draft-rights|rights-to-undisclosed/.test(a.slug);
      const bGeneric = /unspecified|undisclosed|unknown|future-draft-rights|rights-to-undisclosed/.test(b.slug);

      if (aGeneric !== bGeneric) {
        keeper = aGeneric ? b : a;
        suppress = aGeneric ? a : b;
      }

      let confidence = "review";
      let classification = "same-date-team-possible-duplicate";

      if (knownMatch) {
        confidence = "known";
        classification = "known-butch-johnson-pick-slug-duplicate";
      } else if (pickOverlap.length >= 1 && playerOverlap.length >= 1) {
        confidence = "high";
        classification = "same-date-team-player-and-pick-overlap-duplicate";
      } else if (tokenOverlap.length >= 3 || exactPackageSubset) {
        confidence = "high";
        classification = "same-date-team-package-overlap-duplicate";
      } else if (group.length === 2 && tokenOverlap.length >= 1) {
        confidence = "medium";
        classification = "same-date-team-two-row-likely-duplicate";
      } else if (group.length === 2 && aAssetCount > 0 && bAssetCount > 0) {
        confidence = "review";
        classification = "same-date-team-two-row-review";
      }

      candidates.push({
        classification,
        confidence,
        knownMatch,
        groupKey: key,
        groupSize: group.length,
        tokenOverlap,
        pickOverlap,
        playerOverlap,
        recommendedKeeper: { slug: keeper.slug, id: keeper.id },
        recommendedSuppress: { slug: suppress.slug, id: suppress.id },
        a,
        b,
        keeper,
        suppress
      });
    }
  }
}

candidates.sort((x, y) => {
  const rank = { known: 4, high: 3, medium: 2, review: 1 };
  if (rank[y.confidence] !== rank[x.confidence]) return rank[y.confidence] - rank[x.confidence];
  if ((y.knownMatch ? 1 : 0) !== (x.knownMatch ? 1 : 0)) return (y.knownMatch ? 1 : 0) - (x.knownMatch ? 1 : 0);
  return String(x.keeper.tradeDate).localeCompare(String(y.keeper.tradeDate));
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
  duplicateDateTeamGroups: duplicateGroups.length,
  knownSlugs,
  knownRows,
  candidateCount: candidates.length,
  byConfidence,
  candidates
}, null, 2));

console.log("");
console.log("AUDIT SAME-DATE/TEAM TRADE DUPLICATES");
console.log("=".repeat(80));
console.log(`active rows: ${active.length}`);
console.log(`same-date/team groups with 2+ rows: ${duplicateGroups.length}`);
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
  console.log(`${r.slug} | ${r.id} | ${r.tradeDate} | status=${r.publishStatus} | suppressed=${r.suppressed} | score=${r.score}`);
  console.log(`teams=${JSON.stringify(r.teams)}`);
  console.log(`players=${JSON.stringify(r.players)}`);
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
  console.log(`groupSize=${c.groupSize} | pickOverlap=${JSON.stringify(c.pickOverlap)} | playerOverlap=${JSON.stringify(c.playerOverlap)} | tokenOverlapCount=${c.tokenOverlap.length}`);
  console.log(`KEEP:     ${c.recommendedKeeper.slug} | ${c.recommendedKeeper.id}`);
  console.log(`SUPPRESS: ${c.recommendedSuppress.slug} | ${c.recommendedSuppress.id}`);
  console.log(`A: ${c.a.slug} | ${c.a.id} | status=${c.a.publishStatus} | players=${JSON.stringify(c.a.players)} | picks=${JSON.stringify(c.a.pickSigs)} | score=${c.a.score}`);
  console.log(`B: ${c.b.slug} | ${c.b.id} | status=${c.b.publishStatus} | players=${JSON.stringify(c.b.players)} | picks=${JSON.stringify(c.b.pickSigs)} | score=${c.b.score}`);
}
