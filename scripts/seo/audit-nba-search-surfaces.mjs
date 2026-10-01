import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(repo, "dist");
const site = "https://tradeverdicts.com";

const readJson = (rel) =>
  JSON.parse(fs.readFileSync(path.join(repo, rel), "utf8").replace(/^\uFEFF/, ""));

const trades = readJson("src/data/nba/trades.json");
const players = readJson("src/data/nba/players.json");
const teams = readJson("src/data/nba/teams.json");
const ledger = readJson("src/data/nba/launch-eligibility.json");

const modelsModule = await import(
  pathToFileURL(path.join(repo, "src/lib/nba/build-private-route-models.mjs")).href
);
const launchModule = await import(
  pathToFileURL(path.join(repo, "src/lib/nba/launch-controls.mjs")).href
);
const built = modelsModule.buildPrivateRouteModels({ trades, players, teams });
const controls = launchModule.NBA_LAUNCH_CONTROLS;
const errors = [];

const modelByPath = new Map(built.models.map((model) => [model.path, model]));
const tradeBySlug = new Map(trades.map((trade) => [trade.slug, trade]));
const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
const candidateTradeSlugs = Object.keys(ledger.tradeRoutes ?? {}).sort();
const candidateTradePaths = candidateTradeSlugs.map((slug) => `/nba/trades/${slug}/`);
const staticEntries = Object.entries(ledger.staticRoutes ?? {});
const sourceLed = trades.filter((trade) =>
  /^source-led-beefup-b\d+$/u.test(String(trade.reviewStatus ?? ""))
);
const supersededTrades = trades.filter(
  (trade) =>
    trade.verdict === "Record Superseded" ||
    trade.contentClass === "Structural / Superseded Record"
);

const words = (value) =>
  (String(value ?? "").match(/\b[\p{L}\p{N}][\p{L}\p{N}’'\-]*\b/gu) ?? []).length;

if (ledger.tradeCounts?.total !== trades.length) {
  errors.push({
    issue: "ledger-total-mismatch",
    ledgerTotal: ledger.tradeCounts?.total,
    tradeCount: trades.length,
  });
}
if (ledger.tradeCounts?.indexCandidateTotal !== candidateTradeSlugs.length) {
  errors.push({
    issue: "ledger-index-candidate-count-mismatch",
    ledgerCount: ledger.tradeCounts?.indexCandidateTotal,
    actual: candidateTradeSlugs.length,
  });
}

for (const trade of trades) {
  if (
    String(trade.tradeDate ?? trade.date ?? "") < "1961-01-01" &&
    Array.isArray(trade.teams) &&
    trade.teams.includes("washington-wizards")
  ) {
    errors.push({
      route: `/nba/trades/${trade.slug}/`,
      issue: "historical-franchise-lineage-collision",
      team: "washington-wizards",
      tradeDate: trade.tradeDate ?? trade.date ?? "",
      note: "The current Wizards franchise did not exist before 1961; pre-1961 Washington/Baltimore records require their historical franchise slug.",
    });
  }
  if (
    String(trade.tradeDate ?? trade.date ?? "") < "1949-07-01" &&
    Array.isArray(trade.teams) &&
    trade.teams.includes("indianapolis-olympians")
  ) {
    errors.push({
      route: `/nba/trades/${trade.slug}/`,
      issue: "historical-franchise-lineage-collision",
      team: "indianapolis-olympians",
      tradeDate: trade.tradeDate ?? trade.date ?? "",
      note: "The Indianapolis Olympians began play in 1949-50; 1948-49 Indianapolis transactions belong to the separate Indianapolis Jets franchise.",
    });
  }
}

for (const trade of supersededTrades) {
  const route = `/nba/trades/${trade.slug}/`;
  if (
    trade.publishStatus !== "private" ||
    trade.privateOnly !== true ||
    trade.indexEligible !== false ||
    trade.adEligible !== false
  ) {
    errors.push({
      route,
      issue: "superseded-record-visibility-drift",
      publishStatus: trade.publishStatus,
      privateOnly: trade.privateOnly,
      indexEligible: trade.indexEligible,
      adEligible: trade.adEligible,
    });
  }
  if (candidateTradeSlugs.includes(trade.slug)) {
    errors.push({ route, issue: "superseded-record-in-index-candidate-ledger" });
  }
  const targetId = trade.canonicalSupersession?.canonicalTradeId;
  if (targetId) {
    const target = tradeById.get(targetId);
    if (!target) {
      errors.push({ route, issue: "superseded-record-missing-canonical-target", targetId });
    } else if (target.id === trade.id) {
      errors.push({ route, issue: "superseded-record-self-target", targetId });
    } else if (
      target.verdict === "Record Superseded" ||
      target.contentClass === "Structural / Superseded Record"
    ) {
      errors.push({ route, issue: "superseded-record-target-is-superseded", targetId });
    }
  }
}

for (const slug of candidateTradeSlugs) {
  const trade = tradeBySlug.get(slug);
  const route = `/nba/trades/${slug}/`;
  if (!trade) {
    errors.push({ issue: "candidate-slug-missing-trade", slug });
    continue;
  }
  if (!modelByPath.has(route)) {
    errors.push({ issue: "candidate-slug-missing-route-model", route });
  }
}

for (const trade of sourceLed) {
  const route = `/nba/trades/${trade.slug}/`;
  if (words(trade.summary) < 45) {
    errors.push({ route, issue: "source-led-summary-below-floor", words: words(trade.summary) });
  }
  if (words(trade.analysis) < 300) {
    errors.push({ route, issue: "source-led-analysis-below-floor", words: words(trade.analysis) });
  }
  if (!Array.isArray(trade.sources) || trade.sources.length < 2) {
    errors.push({ route, issue: "source-led-source-count-below-floor", count: trade.sources?.length ?? 0 });
  }
  if (
    trade.publishStatus !== "private" ||
    trade.privateOnly !== true ||
    trade.indexEligible !== false ||
    trade.adEligible !== false
  ) {
    errors.push({
      route,
      issue: "source-led-private-visibility-drift",
      publishStatus: trade.publishStatus,
      privateOnly: trade.privateOnly,
      indexEligible: trade.indexEligible,
      adEligible: trade.adEligible,
    });
  }
  const perspectives = Array.isArray(trade.perspectives)
    ? trade.perspectives
    : Object.values(trade.perspectives ?? {});
  for (const perspective of perspectives) {
    if (!perspective || typeof perspective !== "object") continue;
    if (words(perspective.summary) < 45) {
      errors.push({
        route,
        issue: "source-led-perspective-summary-below-floor",
        sourceTeam: perspective.sourceTeam,
        words: words(perspective.summary),
      });
    }
    if (words(perspective.analysis) < 300) {
      errors.push({
        route,
        issue: "source-led-perspective-analysis-below-floor",
        sourceTeam: perspective.sourceTeam,
        words: words(perspective.analysis),
      });
    }
  }
}

for (const [pathname] of staticEntries) {
  if (!fs.existsSync(path.join(dist, ...pathname.split("/").filter(Boolean), "index.html"))) {
    errors.push({ route: pathname, issue: "ledger-static-route-missing-built-html" });
  }
}

const sitemapNames = fs
  .readdirSync(dist)
  .filter((name) => /^sitemap(?:-index|-\d+|-nba[^.]*)?\.xml$/iu.test(name));
const sitemapText = sitemapNames
  .map((name) => fs.readFileSync(path.join(dist, name), "utf8"))
  .join("\n");

const attrs = (tag) => {
  const out = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gsu)) {
    out[match[1].toLowerCase()] = match[3];
  }
  return out;
};
const metadata = (html) => {
  const title = (html.match(/<title>([\s\S]*?)<\/title>/iu) ?? [])[1]?.replace(/\s+/gu, " ").trim() ?? "";
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/iu) ?? [])[1]
    ?.replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim() ?? "";
  const metas = [...html.matchAll(/<meta\b[^>]*>/giu)].map((match) => attrs(match[0]));
  const links = [...html.matchAll(/<link\b[^>]*>/giu)].map((match) => attrs(match[0]));
  return {
    title,
    h1,
    robots:
      metas.find((entry) => String(entry.name ?? "").toLowerCase() === "robots")
        ?.content?.toLowerCase() ?? "",
    canonical:
      links.find((entry) =>
        String(entry.rel ?? "").toLowerCase().split(/\s+/u).includes("canonical")
      )?.href ?? "",
  };
};

const indexTitleOwners = new Map();
for (const model of built.models) {
  const route = model.path;
  const file = path.join(dist, ...route.split("/").filter(Boolean), "index.html");
  if (!fs.existsSync(file)) {
    errors.push({ route, issue: "missing-built-html" });
    continue;
  }
  const meta = metadata(fs.readFileSync(file, "utf8"));
  const expectedUrl = site + route;
  if (meta.canonical !== expectedUrl) {
    errors.push({ route, issue: "canonical-mismatch", canonical: meta.canonical, expected: expectedUrl });
  }
  if (!meta.title) errors.push({ route, issue: "missing-title" });
  if (!meta.h1) errors.push({ route, issue: "missing-h1" });

  if (!controls.nbaPublicEnabled) {
    if (!meta.robots.includes("noindex") || !meta.robots.includes("nofollow")) {
      errors.push({ route, issue: "private-route-robots-drift", robots: meta.robots });
    }
    if (sitemapText.includes(`<loc>${expectedUrl}</loc>`)) {
      errors.push({ route, issue: "private-route-present-in-sitemap" });
    }
  } else {
    const candidatePolicy = launchModule.getNbaRoutePolicy({ path: route, routeType: model.routeType });
    if (candidatePolicy.indexEligible) {
      if (!meta.robots.includes("index") || meta.robots.includes("noindex")) {
        errors.push({ route, issue: "indexable-route-robots-drift", robots: meta.robots });
      }
      if (!sitemapText.includes(`<loc>${expectedUrl}</loc>`)) {
        errors.push({ route, issue: "indexable-route-missing-sitemap" });
      }
      const owners = indexTitleOwners.get(meta.title) ?? [];
      owners.push(route);
      indexTitleOwners.set(meta.title, owners);
    } else {
      if (!meta.robots.includes("noindex")) {
        errors.push({ route, issue: "nonindex-route-missing-noindex", robots: meta.robots });
      }
      if (sitemapText.includes(`<loc>${expectedUrl}</loc>`)) {
        errors.push({ route, issue: "nonindex-route-present-in-sitemap" });
      }
    }
  }
}

const duplicateIndexTitles = [...indexTitleOwners.entries()]
  .filter(([, owners]) => owners.length > 1)
  .map(([title, owners]) => ({ title, owners }));
for (const row of duplicateIndexTitles) {
  errors.push({ issue: "duplicate-indexable-title", ...row });
}

for (const route of candidateTradePaths) {
  const model = modelByPath.get(route);
  if (!model) continue;
  const policy = ledger.tradeRoutes[route.split("/").filter(Boolean).at(-1)];
  if (
    policy.publicationReady !== true ||
    policy.indexEligible !== true
  ) {
    errors.push({ route, issue: "candidate-trade-policy-drift", policy });
  }
}

if (
  built.audit.duplicatePaths.length ||
  built.audit.brokenLinks.length ||
  built.audit.crossNamespaceLinks.length ||
  built.audit.selfLinks.length ||
  built.audit.privacyViolationPaths.length ||
  built.audit.incompleteModelPaths.length
) {
  errors.push({ issue: "route-model-integrity-failure", audit: built.audit });
}

const result = {
  status: errors.length ? "FAILED" : "PASSED",
  mode: built.mode,
  launchControls: controls,
  counts: {
    trades: trades.length,
    players: players.length,
    teams: teams.length,
    routeModels: built.counts.routeModels,
    candidateTrades: candidateTradeSlugs.length,
    sourceLedBeefups: sourceLed.length,
    supersededTrades: supersededTrades.length,
    sitemapFiles: sitemapNames.length,
  },
  candidatePolicy: {
    qualificationSnapshot: ledger.qualificationSnapshot,
    expectedIndexCandidateTotal: ledger.tradeCounts?.indexCandidateTotal,
    candidateTradeCount: candidateTradeSlugs.length,
  },
  duplicateIndexTitleCount: duplicateIndexTitles.length,
  errors,
};

fs.writeFileSync(
  path.join(dist, "nba-search-surface-audit.json"),
  JSON.stringify(result, null, 2) + "\n",
  "utf8"
);
console.log(JSON.stringify({ ...result, errors: errors.slice(0, 80) }, null, 2));
process.exitCode = errors.length ? 1 : 0;
