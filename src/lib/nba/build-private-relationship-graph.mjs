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

function normalizePlayerIdentity(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’'".]/gu, "")
    .replace(/&/gu, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function referenceKey(tradeId, assetId, referenceType) {
  return `${tradeId}|${assetId}|${referenceType}`;
}

function buildPlayerResolver(players) {
  const byId = new Map(players.map((player) => [player.id, player]));
  const bySlug = new Map(players.map((player) => [player.slug, player]));
  const byIdentity = new Map();

  for (const player of players) {
    for (const identity of [player.name, ...(player.aliases ?? [])]) {
      const key = normalizePlayerIdentity(identity);
      if (!key) continue;

      if (!byIdentity.has(key)) byIdentity.set(key, new Set());
      byIdentity.get(key).add(player.id);
    }
  }

  function resolve(reference) {
    const candidateIds = new Set();

    for (const playerId of reference.playerIdCandidates ?? []) {
      if (byId.has(playerId)) candidateIds.add(playerId);
    }

    for (const playerSlug of reference.playerSlugCandidates ?? []) {
      const player = bySlug.get(playerSlug);
      if (player) candidateIds.add(player.id);
    }

    for (const identity of reference.identityCandidates ?? []) {
      const key = normalizePlayerIdentity(identity);
      if (!key) continue;

      for (const playerId of byIdentity.get(key) ?? []) {
        candidateIds.add(playerId);
      }
    }

    const playerIds = [...candidateIds].sort((left, right) =>
      left.localeCompare(right, "en"),
    );

    if (playerIds.length === 1) {
      return {
        status: "UNAMBIGUOUS_PLAYER_MATCH",
        player: byId.get(playerIds[0]),
        candidatePlayerIds: playerIds,
      };
    }

    if (playerIds.length > 1) {
      return {
        status: "AMBIGUOUS_PLAYER_MATCH",
        player: null,
        candidatePlayerIds: playerIds,
      };
    }

    return {
      status: "NO_PLAYER_MATCH",
      player: null,
      candidatePlayerIds: [],
    };
  }

  return {
    byId,
    bySlug,
    byIdentity,
    resolve,
  };
}

function referenceIdentityCandidates(asset, referenceType) {
  if (referenceType === "draft_outcome") {
    return [
      asset.becamePlayerName,
      asset.becamePlayerDisplayText,
    ];
  }

  return [
    asset.playerName,
    asset.displayText,
    asset.auditSourceText,
  ];
}

function referencePlayerIdCandidates(asset, referenceType) {
  if (referenceType === "draft_outcome") {
    return [
      asset.becamePlayerId,
      ...(Array.isArray(asset.becamePlayerIds) ? asset.becamePlayerIds : []),
    ];
  }

  return [
    asset.playerId,
    ...(Array.isArray(asset.playerIds) ? asset.playerIds : []),
  ];
}

function referencePlayerSlugCandidates(asset, referenceType) {
  if (referenceType === "draft_outcome") {
    return [
      asset.becamePlayerSlug,
      ...(Array.isArray(asset.becamePlayerSlugs) ? asset.becamePlayerSlugs : []),
    ];
  }

  return [
    asset.playerSlug,
    ...(Array.isArray(asset.playerSlugs) ? asset.playerSlugs : []),
  ];
}

function expectedTradeReferences(trades) {
  const references = [];

  function addReference(trade, asset, referenceType, playerName) {
    references.push({
      referenceKey: referenceKey(trade.id, asset.assetId, referenceType),
      referenceType,
      playerName: playerName ?? null,
      canonicalTradeId: trade.id,
      sourceTradeId: trade.sourceTradeId,
      assetId: asset.assetId,
      assetType: asset.type,
      tradeDate: trade.tradeDate,
      displayText:
        playerName ??
        asset.displayText ??
        asset.auditSourceText ??
        asset.becamePlayerName ??
        "",
      identityCandidates: referenceIdentityCandidates(asset, referenceType)
        .filter(Boolean),
      playerIdCandidates: referencePlayerIdCandidates(asset, referenceType)
        .filter(Boolean),
      playerSlugCandidates: referencePlayerSlugCandidates(asset, referenceType)
        .filter(Boolean),
    });
  }

  for (const trade of trades) {
    for (const asset of trade.assetLedger ?? []) {
      if (asset.type === "player") {
        addReference(
          trade,
          asset,
          "direct_player",
          asset.playerName,
        );
      }

      if (asset.type === "draft_rights") {
        addReference(
          trade,
          asset,
          "draft_rights",
          asset.playerName,
        );
      }

      if (asset.becamePlayerName) {
        addReference(
          trade,
          asset,
          "draft_outcome",
          asset.becamePlayerName,
        );
      }
    }
  }

  return references;
}

function createPlayerTradeEdge({
  player,
  reference,
  referenceOrigin,
}) {
  return {
    edgeId: `player-trade-${sha256(
      `${player.id}|${reference.referenceKey}`,
    ).slice(0, 14)}`,
    edgeType: "player_trade_reference",
    playerId: player.id,
    playerName: player.name,
    canonicalTradeId: reference.canonicalTradeId,
    sourceTradeId: reference.sourceTradeId,
    assetId: reference.assetId,
    referenceType: reference.referenceType,
    tradeDate: reference.tradeDate,
    displayText: reference.displayText,
    referenceOrigin,
  };
}

export function buildPrivateRelationshipGraph({ trades, players, teams }) {
  if (!Array.isArray(trades) || !Array.isArray(players) || !Array.isArray(teams)) {
    throw new TypeError("Trades, players, and teams must be arrays.");
  }

  const registry = createNbaTeamRegistry(teams);
  const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
  const playerResolver = buildPlayerResolver(players);
  const expectedReferences = expectedTradeReferences(trades);
  const expectedByKey = new Map(
    expectedReferences.map((reference) => [reference.referenceKey, reference]),
  );

  const actualByKey = new Map();
  const duplicateReferenceOwnership = [];
  const invalidPlayerReferences = [];
  const correctedReferenceOwnership = [];
  const inferredPlayerReferences = [];
  const playerTradeEdges = [];

  for (const player of players) {
    for (const sourceReference of player.sourceReferences ?? []) {
      const key = referenceKey(
        sourceReference.canonicalTradeId,
        sourceReference.assetId,
        sourceReference.referenceType,
      );

      const expectedReference = expectedByKey.get(key);
      const expectedResolution = expectedReference
        ? playerResolver.resolve(expectedReference)
        : null;

      let owner = player;
      let referenceOrigin = "player_source_reference";

      if (
        expectedResolution?.status === "UNAMBIGUOUS_PLAYER_MATCH" &&
        expectedResolution.player.id !== player.id
      ) {
        correctedReferenceOwnership.push({
          referenceKey: key,
          fromPlayerId: player.id,
          fromPlayerName: player.name,
          toPlayerId: expectedResolution.player.id,
          toPlayerName: expectedResolution.player.name,
        });

        owner = expectedResolution.player;
        referenceOrigin = "canonical_asset_identity_corrected";
      }

      if (actualByKey.has(key)) {
        duplicateReferenceOwnership.push({
          referenceKey: key,
          firstPlayerId: actualByKey.get(key).playerId,
          secondPlayerId: owner.id,
        });
        continue;
      }

      const trade = tradeById.get(sourceReference.canonicalTradeId);
      const asset = trade?.assetLedger?.find(
        (entry) => entry.assetId === sourceReference.assetId,
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

      const reference = expectedReference ?? {
        referenceKey: key,
        referenceType: sourceReference.referenceType,
        playerName: owner.name,
        canonicalTradeId: sourceReference.canonicalTradeId,
        sourceTradeId: sourceReference.sourceTradeId,
        assetId: sourceReference.assetId,
        assetType: sourceReference.assetType,
        tradeDate: sourceReference.tradeDate,
        displayText: sourceReference.displayText,
      };

      const edge = createPlayerTradeEdge({
        player: owner,
        reference: {
          ...reference,
          sourceTradeId:
            sourceReference.sourceTradeId ?? reference.sourceTradeId,
          tradeDate:
            sourceReference.tradeDate ?? reference.tradeDate,
          displayText:
            sourceReference.displayText ??
            reference.displayText ??
            owner.name,
        },
        referenceOrigin,
      });

      actualByKey.set(key, { playerId: owner.id, edge });
      playerTradeEdges.push(edge);
    }
  }

  const unresolvedPlayerReferences = [];
  const ambiguousPlayerReferences = [];

  for (const reference of expectedReferences) {
    if (actualByKey.has(reference.referenceKey)) continue;

    const resolution = playerResolver.resolve(reference);

    if (resolution.status === "UNAMBIGUOUS_PLAYER_MATCH") {
      const edge = createPlayerTradeEdge({
        player: resolution.player,
        reference: {
          ...reference,
          displayText: reference.displayText || resolution.player.name,
        },
        referenceOrigin: "canonical_asset_identity_inferred",
      });

      actualByKey.set(reference.referenceKey, {
        playerId: resolution.player.id,
        edge,
      });
      playerTradeEdges.push(edge);

      inferredPlayerReferences.push({
        referenceKey: reference.referenceKey,
        referenceType: reference.referenceType,
        canonicalTradeId: reference.canonicalTradeId,
        sourceTradeId: reference.sourceTradeId,
        assetId: reference.assetId,
        playerId: resolution.player.id,
        playerName: resolution.player.name,
      });

      continue;
    }

    const unresolved = {
      ...reference,
      resolutionStatus: resolution.status,
      candidatePlayerIds: resolution.candidatePlayerIds,
    };

    unresolvedPlayerReferences.push(unresolved);

    if (resolution.status === "AMBIGUOUS_PLAYER_MATCH") {
      ambiguousPlayerReferences.push(unresolved);
    }
  }

  const missingPlayerReferences = unresolvedPlayerReferences;

  const extraPlayerReferences = [...actualByKey.entries()]
    .filter(([key]) => !expectedByKey.has(key))
    .map(([key, value]) => ({
      referenceKey: key,
      playerId: value.playerId,
    }));

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
    players.map((player) => [player.id, []]),
  );
  const tradeToPlayers = Object.fromEntries(
    trades.map((trade) => [trade.id, []]),
  );

  for (const edge of playerTradeEdges) {
    playerToTrades[edge.playerId].push(edge.canonicalTradeId);
    tradeToPlayers[edge.canonicalTradeId].push(edge.playerId);
  }

  for (const playerId of Object.keys(playerToTrades)) {
    playerToTrades[playerId] = uniqueSorted(playerToTrades[playerId]);
  }

  for (const tradeId of Object.keys(tradeToPlayers)) {
    tradeToPlayers[tradeId] = uniqueSorted(tradeToPlayers[tradeId]);
  }

  const referencedTradeCount = Object.values(tradeToPlayers).filter(
    (playerIds) => playerIds.length > 0,
  ).length;
  const referencedPlayerCount = Object.values(playerToTrades).filter(
    (tradeIds) => tradeIds.length > 0,
  ).length;

  const explicitEdgeCount = playerTradeEdges.filter(
    (edge) => edge.referenceOrigin === "player_source_reference",
  ).length;
  const correctedEdgeCount = playerTradeEdges.filter(
    (edge) => edge.referenceOrigin === "canonical_asset_identity_corrected",
  ).length;
  const inferredEdgeCount = playerTradeEdges.filter(
    (edge) => edge.referenceOrigin === "canonical_asset_identity_inferred",
  ).length;

  const counts = {
    teamNodes: registry.teams.filter(
      (team) => teamToTrades[team.slug].length > 0,
    ).length,
    tradeNodes: trades.length,
    playerNodes: players.length,
    totalNodes:
      registry.teams.filter(
        (team) => teamToTrades[team.slug].length > 0,
      ).length +
      trades.length +
      players.length,
    teamTradeEdges: teamTradeEdges.length,
    expectedPlayerReferences: expectedReferences.length,
    playerSourceReferenceRecords: players.reduce(
      (sum, player) => sum + (player.sourceReferences?.length ?? 0),
      0,
    ),
    playerTradeReferenceEdges: playerTradeEdges.length,
    explicitPlayerReferenceEdges: explicitEdgeCount,
    correctedPlayerReferenceEdges: correctedEdgeCount,
    inferredPlayerReferenceEdges: inferredEdgeCount,
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
    ambiguousPlayerReferences: ambiguousPlayerReferences.length,
    unresolvedPlayerReferences: unresolvedPlayerReferences.length,
    extraPlayerReferences: extraPlayerReferences.length,
    invalidPlayerReferences: invalidPlayerReferences.length,
    duplicateReferenceOwnership: duplicateReferenceOwnership.length,
    correctedReferenceOwnership: correctedReferenceOwnership.length,
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
        playerReferenceCount:
          tradeToPlayers[trade.id]?.length ?? 0,
      })),
      players: players.map((player) => ({
        playerId: player.id,
        name: player.name,
        slug: player.slug,
        sourceReferenceCount: player.sourceReferences?.length ?? 0,
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
    repairs: {
      inferredPlayerReferences,
      correctedReferenceOwnership,
    },
    issues: {
      missingPlayerReferences,
      ambiguousPlayerReferences,
      unresolvedPlayerReferences,
      extraPlayerReferences,
      invalidPlayerReferences,
      duplicateReferenceOwnership,
      invalidTradeTeams,
    },
  };
}
