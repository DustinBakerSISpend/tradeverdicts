const fs = require("fs");

const trades = JSON.parse(
  fs.readFileSync("src/data/nfl/trades.json", "utf8")
);

const suppressIds = [
  "ATL-2001-0228"
];

const report = [];

for (const trade of trades) {
  if (!suppressIds.includes(trade.id)) continue;

  trade.publishStatus = "hold-conflict";
  trade.reviewReason =
    "downstream draft-pick contamination; Arizona-Rams trade is canonical";

  trade.canonicalTradeId = "ARI-2001-0280";
  trade.canonicalTradeSlug =
    "cardinals-2001-04-21-los-angeles-st-louis-rams-2001-second-round-pick-54-michael-stone-ahmed-20";

  report.push({
    id: trade.id,
    slug: trade.slug,
    teams: trade.teams,
    verdict: trade.verdict,
    canonicalTradeId: trade.canonicalTradeId
  });
}

fs.writeFileSync(
  "src/data/nfl/trades.json",
  JSON.stringify(trades, null, 2) + "\n"
);

fs.writeFileSync(
  "src/data/nfl/aeneas-williams-suppression-report.json",
  JSON.stringify(report, null, 2)
);

console.table(report);
