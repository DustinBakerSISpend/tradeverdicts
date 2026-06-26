const fs = require("fs");
const path = require("path");

const auditPath = path.join("src", "data", "nfl", "duplicate-player-trades-audit.json");
const outPath = path.join("src", "data", "nfl", "placeholder-asset-duplicate-audit.json");

const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));

const patterns = [
  "CONDITIONAL_VOIDED",
  "UNKNOWN_PICK",
  "CASH_UNCONFIRMED"
];

const matches = audit.groups
  .map(group => {
    const hits = [];

    for (const trade of group.trades || []) {
      const assets = Object.values(trade.assetsReceived || {}).flat();
      for (const asset of assets) {
        const text = String(asset.asset || "");
        if (patterns.some(p => text.includes(p))) {
          hits.push({
            tradeId: trade.id,
            slug: trade.slug,
            date: trade.tradeDate,
            teams: trade.teams,
            verdict: trade.verdict,
            players: trade.players,
            asset: text
          });
        }
      }
    }

    if (!hits.length) return null;

    return {
      tradeDate: group.tradeDate,
      players: group.players,
      count: group.count,
      hasConflictingTeams: group.hasConflictingTeams,
      hasConflictingVerdicts: group.hasConflictingVerdicts,
      hits,
      allTrades: group.trades.map(t => ({
        id: t.id,
        slug: t.slug,
        teams: t.teams,
        verdict: t.verdict,
        players: t.players,
        assetsReceived: t.assetsReceived,
        grades: t.grades
      }))
    };
  })
  .filter(Boolean);

fs.writeFileSync(outPath, JSON.stringify({
  placeholderDuplicateGroups: matches.length,
  groups: matches
}, null, 2));

console.log("Wrote", outPath);
console.log("placeholderDuplicateGroups:", matches.length);

for (const group of matches) {
  console.log("\n---");
  console.log(group.tradeDate, group.players.join(", "));
  for (const t of group.allTrades) {
    console.log(t.id, t.slug, "|", t.teams.join(" / "), "|", t.verdict);
  }
}
