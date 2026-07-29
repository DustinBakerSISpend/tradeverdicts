#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function clean(value) { return String(value ?? "").trim(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function sourcePerspectiveCount(trade, team) {
  const p = trade?.perspectives;
  if (Array.isArray(p)) return p.filter((row) => clean(row?.sourceTeam ?? row?.teamId ?? row?.team ?? row?.perspectiveTeam) === team).length;
  if (p && typeof p === "object") return Object.prototype.hasOwnProperty.call(p, team) ? 1 : 0;
  return 0;
}
const args = parseArgs(process.argv);
for (const key of ["repo-root","trades-json","players-json","teams-json","receipt-json","output-json","expected-canonical-store-sha256","expected-player-store-sha256","expected-team-store-sha256"]) {
  assert(args[key], `Missing --${key}`);
}

const repoRoot = path.resolve(args["repo-root"]);
async function repoImport(relative) {
  return import(pathToFileURL(path.join(repoRoot, ...relative.split("/"))).href);
}
const { buildPrivateRelationshipGraph } = await repoImport("src/lib/nba/build-private-relationship-graph.mjs");
const { buildPrivateQueryIndex } = await repoImport("src/lib/nba/build-private-query-index.mjs");
const { buildPrivateRouteModels } = await repoImport("src/lib/nba/build-private-route-models.mjs");
const { createNbaTeamRegistry } = await repoImport("src/lib/nba/team-registry.mjs");
const { validateCanonicalNbaTrade } = await repoImport("src/lib/nba/validate-canonical-trade.mjs");

const tradeBytes = await readFile(args["trades-json"]);
const playerBytes = await readFile(args["players-json"]);
const teamBytes = await readFile(args["teams-json"]);
const receiptBytes = await readFile(args["receipt-json"]);
assert(sha256(tradeBytes) === args["expected-canonical-store-sha256"], "Canonical store hash differs from shadow freeze.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Player store hash differs from shadow freeze.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Team store hash differs from shadow freeze.");

const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));

assert(receipt.result === "PASS" && receipt.phase === "19H" && receipt.team === "milwaukee-bucks", "Receipt metadata invalid.");
for (const [actual, expected, label] of [
  [receipt.readyPackages,163,"ready packages"],
  [receipt.heldPackages,31,"held packages"],
  [receipt.structuralEvidenceExclusions,7,"structural exclusions"],
  [receipt.canonicalTradesCreated,71,"canonical creates"],
  [receipt.perspectivesAppended,92,"perspective appends"],
  [receipt.playerShellsCreated,66,"player shells"],
  [receipt.readyShellsResolvedToExistingPlayers,3,"resolved existing shells"],
  [receipt.heldOnlyPlayerShellsDeferred,20,"held-only shells"],
  [receipt.relationshipReferencesAdded,428,"relationship refs"],
  [receipt.heldRelationshipEdgesDeferred,130,"held relationship refs"],
  [receipt.readyTeamDependencies,326,"ready team deps"],
  [receipt.heldTeamDependencies,89,"held team deps"],
  [receipt.existingPerspectiveReviewHolds,0,"existing perspective holds"],
  [receipt.ambiguousIdentityOccurrencesDeferred,2,"ambiguous identities deferred"],
  [trades.length,2249,"canonical trade count"],
  [players.length,3093,"player count"],
  [teams.length,52,"team count"],
]) assert(actual === expected, `${label} drifted: expected ${expected}, received ${actual}`);

assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticPlayerCreates === 0, "Automatic player create occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route creation occurred.");
assert(receipt.automaticTeamRegistrations === 0, "Automatic team registration occurred.");
assert(receipt.heldPackageImports === 0, "Held package import occurred.");
assert(receipt.heldPlayerShellImports === 0, "Held-only shell import occurred.");
assert(receipt.heldRelationshipWrites === 0, "Held relationship write occurred.");
assert(receipt.publicationAuthorized === false && receipt.pushPerformed === false && receipt.deployPerformed === false, "Publication/push/deploy safety drifted.");
assert(receipt.matchedExistingAssetReferences + receipt.syntheticPerspectiveAssetReferences === 428, "Asset reference total drifted.");
assert(Array.isArray(receipt.exactExistingPlayerOverrides) && receipt.exactExistingPlayerOverrides.length === 3, "Exact existing-player override receipt count drifted.");
const exactOverrideMap = new Map(receipt.exactExistingPlayerOverrides.map((row) => [row.proposedPlayerId, row.existingPlayerId]));
for (const [proposed, existing] of [
  ["nba-player-d-j-augustin-62f0387e0b", "nba-player-dj-augustin-7b32f3fe01"],
  ["nba-player-o-g-anunoby-2b0d93df9f", "nba-player-og-anunoby"],
  ["nba-player-r-j-hampton-0a2d6dcc68", "nba-player-rj-hampton-62cbde2ae5"],
]) {
  assert(exactOverrideMap.get(proposed) === existing, `Exact identity override drifted: ${proposed} -> ${exactOverrideMap.get(proposed)}`);
  assert(players.some((player) => clean(player.id) === existing), `Resolved existing player missing: ${existing}`);
  assert(!players.some((player) => clean(player.id) === proposed), `Proposed duplicate player shell was created: ${proposed}`);
}

const registry = createNbaTeamRegistry(teams);
const tradeMap = new Map(trades.map((trade) => [clean(trade.id ?? trade.tradeId), trade]));
for (const id of receipt.updatedPerspectiveCanonicalIds) {
  const trade = tradeMap.get(id);
  assert(trade, `Updated perspective target missing: ${id}`);
  assert(sourcePerspectiveCount(trade, "milwaukee-bucks") === 1, `${id}: expected exactly one Milwaukee perspective.`);
}
for (const id of receipt.importedCanonicalTradeIds) {
  const trade = tradeMap.get(id);
  assert(trade, `Created canonical trade missing: ${id}`);
  const validation = validateCanonicalNbaTrade(trade, registry);
  assert(validation.valid, `${id}: canonical validation failed: ${(validation.errors ?? []).join("; ")}`);
}

for (const trade of trades) {
  assert(trade.publishStatus === "private" && trade.indexEligible === false && trade.adEligible === false && trade.publicationReady === false, `${trade.id}: trade privacy drifted.`);
}
for (const player of players) {
  assert(player.publishStatus === "private" && player.indexEligible === false && player.adEligible === false && player.publicationReady === false, `${player.id}: player privacy drifted.`);
}

const graph = buildPrivateRelationshipGraph({ trades, players, teams });
assert(graph.counts.invalidPlayerReferences === 0, "Invalid player references exist.");
assert(graph.counts.duplicateReferenceOwnership === 0, "Duplicate relationship/source-reference ownership exists.");
assert(graph.counts.extraPlayerReferences === 0, "Extra player references exist.");
assert(graph.counts.invalidTradeTeams === 0, "Invalid trade-team memberships exist.");

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });
assert(query.counts.canonicalTrades === trades.length, "Private query canonical-trade count drifted.");
assert(query.counts.players === players.length, "Private query player count drifted.");
assert(query.counts.playerTradeReferences >= receipt.relationshipReferencesAdded, "Private query player-reference count is unexpectedly low.");
assert(routes.counts.routeModels > 0 && routes.counts.internalLinks > 0, "Private route model audit produced no route graph.");

const result = {
  result:"PASS",
  phase:"19H",
  mode:"GUARDED_PRIVATE_IMPORT_AUDIT",
  counts:{
    canonicalTrades:trades.length,
    players:players.length,
    teams:teams.length,
    readyPackages:receipt.readyPackages,
    heldPackages:receipt.heldPackages,
    structuralEvidenceExclusions:receipt.structuralEvidenceExclusions,
    canonicalTradesCreated:receipt.canonicalTradesCreated,
    perspectivesAppended:receipt.perspectivesAppended,
    playerShellsCreated:receipt.playerShellsCreated,
    deferredPlayerShells:receipt.heldOnlyPlayerShellsDeferred,
    relationshipReferencesAdded:receipt.relationshipReferencesAdded,
    deferredRelationshipEdges:receipt.heldRelationshipEdgesDeferred,
    readyTeamDependencies:receipt.readyTeamDependencies,
    heldTeamDependencies:receipt.heldTeamDependencies,
    ambiguousIdentityOccurrencesDeferred:receipt.ambiguousIdentityOccurrencesDeferred,
    matchedExistingAssetReferences:receipt.matchedExistingAssetReferences,
    syntheticPerspectiveAssetReferences:receipt.syntheticPerspectiveAssetReferences,
    ownershipConflictSyntheticReferences:(receipt.ownershipConflictSyntheticRelationshipIds ?? []).length,
    sourceReferencesAdded:receipt.sourceReferencesAdded,
    privateQueryPlayerReferences:query.counts.playerTradeReferences,
    routeModels:routes.counts.routeModels,
    internalLinks:routes.counts.internalLinks,
  },
  hashes:{
    canonicalStoreSha256:sha256(tradeBytes),
    playerStoreSha256:sha256(playerBytes),
    teamStoreSha256:sha256(teamBytes),
    receiptSha256:sha256(receiptBytes),
  },
  safety:{
    invalidPlayerReferences:graph.counts.invalidPlayerReferences,
    duplicateReferenceOwnership:graph.counts.duplicateReferenceOwnership,
    extraPlayerReferences:graph.counts.extraPlayerReferences,
    invalidTradeTeams:graph.counts.invalidTradeTeams,
    heldPackageImports:0,
    heldPlayerShellImports:0,
    heldRelationshipWrites:0,
    automaticCanonicalMerges:0,
    automaticIdentityMerges:0,
    automaticRoutes:0,
    teamRegistryWrites:0,
    publicationAuthorized:false,
    pushPerformed:false,
    deployPerformed:false,
  },
};
await mkdir(path.dirname(path.resolve(args["output-json"])), { recursive:true });
await writeFile(args["output-json"], canonicalJson(result));
console.log(JSON.stringify(result, null, 2));
