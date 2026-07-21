import players from "../../data/nfl/players.json";
import trades from "../../data/nfl/trades.json";
import {
  createPlayerDirectoryRows,
} from "../../utils/playerDirectory.js";

export const prerender = true;

export function GET() {
  const rows = createPlayerDirectoryRows(players, trades);

  return new Response(JSON.stringify(rows), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
