import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createEligibilityContext,
  getTradeEligibility,
  STATIC_INDEXABLE_PATHS,
} from "../../src/utils/eligibility.js";
import {
  getPublicPlayerRecords,
  getPublicTrades,
  getRelatedPublicTrades,
  isPublicPlayerRecord,
} from "../../src/utils/publicRecords.js";
import {
  createPlayerEligibilityContext,
  getPlayerEligibility,
} from "../../src/utils/playerEligibility.js";
import { MARQUEE_TRADE_SLUGS } from "../../src/utils/marqueeTradeSlugs.js";
import { ADS_SERVING_ENABLED } from "../../src/config/ads.js";

// Assertion contract only. Does not modify records, renderer, eligibility helpers,
// public routes, ads, or sitemap policy. Keep the original report and exit contract.
const statusOf = trade => String(trade?.publishStatus || "").trim().toLowerCase();
const sameArray = (left, right) => Array.isArray(left) &&
  left.length === right.length && left.every((value,index) => value === right[index]);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
export function tradeChecks(trade, e, marquee) {
  const errors = [], ck = (ok, key) => { if (!ok) errors.push(key); };
  if (!isRecord(e) || !["invalidReasons","incompleteReasons","archiveReasons","reasonCodes"].every(k=>Array.isArray(e[k]))) return ["malformed-trade-result"];
  const status = statusOf(trade);
  const slug = String(trade?.slug || "").trim();
  const marked = marquee.has(slug);
  const publicRoute = !trade.suppressed && !trade.hidden && !trade.holdConflict &&
    !["suppressed","hidden","hold-conflict"].includes(status);
  const index = publicRoute && e.invalidReasons.length === 0 && e.incompleteReasons.length === 0 &&
    status !== "provisional" && (marked || status === "ready");
  const ad = index && (marked || e.archiveReasons.length === 0);
  ck(e.slug === slug,"trade-slug");
  ck(e.publicRoute === publicRoute,"trade-public-route");
  ck(e.indexEligible === index,"trade-index");
  ck(e.adEligible === ad,"trade-ad");
  ck(e.marquee === marked,"marquee-membership");
  ck(!e.adEligible || e.indexEligible,"ad-subset-index");
  ck(!e.indexEligible || e.publicRoute,"index-subset-public");
  ck(!e.indexEligible || ["editorial-verdict","factual-archive"].includes(e.classification),"trade-class");
  ck(!e.adEligible || e.classification === "editorial-verdict","editorial-ad-only");
  ck(e.classification !== "factual-archive" || !e.adEligible,"factual-archive-ad-free");
  ck(!e.marquee || (e.classification === "editorial-verdict" && e.indexEligible && e.adEligible),"marquee-invariants");
  ck(!index || e.classification === (ad ? "editorial-verdict" : "factual-archive"),"trade-class-index-consistency");
  let classification = "factual-archive", validation = "archive-valid";
  if (!publicRoute) { classification="suppressed"; validation="suppressed"; }
  else if (e.invalidReasons.length) {classification="invalid";validation="manual-route-review-required";}
  else if (e.incompleteReasons.length) {classification="incomplete";validation="manual-route-review-required";}
  else if (status === "provisional") {classification="provisional";validation="provisional";}
  else if (marked) {classification="editorial-verdict";validation="marquee-preserved";}
  else if (status === "ready") {
    classification=e.archiveReasons.length?"factual-archive":"editorial-verdict";
    validation=e.archiveReasons.length?"archive-valid-indexable":"editorial-valid";
  }
  ck(e.classification===classification,"trade-class-exact");
  ck(e.validationStatus===validation,"trade-validation-status");
  return errors;
}
export function playerChecks(player, e, tradeMap, expectedRelated) {
  const errors=[], ck=(ok,key)=>{if(!ok)errors.push(key);};
  if (!isRecord(e) || !isRecord(e.metrics) || !Array.isArray(e.metrics.identityQualityReasons) ||
      !Array.isArray(e.relatedTradeSlugs) || !Array.isArray(expectedRelated)) return ["malformed-player-result"];
  const m=e.metrics, related=e.relatedTradeSlugs;
  const expectedPublic=isPublicPlayerRecord(player)&&expectedRelated.length>0;
  ck(e.slug===String(player?.slug||"").trim(),"player-slug");
  ck(e.publicRoute===expectedPublic,"player-public-route");
  ck(sameArray(related,expectedRelated),"exact-related-trade-slugs");
  const relatedRows=related.map(slug=>tradeMap.get(slug));
  ck(related.length===m.relationshipCount && new Set(related).size===related.length &&
    relatedRows.every(row=>row?.publicRoute===true),"relationship-count-unique-public");
  const expectedRows=expectedRelated.map(slug=>tradeMap.get(slug));
  const n=expectedRelated.length;
  const indexable=expectedRows.filter(row=>row?.indexEligible===true).length;
  const eligible=expectedRows.filter(row=>row?.indexEligible===true&&row?.adEligible===true).length;
  const archive=expectedRows.filter(row=>row?.classification==="factual-archive").length;
  const manual=expectedRows.filter(row=>["invalid","incomplete"].includes(row?.classification)).length;
  ck(m.indexableTradeCount===indexable && m.eligibleTradeCount===eligible &&
    m.factualArchiveTradeCount===archive && m.manualReviewTradeCount===manual,"relation-metrics-recomputed");
  ck(m.eligibleTradeCount<=m.indexableTradeCount&&m.indexableTradeCount<=m.relationshipCount,"player-metric-counts");
  const dense=eligible>=2||(eligible>=1&&n>=3);
  ck(m.editorialDensityReady===dense,"density");
  const valid=expectedPublic&&n>0&&m.identityQualityReasons.length===0&&manual===0&&indexable>0;
  const core=valid&&n>=2&&eligible>0&&dense;
  ck(e.indexEligible===valid,"player-index");
  ck(e.adEligible===core,"player-ad");
  ck(!e.adEligible||e.indexEligible,"ad-subset-index");
  ck(!e.indexEligible||e.publicRoute,"index-subset-public");
  ck(!e.adEligible||(e.rolloutWave==="search-core"&&e.classification==="editorial-player-aggregation"),"core-ad-only");
  ck(!e.indexEligible||e.rolloutWave===(core?"search-core":"search-index"),"player-index-wave");
  ck(e.rolloutWave!=="search-index"||(e.indexEligible&&!e.adEligible),"index-only-wave");
  ck(e.rolloutWave!=="identity-review"||(!e.indexEligible&&!e.adEligible&&m.identityQualityReasons.length>0),"identity-review-protected");
  ck(!e.indexEligible||m.manualReviewTradeCount===0,"manual-review-protected");
  ck(n!==1||!e.adEligible,"one-trade-ad-free");
  let classification="nonpublic-player", validation="nonpublic-player", wave="hold";
  if (!expectedPublic) {}
  else if (m.identityQualityReasons.length) {
    classification="player-identity-quality-review";validation="identity-quality-review-required";wave="identity-review";
  } else if (n>=2&&!manual&&eligible>0&&dense) {
    classification="editorial-player-aggregation";validation="search-core-eligible";wave="search-core";
  } else if (n>=2&&manual>0) {
    classification="player-manual-quality-review";validation="manual-quality-review-required";wave="manual-review";
  } else if (n>=2&&eligible>0) {
    classification="editorial-player-aggregation-review";validation="insufficient-editorial-density";wave="editorial-density-review";
  } else if(n>=2&&m.valueTier!=="two-trade-narrow"&&!m.sharedTradeSignature) {
    classification="historical-player-aggregation";validation="historical-aggregation-held";wave="wave-2-hold";
  } else if(n>=2) {
    classification="historical-player-aggregation-review";validation=m.sharedTradeSignature?"shared-trade-signature-review":"narrow-two-trade-review";wave="wave-2-review";
  } else if(eligible===1) {
    classification="one-trade-editorial-profile";validation="one-trade-duplicate-value-review";wave="later-one-trade-review";
  } else if(manual>0) {
    classification="one-trade-manual-quality-review";validation="manual-quality-review-required";
  } else {
    classification="one-trade-factual-archive";validation="hold-one-trade-archive";
  }
  if(valid) {
    if(n===1){validation=archive>0?"search-indexable-one-trade-archive":"search-indexable-one-trade-profile";wave="search-index";}
    else if(validation!=="search-core-eligible"){validation="search-indexable-player-aggregation";wave="search-index";}
  }
  ck(e.classification===classification,"player-class-exact");
  ck(e.validationStatus===validation,"player-validation-status");
  ck(e.rolloutWave===wave,"player-wave-exact");
  return errors;
}
// Exports are testable without running the CLI or writing a report.
function main() {

const repo = process.cwd();
const outputPath = process.argv[2];

if (!outputPath) {
  throw new Error("An output JSON path is required.");
}

const readJson = (relativePath) =>
  JSON.parse(
    fs
      .readFileSync(path.join(repo, relativePath), "utf8")
      .replace(/^\uFEFF/, "")
  );

const trades = readJson("src/data/nfl/trades.json");
const players = readJson("src/data/nfl/players.json");

const context = createEligibilityContext(trades);
const rows = trades.map((trade) => ({
  trade,
  eligibility: getTradeEligibility(trade, context),
}));

const publicTrades = getPublicTrades(trades);
const publicPlayers = getPublicPlayerRecords(
  players,
  publicTrades
);
const playerContext = createPlayerEligibilityContext(
  publicPlayers,
  publicTrades,
  context
);

const playerRows = publicPlayers.map((player) => ({
  player,
  eligibility: getPlayerEligibility(
    player,
    publicTrades,
    playerContext
  ),
}));

const errors = [];
const warnings = [];
const tradeSlugSet = new Set(
  trades.map((trade) => trade.slug).filter(Boolean)
);
const uniqueMarqueeSlugs = new Set(MARQUEE_TRADE_SLUGS);

if (MARQUEE_TRADE_SLUGS.length !== 52) {
  errors.push(
    `Expected 52 marquee slugs; found ${MARQUEE_TRADE_SLUGS.length}.`
  );
}

if (uniqueMarqueeSlugs.size !== 52) {
  errors.push(
    `Expected 52 unique marquee slugs; found ${uniqueMarqueeSlugs.size}.`
  );
}

const missingMarqueeSlugs = MARQUEE_TRADE_SLUGS.filter(
  (slug) => !tradeSlugSet.has(slug)
);

if (missingMarqueeSlugs.length > 0) {
  errors.push(
    `Missing ${missingMarqueeSlugs.length} marquee trade records.`
  );
}

const tradeMap = new Map(rows.map(({trade,eligibility}) => [trade.slug,eligibility]));
if (tradeMap.size !== rows.length) errors.push("Duplicate trade slugs in validator input.");
for (const {trade,eligibility} of rows) {
  for (const violation of tradeChecks(trade, eligibility, uniqueMarqueeSlugs)) {
    errors.push(trade.slug + ": " + violation);
  }
}
for (const {player,eligibility} of playerRows) {
  const expectedRelated = getRelatedPublicTrades(player,publicTrades).map(trade=>trade.slug);
  for (const violation of playerChecks(player,eligibility,tradeMap,expectedRelated)) {
    errors.push(player.slug + ": " + violation);
  }
}

const marqueeRows = rows.filter(
  ({ eligibility }) => eligibility.marquee
);

if (marqueeRows.length !== 52) {
  errors.push(
    `Expected 52 classified marquee rows; found ${marqueeRows.length}.`
  );
}

const eligiblePlayerRows = playerRows.filter(
  ({ eligibility }) => eligibility.indexEligible
);
const adEligiblePlayerRows = playerRows.filter(
  ({ eligibility }) => eligibility.adEligible
);
const eligiblePlayerSlugSet = new Set(
  eligiblePlayerRows.map(({ player }) => player.slug)
);
const adEligiblePlayerSlugSet = new Set(
  adEligiblePlayerRows.map(({ player }) => player.slug)
);

const allPlayerSlugs = new Set(playerRows.map(({player})=>player.slug));
const coreRows = playerRows.filter(({eligibility})=>eligibility.rolloutWave==="search-core");
const searchIndexRows = playerRows.filter(({eligibility})=>eligibility.rolloutWave==="search-index");
const coreSet = new Set(coreRows.map(({player})=>player.slug));
const searchIndexSet = new Set(searchIndexRows.map(({player})=>player.slug));
const sameSet = (a,b) => a.size===b.size && [...a].every(slug=>b.has(slug));
if(allPlayerSlugs.size!==playerRows.length || eligiblePlayerSlugSet.size!==eligiblePlayerRows.length ||
   adEligiblePlayerSlugSet.size!==adEligiblePlayerRows.length) errors.push("Duplicate player slugs in public or eligibility sets.");
if([...adEligiblePlayerSlugSet].some(slug=>!eligiblePlayerSlugSet.has(slug))) errors.push("Player ad eligibility is not a subset of index eligibility.");
if([...coreSet].some(slug=>searchIndexSet.has(slug)) ||
   !sameSet(adEligiblePlayerSlugSet,coreSet) ||
   !sameSet(eligiblePlayerSlugSet,new Set([...coreSet,...searchIndexSet]))) {
  errors.push("Player eligible sets do not match disjoint search-core/search-index partition.");
}

const countBy = (collection, property) =>
  Object.fromEntries(
    [
      ...new Set(
        collection.map(({ eligibility }) =>
          eligibility[property]
        )
      ),
    ]
      .sort()
      .map((value) => [
        String(value),
        collection.filter(
          ({ eligibility }) =>
            eligibility[property] === value
        ).length,
      ])
  );

const reasonCounts = new Map();

for (const { eligibility } of rows) {
  for (const reason of eligibility.reasonCodes) {
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }
}

const indexEligibleTradeCount = rows.filter(
  ({ eligibility }) => eligibility.indexEligible
).length;
const indexEligiblePlayerCount = eligiblePlayerRows.length;

const report = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASSED" : "FAILED",
  adsServingEnabled: ADS_SERVING_ENABLED,
  marquee: {
    expected: 52,
    configured: MARQUEE_TRADE_SLUGS.length,
    unique: uniqueMarqueeSlugs.size,
    matched: marqueeRows.length,
    missingSlugs: missingMarqueeSlugs,
  },
  trades: {
    total: rows.length,
    classificationCounts: countBy(rows, "classification"),
    publicRouteCount: rows.filter(
      ({ eligibility }) => eligibility.publicRoute
    ).length,
    indexEligibleCount: indexEligibleTradeCount,
    adEligibleCount: rows.filter(
      ({ eligibility }) => eligibility.adEligible
    ).length,
    manualRouteReviewCount: rows.filter(
      ({ eligibility }) =>
        eligibility.validationStatus ===
        "manual-route-review-required"
    ).length,
  },
  players: {
    totalRecords: players.length,
    publicRouteCount: playerRows.length,
    classificationCounts: countBy(
      playerRows,
      "classification"
    ),
    rolloutWaveCounts: countBy(
      playerRows,
      "rolloutWave"
    ),
    indexEligibleCount: indexEligiblePlayerCount,
    adEligibleCount: playerRows.filter(
      ({ eligibility }) => eligibility.adEligible
    ).length,
    heldRouteCount:
      playerRows.length - indexEligiblePlayerCount,
  },
  sitemapPlan: {
    staticIndexablePaths: STATIC_INDEXABLE_PATHS,
    indexableTradeRouteCount: indexEligibleTradeCount,
    indexablePlayerRouteCount: indexEligiblePlayerCount,
    plannedHtmlUrlCount:
      STATIC_INDEXABLE_PATHS.length +
      indexEligibleTradeCount +
      indexEligiblePlayerCount,
  },
  reasonCounts: Object.fromEntries(
    [...reasonCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )
  ),
  errors,
  warnings,
  notes: [
    "Public trade and player route closure is preserved in this batch.",
    "Search-core players are index and ad eligible; search-index players are index-only and ad-free.",
    "Counts: " + coreRows.length + " search-core; " + searchIndexRows.length + " search-index; " +
      (playerRows.length-indexEligiblePlayerCount) + " held public player routes.",
    "The remaining held public player routes are noindex and ad-free.",
    "plannedHtmlUrlCount is the static + trade + player subtotal, not the entire site sitemap.",
    "No advertising can load while ADS_SERVING_ENABLED is false.",
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);

if (errors.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
