import trades from "../../data/nfl/trades.json";
import { getPublicTrades } from "../../utils/publicRecords.js";
import {
  getCurrentFranchiseSlugsForTrade,
  normalizeTradeForCurrentFranchises,
} from "../../utils/teamRegistry.js";


const getPairKey = (teamA, teamB) =>
  [teamA, teamB].sort().join("__");

const pairTradeIndex = {};

for (const trade of getPublicTrades(trades)) {
  const currentTeams =
    getCurrentFranchiseSlugsForTrade(trade);

  if (currentTeams.length < 2) continue;

  const normalizedTrade =
    normalizeTradeForCurrentFranchises(trade);

  const record = {
    slug: normalizedTrade.slug,
    tradeDate: normalizedTrade.tradeDate,
    verdict: normalizedTrade.verdict,
    summary: normalizedTrade.summary,
    tier: normalizedTrade.tier,
    teams: normalizedTrade.teams,
    grades: normalizedTrade.grades,
    assetsReceived: normalizedTrade.assetsReceived,
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
