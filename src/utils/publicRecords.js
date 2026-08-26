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

const PUBLIC_TRADES_CACHE = new WeakMap();

export function getPublicTrades(trades = []) {
  if (!Array.isArray(trades)) return [];

  const cached = PUBLIC_TRADES_CACHE.get(trades);

  if (cached) return cached;

  const publicTrades = trades.filter(isPublicTrade);
  PUBLIC_TRADES_CACHE.set(trades, publicTrades);

  return publicTrades;
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

const SEARCHABLE_TRADE_STATE_CACHE = new WeakMap();
const SEARCHABLE_PLAYER_INDEX_CACHE = new WeakMap();

function getSearchableTradeState(publicTrades = []) {
  let state = SEARCHABLE_TRADE_STATE_CACHE.get(publicTrades);

  if (state) return state;

  const tradeBySlug = new Map();
  const normalizedAssetsByTrade = new Map();

  for (const trade of publicTrades) {
    const slug = String(trade?.slug || "").trim();

    if (slug) {
      tradeBySlug.set(slug, trade);
    }

    const normalizedAssets = Object.values(
      trade?.assetsReceived || {}
    )
      .flatMap((items) =>
        Array.isArray(items) ? items : []
      )
      .map((item) =>
        normalizeSearchablePlayerAssetText(
          item?.asset
        )
      )
      .filter(Boolean);

    normalizedAssetsByTrade.set(
      trade,
      normalizedAssets
    );
  }

  state = {
    tradeBySlug,
    normalizedAssetsByTrade,
    relatedByPlayerSlug: new Map(),
    individualByKey: new Map(),
  };

  SEARCHABLE_TRADE_STATE_CACHE.set(
    publicTrades,
    state
  );

  return state;
}

function buildSearchablePlayerRelationshipIndex(
  players = [],
  publicTrades = []
) {
  let byTrades =
    SEARCHABLE_PLAYER_INDEX_CACHE.get(
      players
    );

  if (!byTrades) {
    byTrades = new WeakMap();
    SEARCHABLE_PLAYER_INDEX_CACHE.set(
      players,
      byTrades
    );
  }

  const cached = byTrades.get(publicTrades);

  if (cached) return cached;

  const state =
    getSearchableTradeState(publicTrades);

  const publicPlayers =
    players.filter(isPublicPlayerRecord);

  const playersByNormalizedName =
    new Map();

  const directPlayerSlugsByTradeSlug =
    new Map();

  const relatedByPlayerSlug =
    new Map();

  const seenByPlayerSlug =
    new Map();

  const playerNameWordLengths =
    new Set();

  for (const player of publicPlayers) {
    const slug =
      String(player?.slug || "").trim();

    const normalizedName =
      normalizeSearchablePlayerAssetText(
        player?.name
      );

    relatedByPlayerSlug.set(
      slug,
      []
    );

    seenByPlayerSlug.set(
      slug,
      new Set()
    );

    if (normalizedName) {
      const bucket =
        playersByNormalizedName.get(
          normalizedName
        ) || [];

      bucket.push(slug);

      playersByNormalizedName.set(
        normalizedName,
        bucket
      );

      playerNameWordLengths.add(
        normalizedName.split(" ").length
      );
    }

    for (
      const tradeSlug of
      getExplicitPlayerTradeSlugs(player)
    ) {
      const bucket =
        directPlayerSlugsByTradeSlug.get(
          tradeSlug
        ) || [];

      bucket.push(slug);

      directPlayerSlugsByTradeSlug.set(
        tradeSlug,
        bucket
      );
    }
  }

  const sortedWordLengths = [
    ...playerNameWordLengths,
  ].sort((a, b) => a - b);

  for (const trade of publicTrades) {
    const matchedPlayerSlugs =
      new Set(
        directPlayerSlugsByTradeSlug.get(
          trade.slug
        ) || []
      );

    const normalizedAssets =
      state.normalizedAssetsByTrade.get(
        trade
      ) || [];

    for (
      const normalizedAsset of
      normalizedAssets
    ) {
      const words =
        normalizedAsset.split(" ");

      for (
        const length of
        sortedWordLengths
      ) {
        if (length > words.length) {
          break;
        }

        for (
          let index = 0;
          index <= words.length - length;
          index += 1
        ) {
          const phrase =
            words
              .slice(
                index,
                index + length
              )
              .join(" ");

          const candidateSlugs =
            playersByNormalizedName.get(
              phrase
            );

          if (!candidateSlugs) {
            continue;
          }

          for (
            const candidateSlug of
            candidateSlugs
          ) {
            matchedPlayerSlugs.add(
              candidateSlug
            );
          }
        }
      }
    }

    for (
      const playerSlug of
      matchedPlayerSlugs
    ) {
      const seen =
        seenByPlayerSlug.get(
          playerSlug
        );

      const rows =
        relatedByPlayerSlug.get(
          playerSlug
        );

      if (
        !seen ||
        !rows ||
        seen.has(trade.slug)
      ) {
        continue;
      }

      seen.add(trade.slug);
      rows.push(trade);
    }
  }

  for (
    const [
      playerSlug,
      relatedTrades,
    ] of relatedByPlayerSlug
  ) {
    state.relatedByPlayerSlug.set(
      playerSlug,
      relatedTrades
    );
  }

  const records =
    publicPlayers.filter(
      (player) =>
        (
          relatedByPlayerSlug.get(
            player.slug
          ) || []
        ).length > 0
    );

  const result = {
    records,
    relatedByPlayerSlug,
  };

  byTrades.set(
    publicTrades,
    result
  );

  return result;
}

export function getSearchableRelatedPublicTrades(
  player,
  publicTrades = []
) {
  const state =
    getSearchableTradeState(publicTrades);

  const playerSlug =
    String(player?.slug || "").trim();

  if (
    playerSlug &&
    state.relatedByPlayerSlug.has(
      playerSlug
    )
  ) {
    return state.relatedByPlayerSlug.get(
      playerSlug
    );
  }

  const directSlugs =
    new Set(
      getExplicitPlayerTradeSlugs(
        player
      )
    );

  const normalizedName =
    normalizeSearchablePlayerAssetText(
      player?.name
    );

  const cacheKey = [
    playerSlug,
    normalizedName,
    [...directSlugs].sort().join(","),
  ].join("\u0000");

  if (
    state.individualByKey.has(
      cacheKey
    )
  ) {
    return state.individualByKey.get(
      cacheKey
    );
  }

  const needle =
    normalizedName
      ? ` ${normalizedName} `
      : "";

  const relatedTrades =
    publicTrades.filter((trade) => {
      if (
        directSlugs.has(
          trade.slug
        )
      ) {
        return true;
      }

      if (!needle) {
        return false;
      }

      return (
        state.normalizedAssetsByTrade.get(
          trade
        ) || []
      ).some(
        (normalizedAsset) =>
          ` ${normalizedAsset} `.includes(
            needle
          )
      );
    });

  state.individualByKey.set(
    cacheKey,
    relatedTrades
  );

  if (playerSlug) {
    state.relatedByPlayerSlug.set(
      playerSlug,
      relatedTrades
    );
  }

  return relatedTrades;
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
  if (!Array.isArray(players)) {
    return [];
  }

  return buildSearchablePlayerRelationshipIndex(
    players,
    publicTrades
  ).records;
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
