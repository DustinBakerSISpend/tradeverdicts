const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "blocked-duplicate-equivalence-resolution-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || t.transactionDate || null;
}

function keysOf(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
}

function assetRows(t) {
  const rows = [];

  for (const team of keysOf(t.assetsReceived)) {
    const assets = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];

    assets.forEach((item, index) => {
      rows.push({
        team,
        index,
        type: item && item.type ? item.type : null,
        asset: item && item.asset ? item.asset : ""
      });
    });
  }

  return rows;
}

function compact(t) {
  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed === true,
    teams: t.teams || null,
    assetKeys: keysOf(t.assetsReceived).sort(),
    assetCount: assetRows(t).length,
    verdict: t.verdict || null,
    grades: t.grades || null,
    qaNotes: t.qaNotes || null,
    summary: t.summary || null,
    partnerSummary: t.partnerSummary || null,
    assetsReceived: t.assetsReceived || null
  };
}

const targetPlans = [
  {
    keeperSlug: "1974-seventh-round-pick-158-john-harvey-a-los-angeles-chargers-1972",
    suppressSlug: "unspecified-consideration-los-angelesst-louis-rams-1972-lac-1972-0078",
    confidence: "high",
    action: "suppress-without-merge",
    reason: "Hold-conflict duplicate is covered by stronger ready page; B-only UNKNOWN_PICK/CASH_UNCONFIRMED strings are lower-confidence equivalents and should not be merged into public asset text."
  },
  {
    keeperSlug: "ken-houston-kenny-houston-houston-oilers-tennessee-titans-1973",
    suppressSlug: "jim-snowden-washington-redskins-commanders-1973",
    confidence: "high",
    action: "suppress-without-merge",
    reason: "Better page includes the same core players plus Jim Snowden; A-only 1974 sixth round pick (?-?) is equivalent to keeper's 1974 sixth round pick (undisclosed)."
  },
  {
    keeperSlug: "bryant-salter-los-angeles-san-diego-chargers-1974",
    suppressSlug: "unspecified-consideration-washington-redskinscommanders-1974-lac-1974-0102",
    confidence: "high",
    action: "suppress-without-merge",
    reason: "Hold-conflict duplicate is covered by stronger ready page; B-only 1977 fourth round pick UNKNOWN_PICK is equivalent to keeper's 1977 fourth round pick (undisclosed)."
  }
];

const manualPairs = [
  {
    aSlug: "2011-4th-round-pick-105th-overall-roy-helu-and-2011-6th-round-pick-178th-overall-aldrick-r",
    bSlug: "2011-4th-round-pick-2011-5th-round-pick-washington-redskins-2011",
    reason: "same signatures and same quality score; needs keeper choice from full assets/summary"
  },
  {
    aSlug: "2021-4th-round-pick-121st-overall-los-angeles-st-louis-rams-2021",
    bSlug: "2021-4th-round-pick-130th-overall-robert-rochell-2021-5th-round-pick-170th-overa",
    reason: "same signatures and same quality score; needs keeper choice from full assets/summary"
  },
  {
    aSlug: "2020-4th-round-pick-136th-overall-brycen-hopkins-2020-7th-round-pick-248th-overa",
    bSlug: "2020-4th-round-pick-los-angeles-rams-2020",
    reason: "same signatures and same quality score; needs keeper choice from full assets/summary"
  }
];

const errors = [];
const planned = [];
const manual = [];

for (const plan of targetPlans) {
  const keeper = trades.find(t => slugOf(t) === plan.keeperSlug);
  const suppress = trades.find(t => slugOf(t) === plan.suppressSlug);

  if (!keeper) {
    errors.push(`Missing keeper: ${plan.keeperSlug}`);
    continue;
  }

  if (!suppress) {
    errors.push(`Missing suppress candidate: ${plan.suppressSlug}`);
    continue;
  }

  if (keeper.suppressed === true) errors.push(`Keeper already suppressed: ${plan.keeperSlug}`);
  if (suppress.suppressed === true) errors.push(`Suppress candidate already suppressed: ${plan.suppressSlug}`);

  if (dateOf(keeper) !== dateOf(suppress)) {
    errors.push(`Date mismatch: ${plan.keeperSlug} vs ${plan.suppressSlug}`);
  }

  planned.push({
    ...plan,
    keeper: compact(keeper),
    suppress: compact(suppress)
  });
}

for (const pair of manualPairs) {
  const a = trades.find(t => slugOf(t) === pair.aSlug);
  const b = trades.find(t => slugOf(t) === pair.bSlug);

  if (!a) {
    errors.push(`Missing manual A: ${pair.aSlug}`);
    continue;
  }

  if (!b) {
    errors.push(`Missing manual B: ${pair.bSlug}`);
    continue;
  }

  manual.push({
    ...pair,
    a: compact(a),
    b: compact(b)
  });
}

const report = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  dataPath,
  plannedSuppressionCount: planned.length,
  manualPairCount: manual.length,
  errorCount: errors.length,
  errors,
  planned,
  manual
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("BLOCKED DUPLICATE EQUIVALENCE RESOLUTION DRY RUN");
console.log("=".repeat(80));
console.log(`planned suppressions: ${planned.length}`);
console.log(`manual pairs retained for inspection: ${manual.length}`);
console.log(`errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Planned suppressions:");
for (const row of planned) {
  console.log("-".repeat(80));
  console.log(`KEEP     : ${row.keeper.slug} | ${row.keeper.id} | ${row.keeper.tradeDate} | status=${row.keeper.publishStatus}`);
  console.log(`SUPPRESS : ${row.suppress.slug} | ${row.suppress.id} | ${row.suppress.tradeDate} | status=${row.suppress.publishStatus}`);
  console.log(`action=${row.action}`);
  console.log(`confidence=${row.confidence}`);
  console.log(`reason=${row.reason}`);
  console.log("");
  console.log("Suppress assetsReceived:");
  console.dir(row.suppress.assetsReceived, { depth: null });
}

console.log("");
console.log("Manual pairs needing keeper choice:");
for (const row of manual) {
  console.log("-".repeat(80));
  console.log(`A: ${row.a.slug} | ${row.a.id} | ${row.a.tradeDate} | status=${row.a.publishStatus}`);
  console.log(`B: ${row.b.slug} | ${row.b.id} | ${row.b.tradeDate} | status=${row.b.publishStatus}`);
  console.log(`reason=${row.reason}`);

  console.log("");
  console.log("A assetsReceived:");
  console.dir(row.a.assetsReceived, { depth: null });

  console.log("");
  console.log("B assetsReceived:");
  console.dir(row.b.assetsReceived, { depth: null });

  console.log("");
  console.log("A summary:");
  console.log(row.a.summary || "(none)");

  console.log("");
  console.log("B summary:");
  console.log(row.b.summary || "(none)");
}

if (errors.length) {
  console.log("");
  console.log("Errors:");
  for (const error of errors) console.log(`- ${error}`);
}
