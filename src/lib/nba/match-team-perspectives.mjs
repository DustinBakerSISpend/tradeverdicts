function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/second[-\s]round/g, "second round")
    .replace(/first[-\s]round/g, "first round")
    .replace(/third[-\s]round/g, "third round")
    .replace(/\*+/g, "")
    .replace(/[^a-z0-9#?'\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameStringSet(left, right) {
  const a = [...new Set(left ?? [])].sort();
  const b = [...new Set(right ?? [])].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function assetKeys(assets) {
  return (assets ?? []).map((asset) => normalizedText(asset.displayText)).filter(Boolean);
}

function multisetIntersectionCount(left, right) {
  const counts = new Map();
  for (const value of right) counts.set(value, (counts.get(value) ?? 0) + 1);

  let matches = 0;
  for (const value of left) {
    const remaining = counts.get(value) ?? 0;
    if (remaining < 1) continue;
    counts.set(value, remaining - 1);
    matches += 1;
  }

  return matches;
}

function directionCoverage(sourceAssets, oppositeAssets) {
  if (sourceAssets.length === 0 && oppositeAssets.length === 0) return 1;
  if (sourceAssets.length === 0 || oppositeAssets.length === 0) return 0;

  const matches = multisetIntersectionCount(sourceAssets, oppositeAssets);
  return matches / Math.max(sourceAssets.length, oppositeAssets.length);
}

function teamOverlapCount(left, right) {
  const rightSet = new Set(right ?? []);
  return [...new Set(left ?? [])].filter((team) => rightSet.has(team)).length;
}

function scorePerspectivePair(left, right) {
  const sameDate = left.tradeDate === right.tradeDate;
  const exactTeams = sameStringSet(left.teams, right.teams);
  const teamOverlap = teamOverlapCount(left.teams, right.teams);
  const leftReceived = assetKeys(left.assetsReceived);
  const leftSent = assetKeys(left.assetsSent);
  const rightReceived = assetKeys(right.assetsReceived);
  const rightSent = assetKeys(right.assetsSent);
  const receivedCoverage = directionCoverage(leftReceived, rightSent);
  const sentCoverage = directionCoverage(leftSent, rightReceived);
  const reciprocalMatches =
    multisetIntersectionCount(leftReceived, rightSent) +
    multisetIntersectionCount(leftSent, rightReceived);

  let score = 0;
  const reasons = [];

  if (sameDate) {
    score += 45;
    reasons.push("exact trade date");
  }

  if (exactTeams) {
    score += 30;
    reasons.push("exact team set");
  } else if (teamOverlap >= 2) {
    score += Math.min(18, teamOverlap * 6);
    reasons.push(`${teamOverlap} overlapping teams`);
  }

  if (left.sourceTeam && right.partnerTeams?.includes(left.sourceTeam)) {
    score += 5;
    reasons.push("left source team appears in right partner list");
  }

  if (right.sourceTeam && left.partnerTeams?.includes(right.sourceTeam)) {
    score += 5;
    reasons.push("right source team appears in left partner list");
  }

  if (reciprocalMatches > 0) {
    const reciprocalScore = Math.min(20, reciprocalMatches * 4);
    score += reciprocalScore;
    reasons.push(`${reciprocalMatches} reciprocal asset matches (+${reciprocalScore})`);
  }

  const reciprocalCoverage = Math.min(receivedCoverage, sentCoverage);
  if (reciprocalCoverage >= 0.75) {
    score += 10;
    reasons.push("high reciprocal direction coverage");
  } else if (reciprocalCoverage >= 0.4) {
    score += 5;
    reasons.push("partial reciprocal direction coverage");
  }

  let classification = null;
  if (sameDate && exactTeams && receivedCoverage >= 0.75 && sentCoverage >= 0.75) {
    classification = "exact-perspective-match";
  } else if (sameDate && exactTeams && reciprocalMatches >= 1) {
    classification = "likely-perspective-match";
  } else if (sameDate && teamOverlap >= 2) {
    classification = "ambiguous-perspective-match";
  }

  return {
    score,
    classification,
    reasons,
    sameDate,
    exactTeams,
    teamOverlap,
    reciprocalMatches,
    receivedCoverage: Number(receivedCoverage.toFixed(4)),
    sentCoverage: Number(sentCoverage.toFixed(4)),
  };
}

export function matchNbaTeamPerspectives(leftRecords, rightRecords) {
  if (!Array.isArray(leftRecords) || !Array.isArray(rightRecords)) {
    throw new TypeError("leftRecords and rightRecords must be arrays.");
  }

  const results = [];

  for (const right of rightRecords) {
    const candidates = [];

    for (const left of leftRecords) {
      if (!left || !right || left.sourceTeam === right.sourceTeam) continue;
      const scored = scorePerspectivePair(left, right);
      if (!scored.classification) continue;

      candidates.push({
        submissionId: left.submissionId,
        sourceTeam: left.sourceTeam,
        tradeDate: left.tradeDate,
        teams: left.teams,
        ...scored,
      });
    }

    candidates.sort(
      (a, b) =>
        b.score - a.score || a.submissionId.localeCompare(b.submissionId),
    );

    results.push({
      submissionId: right.submissionId,
      sourceTeam: right.sourceTeam,
      tradeDate: right.tradeDate,
      teams: right.teams,
      automaticMerge: false,
      status: candidates[0]?.classification ?? "new-transaction-candidate",
      candidates,
    });
  }

  const counts = {
    exact: results.filter((result) => result.status === "exact-perspective-match").length,
    likely: results.filter((result) => result.status === "likely-perspective-match").length,
    ambiguous: results.filter((result) => result.status === "ambiguous-perspective-match").length,
    newTransaction: results.filter((result) => result.status === "new-transaction-candidate").length,
  };

  return {
    automaticMerge: false,
    leftSubmissionCount: leftRecords.length,
    rightSubmissionCount: rightRecords.length,
    counts,
    results,
  };
}
