const fs = require("fs");

const trades = JSON.parse(
  fs.readFileSync("src/data/nfl/trades.json", "utf8")
).filter(t => t.publishStatus !== "hold-conflict");

const fields = [
  "summary",
  "analysis",
  "longAnalysis",
  "description",
  "tradeAnalysis"
];

const patterns = [
  /Hallof/g,
  /futureHall/g,
  /Thetransaction/g,
  /Thepartner/g,
  /valuecurve/g,
  /rightsasset/g,
  /favorsthe/g,
  /Brownsreceived/g,
  /Patriotsreceived/g,
  /Giantsreceived/g,
  /Lionsreceived/g,
  /Packersreceived/g,
  /Chicagofor/g,
  /inthis/g,
  /gaveup/g,
  /andsent/g,
  /roundpick/g,
  /roundwith/g,
  /roundfrom/g
];

const rows = [];

for (const trade of trades) {
  for (const field of fields) {
    const text = trade[field];

    if (typeof text !== "string") continue;

    const hits = [];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) hits.push(match[0]);
    }

    if (hits.length) {
      rows.push({
        id: trade.id,
        slug: trade.slug,
        field,
        hits,
        text
      });
    }
  }
}

fs.writeFileSync(
  "src/data/nfl/jammed-word-audit.json",
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
