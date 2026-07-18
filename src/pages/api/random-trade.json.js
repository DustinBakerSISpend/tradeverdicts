import trades from "../../data/nfl/trades.json";
import { getPublicTrades } from "../../utils/publicRecords.js";

const randomTradePool = getPublicTrades(trades)
  .map((trade) => ({
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    verdict: trade.verdict,
    teams: trade.teams || [],
  }))
  .filter((trade) => typeof trade.slug === "string" && trade.slug.length > 0);

export function GET() {
  return new Response(JSON.stringify(randomTradePool), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}