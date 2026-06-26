const fs = require("fs");

const TRADES = "src/data/nfl/trades.json";
const AUDIT = "src/data/nfl/transaction-merge-audit.json";
const OUT = "src/data/nfl/transaction-merge-apply-report.json";

const trades = JSON.parse(fs.readFileSync(TRADES, "utf8"));
const audit = JSON.parse(fs.readFileSync(AUDIT, "utf8"));

const groups = audit.buckets.likelyDuplicatePlaceholder.filter(g => g.score >= 75);

const suppressSlugs = new Set();
for (const g of groups) {
  for (const s of g.suppressCandidates) {
    suppressSlugs.add(s.slug);
  }
}

let changed = 0;
const changes = [];

for (const t of trades) {
  if (t.suppressed) continue;
  if (!suppressSlugs.has(t.slug)) continue;

  t.suppressed = true;
  t.suppressionReason = "duplicate transaction placeholder; cleaner same-date/team-pair canonical trade exists";

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
  appliedRule: "transaction-merge likelyDuplicatePlaceholder score >= 75",
  changed,
  changes
}, null, 2));

console.log(`Suppressed ${changed} transaction placeholder trades`);
console.log(`Wrote ${OUT}`);
console.table(changes);
