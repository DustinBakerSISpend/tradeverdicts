import ledger from "../../data/nba/launch-eligibility.json" with { type: "json" };
import { ADSENSE_SITE_APPROVED } from "../../config/ads.js";

const readFlag = (name) =>
  /^(?:1|true|yes|on)$/iu.test(
    String(process.env?.[name] ?? "").trim(),
  );

export const NBA_LAUNCH_CONTROLS = Object.freeze({
  adsenseSiteApproved: ADSENSE_SITE_APPROVED,
  nbaPublicEnabled: readFlag("NBA_PUBLIC_ENABLED"),
  nbaIndexEnabled: readFlag("NBA_INDEX_ENABLED"),
  nbaAdsEnabled: readFlag("NBA_ADS_ENABLED"),
});

const archiveTradePolicy = Object.freeze({
  contentClass: "archive-basic",
  publicationReady: false,
  indexEligible: false,
  adEligible: false,
});

const supportingRoutePolicy = Object.freeze({
  contentClass: "supporting-archive",
  publicationReady: true,
  indexEligible: false,
  adEligible: false,
});

const normalizePath = (value = "") => {
  let pathname = String(value ?? "").trim() || "/nba/";

  if (!pathname.startsWith("/")) {
    pathname = `/${pathname}`;
  }

  if (pathname !== "/" && !pathname.endsWith("/")) {
    pathname = `${pathname}/`;
  }

  return pathname;
};

const getCandidatePolicy = (pathname) => {
  const normalized = normalizePath(pathname);
  const staticEntry = ledger.staticRoutes?.[normalized];

  if (staticEntry) {
    return staticEntry;
  }

  const tradeMatch = normalized.match(
    /^\/nba\/trades\/([^/]+)\/$/u,
  );

  if (tradeMatch) {
    return (
      ledger.tradeRoutes?.[
        decodeURIComponent(tradeMatch[1])
      ] ?? archiveTradePolicy
    );
  }

  return supportingRoutePolicy;
};

export function isNbaPublicFacing() {
  return NBA_LAUNCH_CONTROLS.nbaPublicEnabled;
}

export function getNbaRoutePolicy({
  path = "/nba/",
  routeType = "",
} = {}) {
  const pathname = normalizePath(path);
  const candidate = getCandidatePolicy(pathname);
  const publicFacing =
    NBA_LAUNCH_CONTROLS.nbaPublicEnabled;

  const indexEligible = Boolean(
    publicFacing &&
      NBA_LAUNCH_CONTROLS.nbaIndexEnabled &&
      candidate.indexEligible,
  );

  const adEligible = Boolean(
    indexEligible &&
      NBA_LAUNCH_CONTROLS.adsenseSiteApproved &&
      NBA_LAUNCH_CONTROLS.nbaAdsEnabled &&
      candidate.adEligible,
  );

  return Object.freeze({
    access: publicFacing
      ? "public"
      : "private-local-only",
    publishStatus: publicFacing
      ? "public"
      : "private",
    reviewStatus: candidate.publicationReady
      ? "qualified"
      : "archive",
    publicFacing,
    publicationReady:
      Boolean(candidate.publicationReady),
    indexEligible,
    adEligible,
    sitemapEligible: indexEligible,
    navigationEligible: publicFacing,
    routeCreated: publicFacing,
    routeCreationAuthorized: publicFacing,
    robots: publicFacing
      ? indexEligible
        ? "index,follow"
        : "noindex,follow"
      : "noindex,nofollow",
    contentClass:
      String(candidate.contentClass || "archive-basic"),
    routeType: String(routeType || ""),
    path: pathname,
  });
}

export function isNbaSitemapEligiblePath(pathname) {
  return getNbaRoutePolicy({
    path: pathname,
    routeType: "sitemap",
  }).sitemapEligible;
}

export function getNbaLaunchEligibilitySnapshot() {
  return Object.freeze({
    schemaVersion: ledger.schemaVersion,
    qualificationSnapshot: ledger.qualificationSnapshot,
    tradeCounts: Object.freeze({
      ...ledger.tradeCounts,
    }),
    staticRouteCount:
      Object.keys(ledger.staticRoutes ?? {}).length,
    qualifiedTradeSlugs: Object.freeze(
      Object.keys(ledger.tradeRoutes ?? {}).sort(),
    ),
  });
}
