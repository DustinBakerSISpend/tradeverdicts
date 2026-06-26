const fs = require("fs");

const audit = JSON.parse(
  fs.readFileSync(
    "src/data/nfl/duplicate-player-trades-audit.json",
    "utf8"
  )
);

const groups = audit.groups || audit;

const teamConflicts = groups
  .filter(g => g.hasConflictingTeams)
  .map(g => ({
    date: g.tradeDate,
    players: (g.players || []).join(", "),
    count: g.count,
    ids: (g.trades || []).map(t => t.id).join(" | "),
    slugs: (g.trades || []).map(t => t.slug).join(" | ")
  }));

fs.writeFileSync(
  "src/data/nfl/conflicting-team-groups-summary.json",
  JSON.stringify(teamConflicts, null, 2)
);

console.log("Conflicting team groups:", teamConflicts.length);

for (const g of teamConflicts) {
  console.log("\n--------------------------------");
  console.log(g.date);
  console.log(g.players);
  console.log(g.ids);
}
