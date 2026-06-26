const fs = require("fs");

const AUDIT = "src/data/nfl/verdict-grade-consistency-audit.json";
const OUT = "src/data/nfl/two-team-verdict-regeneration-dry-run.json";

const audit = JSON.parse(fs.readFileSync(AUDIT, "utf8"));

const labelMap = {
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

const rows = [];

for (const r of audit.buckets.winnerGradeLowerThanLoser) {
  const teamCount = Object.keys(r.grades || {}).length;
  if (teamCount !== 2) continue;

  const to = labelMap[r.bestOtherTeam];
  if (!to) continue;

  rows.push({
    id: r.id,
    slug: r.slug,
    from: r.verdict,
    to,
    currentWinner: r.winner,
    currentWinnerGrade: r.winnerGrade,
    newWinner: r.bestOtherTeam,
    newWinnerGrade: r.bestOtherGrade,
    grades: r.grades,
    reason: "two-team trade: top-level verdict winner has lower grade than opponent"
  });
}

fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  changedIfApplied: rows.length,
  skippedMultiTeam: audit.buckets.winnerGradeLowerThanLoser.length - rows.length,
  rows
}, null, 2));

console.log("Wrote", OUT);
console.log("changedIfApplied:", rows.length);
console.log("skippedMultiTeam:", audit.buckets.winnerGradeLowerThanLoser.length - rows.length);
console.table(rows.slice(0,40).map(r => ({
  slug: r.slug,
  from: r.from,
  to: r.to,
  oldGrade: r.currentWinnerGrade,
  newGrade: r.newWinnerGrade
})));
