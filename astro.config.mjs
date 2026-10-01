// @ts-check
import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import {
  createEligibilityContext,
  getTradeEligibility,
  isStaticPathIndexEligible,
} from "./src/utils/eligibility.js";
import {
  createPlayerEligibilityContext,
  getPlayerEligibility,
} from "./src/utils/playerEligibility.js";
import {
  getPublicTrades,
  getSearchablePlayerRecords,
} from "./src/utils/publicRecords.js";
import { getTeamPairEntries } from "./src/utils/teamPairHistory.js";
import { MARQUEE_TRADE_SLUGS } from "./src/utils/marqueeTradeSlugs.js";
import { isNbaSitemapEligiblePath } from "./src/lib/nba/launch-controls.mjs";

const trades = JSON.parse(
  readFileSync(
    new URL("./src/data/nfl/trades.json", import.meta.url),
    "utf8"
  ).replace(/^\uFEFF/, "")
);

const players = JSON.parse(
  readFileSync(
    new URL("./src/data/nfl/players.json", import.meta.url),
    "utf8"
  ).replace(/^\uFEFF/, "")
);

const knownTradeSlugs = new Set(
  trades.map((trade) => trade.slug).filter(Boolean)
);

const missingMarqueeSlugs = MARQUEE_TRADE_SLUGS.filter(
  (slug) => !knownTradeSlugs.has(slug)
);

if (MARQUEE_TRADE_SLUGS.length !== 52 || missingMarqueeSlugs.length > 0) {
  throw new Error(
    `Marquee eligibility closure failed: expected 52, found ${MARQUEE_TRADE_SLUGS.length}, missing ${missingMarqueeSlugs.length}.`
  );
}

const tradeEligibilityContext = createEligibilityContext(trades);
const publicTrades = getPublicTrades(trades);
const searchablePlayers = getSearchablePlayerRecords(players, publicTrades);
const playerEligibilityContext = createPlayerEligibilityContext(
  searchablePlayers,
  publicTrades,
  tradeEligibilityContext
);

const nflIndexablePaths = new Set();

for (const trade of publicTrades) {
  const eligibility = getTradeEligibility(
    trade,
    tradeEligibilityContext
  );

  if (eligibility.indexEligible) {
    nflIndexablePaths.add("/trades/" + trade.slug + "/");
  }
}

for (const player of searchablePlayers) {
  const eligibility = getPlayerEligibility(
    player,
    publicTrades,
    playerEligibilityContext
  );

  if (eligibility.indexEligible) {
    nflIndexablePaths.add("/players/" + player.slug + "/");
  }
}

for (const entry of getTeamPairEntries(publicTrades)) {
  nflIndexablePaths.add(entry.path);
}

const shouldIncludeInSitemap = (page) => {
  const pathname = new URL(page).pathname;

  if (isStaticPathIndexEligible(pathname)) {
    return true;
  }

  if (isNbaSitemapEligiblePath(pathname)) {
    return true;
  }

  return false;
};

export default defineConfig({
  site: "https://tradeverdicts.com",
  trailingSlash: "always",
  integrations: [
    sitemap({
      filter: shouldIncludeInSitemap,
    }),
  ],
  server: {
    port: 4322,
  },
});
