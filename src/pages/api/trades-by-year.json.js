import trades from "../../data/nfl/trades.json";
import { getIndexEligibleTrades } from "../../utils/publicRecords.js";

const yearIndex = {};

for (const trade of getIndexEligibleTrades(trades)) {
  const year = String(trade.tradeDate || "").slice(0, 4);

  if (!/^\d{4}$/.test(year)) continue;

  if (!yearIndex[year]) {
    yearIndex[year] = [];
  }

  yearIndex[year].push({
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    teams: trade.teams || [],
    verdict: trade.verdict,
    summary: trade.summary,
    tier: trade.tier,
    confidence: trade.confidence,
    grades: trade.grades || {},
    assetsReceived: trade.assetsReceived || {},
  });
}

for (const records of Object.values(yearIndex)) {
  records.sort(
    (a, b) => new Date(b.tradeDate) - new Date(a.tradeDate)
  );
}

export function GET() {
  return new Response(JSON.stringify(yearIndex), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}