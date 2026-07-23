import { normalizePrivateQuery } from "./build-private-query-index.mjs";

function privateTradeSummary(trade) {
  return {
    id: trade.id,
    sourceTradeId: trade.sourceTradeId,
    slug: trade.slug,
    tradeDate: trade.tradeDate,
    teams: trade.teams,
    summary: trade.summary,
    verdict: trade.verdict,
    perspectiveTeams: Object.keys(trade.perspectives ?? {}).sort(),
    publishStatus: trade.publishStatus,
    indexEligible: trade.indexEligible,
    adEligible: trade.adEligible,
    publicationReady: trade.publicationReady,
  };
}

function privatePlayerSummary(player) {
  return {
    id: player.id,
    name: player.name,
    slug: player.slug,
    aliases: player.aliases,
    referenceCount: player.referenceCount,
    sourceTradeCount: player.sourceTradeCount,
    publishStatus: player.publishStatus,
    indexEligible: player.indexEligible,
    adEligible: player.adEligible,
    publicationReady: player.publicationReady,
  };
}

function resolveTeam(index, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { status: "not_found", query: raw, teamSlug: null };

  const normalized = normalizePrivateQuery(raw);
  const represented = index.representedTeams;

  const candidates = represented.filter((teamSlug) => {
    const team = index.teamRegistry?.[teamSlug];
    return [
      teamSlug,
      team?.name,
      team?.abbreviation,
    ].some((identity) => normalizePrivateQuery(identity) === normalized);
  });

  if (candidates.length === 1) {
    return { status: "unique", query: raw, teamSlug: candidates[0] };
  }
  if (candidates.length > 1) {
    return { status: "ambiguous", query: raw, teamSlugs: candidates };
  }
  return { status: "not_found", query: raw, teamSlug: null };
}

function resolvePlayerIdentity(index, value) {
  const raw = String(value ?? "").trim();
  const key = normalizePrivateQuery(raw);
  if (!key) return { status: "not_found", query: raw, playerIds: [] };

  const playerIds = index.indexes.playerIdsByIdentity[key] ?? [];
  if (playerIds.length === 1) {
    const player = index.records.players[playerIds[0]];
    return {
      status: "unique",
      query: raw,
      normalizedQuery: key,
      player: privatePlayerSummary(player),
    };
  }
  if (playerIds.length > 1) {
    return {
      status: "ambiguous",
      query: raw,
      normalizedQuery: key,
      players: playerIds.map((id) => privatePlayerSummary(index.records.players[id])),
    };
  }
  return {
    status: "not_found",
    query: raw,
    normalizedQuery: key,
    playerIds: [],
  };
}

function searchPlayers(index, value) {
  const raw = String(value ?? "").trim();
  const key = normalizePrivateQuery(raw);
  if (!key) return { status: "not_found", query: raw, players: [] };

  const matches = Object.values(index.records.players)
    .filter((player) =>
      [player.name, ...(player.aliases ?? [])].some((identity) =>
        normalizePrivateQuery(identity).includes(key),
      ),
    )
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .map(privatePlayerSummary);

  if (matches.length === 0) return { status: "not_found", query: raw, players: [] };
  if (matches.length === 1) return { status: "unique", query: raw, player: matches[0] };
  return { status: "ambiguous", query: raw, players: matches };
}

function getTradesByIds(index, tradeIds) {
  return [...new Set(tradeIds)]
    .map((id) => index.records.trades[id])
    .filter(Boolean)
    .sort((left, right) =>
      left.tradeDate.localeCompare(right.tradeDate) ||
      left.sourceTradeId.localeCompare(right.sourceTradeId),
    )
    .map(privateTradeSummary);
}

export function createPrivateNbaQueryService(index, teams) {
  const teamRegistry = Object.fromEntries(
    teams.map((team) => [team.slug, {
      slug: team.slug,
      name: team.name,
      abbreviation: team.abbreviation,
    }]),
  );
  const hydratedIndex = { ...index, teamRegistry };

  return Object.freeze({
    getTradeBySourceTradeId(sourceTradeId) {
      const tradeId = index.indexes.tradeIdBySourceTradeId[String(sourceTradeId ?? "").trim()];
      if (!tradeId) return { status: "not_found", query: sourceTradeId, trade: null };
      return {
        status: "unique",
        query: sourceTradeId,
        trade: privateTradeSummary(index.records.trades[tradeId]),
      };
    },

    getTradeBySlug(slug) {
      const tradeId = index.indexes.tradeIdBySlug[String(slug ?? "").trim()];
      if (!tradeId) return { status: "not_found", query: slug, trade: null };
      return {
        status: "unique",
        query: slug,
        trade: privateTradeSummary(index.records.trades[tradeId]),
      };
    },

    getTradesByDate(tradeDate) {
      const key = String(tradeDate ?? "").trim();
      const trades = getTradesByIds(index, index.indexes.tradeIdsByDate[key] ?? []);
      return {
        status: trades.length ? "found" : "not_found",
        query: key,
        count: trades.length,
        trades,
      };
    },

    getTradesByTeam(teamIdentity) {
      const resolution = resolveTeam(hydratedIndex, teamIdentity);
      if (resolution.status !== "unique") {
        return { ...resolution, count: 0, trades: [] };
      }
      const trades = getTradesByIds(
        index,
        index.indexes.tradeIdsByTeam[resolution.teamSlug] ?? [],
      );
      return {
        ...resolution,
        count: trades.length,
        trades,
      };
    },

    resolvePlayerIdentity(playerIdentity) {
      return resolvePlayerIdentity(index, playerIdentity);
    },

    searchPlayers(query) {
      return searchPlayers(index, query);
    },

    getTradesByPlayerIdentity(playerIdentity) {
      const resolution = resolvePlayerIdentity(index, playerIdentity);
      if (resolution.status !== "unique") {
        return { ...resolution, count: 0, trades: [] };
      }
      const trades = getTradesByIds(
        index,
        index.indexes.tradeIdsByPlayer[resolution.player.id] ?? [],
      );
      return {
        ...resolution,
        count: trades.length,
        trades,
      };
    },

    getPlayersByTradeSourceId(sourceTradeId) {
      const tradeId = index.indexes.tradeIdBySourceTradeId[String(sourceTradeId ?? "").trim()];
      if (!tradeId) {
        return { status: "not_found", query: sourceTradeId, count: 0, players: [] };
      }
      const players = (index.indexes.playerIdsByTrade[tradeId] ?? [])
        .map((playerId) => index.records.players[playerId])
        .filter(Boolean)
        .sort((left, right) => left.name.localeCompare(right.name, "en"))
        .map(privatePlayerSummary);
      return {
        status: "found",
        query: sourceTradeId,
        count: players.length,
        players,
      };
    },
  });
}
