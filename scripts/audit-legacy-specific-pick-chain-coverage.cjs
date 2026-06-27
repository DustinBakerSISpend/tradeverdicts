const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const classPath = path.join(process.cwd(), "audits", "active-suspicious-next-action-classification.json");
const outPath = path.join(process.cwd(), "audits", "legacy-specific-pick-chain-coverage-audit.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const classified = JSON.parse(fs.readFileSync(classPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roundNum(r) {
  const x = String(r || "").toLowerCase();
  const map = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
    seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12
  };
  if (map[x]) return map[x];
  const n = x.match(/\d+/);
  return n ? Number(n[0]) : null;
}

function pickSigsFromAsset(asset) {
  const text = norm(asset);
  const sigs = [];

  const year = text.match(/\b(19|20)\d{2}\b/);
  const round = text.match(/\b(1st|2nd|3rd|[4-9]th|10th|11th|12th|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+round\b/);

  if (!year || !round) return sigs;

  const overallA = text.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/);
  const overallB = text.match(/#\s*(\d{1,3})\b/);

  const overall = overallA ? Number(overallA[1]) : overallB ? Number(overallB[1]) : null;

  if (overall) sigs.push(`${year[0]}-R${roundNum(round[1])}-P${overall}`);

  return sigs;
}

function allPickSigs(t) {
  const sigs = [];

  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;

    for (const item of assets) {
      const asset = String(item.asset || "");
      if (item.type === "pick" || /round pick|overall|#\d+/.test(asset.toLowerCase())) {
        for (const sig of pickSigsFromAsset(asset)) sigs.push(sig);
      }
    }
  }

  return [...new Set(sigs)].sort();
}

function compact(t) {
  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    teams: t.teams || null,
    pickSigs: allPickSigs(t),
    summary: t.summary || null
  };
}

const rows = (classified.rows || classified.classified || [])
  .filter(r => r.bucket === "D3 multi-team specific pick chain");

const checked = [];

for (const r of rows) {
  const target = trades.find(t => slugOf(t) === r.slug);
  if (!target || target.suppressed === true) continue;

  const sigs = allPickSigs(target);

  const coverage = sigs.map(sig => {
    const hits = trades
      .filter(t => slugOf(t) !== slugOf(target))
      .filter(t => t.suppressed !== true)
      .filter(t => allPickSigs(t).includes(sig))
      .slice(0, 10)
      .map(compact);

    return { sig, hits };
  });

  const uncovered = coverage.filter(c => c.hits.length === 0);

  let recommendedAction = "manual";
  let reason = "Needs manual review.";

  if (sigs.length > 0 && uncovered.length === 0 && Array.isArray(target.teams) && target.teams.length > 2) {
    recommendedAction = "candidate-suppress-covered-legacy-pick-chain";
    reason = "All legacy-formatted pick signatures appear on other active pages and this row has more than two teams.";
  } else if (sigs.length > 0 && uncovered.length > 0) {
    recommendedAction = "retain-or-split-missing-legacy-pick-coverage";
    reason = "At least one legacy-formatted pick signature is not covered elsewhere.";
  } else {
    recommendedAction = "manual-no-legacy-pick-signatures";
    reason = "No exact legacy pick signatures found.";
  }

  checked.push({
    bucket: r.bucket,
    target: {
      slug: slugOf(target),
      id: target.id || null,
      tradeDate: dateOf(target),
      publishStatus: target.publishStatus || null,
      teams: target.teams || null,
      summary: target.summary || null,
      assetsReceived: target.assetsReceived || null
    },
    pickSigCount: sigs.length,
    uncoveredPickSigCount: uncovered.length,
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
console.log("LEGACY SPECIFIC PICK-CHAIN COVERAGE AUDIT");
console.log("=".repeat(80));
console.log(`checked: ${checked.length}`);
console.log(`Report: ${outPath}`);

for (const row of checked) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${row.target.slug} | ${row.target.id} | ${row.target.tradeDate} | status=${row.target.publishStatus}`);
  console.log(`teams=${JSON.stringify(row.target.teams)}`);
  console.log(`pickSigs=${row.pickSigCount} uncovered=${row.uncoveredPickSigCount}`);
  console.log(`recommendedAction=${row.recommendedAction}`);
  console.log(`reason=${row.reason}`);
  console.log("summary:");
  console.log(row.target.summary || "(none)");

  for (const c of row.coverage) {
    console.log(`SIG: ${c.sig} | hits=${c.hits.length}`);
    for (const h of c.hits.slice(0, 4)) {
      console.log(`  - ${h.slug} | ${h.id} | ${h.tradeDate} | status=${h.publishStatus}`);
    }
  }
}
