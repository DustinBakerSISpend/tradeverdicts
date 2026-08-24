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
    if (
      trade.verdict === "Record Superseded" ||
      trade.contentClass === "Structural / Superseded Record"
    ) {
      continue;
    }

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

  // Evidence-gated supplemental player/trade relationships.
  //
  // These IDs are the exact strict-safe perspective-local relationships
  // verified by NBA supplemental-edge Audits 14 V2 through 16 V3.
  // The separate allowlist is intentional: relationshipReferences also
  // contains reviewed-but-excluded weak-evidence/name-normalization rows.
  // Supplemental rows must never enter canonical asset-reference accounting.
  const verifiedSupplementalRelationshipIds = new Set([
    "dallas-package:dal-1992-0033:received:01:identity:01:player:nba-player-tony-dumas",
    "dallas-package:dal-2000-0056:received:01:identity:01:player:nba-player-howard-eisley",
    "dallas-package:dal-2000-0056:received:03:identity:01:player:nba-player-bill-curley-64dc1533d9",
    "dallas-package:dal-2000-0056:sent:01:identity:01:player:nba-player-bruno-sundov-4464ccad26",
    "dallas-package:dal-2022-0136:sent:02:identity:01:player:nba-player-yannick-nzosa-71c64df2fd",
    "dallas-package:dal-2023-0142:received:02:identity:01:player:nba-player-chaz-lanier-844865ee42",
    "dallas-package:dal-2023-0142:sent:01:identity:01:player:nba-player-reggie-bullock-9aab6361b0",
    "dallas-package:dal-2024-0148:received:03:identity:01:player:nba-player-johni-broome-f30118f62f",
    "dallas-package:dal-2026-0151:received:04:identity:01:player:nba-player-tyus-jones-ae90d97d37",
    "dallas-package:dal-2026-0154:received:01:identity:01:player:nba-player-santi-aldama-f0f6cdc30b",
    "dallas-package:dal-2026-0154:received:02:identity:01:player:nba-player-marcus-sasser-6aaaab183c",
    "dallas-package:dal-2026-0154:sent:02:identity:01:player:nba-player-aj-johnson-258f9a0b71",
    "denver-package:den-1976-0054:sent:01:identity:01:player:nba-player-ralph-simpson-b2783a4c30",
    "denver-package:den-1997-0131:received:01:identity:01:player:nba-player-tyronn-lue-64b6a8ca7d",
    "denver-package:den-1997-0131:received:02:identity:01:player:nba-player-james-posey-b606e3258c",
    "denver-package:den-1997-0131:received:03:identity:01:player:nba-player-dan-mcclintock-034204fdb5",
    "denver-package:den-1997-0131:received:04:identity:01:player:nba-player-joseph-forte-dffe908c34",
    "denver-package:den-1997-0131:received:05:identity:01:player:nba-player-rod-grizzard-4f4b51cfcb",
    "denver-package:den-1997-0131:sent:01:identity:01:player:nba-player-antonio-mcdyess-dcc12c81df",
    "denver-package:den-2008-0168:sent:01:identity:01:player:nba-player-patrick-mills-74c32c104c",
    "denver-package:den-2011-0182:received:01:identity:01:player:nba-player-andre-miller-e5d856e0d7",
    "denver-package:den-2011-0182:received:03:identity:01:player:nba-player-devyn-marble-ddc8bce139",
    "denver-package:den-2011-0182:sent:01:identity:01:player:nba-player-raymond-felton-d0ddc6da42",
    "denver-package:den-2014-0191:received:03:identity:01:player:nba-player-sirdominic-pointer",
    "denver-package:den-2018-0205:received:02:identity:01:player:nba-player-justin-jackson-9e12180709",
    "denver-package:den-2018-0205:sent:01:identity:01:player:nba-player-emmanuel-mudiay-8ab7cc9c77",
    "denver-package:den-2022-0219:received:01:identity:01:player:nba-player-bryn-forbes-e527df77be",
    "detroit-package:det-1951-0017:received:01:identity:01:player:nba-player-dike-eddleman-8cb50f3980",
    "detroit-package:det-1976-0096:received:01:identity:01:player:nba-player-ralph-simpson-b2783a4c30",
    "detroit-package:det-2004-0196:received:01:identity:01:player:nba-player-rasheed-wallace-a34651ed51",
    "detroit-package:det-2004-0196:sent:03:identity:01:player:nba-player-bob-sura",
    "detroit-package:det-2004-0196:sent:04:identity:01:player:nba-player-zeljko-rebraca-76b3df0273",
    "detroit-package:det-2004-0196:sent:05:identity:01:player:nba-player-josh-smith-594ff862c4",
    "detroit-package:det-2026-0278:received:01:identity:01:player:nba-player-john-collins-f164bb3ceb",
    "detroit-package:det-2026-0278:received:02:identity:01:player:nba-player-gary-harris",
    "detroit-package:det-2026-0278:received:03:identity:01:player:nba-player-taurean-prince-3eaac64fbf",
    "detroit-package:det-2026-0278:sent:01:identity:01:player:nba-player-caris-levert-04d4e75260",
    "detroit-package:det-2026-0278:sent:02:identity:01:player:nba-player-marcus-sasser-6aaaab183c",
    "detroit-package:det-2026-0278:sent:03:identity:01:player:nba-player-isaiah-stewart-7718083422",
    "golden-state-warriors:GSW-1948-0004:sent:001:identity:01:player:nba-player-hank-beenders",
    "golden-state-warriors:GSW-1948-0004:sent:002:identity:01:player:nba-player-chick-halbert",
    "golden-state-warriors:GSW-1958-0026:sent:001:identity:01:player:nba-player-walt-davis",
    "golden-state-warriors:GSW-1990-0113:sent:003:identity:01:player:nba-player-steve-bardo",
    "golden-state-warriors:GSW-1999-0142:received:001:identity:01:player:nba-player-mookie-blaylock",
    "golden-state-warriors:GSW-1999-0142:sent:001:identity:01:player:nba-player-bimbo-coles",
    "golden-state-warriors:GSW-2003-0152:received:002:identity:01:player:nba-player-pepe-sanchez",
    "golden-state-warriors:GSW-2009-0165:received:002:identity:01:player:nba-player-speedy-claxton",
    "houston-rockets:HOU-1976-0028:sent:002:identity:01:player:nba-player-joe-c-meriweather",
    "houston-rockets:HOU-2022-0214:received:002:identity:01:player:nba-player-enes-kanter-98f38d4a46",
    "houston-rockets:HOU-2023-0220:received:001:identity:01:player:nba-player-patty-mills",
    "indiana-pacers:IND-1982-0064:sent:001:identity:01:player:nba-player-carlton-mccray",
    "los-angeles-clippers:LAC-1984-0070:received:001:identity:01:player:nba-player-ken-perry",
    "los-angeles-clippers:LAC-1991-0087:received:001:identity:01:player:nba-player-doc-rivers",
    "los-angeles-clippers:LAC-2021-0176:sent:001:identity:01:player:nba-player-lou-williams",
    "los-angeles-lakers:LAL-1980-0105:received:001:identity:01:player:nba-player-eddie-jordan",
    "nba-rel-0a620f6709",
    "nba-rel-44acf1a3b5",
    "nba-rel-512d43f209",
    "nba-rel-579054bceb",
    "nba-rel-5b19ee0865",
    "nba-rel-5f28bb074f",
    "nba-rel-61f7f1a11f",
    "nba-rel-af31d4d728",
    "nba-rel-c0415c6558",
    "nba-rel-c8eea7bee1",
    "nba-rel-d1d4bee308",
    "phase21h-rel-05045154ca5d42a86c1fd4bb",
    "phase21h-rel-1e450c04ed9f347597b42d12",
    "phase21h-rel-31443dc1c138e7c3cb3ed16c",
    "phase21h-rel-50168a1edab867d9daf4b4ff",
    "phase21h-rel-94e6b24b03f0ff06936c8b59",
    "phase21h-rel-a9214ecb3ef920b4f35077aa",
    "phase21h-rel-bc79e22afaa0f4f8412033fd",
    "phase21h-rel-c3207840144afc9ba84c6b1e",
    "phase21h-rel-f9a3b52608234bc4af309e44",
    "phase21h-rel-fa003d20cc67655c6dac2118",
    "phase22h-r3-rel-0ab6c7266743f1fe9dfb3d54",
    "phase22h-r3-rel-1112dbb470f1245b1772ea4b",
    "phase22h-r3-rel-2b9c6ce1850ac9b98f1b7886",
    "phase22h-r3-rel-439fb76b17dacd8ad6110e20",
    "phase22h-r3-rel-6e8a113cf2f1ab729e4eb038",
    "phase22h-r3-rel-b96823de32fa2453ffcfc065",
    "phase22h-r3-rel-c4c16c68e6701db1714e7908",
    "phase22h-r3-rel-c6dead783ece7323bbc8c8c7",
    "phase22h-r3-rel-dbf180177ea6caea37d567e7",
    "phase22h-r3-rel-fbc4dc7b64781bb71861c6ba",
  ]);
  const supplementalPlayerTradeEdges = [];
  const supplementalKnownTradeIds = new Set(trades.map((trade) => trade.id));
  const normalizeVerifiedSupplementalRelationshipValue = (value) =>
    String(value ?? "").replace(/\s+/gu, " ").trim();

  for (const player of players) {
    for (const relationshipReference of player.relationshipReferences ?? []) {
      const relationshipId = normalizeVerifiedSupplementalRelationshipValue(relationshipReference?.relationshipId);
      if (!verifiedSupplementalRelationshipIds.has(relationshipId)) {
        continue;
      }

      const referenceType = normalizeVerifiedSupplementalRelationshipValue(relationshipReference?.referenceType);
      const canonicalTradeId = normalizeVerifiedSupplementalRelationshipValue(
        relationshipReference?.canonicalTradeId || relationshipReference?.tradeId,
      );

      if (!["direct_player", "draft_outcome"].includes(referenceType)) {
        throw new Error(
          `Verified supplemental relationship '${relationshipId}' has unsupported reference type '${referenceType}'.`,
        );
      }

      if (!canonicalTradeId || !supplementalKnownTradeIds.has(canonicalTradeId)) {
        throw new Error(
          `Verified supplemental relationship '${relationshipId}' points to missing trade '${canonicalTradeId}'.`,
        );
      }

      if (
        relationshipReference?.privateOnly !== true ||
        relationshipReference?.perspectiveLocalAssetReference !== true
      ) {
        throw new Error(
          `Verified supplemental relationship '${relationshipId}' lost its perspective-local/private contract.`,
        );
      }

      supplementalPlayerTradeEdges.push({
        playerId: player.id,
        playerName: player.name,
        canonicalTradeId,
        tradeId: canonicalTradeId,
        referenceType,
        referenceOrigin: "verified_perspective_relationship",
        relationshipId,
        relationshipRole: normalizeVerifiedSupplementalRelationshipValue(relationshipReference?.relationshipRole),
        sourceTradeId: normalizeVerifiedSupplementalRelationshipValue(relationshipReference?.sourceTradeId),
        sourceTeam: normalizeVerifiedSupplementalRelationshipValue(relationshipReference?.sourceTeam),
        packageId: normalizeVerifiedSupplementalRelationshipValue(relationshipReference?.packageId),
        assetId: normalizeVerifiedSupplementalRelationshipValue(
          relationshipReference?.assetId || relationshipReference?.assetReference,
        ),
      });
    }
  }

  if (supplementalPlayerTradeEdges.length !== verifiedSupplementalRelationshipIds.size) {
    throw new Error(
      `Expected ${verifiedSupplementalRelationshipIds.size} verified supplemental player/trade edges; found ${supplementalPlayerTradeEdges.length}.`,
    );
  }

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

  for (const edge of supplementalPlayerTradeEdges) {
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
      supplementalPlayerTrade: supplementalPlayerTradeEdges,
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
