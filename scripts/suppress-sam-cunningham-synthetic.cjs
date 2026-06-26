const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const syntheticSlugs = [
  "high-draft-pick-patriots-voided-when-cunningham-failed-physical-1980",
  "sam-cunningham-dolphins-voided-when-cunningham-failed-physical-1980"
];

const report = [];

for (const trade of trades) {
  if (!syntheticSlugs.includes(trade.slug)) continue;

  trade.publishStatus = "hold-conflict";
  trade.reviewReason = "synthetic failed-physical duplicate; suppressed pending canonical historical verification";

  report.push({
    id: trade.id,
    slug: trade.slug,
    teams: trade.teams,
    verdict: trade.verdict,
    publishStatus: trade.publishStatus,
    reviewReason: trade.reviewReason
  });
}

fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");

fs.writeFileSync(
  path.join("src", "data", "nfl", "sam-cunningham-synthetic-suppression-report.json"),
  JSON.stringify(report, null, 2)
);

console.log("Suppressed:", report.length);
console.table(report.map(r => ({ id: r.id, slug: r.slug })));
