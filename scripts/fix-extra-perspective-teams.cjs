const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "extra-perspective-team-fix-report.json");

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

function clean(value) {
  return String(value ?? "").trim();
}

function unique(values = []) {
  return Array.from(new Set(values.map(clean).filter(Boolean))).sort();
}

if (!DRY_RUN && !APPLY) {
  console.error("Safety stop: run with --dry-run or --apply.");
  process.exit(1);
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));
const fixed = [];

for (const trade of trades) {
  const teams = new Set(unique(trade.teams || []));
  const perspectives = trade.perspectives || [];

  if (!Array.isArray(perspectives) || perspectives.length === 0) continue;

  const kept = [];
  const removed = [];

  for (const p of perspectives) {
    const primary = clean(p.primaryTeam);
    const partner = clean(p.partnerTeam);

    if (teams.has(primary) && teams.has(partner)) {
      kept.push(p);
    } else {
      removed.push({
        sourceTradeId: p.sourceTradeId || "",
        primaryTeam: primary,
        partnerTeam: partner,
        verdict: p.verdict || "",
      });
    }
  }

  if (removed.length === 0) continue;

  trade.perspectives = kept;

  fixed.push({
    id: trade.id,
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    teams: [...teams],
    removedCount: removed.length,
    removed,
  });
}

fs.writeFileSync(REPORT_FILE, JSON.stringify({
  dryRun: DRY_RUN,
  fixedCount: fixed.length,
  fixed,
}, null, 2));

if (APPLY) {
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
}

console.log(`Extra perspective-team fixer ${DRY_RUN ? "dry run" : "applied"}.`);
console.log(`Fixed trades: ${fixed.length}`);
console.log(`Saved report to ${REPORT_FILE}`);

for (const row of fixed.slice(0, 60)) {
  console.log("");
  console.log(`${row.id} | ${row.tradeDate} | ${row.slug}`);
  console.log(`  teams: ${row.teams.join(", ")}`);
  for (const r of row.removed) {
    console.log(`  removed perspective: ${r.sourceTradeId} | ${r.primaryTeam} <-> ${r.partnerTeam}`);
  }
}