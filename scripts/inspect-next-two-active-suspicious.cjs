const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "next-two-active-suspicious-inspection.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const targets = [
  "roger-zatkoff-rams-mutually-cancelled-by-browns-rams-after-zatkoff-refused-to-re",
  "cardinals-1956-09-19-cardinals-tom-dahms-1957-sixth-round-pick-70-john-nisby-jack-nisby"
];

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
    grades: t.grades || null,
    verdict: t.verdict || null,
    summary: t.summary || null,
    partnerSummary: t.partnerSummary || null,
    qaNotes: t.qaNotes || null,
    perspectives: t.perspectives || null
  };
}

const results = [];

for (const targetSlug of targets) {
  const target = trades.find(t => slugOf(t) === targetSlug);

  if (!target) {
    results.push({ targetSlug, error: "not found" });
    continue;
  }

  const date = dateOf(target);
  const words = norm(targetSlug).split(" ").filter(w => w.length >= 4);

  const neighbors = trades
    .filter(t => slugOf(t) !== targetSlug)
    .filter(t => {
      if (dateOf(t) === date) return true;
      const s = norm(slugOf(t));
      return words.some(w => s.includes(w));
    })
    .slice(0, 30)
    .map(compact);

  results.push({
    target: compact(target),
    sameDateOrNameNeighbors: neighbors
  });
}

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  results
}, null, 2));

console.log("");
console.log("NEXT TWO ACTIVE SUSPICIOUS INSPECTION");
console.log("=".repeat(80));
console.log(`Report: ${outPath}`);

for (const r of results) {
  console.log("");
  console.log("-".repeat(80));

  if (r.error) {
    console.log(`${r.targetSlug}: ${r.error}`);
    continue;
  }

  console.log(`TARGET: ${r.target.slug} | ${r.target.id} | ${r.target.tradeDate} | status=${r.target.publishStatus}`);
  console.log(`teams=${JSON.stringify(r.target.teams)}`);
  console.log("");
  console.log("assetsReceived:");
  console.dir(r.target.assetsReceived, { depth: null });
  console.log("");
  console.log("summary:");
  console.log(r.target.summary || "(none)");
  console.log("");
  console.log("qaNotes:");
  console.log(r.target.qaNotes || "(none)");
  console.log("");
  console.log(`neighbors found: ${r.sameDateOrNameNeighbors.length}`);
  for (const n of r.sameDateOrNameNeighbors.slice(0, 8)) {
    console.log(`- ${n.slug} | ${n.id} | ${n.tradeDate} | status=${n.publishStatus} | suppressed=${n.suppressed}`);
  }
}
