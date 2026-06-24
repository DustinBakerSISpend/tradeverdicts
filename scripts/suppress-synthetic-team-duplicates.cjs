const fs = require("fs");

const file = "src/data/nfl/trades.json";
const trades = JSON.parse(fs.readFileSync(file, "utf8"));

const suppressIds = new Set([
  "DET-1976-0204",
  "TEN-1976-0117",
  "ARI-1980-0216",
  "DET-1983-0249",
  "RAM-1983-0335",
  "MIN-1962-08-28-0016",
]);

const report = [];

for (const trade of trades) {
  if (!suppressIds.has(trade.id)) continue;

  report.push({
    id: trade.id,
    slug: trade.slug,
    previousPublishStatus: trade.publishStatus,
    teams: trade.teams,
    verdict: trade.verdict,
  });

  trade.publishStatus = "hold-conflict";
  trade.qaNotes = `${trade.qaNotes || ""} | Suppressed synthetic void/cancel/involving-team duplicate after duplicate-player audit.`;
}

fs.writeFileSync(file, JSON.stringify(trades, null, 2) + "\n", "utf8");
fs.writeFileSync(
  "src/data/nfl/synthetic-team-duplicate-suppression-report.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), suppressed: report.length, records: report }, null, 2)
);

console.log({ suppressed: report.length });
console.log(report);
