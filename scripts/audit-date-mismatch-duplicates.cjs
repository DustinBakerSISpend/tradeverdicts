const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const OUT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "date-mismatch-duplicate-review.json");

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

function isUnknownTeam(team) {
  const text = clean(team).toLowerCase();
  return !text || text.includes("unknown") || text.includes("review-needed");
}

function getAllTradeTeams(trade) {
  return uniqueArray([
    ...(trade.teams || []),
    ...(trade.sourceTeams || []),
    ...Object.keys(trade.assetsReceived || {}),
    ...Object.keys(trade.grades || {}),
    ...(trade.perspectives || []).flatMap((p) => [p.primaryTeam, p.partnerTeam]),
  ]).filter((team) => !isUnknownTeam(team));
}

function teamSetKey(trade) {
  return uniqueArray(getAllTradeTeams(trade)).join("|");
}

function assetKey(item) {
  if (!item || !item.asset) return "";
  return `${clean(item.type).toLowerCase()}::${normalizeAssetText(item.asset)}`;
}

function allAssetKeys(trade) {
  const keys = [];

  for (const assets of Object.values(trade.assetsReceived || {})) {
    for (const item of assets || []) {
      const key = assetKey(item);
      if (key) keys.push(key);
    }
  }

  return uniqueArray(keys);
}

function assetSetKey(trade) {
  return allAssetKeys(trade).join("|");
}

function hasMeaningfulAssets(trade) {
  return allAssetKeys(trade).some((key) => {
    const text = key.toLowerCase();
    return (
      text &&
      !text.includes("unknown") &&
      !text.includes("not specified") &&
      !text.includes("future consideration")
    );
  });
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

const groups = new Map();

for (const trade of trades) {
  const teams = teamSetKey(trade);
  const assets = assetSetKey(trade);

  if (!teams || !assets || !hasMeaningfulAssets(trade)) continue;

  const key = `${teams}::${assets}`;

  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(trade);
}

const review = [];

for (const [key, group] of groups.entries()) {
  if (group.length < 2) continue;

  const dates = uniqueArray(group.map((trade) => trade.tradeDate));
  if (dates.length < 2) continue;

  review.push({
    key,
    dates,
    count: group.length,
    records: group
      .sort((a, b) => clean(a.tradeDate).localeCompare(clean(b.tradeDate)))
      .map((trade) => ({
        id: trade.id,
        slug: trade.slug,
        tradeDate: trade.tradeDate,
        teams: trade.teams || [],
        sourceTeams: trade.sourceTeams || [],
        canonicalKey: trade.canonicalKey || "",
        dateTeamsKey: trade.dateTeamsKey || "",
        verdict: trade.verdict || "",
        grades: trade.grades || {},
        assets: allAssetKeys(trade),
        summary: trade.summary || "",
      })),
  });
}

review.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

fs.writeFileSync(OUT_FILE, JSON.stringify(review, null, 2));

console.log(`Found ${review.length} date-mismatch duplicate candidate groups.`);
console.log(`Saved review file to ${OUT_FILE}`);

for (const group of review.slice(0, 20)) {
  console.log("");
  console.log(`GROUP: ${group.count} records | dates: ${group.dates.join(", ")}`);
  for (const record of group.records) {
    console.log(`  ${record.tradeDate} | ${record.id} | ${record.slug}`);
  }
}