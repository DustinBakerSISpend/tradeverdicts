import trades from "../../data/nfl/trades.json";
import { getPublicTrades } from "../../utils/publicRecords.js";

const calendarIndex = {};

for (const trade of getPublicTrades(trades)) {
  const date = String(trade.tradeDate || "");
  const match = date.match(/^\d{4}-(\d{2})-(\d{2})$/);

  if (!match) continue;

  const calendarKey = `${match[1]}-${match[2]}`;

  if (!calendarIndex[calendarKey]) {
    calendarIndex[calendarKey] = [];
  }

  calendarIndex[calendarKey].push({
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    teams: trade.teams || [],
    verdict: trade.verdict,
    summary: trade.summary,
    tier: trade.tier,
    grades: trade.grades || {},
    assetsReceived: trade.assetsReceived || {},
  });
}

for (const records of Object.values(calendarIndex)) {
  records.sort(
    (a, b) => new Date(b.tradeDate) - new Date(a.tradeDate)
  );
}

export function GET() {
  return new Response(JSON.stringify(calendarIndex), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}