const fs = require("fs");

const file = "src/data/nfl/trades.json";
const trades = JSON.parse(fs.readFileSync(file, "utf8"));

const suppressIds = new Set([
  "BUF-2002-0255",
  "NO-2017-0309",
  "NYJ-2021-0285",
  "RAM-1957-0069",
  "GB-1983-0251",
  "BUF-2006-0264",
  "NYJ-2011-0233",
  "NYJ-2015-0243",
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
  trade.qaNotes = `${trade.qaNotes || ""} | Suppressed duplicate/wrong-team record after duplicate-player audit; cleaner canonical counterpart retained.`;
}

fs.writeFileSync(file, JSON.stringify(trades, null, 2) + "\n", "utf8");
fs.writeFileSync(
  "src/data/nfl/duplicate-wrong-team-suppression-report.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), suppressed: report.length, records: report }, null, 2)
);

console.log({ suppressed: report.length });
console.log(report);
