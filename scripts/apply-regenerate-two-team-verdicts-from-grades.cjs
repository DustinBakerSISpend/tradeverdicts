const fs = require("fs");

const TRADES = "src/data/nfl/trades.json";
const DRY = "src/data/nfl/two-team-verdict-regeneration-dry-run.json";
const OUT = "src/data/nfl/two-team-verdict-regeneration-apply-report.json";

const trades = JSON.parse(fs.readFileSync(TRADES, "utf8"));
const dry = JSON.parse(fs.readFileSync(DRY, "utf8"));

let changed = 0;
const changes = [];

for (const row of dry.rows) {
  const trade = trades.find(t => t.slug === row.slug);
  if (!trade) continue;

  const before = trade.verdict;
  trade.verdict = row.to;

  changed++;
  changes.push({
    id: trade.id,
    slug: trade.slug,
    from: before,
    to: row.to,
    grades: trade.grades
  });
}

fs.writeFileSync(TRADES, JSON.stringify(trades, null, 2) + "\n");
fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  changed,
  changes
}, null, 2));

console.log("changed", changed);
console.table(changes.slice(0,40));
