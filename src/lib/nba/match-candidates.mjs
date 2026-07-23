function normalizedTokenSet(value) {
  return new Set(
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function jaccardSimilarity(left, right) {
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function sameStringSet(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function assetIdentityTokensFromNormalized(submission) {
  const values = [];

  for (const asset of [
    ...submission.assetsReceived,
    ...submission.assetsSent,
  ]) {
    if (asset.playerName) values.push(`player:${asset.playerName.toLowerCase()}`);
    if (asset.draftYear) values.push(`year:${asset.draftYear}`);
    if (asset.round) values.push(`round:${asset.round}`);
    values.push(...normalizedTokenSet(asset.displayText));
  }

  return new Set(values);
}

function assetIdentityTokensFromTrade(trade) {
  const values = [];

  for (const assets of Object.values(trade.assetsReceived ?? {})) {
    if (!Array.isArray(assets)) continue;

    for (const asset of assets) {
      if (asset.playerName) values.push(`player:${String(asset.playerName).toLowerCase()}`);
      if (asset.draftYear) values.push(`year:${asset.draftYear}`);
      if (asset.round) values.push(`round:${asset.round}`);
      values.push(...normalizedTokenSet(asset.displayText));
    }
  }

  return new Set(values);
}

function overlapScore(left, right) {
  if (left.size === 0 || right.size === 0) return 0;

  let matches = 0;
  for (const value of left) {
    if (right.has(value)) matches += 1;
  }

  return Math.min(20, matches * 5);
}

function classifyScore(score, explicitlyLinked) {
  if (explicitlyLinked || score >= 85) return "exact-match-candidate";
  if (score >= 65) return "likely-match-candidate";
  if (score >= 40) return "ambiguous-candidate";
  return null;
}

export function findNbaCanonicalCandidates(normalized, canonicalTrades) {
  if (!Array.isArray(canonicalTrades)) {
    throw new TypeError("canonicalTrades must be an array.");
  }

  const normalizedAssets = assetIdentityTokensFromNormalized(normalized);
  const normalizedSummary = normalizedTokenSet(normalized.neutralSummary);
  const candidates = [];

  for (const trade of canonicalTrades) {
    if (!trade || trade.league !== "nba") continue;

    let score = 0;
    const reasons = [];
    const explicitlyLinked = Boolean(
      normalized.relatedKnownTradeId &&
      normalized.relatedKnownTradeId === trade.id,
    );

    if (explicitlyLinked) {
      score = 100;
      reasons.push("relatedKnownTradeId matched canonical trade ID");
    } else {
      if (normalized.tradeDate === trade.tradeDate) {
        score += 35;
        reasons.push("exact trade date");
      }

      if (sameStringSet(normalized.teams, trade.teams ?? [])) {
        score += 35;
        reasons.push("exact canonical team set");
      }

      const assetScore = overlapScore(
        normalizedAssets,
        assetIdentityTokensFromTrade(trade),
      );
      if (assetScore > 0) {
        score += assetScore;
        reasons.push(`structured asset overlap +${assetScore}`);
      }

      const similarity = jaccardSimilarity(
        normalizedSummary,
        normalizedTokenSet(trade.summary),
      );
      const summaryScore = Math.min(10, Math.round(similarity * 10));
      if (summaryScore > 0) {
        score += summaryScore;
        reasons.push(`summary token similarity +${summaryScore}`);
      }
    }

    const classification = classifyScore(score, explicitlyLinked);
    if (!classification) continue;

    candidates.push({
      tradeId: trade.id,
      slug: trade.slug,
      score,
      classification,
      reasons,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.tradeId.localeCompare(b.tradeId));

  return {
    automaticMerge: false,
    status: candidates.length > 0
      ? candidates[0].classification
      : "new-transaction-candidate",
    candidates,
  };
}
