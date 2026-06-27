const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const auditPath = path.join(process.cwd(), "audits", "audit-same-date-team-trade-duplicates.json");
const outPath = path.join(process.cwd(), "audits", "inspect-same-date-team-trade-duplicate-plan.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;
const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function dateOf(t) {
  return t?.tradeDate || t?.date || "";
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

function sourceText(t) {
  return [
    t?.id,
    t?.slug,
    t?.tradeDate,
    t?.date,
    t?.summary,
    t?.qaNotes,
    JSON.stringify(t?.teams || []),
    JSON.stringify(t?.assetsReceived || {})
  ].join(" ");
}

function blobHas(t, phrase) {
  const b = norm(sourceText(t));
  const p = norm(phrase);
  if (!p) return true;
  return b.includes(p);
}

function sameTeamSet(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
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

function pickSigsFromText(text) {
  const out = new Set();
  const cleaned = String(text || "").replace(/[-_]+/g, " ");
  let m;

  const numericOverall = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)?\s+round\s+pick\s+(?:#?\s*)?(\d+)(?:st|nd|rd|th)?(?:\s+overall)?/gi;
  while ((m = numericOverall.exec(cleaned))) {
    out.add(`${m[1]}-R${Number(m[2])}-P${Number(m[3])}`);
  }

  const wordRound = /\b((?:19|20)\d{2})\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth)\s+round\s+pick\s+(?:#?\s*)?(\d+)(?:st|nd|rd|th)?(?:\s+overall)?/gi;
  while ((m = wordRound.exec(cleaned))) {
    out.add(`${m[1]}-R${roundWords[m[2].toLowerCase()]}-P${Number(m[3])}`);
  }

  return [...out].sort();
}

function pickSigs(t) {
  return pickSigsFromText(sourceText(t));
}

function assetEntries(t) {
  const out = [];
  for (const [team, assets] of Object.entries(t?.assetsReceived || {})) {
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

function playerAssets(t) {
  const out = [];

  for (const item of assetEntries(t)) {
    if (String(item.type || "").toLowerCase() !== "player") continue;

    const n = norm(item.asset);
    if (!n) continue;

    if (
      n.includes("undisclosed") ||
      n.includes("unknown") ||
      n.includes("consideration") ||
      n.includes("draft") ||
      n.includes("pick") ||
      n.includes("rights") ||
      n.includes("future")
    ) continue;

    out.push({
      team: item.team,
      asset: item.asset,
      key: n
        .replace(/\b(jr|sr|ii|iii|iv|v|a|b|c)\b/g, "")
        .replace(/\s+/g, " ")
        .trim()
    });
  }

  return out;
}

function namesAfterPickNumbers(t) {
  const out = [];
  const text = String(sourceText(t) || "").replace(/[-_]+/g, " ");
  let m;

  const afterNumber = /\b(?:19|20)\d{2}\s+(?:\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth)(?:st|nd|rd|th)?\s+round\s+pick\s+(?:#?\s*)?\d+(?:st|nd|rd|th)?(?:\s+overall)?\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})/g;

  while ((m = afterNumber.exec(text))) {
    const key = norm(m[1])
      .replace(/\b(jr|sr|ii|iii|iv|v|a|b|c)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (key && key.split(" ").length >= 2) {
      out.push({
        asset: m[1],
        key
      });
    }
  }

  return out;
}

function uniqueByKey(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r.key || seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out;
}

function compact(t) {
  if (!t) return null;

  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    teams: t.teams || [],
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null,
    playerAssets: playerAssets(t),
    pickNames: namesAfterPickNumbers(t),
    pickSigs: pickSigs(t)
  };
}

const candidateRows = (audit.candidates || []).filter(c => {
  return c.confidence === "known" || c.confidence === "high";
});

const dedupe = new Map();
const conflicts = [];

for (const c of candidateRows) {
  const keeperSlug = c.recommendedKeeper?.slug;
  const suppressSlug = c.recommendedSuppress?.slug;

  if (!keeperSlug || !suppressSlug || keeperSlug === suppressSlug) continue;

  if (dedupe.has(suppressSlug)) {
    const existing = dedupe.get(suppressSlug);
    if (existing.recommendedKeeper?.slug !== keeperSlug) {
      conflicts.push({
        suppressSlug,
        existingKeeper: existing.recommendedKeeper?.slug,
        newKeeper: keeperSlug,
        candidate: c
      });
    }
    continue;
  }

  dedupe.set(suppressSlug, c);
}

const inspected = [];
const safe = [];
const blocked = [];

for (const c of dedupe.values()) {
  const keeper = find(c.recommendedKeeper.slug);
  const suppress = find(c.recommendedSuppress.slug);

  const keeperCompact = compact(keeper);
  const suppressCompact = compact(suppress);

  const flags = [];

  if (!keeper) flags.push("missing keeper");
  if (!suppress) flags.push("missing suppress target");

  if (keeper && suppress) {
    if (keeper.suppressed === true) flags.push("keeper already suppressed");
    if (suppress.suppressed === true) flags.push("suppress target already suppressed");

    if (!["ready", "publish"].includes(keeper.publishStatus)) {
      flags.push(`keeper status ${keeper.publishStatus}`);
    }

    if (dateOf(keeper) !== dateOf(suppress)) {
      flags.push(`date mismatch keeper=${dateOf(keeper)} suppress=${dateOf(suppress)}`);
    }

    if (!sameTeamSet(keeper.teams || [], suppress.teams || [])) {
      flags.push("team set mismatch");
    }
  }

  const suppressPicks = suppress ? pickSigs(suppress) : [];
  const keeperPicks = new Set(keeper ? pickSigs(keeper) : []);

  const suppressPlayers = suppress
    ? uniqueByKey([...playerAssets(suppress), ...namesAfterPickNumbers(suppress)])
    : [];

  const uniquePicks = suppressPicks.filter(sig => !keeperPicks.has(sig));
  const uniquePlayers = suppressPlayers.filter(p => keeper && !blobHas(keeper, p.key));

  if (uniquePicks.length) {
    flags.push(`suppress has pick signatures not visible in keeper: ${uniquePicks.join(", ")}`);
  }

  if (uniquePlayers.length) {
    flags.push(`suppress has player/name tokens not visible in keeper: ${uniquePlayers.map(x => x.asset).join("; ")}`);
  }

  const row = {
    classification: c.classification,
    confidence: c.confidence,
    groupSize: c.groupSize,
    pickOverlap: c.pickOverlap || [],
    playerOverlap: c.playerOverlap || [],
    tokenOverlap: c.tokenOverlap || [],
    safeToSuppress: flags.length === 0,
    flags,
    keeper: keeperCompact,
    suppress: suppressCompact,
    suppressPlayers,
    suppressPicks,
    keeperPicks: [...keeperPicks].sort(),
    uniquePlayers,
    uniquePicks
  };

  inspected.push(row);

  if (flags.length) blocked.push(row);
  else safe.push(row);
}

const output = {
  generatedAt: new Date().toISOString(),
  sourceAudit: auditPath,
  candidatesConsidered: candidateRows.length,
  dedupedCandidateCount: dedupe.size,
  conflictCount: conflicts.length,
  inspectedCount: inspected.length,
  safeCount: safe.length,
  blockedCount: blocked.length,
  conflicts,
  safe,
  blocked,
  inspected
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log("");
console.log("INSPECT SAME-DATE/TEAM TRADE DUPLICATE PLAN");
console.log("=".repeat(80));
console.log(`candidates considered: ${candidateRows.length}`);
console.log(`deduped candidates: ${dedupe.size}`);
console.log(`conflicts: ${conflicts.length}`);
console.log(`inspected: ${inspected.length}`);
console.log(`safe: ${safe.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("SAFE suppressions:");
for (const r of safe.slice(0, 120)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${r.classification} | confidence=${r.confidence}`);
  console.log(`KEEP:     ${r.keeper.slug} | ${r.keeper.id} | status=${r.keeper.publishStatus}`);
  console.log(`SUPPRESS: ${r.suppress.slug} | ${r.suppress.id} | status=${r.suppress.publishStatus}`);
  console.log(`suppressPlayers=${JSON.stringify(r.suppressPlayers.map(x => x.asset))}`);
  console.log(`suppressPicks=${JSON.stringify(r.suppressPicks)}`);
}

console.log("");
console.log("BLOCKED:");
for (const r of blocked.slice(0, 80)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`FLAGS: ${r.flags.join(" | ")}`);
  console.log(`${r.classification} | confidence=${r.confidence}`);
  console.log(`KEEP:     ${r.keeper?.slug} | ${r.keeper?.id} | status=${r.keeper?.publishStatus}`);
  console.log(`SUPPRESS: ${r.suppress?.slug} | ${r.suppress?.id} | status=${r.suppress?.publishStatus}`);
  console.log(`uniquePlayers=${JSON.stringify(r.uniquePlayers.map(x => x.asset))}`);
  console.log(`uniquePicks=${JSON.stringify(r.uniquePicks)}`);
  console.log("KEEPER assets:");
  console.dir(r.keeper?.assetsReceived, { depth: null });
  console.log("SUPPRESS assets:");
  console.dir(r.suppress?.assetsReceived, { depth: null });
}
