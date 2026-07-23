import { createHash } from "node:crypto";
import { createNbaTeamRegistry } from "./team-registry.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function referenceKey(tradeId, assetId, referenceType) {
  return `${tradeId}|${assetId}|${referenceType}`;
}

function expectedTradeReferences(trades) {
  const references = [];

  for (const trade of trades) {
    for (const asset of trade.assetLedger ?? []) {
      if (asset.type === "player") {
        references.push({
          referenceKey: referenceKey(trade.id, asset.assetId, "direct_player"),
          referenceType: "direct_player",
          playerName: asset.playerName,
          canonicalTradeId: trade.id,
          sourceTradeId: trade.sourceTradeId,
          assetId: asset.assetId,
          assetType: asset.type,
        });
      }

      if (asset.type === "draft_rights") {
        references.push({
          referenceKey: referenceKey(trade.id, asset.assetId, "draft_rights"),
          referenceType: "draft_rights",
          playerName: asset.playerName,
          canonicalTradeId: trade.id,
          sourceTradeId: trade.sourceTradeId,
          assetId: asset.assetId,
          assetType: asset.type,
        });
      }

      if (asset.becamePlayerName) {
        references.push({
          referenceKey: referenceKey(trade.id, asset.assetId, "draft_outcome"),
          referenceType: "draft_outcome",
          playerName: asset.becamePlayerName,
          canonicalTradeId: trade.id,
          sourceTradeId: trade.sourceTradeId,
          assetId: asset.assetId,
          assetType: asset.type,
        });
      }
    }
  }

  return references;
}

export function buildPrivateRelationshipGraph({ trades, players, teams }) {
  if (!Array.isArray(trades) || !Array.isArray(players) || !Array.isArray(teams)) {
    throw new TypeError("Trades, players, and teams must be arrays.");
  }

  const registry = createNbaTeamRegistry(teams);
  const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
  const expectedReferences = expectedTradeReferences(trades);
  const expectedByKey = new Map(
    expectedReferences.map((reference) => [reference.referenceKey, reference]),
  );

  const actualByKey = new Map();
  const duplicateReferenceOwnership = [];
  const invalidPlayerReferences = [];
  const playerTradeEdges = [];

  for (const player of players) {
    for (const reference of player.sourceReferences ?? []) {
      const key = referenceKey(
        reference.canonicalTradeId,
        reference.assetId,
        reference.referenceType,
      );

      if (actualByKey.has(key)) {
        duplicateReferenceOwnership.push({
          referenceKey: key,
          firstPlayerId: actualByKey.get(key).playerId,
          secondPlayerId: player.id,
        });
        continue;
      }

      const trade = tradeById.get(reference.canonicalTradeId);
      const asset = trade?.assetLedger?.find(
        (entry) => entry.assetId === reference.assetId,
      );

      if (!trade || !asset) {
        invalidPlayerReferences.push({
          playerId: player.id,
          playerName: player.name,
          referenceKey: key,
          missingTrade: !trade,
          missingAsset: Boolean(trade && !asset),
        });
      }

      const edge = {
        edgeId: `player-trade-${sha256(`${player.id}|${key}`).slice(0, 14)}`,
        edgeType: "player_trade_reference",
        playerId: player.id,
        playerName: player.name,
        canonicalTradeId: reference.canonicalTradeId,
        sourceTradeId: reference.sourceTradeId,
        assetId: reference.assetId,
        referenceType: reference.referenceType,
        tradeDate: reference.tradeDate,
        displayText: reference.displayText,
      };
      actualByKey.set(key, { playerId: player.id, edge });
      playerTradeEdges.push(edge);
    }
  }

  const missingPlayerReferences = expectedReferences.filter(
    (reference) => !actualByKey.has(reference.referenceKey),
  );
  const extraPlayerReferences = [...actualByKey.entries()]
    .filter(([key]) => !expectedByKey.has(key))
    .map(([key, value]) => ({ referenceKey: key, playerId: value.playerId }));

  const invalidTradeTeams = [];
  const teamTradeEdges = [];
  const teamToTrades = Object.fromEntries(
    registry.teams.map((team) => [team.slug, []]),
  );

  for (const trade of trades) {
    for (const teamSlug of trade.teams ?? []) {
      if (!registry.hasSlug(teamSlug)) {
        invalidTradeTeams.push({
          canonicalTradeId: trade.id,
          sourceTradeId: trade.sourceTradeId,
          teamSlug,
        });
        continue;
      }

      const edge = {
        edgeId: `team-trade-${sha256(`${teamSlug}|${trade.id}`).slice(0, 14)}`,
        edgeType: "team_trade_membership",
        teamSlug,
        canonicalTradeId: trade.id,
        sourceTradeId: trade.sourceTradeId,
        tradeDate: trade.tradeDate,
      };
      teamTradeEdges.push(edge);
      teamToTrades[teamSlug].push(trade.id);
    }
  }

  for (const teamSlug of Object.keys(teamToTrades)) {
    teamToTrades[teamSlug] = uniqueSorted(teamToTrades[teamSlug]);
  }

  const playerToTrades = Object.fromEntries(
    players.map((player) => [
      player.id,
      uniqueSorted(
        playerTradeEdges
          .filter((edge) => edge.playerId === player.id)
          .map((edge) => edge.canonicalTradeId),
      ),
    ]),
  );

  const tradeToPlayers = Object.fromEntries(
    trades.map((trade) => [
      trade.id,
      uniqueSorted(
        playerTradeEdges
          .filter((edge) => edge.canonicalTradeId === trade.id)
          .map((edge) => edge.playerId),
      ),
    ]),
  );

  const referencedTradeCount = Object.values(tradeToPlayers).filter(
    (playerIds) => playerIds.length > 0,
  ).length;
  const referencedPlayerCount = Object.values(playerToTrades).filter(
    (tradeIds) => tradeIds.length > 0,
  ).length;

  const counts = {
    teamNodes: registry.teams.filter((team) => teamToTrades[team.slug].length > 0).length,
    tradeNodes: trades.length,
    playerNodes: players.length,
    totalNodes: (
      registry.teams.filter((team) => teamToTrades[team.slug].length > 0).length +
      trades.length +
      players.length
    ),
    teamTradeEdges: teamTradeEdges.length,
    playerTradeReferenceEdges: playerTradeEdges.length,
    totalEdges: teamTradeEdges.length + playerTradeEdges.length,
    directPlayerEdges: playerTradeEdges.filter(
      (edge) => edge.referenceType === "direct_player",
    ).length,
    draftRightsEdges: playerTradeEdges.filter(
      (edge) => edge.referenceType === "draft_rights",
    ).length,
    draftOutcomeEdges: playerTradeEdges.filter(
      (edge) => edge.referenceType === "draft_outcome",
    ).length,
    referencedTradeNodes: referencedTradeCount,
    referencedPlayerNodes: referencedPlayerCount,
    missingPlayerReferences: missingPlayerReferences.length,
    extraPlayerReferences: extraPlayerReferences.length,
    invalidPlayerReferences: invalidPlayerReferences.length,
    duplicateReferenceOwnership: duplicateReferenceOwnership.length,
    invalidTradeTeams: invalidTradeTeams.length,
    orphanPlayerRecords: players.length - referencedPlayerCount,
    orphanTradeRecords: trades.length - referencedTradeCount,
  };

  return {
    counts,
    nodes: {
      teams: registry.teams
        .filter((team) => teamToTrades[team.slug].length > 0)
        .map((team) => ({
          teamSlug: team.slug,
          abbreviation: team.abbreviation,
          name: team.name ?? null,
          tradeCount: teamToTrades[team.slug].length,
        })),
      trades: trades.map((trade) => ({
        canonicalTradeId: trade.id,
        sourceTradeId: trade.sourceTradeId,
        tradeDate: trade.tradeDate,
        teams: trade.teams,
        playerReferenceCount: playerTradeEdges.filter(
          (edge) => edge.canonicalTradeId === trade.id,
        ).length,
      })),
      players: players.map((player) => ({
        playerId: player.id,
        name: player.name,
        slug: player.slug,
        referenceCount: player.referenceCount,
        linkedTradeCount: playerToTrades[player.id].length,
      })),
    },
    edges: {
      teamTrade: teamTradeEdges,
      playerTradeReference: playerTradeEdges,
    },
    indexes: {
      teamToTrades,
      tradeToPlayers,
      playerToTrades,
    },
    issues: {
      missingPlayerReferences,
      extraPlayerReferences,
      invalidPlayerReferences,
      duplicateReferenceOwnership,
      invalidTradeTeams,
    },
  };
}
