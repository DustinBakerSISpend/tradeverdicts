const fs = require("fs");

const trades = JSON.parse(
  fs.readFileSync("src/data/nfl/trades.json", "utf8")
);

const fields = [
  "summary",
  "analysis",
  "longAnalysis",
  "description",
  "tradeAnalysis"
];

const BAD = [
  "’",
  "“",
  "�",
  "—",
  "–",
  "�"
];

const rows = [];

for (const trade of trades) {
  if (trade.publishStatus === "hold-conflict") continue;

  for (const field of fields) {
    const text = trade[field];

    if (typeof text !== "string") continue;

    const hits = BAD.filter(b => text.includes(b));

    if (!hits.length) continue;

    rows.push({
      id: trade.id,
      slug: trade.slug,
      field,
      hits,
      text
    });
  }
}

fs.writeFileSync(
  "src/data/nfl/true-encoding-corruption.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      affectedFields: rows.length,
      affectedTrades: [...new Set(rows.map(r => r.id))].length,
      rows
    },
    null,
    2
  )
);

console.log("Fields:", rows.length);
console.log("Trades:", [...new Set(rows.map(r => r.id))].length);
