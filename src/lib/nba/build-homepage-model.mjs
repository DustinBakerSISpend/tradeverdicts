const GRADE_RANK = Object.freeze({
  "A+": 13,
  A: 12,
  "A-": 11,
  "B+": 10,
  B: 9,
  "B-": 8,
  "C+": 7,
  C: 6,
  "C-": 5,
  "D+": 4,
  D: 3,
  "D-": 2,
  F: 1,
});

const TIER_RANK = Object.freeze({
  blockbuster: 100,
  landmark: 95,
  historic: 90,
  major: 80,
  notable: 70,
  moderate: 45,
  minor: 20,
});

function clean(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeGrade(value) {
  return clean(value).toUpperCase();
}

function gradeRank(value) {
  return GRADE_RANK[normalizeGrade(value)] ?? 0;
}

function formatWords(value) {
  return clean(value)
    .replace(/[_-]+/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export function formatNbaTeamName(slug = "", teams = []) {
  const normalized = clean(slug);
  const known = teams.find((team) => clean(team?.slug) === normalized);

  if (known?.name) return clean(known.name);

  return normalized
    .split("-")
    .filter(Boolean)
    .map((word) => {
      if (/^\d+ers$/u.test(word)) return word;
      if (word === "la") return "LA";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function perspectiveEntries(trade) {
  const value = trade?.perspectives;

  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === "object");
  }

  if (!value || typeof value !== "object") return [];

  if (
    clean(value.sourceTeam) ||
    clean(value.sourceTradeId) ||
    clean(value.sourcePerspectiveKey)
  ) {
    return [value];
  }

  return Object.values(value).filter(
    (entry) => entry && typeof entry === "object",
  );
}

function perspectiveScore(perspective) {
  let score = 0;

  if (clean(perspective?.contentClass) === "Public Candidate") score += 100;
  if (clean(perspective?.publicSlug)) score += 20;
  if (clean(perspective?.summary)) score += 15;
  if (clean(perspective?.analysis)) score += 10;
  if (perspective?.grades && typeof perspective.grades === "object") score += 8;
  if (/validated|reviewed|approved/iu.test(clean(perspective?.reviewStatus))) score += 5;
  if (perspective?.sourceImportAuthorized === true) score += 4;

  return score;
}

function displayPerspective(trade) {
  return perspectiveEntries(trade)
    .slice()
    .sort((left, right) => perspectiveScore(right) - perspectiveScore(left))[0] ?? null;
}

function gradeMap(trade, perspective) {
  const output = {};
  const sources = [trade?.grades, perspective?.grades];

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    for (const [team, grade] of Object.entries(source)) {
      if (team === "partnerAggregate") continue;
      const normalized = normalizeGrade(grade);
      if (normalized) output[team] = normalized;
    }
  }

  return output;
}

function summaryFor(trade, perspective) {
  return clean(perspective?.summary || trade?.summary);
}

function verdictFor(trade, perspective) {
  return clean(perspective?.verdict || trade?.verdict) || "Verdict pending";
}

function tierFor(trade, perspective) {
  return clean(
    perspective?.tradeTier ||
    trade?.tradeTier ||
    trade?.tier ||
    "notable",
  ).toLowerCase();
}

function outcomeScoreFor(trade, perspective) {
  const value = Number(
    perspective?.outcomeScore ?? trade?.outcomeScore ?? 0,
  );

  return Number.isFinite(value) ? value : 0;
}

function confidenceScore(perspective) {
  const value = clean(perspective?.confidence).toLowerCase();
  if (value === "high") return 8;
  if (value === "medium") return 4;
  return 0;
}

function gradeSpread(grades, teams) {
  const ranks = teams
    .map((team) => gradeRank(grades[team]))
    .filter((rank) => rank > 0);

  if (ranks.length < 2) return 0;
  return Math.max(...ranks) - Math.min(...ranks);
}

function featureScore(item) {
  const tier = TIER_RANK[item.tier] ?? 35;
  const playerAssets = (item.trade?.assetLedger ?? []).filter((asset) =>
    ["player", "rights", "draft_rights"].includes(clean(asset?.type).toLowerCase()),
  ).length;

  return (
    tier * 100 +
    gradeSpread(item.grades, item.teams) * 25 +
    Math.abs(item.outcomeScore) * 20 +
    Math.min(playerAssets, 8) * 4 +
    confidenceScore(item.perspective)
  );
}

function titleFor(item, teams) {
  const ledger = Array.isArray(item.trade?.assetLedger)
    ? item.trade.assetLedger
    : [];
  const preferredTypes = ["player", "rights", "draft_rights"];

  for (const type of preferredTypes) {
    const asset = ledger.find((entry) =>
      clean(entry?.type).toLowerCase() === type &&
      clean(entry?.displayText) &&
      clean(entry?.toTeam),
    );

    if (asset) {
      const assetText = clean(asset.displayText)
        .replace(/^rights to\s+/iu, "Rights to ");
      return `${assetText} to the ${formatNbaTeamName(asset.toTeam, teams)}`;
    }
  }

  const firstSentence = item.summary.split(/[.!?]/u)[0]?.trim();
  if (firstSentence && firstSentence.length <= 96) return firstSentence;

  return `${item.teams.map((team) => formatNbaTeamName(team, teams)).join(" / ")} trade`;
}

function itemForTrade(trade, teams) {
  const perspective = displayPerspective(trade);
  const tradeTeams = unique(
    (Array.isArray(trade?.teams) ? trade.teams : [])
      .map(clean),
  );
  const summary = summaryFor(trade, perspective);
  const grades = gradeMap(trade, perspective);
  const slug = clean(trade?.slug);
  const tradeDate = clean(trade?.tradeDate || trade?.date);
  const isPublicCandidate =
    clean(perspective?.contentClass) === "Public Candidate";

  const item = {
    trade,
    perspective,
    slug,
    tradeDate,
    teams: tradeTeams,
    summary,
    grades,
    verdict: verdictFor(trade, perspective),
    tier: tierFor(trade, perspective),
    outcomeScore: outcomeScoreFor(trade, perspective),
    isPublicCandidate,
  };

  item.title = titleFor(item, teams);
  item.featureScore = featureScore(item);
  item.year = /^\d{4}/u.test(tradeDate) ? tradeDate.slice(0, 4) : "NBA";
  item.eyebrow = `NBA \u00b7 ${item.year}`;
  item.featuredEyebrow = `${formatWords(item.tier)} \u00b7 ${item.year}`;

  return item;
}

function playerTradeCount(player) {
  const counts = [
    Array.isArray(player?.tradeIds) ? player.tradeIds.length : 0,
    Array.isArray(player?.canonicalTradeIds) ? player.canonicalTradeIds.length : 0,
    Array.isArray(player?.sourceTradeIds) ? player.sourceTradeIds.length : 0,
    Array.isArray(player?.tradeSlugs) ? player.tradeSlugs.length : 0,
    Number(player?.sourceTradeCount) || 0,
    Number(player?.referenceCount) || 0,
    Array.isArray(player?.relationshipReferences)
      ? unique(
          player.relationshipReferences.map(
            (entry) => clean(entry?.canonicalTradeId || entry?.tradeId),
          ),
        ).length
      : 0,
  ];

  return Math.max(...counts);
}

function playerNote(player, count) {
  const types = unique(
    (Array.isArray(player?.referenceTypes) ? player.referenceTypes : [])
      .map((value) => formatWords(value)),
  ).slice(0, 2);

  if (types.length) return types.join(" \u00b7 ");
  return `${count} linked NBA trade records`;
}

const FEATURED_TRADE_SLUG =
  "boston-celtics-2026-07-06-80b6858fc2d0";

function chooseFeaturedTrade(items) {
  const selected = items.find(
    (item) => item.slug === FEATURED_TRADE_SLUG,
  );

  if (!selected) {
    throw new Error(
      `The exact private Jaylen Brown feature record ${FEATURED_TRADE_SLUG} was not found in the displayable trade pool.`,
    );
  }

  if (selected.isPublicCandidate) {
    throw new Error(
      "The exact Jaylen Brown record unexpectedly became a Public Candidate; review classification before continuing.",
    );
  }

  selected.title =
    "Jaylen Brown to the Philadelphia 76ers";
  selected.privateHomepageFeature = true;

  return selected;
}
function stableRandomItem(items) {
  if (!items.length) return null;

  const seed = "tradeverdicts-nba-homepage"
    .split("")
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);

  return items[seed % items.length];
}

export function buildNbaHomepageModel({ trades, players, teams }) {
  if (!Array.isArray(trades) || !Array.isArray(players) || !Array.isArray(teams)) {
    throw new TypeError("NBA homepage model requires trades, players, and teams arrays.");
  }

  const canonicalTrades = trades.filter((trade) =>
    clean(trade?.slug) &&
    clean(trade?.tradeDate || trade?.date) &&
    Array.isArray(trade?.teams) &&
    trade.teams.length >= 2,
  );

  const displayable = canonicalTrades
    .map((trade) => itemForTrade(trade, teams))
    .filter((item) =>
      item.slug &&
      item.tradeDate &&
      item.teams.length >= 2 &&
      item.summary &&
      Object.keys(item.grades).filter((team) => item.teams.includes(team)).length >= 2,
    );

  const publicCandidates = displayable.filter(
    (item) => item.isPublicCandidate,
  );
  const homepageTrades = publicCandidates.length >= 5
    ? publicCandidates
    : displayable;

  if (homepageTrades.length < 5) {
    throw new Error(
      `NBA homepage needs at least five displayable trades; found ${homepageTrades.length}.`,
    );
  }

  const featuredTrade = chooseFeaturedTrade(
    displayable,
  );

  const recentVerdicts = homepageTrades
    .filter((item) => item.slug !== featuredTrade.slug)
    .slice()
    .sort((left, right) =>
      right.tradeDate.localeCompare(left.tradeDate) ||
      left.slug.localeCompare(right.slug),
    )
    .slice(0, 4);

  const mostTradedPlayers = players
    .map((player) => {
      const count = playerTradeCount(player);

      return {
        name: clean(player?.displayName || player?.name || player?.fullName),
        slug: clean(player?.slug),
        count,
        note: playerNote(player, count),
      };
    })
    .filter((player) => player.name && player.slug && player.count > 0)
    .sort((left, right) =>
      right.count - left.count ||
      left.name.localeCompare(right.name, "en"),
    )
    .slice(0, 8);

  const currentTeams = teams.filter((team) => team?.active === true);
  const currentTeamSlugs = new Set(currentTeams.map((team) => clean(team?.slug)));
  const representedCurrentTeams = new Set(
    canonicalTrades.flatMap((trade) =>
      trade.teams.filter((team) => currentTeamSlugs.has(clean(team))),
    ),
  );
  const currentTeamsTotal = currentTeams.length;
  const importedTeams = representedCurrentTeams.size;
  const coveragePercent = currentTeamsTotal
    ? Math.round((importedTeams / currentTeamsTotal) * 100)
    : 0;
  const randomTrade = stableRandomItem(homepageTrades);

  return {
    canonicalTradeCount: trades.length,
    canonicalPlayerCount: players.length,
    canonicalTeamCount: teams.length,
    currentTeamsTotal,
    importedTeams,
    coveragePercent,
    publicCandidateCount: publicCandidates.length,
    displayableTradeCount: displayable.length,
    publicCandidateFallbackUsed: publicCandidates.length < 5,
    featuredTrade,
    recentVerdicts,
    mostTradedPlayers,
    randomTrade,
    angleLinks: [
      {
        title: "All NBA trades",
        subtitle: "Full private archive",
        href: "/nba/trades/",
      },
      {
        title: "NBA teams",
        subtitle: "Current and historical",
        href: "/nba/teams/",
      },
      {
        title: "NBA players",
        subtitle: "Trade-history records",
        href: "/nba/players/",
      },
    ],
  };
}
