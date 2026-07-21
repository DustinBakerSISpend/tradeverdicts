import fs from "node:fs";
import path from "node:path";
import {
  createEligibilityContext,
} from "../../src/utils/eligibility.js";
import {
  getPublicPlayerRecords,
  getPublicTrades,
  getRelatedPublicTrades,
} from "../../src/utils/publicRecords.js";
import {
  createPlayerEligibilityContext,
  getPlayerEligibility,
} from "../../src/utils/playerEligibility.js";
import {
  createPlayerDirectoryRows,
  getPlayerDirectoryPage,
  getPlayerDirectoryTotalPages,
  PLAYER_DIRECTORY_PAGE_SIZE,
} from "../../src/utils/playerDirectory.js";

const repo = process.cwd();
const outputPath = process.argv[2];

const readJson = (relativePath) =>
  JSON.parse(
    fs
      .readFileSync(path.join(repo, relativePath), "utf8")
      .replace(/^\uFEFF/, "")
  );

const readSource = (relativePath) =>
  fs.readFileSync(path.join(repo, relativePath), "utf8");

const players = readJson("src/data/nfl/players.json");
const trades = readJson("src/data/nfl/trades.json");
const publicTrades = getPublicTrades(trades);
const publicPlayers = getPublicPlayerRecords(players, publicTrades);
const tradeContext = createEligibilityContext(trades);
const playerContext = createPlayerEligibilityContext(
  publicPlayers,
  publicTrades,
  tradeContext
);
const playerEligibilityRows = publicPlayers.map((player) => ({
  player,
  eligibility: getPlayerEligibility(
    player,
    publicTrades,
    playerContext
  ),
}));
const directoryRows = createPlayerDirectoryRows(players, trades);
const totalPages = getPlayerDirectoryTotalPages(directoryRows);

const detailSource = readSource("src/pages/players/[player].astro");
const indexSource = readSource("src/pages/players/index.astro");
const pageSource = readSource("src/pages/players/page/[page].astro");
const componentSource = readSource(
  "src/components/PlayerDirectoryPage.astro"
);
const endpointSource = readSource(
  "src/pages/api/player-search.json.js"
);
const layoutSource = readSource("src/layouts/BaseLayout.astro");
const astroConfigSource = readSource("astro.config.mjs");

const errors = [];
const warnings = [];

if (players.length !== 7125) {
  errors.push(`Expected 7,125 player records; found ${players.length}.`);
}
if (publicTrades.length !== 4991) {
  errors.push(`Expected 4,991 public trades; found ${publicTrades.length}.`);
}
if (publicPlayers.length !== 6778) {
  errors.push(`Expected 6,778 public player routes; found ${publicPlayers.length}.`);
}
if (directoryRows.length !== 6778) {
  errors.push(`Expected 6,778 directory rows; found ${directoryRows.length}.`);
}
if (PLAYER_DIRECTORY_PAGE_SIZE !== 120) {
  errors.push(`Expected page size 120; found ${PLAYER_DIRECTORY_PAGE_SIZE}.`);
}
if (totalPages !== 57) {
  errors.push(`Expected 57 directory pages; found ${totalPages}.`);
}

const pagedRows = Array.from(
  { length: totalPages },
  (_, index) => getPlayerDirectoryPage(directoryRows, index + 1)
).flat();

if (pagedRows.length !== directoryRows.length) {
  errors.push("Paginated directory row count does not close.");
}
if (new Set(pagedRows.map((row) => row.slug)).size !== directoryRows.length) {
  errors.push("Paginated directory contains duplicate player slugs.");
}

const publicSlugSet = new Set(publicPlayers.map((player) => player.slug));

if (directoryRows.some((row) => !publicSlugSet.has(row.slug))) {
  errors.push("Directory contains a nonpublic player route.");
}
if (
  publicPlayers.some(
    (player) =>
      getRelatedPublicTrades(player, publicTrades).length === 0
  )
) {
  errors.push("A public player has zero exact public relationships.");
}

const eligiblePlayers = playerEligibilityRows.filter(
  ({ eligibility }) => eligibility.indexEligible
);
const adEligiblePlayers = playerEligibilityRows.filter(
  ({ eligibility }) => eligibility.adEligible
);
const wave1Players = playerEligibilityRows.filter(
  ({ eligibility }) => eligibility.rolloutWave === "wave-1"
);
const wave2Players = playerEligibilityRows.filter(
  ({ eligibility }) => eligibility.rolloutWave === "wave-2"
);
const wave2ReviewPlayers = playerEligibilityRows.filter(
  ({ eligibility }) => eligibility.rolloutWave === "wave-2-review"
);

const eligiblePlayerSlugSet = new Set(
  eligiblePlayers.map(({ player }) => player.slug)
);
const adEligiblePlayerSlugSet = new Set(
  adEligiblePlayers.map(({ player }) => player.slug)
);

if (
  eligiblePlayers.length !==
  adEligiblePlayers.length
) {
  errors.push(
    `Player index/ad eligibility counts diverge: ` +
    `${eligiblePlayers.length} index eligible vs ` +
    `${adEligiblePlayers.length} ad eligible.`
  );
}
if (
  [...eligiblePlayerSlugSet].some(
    (slug) =>
      !adEligiblePlayerSlugSet.has(slug)
  ) ||
  [...adEligiblePlayerSlugSet].some(
    (slug) =>
      !eligiblePlayerSlugSet.has(slug)
  )
) {
  errors.push(
    "Player index/ad eligibility sets diverge."
  );
}
if (
  wave1Players.length + wave2Players.length !==
  eligiblePlayers.length
) {
  errors.push(
    `Eligible player wave partition does not close: ` +
    `${wave1Players.length} Wave 1 + ` +
    `${wave2Players.length} Wave 2 != ` +
    `${eligiblePlayers.length} eligible routes.`
  );
}
if (
  wave2ReviewPlayers.some(
    ({ eligibility }) =>
      eligibility.indexEligible ||
      eligibility.adEligible
  )
) {
  errors.push(
    "A Wave 2 review route became eligible."
  );
}

for (const { player, eligibility } of playerEligibilityRows) {
  if (eligibility.adEligible && !eligibility.indexEligible) {
    errors.push(`${player.slug}: ad eligible without index eligibility.`);
  }
  if (eligibility.indexEligible && eligibility.metrics.relationshipCount < 2) {
    errors.push(`${player.slug}: one-trade profile became index eligible.`);
  }
  if (
    eligibility.rolloutWave === "wave-1" &&
    eligibility.metrics.eligibleTradeCount < 1
  ) {
    errors.push(`${player.slug}: Wave 1 profile lacks an editorial trade.`);
  }
  if (
    eligibility.rolloutWave === "wave-2" &&
    (
      eligibility.metrics.eligibleTradeCount !== 0 ||
      eligibility.metrics.manualReviewTradeCount !== 0 ||
      eligibility.metrics.sharedTradeSignature ||
      eligibility.metrics.valueTier === "two-trade-narrow"
    )
  ) {
    errors.push(`${player.slug}: Wave 2 policy mismatch.`);
  }
}

const requiredDetailTokens = [
  "createPlayerEligibilityContext",
  "indexEligible={playerEligibility.indexEligible}",
  "adEligible={playerEligibility.adEligible}",
  "description={description}",
  '"@type": "ProfilePage"',
  '"@type": "BreadcrumbList"',
  'slot="head"',
  "getRelatedPublicTrades",
  "Name-only substring",
  "Read the full trade verdict",
  "Open the player directory",
];

for (const token of requiredDetailTokens) {
  if (!detailSource.includes(token)) {
    errors.push(`Player detail source is missing: ${token}`);
  }
}

if (
  detailSource.includes("JSON.stringify(trade.assetsReceived") ||
  detailSource.includes(".includes(playerName)")
) {
  errors.push("Forbidden player substring relationship logic is present.");
}
if (
  detailSource.includes("card.trade.analysis") ||
  detailSource.includes("{card.trade.analysis}")
) {
  errors.push("Player pages repeat the full trade analysis instead of linking to it.");
}

const requiredDirectoryTokens = [
  "indexEligible={false}",
  "adEligible={false}",
  "Crawlable Directory",
  "getPlayerDirectoryPageHref",
  "/api/player-search.json",
  'rel="prev"',
  'rel="next"',
];

for (const token of requiredDirectoryTokens) {
  if (!componentSource.includes(token)) {
    errors.push(`Directory component is missing: ${token}`);
  }
}

if (!indexSource.includes("PlayerDirectoryPage")) {
  errors.push("Player index does not use the directory component.");
}
if (!pageSource.includes("getStaticPaths")) {
  errors.push("Paginated directory route lacks getStaticPaths.");
}
if (!endpointSource.includes("createPlayerDirectoryRows")) {
  errors.push("Search endpoint does not use the verified directory rows.");
}
if (!layoutSource.includes('<slot name="head" />')) {
  errors.push("BaseLayout lacks the page-specific head slot.");
}
if (
  !astroConfigSource.includes("indexEligiblePlayerSlugs") ||
  !astroConfigSource.includes("createPlayerEligibilityContext")
) {
  errors.push("Astro sitemap config lacks full player eligibility support.");
}

if (
  componentSource.includes("sortedPlayers.map") ||
  componentSource.includes("6778")
) {
  warnings.push("Review the component for accidental full-directory embedding.");
}

const relationshipBuckets = {
  one: publicPlayers.filter(
    (player) =>
      getRelatedPublicTrades(player, publicTrades).length === 1
  ).length,
  multi: publicPlayers.filter(
    (player) =>
      getRelatedPublicTrades(player, publicTrades).length > 1
  ).length,
};

if (relationshipBuckets.one !== 4955) {
  errors.push(`Expected 4,955 one-trade routes; found ${relationshipBuckets.one}.`);
}
if (relationshipBuckets.multi !== 1823) {
  errors.push(`Expected 1,823 multi-trade routes; found ${relationshipBuckets.multi}.`);
}

const summary = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASSED" : "FAILED",
  counts: {
    playerRecords: players.length,
    publicTrades: publicTrades.length,
    publicPlayerRoutes: publicPlayers.length,
    directoryRows: directoryRows.length,
    directoryPageSize: PLAYER_DIRECTORY_PAGE_SIZE,
    directoryPages: totalPages,
    additionalPaginatedRoutes: totalPages - 1,
    oneTradeRoutes: relationshipBuckets.one,
    multiTradeRoutes: relationshipBuckets.multi,
    wave1PlayerRoutes: wave1Players.length,
    wave2PlayerRoutes: wave2Players.length,
    wave2ReviewRoutes: wave2ReviewPlayers.length,
    indexEligiblePlayerRoutes: eligiblePlayers.length,
    adEligiblePlayerRoutes: adEligiblePlayers.length,
    heldPlayerRoutes: publicPlayers.length - eligiblePlayers.length,
  },
  policy: {
    wave1IndexAndAdEligible: true,
    wave2IndexAndAdEligible: true,
    wave2ReviewHeld: true,
    directoryIndexEligible: false,
    directoryAdEligible: false,
    adsServingEnabled: false,
  },
  errors,
  warnings,
};

fs.writeFileSync(
  outputPath,
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);

if (errors.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
