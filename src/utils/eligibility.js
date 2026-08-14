import {
  MARQUEE_TRADE_SLUG_SET,
  MARQUEE_TRADE_SLUGS,
} from "./marqueeTradeSlugs.js";

const NON_PUBLIC_TRADE_STATUSES = new Set([
  "suppressed",
  "hidden",
  "hold-conflict",
]);

const GENERIC_ANALYSIS_PHRASES = Object.freeze([
  "the grade spread supports",
  "produced the clearer recorded football value",
  "this remains a low-separation transaction",
  "the recorded outcomes support the existing",
  "the grades favor",
  "this trade tilts toward",
]);

export const MIN_EDITORIAL_ANALYSIS_WORDS = 150;

const ARCHIVE_ASSET_RE =
  /\b(?:undisclosed consideration|undisclosed compensation|undisclosed terms|undisclosed draft pick|not clearly specified|unknown asset|unspecified asset|no consideration recorded|no asset listed|raw source|player(?:\(s\))? to be named later|review needed|placeholder)\b/i;

const MALFORMED_TEAM_RE =
  /\b(?:multi-team|multiple-teams|as-player-to-be-named|as-compensation-for|to-complete-earlier|involving-|voided|cancelled|failed-physical|unknown-team)\b/i;

const COMPOSITE_TEAM_VALUES = new Set([
  "bills-rams",
  "cardinals-cowboys",
  "cardinals-rams",
  "cowboys-giants",
  "indianapolis-baltimore-colts-dallas-cowboys",
  "los-angeles-st-louis-rams-washington-commanders",
  "philadelphia-eagles-baltimore-ravens",
  "philadelphia-eagles-denver-broncos",
]);

const VALID_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const unique = (values) => [...new Set(values.filter(Boolean))];

const getWordCount = (value = "") =>
  String(value ?? "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;

const getPerspectiveCount = (value) => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    return Object.keys(value).length;
  }
  return 0;
};

export const STATIC_INDEXABLE_PATHS = Object.freeze([
  "/",
  "/about/",
  "/contact/",
  "/privacy-policy/",
  "/terms/",
  "/methodology/",
  "/corrections/",
  "/advertising/",
  "/faq/",
  "/teams/",
]);

export function createEligibilityContext(trades = []) {
  const analysisCounts = new Map();

  for (const trade of trades) {
    const analysis = String(trade?.analysis || "").trim();
    if (!analysis) continue;
    analysisCounts.set(analysis, (analysisCounts.get(analysis) || 0) + 1);
  }

  return Object.freeze({
    analysisCounts,
    marqueeTradeSlugs: MARQUEE_TRADE_SLUGS,
  });
}

export function isCurrentlyPublicTrade(trade) {
  if (!trade) return false;
  if (trade.suppressed === true) return false;
  if (trade.hidden === true) return false;
  if (trade.holdConflict === true) return false;

  const status = String(trade.publishStatus || "")
    .trim()
    .toLowerCase();

  return !NON_PUBLIC_TRADE_STATUSES.has(status);
}

export function getTradeEligibility(
  trade,
  context = createEligibilityContext([])
) {
  const slug = String(trade?.slug || "").trim();
  const status = String(trade?.publishStatus || "")
    .trim()
    .toLowerCase();

  const currentlyPublic = isCurrentlyPublicTrade(trade);
  const marquee = MARQUEE_TRADE_SLUG_SET.has(slug);

  const teams = Array.isArray(trade?.teams)
    ? trade.teams.map((team) => String(team || "").trim()).filter(Boolean)
    : [];

  const assets =
    trade?.assetsReceived && typeof trade.assetsReceived === "object"
      ? trade.assetsReceived
      : {};

  const grades =
    trade?.grades && typeof trade.grades === "object"
      ? trade.grades
      : {};

  const assetKeys = Object.keys(assets);
  const gradeKeys = Object.keys(grades);
  const summary = String(trade?.summary || "").trim();
  const verdict = String(trade?.verdict || "").trim();
  const analysis = String(trade?.analysis || "").trim();
  const analysisWordCount = getWordCount(analysis);
  const perspectiveCount = getPerspectiveCount(trade?.perspectives);

  const invalidReasons = [];
  const incompleteReasons = [];
  const archiveReasons = [];

  if (!slug || !VALID_SLUG_RE.test(slug)) {
    invalidReasons.push("invalid-slug");
  }

  if (teams.length < 2 || unique(teams).length !== teams.length) {
    invalidReasons.push("invalid-team-list");
  }

  for (const team of teams) {
    if (
      !VALID_SLUG_RE.test(team) ||
      MALFORMED_TEAM_RE.test(team) ||
      COMPOSITE_TEAM_VALUES.has(team)
    ) {
      invalidReasons.push("malformed-or-composite-team");
    }
  }

  const missingAssetTeams = teams.filter(
    (team) => !Array.isArray(assets[team]) || assets[team].length === 0
  );

  const extraAssetTeams = assetKeys.filter((team) => !teams.includes(team));

  const missingGradeTeams = teams.filter(
    (team) => !String(grades[team] || "").trim()
  );

  const extraGradeTeams = gradeKeys.filter((team) => !teams.includes(team));

  if (missingAssetTeams.length > 0) {
    incompleteReasons.push("missing-team-assets");
  }

  if (extraAssetTeams.length > 0) {
    incompleteReasons.push("extra-asset-team");
  }

  if (missingGradeTeams.length > 0) {
    incompleteReasons.push("missing-team-grade");
  }

  if (extraGradeTeams.length > 0) {
    incompleteReasons.push("extra-grade-team");
  }

  if (!summary) incompleteReasons.push("missing-summary");
  if (!verdict) incompleteReasons.push("missing-verdict");
  if (!analysis) incompleteReasons.push("missing-analysis");

  let archiveAssetCount = 0;

  for (const team of assetKeys) {
    for (const item of Array.isArray(assets[team]) ? assets[team] : []) {
      const asset = String(item?.asset || "").trim();

      if (!asset) {
        incompleteReasons.push("empty-asset");
      } else if (ARCHIVE_ASSET_RE.test(asset)) {
        archiveAssetCount++;
      }
    }
  }

  if (archiveAssetCount > 0) {
    archiveReasons.push("historically-incomplete-consideration");
  }

  const genericPhraseHits = GENERIC_ANALYSIS_PHRASES.filter((phrase) =>
    analysis.toLowerCase().includes(phrase)
  );

  const duplicateAnalysisCount = analysis
    ? context.analysisCounts?.get(analysis) || 0
    : 0;

  if (analysisWordCount < MIN_EDITORIAL_ANALYSIS_WORDS) {
    archiveReasons.push("analysis-below-150-words");
  }
  if (genericPhraseHits.length > 0) archiveReasons.push("generic-analysis");
  if (duplicateAnalysisCount > 1) {
    archiveReasons.push("exact-duplicate-analysis");
  }
  if (perspectiveCount < teams.length) {
    archiveReasons.push("insufficient-perspectives");
  }

  const uniqueInvalidReasons = unique(invalidReasons);
  const uniqueIncompleteReasons = unique(incompleteReasons);
  const uniqueArchiveReasons = unique(archiveReasons);

  let classification = "factual-archive";
  let validationStatus = "archive-valid";
  let indexEligible = false;
  let adEligible = false;

  if (!currentlyPublic) {
    classification = "suppressed";
    validationStatus = "suppressed";
  } else if (uniqueInvalidReasons.length > 0) {
    classification = "invalid";
    validationStatus = "manual-route-review-required";
  } else if (uniqueIncompleteReasons.length > 0) {
    classification = "incomplete";
    validationStatus = "manual-route-review-required";
  } else if (status === "provisional") {
    classification = "provisional";
    validationStatus = "provisional";
  } else if (marquee) {
    classification = "editorial-verdict";
    validationStatus = "marquee-preserved";
    indexEligible = true;
    adEligible = true;
  } else if (status === "ready" && uniqueArchiveReasons.length === 0) {
    classification = "editorial-verdict";
    validationStatus = "editorial-valid";
    indexEligible = true;
    adEligible = true;
  }

  return Object.freeze({
    slug,
    classification,
    publicRoute: currentlyPublic,
    indexEligible,
    adEligible,
    validationStatus,
    marquee,
    reasonCodes: unique([
      ...uniqueInvalidReasons,
      ...uniqueIncompleteReasons,
      ...uniqueArchiveReasons,
      marquee ? "marquee-preserved" : "",
    ]),
    invalidReasons: uniqueInvalidReasons,
    incompleteReasons: uniqueIncompleteReasons,
    archiveReasons: uniqueArchiveReasons,
    metrics: Object.freeze({
      analysisLength: analysis.length,
      analysisWordCount,
      minimumEditorialAnalysisWords: MIN_EDITORIAL_ANALYSIS_WORDS,
      duplicateAnalysisCount,
      genericPhraseHits,
      perspectiveCount,
      archiveAssetCount,
    }),
  });
}

export function getIndexEligibleTrades(trades = []) {
  const context = createEligibilityContext(trades);

  return trades.filter(
    (trade) => getTradeEligibility(trade, context).indexEligible
  );
}

export function getAdEligibleTrades(trades = []) {
  const context = createEligibilityContext(trades);

  return trades.filter(
    (trade) => getTradeEligibility(trade, context).adEligible
  );
}

export function isIndexEligibleTrade(trade, context) {
  return getTradeEligibility(trade, context).indexEligible;
}

export function isAdEligibleTrade(trade, context) {
  return getTradeEligibility(trade, context).adEligible;
}

export function isStaticPathIndexEligible(pathname) {
  return STATIC_INDEXABLE_PATHS.includes(pathname);
}
