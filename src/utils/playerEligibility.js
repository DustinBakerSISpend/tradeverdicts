import {
  createEligibilityContext,
  getTradeEligibility,
} from "./eligibility.js";
import {
  getRelatedPublicTrades,
  isPublicPlayerRecord,
} from "./publicRecords.js";

const MANUAL_REVIEW_CLASSIFICATIONS = new Set([
  "invalid",
  "incomplete",
]);

const INDEX_QUALITY_PLAYER_NAME_RE =
  /\b(?:unknown|unspecified|player to be named|see raw|multi[- ]team|future considerations?|draft rights?|conditional (?:pick|selection)|round pick|rights to)\b/iu;

const getIndexQualityIdentityReasons = (player) => {
  const name = String(player?.name || "").trim();
  const reasons = [];

  if (!name) reasons.push("blank-player-name");
  if (INDEX_QUALITY_PLAYER_NAME_RE.test(name)) {
    reasons.push("mechanism-or-placeholder-player-name");
  }
  if (name.includes("/")) {
    reasons.push("composite-alias-player-name");
  }
  if (name.length > 70) {
    reasons.push("very-long-player-name");
  }
  if (name.split(/\s+/u).filter(Boolean).length >= 8) {
    reasons.push("many-token-player-name");
  }
  if (/\([a-z]\)\s*$/iu.test(name)) {
    reasons.push("footnote-suffix-player-name");
  }
  if (/^\d+$/u.test(name)) {
    reasons.push("numeric-player-name");
  }

  return [...new Set(reasons)];
};

const getTradeYear = (trade) => {
  const dateYear = Number(
    String(trade?.tradeDate || "").slice(0, 4)
  );
  const seasonYear = Number(trade?.season);

  if (Number.isFinite(dateYear)) return dateYear;
  if (Number.isFinite(seasonYear)) return seasonYear;
  return null;
};

const getTradeSignature = (relatedTrades = []) =>
  relatedTrades
    .map((trade) => String(trade?.slug || "").trim())
    .filter(Boolean)
    .sort()
    .join("|");

const getAggregationMetrics = (relatedTrades = []) => {
  const years = relatedTrades
    .map(getTradeYear)
    .filter((year) => year !== null);

  const teamSlugs = new Set(
    relatedTrades.flatMap((trade) =>
      Array.isArray(trade?.teams)
        ? trade.teams.filter(Boolean)
        : []
    )
  );

  const distinctYearCount = new Set(years).size;
  const firstYear =
    years.length > 0 ? Math.min(...years) : null;
  const lastYear =
    years.length > 0 ? Math.max(...years) : null;
  const yearSpan =
    firstYear !== null && lastYear !== null
      ? lastYear - firstYear
      : 0;

  let valueTier = "two-trade-narrow";

  if (relatedTrades.length >= 4) {
    valueTier = "four-plus-trade-aggregation";
  } else if (relatedTrades.length === 3) {
    valueTier = "three-trade-aggregation";
  } else if (
    relatedTrades.length === 2 &&
    (
      distinctYearCount >= 2 ||
      teamSlugs.size >= 3 ||
      yearSpan >= 2
    )
  ) {
    valueTier = "two-trade-diverse";
  }

  return Object.freeze({
    distinctYearCount,
    distinctTeamCount: teamSlugs.size,
    firstYear,
    lastYear,
    yearSpan,
    valueTier,
  });
};

export function createPlayerEligibilityContext(
  players = [],
  publicTrades = [],
  tradeContext = createEligibilityContext(publicTrades)
) {
  const signatureCounts = new Map();
  const playerSignatures = new Map();

  for (const player of players) {
    const relatedTrades = getRelatedPublicTrades(
      player,
      publicTrades
    );

    const signature = getTradeSignature(relatedTrades);
    const slug = String(player?.slug || "").trim();

    if (slug) {
      playerSignatures.set(slug, signature);
    }

    if (relatedTrades.length >= 2 && signature) {
      signatureCounts.set(
        signature,
        (signatureCounts.get(signature) || 0) + 1
      );
    }
  }

  return Object.freeze({
    tradeContext,
    signatureCounts,
    playerSignatures,
  });
}

const normalizePlayerContext = (
  player,
  publicTrades,
  playerContext
) => {
  if (
    playerContext?.tradeContext &&
    playerContext?.signatureCounts instanceof Map &&
    playerContext?.playerSignatures instanceof Map
  ) {
    return playerContext;
  }

  return createPlayerEligibilityContext(
    [player],
    publicTrades,
    playerContext || createEligibilityContext(publicTrades)
  );
};

export function getPlayerEligibility(
  player,
  publicTrades = [],
  playerContext = createPlayerEligibilityContext(
    [player],
    publicTrades
  )
) {
  const context = normalizePlayerContext(
    player,
    publicTrades,
    playerContext
  );

  const relatedTrades = getRelatedPublicTrades(
    player,
    publicTrades
  );

  const publicRoute =
    isPublicPlayerRecord(player) &&
    relatedTrades.length > 0;

  const identityQualityReasons =
    getIndexQualityIdentityReasons(player);

  const tradeRows = relatedTrades.map((trade) => ({
    trade,
    eligibility: getTradeEligibility(
      trade,
      context.tradeContext
    ),
  }));

  const eligibleTradeCount = tradeRows.filter(
    ({ eligibility }) =>
      eligibility.indexEligible &&
      eligibility.adEligible
  ).length;

  const manualReviewTradeCount = tradeRows.filter(
    ({ eligibility }) =>
      MANUAL_REVIEW_CLASSIFICATIONS.has(
        eligibility.classification
      )
  ).length;

  const factualArchiveTradeCount = tradeRows.filter(
    ({ eligibility }) =>
      eligibility.classification === "factual-archive"
  ).length;

  const aggregation = getAggregationMetrics(
    relatedTrades
  );

  const tradeSignature =
    context.playerSignatures.get(
      String(player?.slug || "").trim()
    ) || getTradeSignature(relatedTrades);

  const tradeSignatureGroupSize =
    tradeSignature
      ? context.signatureCounts.get(tradeSignature) || 1
      : 1;

  const sharedTradeSignature =
    tradeSignatureGroupSize > 1;

  const wave2ValueReady =
    relatedTrades.length >= 2 &&
    aggregation.valueTier !== "two-trade-narrow" &&
    !sharedTradeSignature;

  const editorialDensityReady =
    eligibleTradeCount >= 2 ||
    (
      eligibleTradeCount >= 1 &&
      relatedTrades.length >= 3
    );

  let classification = "nonpublic-player";
  let validationStatus = "nonpublic-player";
  let rolloutWave = "hold";
  let indexEligible = false;
  let adEligible = false;

  if (!publicRoute) {
    classification = "nonpublic-player";
    validationStatus = "nonpublic-player";
  } else if (identityQualityReasons.length > 0) {
    classification = "player-identity-quality-review";
    validationStatus = "identity-quality-review-required";
    rolloutWave = "identity-review";
  } else if (
    relatedTrades.length >= 2 &&
    manualReviewTradeCount === 0 &&
    eligibleTradeCount > 0 &&
    editorialDensityReady
  ) {
    classification = "editorial-player-aggregation";
    validationStatus = "adsense-core-eligible";
    rolloutWave = "adsense-core";
    indexEligible = true;
    adEligible = true;
  } else if (
    relatedTrades.length >= 2 &&
    manualReviewTradeCount > 0
  ) {
    classification = "player-manual-quality-review";
    validationStatus = "manual-quality-review-required";
    rolloutWave = "manual-review";
  } else if (
    relatedTrades.length >= 2 &&
    eligibleTradeCount > 0
  ) {
    classification = "editorial-player-aggregation-review";
    validationStatus = "insufficient-editorial-density";
    rolloutWave = "editorial-density-review";
  } else if (
    relatedTrades.length >= 2 &&
    wave2ValueReady
  ) {
    classification = "historical-player-aggregation";
    validationStatus = "historical-aggregation-held";
    rolloutWave = "wave-2-hold";
  } else if (relatedTrades.length >= 2) {
    classification =
      "historical-player-aggregation-review";
    validationStatus = sharedTradeSignature
      ? "shared-trade-signature-review"
      : "narrow-two-trade-review";
    rolloutWave = "wave-2-review";
  } else if (eligibleTradeCount === 1) {
    classification = "one-trade-editorial-profile";
    validationStatus = "one-trade-duplicate-value-review";
    rolloutWave = "later-one-trade-review";
  } else if (manualReviewTradeCount > 0) {
    classification = "one-trade-manual-quality-review";
    validationStatus = "manual-quality-review-required";
  } else {
    classification = "one-trade-factual-archive";
    validationStatus = "hold-one-trade-archive";
  }

  return Object.freeze({
    slug: String(player?.slug || "").trim(),
    classification,
    publicRoute,
    indexEligible,
    adEligible,
    validationStatus,
    rolloutWave,
    metrics: Object.freeze({
      relationshipCount: relatedTrades.length,
      eligibleTradeCount,
      factualArchiveTradeCount,
      manualReviewTradeCount,
      distinctYearCount: aggregation.distinctYearCount,
      distinctTeamCount: aggregation.distinctTeamCount,
      firstYear: aggregation.firstYear,
      lastYear: aggregation.lastYear,
      yearSpan: aggregation.yearSpan,
      valueTier: aggregation.valueTier,
      tradeSignatureGroupSize,
      sharedTradeSignature,
      editorialDensityReady,
      identityQualityReasons: Object.freeze(
        [...identityQualityReasons]
      ),
    }),
    relatedTradeSlugs: Object.freeze(
      relatedTrades.map((trade) => trade.slug)
    ),
  });
}

export function getIndexEligiblePlayers(
  players = [],
  publicTrades = [],
  playerContext = createPlayerEligibilityContext(
    players,
    publicTrades
  )
) {
  return players.filter(
    (player) =>
      getPlayerEligibility(
        player,
        publicTrades,
        playerContext
      ).indexEligible
  );
}

export function getAdEligiblePlayers(
  players = [],
  publicTrades = [],
  playerContext = createPlayerEligibilityContext(
    players,
    publicTrades
  )
) {
  return players.filter(
    (player) =>
      getPlayerEligibility(
        player,
        publicTrades,
        playerContext
      ).adEligible
  );
}
