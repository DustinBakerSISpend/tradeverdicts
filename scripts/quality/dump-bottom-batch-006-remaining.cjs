const fs = require("fs");

const previewPath = "reports/quality/nfl-bottom-batch-006-repair-preview-v1.json";
const dataPath = "src/data/nfl/trades.json";
const outPath = "reports/quality/nfl-bottom-batch-006-remaining-9-dump.txt";

const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

const records = preview.records || preview.results || preview.items || [];
const remaining = records.filter(r => {
  const lane = r.lane || r.repairLane || r.repair_lane || r.classification || r.status || "";
  return lane !== "clean_after_v3" && lane !== "clean_after_v3_language_scan";
});

let out = "Bottom Batch 006 remaining non-clean record dump\n\n";
out += "Remaining count: " + remaining.length + "\n\n";

for (const r of remaining) {
  const id = r.id || r.tradeId || r.trade_id;
  const t = trades.find(x => (x.id || x.tradeId || x.trade_id) === id);

  out += "====================\n";
  out += "id: " + id + "\n";
  out += "lane: " + (r.lane || r.repairLane || r.repair_lane || "") + "\n";
  out += "index: " + r.index + "\n";

  if (!t) {
    out += "NOT FOUND IN LIVE DATA\n\n";
    continue;
  }

  out += "slug: " + (t.slug || "") + "\n";
  out += "date: " + (t.date || t.tradeDate || "") + "\n";
  out += "verdict: " + (t.verdict || "") + "\n";
  out += "grades: " + JSON.stringify(t.grades || {}) + "\n";
  out += "assetsReceived: " + JSON.stringify(t.assetsReceived || {}, null, 2) + "\n";
  out += "summary: " + (t.summary || "") + "\n";
  out += "partnerSummary: " + (t.partnerSummary || "") + "\n";
  out += "analysis: " + (t.analysis || "") + "\n";
  out += "perspectives count: " + (Array.isArray(t.perspectives) ? t.perspectives.length : 0) + "\n";

  if (Array.isArray(t.perspectives)) {
    t.perspectives.forEach((p, i) => {
      out += "\nPERSPECTIVE " + i + "\n";
      out += JSON.stringify(p, null, 2) + "\n";
    });
  }

  out += "\n";
}

fs.writeFileSync(outPath, out);
console.log(out);
