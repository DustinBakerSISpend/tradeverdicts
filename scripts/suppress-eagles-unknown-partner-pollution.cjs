const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

if (!DRY_RUN && !APPLY) {
  console.error("Use --dry-run or --apply");
  process.exit(1);
}

const reports = fs.readdirSync(path.join("audit", "reports"))
  .filter((name) => /^public-qa-rebaseline-.*\.json$/.test(name))
  .map((name) => path.join("audit", "reports", name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

if (!reports.length) throw new Error("No public QA rebaseline report found.");

const reportPath = reports[0];
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const residueRows = report.activeTextResidue || [];
const targetSlugs = new Set(residueRows.map((row) => row.slug));

function blob(trade) {
  return JSON.stringify(trade || {}).toLowerCase();
}

function isSafeEaglesPollutionRow(trade) {
  if (!trade) return false;

  const text = blob(trade);
  const teams = trade.teams || [];

  return (
    String(trade.id || "").startsWith("PHI-") &&
    String(trade.slug || "").startsWith("eagles-") &&
    String(trade.slug || "").includes("unknown-undisclosed-partner") &&
    teams.includes("philadelphia-eagles") &&
    teams.includes("unknown-team") &&
    trade.publishStatus === "provisional" &&
    text.includes("not clearly specified in source") &&
    text.includes("unknown/undisclosed partner")
  );
}

const changes = [];
const skipped = [];

for (const trade of trades) {
  if (!targetSlugs.has(trade.slug)) continue;

  if (!isSafeEaglesPollutionRow(trade)) {
    skipped.push({
      slug: trade.slug,
      id: trade.id,
      publishStatus: trade.publishStatus,
      teams: trade.teams,
      reason: "Failed safety check",
    });
    continue;
  }

  changes.push({
    slug: trade.slug,
    id: trade.id,
    date: trade.tradeDate || trade.date,
    beforeStatus: trade.publishStatus,
    afterStatus: "hold-conflict",
    summary: trade.summary,
  });

  if (APPLY) {
    trade.publishStatus = "hold-conflict";
    trade.suppressionReason =
      "Suppressed Eagles unknown-partner import-pollution row with no durable standalone public trade content.";
    trade.qaNotes = `${trade.qaNotes || ""} Suppressed during public QA residue cleanup: Eagles unknown-partner import-pollution row.`.trim();
  }
}

const outPath = path.join(
  "audit",
  "reports",
  `suppress-eagles-unknown-partner-pollution-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);

fs.writeFileSync(outPath, JSON.stringify({
  mode: DRY_RUN ? "dry-run" : "apply",
  sourceRebaseline: reportPath,
  targetRows: targetSlugs.size,
  changedTrades: changes.length,
  skipped,
  changes,
}, null, 2));

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");
}

console.log(DRY_RUN ? "EAGLES POLLUTION SUPPRESSION DRY RUN COMPLETE" : "EAGLES POLLUTION SUPPRESSION APPLY COMPLETE");
console.log(JSON.stringify({
  sourceRebaseline: reportPath,
  targetRows: targetSlugs.size,
  changedTrades: changes.length,
  skipped: skipped.length,
  reportPath: outPath,
  firstTwelve: changes.slice(0, 12),
}, null, 2));
