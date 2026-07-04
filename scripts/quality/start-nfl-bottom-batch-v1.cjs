const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

function die(msg) {
  console.error("");
  console.error("ERROR: " + msg);
  console.error("");
  process.exit(1);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function safe(v) {
  return v == null ? "" : String(v);
}

function label(n) {
  return String(Number(n || 1)).padStart(3, "0");
}

function getTrades() {
  const data = readJson(DATA_PATH);
  const trades = Array.isArray(data) ? data : data.trades;
  if (!Array.isArray(trades)) die("Could not find trades array in src/data/nfl/trades.json");
  return trades;
}

function getId(t) {
  return safe(t.id || t.tradeId || t.trade_id);
}

const batchNum = Number(process.argv[2] || 1);
const batchSize = Number(process.argv[3] || 100);

if (!Number.isFinite(batchNum) || batchNum < 1) die("Batch number must be 1 or higher.");
if (!Number.isFinite(batchSize) || batchSize < 1) die("Batch size must be 1 or higher.");

fs.mkdirSync(REPORT_DIR, { recursive: true });

const trades = getTrades();

const total = trades.length;
const endExclusive = total - ((batchNum - 1) * batchSize);
const startIndex = Math.max(0, endExclusive - batchSize);
const endIndex = endExclusive - 1;
const count = endExclusive - startIndex;

if (count <= 0) die(`Bottom batch ${batchNum} is outside current trade count ${total}.`);

const batchLabel = label(batchNum);
const manifestPath = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-manifest.json`);
const manifestTxtPath = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-manifest.txt`);

const records = trades.slice(startIndex, endExclusive).map((t, offset) => ({
  originalIndex: startIndex + offset,
  id: getId(t),
  slug: safe(t.slug),
  verdict: safe(t.verdict),
  grades: t.grades || {},
  perspectiveCount: Array.isArray(t.perspectives) ? t.perspectives.length : 0
}));

const manifest = {
  generatedAt: new Date().toISOString(),
  mode: "bottom-up",
  bottomBatchNumber: batchNum,
  batchLabel,
  batchSize,
  totalTradesAtManifest: total,
  startIndex,
  endIndex,
  count,
  records
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const txt = `# NFL Bottom Batch ${batchLabel} Manifest

Generated: ${manifest.generatedAt}

Mode:
- Bottom-up / newest-first

Current total NFL trades:
- ${total}

Batch range:
- Original start index: ${startIndex}
- Original end index: ${endIndex}
- Count: ${count}

Use these commands:
node scripts\\quality\\run-nfl-batch-audit.mjs --bottom ${batchNum}
node scripts\\quality\\apply-nfl-bottom-batch-auto-copy-v1.mjs --bottom ${batchNum}
node scripts\\quality\\finalize-nfl-batch.mjs --bottom ${batchNum}

Records:
${records.map((r, i) => `${String(i + 1).padStart(3, "0")}. index=${r.originalIndex} id=${r.id} slug=${r.slug} verdict=${r.verdict} perspectives=${r.perspectiveCount}`).join("\n")}
`;

fs.writeFileSync(manifestTxtPath, txt);

console.log("");
console.log(`NFL Bottom Batch ${batchLabel} manifest created.`);
console.log("");
console.log(`Total trades: ${total}`);
console.log(`Original indexes: ${startIndex}-${endIndex}`);
console.log(`Count: ${count}`);
console.log("");
console.log("Next:");
console.log(`node scripts\\quality\\run-nfl-batch-audit.mjs --bottom ${batchNum}`);
console.log("");
console.log(`Manifest: reports\\quality\\nfl-bottom-batch-${batchLabel}-manifest.txt`);
