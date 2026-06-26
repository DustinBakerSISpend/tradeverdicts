const fs = require("fs");

const trades = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));
const critical = JSON.parse(fs.readFileSync("src/data/nfl/text-quality-critical-audit.json", "utf8"));

const ids = critical.trades
  .filter(t => t.issues.includes("truncated-ending"))
  .map(t => t.id);

const rows = trades
  .filter(t => ids.includes(t.id))
  .map(t => ({
    id: t.id,
    slug: t.slug,
    tradeDate: t.tradeDate || t.date,
    summary: t.summary || "",
    analysis: t.analysis || t.longAnalysis || t.tradeAnalysis || ""
  }));

fs.writeFileSync(
  "src/data/nfl/truncated-text-inspection.json",
  JSON.stringify(rows, null, 2)
);

console.log("Wrote truncated-text-inspection.json");
console.table(rows.map(r => ({ id: r.id, slug: r.slug })));
