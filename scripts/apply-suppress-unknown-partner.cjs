const fs = require("fs");
const path = require("path");

const TRADES = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const DRY = path.join(process.cwd(), "src", "data", "nfl", "unknown-partner-suppression-dry-run.json");
const OUT = path.join(process.cwd(), "src", "data", "nfl", "unknown-partner-suppression-apply-report.json");

const trades = JSON.parse(fs.readFileSync(TRADES, "utf8"));
const dry = JSON.parse(fs.readFileSync(DRY, "utf8"));

const suppressIds = new Set(dry.candidates.map(x => x.suppressId).filter(Boolean));
const suppressSlugs = new Set(dry.candidates.map(x => x.suppressSlug).filter(Boolean));

let changed = 0;
const changes = [];

for (const t of trades) {
  if (t.suppressed) continue;

  if (suppressIds.has(t.id) || suppressSlugs.has(t.slug)) {
    t.suppressed = true;
    t.suppressionReason = "duplicate unknown-partner trade; canonical same-date/player/team trade exists";
    changed++;
    changes.push({
      id: t.id,
      slug: t.slug,
      tradeDate: t.tradeDate
    });
  }
}

fs.writeFileSync(TRADES, JSON.stringify(trades, null, 2) + "\n");
fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  changed,
  changes
}, null, 2));

console.log(`Suppressed ${changed} trades`);
console.log(`Wrote ${OUT}`);
console.table(changes.slice(0, 25));
