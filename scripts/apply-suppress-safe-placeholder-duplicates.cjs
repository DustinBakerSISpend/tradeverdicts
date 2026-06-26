const fs = require("fs");
const path = require("path");

const TRADES = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const OUT = path.join(process.cwd(), "src", "data", "nfl", "safe-placeholder-suppression-apply-report.json");

const safeSuppressSlugs = new Set([
  "undisclosed-consideration-detroit-lions-1956",
  "undisclosed-consideration-dallas-cowboys-1961",
  "unspecified-consideration-cincinnati-bengals-1974-lac-1974-0101",
  "undisclosed-consideration-arizona-st-louis-cardinals-1953",
  "draft-pick-trade-cardinals-voided-by-vikings-1962",
  "unspecified-consideration-dallas-cowboys-1971-lac-1971-0055",
  "saints-2017-08-29-a-pre-existing-condition-to-eagles-jon-dorenbos"
]);

const trades = JSON.parse(fs.readFileSync(TRADES, "utf8"));

let changed = 0;
const changes = [];

for (const t of trades) {
  if (t.suppressed) continue;
  if (!safeSuppressSlugs.has(t.slug)) continue;

  t.suppressed = true;
  t.suppressionReason = "duplicate placeholder trade; canonical same-date/player/team trade exists";

  changed++;
  changes.push({
    id: t.id,
    slug: t.slug,
    tradeDate: t.tradeDate
  });
}

fs.writeFileSync(TRADES, JSON.stringify(trades, null, 2) + "\n");
fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  changed,
  changes
}, null, 2));

console.log(`Suppressed ${changed} safe placeholder duplicates`);
console.log(`Wrote ${OUT}`);
console.table(changes);
