const fs = require("fs");

const TRADES = "src/data/nfl/trades.json";
const AUDIT = "src/data/nfl/verdict-grade-consistency-audit.json";
const OUT = "src/data/nfl/verdict-grade-fix-dry-run-safe-labels.json";

const trades = JSON.parse(fs.readFileSync(TRADES, "utf8"));
const audit = JSON.parse(fs.readFileSync(AUDIT, "utf8"));

function verdictKey(v) {
  const s = String(v || "").toLowerCase();
  if (s.includes("even")) return "even";
  if (s.includes("cardinals")) return "arizona-cardinals";
  if (s.includes("rams")) return "los-angeles-rams";
  if (s.includes("oilers") || s.includes("titans")) return "tennessee-titans";
  if (s.includes("chargers")) return "los-angeles-chargers";
  if (s.includes("commanders") || s.includes("redskins")) return "washington-commanders";
  if (s.includes("colts")) return "indianapolis-colts";
  if (s.includes("raiders")) return "las-vegas-raiders";
  if (s.includes("49ers")) return "san-francisco-49ers";
  if (s.includes("giants")) return "new-york-giants";
  if (s.includes("jets")) return "new-york-jets";
  if (s.includes("browns")) return "cleveland-browns";
  if (s.includes("steelers")) return "pittsburgh-steelers";
  if (s.includes("packers")) return "green-bay-packers";
  if (s.includes("eagles")) return "philadelphia-eagles";
  if (s.includes("vikings")) return "minnesota-vikings";
  if (s.includes("broncos")) return "denver-broncos";
  if (s.includes("bills")) return "buffalo-bills";
  if (s.includes("dolphins")) return "miami-dolphins";
  if (s.includes("cowboys")) return "dallas-cowboys";
  if (s.includes("bengals")) return "cincinnati-bengals";
  if (s.includes("chiefs")) return "kansas-city-chiefs";
  if (s.includes("saints")) return "new-orleans-saints";
  if (s.includes("falcons")) return "atlanta-falcons";
  if (s.includes("lions")) return "detroit-lions";
  if (s.includes("bears")) return "chicago-bears";
  if (s.includes("buccaneers")) return "tampa-bay-buccaneers";
  if (s.includes("ravens")) return "baltimore-ravens";
  if (s.includes("texans")) return "houston-texans";
  if (s.includes("jaguars")) return "jacksonville-jaguars";
  if (s.includes("seahawks")) return "seattle-seahawks";
  if (s.includes("panthers")) return "carolina-panthers";
  return null;
}

function fallbackLabel(team) {
  const map = {
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
  return map[team] || null;
}

function bestExistingVerdictLabel(trade, team) {
  const labels = new Map();

  for (const p of trade.perspectives || []) {
    const v = p.verdict;
    if (!v || !String(v).includes("Win")) continue;
    if (verdictKey(v) === team) {
      labels.set(v, (labels.get(v) || 0) + 1);
    }
  }

  if (labels.size) {
    return [...labels.entries()].sort((a,b)=>b[1]-a[1])[0][0];
  }

  return fallbackLabel(team);
}

const rows = [];

for (const r of audit.buckets.winnerGradeLowerThanLoser) {
  const trade = trades.find(t => t.slug === r.slug);
  if (!trade) continue;

  const to = bestExistingVerdictLabel(trade, r.bestOtherTeam);

  rows.push({
    action: "changeTopLevelVerdict",
    slug: r.slug,
    from: r.verdict,
    to,
    currentWinner: r.winner,
    currentWinnerGrade: r.winnerGrade,
    bestGradeTeam: r.bestOtherTeam,
    bestGrade: r.bestOtherGrade,
    grades: r.grades,
    safe: !!to,
    reason: "verdict winner has lower grade than another team"
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  changedIfApplied: rows.filter(r=>r.safe).length,
  skippedNoSafeLabel: rows.filter(r=>!r.safe).length,
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log("Wrote", OUT);
console.log("changedIfApplied:", report.changedIfApplied);
console.log("skippedNoSafeLabel:", report.skippedNoSafeLabel);
console.table(rows.slice(0,30).map(r => ({
  slug: r.slug,
  from: r.from,
  to: r.to,
  winnerGrade: r.currentWinnerGrade,
  bestGrade: r.bestGrade,
  safe: r.safe
})));
