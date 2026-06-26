const fs = require("fs");
const path = require("path");

const IN = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const OUT = path.join(process.cwd(), "src", "data", "nfl", "same-player-date-overlap-audit.json");

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

function normTeam(t, date) {
  const year = Number(String(date || "").slice(0, 4));
  const x = norm(t);
  if (!x) return "";
  if (x === "unknown team" || x === "unknown-team") return "unknown-team";

  // AFL-era alias cleanup for audit only
  if (year <= 1962 && x === "tennessee titans") return "new-york-jets";
  if (year <= 1962 && x === "houston texans") return "kansas-city-chiefs";

  return x.replace(/\s+/g, "-");
}

function getPlayers(trade) {
  const players = [];

  const received = trade.assetsReceived || {};
  for (const assets of Object.values(received)) {
    if (!Array.isArray(assets)) continue;
    for (const a of assets) {
      if (a && a.type === "player" && a.asset) players.push(norm(a.asset));
    }
  }

  return [...new Set(players)].filter(Boolean);
}

function textBlob(t) {
  return [
    t.id,
    t.slug,
    t.title,
    t.summary,
    t.analysis,
    t.verdict,
    JSON.stringify(t.assetsReceived || {})
  ].join(" ").toLowerCase();
}

function hasPlaceholder(t) {
  return /placeholder|tbd|todo|unknown asset|unspecified consideration|undisclosed consideration/.test(textBlob(t));
}

function hasTruncation(t) {
  return /\.\.\.|…/.test([t.summary, t.analysis].join(" "));
}

function hasDownstream(t) {
  return /subsequently traded|later traded|pick was later|eventually became|used to select|selected with/.test(textBlob(t));
}

function badSlug(t) {
  return /unspecified-consideration|undisclosed-consideration|failed-physical|voided|involving|conditional|condition|future-pick/.test(t.slug || "");
}

function score(t, teams, players) {
  let s = 0;

  if (teams.length === 2 && !teams.includes("unknown-team")) s += 30;
  if (players.length) s += 15;
  if (!hasPlaceholder(t)) s += 10;
  if (!hasTruncation(t)) s += 10;
  if (t.summary && t.summary.length > 80) s += 8;
  if (t.analysis && t.analysis.length > 120) s += 8;
  if (t.slug && /^[a-z]+-[a-z]+/.test(t.slug)) s += 8;

  if (teams.includes("unknown-team")) s -= 40;
  if (teams.length < 2) s -= 35;
  if (hasPlaceholder(t)) s -= 30;
  if (hasTruncation(t)) s -= 20;
  if (hasDownstream(t)) s -= 25;
  if (badSlug(t)) s -= 25;
  if (/\d+(st|nd|rd|th)-round-pick/.test(t.slug || "")) s -= 15;

  return s;
}

const records = trades.map(t => {
  const date = t.tradeDate;
  const teams = [...new Set((t.teams || []).map(team => normTeam(team, date)).filter(Boolean))];
  const players = getPlayers(t);

  return {
    id: t.id,
    slug: t.slug,
    tradeDate: date,
    teams,
    players,
    score: score(t, teams, players),
    hasPlaceholder: hasPlaceholder(t),
    hasTruncation: hasTruncation(t),
    hasDownstream: hasDownstream(t),
    suppressed: !!t.suppressed
  };
}).filter(r => r.tradeDate && r.players.length && !r.suppressed);

const byDatePlayer = new Map();

for (const r of records) {
  for (const p of r.players) {
    const key = `${r.tradeDate}|||${p}`;
    if (!byDatePlayer.has(key)) byDatePlayer.set(key, []);
    byDatePlayer.get(key).push(r);
  }
}

function classify(group) {
  const sorted = [...group].sort((a, b) => b.score - a.score);
  const keep = sorted[0];
  const suppress = sorted.slice(1);

  const reasons = new Set();

  for (const r of suppress) {
    if (r.hasDownstream) reasons.add("downstream-pick contamination");
    if (r.hasPlaceholder || badSlug(r)) reasons.add("placeholder duplicate");
    if (r.teams.length < 2 || r.teams.includes("unknown-team")) reasons.add("one-team corrupt");
  }

  const gap = keep.score - Math.max(...suppress.map(r => r.score));
  const safe = gap >= 25;

  let bucket = "needsResearch";
  if (safe && [...reasons].some(x => x.includes("downstream"))) bucket = "downstreamPickContamination";
  else if (safe && [...reasons].some(x => x.includes("placeholder"))) bucket = "placeholderDuplicate";
  else if (safe && [...reasons].some(x => x.includes("one-team"))) bucket = "oneTeamCorrupt";
  else if (safe) bucket = "safeSuppressCandidates";

  return {
    bucket,
    confidence: safe ? "high" : "research",
    player: keep.players.find(p => group.every(g => g.players.includes(p))) || "",
    tradeDate: keep.tradeDate,
    keep,
    suppressCandidates: suppress.map(r => ({
      ...r,
      overlapTeamsWithKeep: r.teams.filter(t => keep.teams.includes(t)),
      reason: [...reasons].join("; ") || "same player/date overlap with different team sets"
    })),
    reason: [...reasons].join("; ") || "same player/date overlap with different team sets",
    records: sorted
  };
}

const groups = [];

for (const group of byDatePlayer.values()) {
  if (group.length < 2) continue;

  const teamSets = new Set(group.map(g => g.teams.slice().sort().join("|")));
  if (teamSets.size < 2) continue;

  const hasRealTeamOverlap = group.some((a, i) =>
    group.some((b, j) =>
      i < j && a.teams.some(t => t !== "unknown-team" && b.teams.includes(t))
    )
  );

  if (!hasRealTeamOverlap) continue;

  groups.push(classify(group));
}

const buckets = {
  safeSuppressCandidates: [],
  downstreamPickContamination: [],
  placeholderDuplicate: [],
  syntheticTeamDuplicate: [],
  oneTeamCorrupt: [],
  aliasFalsePositive: [],
  needsResearch: []
};

for (const g of groups) buckets[g.bucket].push(g);

const report = {
  generatedAt: new Date().toISOString(),
  totalTradesScanned: records.length,
  totalGroups: groups.length,
  counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  top20HighestConfidenceSuppressionCandidates: groups
    .filter(g => g.confidence === "high")
    .flatMap(g => g.suppressCandidates.map(s => ({
      bucket: g.bucket,
      player: g.player,
      date: g.tradeDate,
      keep: g.keep.slug,
      suppress: s.slug,
      keepScore: g.keep.score,
      suppressScore: s.score,
      scoreGap: g.keep.score - s.score,
      reason: s.reason
    })))
    .sort((a, b) => b.scoreGap - a.scoreGap)
    .slice(0, 20),
  buckets
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`Wrote ${OUT}`);
console.log(`totalTradesScanned: ${report.totalTradesScanned}`);
console.log(`totalGroups: ${report.totalGroups}`);
console.log(report.counts);
console.log("Top 20:");
for (const r of report.top20HighestConfidenceSuppressionCandidates) {
  console.log(`- ${r.player} ${r.date} | KEEP ${r.keep} | SUPPRESS ${r.suppress} | gap ${r.scoreGap} | ${r.bucket}`);
}
