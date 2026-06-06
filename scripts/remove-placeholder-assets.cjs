const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");

const PLACEHOLDER_PATTERNS = [
  /^unspecified consideration$/i,
  /^future consideration$/i,
  /^future considerations$/i,
  /^cash considerations$/i,
  /^considerations$/i,
  /^unknown$/i,
  /^\?$/i,
  /^tbd$/i,
];

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isPlaceholderAsset(asset) {
  const text = clean(asset);
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeAsset(asset) {
  return clean(asset)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeAssets(assets = []) {
  const seen = new Set();
  const result = [];

  for (const item of assets || []) {
    if (!item || !item.asset) continue;

    const key = `${item.type || ""}|${normalizeAsset(item.asset)}`;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(item);
  }

  return result;
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

let changedTrades = 0;
let removedAssets = 0;

for (const trade of trades) {
  let changed = false;

  for (const [team, assets] of Object.entries(trade.assetsReceived || {})) {
    const realAssets = (assets || []).filter((item) => !isPlaceholderAsset(item.asset));
    const placeholders = (assets || []).filter((item) => isPlaceholderAsset(item.asset));

    // Only remove placeholder assets when the same side already has real assets.
    if (realAssets.length > 0 && placeholders.length > 0) {
      trade.assetsReceived[team] = dedupeAssets(realAssets);
      removedAssets += placeholders.length;
      changed = true;
    } else {
      const deduped = dedupeAssets(assets || []);
      if (deduped.length !== (assets || []).length) {
        trade.assetsReceived[team] = deduped;
        changed = true;
      }
    }
  }

  if (changed) changedTrades++;
}

fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));

console.log("Removed placeholder assets when real assets existed.");
console.log(`Trades scanned: ${trades.length}`);
console.log(`Trades changed: ${changedTrades}`);
console.log(`Placeholder assets removed: ${removedAssets}`);
console.log(`Saved trades to ${TRADES_FILE}`);