import { createHash } from "node:crypto";
import { createNbaTeamRegistry } from "./team-registry.mjs";
import { buildPrivateQueryIndex } from "./build-private-query-index.mjs";
import { buildPrivateRelationshipGraph } from "./build-private-relationship-graph.mjs";
import { getNbaRoutePolicy, isNbaPublicFacing } from "./launch-controls.mjs";
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

const nbaPublicFacing = isNbaPublicFacing();

function privatePolicy(pathname, routeType) {
  return getNbaRoutePolicy({
    path: pathname,
    routeType,
  });
}

function publicOrPrivate(publicValue, privateValue) {
  return nbaPublicFacing ? publicValue : privateValue;
}

function previewTitle(publicTitle) {
  return nbaPublicFacing
    ? publicTitle
    : `${publicTitle} — Private Preview`;
}

function link(path, relation, entityId = null) {
  return { path, relation, entityId };
}

function tradePath(trade) {
  return `/nba/trades/${trade.slug}/`;
}

function playerPath(player) {
  return `/nba/players/${player.slug}/`;
}

function teamPath(teamSlug) {
  return `/nba/teams/${teamSlug}/`;
}

function summaryDescription(text, fallback) {
  const value = String(text ?? "").trim();
  return value || fallback;
}

export function buildPrivateRouteModels({ trades, players, teams }) {
  if (!Array.isArray(trades) || !Array.isArray(players) || !Array.isArray(teams)) {
    throw new TypeError("Trades, players, and teams must be arrays.");
  }

  const registry = createNbaTeamRegistry(teams);
  const queryIndex = buildPrivateQueryIndex({ trades, players, teams });
  const relationshipGraph =
    buildPrivateRelationshipGraph({
      trades,
      players,
      teams,
    });

  const careerTradeIdsByPlayer = new Map();

  for (const edge of [
    ...relationshipGraph.edges.playerTradeReference,
    ...(relationshipGraph.edges.supplementalPlayerTrade ?? []),
  ]) {
    if (
      edge.referenceType !== "direct_player" &&
      edge.referenceType !== "draft_rights"
    ) {
      continue;
    }

    if (!careerTradeIdsByPlayer.has(edge.playerId)) {
      careerTradeIdsByPlayer.set(edge.playerId, new Set());
    }

    careerTradeIdsByPlayer
      .get(edge.playerId)
      .add(edge.canonicalTradeId);
  }

  const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
  const playerById = new Map(players.map((player) => [player.id, player]));

  const models = [];

  models.push({
    routeType: "nba_root_index",
    path: "/nba/",
    title: previewTitle("NBA Trade Verdicts"),
    description: publicOrPrivate("NBA trade, player, and team data archive.", "Private NBA trade, player, and team data workspace."),
    entityId: null,
    links: [
      link("/nba/trades/", "section_index"),
      link("/nba/players/", "section_index"),
      link("/nba/teams/", "section_index"),
    ],
    privacy: privatePolicy("/nba/", "nba_root_index"),
    routeModelReady: true,
  });

  models.push({
    routeType: "trade_index",
    path: "/nba/trades/",
    title: previewTitle("NBA Trades"),
    description: publicOrPrivate(`${trades.length} canonical NBA trade records.`, `${trades.length} private canonical NBA trade records.`),
    entityId: null,
    links: trades
      .slice()
      .sort((left, right) =>
        left.tradeDate.localeCompare(right.tradeDate) ||
        left.sourceTradeId.localeCompare(right.sourceTradeId),
      )
      .map((trade) => link(tradePath(trade), "trade_detail", trade.id)),
    privacy: privatePolicy("/nba/trades/", "trade_index"),
    routeModelReady: true,
  });

  models.push({
    routeType: "player_index",
    path: "/nba/players/",
    title: previewTitle("NBA Players"),
    description: publicOrPrivate(`${players.length} NBA player records.`, `${players.length} private source-derived NBA player records.`),
    entityId: null,
    links: players
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
      .map((player) => link(playerPath(player), "player_detail", player.id)),
    privacy: privatePolicy("/nba/players/", "player_index"),
    routeModelReady: true,
  });

  const representedTeams = queryIndex.representedTeams
    .map((slug) => registry.getBySlug(slug))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  models.push({
    routeType: "team_index",
    path: "/nba/teams/",
    title: previewTitle("NBA Teams"),
    description: publicOrPrivate(`${representedTeams.length} NBA teams represented in the trade archive.`, `${representedTeams.length} NBA teams represented in the private trade store.`),
    entityId: null,
    links: representedTeams.map((team) =>
      link(teamPath(team.slug), "team_detail", team.slug),
    ),
    privacy: privatePolicy("/nba/teams/", "team_index"),
    routeModelReady: true,
  });

  for (const trade of trades) {
    const playerIds = queryIndex.indexes.playerIdsByTrade[trade.id] ?? [];
    const linkedPlayers = playerIds
      .map((playerId) => playerById.get(playerId))
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    const linkedTeams = trade.teams
      .map((teamSlug) => registry.getBySlug(teamSlug))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));

    models.push({
      routeType: "trade_detail",
      path: tradePath(trade),
      title: `${linkedTeams.map((team) => team.name).join(" / ")} Trade — ${trade.tradeDate}`,
      description: summaryDescription(
        trade.summary,
        publicOrPrivate(`NBA trade ${trade.sourceTradeId}.`, `Private canonical NBA trade ${trade.sourceTradeId}.`),
      ),
      entityId: trade.id,
      sourceTradeId: trade.sourceTradeId,
      tradeDate: trade.tradeDate,
      verdict: trade.verdict,
      teams: linkedTeams.map((team) => ({
        slug: team.slug,
        name: team.name,
        abbreviation: team.abbreviation,
        path: teamPath(team.slug),
      })),
      players: linkedPlayers.map((player) => ({
        id: player.id,
        name: player.name,
        slug: player.slug,
        path: playerPath(player),
      })),
      perspectiveTeams: Object.keys(trade.perspectives ?? {}).sort(),
      sharedPerspective: Object.keys(trade.perspectives ?? {}).length > 1,
      links: [
        ...linkedTeams.map((team) =>
          link(teamPath(team.slug), "team_detail", team.slug),
        ),
        ...linkedPlayers.map((player) =>
          link(playerPath(player), "player_detail", player.id),
        ),
      ],
      privacy: privatePolicy(tradePath(trade), "trade_detail"),
      routeModelReady: true,
    });
  }

  for (const player of players) {
    const careerTradeCount =
      careerTradeIdsByPlayer.get(player.id)?.size ?? 0;

// IMPORTANT: route-model links remain sourced exclusively from the
    // canonical private relationship graph. The researched career history
    // is supplemental page metadata and must not alter scalable graph counts.
    const tradeIds = queryIndex.indexes.tradeIdsByPlayer[player.id] ?? [];

    const linkedTrades = tradeIds
      .map((tradeId) => tradeById.get(tradeId))
      .filter(Boolean)
      .sort((left, right) =>
        left.tradeDate.localeCompare(right.tradeDate) ||
        left.sourceTradeId.localeCompare(right.sourceTradeId),
      );

    const description = careerTradeCount > 0
      ? `${player.name} was traded ${careerTradeCount} time${careerTradeCount === 1 ? "" : "s"} in his NBA career.`
      : `${player.name} appears in ${linkedTrades.length} NBA trade${linkedTrades.length === 1 ? "" : "s"}.`;

    models.push({
      routeType: "player_detail",
      path: playerPath(player),
      title: previewTitle(`${player.name} Trade History`),
      description,
      entityId: player.id,
      name: player.name,
      aliases: player.aliases,
      referenceTypes: player.referenceTypes,
      linkedTradeCount: linkedTrades.length,
      careerTradeCount,
      careerArchiveLinkedCount: careerTradeCount,
      careerTradeHistory: [],
      careerTradeSources: [],
      archiveGapCount: 0,
      links: linkedTrades.map((trade) =>
        link(tradePath(trade), "trade_detail", trade.id),
      ),
      privacy: privatePolicy(playerPath(player), "player_detail"),
      routeModelReady: true,
    });
  }

  for (const team of representedTeams) {
    const tradeIds = queryIndex.indexes.tradeIdsByTeam[team.slug] ?? [];
    const linkedTrades = tradeIds
      .map((tradeId) => tradeById.get(tradeId))
      .filter(Boolean)
      .sort((left, right) =>
        left.tradeDate.localeCompare(right.tradeDate) ||
        left.sourceTradeId.localeCompare(right.sourceTradeId),
      );

    models.push({
      routeType: "team_detail",
      path: teamPath(team.slug),
      title: previewTitle(`${team.name} Trade History`),
      description: publicOrPrivate(`${team.name} appears in ${linkedTrades.length} canonical NBA trade record${linkedTrades.length === 1 ? "" : "s"}.`, `${team.name} appears in ${linkedTrades.length} private canonical NBA trade record${linkedTrades.length === 1 ? "" : "s"}.`),
      entityId: team.slug,
      team: {
        slug: team.slug,
        name: team.name,
        abbreviation: team.abbreviation,
      },
      linkedTradeCount: linkedTrades.length,
      links: linkedTrades.map((trade) =>
        link(tradePath(trade), "trade_detail", trade.id),
      ),
      privacy: privatePolicy(teamPath(team.slug), "team_detail"),
      routeModelReady: true,
    });
  }

  const paths = models.map((model) => model.path);
  const pathSet = new Set(paths);
  const duplicatePaths = paths.filter(
    (path, index) => paths.indexOf(path) !== index,
  );
  const allLinks = models.flatMap((model) =>
    model.links.map((entry) => ({
      from: model.path,
      ...entry,
    })),
  );
  const brokenLinks = allLinks.filter((entry) => !pathSet.has(entry.path));
  const crossNamespaceLinks = allLinks.filter(
    (entry) => !entry.path.startsWith("/nba/"),
  );
  const selfLinks = allLinks.filter((entry) => entry.from === entry.path);
  const privacyViolations = models.filter((model) => {
    const privacy = model.privacy;

    if (!privacy || typeof privacy !== "object") return true;
    if (privacy.adEligible && !privacy.indexEligible) return true;
    if (privacy.indexEligible && !privacy.sitemapEligible) return true;

    if (privacy.publishStatus === "private") {
      return !(
        privacy.access === "private-local-only" &&
        privacy.indexEligible === false &&
        privacy.adEligible === false &&
        privacy.sitemapEligible === false &&
        privacy.navigationEligible === false &&
        privacy.routeCreated === false &&
        privacy.routeCreationAuthorized === false &&
        privacy.robots === "noindex,nofollow"
      );
    }

    if (privacy.publishStatus === "public") {
      return !(
        privacy.access === "public" &&
        privacy.navigationEligible === true &&
        privacy.routeCreated === true &&
        privacy.routeCreationAuthorized === true &&
        privacy.robots ===
          (privacy.indexEligible ? "index,follow" : "noindex,follow")
      );
    }

    return true;
  });
  const incompleteModels = models.filter(
    (model) =>
      model.routeModelReady !== true ||
      !model.title ||
      !model.description ||
      !Array.isArray(model.links),
  );

  const counts = {
    routeModels: models.length,
    indexRouteModels: models.filter((model) =>
      ["nba_root_index", "trade_index", "player_index", "team_index"].includes(
        model.routeType,
      ),
    ).length,
    tradeDetailModels: models.filter((model) => model.routeType === "trade_detail").length,
    playerDetailModels: models.filter((model) => model.routeType === "player_detail").length,
    teamDetailModels: models.filter((model) => model.routeType === "team_detail").length,
    internalLinks: allLinks.length,
    rootSectionLinks: models.find((model) => model.routeType === "nba_root_index")?.links.length ?? 0,
    indexToDetailLinks: models
      .filter((model) => ["trade_index", "player_index", "team_index"].includes(model.routeType))
      .reduce((sum, model) => sum + model.links.length, 0),
    tradeToTeamLinks: models
      .filter((model) => model.routeType === "trade_detail")
      .reduce(
        (sum, model) =>
          sum + model.links.filter((entry) => entry.relation === "team_detail").length,
        0,
      ),
    tradeToPlayerLinks: models
      .filter((model) => model.routeType === "trade_detail")
      .reduce(
        (sum, model) =>
          sum + model.links.filter((entry) => entry.relation === "player_detail").length,
        0,
      ),
    playerToTradeLinks: models
      .filter((model) => model.routeType === "player_detail")
      .reduce((sum, model) => sum + model.links.length, 0),
    teamToTradeLinks: models
      .filter((model) => model.routeType === "team_detail")
      .reduce((sum, model) => sum + model.links.length, 0),
    sharedPerspectiveTradeModels: models.filter(
      (model) => model.routeType === "trade_detail" && model.sharedPerspective === true,
    ).length,
    privateRouteModels: models.filter(
      (model) => model.privacy.publishStatus === "private",
    ).length,
    noindexRouteModels: models.filter(
      (model) => model.privacy.indexEligible === false,
    ).length,
    adFreeRouteModels: models.filter(
      (model) => model.privacy.adEligible === false,
    ).length,
    sitemapExcludedRouteModels: models.filter(
      (model) => model.privacy.sitemapEligible === false,
    ).length,
    navigationExcludedRouteModels: models.filter(
      (model) => model.privacy.navigationEligible === false,
    ).length,
    routeCreatedModels: models.filter(
      (model) => model.privacy.routeCreated === true,
    ).length,
    duplicatePaths: uniqueSorted(duplicatePaths).length,
    brokenLinks: brokenLinks.length,
    crossNamespaceLinks: crossNamespaceLinks.length,
    selfLinks: selfLinks.length,
    privacyViolations: privacyViolations.length,
    incompleteModels: incompleteModels.length,
  };

  const expected = {
    routeModels: 4 + trades.length + players.length + representedTeams.length,
    indexRouteModels: 4,
    tradeDetailModels: trades.length,
    playerDetailModels: players.length,
    teamDetailModels: representedTeams.length,
    internalLinks:
      3 +
      trades.length +
      players.length +
      representedTeams.length +
      (2 * queryIndex.counts.teamTradeMemberships) +
      (2 * queryIndex.counts.playerTradeMemberships),
    rootSectionLinks: 3,
    indexToDetailLinks: trades.length + players.length + representedTeams.length,
    tradeToTeamLinks: queryIndex.counts.teamTradeMemberships,
    tradeToPlayerLinks: queryIndex.counts.playerTradeMemberships,
    playerToTradeLinks: queryIndex.counts.playerTradeMemberships,
    teamToTradeLinks: queryIndex.counts.teamTradeMemberships,
    sharedPerspectiveTradeModels: queryIndex.counts.sharedPerspectiveTrades,
    privateRouteModels: counts.privateRouteModels,
    noindexRouteModels: counts.noindexRouteModels,
    adFreeRouteModels: counts.adFreeRouteModels,
    sitemapExcludedRouteModels: counts.sitemapExcludedRouteModels,
    navigationExcludedRouteModels: counts.navigationExcludedRouteModels,
    routeCreatedModels: counts.routeCreatedModels,
    duplicatePaths: 0,
    brokenLinks: 0,
    crossNamespaceLinks: 0,
    selfLinks: 0,
    privacyViolations: 0,
    incompleteModels: 0,
  };

  if (JSON.stringify(counts) !== JSON.stringify(expected)) {
    throw new Error(
      `Unexpected scalable private route-model counts:\n${JSON.stringify({ counts, expected }, null, 2)}`,
    );
  }

  return {
    schemaVersion: 1,
    mode: nbaPublicFacing ? "NBA_PUBLIC_LAUNCH_CONTROLLED" : "PRIVATE_ROUTE_MODEL_PREVIEW_ONLY",
    counts,
    models: models.sort((left, right) => left.path.localeCompare(right.path, "en")),
    audit: {
      duplicatePaths: uniqueSorted(duplicatePaths),
      brokenLinks,
      crossNamespaceLinks,
      selfLinks,
      privacyViolationPaths: privacyViolations.map((model) => model.path),
      incompleteModelPaths: incompleteModels.map((model) => model.path),
    },
    hashes: {
      routePathSetSha256: sha256(uniqueSorted(paths).join("\n")),
      linkSetSha256: sha256(
        allLinks
          .map((entry) => `${entry.from}|${entry.relation}|${entry.path}|${entry.entityId ?? ""}`)
          .sort()
          .join("\n"),
      ),
    },
  };
}
