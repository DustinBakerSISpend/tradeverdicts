const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "final-manual-duplicate-resolution-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || t.transactionDate || null;
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

const plans = [
  {
    type: "suppress-only",
    keeperSlug: "2011-4th-round-pick-105th-overall-roy-helu-and-2011-6th-round-pick-178th-overall-aldrick-r",
    suppressSlug: "2011-4th-round-pick-2011-5th-round-pick-washington-redskins-2011",
    reason: "Same date, teams, and pick signatures; keeper has complete two-sided summary while suppress candidate summary is incomplete."
  },
  {
    type: "repair-keeper-assets-then-suppress",
    keeperSlug: "2021-4th-round-pick-130th-overall-robert-rochell-2021-5th-round-pick-170th-overa",
    suppressSlug: "2021-4th-round-pick-121st-overall-los-angeles-st-louis-rams-2021",
    repairFromSlug: "2021-4th-round-pick-121st-overall-los-angeles-st-louis-rams-2021",
    repairs: [
      {
        team: "los-angeles-rams",
        assetIndex: 0
      },
      {
        team: "jacksonville-jaguars",
        assetIndex: 0
      }
    ],
    reason: "Same date, teams, and pick signatures; keeper has fuller neutral summary, while duplicate has cleaner asset text. Normalize keeper assets from duplicate, then suppress duplicate."
  },
  {
    type: "suppress-only",
    keeperSlug: "2020-4th-round-pick-136th-overall-brycen-hopkins-2020-7th-round-pick-248th-overa",
    suppressSlug: "2020-4th-round-pick-los-angeles-rams-2020",
    reason: "Same date, teams, and pick signatures; keeper has complete summary while suppress candidate summary is visibly truncated."
  }
];

const errors = [];
const planned = [];

for (const plan of plans) {
  const keeper = find(plan.keeperSlug);
  const suppress = find(plan.suppressSlug);

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

  const row = {
    type: plan.type,
    keeperSlug: plan.keeperSlug,
    suppressSlug: plan.suppressSlug,
    reason: plan.reason,
    keeper: {
      id: keeper.id || null,
      slug: slugOf(keeper),
      tradeDate: dateOf(keeper),
      publishStatus: keeper.publishStatus || null,
      suppressed: keeper.suppressed ?? null,
      assetsReceivedBefore: clone(keeper.assetsReceived || {}),
      summary: keeper.summary || null,
      qaNotes: keeper.qaNotes || null
    },
    suppress: {
      id: suppress.id || null,
      slug: slugOf(suppress),
      tradeDate: dateOf(suppress),
      publishStatus: suppress.publishStatus || null,
      suppressed: suppress.suppressed ?? null,
      assetsReceivedBefore: clone(suppress.assetsReceived || {}),
      summary: suppress.summary || null,
      qaNotes: suppress.qaNotes || null
    },
    keeperAssetRepairs: []
  };

  if (plan.type === "repair-keeper-assets-then-suppress") {
    const source = find(plan.repairFromSlug);

    if (!source) {
      errors.push(`Missing repair source: ${plan.repairFromSlug}`);
      continue;
    }

    for (const repair of plan.repairs || []) {
      const before = keeper.assetsReceived?.[repair.team]?.[repair.assetIndex]?.asset;
      const after = source.assetsReceived?.[repair.team]?.[repair.assetIndex]?.asset;

      if (!before) {
        errors.push(`${plan.keeperSlug}: missing keeper asset ${repair.team}[${repair.assetIndex}]`);
        continue;
      }

      if (!after) {
        errors.push(`${plan.repairFromSlug}: missing source asset ${repair.team}[${repair.assetIndex}]`);
        continue;
      }

      if (before === after) {
        row.keeperAssetRepairs.push({
          team: repair.team,
          assetIndex: repair.assetIndex,
          before,
          after,
          changed: false,
          reason: "already matches source"
        });
      } else {
        row.keeperAssetRepairs.push({
          team: repair.team,
          assetIndex: repair.assetIndex,
          before,
          after,
          changed: true,
          reason: "copy cleaner equivalent asset text from duplicate before suppressing duplicate"
        });
      }
    }
  }

  planned.push(row);
}

const report = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  dataPath,
  plannedResolutionCount: planned.length,
  plannedSuppressionCount: planned.length,
  errorCount: errors.length,
  errors,
  planned
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("FINAL MANUAL DUPLICATE RESOLUTION DRY RUN");
console.log("=".repeat(80));
console.log(`planned resolutions: ${planned.length}`);
console.log(`planned suppressions: ${planned.length}`);
console.log(`errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

for (const row of planned) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`TYPE     : ${row.type}`);
  console.log(`KEEP     : ${row.keeper.slug} | ${row.keeper.id} | ${row.keeper.tradeDate} | status=${row.keeper.publishStatus}`);
  console.log(`SUPPRESS : ${row.suppress.slug} | ${row.suppress.id} | ${row.suppress.tradeDate} | status=${row.suppress.publishStatus}`);
  console.log(`reason=${row.reason}`);

  if (row.keeperAssetRepairs.length) {
    console.log("");
    console.log("Keeper asset repairs:");
    for (const repair of row.keeperAssetRepairs) {
      console.log(`- ${repair.team}[${repair.assetIndex}] changed=${repair.changed}`);
      console.log(`  BEFORE: ${repair.before}`);
      console.log(`  AFTER : ${repair.after}`);
    }
  }

  console.log("");
  console.log("Keeper summary:");
  console.log(row.keeper.summary || "(none)");

  console.log("");
  console.log("Suppress summary:");
  console.log(row.suppress.summary || "(none)");
}

if (errors.length) {
  console.log("");
  console.log("Errors:");
  for (const error of errors) console.log(`- ${error}`);
}
