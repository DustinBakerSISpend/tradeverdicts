import { buildPrivateRelationshipGraph } from "./build-private-relationship-graph.mjs";
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


const CURATED_BLOCKBUSTER_SLUGS = Object.freeze([
  "boston-celtics-2013-07-12-15ece16372e1",
  "los-angeles-clippers-trade-2019-07-10-0170",
  "los-angeles-lakers-trade-2008-02-01-0159",
  "san-antonio-spurs-trade-2018-07-18-0001",
  "boston-celtics-2007-07-31-8e1d0e379d22",
  "los-angeles-lakers-trade-2004-07-14-0150",
  "20230209-ff88bb87840a",
  "dallas-mavericks-trade-2025-02-02-0149",
  "los-angeles-lakers-trade-1975-06-16-0078",
  "los-angeles-lakers-trade-1968-07-09-0050",
  "denver-nuggets-trade-2011-02-22-0180",
  "20210116-656453a876f3",
  "milwaukee-bucks-trade-2003-02-20-0119",
]);

export const NBA_BLOCKBUSTER_RESEARCH_SOURCES = Object.freeze([
  {
    publisher: "Complex",
    title: "The 20 Biggest Trade Deadline Deals in NBA History",
    href: "https://www.complex.com/sports/a/aaron-mansfield/nba-trade-deadline-biggest-deals",
  },
  {
    publisher: "ESPN",
    title: "Ranking some of the biggest trades of the past two decades",
    href: "https://www.espn.com/nba/story/_/id/34277696/ranking-some-biggest-trades-two-decades-how-inform-kevin-durant-future",
  },
  {
    publisher: "CBS Sports",
    title: "Ranking the NBA's 25 best trades of the 21st century",
    href: "https://www.cbssports.com/nba/news/ranking-nbas-25-best-trades-of-21st-century-pau-sga-luka-among-title-winning-and-franchise-changing-deals/",
  },
  {
    publisher: "Bleacher Report",
    title: "10 Biggest Blockbuster Trades in NBA History",
    href: "https://bleacherreport.com/articles/1250593-10-biggest-blockbuster-trades-in-nba-history",
  },
  {
    publisher: "GiveMeSport",
    title: "10 Best Trades in NBA History",
    href: "https://www.givemesport.com/10-best-trades-in-nba-history-ranked/",
  },
  {
    publisher: "Associated Press",
    title: "Blockbuster trades that shaped the NBA",
    href: "https://apnews.com/article/nba-blockbuster-trades-5d8e48a8d34afeb929e6018ac887c67f",
  },
  {
    publisher: "USA Today",
    title: "Biggest trades in NBA history",
    href: "https://www.usatoday.com/story/sports/nba/2025/02/02/biggest-trades-nba-history-wilt-chamberlain-shaquille-oneal/78156359007/",
  },
]);

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


function playerNamesForTrade(trade) {
  const ledger = Array.isArray(trade?.assetLedger)
    ? trade.assetLedger
    : [];

  return unique(
    ledger
      .filter((asset) =>
        ["player", "rights", "draft_rights"].includes(
          clean(asset?.type).toLowerCase(),
        ),
      )
      .map((asset) =>
        clean(asset?.playerName || asset?.displayText)
          .replace(/^rights to\s+/iu, ""),
      ),
  ).slice(0, 5);
}

function partnerAggregateGrade(trade, perspective) {
  return normalizeGrade(
    trade?.grades?.partnerAggregate ||
    perspective?.grades?.partnerAggregate ||
    trade?.aggregatePartnerGrade ||
    perspective?.aggregatePartnerGrade,
  );
}

function gradeEntriesForItem(item, teams) {
  const entries = item.teams
    .map((team) => ({
      team,
      teamName: formatNbaTeamName(team, teams),
      grade: normalizeGrade(item.grades?.[team]),
      synthetic: false,
    }))
    .filter((entry) => gradeRank(entry.grade) > 0);

  const partnerGrade = partnerAggregateGrade(
    item.trade,
    item.perspective,
  );

  if (entries.length < 2 && gradeRank(partnerGrade) > 0) {
    entries.push({
      team: "partner-aggregate",
      teamName: "Partner side",
      grade: partnerGrade,
      synthetic: true,
    });
  }

  return entries;
}

function angleItemForTrade(trade, teams) {
  const item = itemForTrade(trade, teams);
  const gradeEntries = gradeEntriesForItem(item, teams);
  const gradeRanks = gradeEntries
    .map((entry) => gradeRank(entry.grade))
    .filter((rank) => rank > 0)
    .sort((left, right) => right - left);
  const sourceIndex = CURATED_BLOCKBUSTER_SLUGS.indexOf(item.slug);

  return {
    ...item,
    path: `/nba/trades/${item.slug}/`,
    keyPlayers: playerNamesForTrade(trade),
    gradeEntries,
    gradeSpread:
      gradeRanks.length >= 2
        ? gradeRanks[0] - gradeRanks.at(-1)
        : 0,
    bestGrade: gradeEntries
      .slice()
      .sort((left, right) =>
        gradeRank(right.grade) - gradeRank(left.grade),
      )[0]?.grade ?? "",
    worstGrade: gradeEntries
      .slice()
      .sort((left, right) =>
        gradeRank(left.grade) - gradeRank(right.grade),
      )[0]?.grade ?? "",
    sourceRecognized: sourceIndex >= 0,
    sourcePriority: sourceIndex >= 0
      ? CURATED_BLOCKBUSTER_SLUGS.length - sourceIndex
      : 0,
  };
}

function angleDateSort(left, right) {
  return (
    right.tradeDate.localeCompare(left.tradeDate) ||
    left.slug.localeCompare(right.slug)
  );
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
  item.keyPlayers = playerNamesForTrade(trade);
  item.year = /^\d{4}/u.test(tradeDate) ? tradeDate.slice(0, 4) : "NBA";
  item.eyebrow = `NBA \u00b7 ${item.year}`;
  item.featuredEyebrow = `${formatWords(item.tier)} \u00b7 ${item.year}`;

  return item;
}

const CAREER_REFERENCE_TYPES = new Set([
  "direct_player",
  "draft_rights",
]);

function canonicalCareerTradeIdsByPlayer(graph) {
  const output = new Map();

  for (const edge of [
    ...(graph?.edges?.playerTradeReference ?? []),
    ...(graph?.edges?.supplementalPlayerTrade ?? []),
  ]) {
    const playerId = clean(edge?.playerId);
    const tradeId = clean(edge?.canonicalTradeId);
    const referenceType = clean(edge?.referenceType);

    if (
      !playerId ||
      !tradeId ||
      !CAREER_REFERENCE_TYPES.has(referenceType)
    ) {
      continue;
    }

    if (!output.has(playerId)) {
      output.set(playerId, new Set());
    }

    output.get(playerId).add(tradeId);
  }

  return output;
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
      `The exact Celtics-76ers blockbuster ${FEATURED_TRADE_SLUG} was not found in the displayable trade pool.`,
    );
  }

  selected.title =
    "Jaylen Brown to Philadelphia for Paul George and Four Picks";
  selected.featuredEyebrow = "Blockbuster \u00b7 2026";
  selected.featuredContext =
    "Philadelphia landed Jaylen Brown while Boston exchanged its younger star for Paul George and four future draft assets.";
  selected.featuredVerdictLabel = "76ers Win";
  selected.sourceRecognized = true;

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
    .slice(0, 6);

  const relationshipGraph =
    buildPrivateRelationshipGraph({
      trades,
      players,
      teams,
    });

  const careerTradeIdsByPlayer =
    canonicalCareerTradeIdsByPlayer(relationshipGraph);

  const mostTradedPlayers = players
    .map((player) => {
      const playerId = clean(player?.id);
      const count =
        careerTradeIdsByPlayer.get(playerId)?.size ?? 0;

      return {
        ...player,
        name: clean(
          player?.displayName ||
          player?.name ||
          player?.fullName,
        ),
        slug: clean(player?.slug),
        count,
        note: "Canonical career trades",
      };
    })
    .filter((player) =>
      player.name &&
      player.slug &&
      player.count > 0,
    )
    .sort((left, right) =>
      right.count - left.count ||
      left.name.localeCompare(right.name, "en"),
    )
    .slice(0, 6);

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
        title: "Lopsided wins",
        subtitle: "Clear grade separation",
        href: "/nba/trades/lopsided-wins/",
      },
      {
        title: "Blockbusters",
        subtitle: "Franchise-changing deals",
        href: "/nba/trades/blockbusters/",
      },
      {
        title: "Disasters",
        subtitle: "The costliest outcomes",
        href: "/nba/trades/disasters/",
      },
    ],
  };
}


export function buildNbaAngleCollections({ trades, teams }) {
  if (!Array.isArray(trades) || !Array.isArray(teams)) {
    throw new TypeError(
      "NBA angle collections require trades and teams arrays.",
    );
  }

  const items = trades
    .filter((trade) =>
      clean(trade?.slug) &&
      clean(trade?.tradeDate || trade?.date) &&
      Array.isArray(trade?.teams) &&
      trade.teams.length >= 2,
    )
    .map((trade) => angleItemForTrade(trade, teams))
    .filter((item) => item.slug && item.tradeDate && item.summary);

  const gradedItems = items.filter(
    (item) => item.gradeEntries.length >= 2,
  );

  const lopsidedWins = gradedItems
    .filter((item) => item.gradeSpread >= 4)
    .sort(angleDateSort)
    .slice(0, 60);

  const disasters = gradedItems
    .filter((item) =>
      gradeRank(item.bestGrade) >= gradeRank("B+") &&
      gradeRank(item.worstGrade) <= gradeRank("D+") &&
      item.gradeSpread >= 5,
    )
    .sort(angleDateSort)
    .slice(0, 60);

  const blockbusters = items
    .filter((item) =>
      item.sourceRecognized ||
      ["blockbuster", "landmark", "historic"].includes(item.tier),
    )
    .sort(angleDateSort)
    .slice(0, 60);

  return {
    lopsidedWins,
    blockbusters,
    disasters,
    counts: {
      lopsidedWins: lopsidedWins.length,
      blockbusters: blockbusters.length,
      disasters: disasters.length,
    },
  };
}
