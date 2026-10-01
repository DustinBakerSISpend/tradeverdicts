import {
  CURRENT_NFL_TEAM_SLUGS,
  getCurrentFranchiseSlugsForTrade,
  normalizeTradeForCurrentFranchises,
} from "./teamRegistry.js";

const currentTeamSet = new Set(CURRENT_NFL_TEAM_SLUGS);

const unique = (values) => [...new Set(values.filter(Boolean))];

export const getCanonicalTeamPairSlugs = (teamA, teamB) => {
  const pair = unique([
    String(teamA || "").trim(),
    String(teamB || "").trim(),
  ]).filter((slug) => currentTeamSet.has(slug));

  if (pair.length !== 2) return null;

  return pair.sort((left, right) =>
    left.localeCompare(right, "en-US")
  );
};

export const getTeamPairKey = (teamA, teamB) => {
  const pair = getCanonicalTeamPairSlugs(teamA, teamB);
  return pair ? pair.join("__") : "";
};

export const getTeamPairPath = (teamA, teamB) => {
  const pair = getCanonicalTeamPairSlugs(teamA, teamB);
  return pair
    ? `/teams/${pair[0]}/trades/${pair[1]}/`
    : "";
};

export function buildTeamPairIndex(publicTrades = []) {
  const index = new Map();

  for (const trade of publicTrades) {
    const currentTeams = getCurrentFranchiseSlugsForTrade(trade);

    if (currentTeams.length < 2) continue;

    const normalizedTrade =
      normalizeTradeForCurrentFranchises(trade);

    for (
      let first = 0;
      first < currentTeams.length - 1;
      first += 1
    ) {
      for (
        let second = first + 1;
        second < currentTeams.length;
        second += 1
      ) {
        const pair = getCanonicalTeamPairSlugs(
          currentTeams[first],
          currentTeams[second]
        );

        if (!pair) continue;

        const key = pair.join("__");

        if (!index.has(key)) {
          index.set(key, {
            key,
            teamA: pair[0],
            teamB: pair[1],
            path: getTeamPairPath(pair[0], pair[1]),
            trades: [],
          });
        }

        index.get(key).trades.push(normalizedTrade);
      }
    }
  }

  for (const entry of index.values()) {
    entry.trades.sort(
      (left, right) =>
        new Date(left.tradeDate) - new Date(right.tradeDate)
    );
  }

  return index;
}

export function getTeamPairEntries(publicTrades = []) {
  return [...buildTeamPairIndex(publicTrades).values()]
    .sort((left, right) =>
      left.path.localeCompare(right.path, "en-US")
    );
}

export function getTeamPairEntry(
  publicTrades = [],
  teamA,
  teamB
) {
  const key = getTeamPairKey(teamA, teamB);
  if (!key) return null;
  return buildTeamPairIndex(publicTrades).get(key) || null;
}

export function getTeamPairPartners(
  publicTrades = [],
  teamSlug
) {
  const slug = String(teamSlug || "").trim();
  if (!currentTeamSet.has(slug)) return [];

  return getTeamPairEntries(publicTrades)
    .filter(
      (entry) =>
        entry.teamA === slug || entry.teamB === slug
    )
    .map((entry) => ({
      ...entry,
      partner:
        entry.teamA === slug
          ? entry.teamB
          : entry.teamA,
    }))
    .sort((left, right) => {
      const tradeDiff =
        right.trades.length - left.trades.length;

      return tradeDiff !== 0
        ? tradeDiff
        : left.partner.localeCompare(
            right.partner,
            "en-US"
          );
    });
}
