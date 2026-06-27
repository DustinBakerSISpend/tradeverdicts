const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const coveragePath = path.join(process.cwd(), "audits", "remaining-historical-coverage-check.json");
const outPath = path.join(process.cwd(), "audits", "strict-remaining-historical-suppression-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const coverage = JSON.parse(fs.readFileSync(coveragePath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function yearOf(t) {
  const d = dateOf(t);
  return d ? Number(String(d).slice(0, 4)) : null;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function variants(asset) {
  const raw = String(asset || "")
    .replace(/\([^)]*\)/g, "")
    .split(/\s+and\s+|\/|,/i)
    .map(x => norm(x))
    .filter(Boolean);

  return [...new Set(raw.filter(v => v.split(" ").filter(w => w.length >= 3).length >= 2))];
}

function assetBlob(t) {
  const parts = [slugOf(t), t.summary || ""];
  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;
    for (const item of assets) parts.push(item.asset || "");
  }
  return norm(parts.join(" "));
}

function hasVariant(blob, variant) {
  const parts = variant.split(" ").filter(w => w.length >= 3);
  return parts.length >= 2 && parts.every(p => blob.includes(p));
}

const planned = [];
const blocked = [];

for (const row of coverage.rows || []) {
  if (row.recommendedAction !== "suppress-covered-blended-artifact") continue;

  const targetSlug = row.target.slug;
  const targetYear = Number(String(row.target.tradeDate || "").slice(0, 4));

  const strictCoverage = [];

  for (const c of row.coverage || []) {
    const playerAsset = c.player.asset;
    const vars = variants(playerAsset);

    const strictHits = trades
      .filter(t => slugOf(t) !== targetSlug)
      .filter(t => t.suppressed !== true)
      .filter(t => {
        const y = yearOf(t);
        if (!y || !targetYear) return false;
        if (Math.abs(y - targetYear) > 2) return false;

        const blob = assetBlob(t);
        return vars.some(v => hasVariant(blob, v));
      })
      .slice(0, 8)
      .map(t => ({
        slug: slugOf(t),
        id: t.id || null,
        tradeDate: dateOf(t),
        publishStatus: t.publishStatus || null,
        teams: t.teams || null
      }));

    strictCoverage.push({
      player: c.player,
      variants: vars,
      strictHits
    });
  }

  const uncovered = strictCoverage.filter(c => c.strictHits.length === 0);

  const targetIsMultiTeam = Array.isArray(row.target.teams) && row.target.teams.length > 2;
  const hasPlayers = strictCoverage.length > 0;

  if (targetIsMultiTeam && hasPlayers && uncovered.length === 0) {
    planned.push({
      slug: targetSlug,
      id: row.target.id,
      tradeDate: row.target.tradeDate,
      publishStatus: row.target.publishStatus,
      teams: row.target.teams,
      summary: row.target.summary,
      playerCount: strictCoverage.length,
      uncoveredPlayerCount: uncovered.length,
      reason: "Strict check passed: multi-team generic artifact and every player asset has active same-era coverage.",
      strictCoverage
    });
  } else {
    blocked.push({
      slug: targetSlug,
      id: row.target.id,
      tradeDate: row.target.tradeDate,
      publishStatus: row.target.publishStatus,
      teams: row.target.teams,
      summary: row.target.summary,
      playerCount: strictCoverage.length,
      uncoveredPlayerCount: uncovered.length,
      reason: "Strict same-era coverage failed or target is not a safe multi-team artifact.",
      strictCoverage
    });
  }
}

fs.writeFileSync(outPath, JSON.stringify({
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  plannedSuppressionCount: planned.length,
  blockedCount: blocked.length,
  planned,
  blocked
}, null, 2));

console.log("");
console.log("STRICT REMAINING HISTORICAL SUPPRESSION DRY RUN");
console.log("=".repeat(80));
console.log(`planned suppressions: ${planned.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Planned suppressions:");
for (const row of planned) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate} | status=${row.publishStatus}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`players=${row.playerCount} uncovered=${row.uncoveredPlayerCount}`);
  console.log(`reason=${row.reason}`);
  for (const c of row.strictCoverage) {
    console.log(`PLAYER: ${c.player.asset} | strictHits=${c.strictHits.length}`);
    for (const h of c.strictHits.slice(0, 4)) {
      console.log(`  - ${h.slug} | ${h.id} | ${h.tradeDate} | status=${h.publishStatus}`);
    }
  }
}

console.log("");
console.log("Blocked:");
for (const row of blocked) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate} | status=${row.publishStatus}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`players=${row.playerCount} uncovered=${row.uncoveredPlayerCount}`);
  console.log(`reason=${row.reason}`);
  for (const c of row.strictCoverage) {
    console.log(`PLAYER: ${c.player.asset} | strictHits=${c.strictHits.length}`);
    for (const h of c.strictHits.slice(0, 4)) {
      console.log(`  - ${h.slug} | ${h.id} | ${h.tradeDate} | status=${h.publishStatus}`);
    }
  }
}
