const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const auditPath = path.join(process.cwd(), "audits", "mirrored-pick-package-duplicate-audit.json");
const outPath = path.join(process.cwd(), "audits", "mirrored-pick-package-duplicate-suppression-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const planned = [];
const blocked = [];
const errors = [];

for (const group of audit.exactDuplicateGroups || []) {
  const keeperSlug = group.keeperSuggestion;
  const keeper = find(keeperSlug);

  if (!keeper) {
    errors.push(`Missing keeper: ${keeperSlug}`);
    continue;
  }

  if (keeper.suppressed === true) {
    errors.push(`Keeper already suppressed: ${keeperSlug}`);
    continue;
  }

  const groupTrades = group.trades || [];
  const suppressRows = groupTrades.filter(t => t.slug !== keeperSlug);

  if (!suppressRows.length) {
    blocked.push({
      key: group.key,
      keeperSlug,
      reason: "No suppress candidates after keeper selection."
    });
    continue;
  }

  for (const row of suppressRows) {
    const trade = find(row.slug);

    if (!trade) {
      errors.push(`Missing suppress candidate: ${row.slug}`);
      continue;
    }

    if (trade.suppressed === true) {
      blocked.push({
        key: group.key,
        keeperSlug,
        suppressSlug: row.slug,
        reason: "Suppress candidate already suppressed."
      });
      continue;
    }

    planned.push({
      type: "suppress-mirrored-pick-package-duplicate",
      keeperSlug,
      keeperId: keeper.id || null,
      suppressSlug: row.slug,
      suppressId: trade.id || null,
      tradeDate: group.date,
      teams: group.teams,
      pickSigs: group.pickSigs,
      keeperSummaryScore: groupTrades.find(t => t.slug === keeperSlug)?.summaryScore ?? null,
      suppressSummaryScore: row.summaryScore ?? null,
      keeperSummary: keeper.summary || null,
      suppressSummary: trade.summary || null,
      reason: "Same date, same teams, and same full pick-signature package. Retain strongest summary/complete trade page and suppress mirrored duplicate."
    });
  }
}

fs.writeFileSync(outPath, JSON.stringify({
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  sourceAudit: auditPath,
  plannedSuppressionCount: planned.length,
  blockedCount: blocked.length,
  errorCount: errors.length,
  planned,
  blocked,
  errors
}, null, 2));

console.log("");
console.log("MIRRORED PICK-PACKAGE DUPLICATE SUPPRESSION DRY RUN");
console.log("=".repeat(80));
console.log(`planned suppressions: ${planned.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("First 30 planned suppressions:");
for (const row of planned.slice(0, 30)) {
  console.log("-".repeat(80));
  console.log(`KEEP     : ${row.keeperSlug} | ${row.keeperId} | score=${row.keeperSummaryScore}`);
  console.log(`SUPPRESS : ${row.suppressSlug} | ${row.suppressId} | score=${row.suppressSummaryScore}`);
  console.log(`date=${row.tradeDate}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`pickSigs=${JSON.stringify(row.pickSigs)}`);
  console.log(`reason=${row.reason}`);
  console.log("");
  console.log("Keeper summary:");
  console.log(row.keeperSummary || "(none)");
  console.log("");
  console.log("Suppress summary:");
  console.log(row.suppressSummary || "(none)");
}

if (blocked.length) {
  console.log("");
  console.log("Blocked:");
  for (const row of blocked.slice(0, 20)) {
    console.log("-".repeat(80));
    console.log(JSON.stringify(row, null, 2));
  }
}

if (errors.length) {
  console.log("");
  console.log("Errors:");
  for (const error of errors) console.log(`- ${error}`);
}
