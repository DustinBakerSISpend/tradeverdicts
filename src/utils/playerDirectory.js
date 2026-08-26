import {
  getPublicPlayerRecords,
  getSearchablePlayerRecords,
  getSearchableRelatedPublicTrades,
  getPublicTrades,
  getRelatedPublicTrades,
} from "./publicRecords.js";
import {
  createPlayerEligibilityContext,
  getIndexEligiblePlayers,
} from "./playerEligibility.js";

export const PLAYER_DIRECTORY_PAGE_SIZE = 120;

export function getPlayerLastInitial(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const last = parts[parts.length - 1] || "";
  const initial = last
    .replace(/[^A-Za-z]/g, "")
    .charAt(0)
    .toUpperCase();

  return /^[A-Z]$/.test(initial) ? initial : "";
}

export function createPlayerSearchRows(players = [], trades = []) {
  const publicTrades = getPublicTrades(trades);

  return getSearchablePlayerRecords(players, publicTrades)
    .map((player) => ({
      name: String(player.name || "").trim(),
      slug: String(player.slug || "").trim(),
      lastInitial: getPlayerLastInitial(player.name),
      tradeCount: getSearchableRelatedPublicTrades(player, publicTrades).length,
    }))
    .filter(
      (player) =>
        player.name &&
        player.slug &&
        player.tradeCount > 0
    )
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.slug.localeCompare(b.slug)
    );
}

export function createPlayerDirectoryRows(players = [], trades = []) {
  const publicTrades = getPublicTrades(trades);
  const playerContext = createPlayerEligibilityContext(
    players,
    publicTrades
  );
  const indexEligiblePlayers = getIndexEligiblePlayers(
    players,
    publicTrades,
    playerContext
  );

  return getPublicPlayerRecords(indexEligiblePlayers, publicTrades)
    .map((player) => ({
      name: String(player.name || "").trim(),
      slug: String(player.slug || "").trim(),
      lastInitial: getPlayerLastInitial(player.name),
      tradeCount: getRelatedPublicTrades(player, publicTrades).length,
    }))
    .filter(
      (player) =>
        player.name &&
        player.slug &&
        player.lastInitial &&
        player.tradeCount > 0
    )
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.slug.localeCompare(b.slug)
    );
}

export function getPlayerDirectoryTotalPages(
  rows = [],
  pageSize = PLAYER_DIRECTORY_PAGE_SIZE
) {
  return Math.max(1, Math.ceil(rows.length / pageSize));
}

export function getPlayerDirectoryPage(
  rows = [],
  page = 1,
  pageSize = PLAYER_DIRECTORY_PAGE_SIZE
) {
  const safePage = Math.max(1, Number(page) || 1);
  const start = (safePage - 1) * pageSize;

  return rows.slice(start, start + pageSize);
}

export function getPlayerDirectoryPageHref(page) {
  const safePage = Math.max(1, Number(page) || 1);

  return safePage === 1
    ? "/players/"
    : `/players/page/${safePage}/`;
}
