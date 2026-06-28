const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const playersPath = path.join("src", "data", "nfl", "players.json");

const tradesRaw = JSON.parse(fs.readFileSync(tradesPath, "utf8"));
const trades = Array.isArray(tradesRaw) ? tradesRaw : tradesRaw.trades || Object.values(tradesRaw).filter(Boolean);

const players = fs.existsSync(playersPath)
  ? JSON.parse(fs.readFileSync(playersPath, "utf8"))
  : [];

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compact(value) {
  return normalize(value).replace(/\s+/g, "");
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

function getDate(trade) {
  return String(
    trade.tradeDate ||
    trade.date ||
    trade.transactionDate ||
    trade.completedDate ||
    ""
  );
}

function getTeams(trade) {
  const teams = trade.teams || trade.teamNames || trade.teamKeys || trade.participants || [];
  return Array.isArray(teams) ? teams.map(String).sort() : [];
}

function getStatusText(trade) {
  return normalize([
    trade.status,
    trade.publicStatus,
    trade.visibility,
    trade.pageStatus,
    trade.state,
    safeJson(trade.flags),
    safeJson(trade.tags),
  ].join(" "));
}

function isSuppressedLike(trade) {
  const text = getStatusText(trade);

  return (
    trade.suppressed === true ||
    trade.hidden === true ||
    trade.holdConflict === true ||
    text.includes("suppressed") ||
    text.includes("hidden") ||
    text.includes("hold conflict") ||
    text.includes("holdconflict")
  );
}

function recordText(trade) {
  const perspectivePublicText = Array.isArray(trade.perspectives)
    ? trade.perspectives.flatMap((perspective) => [
        perspective.primarySummary,
        perspective.partnerSummary,
        perspective.verdict,
        perspective.publishStatus,
      ])
    : [];

  return [
    trade.slug,
    trade.title,
    trade.headline,
    trade.name,
    trade.summary,
    trade.description,
    trade.shortSummary,
    trade.verdict,
    trade.outcome,
    safeJson(trade.teams),
    safeJson(trade.teamNames),
    safeJson(trade.teamKeys),
    safeJson(trade.assets),
    safeJson(trade.sides),
    ...perspectivePublicText,
  ].join(" ");
}
function pushGroup(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}


const active = trades.filter((trade) => !isSuppressedLike(trade));
const suppressed = trades.filter(isSuppressedLike);

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, "-");
const jsonOut = path.join("audit", "reports", `public-qa-rebaseline-${stamp}.json`);
const mdOut = path.join("audit", "reports", `public-qa-rebaseline-${stamp}.md`);

const slugGroups = new Map();
for (const trade of trades) {
  pushGroup(slugGroups, String(trade.slug || ""), trade);
}

const duplicateSlugs = [...slugGroups.entries()]
  .filter(([slug, rows]) => slug && rows.length > 1)
  .map(([slug, rows]) => ({
    slug,
    count: rows.length,
    rows: rows.map((trade) => ({
      id: trade.id || trade.tradeId || null,
      date: getDate(trade),
      teams: getTeams(trade),
      suppressedLike: isSuppressedLike(trade),
      summary: trade.summary || trade.description || "",
    })),
  }));

const badTextPatterns = [
  { key: "ellipsis", re: /\.{3}|…/i },
  { key: "undefined-token", re: /\bundefined\b/i },
  { key: "null-token", re: /\bnull\b/i, ignore: /\bkeith null\b/i },
  { key: "not-clearly-specified", re: /not clearly specified/i },
  { key: "public-outcome-template", re: /public outcome review confirms|listed grade and verdict based on available trade data/i },
  { key: "unknown-not-disclosed", re: /unknown not disclosed|unknown\/not disclosed/i },
];

const activeTextResidue = [];
for (const trade of active) {
  const text = recordText(trade);
  const hits = badTextPatterns.filter((p) => p.re.test(text) && !(p.ignore && p.ignore.test(text))).map((p) => p.key);

  if (hits.length) {
    activeTextResidue.push({
      slug: trade.slug,
      id: trade.id || trade.tradeId || null,
      date: getDate(trade),
      teams: getTeams(trade),
      hits,
      summary: trade.summary || trade.description || "",
    });
  }
}

const activeNoUsefulSummary = active
  .filter((trade) => !String(trade.summary || trade.description || trade.shortSummary || "").trim())
  .map((trade) => ({
    slug: trade.slug,
    id: trade.id || trade.tradeId || null,
    date: getDate(trade),
    teams: getTeams(trade),
  }));

const genericSlugRe = /(unknown-partner|not-specified|unspecified-consideration|undisclosed-consideration|future-draft-rights|rights-to-undisclosed|draft-pick-new-york|draft-pick-chicago|draft-pick-green-bay|draft-pick-houston|reviewed-and-retained)/i;

const activeGenericSlugCandidates = active
  .filter((trade) => genericSlugRe.test(String(trade.slug || "")))
  .map((trade) => ({
    slug: trade.slug,
    id: trade.id || trade.tradeId || null,
    date: getDate(trade),
    teams: getTeams(trade),
    summary: trade.summary || trade.description || "",
  }));

const exactSummaryGroups = new Map();
for (const trade of active) {
  const summary = normalize(trade.summary || trade.description || trade.shortSummary || "");
  if (!summary) continue;

  const key = [
    getDate(trade),
    getTeams(trade).join("|"),
    compact(summary),
  ].join("::");

  pushGroup(exactSummaryGroups, key, trade);
}

const activeExactSummaryDuplicates = [...exactSummaryGroups.values()]
  .filter((rows) => rows.length > 1)
  .map((rows) => ({
    count: rows.length,
    date: getDate(rows[0]),
    teams: getTeams(rows[0]),
    rows: rows.map((trade) => ({
      slug: trade.slug,
      id: trade.id || trade.tradeId || null,
      summary: trade.summary || trade.description || "",
      suppressedLike: isSuppressedLike(trade),
    })),
  }));

const sameDateTeamGroupsMap = new Map();
for (const trade of active) {
  const date = getDate(trade);
  const teams = getTeams(trade);

  if (!date || teams.length < 2) continue;

  const key = [date, teams.join("|")].join("::");
  pushGroup(sameDateTeamGroupsMap, key, trade);
}

const activeSameDateTeamGroups = [...sameDateTeamGroupsMap.values()]
  .filter((rows) => rows.length > 1)
  .sort((a, b) => b.length - a.length)
  .slice(0, 250)
  .map((rows) => ({
    count: rows.length,
    date: getDate(rows[0]),
    teams: getTeams(rows[0]),
    rows: rows.map((trade) => ({
      slug: trade.slug,
      id: trade.id || trade.tradeId || null,
      summary: trade.summary || trade.description || "",
    })),
  }));


function isPublicPlayerRecord(player) {
  const name = String(player?.name || "").trim();
  const slug = String(player?.slug || "").trim();

  if (!name || !slug) return false;
  if (/^(?:undisclosed|undisclosed consideration|undisclosed compensation|undisclosed terms|undisclosed historical consideration|unspecified consideration|no consideration recorded|not conveyed|not clearly specified in source|player to be named later|player\(s\) to be named later|undisclosed terms \(undisclosed|player to be named later \(undisclosed|player\(s\) to be named later \(undisclosed|player to be named later \(jack zilly on 03-17)$/i.test(name)) return false;
  if (/^(?:undisclosed|undisclosed-consideration|undisclosed-compensation|undisclosed-terms|undisclosed-historical-consideration|unspecified-consideration|no-consideration-recorded|not-conveyed|not-clearly-specified-in-source|player-to-be-named-later|player-s-to-be-named-later)/i.test(slug)) return false;
  if (/^(?:undisclosed|unknown|not clearly specified|not conveyed|no consideration|player(?:\(s\))? to be named later)/i.test(name)) return false;

  return true;
}

const pseudoPlayerRe = /(undisclosed|unknown|not specified|not clearly specified|not conveyed|consideration|terms|future draft rights|rights to undisclosed|player to be named later|ptbnl)/i;

const suspectPlayers = Array.isArray(players)
  ? players
      .filter(isPublicPlayerRecord)
      .filter((player) => pseudoPlayerRe.test(String(player.name || player.slug || "")))
      .map((player) => ({
        name: player.name,
        slug: player.slug,
        tradeCount: player.tradeSlugs?.length || player.trades?.length || player.count || 0,
      }))
      .sort((a, b) => b.tradeCount - a.tradeCount)
      .slice(0, 100)
  : [];

const report = {
  generatedAt: now.toISOString(),
  counts: {
    totalTrades: trades.length,
    activePublicTrades: active.length,
    suppressedLikeTrades: suppressed.length,
    duplicateSlugGroups: duplicateSlugs.length,
    activeTextResidue: activeTextResidue.length,
    activeNoUsefulSummary: activeNoUsefulSummary.length,
    activeGenericSlugCandidates: activeGenericSlugCandidates.length,
    activeExactSummaryDuplicateGroups: activeExactSummaryDuplicates.length,
    activeSameDateTeamGroupsReturned: activeSameDateTeamGroups.length,
    suspectPseudoPlayersReturned: suspectPlayers.length,
  },
  duplicateSlugs,
  activeTextResidue,
  activeNoUsefulSummary,
  activeGenericSlugCandidates,
  activeExactSummaryDuplicates,
  activeSameDateTeamGroups,
  suspectPlayers,
};

fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));

const md = [
  "# TradeVerdicts Public QA Rebaseline",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  "## Counts",
  "",
  `- Total trade rows: ${report.counts.totalTrades}`,
  `- Active public trades: ${report.counts.activePublicTrades}`,
  `- Suppressed/hidden/hold-like trades: ${report.counts.suppressedLikeTrades}`,
  `- Duplicate slug groups: ${report.counts.duplicateSlugGroups}`,
  `- Active text residue rows: ${report.counts.activeTextResidue}`,
  `- Active rows with no useful summary: ${report.counts.activeNoUsefulSummary}`,
  `- Active generic slug candidates: ${report.counts.activeGenericSlugCandidates}`,
  `- Active exact summary duplicate groups: ${report.counts.activeExactSummaryDuplicateGroups}`,
  `- Active same-date/team groups returned: ${report.counts.activeSameDateTeamGroupsReturned}`,
  `- Suspect pseudo-player records returned: ${report.counts.suspectPseudoPlayersReturned}`,
  "",
  "## Top Active Text Residue",
  "",
  ...activeTextResidue.slice(0, 25).map((row, i) =>
    `${i + 1}. ${row.slug} — ${row.hits.join(", ")}`
  ),
  "",
  "## Top Generic Slug Candidates",
  "",
  ...activeGenericSlugCandidates.slice(0, 25).map((row, i) =>
    `${i + 1}. ${row.slug}`
  ),
  "",
  "## Top Same-Date/Team Groups",
  "",
  ...activeSameDateTeamGroups.slice(0, 20).map((group, i) =>
    `${i + 1}. ${group.date} | ${group.teams.join(" vs ")} | ${group.count} rows`
  ),
  "",
  "## Top Suspect Pseudo-Players",
  "",
  ...suspectPlayers.slice(0, 25).map((player, i) =>
    `${i + 1}. ${player.name || player.slug} — ${player.tradeCount} trades`
  ),
  "",
  `Full JSON: ${jsonOut}`,
  "",
].join("\n");

fs.writeFileSync(mdOut, md);

console.log("PUBLIC QA REBASELINE COMPLETE");
console.log(JSON.stringify(report.counts, null, 2));
console.log("");
console.log("Markdown report:", mdOut);
console.log("JSON report:", jsonOut);

