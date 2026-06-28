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

const targetSlugs = new Set((report.activeNoUsefulSummary || []).map((row) => row.slug));

function cleanSummary(text) {
  return String(text || "")
    .replace(/\bPartner grade:\s*[A-F][+-]?\.\s*/gi, "")
    .replace(/\bPrimary grade:\s*[A-F][+-]?\.\s*/gi, "")
    .replace(/\bThis is graded against hindsight value, draft-slot opportunity cost, and available raw-source clarity\.?/gi, "")
    .replace(/Unknown\/Unspecified Partner/g, "An undisclosed partner")
    .replace(/Unknown partner/g, "an undisclosed partner")
    .replace(/Not specified in raw source/g, "undisclosed compensation")
    .replace(/draft pick \(\?-\?\)/g, "undisclosed draft pick")
    .replace(/\bundisclosed\s+undisclosed draft pick\b/gi, "undisclosed draft pick")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function bestPerspectiveSummary(trade) {
  if (!Array.isArray(trade.perspectives)) return "";

  const candidates = [];

  for (const perspective of trade.perspectives) {
    candidates.push(perspective.primarySummary);
    candidates.push(perspective.partnerSummary);
  }

  return candidates
    .map(cleanSummary)
    .filter((text) => text && text.length >= 30)
    .sort((a, b) => b.length - a.length)[0] || "";
}

function assetList(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return items.map((item) => item.asset || item.name || item.label || "").filter(Boolean).join("; ");
}

function formatTeam(slug) {
  return String(slug || "")
    .split("-")
    .map((word) => word === "49ers" ? "49ers" : word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function fallbackAssetSummary(trade) {
  const teams = trade.teams || [];
  const assetsReceived = trade.assetsReceived || {};
  const receiver = teams.find((team) => Array.isArray(assetsReceived[team]) && assetsReceived[team].length);
  if (!receiver) return "";

  const otherTeam = teams.find((team) => team !== receiver);
  const received = assetList(assetsReceived[receiver]);
  if (!received) return "";

  return cleanSummary(`${formatTeam(receiver)} received ${received}${otherTeam ? ` in a trade with ${formatTeam(otherTeam)}` : ""}.`);
}

const changes = [];
const skipped = [];

for (const trade of trades) {
  if (!targetSlugs.has(trade.slug)) continue;

  const currentSummary = cleanSummary(trade.summary);
  if (currentSummary && currentSummary.length >= 30) continue;

  const candidate = bestPerspectiveSummary(trade) || fallbackAssetSummary(trade);

  if (!candidate || candidate.length < 30) {
    skipped.push({
      slug: trade.slug,
      id: trade.id,
      reason: "No usable perspective or asset summary found",
    });
    continue;
  }

  changes.push({
    slug: trade.slug,
    id: trade.id,
    date: trade.tradeDate || trade.date,
    teams: trade.teams || [],
    before: trade.summary,
    after: candidate,
  });

  if (APPLY) {
    trade.summary = candidate;
  }
}

const outPath = path.join(
  "audit",
  "reports",
  `titans-root-summary-backfill-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);

fs.writeFileSync(outPath, JSON.stringify({
  mode: DRY_RUN ? "dry-run" : "apply",
  sourceRebaseline: reportPath,
  targetRows: targetSlugs.size,
  changedTrades: changes.length,
  skipped,
  sample: changes.slice(0, 25),
  changes,
}, null, 2));

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");
}

console.log(DRY_RUN ? "TITANS ROOT SUMMARY DRY RUN COMPLETE" : "TITANS ROOT SUMMARY APPLY COMPLETE");
console.log(JSON.stringify({
  sourceRebaseline: reportPath,
  targetRows: targetSlugs.size,
  changedTrades: changes.length,
  skipped: skipped.length,
  reportPath: outPath,
  firstTwelve: changes.slice(0, 12).map((change) => ({
    slug: change.slug,
    before: change.before,
    after: change.after,
  })),
}, null, 2));


