import trades from "../../data/nfl/trades.json";
import { getPublicTrades } from "../../utils/publicRecords.js";

const NFL_TEAM_SLUGS = [
  "arizona-cardinals",
  "atlanta-falcons",
  "baltimore-ravens",
  "buffalo-bills",
  "carolina-panthers",
  "chicago-bears",
  "cincinnati-bengals",
  "cleveland-browns",
  "dallas-cowboys",
  "denver-broncos",
  "detroit-lions",
  "green-bay-packers",
  "houston-texans",
  "indianapolis-colts",
  "jacksonville-jaguars",
  "kansas-city-chiefs",
  "las-vegas-raiders",
  "los-angeles-chargers",
  "los-angeles-rams",
  "miami-dolphins",
  "minnesota-vikings",
  "new-england-patriots",
  "new-orleans-saints",
  "new-york-giants",
  "new-york-jets",
  "philadelphia-eagles",
  "pittsburgh-steelers",
  "san-francisco-49ers",
  "seattle-seahawks",
  "tampa-bay-buccaneers",
  "tennessee-titans",
  "washington-commanders",
];

const CURRENT_TEAM_SET = new Set(NFL_TEAM_SLUGS);

const getPairKey = (teamA, teamB) =>
  [teamA, teamB].sort().join("__");

const pairTradeIndex = {};

for (const trade of getPublicTrades(trades)) {
  const currentTeams = [
    ...new Set(
      (trade.teams || []).filter((team) => CURRENT_TEAM_SET.has(team))
    ),
  ];

  if (currentTeams.length < 2) continue;

  const record = {
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    verdict: trade.verdict,
    summary: trade.summary,
    tier: trade.tier,
    teams: trade.teams || [],
    grades: trade.grades || {},
    assetsReceived: trade.assetsReceived || {},
  };

  for (let first = 0; first < currentTeams.length - 1; first += 1) {
    for (let second = first + 1; second < currentTeams.length; second += 1) {
      const key = getPairKey(currentTeams[first], currentTeams[second]);

      if (!pairTradeIndex[key]) {
        pairTradeIndex[key] = [];
      }

      pairTradeIndex[key].push(record);
    }
  }
}

for (const records of Object.values(pairTradeIndex)) {
  records.sort(
    (a, b) => new Date(b.tradeDate) - new Date(a.tradeDate)
  );
}

export function GET() {
  return new Response(JSON.stringify(pairTradeIndex), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}