const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const coveragePath = path.join(process.cwd(), "audits", "historical-generic-coverage-check.json");
const outPath = path.join(process.cwd(), "audits", "suppress-covered-historical-generic-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const coverage = JSON.parse(fs.readFileSync(coveragePath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const planned = [];
const blocked = [];
const errors = [];

for (const row of coverage.rows || []) {
  const slug = row.target.slug;
  const trade = find(slug);

  if (!trade) {
    errors.push(`Missing trade: ${slug}`);
    continue;
  }

  if (trade.suppressed === true) {
    blocked.push({
      slug,
      reason: "already suppressed"
    });
    continue;
  }

  if (row.recommendedAction === "suppress-covered-blended-artifact") {
    planned.push({
      slug,
      id: trade.id || null,
      tradeDate: dateOf(trade),
      publishStatus: trade.publishStatus || null,
      teams: trade.teams || null,
      assetsReceived: trade.assetsReceived || null,
      summary: trade.summary || null,
      reason: row.reason,
      playerCount: row.playerCount,
      uncoveredPlayerCount: row.uncoveredPlayerCount,
      coverage: row.coverage
    });
  } else {
    blocked.push({
      slug,
      id: trade.id || null,
      tradeDate: dateOf(trade),
      publishStatus: trade.publishStatus || null,
      recommendedAction: row.recommendedAction,
      reason: row.reason,
      playerCount: row.playerCount,
      uncoveredPlayerCount: row.uncoveredPlayerCount
    });
  }
}

fs.writeFileSync(outPath, JSON.stringify({
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  plannedSuppressionCount: planned.length,
  blockedCount: blocked.length,
  errorCount: errors.length,
  planned,
  blocked,
  errors
}, null, 2));

console.log("");
console.log("SUPPRESS COVERED HISTORICAL GENERIC DRY RUN");
console.log("=".repeat(80));
console.log(`planned suppressions: ${planned.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Planned suppressions:");
for (const row of planned) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate} | status=${row.publishStatus}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`players=${row.playerCount} uncovered=${row.uncoveredPlayerCount}`);
  console.log(`reason=${row.reason}`);
  console.log("summary:");
  console.log(row.summary || "(none)");
}

console.log("");
console.log("Blocked / retained:");
for (const row of blocked) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id || ""} | ${row.tradeDate || ""} | status=${row.publishStatus || ""}`);
  console.log(`recommendedAction=${row.recommendedAction || ""}`);
  console.log(`players=${row.playerCount ?? ""} uncovered=${row.uncoveredPlayerCount ?? ""}`);
  console.log(`reason=${row.reason || ""}`);
}

if (errors.length) {
  console.log("");
  console.log("Errors:");
  for (const error of errors) console.log(`- ${error}`);
}
