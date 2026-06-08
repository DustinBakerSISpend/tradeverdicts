const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const OUT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "combined-asset-duplicate-review.json");

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/subsequently traded/g, " ")
    .replace(/conditional/g, " ")
    .replace(/future considerations/g, "future consideration")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAssetText(value) {
  return normalizeText(value)
    .replace(/\boverall\b/g, " ")
    .replace(/\bround\b/g, "rd")
    .replace(/\bpick\b/g, "pk")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueArray(values = []) {
  return Array.from(new Set((values || []).map(clean).filter(Boolean))).sort();
}

function splitCombinedPickAsset(asset) {
  const text = clean(asset);

  if (!text.toLowerCase().includes("pick")) return [text];

  return text
    .replace(/\);/g, ")|")
    .replace(/;\s*/g, "|")
    .replace(/\)\s+and\s+(?=\d{4}\s+\d)/gi, ")|")
    .replace(/\)\s*,\s+and\s+(?=\d{4}\s+\d)/gi, ")|")
    .split("|")
    .map(clean)
    .filter(Boolean);
}

function assetKeysForItem(item) {
  if (!item || !item.asset) return [];

  const type = clean(item.type).toLowerCase();
  const parts = splitCombinedPickAsset(item.asset);

  return parts
    .map((part) => `${type}::${normalizeAssetText(part)}`)
    .filter(Boolean);
}

function allAssetKeys(trade) {
  const keys = [];

  for (const assets of Object.values(trade.assetsReceived || {})) {
    for (const item of assets || []) {
      keys.push(...assetKeysForItem(item));
    }
  }

  return uniqueArray(keys);
}

function teamSetKey(trade) {
  return uniqueArray(trade.teams || []).join("|");
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

const groups = new Map();

for (const trade of trades) {
  const date = clean(trade.tradeDate);
  const teams = teamSetKey(trade);
  const assets = allAssetKeys(trade).join("|");

  if (!date || !teams || !assets) continue;

  const key = `${date}::${teams}::${assets}`;

  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(trade);
}

const review = [];

for (const [key, group] of groups.entries()) {
  if (group.length < 2) continue;

  review.push({
    key,
    count: group.length,
    records: group.map((trade) => ({
      id: trade.id,
      slug: trade.slug,
      tradeDate: trade.tradeDate,
      teams: trade.teams || [],
      sourceTeams: trade.sourceTeams || [],
      canonicalKey: trade.canonicalKey || "",
      grades: trade.grades || {},
      verdict: trade.verdict || "",
      splitAssetKeys: allAssetKeys(trade),
      assetsReceived: trade.assetsReceived || {},
    })),
  });
}

fs.writeFileSync(OUT_FILE, JSON.stringify(review, null, 2));

console.log(`Found ${review.length} combined-asset duplicate candidate groups.`);
console.log(`Saved review file to ${OUT_FILE}`);

for (const group of review.slice(0, 30)) {
  console.log("");
  console.log(`GROUP: ${group.count} records`);
  for (const record of group.records) {
    console.log(`  ${record.tradeDate} | ${record.id} | ${record.slug}`);
  }
}