import { createHash } from "node:crypto";
import { createNbaTeamRegistry } from "./team-registry.mjs";
import { buildPrivateRelationshipGraph } from "./build-private-relationship-graph.mjs";

export function normalizePrivateQuery(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’'".]/gu, "")
    .replace(/&/gu, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function assertPrivateRecord(record, label) {
  if (
    record.publishStatus !== "private" ||
    !String(record.reviewStatus ?? "").trim() ||
    record.indexEligible !== false ||
    record.adEligible !== false ||
    record.publicationReady !== false
  ) {
    throw new Error(`${label} violates the private retrieval policy.`);
  }
}

function addLookup(map, key, value) {
  if (!map[key]) map[key] = [];
  map[key].push(value);
}

export function buildPrivateQueryIndex({ trades, players, teams }) {
  if (!Array.isArray(trades) || !Array.isArray(players) || !Array.isArray(teams)) {
    throw new TypeError("Trades, players, and teams must be arrays.");
  }

  const registry = createNbaTeamRegistry(teams);
  const graph = buildPrivateRelationshipGraph({ trades, players, teams });

  for (const trade of trades) {
    assertPrivateRecord(trade, `Trade ${trade.sourceTradeId}`);
  }
  for (const player of players) {
    assertPrivateRecord(player, `Player ${player.name}`);
  }

  const tradeById = {};
  const tradeIdBySourceTradeId = {};
  const tradeIdBySlug = {};
  const tradeIdsByDate = {};
  const tradeIdsByTeam = {};

  for (const trade of trades) {
    if (tradeById[trade.id]) throw new Error(`Duplicate trade ID: ${trade.id}`);
    if (tradeIdBySourceTradeId[trade.sourceTradeId]) {
      throw new Error(`Duplicate source Trade ID: ${trade.sourceTradeId}`);
    }
    if (tradeIdBySlug[trade.slug]) throw new Error(`Duplicate trade slug: ${trade.slug}`);

    tradeById[trade.id] = trade;
    tradeIdBySourceTradeId[trade.sourceTradeId] = trade.id;
    tradeIdBySlug[trade.slug] = trade.id;
    addLookup(tradeIdsByDate, trade.tradeDate, trade.id);

    for (const teamSlug of trade.teams) {
      if (!registry.hasSlug(teamSlug)) {
        throw new Error(`${trade.sourceTradeId}: unknown team ${teamSlug}`);
      }
      addLookup(tradeIdsByTeam, teamSlug, trade.id);
    }
  }

  const playerById = {};
  const playerIdBySlug = {};
  const playerIdsByIdentity = {};
  const identityDisplayValues = {};

  for (const player of players) {
    if (playerById[player.id]) throw new Error(`Duplicate player ID: ${player.id}`);
    if (playerIdBySlug[player.slug]) throw new Error(`Duplicate player slug: ${player.slug}`);

    playerById[player.id] = player;
    playerIdBySlug[player.slug] = player.id;

    for (const identity of [player.name, ...(player.aliases ?? [])]) {
      const key = normalizePrivateQuery(identity);
      if (!key) throw new Error(`${player.name}: empty identity key.`);
      addLookup(playerIdsByIdentity, key, player.id);
      addLookup(identityDisplayValues, key, identity);
    }
  }

  for (const object of [
    tradeIdsByDate,
    tradeIdsByTeam,
    playerIdsByIdentity,
    identityDisplayValues,
  ]) {
    for (const key of Object.keys(object)) {
      object[key] = uniqueSorted(object[key]);
    }
  }

  const representedTeams = Object.keys(tradeIdsByTeam).sort();
  const uniqueDates = Object.keys(tradeIdsByDate).sort();
  const identityKeys = Object.keys(playerIdsByIdentity).sort();
  const ambiguousIdentityKeys = identityKeys.filter(
    (key) => playerIdsByIdentity[key].length > 1,
  );
  const sharedPerspectiveTrades = trades.filter(
    (trade) => Object.keys(trade.perspectives ?? {}).length > 1,
  );

  const counts = {
    canonicalTrades: trades.length,
    players: players.length,
    representedTeams: representedTeams.length,
    uniqueTradeDates: uniqueDates.length,
    teamTradeMemberships: graph.counts.teamTradeEdges,
    playerTradeReferences: graph.counts.playerTradeReferenceEdges,
    playerIdentityKeys: identityKeys.length,
    ambiguousExactIdentityKeys: ambiguousIdentityKeys.length,
    sharedPerspectiveTrades: sharedPerspectiveTrades.length,
    privateTrades: trades.filter((trade) => trade.publishStatus === "private").length,
    privatePlayers: players.filter((player) => player.publishStatus === "private").length,
    noindexTrades: trades.filter((trade) => trade.indexEligible === false).length,
    noindexPlayers: players.filter((player) => player.indexEligible === false).length,
    adFreeTrades: trades.filter((trade) => trade.adEligible === false).length,
    adFreePlayers: players.filter((player) => player.adEligible === false).length,
  };

  const expectedTeamMemberships = trades.reduce(
    (sum, trade) => sum + (trade.teams?.length ?? 0),
    0,
  );
  const expectedPlayerReferences = players.reduce(
    (sum, player) => sum + (player.sourceReferences?.length ?? 0),
    0,
  );
  const expectedSharedPerspectives = trades.filter(
    (trade) => Object.keys(trade.perspectives ?? {}).length > 1,
  ).length;

  const invariantFailures = [];
  function requireInvariant(condition, message) {
    if (!condition) invariantFailures.push(message);
  }

  requireInvariant(counts.canonicalTrades === trades.length, "Trade count does not match the store.");
  requireInvariant(counts.players === players.length, "Player count does not match the store.");
  requireInvariant(counts.representedTeams > 0, "No represented teams were indexed.");
  requireInvariant(counts.uniqueTradeDates > 0, "No trade dates were indexed.");
  requireInvariant(
    counts.teamTradeMemberships === expectedTeamMemberships,
    `Expected ${expectedTeamMemberships} team memberships, found ${counts.teamTradeMemberships}.`,
  );
  requireInvariant(
    counts.playerTradeReferences === expectedPlayerReferences,
    `Expected ${expectedPlayerReferences} active player references, found ${counts.playerTradeReferences}.`,
  );
  requireInvariant(
    counts.playerIdentityKeys >= players.length,
    "The exact player-identity index contains fewer keys than player records.",
  );
  requireInvariant(
    counts.ambiguousExactIdentityKeys === 0,
    "Exact player identities are ambiguous.",
  );
  requireInvariant(
    counts.sharedPerspectiveTrades === expectedSharedPerspectives,
    "Shared-perspective count does not match the canonical store.",
  );
  requireInvariant(counts.privateTrades === trades.length, "Every trade must remain private.");
  requireInvariant(counts.privatePlayers === players.length, "Every player must remain private.");
  requireInvariant(counts.noindexTrades === trades.length, "Every trade must remain noindex.");
  requireInvariant(counts.noindexPlayers === players.length, "Every player must remain noindex.");
  requireInvariant(counts.adFreeTrades === trades.length, "Every trade must remain ad-free.");
  requireInvariant(counts.adFreePlayers === players.length, "Every player must remain ad-free.");
  requireInvariant(graph.counts.invalidPlayerReferences === 0, "Invalid player references exist.");
  requireInvariant(graph.counts.duplicateReferenceOwnership === 0, "Duplicate player-reference ownership exists.");
  requireInvariant(graph.counts.extraPlayerReferences === 0, "Extra player references exist.");
  requireInvariant(graph.counts.invalidTradeTeams === 0, "Unknown trade-team memberships exist.");

  if (invariantFailures.length > 0) {
    throw new Error(`Private-query index invariant failures:\n${invariantFailures.join("\n")}`);
  }

  return {
    schemaVersion: 1,
    mode: "PRIVATE_READ_ONLY_QUERY_INDEX",
    counts,
    hashes: {
      tradeIdentitySetSha256: sha256(
        uniqueSorted(trades.map((trade) => `${trade.id}|${trade.sourceTradeId}|${trade.slug}`)).join("\n"),
      ),
      playerIdentitySetSha256: sha256(
        uniqueSorted(players.map((player) => `${player.id}|${player.normalizedName}|${player.slug}`)).join("\n"),
      ),
    },
    indexes: {
      tradeIdBySourceTradeId,
      tradeIdBySlug,
      tradeIdsByDate,
      tradeIdsByTeam,
      playerIdBySlug,
      playerIdsByIdentity,
      identityDisplayValues,
      tradeIdsByPlayer: graph.indexes.playerToTrades,
      playerIdsByTrade: graph.indexes.tradeToPlayers,
    },
    representedTeams,
    uniqueDates,
    ambiguousIdentityKeys,
    sharedPerspectiveTradeIds: sharedPerspectiveTrades.map((trade) => trade.id).sort(),
    records: {
      trades: tradeById,
      players: playerById,
    },
  };
}
