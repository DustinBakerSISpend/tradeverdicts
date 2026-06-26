const fs = require("fs");

const trades = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8")).filter(
  (trade) => trade.publishStatus !== "hold-conflict"
);

function normName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isExcludedPlayerName(norm) {
  if (!norm) return true;

  const exact = new Set([
    "unknown",
    "unknown not disclosed",
    "not disclosed",
    "undisclosed",
    "player to be named",
    "player to be named later",
    "future considerations",
    "future consideration",
    "unknown undisclosed consideration"
  ]);

  if (exact.has(norm)) return true;
  if (norm.includes("unknown") && norm.includes("disclosed")) return true;
  if (norm.includes("unknown") && norm.includes("consideration")) return true;
  if (norm.includes("undisclosed") && norm.includes("consideration")) return true;

  return false;
}

function normalizeAuditTeam(team, tradeDate) {
  const year = Number(String(tradeDate || "").slice(0, 4));

  if (year <= 1962 && team === "tennessee-titans") {
    return "new-york-jets";
  }

  if (year <= 1963 && team === "houston-texans") {
    return "kansas-city-chiefs";
  }

  return team;
}

function asAssetRows(assetsReceived) {
  if (!assetsReceived) return [];

  if (Array.isArray(assetsReceived)) {
    return assetsReceived.map((asset) => ({ team: asset.team || asset.toTeam || null, asset }));
  }

  if (typeof assetsReceived === "object") {
    const rows = [];
    for (const [team, assets] of Object.entries(assetsReceived)) {
      if (Array.isArray(assets)) {
        for (const asset of assets) rows.push({ team, asset });
      }
    }
    return rows;
  }

  return [];
}

function getAssetName(asset) {
  if (typeof asset === "string") return asset;
  return asset?.asset || asset?.name || asset?.player || asset?.title || asset?.description || "";
}

function isPlayerAsset(asset) {
  if (typeof asset !== "string") {
    const type = String(asset?.type || "").toLowerCase();
    if (type.includes("player")) return true;
  }

  const name = getAssetName(asset);
  if (!name) return false;

  return !/(pick|round|selection|conditional|cash|consideration|rights|swap|future|draft)/i.test(name);
}

function getPlayerAssets(trade) {
  return asAssetRows(trade.assetsReceived)
    .filter(({ asset }) => isPlayerAsset(asset))
    .map(({ team, asset }) => {
      const raw = getAssetName(asset);
      const norm = normName(raw);

      return {
        raw,
        norm,
        toTeam: team,
      };
    })
    .filter((p) => p.norm)
    .filter((p) => !isExcludedPlayerName(p.norm));
}

function teamSet(trade) {
  const date = trade.tradeDate || trade.date || "";

  return [
    ...new Set(
      (trade.teams || []).map((team) => normalizeAuditTeam(team, date))
    ),
  ].sort();
}

const buckets = new Map();

for (const trade of trades) {
  const date = trade.tradeDate || trade.date || "";
  if (!date) continue;

  const players = getPlayerAssets(trade);
  if (players.length === 0) continue;

  const key = [date, players.map((p) => p.norm).sort().join("|")].join("::");

  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push({
    id: trade.id,
    slug: trade.slug,
    tradeDate: date,
    verdict: trade.verdict,
    teams: teamSet(trade),
    players: players.map((p) => p.raw).sort(),
    assetsReceived: trade.assetsReceived,
    grades: trade.teamGrades || trade.grades || {},
  });
}

const duplicateGroups = [...buckets.values()]
  .filter((group) => group.length > 1)
  .map((group) => {
    const teamSets = [...new Set(group.map((t) => t.teams.join("|")))];
    const verdicts = [...new Set(group.map((t) => t.verdict || ""))];
    const slugs = [...new Set(group.map((t) => t.slug || ""))];

    return {
      tradeDate: group[0].tradeDate,
      players: group[0].players,
      count: group.length,
      hasConflictingTeams: teamSets.length > 1,
      hasConflictingVerdicts: verdicts.length > 1,
      hasConflictingSlugs: slugs.length > 1,
      trades: group,
    };
  })
  .sort((a, b) =>
    Number(b.hasConflictingTeams) - Number(a.hasConflictingTeams) ||
    Number(b.hasConflictingVerdicts) - Number(a.hasConflictingVerdicts) ||
    b.count - a.count ||
    a.tradeDate.localeCompare(b.tradeDate)
  );

const report = {
  generatedAt: new Date().toISOString(),
  duplicateGroups: duplicateGroups.length,
  conflictingTeamGroups: duplicateGroups.filter((g) => g.hasConflictingTeams).length,
  conflictingVerdictGroups: duplicateGroups.filter((g) => g.hasConflictingVerdicts).length,
  groups: duplicateGroups,
};

fs.writeFileSync(
  "src/data/nfl/duplicate-player-trades-audit.json",
  JSON.stringify(report, null, 2)
);

console.log({
  duplicateGroups: report.duplicateGroups,
  conflictingTeamGroups: report.conflictingTeamGroups,
  conflictingVerdictGroups: report.conflictingVerdictGroups,
});