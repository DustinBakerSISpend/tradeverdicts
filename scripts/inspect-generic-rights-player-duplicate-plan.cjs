const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "suppress-safe-generic-rights-player-duplicates-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "inspect-generic-rights-player-duplicate-plan.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
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

function concretePlayerAssets(t) {
  const out = [];

  for (const item of assetEntries(t)) {
    const type = String(item.type || "").toLowerCase();
    const text = norm(item.asset);

    if (type !== "player") continue;
    if (!text) continue;

    if (
      text.includes("undisclosed") ||
      text.includes("unknown") ||
      text.includes("consideration") ||
      text.includes("rights") ||
      text.includes("draft") ||
      text.includes("future")
    ) continue;

    out.push({
      team: item.team,
      asset: item.asset,
      key: text
    });
  }

  return out;
}

function pickSigsFromText(text) {
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

function pickSigs(t) {
  return pickSigsFromText(JSON.stringify(t?.assetsReceived || {}));
}

function coversPlayer(keeper, playerKey) {
  return norm(blob(keeper)).includes(norm(playerKey));
}

function compact(t) {
  if (!t) return null;

  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: t.tradeDate || t.date || null,
    teams: t.teams || [],
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null,
    concretePlayerAssets: concretePlayerAssets(t),
    pickSigs: pickSigs(t)
  };
}

const inspected = [];
const safe = [];
const blocked = [];

for (const p of plan.plannedSuppressions || []) {
  const keeper = find(p.keeper.slug);
  const suppress = find(p.suppress.slug);

  const keeperCompact = compact(keeper);
  const suppressCompact = compact(suppress);

  const suppressPlayers = concretePlayerAssets(suppress);
  const keeperPicks = new Set(pickSigs(keeper));
  const suppressPicks = pickSigs(suppress);

  const uniquePlayers = suppressPlayers.filter(x => !coversPlayer(keeper, x.key));
  const uniquePicks = suppressPicks.filter(sig => !keeperPicks.has(sig));

  const flags = [];

  if (!keeper) flags.push("missing keeper");
  if (!suppress) flags.push("missing suppress target");
  if (keeper?.suppressed === true) flags.push("keeper already suppressed");
  if (suppress?.suppressed === true) flags.push("suppress target already suppressed");
  if (!["ready", "publish"].includes(keeper?.publishStatus)) flags.push(`keeper status ${keeper?.publishStatus}`);
  if (uniquePlayers.length) flags.push(`suppress has unique player assets not visible in keeper: ${uniquePlayers.map(x => x.asset).join("; ")}`);
  if (uniquePicks.length) flags.push(`suppress has unique pick signatures not visible in keeper: ${uniquePicks.join(", ")}`);

  const row = {
    originalReason: p.reason,
    flags,
    safeToSuppress: flags.length === 0,
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
  sourcePlan: planPath,
  inspectedCount: inspected.length,
  safeCount: safe.length,
  blockedCount: blocked.length,
  safe,
  blocked,
  inspected
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log("");
console.log("INSPECT GENERIC-RIGHTS PLAYER DUPLICATE PLAN");
console.log("=".repeat(80));
console.log(`inspected: ${inspected.length}`);
console.log(`safe: ${safe.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("SAFE:");
for (const r of safe) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`KEEP:     ${r.keeper.slug} | ${r.keeper.id} | status=${r.keeper.publishStatus}`);
  console.log(`SUPPRESS: ${r.suppress.slug} | ${r.suppress.id} | status=${r.suppress.publishStatus}`);
  console.log(`suppressPlayers=${JSON.stringify(r.suppressPlayers.map(x => x.asset))}`);
  console.log(`suppressPicks=${JSON.stringify(r.suppressPicks)}`);
}

console.log("");
console.log("BLOCKED:");
for (const r of blocked) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`FLAGS: ${r.flags.join(" | ")}`);
  console.log(`KEEP:     ${r.keeper?.slug} | ${r.keeper?.id} | status=${r.keeper?.publishStatus}`);
  console.log(`SUPPRESS: ${r.suppress?.slug} | ${r.suppress?.id} | status=${r.suppress?.publishStatus}`);
  console.log("KEEPER assets:");
  console.dir(r.keeper?.assetsReceived, { depth: null });
  console.log("SUPPRESS assets:");
  console.dir(r.suppress?.assetsReceived, { depth: null });
  console.log("KEEPER summary:");
  console.log(r.keeper?.summary || "(none)");
  console.log("SUPPRESS summary:");
  console.log(r.suppress?.summary || "(none)");
}
