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

assert(receipt.result === "PASS" && receipt.phase === "18H", "Invalid Phase 18H receipt.");
for (const [actual, expected, label] of [
  [trades.length, receipt.preImportCanonicalTrades + receipt.canonicalTradesCreated, "canonical trades"],
  [players.length, receipt.preImportPlayers + receipt.playerShellsCreated, "players"],
  [teams.length, receipt.preImportTeams, "teams"],
  [receipt.readyPackages, 75, "ready packages"],
  [receipt.heldPackages, 12, "held packages"],
  [receipt.structuralEvidenceExclusions, 11, "exclusions"],
  [receipt.canonicalTradesCreated, 37, "canonical creates"],
  [receipt.perspectivesAppended, 38, "perspective appends"],
  [receipt.playerShellsCreated, 28, "player shells"],
  [receipt.readyShellsResolvedToExistingPlayers, 1, "resolved ready shells"],
  [receipt.heldOnlyPlayerShellsDeferred, 6, "held-only shells"],
  [receipt.relationshipReferencesAdded, 204, "relationship references"],
  [receipt.heldRelationshipEdgesDeferred, 58, "held relationships"],
  [receipt.readyTeamDependencies, 149, "frozen ready team dependencies"],
  [receipt.effectiveReadyTeamDependencies, 150, "effective ready team dependencies"],
  [receipt.heldTeamDependencies, 37, "held team dependencies"],
  [receipt.existingPerspectiveReviewHolds, 0, "existing-perspective review holds"],
  [receipt.ambiguousIdentityOccurrencesDeferred, 2, "ambiguous identity occurrences deferred"],
]) assert(actual === expected, `${label} drifted: ${actual} !== ${expected}.`);

assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route creation occurred.");
assert(receipt.automaticTeamRegistrations === 0, "Automatic team registration occurred.");
assert(receipt.heldPackageImports === 0, "Held package import occurred.");
assert(receipt.heldPlayerShellImports === 0, "Held-only shell import occurred.");
assert(receipt.heldRelationshipWrites === 0, "Held relationship write occurred.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");

const teamCorrections = receipt.explicitTeamDependencyCorrections ?? {};
assert(
  Object.keys(teamCorrections).length === 1 &&
    teamCorrections["MIA-2005-0037"]?.sourcePartnerTeam === "Bobcats" &&
    teamCorrections["MIA-2005-0037"]?.sourceCounterpartSlugs === "" &&
    teamCorrections["MIA-2005-0037"]?.sourceTeamSlug === "charlotte-bobcats" &&
    teamCorrections["MIA-2005-0037"]?.canonicalTeamSlug === "charlotte-hornets",
  "The locked MIA-2005-0037 Bobcats/Charlotte team-dependency correction is missing or drifted."
);

assert(
  receipt.matchedExistingAssetReferences + receipt.syntheticPerspectiveAssetReferences === 204,
  "Relationship asset-reference accounting drifted."
);
assert(receipt.explicitRelationshipTargetCorrections && Object.keys(receipt.explicitRelationshipTargetCorrections).length === 0, "Unexpected relationship target correction exists.");

const playerCorrections = receipt.explicitPlayerTargetCorrections ?? {};
assert(
  Object.keys(playerCorrections).length === 1 &&
    playerCorrections["nba-player-a-j-hammons"] ===
      "nba-player-aj-hammons-10e57ab027",
  "The diagnostic A.J. Hammons existing-player correction is missing or drifted."
);
assert(
  Array.isArray(receipt.readyShellsResolvedToExistingPlayerIds) &&
    receipt.readyShellsResolvedToExistingPlayerIds.length === 1 &&
    receipt.readyShellsResolvedToExistingPlayerIds[0] ===
      "nba-player-aj-hammons-10e57ab027",
  "Resolved A.J. Hammons player-ID evidence is missing."
);

const ajHammonsCorrectionEvidence =
  receipt.explicitPlayerTargetCorrectionEvidence?.[
    "nba-player-a-j-hammons"
  ];

assert(
  ajHammonsCorrectionEvidence?.resolvedPlayerId ===
    "nba-player-aj-hammons-10e57ab027" &&
    Array.isArray(ajHammonsCorrectionEvidence.sharedExactIdentityKeys) &&
    ajHammonsCorrectionEvidence.sharedExactIdentityKeys.length > 0 &&
    ajHammonsCorrectionEvidence.diagnosticJsonSha256 ===
      "C0B0C3BF2E675D7F7ED614DB249B6070034C67BCC968C4005DB118F1C2ACDE71" &&
    ajHammonsCorrectionEvidence.diagnosticCsvSha256 ===
      "D8A7FF60BFC168349A7C7D8DB7BB9606A42C27A5E2EC1B0F79FB63986D6FBD99",
  "A.J. Hammons exact-identity diagnostic evidence is missing or drifted."
);
assert(
  Array.isArray(receipt.forcedSyntheticRelationshipIds),
  "Synthetic relationship ID accounting is missing.",
);

const ownershipConflictSyntheticIds =
  receipt.ownershipConflictSyntheticRelationshipIds ?? [];
const ownershipConflictSyntheticDetails =
  receipt.ownershipConflictSyntheticDetails ?? [];

assert(
  new Set(ownershipConflictSyntheticIds).size ===
    ownershipConflictSyntheticIds.length,
  "Ownership-conflict synthetic IDs are not unique.",
);
assert(
  JSON.stringify([...receipt.forcedSyntheticRelationshipIds].sort()) ===
    JSON.stringify([...ownershipConflictSyntheticIds].sort()),
  "A synthetic perspective-local relationship exists without an ownership-conflict explanation.",
);
assert(
  ownershipConflictSyntheticDetails.length ===
    ownershipConflictSyntheticIds.length,
  "Ownership-conflict synthetic detail count drifted.",
);
assert(
  ownershipConflictSyntheticDetails.every(
    (detail) =>
      ownershipConflictSyntheticIds.includes(detail.relationshipId) &&
      detail.existingOwnerPlayerId &&
      detail.frozenTargetPlayerId &&
      detail.existingOwnerPlayerId !== detail.frozenTargetPlayerId &&
      detail.matchedCanonicalAssetId &&
      detail.syntheticAssetId,
  ),
  "Ownership-conflict synthetic detail evidence is incomplete.",
);

const registry = createNbaTeamRegistry(teams);
const tradeMap = new Map(trades.map((trade) => [trade.id, trade]));
for (const id of receipt.updatedPerspectiveCanonicalIds) {
  const trade = tradeMap.get(id);
  assert(trade, `Updated perspective target missing: ${id}`);
  const perspectiveCount = Array.isArray(trade.perspectives)
    ? trade.perspectives.filter((perspective) => clean(perspective?.sourceTeam) === "miami-heat").length
    : Object.prototype.hasOwnProperty.call(trade.perspectives ?? {}, "miami-heat") ? 1 : 0;
  assert(perspectiveCount === 1, `${id}: target does not retain exactly one Miami perspective.`);
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
assert(
  graph.counts.invalidPlayerReferences === 0,
  `Invalid player references exist: ${JSON.stringify(graph.issues.invalidPlayerReferences)}`
);
assert(
  graph.counts.duplicateReferenceOwnership === 0,
  `Duplicate player-reference ownership exists: ${JSON.stringify(graph.issues.duplicateReferenceOwnership)}`
);
assert(
  graph.counts.extraPlayerReferences === 0,
  `Extra player references exist: ${JSON.stringify(graph.issues.extraPlayerReferences)}`
);
assert(
  graph.counts.invalidTradeTeams === 0,
  `Invalid trade-team memberships exist: ${JSON.stringify(graph.issues.invalidTradeTeams)}`
);

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });

for (const [actual, expected, label] of [
  [query.counts.canonicalTrades, trades.length, "query trades"],
  [query.counts.players, players.length, "query players"],
  [query.counts.representedTeams, teams.length, "represented teams"],
  [query.counts.ambiguousExactIdentityKeys, 0, "ambiguous identities"],
  [routes.counts.duplicatePaths, 0, "duplicate paths"],
  [routes.counts.brokenLinks, 0, "broken links"],
  [routes.counts.privacyViolations, 0, "privacy violations"],
  [routes.counts.routeCreatedModels, 0, "created route models"],
]) assert(actual === expected, `${label} drifted: ${actual} !== ${expected}.`);

assert(query.counts.playerTradeReferences >= receipt.relationshipReferencesAdded, "Private query player-reference count is unexpectedly low.");
assert(routes.counts.routeModels > 0 && routes.counts.internalLinks > 0, "Private route model audit produced no route graph.");

const result = {
  result: "PASS",
  phase: "18H",
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
    effectiveReadyTeamDependencies: receipt.effectiveReadyTeamDependencies,
    heldTeamDependencies: receipt.heldTeamDependencies,
    existingPerspectiveReviewHolds: receipt.existingPerspectiveReviewHolds,
    ambiguousIdentityOccurrencesDeferred: receipt.ambiguousIdentityOccurrencesDeferred,
    matchedExistingAssetReferences: receipt.matchedExistingAssetReferences,
    syntheticPerspectiveAssetReferences: receipt.syntheticPerspectiveAssetReferences,
    ownershipConflictSyntheticReferences:
      ownershipConflictSyntheticIds.length,
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
