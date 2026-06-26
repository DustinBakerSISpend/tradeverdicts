const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const suppressIds = [
  "RAM-1951-0023",
  "ATL-1993-0206",
  "GB-1993-0301"
];

const report = [];

for (const trade of trades) {
  if (!suppressIds.includes(trade.id)) continue;

  trade.publishStatus = "hold-conflict";
  trade.reviewReason = "duplicate/corrupt team record; suppressed pending canonical verification";

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
  path.join("src", "data", "nfl", "obvious-corrupt-duplicate-suppression-report.json"),
  JSON.stringify(report, null, 2)
);

console.log("Suppressed:", report.length);
console.table(report.map(r => ({ id: r.id, slug: r.slug })));
