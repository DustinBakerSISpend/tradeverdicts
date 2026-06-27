const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const modernPath = path.join(process.cwd(), "audits", "inspect-modern-active-suspicious.json");
const outPath = path.join(process.cwd(), "audits", "modern-suspicious-pick-coverage-audit.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const modern = JSON.parse(fs.readFileSync(modernPath, "utf8"));

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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAssetText(asset) {
  return String(asset || "")
    .replace(/\band\s+(?=\d{4}\s+\d)/gi, "|||")
    .replace(/,\s*(?=\d{4}\s+\d)/g, "|||")
    .replace(/;\s*(?=\d{4}\s+\d)/g, "|||")
    .split("|||")
    .map(s => s.trim())
    .filter(Boolean);
}

function pickSigsFromAsset(asset) {
  const chunks = splitAssetText(asset);
  const sigs = [];

  for (const chunk of chunks) {
    const text = norm(chunk);

    const y = text.match(/\b(19|20)\d{2}\b/);
    const round = text.match(/\b(1st|2nd|3rd|[4-9]th|10th|11th|12th)\s+round\b/);
    const overall = text.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/);

    if (y && round && overall) {
      const roundNum = Number(round[1].replace(/\D/g, ""));
      sigs.push(`${y[0]}-R${roundNum}-P${Number(overall[1])}`);
    }
  }

  return sigs;
}

function allPickSigs(t) {
  const sigs = [];

  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;

    for (const item of assets) {
      const asset = String(item.asset || "");
      if (item.type === "pick" || /round pick|overall/.test(asset.toLowerCase())) {
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

const checked = [];

for (const row of modern.targets || []) {
  const target = trades.find(t => slugOf(t) === row.slug);
  if (!target || target.suppressed === true) continue;

  const targetSigs = allPickSigs(target);

  const coverage = targetSigs.map(sig => {
    const hits = trades
      .filter(t => slugOf(t) !== slugOf(target))
      .filter(t => t.suppressed !== true)
      .filter(t => allPickSigs(t).includes(sig))
      .slice(0, 12)
      .map(compact);

    return {
      sig,
      activeOtherHits: hits.length,
      hits
    };
  });

  const uncovered = coverage.filter(c => c.activeOtherHits === 0);
  const allCovered = targetSigs.length > 0 && uncovered.length === 0;

  let recommendedAction = "manual";
  let reason = "Needs manual review.";

  if (allCovered && (target.teams || []).length > 2) {
    recommendedAction = "candidate-suppress-covered-pick-aggregate";
    reason = "All pick signatures appear on other active pages and this row has more than two teams.";
  } else if (targetSigs.length > 0 && uncovered.length > 0) {
    recommendedAction = "retain-or-split-missing-pick-coverage";
    reason = "At least one pick signature is not covered elsewhere.";
  } else if (!targetSigs.length) {
    recommendedAction = "manual-no-pick-signatures";
    reason = "No exact pick signatures found.";
  }

  checked.push({
    bucket: row.bucket,
    target: {
      id: target.id || null,
      slug: slugOf(target),
      tradeDate: dateOf(target),
      publishStatus: target.publishStatus || null,
      teams: target.teams || null,
      summary: target.summary || null,
      assetsReceived: target.assetsReceived || null
    },
    pickSigCount: targetSigs.length,
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
console.log("MODERN SUSPICIOUS PICK COVERAGE AUDIT");
console.log("=".repeat(80));
console.log(`checked: ${checked.length}`);
console.log(`Report: ${outPath}`);

for (const row of checked) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`BUCKET: ${row.bucket}`);
  console.log(`${row.target.slug} | ${row.target.id} | ${row.target.tradeDate} | status=${row.target.publishStatus}`);
  console.log(`teams=${JSON.stringify(row.target.teams)}`);
  console.log(`pickSigs=${row.pickSigCount} uncovered=${row.uncoveredPickSigCount}`);
  console.log(`recommendedAction=${row.recommendedAction}`);
  console.log(`reason=${row.reason}`);
  console.log("summary:");
  console.log(row.target.summary || "(none)");

  for (const c of row.coverage) {
    console.log(`SIG: ${c.sig} | hits=${c.activeOtherHits}`);
    for (const h of c.hits.slice(0, 4)) {
      console.log(`  - ${h.slug} | ${h.id} | ${h.tradeDate} | status=${h.publishStatus}`);
    }
  }
}
