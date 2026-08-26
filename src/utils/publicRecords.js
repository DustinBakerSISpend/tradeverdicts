import {
  createEligibilityContext,
  getAdEligibleTrades,
  getIndexEligibleTrades,
  getTradeEligibility,
  isAdEligibleTrade,
  isCurrentlyPublicTrade,
  isIndexEligibleTrade,
} from "./eligibility.js";

const PSEUDO_PLAYER_NAME_RE =
  /^(?:undisclosed|undisclosed consideration|undisclosed compensation|undisclosed terms|undisclosed historical consideration|unspecified consideration|no consideration recorded|not conveyed|not clearly specified in source|player to be named later|player\(s\) to be named later|undisclosed terms \(undisclosed|player to be named later \(undisclosed|player\(s\) to be named later \(undisclosed|player to be named later \(jack zilly on 03-17)$/i;

const BAD_PLAYER_NAME_RE =
  /^(?:undisclosed|unknown|not clearly specified|not conveyed|no consideration|player(?:\(s\))? to be named later)/i;

const BAD_PLAYER_SLUG_RE =
  /^(?:undisclosed|undisclosed-consideration|undisclosed-compensation|undisclosed-terms|undisclosed-historical-consideration|unspecified-consideration|no-consideration-recorded|not-conveyed|not-clearly-specified-in-source|player-to-be-named-later|player-s-to-be-named-later)/i;

export {
  createEligibilityContext,
  getAdEligibleTrades,
  getIndexEligibleTrades,
  getTradeEligibility,
  isAdEligibleTrade,
  isIndexEligibleTrade,
};

export function isPublicTrade(trade) {
  return isCurrentlyPublicTrade(trade);
}

export function getPublicTrades(trades = []) {
  return trades.filter(isPublicTrade);
}

export function isPublicPlayerRecord(player) {
  if (!player) return false;
  if (player.suppressed === true) return false;
  if (player.hidden === true) return false;

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

export function getExplicitPlayerTradeSlugs(player) {
  return [
    ...new Set(
      (Array.isArray(player?.tradeSlugs)
        ? player.tradeSlugs
        : []
      )
        .map((slug) => String(slug || "").trim())
        .filter(Boolean)
    ),
  ];
}

function normalizeSearchablePlayerAssetText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[â€™']/gu, "")
    .replace(/[^a-z0-9]+/giu, " ")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .trim();
}

function tradeHasExactSearchablePlayerName(trade, playerName) {
  const normalizedName =
    normalizeSearchablePlayerAssetText(playerName);

  if (!normalizedName) return false;

  const needle = ` ${normalizedName} `;

  return Object.values(trade?.assetsReceived || {})
    .flatMap((items) => (Array.isArray(items) ? items : []))
    .some((item) => {
      const normalizedAsset =
        normalizeSearchablePlayerAssetText(item?.asset);

      return normalizedAsset &&
        ` ${normalizedAsset} `.includes(needle);
    });
}

export function getSearchableRelatedPublicTrades(
  player,
  publicTrades = []
) {
  const directSlugs = new Set(
    getExplicitPlayerTradeSlugs(player)
  );
  const playerName = String(player?.name || "").trim();

  return publicTrades.filter(
    (trade) =>
      directSlugs.has(trade.slug) ||
      tradeHasExactSearchablePlayerName(
        trade,
        playerName
      )
  );
}

export function playerHasSearchablePublicTrade(
  player,
  publicTrades = []
) {
  return (
    isPublicPlayerRecord(player) &&
    getSearchableRelatedPublicTrades(
      player,
      publicTrades
    ).length > 0
  );
}

export function getSearchablePlayerRecords(
  players = [],
  publicTrades = []
) {
  return players
    .filter(isPublicPlayerRecord)
    .filter((player) =>
      playerHasSearchablePublicTrade(
        player,
        publicTrades
      )
    );
}

export function playerHasPublicTrade(player, publicTrades = []) {
  const publicTradeSlugs = new Set(
    publicTrades
      .map((trade) => trade.slug)
      .filter(Boolean)
  );

  return getExplicitPlayerTradeSlugs(player).some(
    (slug) => publicTradeSlugs.has(slug)
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
    getExplicitPlayerTradeSlugs(player)
  );

  return publicTrades.filter((trade) =>
    directSlugs.has(trade.slug)
  );
}
