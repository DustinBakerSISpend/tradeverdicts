const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const auditPath = path.join(process.cwd(), "audits", "audit-same-date-team-trade-duplicates.json");
const outPath = path.join(process.cwd(), "audits", "inspect-same-date-team-trade-duplicate-plan-v2.json");
const summaryPath = path.join(process.cwd(), "audits", "same-date-team-duplicate-plan-summary-v2.json");

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
  const s = String(text || "")
    .replace(/[-_]+/g, " ")
    .replace(/\(/g, " ")
    .replace(/\)/g, " ");

  let m;

  // 1985 third round pick (#82-Mike Kelley)
  const wordParenHash = /\b((?:19|20)\d{2})\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth)\s+round\s+pick\s+#?\s*(\d+)/gi;
  while ((m = wordParenHash.exec(s))) {
    out.add(`${m[1]}-R${roundWords[m[2].toLowerCase()]}-P${Number(m[3])}`);
  }

  // 2019 3rd round pick 94 / 2019 3rd round pick #94 / 2019 3rd round pick 94th overall
  const numeric = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)?\s+round\s+pick\s+#?\s*(\d+)(?:st|nd|rd|th)?(?:\s+overall)?/gi;
  while ((m = numeric.exec(s))) {
    out.add(`${m[1]}-R${Number(m[2])}-P${Number(m[3])}`);
  }

  // URL-ish: 2019 3rd round pick 94th overall
  const numericOverall = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)\s+round\s+pick\s+(\d+)(?:st|nd|rd|th)\s+overall/gi;
  while ((m = numericOverall.exec(s))) {
    out.add(`${m[1]}-R${Number(m[2])}-P${Number(m[3])}`);
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
      n.includes("future") ||
      n.includes("not specified in raw source")
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
  const text = String(sourceText(t) || "")
    .replace(/[-_]+/g, " ")
    .replace(/\(/g, " ")
    .replace(/\)/g, " ");

  let m;

  const afterPickNumber = /\b(?:19|20)\d{2}\s+(?:\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth)(?:st|nd|rd|th)?\s+round\s+pick\s+#?\s*\d+(?:st|nd|rd|th)?(?:\s+overall)?\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})/g;

  while ((m = afterPickNumber.exec(text))) {
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

  const suppressTrade = find(suppressSlug);
  if (suppressTrade?.suppressed === true) continue;

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

function rowLine(r) {
  return {
    classification: r.classification,
    confidence: r.confidence,
    keeper: `${r.keeper?.slug} | ${r.keeper?.id} | status=${r.keeper?.publishStatus}`,
    suppress: `${r.suppress?.slug} | ${r.suppress?.id} | status=${r.suppress?.publishStatus}`,
    suppressPlayers: (r.suppressPlayers || []).map(x => x.asset),
    suppressPicks: r.suppressPicks || [],
    keeperPicks: r.keeperPicks || [],
    flags: r.flags || []
  };
}

const butchRows = inspected.filter(r => {
  const slugs = [r.keeper?.slug, r.suppress?.slug].filter(Boolean);
  return slugs.includes("butch-johnson-houston-oilers-tennessee-titans-1984") ||
         slugs.includes("1985-third-round-pick-82-mike-kelley-c-denver-broncos-1984");
});

const byClassSafe = {};
for (const r of safe) byClassSafe[r.classification] = (byClassSafe[r.classification] || 0) + 1;

const byClassBlocked = {};
for (const r of blocked) byClassBlocked[r.classification] = (byClassBlocked[r.classification] || 0) + 1;

const byFlag = {};
for (const r of blocked) {
  for (const f of r.flags || []) {
    const key = f.split(":")[0];
    byFlag[key] = (byFlag[key] || 0) + 1;
  }
}

const full = {
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

const summary = {
  generatedAt: new Date().toISOString(),
  source: outPath,
  candidatesConsidered: candidateRows.length,
  dedupedCandidateCount: dedupe.size,
  conflictCount: conflicts.length,
  inspectedCount: inspected.length,
  safeCount: safe.length,
  blockedCount: blocked.length,
  safeByClass: byClassSafe,
  blockedByClass: byClassBlocked,
  blockedByFlag: byFlag,
  butchRows: butchRows.map(rowLine),
  blocked: blocked.map(rowLine),
  firstSafe: safe.slice(0, 50).map(rowLine)
};

fs.writeFileSync(outPath, JSON.stringify(full, null, 2));
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log("");
console.log("INSPECT SAME-DATE/TEAM TRADE DUPLICATE PLAN V2");
console.log("=".repeat(80));
console.log(`candidates considered: ${candidateRows.length}`);
console.log(`deduped candidates: ${dedupe.size}`);
console.log(`conflicts: ${conflicts.length}`);
console.log(`inspected: ${inspected.length}`);
console.log(`safe: ${safe.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`Report: ${outPath}`);
console.log(`Summary: ${summaryPath}`);

console.log("");
console.log("Butch row:");
for (const r of butchRows.map(rowLine)) {
  console.log("-".repeat(80));
  console.log(`KEEP:     ${r.keeper}`);
  console.log(`SUPPRESS: ${r.suppress}`);
  console.log(`keeperPicks=${JSON.stringify(r.keeperPicks)}`);
  console.log(`suppressPicks=${JSON.stringify(r.suppressPicks)}`);
  console.log(`flags=${JSON.stringify(r.flags)}`);
}

console.log("");
console.log("Counts:");
console.log(`safeByClass=${JSON.stringify(byClassSafe)}`);
console.log(`blockedByClass=${JSON.stringify(byClassBlocked)}`);
console.log(`blockedByFlag=${JSON.stringify(byFlag)}`);

console.log("");
console.log("First 30 safe rows:");
for (const r of safe.slice(0, 30).map(rowLine)) {
  console.log("-".repeat(80));
  console.log(`KEEP:     ${r.keeper}`);
  console.log(`SUPPRESS: ${r.suppress}`);
  console.log(`keeperPicks=${JSON.stringify(r.keeperPicks)}`);
  console.log(`suppressPicks=${JSON.stringify(r.suppressPicks)}`);
  console.log(`flags=${JSON.stringify(r.flags)}`);
}

console.log("");
console.log("Blocked rows:");
for (const r of blocked.slice(0, 80).map(rowLine)) {
  console.log("-".repeat(80));
  console.log(`FLAGS: ${JSON.stringify(r.flags)}`);
  console.log(`KEEP:     ${r.keeper}`);
  console.log(`SUPPRESS: ${r.suppress}`);
  console.log(`keeperPicks=${JSON.stringify(r.keeperPicks)}`);
  console.log(`suppressPicks=${JSON.stringify(r.suppressPicks)}`);
}
