import trades from "../../data/nba/trades.json";
import players from "../../data/nba/players.json";
import teams from "../../data/nba/teams.json";
import {
  createNbaPlayerDirectoryRows,
} from "../../lib/nba/player-directory.mjs";

export const prerender = true;

export function GET() {
  const rows = createNbaPlayerDirectoryRows({
    players,
    trades,
    teams,
  }).map((player) => ({
    name: player.name,
    slug: player.slug,
    lastInitial: player.lastInitial,
    tradeCount: player.tradeCount,
  }));

  return new Response(`${JSON.stringify(rows)}\n`, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
