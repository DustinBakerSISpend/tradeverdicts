// @ts-check
import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import {
  createEligibilityContext,
  getTradeEligibility,
  isStaticPathIndexEligible,
} from "./src/utils/eligibility.js";
import { MARQUEE_TRADE_SLUGS } from "./src/utils/marqueeTradeSlugs.js";
import { isNbaSitemapEligiblePath } from "./src/lib/nba/launch-controls.mjs";
import {
  getPublicPlayerRecords,
  getPublicTrades,
} from "./src/utils/publicRecords.js";
import {
  createPlayerEligibilityContext,
  getIndexEligiblePlayers,
} from "./src/utils/playerEligibility.js";

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

const eligibilityContext = createEligibilityContext(trades);
const publicTrades = getPublicTrades(trades);
const publicPlayers = getPublicPlayerRecords(
  players,
  publicTrades
);

const playerEligibilityContext =
  createPlayerEligibilityContext(
    publicPlayers,
    publicTrades,
    eligibilityContext
  );

const indexEligibleTradeSlugs = new Set(
  trades
    .filter(
      (trade) =>
        getTradeEligibility(trade, eligibilityContext).indexEligible
    )
    .map((trade) => trade.slug)
);

const indexEligiblePlayerSlugs = new Set(
  getIndexEligiblePlayers(
    publicPlayers,
    publicTrades,
    playerEligibilityContext
  ).map((player) => player.slug)
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

const shouldIncludeInSitemap = (page) => {
  const pathname = new URL(page).pathname;

  if (isStaticPathIndexEligible(pathname)) {
    return true;
  }

  if (isNbaSitemapEligiblePath(pathname)) {
    return true;
  }

  const tradeMatch = pathname.match(/^\/trades\/([^/]+)\/$/);

  if (
    tradeMatch &&
    indexEligibleTradeSlugs.has(
      decodeURIComponent(tradeMatch[1])
    )
  ) {
    return true;
  }

  const playerMatch = pathname.match(
    /^\/players\/([^/]+)\/$/
  );

  return Boolean(
    playerMatch &&
    indexEligiblePlayerSlugs.has(
      decodeURIComponent(playerMatch[1])
    )
  );
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
