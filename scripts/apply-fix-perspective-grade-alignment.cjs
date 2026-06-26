const fs = require("fs");

const TRADES = "src/data/nfl/trades.json";
const DRY_RUN = "src/data/nfl/perspective-grade-alignment-fix-dry-run.json";
const OUT = "src/data/nfl/perspective-grade-alignment-fix-apply-report.json";

const trades = JSON.parse(fs.readFileSync(TRADES, "utf8"));
const dryRun = JSON.parse(fs.readFileSync(DRY_RUN, "utf8"));

let changed = 0;
const changes = [];

for (const row of dryRun.rows) {
  const trade = trades.find(t => t.slug === row.slug);
  if (!trade || !Array.isArray(trade.perspectives)) continue;

  const p = trade.perspectives[row.perspectiveIndex];
  if (!p) continue;

  const before = p.verdict;
  p.verdict = row.to;

  changed++;
  changes.push({
    slug: row.slug,
    tradeId: row.tradeId,
    perspectiveIndex: row.perspectiveIndex,
    sourceTeam: row.sourceTeam,
    from: before,
    to: row.to
  });
}

fs.writeFileSync(TRADES, JSON.stringify(trades, null, 2) + "\n");
fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  changed,
  changes
}, null, 2));

console.log("changed", changed);
console.table(changes.slice(0,50));
