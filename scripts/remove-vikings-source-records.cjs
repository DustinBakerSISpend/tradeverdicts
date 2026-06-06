const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "vikings-source-removal-report.json");

const SOURCE_TEAM = "minnesota-vikings";

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isVikingsPerspective(perspective) {
  const sourceTeam = clean(perspective.sourceTeam);
  const sourceTradeId = clean(perspective.sourceTradeId);

  return (
    sourceTeam === SOURCE_TEAM ||
    sourceTradeId.startsWith("MIN-") ||
    sourceTradeId.startsWith("VIK-")
  );
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

const kept = [];
const deletedWholeTrades = [];
const strippedVikingsPerspectives = [];

for (const trade of trades) {
  const sourceTeams = trade.sourceTeams || [];
  const perspectives = trade.perspectives || [];

  const hasVikingsSource =
    sourceTeams.includes(SOURCE_TEAM) ||
    perspectives.some(isVikingsPerspective);

  if (!hasVikingsSource) {
    kept.push(trade);
    continue;
  }

  const nonVikingsSourceTeams = sourceTeams.filter((team) => team !== SOURCE_TEAM);
  const nonVikingsPerspectives = perspectives.filter((p) => !isVikingsPerspective(p));

  const shouldDeleteWholeTrade =
    nonVikingsSourceTeams.length === 0 &&
    nonVikingsPerspectives.length === 0;

  if (shouldDeleteWholeTrade) {
    deletedWholeTrades.push({
      id: trade.id,
      slug: trade.slug,
      tradeDate: trade.tradeDate,
      teams: trade.teams || [],
      sourceTeams,
      removedPerspectiveCount: perspectives.length,
    });

    continue;
  }

  const nextTrade = {
    ...trade,
    sourceTeams: Array.from(new Set(nonVikingsSourceTeams)).sort(),
    perspectives: nonVikingsPerspectives,
  };

  strippedVikingsPerspectives.push({
    id: trade.id,
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    teams: trade.teams || [],
    sourceTeamsBefore: sourceTeams,
    sourceTeamsAfter: nextTrade.sourceTeams,
    perspectivesBefore: perspectives.length,
    perspectivesAfter: nonVikingsPerspectives.length,
  });

  kept.push(nextTrade);
}

const report = {
  sourceTeam: SOURCE_TEAM,
  tradesBefore: trades.length,
  tradesAfter: kept.length,
  wholeTradesDeleted: deletedWholeTrades.length,
  multiSourceTradesStripped: strippedVikingsPerspectives.length,
  deletedWholeTrades,
  strippedVikingsPerspectives,
};

fs.writeFileSync(TRADES_FILE, JSON.stringify(kept, null, 2));
fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

console.log("Removed old Vikings source data safely.");
console.log(`Trades before: ${trades.length}`);
console.log(`Whole trades deleted: ${deletedWholeTrades.length}`);
console.log(`Multi-source trades kept but stripped: ${strippedVikingsPerspectives.length}`);
console.log(`Trades after: ${kept.length}`);
console.log(`Saved report to ${REPORT_FILE}`);