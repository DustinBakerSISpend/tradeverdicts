const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const suppressIds = [
  "LAC-1970-0039",
  "LAC-1972-0078",
  "LAC-1973-0093",
  "LAC-1974-0107",
  "LAC-1977-0166",
  "LAC-1981-0197",
  "LAC-1984-0232",
  "LAC-1987-0259",
  "LAC-1974-0102"
];

const report = [];

for (const trade of trades) {
  if (!suppressIds.includes(trade.id)) continue;

  trade.publishStatus = "hold-conflict";
  trade.reviewReason = "duplicate placeholder-asset record; suppressed in favor of more specific canonical partner-team trade record";

  report.push({
    id: trade.id,
    slug: trade.slug,
    date: trade.date || trade.tradeDate,
    teams: trade.teams,
    verdict: trade.verdict,
    publishStatus: trade.publishStatus,
    reviewReason: trade.reviewReason
  });
}

fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");

fs.writeFileSync(
  path.join("src", "data", "nfl", "placeholder-asset-suppression-report.json"),
  JSON.stringify(report, null, 2)
);

console.log("Suppressed:", report.length);
console.table(report.map(r => ({ id: r.id, slug: r.slug })));
