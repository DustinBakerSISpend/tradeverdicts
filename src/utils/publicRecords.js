const NON_PUBLIC_TRADE_STATUSES = new Set([
  "suppressed",
  "hidden",
  "hold-conflict",
]);

const PSEUDO_PLAYER_NAME_RE =
  /^(?:undisclosed|undisclosed consideration|undisclosed compensation|undisclosed terms|undisclosed historical consideration|unspecified consideration|no consideration recorded|not conveyed|not clearly specified in source|player to be named later|player\(s\) to be named later|undisclosed terms \(undisclosed|player to be named later \(undisclosed|player\(s\) to be named later \(undisclosed|player to be named later \(jack zilly on 03-17)$/i;

const BAD_PLAYER_NAME_RE =
  /^(?:undisclosed|unknown|not clearly specified|not conveyed|no consideration|player(?:\(s\))? to be named later)/i;

const BAD_PLAYER_SLUG_RE =
  /^(?:undisclosed|undisclosed-consideration|undisclosed-compensation|undisclosed-terms|undisclosed-historical-consideration|unspecified-consideration|no-consideration-recorded|not-conveyed|not-clearly-specified-in-source|player-to-be-named-later|player-s-to-be-named-later)/i;

export function isPublicTrade(trade) {
  if (!trade) return false;
  if (trade.suppressed === true) return false;
  if (trade.hidden === true) return false;
  if (trade.holdConflict === true) return false;

  const status = String(trade.publishStatus || "")
    .trim()
    .toLowerCase();

  return !NON_PUBLIC_TRADE_STATUSES.has(status);
}

export function getPublicTrades(trades = []) {
  return trades.filter(isPublicTrade);
}

export function isPublicPlayerRecord(player) {
  const name = String(player?.name || "").trim();
  const slug = String(player?.slug || "").trim();

  if (!name || !slug) return false;
  if (PSEUDO_PLAYER_NAME_RE.test(name)) return false;
  if (BAD_PLAYER_NAME_RE.test(name)) return false;
  if (BAD_PLAYER_SLUG_RE.test(slug)) return false;
  if (/^\d+$/.test(name)) return false;
  if (/^a\s+condi/i.test(name)) return false;

  return true;
}

export function playerHasPublicTrade(player, publicTrades = []) {
  const directSlugs = Array.isArray(player?.tradeSlugs)
    ? player.tradeSlugs
    : [];

  const publicTradeSlugs = new Set(
    publicTrades
      .map((trade) => trade.slug)
      .filter(Boolean)
  );

  if (directSlugs.some((slug) => publicTradeSlugs.has(slug))) {
    return true;
  }

  const playerName = String(player?.name || "")
    .trim()
    .toLowerCase();

  if (!playerName) return false;

  return publicTrades.some((trade) =>
    JSON.stringify(trade.assetsReceived || {})
      .toLowerCase()
      .includes(playerName)
  );
}

export function getPublicPlayerRecords(
  players = [],
  publicTrades = []
) {
  return players
    .filter(isPublicPlayerRecord)
    .filter((player) =>
      playerHasPublicTrade(player, publicTrades)
    );
}

export function getRelatedPublicTrades(
  player,
  publicTrades = []
) {
  const directSlugs = new Set(
    Array.isArray(player?.tradeSlugs)
      ? player.tradeSlugs
      : []
  );

  const playerName = String(player?.name || "")
    .trim()
    .toLowerCase();

  return publicTrades.filter((trade) => {
    if (directSlugs.has(trade.slug)) {
      return true;
    }

    if (!playerName) return false;

    return JSON.stringify(trade.assetsReceived || {})
      .toLowerCase()
      .includes(playerName);
  });
}
