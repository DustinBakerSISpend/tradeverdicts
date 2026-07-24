import {
  semanticTokenFromCanonicalAsset,
  semanticTokenFromText,
} from "./canonical-transaction-identity.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function canonicalTokenIndex(trade) {
  const index = new Map();
  for (const asset of trade?.assetLedger ?? []) {
    const token = semanticTokenFromCanonicalAsset(asset);
    if (!index.has(token)) index.set(token, []);
    index.get(token).push(asset);
  }
  return index;
}

export function buildPreviewRoutingPlan({ previewRecords, canonicalTrades }) {
  const canonicalById = new Map(canonicalTrades.map((trade) => [trade.id, trade]));
  const routes = [];
  const recordSummaries = [];
  const issues = [];

  for (const record of previewRecords) {
    if (record.candidateAction === "exclude-from-standalone-canonical-preview") {
      continue;
    }

    const isMultiTeam = record.teams.length > 2;
    const existingTrade = record.existingCanonicalMatch
      ? canonicalById.get(record.existingCanonicalMatch)
      : null;
    const existingTokens = existingTrade ? canonicalTokenIndex(existingTrade) : null;
    let resolved = 0;
    let partiallyResolved = 0;
    let unresolved = 0;
    let canonicalAssetMatches = 0;

    for (const asset of record.assetLedger ?? []) {
      const token = semanticTokenFromText(asset.displayText, {
        tradeDate: record.tradeDate,
        fromTeam: asset.fromTeam,
        toTeam: asset.toTeam,
      });
      let routingAction;
      let matchedCanonicalAssetId = null;
      let fromTeam = asset.fromTeam ?? null;
      let toTeam = asset.toTeam ?? null;
      let possibleFromTeams = uniqueSorted(asset.possibleFromTeams ?? []);
      let possibleToTeams = uniqueSorted(asset.possibleToTeams ?? []);
      const blockers = [];

      if (!isMultiTeam) {
        routingAction = "resolved-two-team-route";
        resolved += 1;
      } else if (existingTrade) {
        const matches = existingTokens.get(token) ?? [];
        if (matches.length === 1) {
          const match = matches[0];
          matchedCanonicalAssetId = match.assetId;
          fromTeam = match.fromTeam ?? fromTeam;
          toTeam = match.toTeam ?? toTeam;
          possibleFromTeams = [];
          possibleToTeams = [];
          routingAction = "resolved-from-existing-canonical-asset";
          canonicalAssetMatches += 1;
          resolved += 1;
        } else if (matches.length > 1) {
          routingAction = "hold-ambiguous-existing-asset-match";
          blockers.push(`Semantic token matches ${matches.length} canonical assets.`);
          unresolved += 1;
        } else {
          routingAction = "hold-unmatched-existing-perspective-asset";
          blockers.push("Atlanta perspective asset did not match the existing canonical asset ledger.");
          unresolved += 1;
        }
      } else if (asset.direction === "received") {
        routingAction = "manual-from-team-routing-required";
        blockers.push(`Choose one source team from: ${possibleFromTeams.join(" | ")}`);
        partiallyResolved += 1;
      } else {
        routingAction = "manual-to-team-routing-required";
        blockers.push(`Choose one destination team from: ${possibleToTeams.join(" | ")}`);
        unresolved += 1;
      }

      const endpointSet = new Set(record.teams);
      if (fromTeam && !endpointSet.has(fromTeam)) {
        blockers.push(`fromTeam ${fromTeam} is outside the trade team set.`);
      }
      if (toTeam && !endpointSet.has(toTeam)) {
        blockers.push(`toTeam ${toTeam} is outside the trade team set.`);
      }
      if (fromTeam && toTeam && fromTeam === toTeam) {
        blockers.push("Asset route has the same fromTeam and toTeam.");
      }

      routes.push({
        sourceTradeId: record.sourceTradeId,
        canonicalTradeId: record.existingCanonicalMatch ?? record.provisionalCanonicalId,
        provisionalCanonicalId: record.provisionalCanonicalId,
        tradeDate: record.tradeDate,
        teams: record.teams,
        teamCount: record.teams.length,
        assetId: asset.assetId,
        assetType: asset.type,
        displayText: clean(asset.displayText),
        direction: asset.direction,
        semanticToken: token,
        routingAction,
        matchedCanonicalAssetId,
        fromTeam,
        toTeam,
        possibleFromTeams,
        possibleToTeams,
        blockers,
        routingReady: blockers.length === 0,
        automaticRouting: false,
      });
    }

    const recordRoutes = routes.filter((route) => route.sourceTradeId === record.sourceTradeId);
    const blockerCount = recordRoutes.reduce((sum, route) => sum + route.blockers.length, 0);
    recordSummaries.push({
      sourceTradeId: record.sourceTradeId,
      canonicalTradeId: record.existingCanonicalMatch ?? record.provisionalCanonicalId,
      tradeDate: record.tradeDate,
      teams: record.teams,
      teamCount: record.teams.length,
      assetCount: recordRoutes.length,
      resolvedAssetRoutes: resolved,
      partiallyResolvedAssetRoutes: partiallyResolved,
      unresolvedAssetRoutes: unresolved,
      existingCanonicalAssetMatches: canonicalAssetMatches,
      blockerCount,
      routingReady: blockerCount === 0,
      routingStatus: blockerCount === 0 ? "preview-complete" : "manual-routing-required",
    });
  }

  for (const route of routes) {
    if (route.blockers.length > 0) {
      issues.push({
        sourceTradeId: route.sourceTradeId,
        canonicalTradeId: route.canonicalTradeId,
        assetId: route.assetId,
        routingAction: route.routingAction,
        blockers: route.blockers,
      });
    }
  }

  return {
    routes,
    recordSummaries,
    issues,
  };
}
