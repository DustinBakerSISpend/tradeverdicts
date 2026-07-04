const fs = require("fs");

const data = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

const completedBottomBatches = [1, 2, 3, 4];

const completedIds = new Set();

for (const n of completedBottomBatches) {
  const p = `reports/quality/nfl-bottom-batch-${String(n).padStart(3, "0")}-repair-preview-v1.json`;
  if (!fs.existsSync(p)) continue;

  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const records = j.records || j.results || j.items || [];

  for (const r of records) {
    if (r.id) completedIds.add(r.id);
  }
}

const dateFloor = "2024-01-01";

const after2024 = trades
  .map((t, i) => ({ i, id: t.id, date: t.date || t.tradeDate || "", slug: t.slug || "" }))
  .filter(t => t.date >= dateFloor);

const notInCompletedBottomBatches = after2024.filter(t => !completedIds.has(t.id));

let out = "";
out += "2024+ cleaned-by-bottom-manifest verification\n\n";
out += `Trades dated ${dateFloor} or later: ${after2024.length}\n`;
out += `Found in completed Bottom Batches 001-004: ${after2024.length - notInCompletedBottomBatches.length}\n`;
out += `Not found in completed Bottom Batches 001-004: ${notInCompletedBottomBatches.length}\n\n`;

if (notInCompletedBottomBatches.length) {
  out += "Records needing explanation/check:\n";
  for (const t of notInCompletedBottomBatches) {
    out += `- index ${t.i}: ${t.date} | ${t.id} | ${t.slug}\n`;
  }
} else {
  out += "PASS: every 2024+ live NFL trade is inside completed Bottom Batches 001-004.\n";
}

fs.writeFileSync("reports/quality/nfl-2024-plus-cleaned-verification.txt", out);
console.log(out);
