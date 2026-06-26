const fs = require("fs");

const TRADES = "src/data/nfl/trades.json";
const AUDIT = "src/data/nfl/transaction-merge-audit.json";
const OUT = "src/data/nfl/transaction-merge-safe-candidate-apply-report.json";

const trades = JSON.parse(fs.readFileSync(TRADES, "utf8"));
const audit = JSON.parse(fs.readFileSync(AUDIT, "utf8"));

function hasBlankSummary(s) {
  return !String(s || "").trim();
}

function hasBlankAssetSide(assetText) {
  return String(assetText || "")
    .split("||")
    .some(part => /:\s*$/.test(part.trim()));
}

const groups = audit.buckets.mergeCandidate.filter(g =>
  g.score >= 55 &&
  g.suppressCandidates.some(s =>
    hasBlankSummary(s.summary) || hasBlankAssetSide(s.assets)
  )
);

const suppressSlugs = new Set();
for (const g of groups) {
  for (const s of g.suppressCandidates) suppressSlugs.add(s.slug);
}

let changed = 0;
const changes = [];

for (const t of trades) {
  if (t.suppressed) continue;
  if (!suppressSlugs.has(t.slug)) continue;

  t.suppressed = true;
  t.suppressionReason = "duplicate merge-candidate shell; canonical same-date/team-pair trade contains complete assets";

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
  appliedRule: "mergeCandidate score >= 55 with blank summary or blank asset side",
  changed,
  changes
}, null, 2));

console.log(`Suppressed ${changed} safe merge-candidate shells`);
console.log(`Wrote ${OUT}`);
console.table(changes);
