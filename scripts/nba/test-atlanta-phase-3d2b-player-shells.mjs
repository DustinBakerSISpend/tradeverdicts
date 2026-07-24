#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key}`);
    args[key.slice(2)] = value;
  }
  return args;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedTextHash(bytes) {
  return sha256(Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n"));
}

function normalizeIdentity(value) {
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

const args = parseArgs(process.argv);
for (const required of [
  "freeze-json",
  "phase-3c-json",
  "players-json",
  "trades-json",
  "teams-json",
  "receipt-json",
  "expected-freeze-sha256",
  "expected-baseline-player-sha256",
  "expected-trade-sha256",
  "starting-head",
]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, phase3cBytes, playerBytes, tradeBytes, teamBytes, receiptBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["phase-3c-json"]),
  readFile(args["players-json"]),
  readFile(args["trades-json"]),
  readFile(args["teams-json"]),
  readFile(args["receipt-json"]),
]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const phase3c = JSON.parse(phase3cBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));

const expectedFreezeSha256 = args["expected-freeze-sha256"].toLowerCase();
const expectedBaselineSha256 = args["expected-baseline-player-sha256"].toLowerCase();
const expectedTradeSha256 = args["expected-trade-sha256"].toLowerCase();

assert(sha256(freezeBytes) === expectedFreezeSha256, "Corrected freeze SHA mismatch.");
assert(sha256(tradeBytes) === expectedTradeSha256, "Canonical trade store changed.");
assert(normalizedTextHash(phase3cBytes) === freeze.inputHashes.phase3cPreviewSha256, "Phase 3C preview drifted.");
assert(Array.isArray(players) && players.length === 509, `Expected 509 player records, found ${players.length}.`);
assert(Array.isArray(trades) && trades.length === 27, `Expected 27 trade records, found ${trades.length}.`);

const imported = players.filter((player) => player.importMetadata?.phase === "3D2B");
const baseline = players.filter((player) => player.importMetadata?.phase !== "3D2B");
assert(imported.length === 442, `Expected 442 Phase 3D2B players, found ${imported.length}.`);
assert(baseline.length === 67, `Expected 67 baseline players, found ${baseline.length}.`);
assert(
  sha256(Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`, "utf8")) === expectedBaselineSha256,
  "Baseline player records changed.",
);

const manifest = freeze.playerManifest.filter((entry) => entry.importAction === "create-new-player");
const manifestById = new Map(manifest.map((entry) => [entry.playerId, entry]));
assert(manifestById.size === 442, "Corrected freeze does not contain 442 unique player creates.");

let pendingRelationshipEdges = 0;
const pendingReferenceKeys = [];
for (const player of imported) {
  const entry = manifestById.get(player.id);
  assert(entry, `${player.id}: not authorized by the corrected freeze.`);
  assert(player.name === entry.preferredName, `${player.id}: name mismatch.`);
  assert(player.normalizedName === entry.normalizedName, `${player.id}: normalized-name mismatch.`);
  assert(player.slug === entry.slug, `${player.id}: slug mismatch.`);
  assert(player.sourceFreezeSha256 === entry.freezeSha256, `${player.id}: freeze hash mismatch.`);
  assert(player.league === "nba", `${player.id}: league mismatch.`);
  assert(player.identityStatus === "source-derived-shell", `${player.id}: identity status mismatch.`);
  assert(player.externalIdentityStatus === "unverified", `${player.id}: external identity must remain unverified.`);
  assert(player.reviewStatus === "identity-imported-links-pending", `${player.id}: review status mismatch.`);
  assert(player.publishStatus === "private", `${player.id}: publish status mismatch.`);
  assert(player.indexEligible === false, `${player.id}: index eligibility mismatch.`);
  assert(player.adEligible === false, `${player.id}: ad eligibility mismatch.`);
  assert(player.publicationReady === false, `${player.id}: publication status mismatch.`);
  assert(player.automaticMerge === false, `${player.id}: automatic merge enabled.`);
  assert(player.playerImportPerformed === true, `${player.id}: import marker missing.`);
  assert(player.referenceCount === 0 && player.sourceTradeCount === 0, `${player.id}: active relationship counts must remain zero.`);
  assert(player.sourceTradeIds.length === 0 && player.canonicalTradeIds.length === 0, `${player.id}: active trade links must remain empty.`);
  assert(player.sourceReferences.length === 0, `${player.id}: active source references must remain empty.`);
  assert(player.pendingRelationshipCount === player.pendingSourceReferences.length, `${player.id}: pending relationship count mismatch.`);
  assert(player.pendingRelationshipCount > 0, `${player.id}: no pending relationships.`);
  assert(player.importMetadata?.sourceCheckpoint === args["starting-head"], `${player.id}: checkpoint mismatch.`);
  assert(player.importMetadata?.sourceFreezeSha256 === expectedFreezeSha256, `${player.id}: import freeze mismatch.`);
  assert(player.importMetadata?.relationshipPolicy === "frozen-edges-staged-as-pending-until-canonical-import", `${player.id}: relationship policy mismatch.`);
  pendingRelationshipEdges += player.pendingRelationshipCount;
  for (const reference of player.pendingSourceReferences) {
    assert(reference.relationshipStatus === "pending-canonical-import", `${player.id}: pending relationship status mismatch.`);
    assert(reference.edgeId && reference.edgeFreezeSha256, `${player.id}: frozen edge provenance missing.`);
    pendingReferenceKeys.push(`${reference.canonicalTradeId}|${reference.assetId}|${reference.referenceType}`);
  }
}
assert(pendingRelationshipEdges === 549, `Expected 549 pending relationship edges, found ${pendingRelationshipEdges}.`);
assert(new Set(pendingReferenceKeys).size === 549, "Pending relationship keys are not unique.");

const ids = players.map((player) => player.id);
const slugs = players.map((player) => player.slug);
assert(new Set(ids).size === players.length, "Duplicate player IDs.");
assert(new Set(slugs).size === players.length, "Duplicate player slugs.");

const identityOwners = new Map();
for (const player of players) {
  for (const identity of [player.name, ...(player.aliases ?? [])]) {
    const key = normalizeIdentity(identity);
    assert(key, `${player.id}: empty exact identity key.`);
    if (!identityOwners.has(key)) identityOwners.set(key, new Set());
    identityOwners.get(key).add(player.id);
  }
}
const ambiguousIdentityKeys = [...identityOwners.entries()].filter(([, owners]) => owners.size > 1);
assert(ambiguousIdentityKeys.length === 0, `Exact player identity collisions: ${JSON.stringify(ambiguousIdentityKeys)}`);

assert(receipt.result === "PASS" && receipt.phase === "3D2B", "Unexpected import receipt.");
assert(receipt.startingHead === args["starting-head"], "Receipt checkpoint mismatch.");
assert(receipt.sourceFreezeSha256 === expectedFreezeSha256, "Receipt freeze mismatch.");
assert(receipt.preImportPlayerRecords === 67, "Receipt pre-import count mismatch.");
assert(receipt.importedPlayerShells === 442, "Receipt import count mismatch.");
assert(receipt.postImportPlayerRecords === 509, "Receipt post-import count mismatch.");
assert(receipt.pendingRelationshipEdges === 549, "Receipt pending-edge count mismatch.");
assert(receipt.activeRelationshipEdgesAdded === 0, "Receipt active-edge count must be zero.");
assert(receipt.canonicalTradesImported === 0 && receipt.canonicalStoreModified === false, "Receipt reports canonical writes.");
assert(receipt.automaticPlayerMerges === 0, "Receipt reports automatic player merges.");
assert(receipt.playerStoreSha256 === sha256(playerBytes), "Receipt player-store hash mismatch.");
assert(new Set(receipt.playerIds).size === 442, "Receipt player IDs are not unique.");

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });
assert(query.counts.canonicalTrades === 27, "Query trade count mismatch.");
assert(query.counts.players === 509, "Query player count mismatch.");
assert(query.counts.representedTeams === 25, "Query represented-team count mismatch.");
assert(query.counts.playerTradeReferences === 90, "Player relationships were activated too early.");
assert(query.counts.ambiguousExactIdentityKeys === 0, "Query identity collisions exist.");
assert(routes.counts.routeModels === 565, `Expected 565 private route models, found ${routes.counts.routeModels}.`);
assert(routes.counts.tradeDetailModels === 27, "Trade route count mismatch.");
assert(routes.counts.playerDetailModels === 509, "Player route count mismatch.");
assert(routes.counts.teamDetailModels === 25, "Team route count mismatch.");
assert(routes.counts.internalLinks === 876, `Expected 876 private internal links, found ${routes.counts.internalLinks}.`);
assert(routes.counts.brokenLinks === 0, "Broken private route links exist.");
assert(routes.counts.privacyViolations === 0, "Private route privacy violation.");
assert(routes.counts.routeCreatedModels === 0, "A route model is marked remotely created.");

const importedIds = new Set(imported.map((player) => player.id));
const importedModels = routes.models.filter((model) =>
  model.routeType === "player_detail" && importedIds.has(model.entityId),
);
assert(importedModels.length === 442, "Imported player route-model count mismatch.");
assert(importedModels.every((model) => model.linkedTradeCount === 0 && model.links.length === 0), "A player shell has an active trade link.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "3D2B",
  baselinePlayerRecords: 67,
  importedPlayerShells: 442,
  totalPlayerRecords: 509,
  pendingRelationshipEdges: 549,
  activeRelationshipEdges: 0,
  identityCollisions: 0,
  automaticPlayerMerges: 0,
  canonicalStoreRecords: 27,
  canonicalStoreModified: false,
  privateRouteModels: routes.counts.routeModels,
  playerRouteModels: routes.counts.playerDetailModels,
  privateInternalLinks: routes.counts.internalLinks,
  playerStoreSha256: sha256(playerBytes),
  receiptSha256: sha256(receiptBytes),
  repositoryDataWritesValidated: 2,
}, null, 2));
