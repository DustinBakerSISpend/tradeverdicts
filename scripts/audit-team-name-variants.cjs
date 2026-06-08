const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const OUT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "team-name-variant-audit.json");

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function add(map, value, location) {
  const name = clean(value);
  if (!name) return;

  if (!map.has(name)) {
    map.set(name, {
      name,
      count: 0,
      locations: new Set(),
      exampleTradeIds: new Set(),
      exampleSlugs: new Set(),
    });
  }

  const item = map.get(name);
  item.count += 1;
  item.locations.add(location.type);

  if (location.id) item.exampleTradeIds.add(location.id);
  if (location.slug) item.exampleSlugs.add(location.slug);
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

const map = new Map();

for (const trade of trades) {
  const loc = { id: trade.id, slug: trade.slug };

  for (const team of trade.teams || []) {
    add(map, team, { ...loc, type: "teams" });
  }

  for (const team of trade.sourceTeams || []) {
    add(map, team, { ...loc, type: "sourceTeams" });
  }

  for (const team of Object.keys(trade.assetsReceived || {})) {
    add(map, team, { ...loc, type: "assetsReceived" });
  }

  for (const team of Object.keys(trade.grades || {})) {
    add(map, team, { ...loc, type: "grades" });
  }

  for (const p of trade.perspectives || []) {
    add(map, p.sourceTeam, { ...loc, type: "perspectives.sourceTeam" });
    add(map, p.primaryTeam, { ...loc, type: "perspectives.primaryTeam" });
    add(map, p.partnerTeam, { ...loc, type: "perspectives.partnerTeam" });
  }
}

const rows = Array.from(map.values())
  .map((item) => ({
    name: item.name,
    count: item.count,
    locations: Array.from(item.locations).sort(),
    exampleTradeIds: Array.from(item.exampleTradeIds).slice(0, 5),
    exampleSlugs: Array.from(item.exampleSlugs).slice(0, 5),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(OUT_FILE, JSON.stringify(rows, null, 2));

console.log(`Found ${rows.length} unique team-name values.`);
console.log(`Saved audit to ${OUT_FILE}`);

console.log("\nTop 40 most common:");
for (const row of [...rows].sort((a, b) => b.count - a.count).slice(0, 40)) {
  console.log(`${String(row.count).padStart(5)}  ${row.name}`);
}