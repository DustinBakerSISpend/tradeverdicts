const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const classPath = path.join(process.cwd(), "audits", "active-suspicious-next-action-classification.json");
const outPath = path.join(process.cwd(), "audits", "remaining-historical-coverage-check.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const classified = JSON.parse(fs.readFileSync(classPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function textOf(t) {
  return JSON.stringify(t).toLowerCase();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function isGeneric(asset) {
  return /^(cash|1 cash|draft pick|draft pick \(\?-\?\)|draft pick \(undisclosed\)|undisclosed draft pick|undisclosed draft pick \(\?-\?\)|past considerations|conditional draft pick|1989 conditional twelfth round pick \(not exercised\))$/i.test(String(asset || "").trim());
}

function playerAssets(t) {
  const out = [];
  for (const [team, assets] of Object.entries(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;
    assets.forEach((item, index) => {
      const asset = String(item.asset || "").trim();
      if (item.type === "player" && asset && !isGeneric(asset) && !/undisclosed consideration/i.test(asset)) {
        out.push({ team, index, asset });
      }
    });
  }
  return out;
}

const rows = (classified.rows || classified.classified || [])
  .filter(r =>
    r.bucket === "D2 historical mixed players plus generic compensation" ||
    r.bucket === "C1 generic unknown one-pick cluster" ||
    r.bucket === "E manual review remainder"
  );

const checked = [];

for (const r of rows) {
  const target = find(r.slug);
  if (!target || target.suppressed === true) continue;

  const players = playerAssets(target);

  const coverage = players.map(p => {
    const variants = p.asset
      .toLowerCase()
      .split("/")
      .map(x => x.replace(/[^a-z0-9 ]+/g, " ").trim())
      .filter(Boolean);

    const hits = trades
      .filter(t => slugOf(t) !== slugOf(target))
      .filter(t => t.suppressed !== true)
      .filter(t => {
        const blob = textOf(t);
        return variants.some(v => {
          const parts = v.split(/\s+/).filter(w => w.length >= 3);
          return parts.length >= 2 && parts.every(part => blob.includes(part));
        });
      })
      .slice(0, 8)
      .map(t => ({
        slug: slugOf(t),
        id: t.id || null,
        tradeDate: dateOf(t),
        publishStatus: t.publishStatus || null,
        teams: t.teams || null
      }));

    return { player: p, hits };
  });

  const uncovered = coverage.filter(c => c.hits.length === 0);

  let recommendedAction = "manual";
  let reason = "Needs manual review.";

  if (players.length > 0 && (target.teams || []).length > 2 && uncovered.length === 0) {
    recommendedAction = "suppress-covered-blended-artifact";
    reason = "More than two teams, generic compensation, and all player assets appear on other active pages.";
  } else if (players.length > 0 && uncovered.length > 0) {
    recommendedAction = "retain-for-now-uncovered-player-assets";
    reason = "At least one player asset was not found elsewhere.";
  } else if (players.length === 0) {
    recommendedAction = "manual-no-player-coverage";
    reason = "No player assets to prove safe coverage.";
  }

  checked.push({
    bucket: r.bucket,
    target: {
      slug: slugOf(target),
      id: target.id || null,
      tradeDate: dateOf(target),
      publishStatus: target.publishStatus || null,
      teams: target.teams || null,
      assetsReceived: target.assetsReceived || null,
      summary: target.summary || null
    },
    playerCount: players.length,
    uncoveredPlayerCount: uncovered.length,
    recommendedAction,
    reason,
    coverage
  });
}

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  checkedCount: checked.length,
  rows: checked
}, null, 2));

console.log("");
console.log("REMAINING HISTORICAL COVERAGE CHECK");
console.log("=".repeat(80));
console.log(`checked: ${checked.length}`);
console.log(`Report: ${outPath}`);

for (const row of checked) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${row.target.slug} | ${row.target.id} | ${row.target.tradeDate} | ${row.bucket}`);
  console.log(`teams=${JSON.stringify(row.target.teams)}`);
  console.log(`players=${row.playerCount} uncovered=${row.uncoveredPlayerCount}`);
  console.log(`recommendedAction=${row.recommendedAction}`);
  console.log(`reason=${row.reason}`);
  console.log("summary:");
  console.log(row.target.summary || "(none)");

  for (const c of row.coverage) {
    console.log(`PLAYER: ${c.player.asset} | hits=${c.hits.length}`);
    for (const h of c.hits.slice(0, 4)) {
      console.log(`  - ${h.slug} | ${h.id} | ${h.tradeDate} | status=${h.publishStatus}`);
    }
  }
}
