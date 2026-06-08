const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const SUPPRESSIONS_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trade-suppressions.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trade-suppression-report.json");

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

if (!DRY_RUN && !APPLY) {
  console.error("Safety stop: run with --dry-run or --apply.");
  process.exit(1);
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));
const suppressions = JSON.parse(fs.readFileSync(SUPPRESSIONS_FILE, "utf8"));

const suppressedIds = new Set(suppressions.map((item) => item.id));
const before = trades.length;

const removed = [];
const kept = [];

for (const trade of trades) {
  if (suppressedIds.has(trade.id)) {
    const suppression = suppressions.find((item) => item.id === trade.id);
    removed.push({
      id: trade.id,
      slug: trade.slug,
      tradeDate: trade.tradeDate,
      teams: trade.teams || [],
      reason: suppression.reason,
      keep: suppression.keep,
      note: suppression.note || "",
    });
  } else {
    kept.push(trade);
  }
}

const report = {
  dryRun: DRY_RUN,
  before,
  after: kept.length,
  removedCount: removed.length,
  removed,
};

fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

if (APPLY) {
  fs.writeFileSync(TRADES_FILE, JSON.stringify(kept, null, 2));
}

console.log(`Trade suppressions ${DRY_RUN ? "dry run" : "applied"}.`);
console.log(`Trades before: ${before}`);
console.log(`Trades after: ${kept.length}`);
console.log(`Removed: ${removed.length}`);
console.log(`Saved report to ${REPORT_FILE}`);