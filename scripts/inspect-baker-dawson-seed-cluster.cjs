const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const slugs = [
  "1984-third-round-pick-62-eric-williams-michael-arizona-st-louis-cardinals-1983-0",
  "mike-dawson-arizona-st-louis-cardinals-1983-07-18",
  "cardinals-1983-07-19-unknown-partner-al-baker-bubba-baker-unknown-not-disclosed",
  "not-specified-unknown-partner-1983-07-19"
];

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

console.log("");
console.log("BAKER/DAWSON SEED CLUSTER DEEP INSPECTION");
console.log("=".repeat(80));

for (const slug of slugs) {
  const t = find(slug);

  console.log("");
  console.log("-".repeat(80));

  if (!t) {
    console.log(`MISSING: ${slug}`);
    continue;
  }

  console.log(`${slugOf(t)} | ${t.id || ""} | ${t.tradeDate || t.date || ""}`);
  console.log(`status=${t.publishStatus || null} | suppressed=${t.suppressed ?? null}`);
  console.log(`teams=${JSON.stringify(t.teams || [])}`);
  console.log("");
  console.log("assetsReceived:");
  console.dir(t.assetsReceived || {}, { depth: null });
  console.log("");
  console.log("summary:");
  console.log(t.summary || "(none)");
  console.log("");
  console.log("qaNotes:");
  console.log(t.qaNotes || "(none)");
}
