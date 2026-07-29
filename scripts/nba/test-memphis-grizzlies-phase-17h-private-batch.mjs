#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrivateRelationshipGraph } from "../../src/lib/nba/build-private-relationship-graph.mjs";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";
import { createNbaTeamRegistry } from "../../src/lib/nba/team-registry.mjs";
import { validateCanonicalNbaTrade } from "../../src/lib/nba/validate-canonical-trade.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function clean(value) { return String(value ?? "").trim(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }

const args = parseArgs(process.argv);
for (const required of [
  "trades-json","players-json","teams-json","receipt-json","output-json",
  "expected-canonical-store-sha256","expected-player-store-sha256","expected-team-store-sha256"
]) assert(args[required], `Missing --${required}`);

const [tradeBytes, playerBytes, teamBytes, receiptBytes] = await Promise.all([
  readFile(args["trades-json"]), readFile(args["players-json"]),
  readFile(args["teams-json"]), readFile(args["receipt-json"])
]);
assert(sha256(tradeBytes) === args["expected-canonical-store-sha256"], "Canonical store hash mismatch.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Player store hash mismatch.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Team store hash mismatch.");

const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));

assert(receipt.result === "PASS" && receipt.phase === "17H", "Invalid Phase 17H receipt.");
for (const [actual, expected, label] of [
  [trades.length, 2141, "canonical trades"],
  [players.length, 2999, "players"],
  [teams.length, 52, "teams"],
  [receipt.readyPackages, 93, "ready packages"],
  [receipt.heldPackages, 21, "held packages"],
  [receipt.structuralEvidenceExclusions, 12, "exclusions"],
  [receipt.canonicalTradesCreated, 53, "canonical creates"],
  [receipt.perspectivesAppended, 40, "perspective appends"],
  [receipt.playerShellsCreated, 58, "player shells"],
  [receipt.readyShellsResolvedToExistingPlayers, 1, "resolved ready shells"],
  [receipt.heldOnlyPlayerShellsDeferred, 17, "held-only shells"],
  [receipt.relationshipReferencesAdded, 281, "relationship references"],
  [receipt.heldRelationshipEdgesDeferred, 101, "held relationships"],
  [receipt.readyTeamDependencies, 186, "ready team dependencies"],
  [receipt.heldTeamDependencies, 69, "held team dependencies"],
  [receipt.existingPerspectiveReviewHolds, 0, "existing-perspective review holds"],
  [receipt.ambiguousIdentityOccurrencesDeferred, 0, "ambiguous identity occurrences deferred"],
  [receipt.sourceReferencesAdded, 188, "source references added"],
]) assert(actual === expected, `${label} drifted: ${actual} !== ${expected}.`);

assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route creation occurred.");
assert(receipt.automaticTeamRegistrations === 0, "Automatic team registration occurred.");
assert(receipt.heldPackageImports === 0, "Held package import occurred.");
assert(receipt.heldPlayerShellImports === 0, "Held-only shell import occurred.");
assert(receipt.heldRelationshipWrites === 0, "Held relationship write occurred.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");

assert(receipt.matchedExistingAssetReferences === 281, "Matched existing asset-reference count drifted.");
assert(receipt.syntheticPerspectiveAssetReferences === 0, "Synthetic perspective asset-reference count drifted.");
assert(receipt.explicitRelationshipTargetCorrections && Object.keys(receipt.explicitRelationshipTargetCorrections).length === 0, "Unexpected relationship target correction exists.");

const playerCorrections = receipt.explicitPlayerTargetCorrections ?? {};
assert(
  playerCorrections["nba-player-dj-kennedy"] === "nba-player-d-j-kennedy",
  "D.J. Kennedy existing-player correction is missing.",
);
assert(
  Array.isArray(receipt.forcedSyntheticRelationshipIds) &&
    receipt.forcedSyntheticRelationshipIds.length === 0,
  "Unexpected perspective-local synthetic asset reference exists.",
);

const registry = createNbaTeamRegistry(teams);
const tradeMap = new Map(trades.map((trade) => [trade.id, trade]));
for (const id of receipt.updatedPerspectiveCanonicalIds) {
  const trade = tradeMap.get(id);
  assert(trade, `Updated perspective target missing: ${id}`);
  const perspectiveCount = Array.isArray(trade.perspectives)
    ? trade.perspectives.filter((perspective) => clean(perspective?.sourceTeam) === "memphis-grizzlies").length
    : Object.prototype.hasOwnProperty.call(trade.perspectives ?? {}, "memphis-grizzlies") ? 1 : 0;
  assert(perspectiveCount === 1, `${id}: target does not retain exactly one Memphis perspective.`);
}
for (const id of receipt.importedCanonicalTradeIds) {
  const trade = tradeMap.get(id);
  assert(trade, `Created trade missing: ${id}`);
  const result = validateCanonicalNbaTrade(trade, registry);
  assert(result.valid, `${id}: canonical validation failed: ${result.errors.join("; ")}`);
}

for (const trade of trades) {
  assert(
    trade.publishStatus === "private" &&
    trade.indexEligible === false &&
    trade.adEligible === false &&
    trade.publicationReady === false,
    `${trade.id}: trade privacy drifted.`
  );
}
for (const player of players) {
  assert(
    player.publishStatus === "private" &&
    player.indexEligible === false &&
    player.adEligible === false &&
    player.publicationReady === false,
    `${player.id}: player privacy drifted.`
  );
}

const graph = buildPrivateRelationshipGraph({ trades, players, teams });
assert(graph.counts.invalidPlayerReferences === 0, "Invalid player references exist.");
assert(graph.counts.duplicateReferenceOwnership === 0, "Duplicate player-reference ownership exists.");
assert(graph.counts.extraPlayerReferences === 0, "Extra player references exist.");
assert(graph.counts.invalidTradeTeams === 0, "Invalid trade-team memberships exist.");

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });

for (const [actual, expected, label] of [
  [query.counts.canonicalTrades, 2141, "query trades"],
  [query.counts.players, 2999, "query players"],
  [query.counts.representedTeams, 52, "represented teams"],
  [query.counts.uniqueTradeDates, 1461, "unique trade dates"],
  [query.counts.teamTradeMemberships, 4423, "team memberships"],
  [query.counts.playerTradeReferences, 3159, "player references"],
  [query.counts.playerIdentityKeys, 3017, "player identity keys"],
  [query.counts.ambiguousExactIdentityKeys, 0, "ambiguous identities"],
  [query.counts.sharedPerspectiveTrades, 513, "shared-perspective trades"],
  [routes.counts.routeModels, 5196, "route models"],
  [routes.counts.internalLinks, 20359, "internal links"],
  [routes.counts.duplicatePaths, 0, "duplicate paths"],
  [routes.counts.brokenLinks, 0, "broken links"],
  [routes.counts.privacyViolations, 0, "privacy violations"],
  [routes.counts.routeCreatedModels, 0, "created route models"],
]) assert(actual === expected, `${label} drifted: ${actual} !== ${expected}.`);

const result = {
  result: "PASS",
  phase: "17H",
  mode: "GUARDED_PRIVATE_IMPORT_AUDIT",
  counts: {
    canonicalTrades: trades.length,
    players: players.length,
    teams: teams.length,
    readyPackages: receipt.readyPackages,
    heldPackages: receipt.heldPackages,
    structuralEvidenceExclusions: receipt.structuralEvidenceExclusions,
    canonicalTradesCreated: receipt.canonicalTradesCreated,
    perspectivesAppended: receipt.perspectivesAppended,
    playerShellsCreated: receipt.playerShellsCreated,
    readyShellsResolvedToExistingPlayers: receipt.readyShellsResolvedToExistingPlayers,
    deferredPlayerShells: receipt.heldOnlyPlayerShellsDeferred,
    relationshipReferencesAdded: receipt.relationshipReferencesAdded,
    deferredRelationshipEdges: receipt.heldRelationshipEdgesDeferred,
    readyTeamDependencies: receipt.readyTeamDependencies,
    heldTeamDependencies: receipt.heldTeamDependencies,
    existingPerspectiveReviewHolds: receipt.existingPerspectiveReviewHolds,
    ambiguousIdentityOccurrencesDeferred: receipt.ambiguousIdentityOccurrencesDeferred,
    matchedExistingAssetReferences: receipt.matchedExistingAssetReferences,
    syntheticPerspectiveAssetReferences: receipt.syntheticPerspectiveAssetReferences,
    sourceReferencesAdded: receipt.sourceReferencesAdded,
    privateQueryPlayerReferences: query.counts.playerTradeReferences,
    routeModels: routes.counts.routeModels,
    internalLinks: routes.counts.internalLinks,
  },
  hashes: {
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
    receiptSha256: sha256(receiptBytes),
  },
  safety: {
    duplicateReferenceOwnership: graph.counts.duplicateReferenceOwnership,
    heldPackageImports: 0,
    heldPlayerShellImports: 0,
    heldRelationshipWrites: 0,
    automaticCanonicalMerges: 0,
    automaticIdentityMerges: 0,
    automaticRoutes: 0,
    teamRegistryWrites: 0,
    publicationAuthorized: false,
    pushPerformed: false,
    deployPerformed: false,
  },
};
await mkdir(path.dirname(path.resolve(args["output-json"])), { recursive: true });
await writeFile(args["output-json"], canonicalJson(result));
console.log(JSON.stringify(result, null, 2));
