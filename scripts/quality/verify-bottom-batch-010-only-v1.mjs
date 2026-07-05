import fs from "node:fs";

const previewPath = "reports/quality/nfl-bottom-batch-010-repair-preview-v1.json";
const dataPath = "src/data/nfl/trades.json";

const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const lanes = {};
const ids = new Set();

function walk(x) {
  if (Array.isArray(x)) return x.forEach(walk);
  if (!x || typeof x !== "object") return;
  if (x.id && x.lane) {
    ids.add(x.id);
    lanes[x.lane] = (lanes[x.lane] || 0) + 1;
  }
  for (const v of Object.values(x)) walk(v);
}

walk(preview);

const artifact = /(Bears|Jets|Falcons|Vikings|Cardinals|Patriots|Raiders|Titans|Eagles|Seahawks|Chiefs|Dolphins|Rams|Colts|Broncos|Ravens)'s/g;

const hits = [];
for (const id of ids) {
  const t = trades.find(x => x.id === id);
  if (!t) {
    hits.push(`${id}: MISSING IN DATA`);
    continue;
  }
  const s = JSON.stringify(t);
  const found = [...new Set((s.match(artifact) || []))];
  if (found.length) hits.push(`${id}: ${found.join(", ")}`);
}

console.log("=== BOTTOM BATCH 010 LANE COUNTS ===");
for (const [lane, count] of Object.entries(lanes).sort()) {
  console.log(`${lane}: ${count}`);
}

console.log("\n=== BOTTOM BATCH 010 POSSESSIVE ARTIFACTS ===");
if (hits.length) {
  for (const h of hits) console.log(h);
} else {
  console.log("none");
}
