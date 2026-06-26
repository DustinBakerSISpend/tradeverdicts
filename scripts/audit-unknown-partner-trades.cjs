const fs = require("fs");
const path = require("path");

const IN = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const OUT = path.join(process.cwd(), "src", "data", "nfl", "unknown-partner-audit.json");

const trades = JSON.parse(fs.readFileSync(IN, "utf8"));

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getPlayers(t) {
  const out = [];
  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;
    for (const a of assets) {
      if (a?.type === "player" && a.asset) out.push(norm(a.asset));
    }
  }
  return [...new Set(out)].filter(Boolean);
}

function isUnknownPartnerTrade(t) {
  const slug = String(t.slug || "").toLowerCase();
  const teams = t.teams || [];
  return (
    slug.includes("unknown-partner") ||
    slug.includes("review-needed") ||
    teams.length < 2 ||
    teams.some(x => String(x).toLowerCase().includes("unknown"))
  );
}

function overlap(a, b) {
  return a.some(x => b.includes(x));
}

const active = trades.filter(t => !t.suppressed);
const unknowns = active.filter(isUnknownPartnerTrade).map(t => ({
  id: t.id,
  slug: t.slug,
  tradeDate: t.tradeDate,
  teams: t.teams || [],
  players: getPlayers(t),
  summary: t.summary || "",
  analysis: t.analysis || ""
}));

const canonicals = active.filter(t => !isUnknownPartnerTrade(t)).map(t => ({
  id: t.id,
  slug: t.slug,
  tradeDate: t.tradeDate,
  teams: t.teams || [],
  players: getPlayers(t)
}));

const rows = [];

for (const u of unknowns) {
  const matches = canonicals.filter(c =>
    c.tradeDate === u.tradeDate &&
    overlap(u.players, c.players) &&
    overlap(u.teams, c.teams)
  );

  const best = matches[0] || null;

  let bucket = "needsResearch";
  let confidence = "research";
  let reason = "unknown-partner/one-team trade with no canonical same-date/player/team match";

  if (best) {
    bucket = "safeSuppressCandidates";
    confidence = "high";
    reason = "same date + overlapping player + overlapping team + canonical trade exists";
  }

  rows.push({
    bucket,
    confidence,
    suppressCandidate: u.slug,
    suppressId: u.id,
    keepCandidate: best?.slug || null,
    keepId: best?.id || null,
    tradeDate: u.tradeDate,
    teams: u.teams,
    players: u.players,
    reason
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  unknownPartnerTradesScanned: unknowns.length,
  safeSuppressCandidates: rows.filter(r => r.bucket === "safeSuppressCandidates").length,
  needsResearch: rows.filter(r => r.bucket === "needsResearch").length,
  top50SafeSuppressCandidates: rows
    .filter(r => r.bucket === "safeSuppressCandidates")
    .slice(0, 50),
  buckets: {
    safeSuppressCandidates: rows.filter(r => r.bucket === "safeSuppressCandidates"),
    needsResearch: rows.filter(r => r.bucket === "needsResearch")
  }
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`Wrote ${OUT}`);
console.log(`unknownPartnerTradesScanned: ${report.unknownPartnerTradesScanned}`);
console.log(`safeSuppressCandidates: ${report.safeSuppressCandidates}`);
console.log(`needsResearch: ${report.needsResearch}`);
console.table(report.top50SafeSuppressCandidates.slice(0, 25).map(r => ({
  date: r.tradeDate,
  keep: r.keepCandidate,
  suppress: r.suppressCandidate,
  reason: r.reason
})));
