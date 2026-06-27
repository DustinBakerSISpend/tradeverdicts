const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const inspectPath = path.join(process.cwd(), "audits", "next-historical-generic-contamination-inspection.json");
const outPath = path.join(process.cwd(), "audits", "historical-generic-coverage-check.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const inspect = JSON.parse(fs.readFileSync(inspectPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function textOf(t) {
  return JSON.stringify(t).toLowerCase();
}

function isGenericAsset(asset) {
  return /^(cash|1 cash|draft pick|draft pick \(\?-\?\)|draft pick \(undisclosed\)|undisclosed draft pick|undisclosed draft pick \(\?-\?\)|past considerations)$/i.test(String(asset || "").trim());
}

function playerAssets(t) {
  const rows = [];

  for (const [team, assets] of Object.entries(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;

    assets.forEach((item, index) => {
      const asset = String(item.asset || "").trim();

      if (item.type === "player" && asset && !isGenericAsset(asset) && !/undisclosed consideration/i.test(asset)) {
        rows.push({ team, index, asset });
      }
    });
  }

  return rows;
}

const rows = [];

for (const item of inspect.inspected || []) {
  const target = trades.find(t => slugOf(t) === item.target.slug);
  if (!target) continue;

  const players = playerAssets(target);

  const coverage = players.map(p => {
    const words = p.asset
      .toLowerCase()
      .replace(/[^a-z0-9 /]+/g, " ")
      .split("/")
      .map(x => x.trim())
      .filter(Boolean);

    const hits = trades
      .filter(t => slugOf(t) !== slugOf(target))
      .filter(t => t.suppressed !== true)
      .filter(t => {
        const blob = textOf(t);
        return words.some(w => {
          const parts = w.split(/\s+/).filter(x => x.length >= 3);
          return parts.length >= 2 && parts.every(part => blob.includes(part));
        });
      })
      .slice(0, 12)
      .map(t => ({
        slug: slugOf(t),
        id: t.id || null,
        tradeDate: dateOf(t),
        publishStatus: t.publishStatus || null,
        teams: t.teams || null,
        summary: t.summary || null
      }));

    return {
      player: p,
      activeOtherHits: hits.length,
      hits
    };
  });

  const uncoveredPlayers = coverage.filter(c => c.activeOtherHits === 0);

  let recommendedAction = "manual";
  let reason = "";

  if ((target.teams || []).length > 2 && players.length > 0 && uncoveredPlayers.length === 0) {
    recommendedAction = "suppress-covered-blended-artifact";
    reason = "Target has more than two teams, generic compensation, and all player assets appear on other active pages.";
  } else if ((target.teams || []).length > 2 && uncoveredPlayers.length > 0) {
    recommendedAction = "do-not-suppress-yet-uncovered-player-assets";
    reason = "Target looks blended, but at least one player asset was not found elsewhere.";
  }

  rows.push({
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
    uncoveredPlayerCount: uncoveredPlayers.length,
    recommendedAction,
    reason,
    coverage
  });
}

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  inspectedCount: rows.length,
  rows
}, null, 2));

console.log("");
console.log("HISTORICAL GENERIC COVERAGE CHECK");
console.log("=".repeat(80));
console.log(`inspected: ${rows.length}`);
console.log(`Report: ${outPath}`);

for (const row of rows) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${row.target.slug} | ${row.target.id} | ${row.target.tradeDate} | status=${row.target.publishStatus}`);
  console.log(`teams=${JSON.stringify(row.target.teams)}`);
  console.log(`players=${row.playerCount} uncovered=${row.uncoveredPlayerCount}`);
  console.log(`recommendedAction=${row.recommendedAction}`);
  console.log(`reason=${row.reason}`);

  for (const c of row.coverage) {
    console.log("");
    console.log(`PLAYER: ${c.player.asset} | ${c.player.team}[${c.player.index}] | hits=${c.activeOtherHits}`);
    for (const hit of c.hits.slice(0, 5)) {
      console.log(`  - ${hit.slug} | ${hit.id} | ${hit.tradeDate} | status=${hit.publishStatus}`);
    }
  }
}
