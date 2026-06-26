const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const suppressIds = [
  "LAC-1982-0217",
  "LAC-1968-0032"
];

const report = [];

for (const trade of trades) {
  if (!suppressIds.includes(trade.id)) continue;

  trade.publishStatus = "hold-conflict";
  trade.reviewReason = "duplicate unspecified-consideration record; suppressed in favor of more specific canonical trade record";

  report.push({
    id: trade.id,
    slug: trade.slug,
    date: trade.date || trade.tradeDate,
    teams: trade.teams,
    players: trade.players,
    verdict: trade.verdict,
    publishStatus: trade.publishStatus
  });
}

fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");

fs.writeFileSync(
  path.join("src", "data", "nfl", "remaining-unspecified-consideration-suppression-report.json"),
  JSON.stringify(report, null, 2)
);

console.log("Suppressed:", report.length);
console.table(report.map(r => ({ id: r.id, slug: r.slug })));
