const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "inspect-final-2024-retained-aggregate.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const targetSlug = "reviewed-and-retained-for-public-data-completeness";
const targetId = "HOU-2024-0107";
const missingTerms = [
  "2025 2nd round pick (48th overall, Aireontae Ersery)",
  "2025 2nd round pick (58th overall, Jack Bech)",
  "Aireontae Ersery",
  "Jack Bech",
  "2025 2nd round pick (48",
  "2025 2nd round pick (58",
  "2025-R2-P48",
  "2025-R2-P58"
];

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
      sigs.push(`${y[0]}-R${Number(round[1].replace(/\D/g, ""))}-P${Number(overall[1])}`);
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

function blob(t) {
  return [
    t.id,
    t.slug,
    t.tradeDate,
    t.summary,
    t.qaNotes,
    JSON.stringify(t.teams || []),
    JSON.stringify(t.assetsReceived || {})
  ].join(" ").toLowerCase();
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
    summary: t.summary || null,
    assetsReceived: t.assetsReceived || null
  };
}

const target = trades.find(t => slugOf(t) === targetSlug || t.id === targetId);

if (!target) {
  console.error(`Missing target row: ${targetSlug} / ${targetId}`);
  process.exit(1);
}

const targetSigs = allPickSigs(target);

const sigCoverage = targetSigs.map(sig => {
  const activeHits = trades
    .filter(t => slugOf(t) !== slugOf(target))
    .filter(t => t.suppressed !== true)
    .filter(t => allPickSigs(t).includes(sig))
    .map(compact);

  const suppressedHits = trades
    .filter(t => slugOf(t) !== slugOf(target))
    .filter(t => t.suppressed === true)
    .filter(t => allPickSigs(t).includes(sig))
    .map(compact);

  return {
    sig,
    activeHitCount: activeHits.length,
    suppressedHitCount: suppressedHits.length,
    activeHits: activeHits.slice(0, 20),
    suppressedHits: suppressedHits.slice(0, 20)
  };
});

const termSearch = missingTerms.map(term => {
  const n = term.toLowerCase();
  const hits = trades
    .filter(t => slugOf(t) !== slugOf(target))
    .filter(t => blob(t).includes(n))
    .map(compact);

  return {
    term,
    hitCount: hits.length,
    activeHitCount: hits.filter(h => h.suppressed !== true).length,
    suppressedHitCount: hits.filter(h => h.suppressed === true).length,
    hits: hits.slice(0, 30)
  };
});

const sameDateOrTeams = trades
  .filter(t => slugOf(t) !== slugOf(target))
  .filter(t => {
    const teams = t.teams || [];
    const overlap = teams.filter(team => (target.teams || []).includes(team)).length;
    const dateClose = String(dateOf(t) || "").slice(0, 4) >= "2024";
    return overlap >= 2 && dateClose;
  })
  .map(compact)
  .slice(0, 80);

const report = {
  generatedAt: new Date().toISOString(),
  target: compact(target),
  targetFull: target,
  targetPickSigs: targetSigs,
  sigCoverage,
  termSearch,
  sameDateOrTeams
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("INSPECT FINAL 2024 RETAINED AGGREGATE");
console.log("=".repeat(80));
console.log(`Report: ${outPath}`);
console.log("");
console.log(`${slugOf(target)} | ${target.id} | ${dateOf(target)} | status=${target.publishStatus} | suppressed=${target.suppressed ?? null}`);
console.log(`teams=${JSON.stringify(target.teams)}`);
console.log(`pickSigs=${JSON.stringify(targetSigs)}`);
console.log("");
console.log("Target assets:");
console.dir(target.assetsReceived, { depth: null });
console.log("");
console.log("Target summary:");
console.log(target.summary || "(none)");

console.log("");
console.log("Pick signature coverage:");
for (const row of sigCoverage) {
  console.log("-".repeat(80));
  console.log(`${row.sig} | activeHits=${row.activeHitCount} suppressedHits=${row.suppressedHitCount}`);
  for (const h of row.activeHits.slice(0, 5)) {
    console.log(`  ACTIVE     - ${h.slug} | ${h.id} | ${h.tradeDate} | status=${h.publishStatus}`);
  }
  for (const h of row.suppressedHits.slice(0, 5)) {
    console.log(`  SUPPRESSED - ${h.slug} | ${h.id} | ${h.tradeDate} | status=${h.publishStatus}`);
  }
}

console.log("");
console.log("Missing-term search:");
for (const row of termSearch) {
  console.log("-".repeat(80));
  console.log(`${row.term} | hits=${row.hitCount} active=${row.activeHitCount} suppressed=${row.suppressedHitCount}`);
  for (const h of row.hits.slice(0, 8)) {
    console.log(`  - ${h.slug} | ${h.id} | ${h.tradeDate} | status=${h.publishStatus} | suppressed=${h.suppressed}`);
  }
}

console.log("");
console.log("Recent same-team-overlap rows:");
for (const h of sameDateOrTeams.slice(0, 30)) {
  console.log("-".repeat(80));
  console.log(`${h.slug} | ${h.id} | ${h.tradeDate} | status=${h.publishStatus} | suppressed=${h.suppressed}`);
  console.log(`teams=${JSON.stringify(h.teams)}`);
  console.log(`pickSigs=${JSON.stringify(h.pickSigs)}`);
  console.log(`summary=${h.summary || "(none)"}`);
}
