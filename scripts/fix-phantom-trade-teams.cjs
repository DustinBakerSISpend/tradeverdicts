const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const AUDIT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "phantom-trade-team-audit.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "phantom-trade-team-fix-report.json");

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
const audit = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));

const safeFixIds = new Set(
  audit
    .filter((row) => {
      const count = (row.sourceTeams || []).length;
      return count === 2 || count === 3;
    })
    .filter((row) => (row.phantomTeams || []).length > 0)
    .map((row) => row.id)
);

const fixed = [];

for (const trade of trades) {
  if (!safeFixIds.has(trade.id)) continue;

  const oldTeams = unique(trade.teams || []);
  const newTeams = unique(trade.sourceTeams || []);

  if (newTeams.length !== 2 && newTeams.length !== 3) continue;
  if (oldTeams.join("|") === newTeams.join("|")) continue;

  trade.teams = newTeams;

  fixed.push({
    id: trade.id,
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    oldTeams,
    newTeams,
    removedTeams: oldTeams.filter((team) => !newTeams.includes(team)),
  });
}

fs.writeFileSync(REPORT_FILE, JSON.stringify({
  dryRun: DRY_RUN,
  candidates: safeFixIds.size,
  fixedCount: fixed.length,
  fixed,
}, null, 2));

if (APPLY) {
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
}

console.log(`Phantom trade-team fixer ${DRY_RUN ? "dry run" : "applied"}.`);
console.log(`Candidates: ${safeFixIds.size}`);
console.log(`Fixed: ${fixed.length}`);
console.log(`Saved report to ${REPORT_FILE}`);

for (const row of fixed.slice(0, 50)) {
  console.log("");
  console.log(`${row.id} | ${row.tradeDate} | ${row.slug}`);
  console.log(`  old: ${row.oldTeams.join(", ")}`);
  console.log(`  new: ${row.newTeams.join(", ")}`);
  console.log(`  removed: ${row.removedTeams.join(", ")}`);
}