const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const classPath = path.join(process.cwd(), "audits", "active-suspicious-next-action-classification.json");
const outPath = path.join(process.cwd(), "audits", "next-historical-generic-contamination-inspection.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const classified = JSON.parse(fs.readFileSync(classPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function textOf(t) {
  return JSON.stringify(t).toLowerCase();
}

function compact(t) {
  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    teams: t.teams || null,
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null
  };
}

const rows = classified.rows || classified.classified || [];

const targets = rows
  .filter(r =>
    r.bucket === "D2 historical mixed players plus generic compensation" ||
    r.bucket === "C1 generic unknown one-pick cluster"
  )
  .slice(0, 8);

const inspected = [];

for (const r of targets) {
  const t = find(r.slug);
  if (!t) continue;

  const date = dateOf(t);
  const targetText = textOf(t);

  const assetTerms = [];
  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;
    for (const item of assets) {
      const a = String(item.asset || "");
      if (
        a &&
        !/^(cash|1 cash|draft pick|undisclosed draft pick|past considerations)$/i.test(a) &&
        !/unavailable from source data/i.test(a)
      ) {
        assetTerms.push(a.toLowerCase());
      }
    }
  }

  const assetWords = [...new Set(
    assetTerms
      .join(" ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 5)
  )].slice(0, 12);

  const neighbors = trades
    .filter(x => slugOf(x) !== slugOf(t))
    .filter(x => {
      if (x.suppressed === true) return false;
      if (dateOf(x) === date) return true;

      const blob = textOf(x);
      return assetWords.some(w => blob.includes(w));
    })
    .slice(0, 20)
    .map(compact);

  inspected.push({
    bucket: r.bucket,
    target: compact(t),
    assetWords,
    neighbors
  });
}

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  inspectedCount: inspected.length,
  inspected
}, null, 2));

console.log("");
console.log("NEXT HISTORICAL GENERIC CONTAMINATION INSPECTION");
console.log("=".repeat(80));
console.log(`inspected: ${inspected.length}`);
console.log(`Report: ${outPath}`);

for (const row of inspected) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`BUCKET: ${row.bucket}`);
  console.log(`TARGET: ${row.target.slug} | ${row.target.id} | ${row.target.tradeDate} | status=${row.target.publishStatus}`);
  console.log(`teams=${JSON.stringify(row.target.teams)}`);
  console.log("");
  console.log("assetsReceived:");
  console.dir(row.target.assetsReceived, { depth: null });
  console.log("");
  console.log("summary:");
  console.log(row.target.summary || "(none)");
  console.log("");
  console.log(`neighbors=${row.neighbors.length}`);
  for (const n of row.neighbors.slice(0, 8)) {
    console.log(`- ${n.slug} | ${n.id} | ${n.tradeDate} | status=${n.publishStatus}`);
    console.log(`  teams=${JSON.stringify(n.teams)}`);
  }
}
