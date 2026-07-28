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
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function clean(value) { return String(value ?? "").trim(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/u, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field.length > 0 || row.length > 0) { row.push(field.replace(/\r$/u, "")); rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}
function tradeId(trade) { return clean(trade.id ?? trade.tradeId); }
function playerId(player) { return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id); }
function sourcePerspectiveCount(trade, team) {
  if (Array.isArray(trade.perspectives)) {
    return trade.perspectives.filter((p) => clean(p?.sourceTeam ?? p?.teamId ?? p?.team ?? p?.perspectiveTeam) === team).length;
  }
  return trade.perspectives && typeof trade.perspectives === "object" && Object.prototype.hasOwnProperty.call(trade.perspectives, team) ? 1 : 0;
}
function perspectiveSourceIds(trade) {
  if (Array.isArray(trade.perspectives)) return trade.perspectives.map((p) => clean(p?.sourceTradeId)).filter(Boolean);
  return Object.values(trade.perspectives ?? {}).flatMap((p) => {
    const explicit = clean(p?.sourceTradeId);
    if (explicit) return [explicit];
    const submission = clean(p?.sourceSubmissionId);
    const match = submission.match(/(IND-\d{4}-\d{4})$/u);
    return match ? [match[1]] : [];
  });
}
function immutableTradeProjection(trade) {
  return {
    id: trade.id, tradeId: trade.tradeId, sourceTradeId: trade.sourceTradeId,
    canonicalKey: trade.canonicalKey, slug: trade.slug, league: trade.league,
    tradeDate: trade.tradeDate, date: trade.date, seasonLabel: trade.seasonLabel,
    season: trade.season, teams: trade.teams, assetLedger: trade.assetLedger,
    assetsReceived: trade.assetsReceived, assetsSent: trade.assetsSent,
    assetsSentByTeam: trade.assetsSentByTeam, createdAt: trade.createdAt,
  };
}
function canonicalIdForSource(sourceId) {
  const match = clean(sourceId).match(/^IND-(\d{4})-(\d{4})$/u);
  assert(match, `Invalid Indiana source Trade ID ${sourceId}`);
  return `nba-trade-ind-${match[1]}-${match[2]}`;
}

const args = parseArgs(process.argv);
for (const required of [
  "records-json", "partition-json", "ready-packages-csv", "held-packages-csv", "structural-exclusions-csv",
  "ready-player-shells-csv", "held-player-shells-csv", "ready-relationships-csv", "held-relationships-csv",
  "dependency-seeds-csv", "receipt-json", "trades-json", "players-json", "teams-json", "contract-md", "output-json",
  "expected-records-sha256", "expected-partition-sha256", "expected-ready-packages-sha256", "expected-held-packages-sha256",
  "expected-structural-exclusions-sha256", "expected-ready-player-shells-sha256", "expected-held-player-shells-sha256",
  "expected-ready-relationships-sha256", "expected-held-relationships-sha256", "expected-dependency-seeds-sha256",
  "expected-contract-sha256", "expected-canonical-store-sha256", "expected-player-store-sha256", "expected-team-store-sha256",
  "expected-receipt-sha256",
]) assert(args[required], `Missing --${required}`);

const [recordsBytes, partitionBytes, readyPackageBytes, heldPackageBytes, structuralBytes, readyShellBytes, heldShellBytes, readyRelationshipBytes, heldRelationshipBytes, dependencyBytes, receiptBytes, tradeBytes, playerBytes, teamBytes, contractBytes] = await Promise.all([
  readFile(args["records-json"]), readFile(args["partition-json"]), readFile(args["ready-packages-csv"]), readFile(args["held-packages-csv"]),
  readFile(args["structural-exclusions-csv"]), readFile(args["ready-player-shells-csv"]), readFile(args["held-player-shells-csv"]),
  readFile(args["ready-relationships-csv"]), readFile(args["held-relationships-csv"]), readFile(args["dependency-seeds-csv"]),
  readFile(args["receipt-json"]), readFile(args["trades-json"]), readFile(args["players-json"]), readFile(args["teams-json"]), readFile(args["contract-md"]),
]);

for (const [actual, expected, label] of [
  [sha256(recordsBytes), args["expected-records-sha256"], "records"],
  [sha256(partitionBytes), args["expected-partition-sha256"], "partition"],
  [sha256(readyPackageBytes), args["expected-ready-packages-sha256"], "ready packages"],
  [sha256(heldPackageBytes), args["expected-held-packages-sha256"], "held packages"],
  [sha256(structuralBytes), args["expected-structural-exclusions-sha256"], "structural exclusions"],
  [sha256(readyShellBytes), args["expected-ready-player-shells-sha256"], "ready player shells"],
  [sha256(heldShellBytes), args["expected-held-player-shells-sha256"], "held player shells"],
  [sha256(readyRelationshipBytes), args["expected-ready-relationships-sha256"], "ready relationships"],
  [sha256(heldRelationshipBytes), args["expected-held-relationships-sha256"], "held relationships"],
  [sha256(dependencyBytes), args["expected-dependency-seeds-sha256"], "dependency seeds"],
  [sha256(contractBytes), args["expected-contract-sha256"], "contract"],
  [sha256(tradeBytes), args["expected-canonical-store-sha256"], "canonical store"],
  [sha256(playerBytes), args["expected-player-store-sha256"], "player store"],
  [sha256(teamBytes), args["expected-team-store-sha256"], "team store"],
  [sha256(receiptBytes), args["expected-receipt-sha256"], "receipt"],
]) assert(actual === expected, `${label} hash drifted: ${actual} !== ${expected}.`);

const records = JSON.parse(recordsBytes.toString("utf8"));
const partition = JSON.parse(partitionBytes.toString("utf8"));
const readyRows = parseCsv(readyPackageBytes.toString("utf8"));
const heldRows = parseCsv(heldPackageBytes.toString("utf8"));
const structuralRows = parseCsv(structuralBytes.toString("utf8"));
const readyShells = parseCsv(readyShellBytes.toString("utf8"));
const heldShells = parseCsv(heldShellBytes.toString("utf8"));
const readyRelationships = parseCsv(readyRelationshipBytes.toString("utf8"));
const heldRelationships = parseCsv(heldRelationshipBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(records.result === "PASS" && records.phase === "14B" && records.records.length === 168, "Invalid Indiana records.");
assert(partition.result === "PASS" && partition.phase === "14F", "Invalid Phase 14F partition.");
assert(receipt.result === "PASS" && receipt.phase === "14H", "Invalid Phase 14H receipt.");
assert(readyRows.length === 133 && heldRows.length === 16 && structuralRows.length === 19, "Final package partition drifted.");
assert(readyShells.length === 85 && heldShells.length === 13, "Frozen shell partition drifted.");
assert(readyRelationships.length === 346 && heldRelationships.length === 57, "Frozen relationship partition drifted.");
assert(trades.length === 1931 && players.length === 2783 && teams.length === 52, "Post-import store counts drifted.");

for (const [actual, expected, label] of [
  [receipt.sourceRows, 168, "source rows"],
  [receipt.readyPackages, 133, "ready packages"],
  [receipt.heldPackages, 16, "held packages"],
  [receipt.structuralEvidenceExclusions, 19, "structural exclusions"],
  [receipt.canonicalTradesCreated, 83, "canonical creates"],
  [receipt.perspectivesAppended, 50, "perspective appends"],
  [receipt.frozenPlayerShellProposals, 98, "frozen shell proposals"],
  [receipt.playerShellsCreated, 83, "created player shells"],
  [receipt.readyShellsResolvedToExistingPlayers, 2, "resolved ready shells"],
  [receipt.redundantReadyShellsExcluded, 0, "redundant ready shells"],
  [receipt.heldOnlyPlayerShellsDeferred, 13, "held-only shells"],
  [receipt.frozenRelationshipEdges, 403, "frozen relationship edges"],
  [receipt.relationshipReferencesAdded, 346, "relationship writes"],
  [receipt.redundantReadyRelationshipEdgesExcluded, 0, "redundant ready relationship exclusions"],
  [receipt.heldRelationshipEdgesDeferred, 57, "held relationship edges"],
  [receipt.matchedExistingAssetReferences, 345, "matched asset references"],
  [receipt.syntheticPerspectiveAssetReferences, 1, "synthetic perspective references"],
  [receipt.sourceReferencesAdded, 270, "source references added"],
  [receipt.publicCandidatePackagesImportedPrivately, 31, "private public-candidate imports"],
  [receipt.preImportCanonicalTrades, 1848, "pre-import trades"],
  [receipt.preImportPlayers, 2700, "pre-import players"],
  [receipt.postImportCanonicalTrades, 1931, "post-import trades"],
  [receipt.postImportPlayers, 2783, "post-import players"],
  [receipt.postImportTeams, 52, "post-import teams"],
  [receipt.postImportRelationshipReferences, 4667, "post-import relationship references"],
  [receipt.postImportSourceReferences, 2377, "post-import source references"],
  [receipt.repositoryDataWrites, 3, "repository data writes"],
  [receipt.teamRegistryEntriesAdded, 0, "team registrations"],
  [receipt.heldPackageImports, 0, "held package imports"],
  [receipt.heldPlayerShellImports, 0, "held shell imports"],
  [receipt.heldRelationshipWrites, 0, "held relationship writes"],
]) assert(actual === expected, `Receipt ${label} drifted: ${actual} !== ${expected}.`);
assert(receipt.publicationAuthorized === false && receipt.pushPerformed === false && receipt.deployPerformed === false, "Phase 14H safety flags drifted.");
assert(receipt.automaticIdentityMerges === 0 && receipt.automaticCanonicalMerges === 0 && receipt.automaticRoutes === 0 && receipt.automaticTeamRegistrations === 0, "Automatic action count drifted.");
assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Receipt canonical hash drifted.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Receipt player hash drifted.");
assert(receipt.teamStoreSha256 === sha256(teamBytes), "Receipt team hash drifted.");

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
assert(tradeMap.size === trades.length, "Duplicate canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");
assert(new Set(trades.map((trade) => trade.slug)).size === trades.length, "Duplicate canonical trade slug.");
assert(new Set(players.map((player) => player.slug)).size === players.length, "Duplicate player slug.");

const registry = createNbaTeamRegistry(teams);
const invalidNewTrades = [];
for (const canonicalId of receipt.importedCanonicalTradeIds) {
  const trade = tradeMap.get(canonicalId);
  assert(trade, `Created canonical trade is missing: ${canonicalId}`);
  const result = validateCanonicalNbaTrade(trade, registry);
  if (!result.valid) invalidNewTrades.push({ canonicalId, errors: result.errors });
}
assert(invalidNewTrades.length === 0, `Created canonical validation failed: ${JSON.stringify(invalidNewTrades.slice(0, 5))}`);

for (const row of readyRows) {
  const sourceId = clean(row["Trade ID"]);
  const targetId = clean(row["Phase 14F Canonical Write"]) === "CANONICAL_CREATE_PREVIEW" ? canonicalIdForSource(sourceId) : clean(row["Canonical ID"]);
  const trade = tradeMap.get(targetId);
  assert(trade, `${sourceId}: final target trade is missing.`);
  assert(sourcePerspectiveCount(trade, "indiana-pacers") === 1, `${sourceId}: Indiana perspective count drifted.`);
  assert(trade.publishStatus === "private" && trade.indexEligible === false && trade.adEligible === false && trade.publicationReady === false, `${sourceId}: trade exposure drifted.`);
}
for (const [canonicalId, expectedHash] of Object.entries(receipt.protectedAppendProjectionHashes)) {
  const trade = tradeMap.get(canonicalId);
  assert(trade, `Protected append target is missing: ${canonicalId}`);
  assert(sha256(canonicalJson(immutableTradeProjection(trade))) === expectedHash, `${canonicalId}: protected append fields drifted.`);
}
for (const sourceId of [...receipt.heldSourceTradeIds, ...receipt.structuralEvidenceExcludedSourceTradeIds]) {
  assert(!trades.some((trade) => clean(trade.sourceTradeId) === sourceId), `${sourceId}: forbidden standalone import exists.`);
  assert(!trades.some((trade) => perspectiveSourceIds(trade).includes(sourceId)), `${sourceId}: forbidden Indiana perspective import exists.`);
}
for (const id of receipt.importedPlayerIds) {
  const player = playerMap.get(id);
  assert(player, `Imported player is missing: ${id}`);
  assert(player.privateOnly === true && player.publishStatus === "private" && player.indexEligible === false && player.adEligible === false && player.publicationReady === false, `${id}: player exposure drifted.`);
}
assert(playerMap.has("nba-player-aj-price-fb186d611f"), "Resolved AJ Price player is missing.");
assert(!playerMap.has("nba-player-a-j-price"), "Stale A.J. Price shell exists.");
assert(playerMap.has("nba-player-rj-hampton-62cbde2ae5"), "Resolved RJ Hampton player is missing.");
assert(!playerMap.has("nba-player-r-j-hampton"), "Stale R.J. Hampton shell exists.");
assert(receipt.readyShellsResolvedToExistingPlayerIds.includes("nba-player-aj-price-fb186d611f"), "AJ Price explicit shell resolution missing from receipt.");
assert(receipt.readyShellsResolvedToExistingPlayerIds.includes("nba-player-rj-hampton-62cbde2ae5"), "RJ Hampton explicit shell resolution missing from receipt.");
for (const id of receipt.deferredPlayerIds) assert(!playerMap.has(id), `Held-only player shell was imported: ${id}`);

const relationshipOwner = new Map();
for (const player of players) {
  for (const reference of player.relationshipReferences ?? []) {
    const id = clean(reference.relationshipId);
    if (!id) continue;
    assert(!relationshipOwner.has(id), `Relationship ID is owned by multiple players: ${id}`);
    relationshipOwner.set(id, player.id);
  }
}
assert(receipt.relationshipIds.length === 346, "Receipt relationship ID set drifted.");
for (const id of receipt.relationshipIds) assert(relationshipOwner.has(id), `Imported relationship is missing: ${id}`);
for (const id of receipt.deferredRelationshipIds) assert(!relationshipOwner.has(id), `Held relationship was imported: ${id}`);
assert(relationshipOwner.get("indiana-pacers:IND-1978-0044:received:001:identity:01:player:nba-player-johnny-davis-e6de30e26d") === "nba-player-johnny-davis-reginald-15c9ceca6f", "1978 Johnny Davis relationship owner correction failed.");
assert(relationshipOwner.get("indiana-pacers:IND-1982-0065:sent:001:identity:01:player:nba-player-johnny-davis-e6de30e26d") === "nba-player-johnny-davis-reginald-15c9ceca6f", "1982 Johnny Davis relationship owner correction failed.");

const graph = buildPrivateRelationshipGraph({ trades, players, teams });
assert(graph.counts.invalidPlayerReferences === 0, "Invalid player references exist.");
assert(graph.counts.duplicateReferenceOwnership === 0, "Duplicate player-reference ownership exists.");
assert(graph.counts.extraPlayerReferences === 0, "Extra player references exist.");
assert(graph.counts.invalidTradeTeams === 0, "Unknown trade-team memberships exist.");
const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });
for (const [actual, expected, label] of [
  [query.counts.canonicalTrades, 1931, "query trades"],
  [query.counts.players, 2783, "query players"],
  [query.counts.representedTeams, 52, "represented teams"],
  [query.counts.uniqueTradeDates, 1357, "unique trade dates"],
  [query.counts.teamTradeMemberships, 4003, "team memberships"],
  [query.counts.playerTradeReferences, 2377, "player source references"],
  [query.counts.playerIdentityKeys, 2791, "player identity keys"],
  [query.counts.ambiguousExactIdentityKeys, 0, "ambiguous exact identity keys"],
  [query.counts.sharedPerspectiveTrades, 322, "shared perspective trades"],
  [routes.counts.routeModels, 4770, "route models"],
  [routes.counts.internalLinks, 17529, "internal NBA links"],
  [routes.counts.duplicatePaths, 0, "duplicate paths"],
  [routes.counts.brokenLinks, 0, "broken links"],
  [routes.counts.privacyViolations, 0, "privacy violations"],
  [routes.counts.routeCreatedModels, 0, "created route models"],
]) assert(actual === expected, `${label} drifted: ${actual} !== ${expected}.`);

for (const [actual, expected, label] of [
  [routes.counts.indexRouteModels, 4, "route index models"],
  [routes.counts.tradeDetailModels, 1931, "trade detail models"],
  [routes.counts.playerDetailModels, 2783, "player detail models"],
  [routes.counts.teamDetailModels, 52, "team detail models"],
  [routes.counts.indexToDetailLinks, 4766, "index to detail links"],
  [routes.counts.tradeToTeamLinks, 4003, "trade-to-team links"],
  [routes.counts.tradeToPlayerLinks, 2377, "trade-to-player links"],
  [routes.counts.playerToTradeLinks, 2377, "player-to-trade links"],
  [routes.counts.teamToTradeLinks, 4003, "team-to-trade links"],
  [routes.counts.sharedPerspectiveTradeModels, 322, "shared perspective route models"],
  [routes.counts.privateRouteModels, 4770, "private route models"],
  [routes.counts.noindexRouteModels, 4770, "noindex route models"],
  [routes.counts.adFreeRouteModels, 4770, "ad-free route models"],
  [routes.counts.sitemapExcludedRouteModels, 4770, "sitemap-excluded route models"],
  [routes.counts.navigationExcludedRouteModels, 4770, "navigation-excluded route models"],
  [routes.counts.crossNamespaceLinks, 0, "cross-namespace links"],
  [routes.counts.selfLinks, 0, "self links"],
  [routes.counts.incompleteModels, 0, "incomplete route models"],
]) assert(actual === expected, `${label} drifted: ${actual} !== ${expected}.`);

const result = {
  result: "PASS",
  phase: "14H",
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
    redundantReadyShellsExcluded: receipt.redundantReadyShellsExcluded,
    deferredPlayerShells: receipt.heldOnlyPlayerShellsDeferred,
    relationshipReferencesAdded: receipt.relationshipReferencesAdded,
    redundantReadyRelationshipEdgesExcluded: receipt.redundantReadyRelationshipEdgesExcluded,
    deferredRelationshipEdges: receipt.heldRelationshipEdgesDeferred,
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
