const fs = require("fs");

const file = "src/data/nfl/trades.json";
const trades = JSON.parse(fs.readFileSync(file, "utf8"));

function seasonOf(t) {
  return Number(t.season || String(t.tradeDate || "").slice(0, 4));
}

function replaceModernAliases(value, season) {
  if (typeof value !== "string" || season < 1970) return value;

  return value
    .replace(/Kansas City Chiefs\/Dallas Texans/g, "Kansas City Chiefs")
    .replace(/kansas-city-chiefs-dallas-texans/g, "kansas-city-chiefs")
    .replace(/New York Titans\/Tennessee Titans/g, "Tennessee Titans")
    .replace(/New York Titans\/Jets/g, "New York Jets")
    .replace(/new-york-titans-tennessee-titans/g, "tennessee-titans")
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

let changed = 0;
const changedIds = [];

const cleaned = trades.map((trade) => {
  const before = JSON.stringify(trade);
  const afterTrade = walk(trade, seasonOf(trade));
  const after = JSON.stringify(afterTrade);

  if (before !== after) {
    changed++;
    changedIds.push({
      id: trade.id,
      season: seasonOf(trade),
      slugBefore: trade.slug,
      slugAfter: afterTrade.slug,
    });
  }

  return afterTrade;
});

fs.writeFileSync(file, JSON.stringify(cleaned, null, 2) + "\n", "utf8");

fs.writeFileSync(
  "src/data/nfl/modern-alias-cleanup-report.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      changed,
      changedIds,
    },
    null,
    2
  )
);

console.log({ changed });
console.log(changedIds.filter(x => x.slugBefore !== x.slugAfter));
