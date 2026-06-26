const fs = require("fs");

const TRADES = "src/data/nfl/trades.json";
const AUDIT = "src/data/nfl/perspective-grade-winner-alignment-audit.json";
const OUT = "src/data/nfl/perspective-grade-alignment-fix-dry-run.json";

const trades = JSON.parse(fs.readFileSync(TRADES, "utf8"));
const audit = JSON.parse(fs.readFileSync(AUDIT, "utf8"));

function labelForTeam(team) {
  const labels = {
    "arizona-cardinals": "Arizona/St. Louis Cardinals Win",
    "los-angeles-rams": "Los Angeles/St. Louis Rams Win",
    "tennessee-titans": "Houston Oilers/Tennessee Titans Win",
    "los-angeles-chargers": "Los Angeles/San Diego Chargers Win",
    "washington-commanders": "Washington Redskins/Commanders Win",
    "indianapolis-colts": "Baltimore/Indianapolis Colts Win",
    "las-vegas-raiders": "Oakland/Los Angeles/Las Vegas Raiders Win",
    "san-francisco-49ers": "San Francisco 49ers Win",
    "new-york-giants": "New York Giants Win",
    "new-york-jets": "New York Jets Win",
    "cleveland-browns": "Cleveland Browns Win",
    "pittsburgh-steelers": "Pittsburgh Steelers Win",
    "green-bay-packers": "Green Bay Packers Win",
    "philadelphia-eagles": "Philadelphia Eagles Win",
    "minnesota-vikings": "Minnesota Vikings Win",
    "denver-broncos": "Denver Broncos Win",
    "buffalo-bills": "Buffalo Bills Win",
    "miami-dolphins": "Miami Dolphins Win",
    "dallas-cowboys": "Dallas Cowboys Win",
    "cincinnati-bengals": "Cincinnati Bengals Win",
    "kansas-city-chiefs": "Kansas City Chiefs Win",
    "new-orleans-saints": "New Orleans Saints Win",
    "atlanta-falcons": "Atlanta Falcons Win",
    "detroit-lions": "Detroit Lions Win",
    "chicago-bears": "Chicago Bears Win",
    "tampa-bay-buccaneers": "Tampa Bay Buccaneers Win",
    "baltimore-ravens": "Baltimore Ravens Win",
    "houston-texans": "Houston Texans Win",
    "jacksonville-jaguars": "Jacksonville Jaguars Win",
    "seattle-seahawks": "Seattle Seahawks Win",
    "carolina-panthers": "Carolina Panthers Win"
  };
  return labels[team] || null;
}

const rows = [];

for (const item of audit.rows.filter(x => x.topAgreesWithGrades === false)) {
  const trade = trades.find(t => t.slug === item.slug);
  if (!trade || !Array.isArray(trade.perspectives)) continue;

  const correctVerdict = labelForTeam(item.gradeWinner);
  if (!correctVerdict) continue;

  for (const p of item.disagreeingPerspectives || []) {
    const perspective = trade.perspectives[p.index];
    if (!perspective) continue;

    rows.push({
      slug: item.slug,
      tradeId: trade.id,
      perspectiveIndex: p.index,
      sourceTeam: p.sourceTeam,
      from: perspective.verdict,
      to: correctVerdict,
      gradeWinner: item.gradeWinner,
      gap: item.gap
    });
  }
}

fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  tradesAffected: new Set(rows.map(r => r.slug)).size,
  perspectivesChangedIfApplied: rows.length,
  rows
}, null, 2));

console.log("Wrote", OUT);
console.log("tradesAffected:", new Set(rows.map(r => r.slug)).size);
console.log("perspectivesChangedIfApplied:", rows.length);
console.table(rows.slice(0,50));
