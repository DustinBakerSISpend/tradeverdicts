const fs = require("fs");

const trades = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));

function seasonOf(t) {
  return Number(t.season || String(t.tradeDate || "").slice(0, 4));
}

function replaceModernAliases(value, season) {
  if (typeof value !== "string" || season < 1970) return value;

  return value
    .replace(/Kansas City Chiefs\/Dallas Texans/g, "Kansas City Chiefs")
    .replace(/kansas-city-chiefs-dallas-texans/g, "kansas-city-chiefs")
    .replace(/New York Titans\/Jets/g, "New York Jets")
    .replace(/new-york-titanstennessee-titans/g, "tennessee-titans")
    .replace(/new-york-titans-jets/g, "new-york-jets")
    .replace(/new-york-titans/g, "new-york-jets");
}

function walk(value, season) {
  if (typeof value === "string") return replaceModernAliases(value, season);
  if (Array.isArray(value)) return value.map((v) => walk(v, season));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, season)]));
  }
  return value;
}

const changes = [];

for (const trade of trades) {
  const season = seasonOf(trade);
  const before = JSON.stringify(trade);
  const afterTrade = walk(trade, season);
  const after = JSON.stringify(afterTrade);

  if (before !== after) {
    changes.push({
      id: trade.id,
      season,
      slugBefore: trade.slug,
      slugAfter: afterTrade.slug,
      teams: trade.teams,
      changed: true,
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  changes: changes.length,
  records: changes,
};

fs.writeFileSync(
  "src/data/nfl/modern-alias-cleanup-dry-run.json",
  JSON.stringify(report, null, 2)
);

console.log({ changes: changes.length });
console.log(changes.slice(0, 30));
