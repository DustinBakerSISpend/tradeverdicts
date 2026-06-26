const fs = require("fs");

const trades = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));

const fields = ["summary", "analysis", "longAnalysis", "description", "tradeAnalysis"];

const badPatterns = [
  "’",
  "“",
  "�",
  "—",
  "–",
  "�",
  "?"
];

const rows = [];

for (const trade of trades) {
  if (trade.publishStatus === "hold-conflict") continue;

  for (const field of fields) {
    const value = trade[field];
    if (typeof value !== "string") continue;

    const hits = badPatterns.filter((p) => value.includes(p));
    if (!hits.length) continue;

    rows.push({
      id: trade.id,
      slug: trade.slug,
      tradeDate: trade.tradeDate || trade.date,
      field,
      hits,
      text: value
    });
  }
}

fs.writeFileSync(
  "src/data/nfl/encoding-corruption-inspection.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      affectedFields: rows.length,
      affectedTrades: new Set(rows.map(r => r.id)).size,
      rows
    },
    null,
    2
  )
);

console.log("Affected fields:", rows.length);
console.log("Affected trades:", new Set(rows.map(r => r.id)).size);
console.log("Wrote src/data/nfl/encoding-corruption-inspection.json");
