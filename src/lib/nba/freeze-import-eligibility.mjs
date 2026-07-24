import { createHash } from "node:crypto";

function assert(value, message) {
  if (!value) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right), "en"));
}

function duplicates(values) {
  return uniqueSorted(values.filter((value, index) => values.indexOf(value) !== index));
}

function stableObjectHash(value) {
  return sha256(JSON.stringify(value));
}

function playerIdFor(identity) {
  return identity.existingPlayerId ?? identity.provisionalPlayerId;
}

function playerIsSatisfiable(identity) {
  return (
    identity.identityAction === "match-existing-player" ||
    (identity.identityAction === "create-new-player-preview" && identity.playerDataReady === true)
  );
}

function nonStandaloneAction(record) {
  if (record.duplicateGuardStatus === "merge-followup") return "merge-followup";
  if (record.duplicateGuardStatus === "exclude-duplicate") return "exclude-duplicate";
  if (record.duplicateGuardStatus === "hold-conflict") return "hold-conflict";
  throw new Error(`Unknown non-standalone duplicate status for ${record.sourceTradeId}: ${record.duplicateGuardStatus}`);
}

export function freezeAtlantaImportEligibility({
  phase3b,
  phase3c,
  players,
  trades,
}) {
  assert(phase3b?.result === "PASS" && phase3b?.phase === "3B", "A passing Phase 3B preview is required.");
  assert(phase3c?.result === "PASS" && phase3c?.phase === "3C", "A passing Phase 3C preview is required.");
  assert(Array.isArray(phase3b.records) && phase3b.records.length === 308, "Expected 308 Phase 3B records.");
  assert(Array.isArray(phase3c.recordEligibility) && phase3c.recordEligibility.length === 299, "Expected 299 Phase 3C eligibility rows.");
  assert(Array.isArray(players) && players.length === 67, "Expected 67 existing players.");
  assert(Array.isArray(trades) && trades.length === 27, "Expected 27 existing canonical trades.");

  const existingTradeIds = new Set(trades.map((trade) => trade.id));
  const existingPlayerIds = new Set(players.map((player) => player.id));
  const eligibilityBySourceTradeId = new Map(
    phase3c.recordEligibility.map((record) => [record.sourceTradeId, record]),
  );
  const identityByPlayerId = new Map(
    phase3c.playerIdentity.identities.map((identity) => [playerIdFor(identity), identity]),
  );
  const relationshipEdgesBySourceTradeId = new Map();
  for (const edge of phase3c.relationships.playerTradeEdges) {
    if (!relationshipEdgesBySourceTradeId.has(edge.sourceTradeId)) {
      relationshipEdgesBySourceTradeId.set(edge.sourceTradeId, []);
    }
    relationshipEdgesBySourceTradeId.get(edge.sourceTradeId).push(edge);
  }

  const tradeManifest = [];
  const playerDependencyHolds = [];

  for (const record of phase3b.records) {
    let importAction;
    const blockers = [...record.blockers];
    const dependencyPlayerIds = [];

    if (record.candidateAction === "exclude-from-standalone-canonical-preview") {
      importAction = nonStandaloneAction(record);
    } else if (record.candidateAction === "add-source-perspective-to-existing-canonical") {
      importAction = "update-perspective-reconcile";
      assert(record.existingCanonicalMatch, `Missing existing canonical match for ${record.sourceTradeId}`);
      assert(existingTradeIds.has(record.existingCanonicalMatch), `Existing canonical match not found for ${record.sourceTradeId}`);
      blockers.push("Existing canonical assets and perspective keys must be reconciled before any update.");
    } else if (record.candidateAction === "create-new-canonical-preview") {
      const eligibility = eligibilityBySourceTradeId.get(record.sourceTradeId);
      assert(eligibility, `Missing Phase 3C eligibility for ${record.sourceTradeId}`);
      if (!eligibility.phase3cCanonicalImportReady) {
        importAction = "hold-phase3c";
        blockers.push(...eligibility.blockers);
      } else {
        const edges = relationshipEdgesBySourceTradeId.get(record.sourceTradeId) ?? [];
        for (const edge of edges.filter((candidate) => candidate.relationshipImportReady)) {
          const identity = identityByPlayerId.get(edge.playerId);
          assert(identity, `Missing identity ${edge.playerId} for ${record.sourceTradeId}`);
          if (!playerIsSatisfiable(identity)) dependencyPlayerIds.push(edge.playerId);
        }
        if (dependencyPlayerIds.length > 0) {
          importAction = "hold-player-dependency";
          blockers.push("One or more referenced new player identities are not frozen as import-ready.");
          for (const playerId of uniqueSorted(dependencyPlayerIds)) {
            const identity = identityByPlayerId.get(playerId);
            playerDependencyHolds.push({
              sourceTradeId: record.sourceTradeId,
              canonicalTradeId: record.provisionalCanonicalId,
              playerId,
              playerName: identity.preferredName,
              playerAction: identity.identityAction,
              playerDataReady: identity.playerDataReady,
              sourceTradeIds: identity.sourceTradeIds,
              reason: "The identity spans at least one blocked or existing-perspective context and is not safe for automatic player creation.",
            });
          }
        } else {
          importAction = "create-canonical";
        }
      }
    } else {
      throw new Error(`Unknown candidate action for ${record.sourceTradeId}: ${record.candidateAction}`);
    }

    const canonicalTradeId = record.existingCanonicalMatch ?? record.provisionalCanonicalId;
    const frozenIdentity = {
      sourceTradeId: record.sourceTradeId,
      canonicalTradeId,
      importAction,
      tradeDate: record.tradeDate,
      teams: record.teams,
      sourceTeam: record.sourceTeam,
      dateTeamsKey: record.dateTeamsKey,
      sourcePerspectiveKey: record.sourcePerspectiveKey,
      transactionFingerprint: record.transactionFingerprint,
      provisionalCanonicalKey: record.provisionalCanonicalKey,
      candidateAction: record.candidateAction,
      duplicateGuardStatus: record.duplicateGuardStatus,
      assetIds: record.assetLedger.map((asset) => asset.assetId).sort((left, right) => left.localeCompare(right, "en")),
      playerDependencyIds: uniqueSorted(dependencyPlayerIds),
      blockers: uniqueSorted(blockers),
      publishStatus: "private",
      indexEligible: false,
      adEligible: false,
      automaticMerge: false,
      automaticRouting: false,
    };
    tradeManifest.push({
      ...frozenIdentity,
      freezeSha256: stableObjectHash(frozenIdentity),
    });
  }

  tradeManifest.sort((left, right) => left.sourceTradeId.localeCompare(right.sourceTradeId, "en"));
  playerDependencyHolds.sort((left, right) =>
    `${left.sourceTradeId}|${left.playerId}`.localeCompare(`${right.sourceTradeId}|${right.playerId}`, "en"),
  );

  const executableTradeIds = new Set(
    tradeManifest.filter((entry) => entry.importAction === "create-canonical").map((entry) => entry.sourceTradeId),
  );
  const executableCanonicalIds = new Set(
    tradeManifest.filter((entry) => entry.importAction === "create-canonical").map((entry) => entry.canonicalTradeId),
  );

  const executablePlayerEdges = phase3c.relationships.playerTradeEdges
    .filter((edge) => executableTradeIds.has(edge.sourceTradeId) && edge.relationshipImportReady)
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId, "en"));
  const executablePlayerIds = new Set(executablePlayerEdges.map((edge) => edge.playerId));

  const playerManifest = phase3c.playerIdentity.identities
    .map((identity) => {
      const playerId = playerIdFor(identity);
      let importAction;
      if (executablePlayerIds.has(playerId)) {
        importAction = identity.identityAction === "match-existing-player" ? "use-existing-player" : "create-new-player";
      } else if (identity.identityAction === "match-existing-player") {
        importAction = "defer-existing-player-match";
      } else if (identity.playerDataReady) {
        importAction = "defer-unused-ready-player";
      } else {
        importAction = "hold-player-identity";
      }

      if (importAction === "use-existing-player") {
        assert(existingPlayerIds.has(playerId), `Frozen existing player does not exist: ${playerId}`);
      }
      if (importAction === "create-new-player") {
        assert(!existingPlayerIds.has(playerId), `Frozen new player collides with existing player: ${playerId}`);
        assert(identity.playerDataReady, `Frozen new player is not player-data-ready: ${playerId}`);
      }

      const frozenIdentity = {
        playerId,
        importAction,
        preferredName: identity.preferredName,
        normalizedName: identity.normalizedName,
        slug: identity.slug,
        sourceVariants: identity.sourceVariants,
        identityAction: identity.identityAction,
        existingPlayerId: identity.existingPlayerId,
        provisionalPlayerId: identity.provisionalPlayerId,
        sourceTradeIds: identity.sourceTradeIds,
        canonicalTradeIds: identity.canonicalTradeIds,
        referenceTypes: identity.referenceTypes,
        yearRange: identity.yearRange,
        playerDataReady: identity.playerDataReady,
        blockers: identity.blockers,
        publishStatus: "private",
        indexEligible: false,
        adEligible: false,
        automaticMerge: false,
      };
      return {
        ...frozenIdentity,
        freezeSha256: stableObjectHash(frozenIdentity),
      };
    })
    .sort((left, right) => left.playerId.localeCompare(right.playerId, "en"));

  const playerTradeEdges = executablePlayerEdges.map((edge) => ({
    ...edge,
    freezeSha256: stableObjectHash(edge),
  }));
  const teamTradeEdges = phase3c.relationships.teamTradeEdges
    .filter((edge) => executableTradeIds.has(edge.sourceTradeId))
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId, "en"))
    .map((edge) => ({ ...edge, freezeSha256: stableObjectHash(edge) }));
  const assetRoutes = phase3c.routing.routes
    .filter((route) => executableTradeIds.has(route.sourceTradeId))
    .sort((left, right) => `${left.sourceTradeId}|${left.assetId}`.localeCompare(`${right.sourceTradeId}|${right.assetId}`, "en"))
    .map((route) => {
      assert(route.routingReady, `Executable route is not ready: ${route.sourceTradeId}/${route.assetId}`);
      assert(route.fromTeam && route.toTeam, `Executable route lacks endpoints: ${route.sourceTradeId}/${route.assetId}`);
      assert(route.automaticRouting === false, `Automatic routing must remain false: ${route.sourceTradeId}/${route.assetId}`);
      return { ...route, freezeSha256: stableObjectHash(route) };
    });

  const updatePerspectiveManifest = tradeManifest.filter(
    (entry) => entry.importAction === "update-perspective-reconcile",
  );

  const actionCounts = Object.fromEntries(
    [...new Set(tradeManifest.map((entry) => entry.importAction))]
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((action) => [action, tradeManifest.filter((entry) => entry.importAction === action).length]),
  );
  const playerActionCounts = Object.fromEntries(
    [...new Set(playerManifest.map((entry) => entry.importAction))]
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((action) => [action, playerManifest.filter((entry) => entry.importAction === action).length]),
  );

  const duplicateCanonicalIds = duplicates(
    tradeManifest
      .filter((entry) => entry.importAction !== "update-perspective-reconcile")
      .map((entry) => entry.canonicalTradeId),
  );
  const duplicatePerspectiveKeys = duplicates(tradeManifest.map((entry) => entry.sourcePerspectiveKey));
  const duplicateTransactionFingerprints = duplicates(
    tradeManifest
      .filter((entry) => entry.importAction === "create-canonical")
      .map((entry) => entry.transactionFingerprint),
  );
  const duplicatePlayerIds = duplicates(playerManifest.map((entry) => entry.playerId));
  const duplicatePlayerSlugs = duplicates(
    playerManifest
      .filter((entry) => entry.importAction === "create-new-player")
      .map((entry) => entry.slug),
  );
  const duplicatePlayerTradeEdges = duplicates(playerTradeEdges.map((edge) => edge.edgeId));
  const duplicateTeamTradeEdges = duplicates(teamTradeEdges.map((edge) => edge.edgeId));
  const duplicateAssetRouteKeys = duplicates(assetRoutes.map((route) => `${route.sourceTradeId}|${route.assetId}`));
  const unexpectedExistingCanonicalCollisions = tradeManifest
    .filter((entry) => entry.importAction === "create-canonical" && existingTradeIds.has(entry.canonicalTradeId))
    .map((entry) => entry.sourceTradeId);

  assert(duplicateCanonicalIds.length === 0, `Duplicate frozen canonical IDs: ${duplicateCanonicalIds.join(", ")}`);
  assert(duplicatePerspectiveKeys.length === 0, `Duplicate source perspective keys: ${duplicatePerspectiveKeys.join(", ")}`);
  assert(duplicateTransactionFingerprints.length === 0, `Duplicate executable fingerprints: ${duplicateTransactionFingerprints.join(", ")}`);
  assert(duplicatePlayerIds.length === 0, `Duplicate frozen player IDs: ${duplicatePlayerIds.join(", ")}`);
  assert(duplicatePlayerSlugs.length === 0, `Duplicate frozen new-player slugs: ${duplicatePlayerSlugs.join(", ")}`);
  assert(duplicatePlayerTradeEdges.length === 0, "Duplicate frozen player-trade edges.");
  assert(duplicateTeamTradeEdges.length === 0, "Duplicate frozen team-trade edges.");
  assert(duplicateAssetRouteKeys.length === 0, "Duplicate frozen asset-route keys.");
  assert(unexpectedExistingCanonicalCollisions.length === 0, `Unexpected existing canonical collisions: ${unexpectedExistingCanonicalCollisions.join(", ")}`);
  assert(updatePerspectiveManifest.length === 1, "Expected exactly one existing-perspective reconciliation row.");
  assert(updatePerspectiveManifest[0].canonicalTradeId === "nba-trade-20260109-e1724a128785", "Trae Young existing canonical match drifted.");
  assert(assetRoutes.length === tradeManifest
    .filter((entry) => entry.importAction === "create-canonical")
    .reduce((sum, entry) => sum + entry.assetIds.length, 0), "Frozen asset route count does not match executable asset ledgers.");
  assert([...executableCanonicalIds].every((id) => !existingTradeIds.has(id)), "Executable canonical ID collides with existing store.");

  const counts = {
    sourceRows: tradeManifest.length,
    createCanonical: actionCounts["create-canonical"] ?? 0,
    holdPlayerDependency: actionCounts["hold-player-dependency"] ?? 0,
    holdPhase3c: actionCounts["hold-phase3c"] ?? 0,
    updatePerspectiveReconcile: actionCounts["update-perspective-reconcile"] ?? 0,
    mergeFollowup: actionCounts["merge-followup"] ?? 0,
    excludeDuplicate: actionCounts["exclude-duplicate"] ?? 0,
    holdConflict: actionCounts["hold-conflict"] ?? 0,
    playerDependencyHoldRows: playerDependencyHolds.length,
    playerDependencyHoldTrades: uniqueSorted(playerDependencyHolds.map((row) => row.sourceTradeId)).length,
    playerDependencyHoldIdentities: uniqueSorted(playerDependencyHolds.map((row) => row.playerId)).length,
    playerIdentities: playerManifest.length,
    createNewPlayers: playerActionCounts["create-new-player"] ?? 0,
    useExistingPlayers: playerActionCounts["use-existing-player"] ?? 0,
    deferUnusedReadyPlayers: playerActionCounts["defer-unused-ready-player"] ?? 0,
    holdPlayerIdentity: playerActionCounts["hold-player-identity"] ?? 0,
    deferExistingPlayerMatch: playerActionCounts["defer-existing-player-match"] ?? 0,
    frozenAssetRoutes: assetRoutes.length,
    frozenPlayerTradeEdges: playerTradeEdges.length,
    frozenTeamTradeEdges: teamTradeEdges.length,
    existingCanonicalStoreRecords: trades.length,
    existingPlayerStoreRecords: players.length,
  };

  const guards = {
    duplicateCanonicalIds,
    duplicatePerspectiveKeys,
    duplicateTransactionFingerprints,
    duplicatePlayerIds,
    duplicatePlayerSlugs,
    duplicatePlayerTradeEdges,
    duplicateTeamTradeEdges,
    duplicateAssetRouteKeys,
    unexpectedExistingCanonicalCollisions,
    automaticMerges: 0,
    automaticPlayerMerges: 0,
    automaticAssetRouting: 0,
  };

  return {
    result: "PASS",
    phase: "3D1",
    mode: "IMMUTABLE_IMPORT_ELIGIBILITY_FREEZE_ONLY",
    counts,
    actionCounts,
    playerActionCounts,
    guards,
    tradeManifest,
    playerManifest,
    playerDependencyHolds,
    updatePerspectiveManifest,
    assetRoutes,
    relationships: {
      playerTradeEdges,
      teamTradeEdges,
    },
    hashes: {
      tradeManifestSha256: stableObjectHash(tradeManifest),
      playerManifestSha256: stableObjectHash(playerManifest),
      playerDependencyHoldsSha256: stableObjectHash(playerDependencyHolds),
      assetRoutesSha256: stableObjectHash(assetRoutes),
      playerTradeEdgesSha256: stableObjectHash(playerTradeEdges),
      teamTradeEdgesSha256: stableObjectHash(teamTradeEdges),
    },
    canonicalImports: 0,
    playerImports: 0,
    relationshipImports: 0,
    routeCreation: 0,
    repositoryDataWrites: 0,
    pushPerformed: false,
    deployPerformed: false,
  };
}
