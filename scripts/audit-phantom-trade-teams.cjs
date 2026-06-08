const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const OUT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "phantom-trade-team-audit.json");

function clean(value) {
  return String(value ?? "").trim();
}

function unique(values = []) {
  return Array.from(new Set(values.map(clean).filter(Boolean))).sort();
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

const flagged = [];

for (const trade of trades) {
  const teams = unique(trade.teams || []);
  const sourceTeams = unique(trade.sourceTeams || []);

  if (teams.length <= 2) continue;
  if (sourceTeams.length < 2) continue;

  const extras = teams.filter((team) => !sourceTeams.includes(team));

  if (extras.length > 0) {
    flagged.push({
      id: trade.id,
      slug: trade.slug,
      tradeDate: trade.tradeDate,
      verdict: trade.verdict,
      teams,
      sourceTeams,
      phantomTeams: extras,
      assetsReceivedTeams: unique(Object.keys(trade.assetsReceived || {})),
      gradeTeams: unique(Object.keys(trade.grades || {})),
      summary: trade.summary || "",
    });
  }
}

flagged.sort((a, b) => b.phantomTeams.length - a.phantomTeams.length || a.tradeDate.localeCompare(b.tradeDate));

fs.writeFileSync(OUT_FILE, JSON.stringify(flagged, null, 2));

console.log(`Flagged ${flagged.length} trades with likely phantom teams.`);
console.log(`Saved audit to ${OUT_FILE}`);

for (const row of flagged.slice(0, 40)) {
  console.log("");
  console.log(`${row.tradeDate} | ${row.id} | ${row.slug}`);
  console.log(`  teams: ${row.teams.join(", ")}`);
  console.log(`  sourceTeams: ${row.sourceTeams.join(", ")}`);
  console.log(`  phantom: ${row.phantomTeams.join(", ")}`);
}