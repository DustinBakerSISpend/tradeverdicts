#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    String(left).localeCompare(String(right), "en"),
  );
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

async function atomicWrite(filePath, bytes, suffix) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${suffix}-${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const args = parseArgs(process.argv);
for (const required of [
  "freeze-json",
  "phase-3c-json",
  "players-json",
  "trades-json",
  "receipt-json",
  "expected-freeze-sha256",
  "expected-player-store-sha256",
  "expected-trade-store-sha256",
  "imported-at",
  "starting-head",
]) {
  assert(args[required], `Missing --${required}`);
}

const expectedFreezeSha256 = args["expected-freeze-sha256"].toLowerCase();
const expectedPlayerStoreSha256 = args["expected-player-store-sha256"].toLowerCase();
const expectedTradeStoreSha256 = args["expected-trade-store-sha256"].toLowerCase();

const [freezeBytes, phase3cBytes, playerBytes, tradeBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["phase-3c-json"]),
  readFile(args["players-json"]),
  readFile(args["trades-json"]),
]);

assert(sha256(freezeBytes) === expectedFreezeSha256, "Corrected freeze SHA-256 mismatch.");
assert(sha256(tradeBytes) === expectedTradeStoreSha256, "Canonical trade store changed before player-shell import.");

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const phase3c = JSON.parse(phase3cBytes.toString("utf8"));
const currentPlayers = JSON.parse(playerBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));

assert(Array.isArray(currentPlayers), "Player store must be a JSON array.");
assert(Array.isArray(trades) && trades.length === 27, `Expected 27 canonical trades, found ${trades.length}.`);
assert(freeze.result === "PASS" && freeze.phase === "3D1", "Unexpected corrected freeze.");
assert(freeze.mode === "IMMUTABLE_IMPORT_ELIGIBILITY_FREEZE_ONLY", "Unexpected corrected freeze mode.");
assert(freeze.counts.createNewPlayers === 442, "Expected 442 approved new players.");
assert(freeze.counts.useExistingPlayers === 7, "Expected seven approved existing-player uses.");
assert(freeze.counts.frozenPlayerTradeEdges === 556, "Expected 556 frozen player-trade edges.");
assert(phase3c.result === "PASS" && phase3c.phase === "3C", "Unexpected corrected Phase 3C preview.");
assert(
  normalizedTextHash(phase3cBytes) === freeze.inputHashes.phase3cPreviewSha256,
  "Phase 3C preview does not match the corrected freeze.",
);

const manifest = freeze.playerManifest.filter((entry) => entry.importAction === "create-new-player");
assert(manifest.length === 442, `Expected 442 create-new-player entries, found ${manifest.length}.`);
const manifestById = new Map(manifest.map((entry) => [entry.playerId, entry]));
assert(manifestById.size === manifest.length, "Duplicate create-new-player manifest IDs.");

const identities = phase3c.playerIdentity?.identities ?? [];
const identityById = new Map();
for (const identity of identities) {
  const playerId = identity.provisionalPlayerId ?? identity.existingPlayerId;
  if (!playerId) continue;
  assert(!identityById.has(playerId), `Duplicate Phase 3C identity ID: ${playerId}`);
  identityById.set(playerId, identity);
}

const frozenEdges = freeze.relationships?.playerTradeEdges ?? [];
const createEdges = frozenEdges
  .filter((edge) => manifestById.has(edge.playerId))
  .sort((left, right) => left.edgeId.localeCompare(right.edgeId, "en"));
assert(createEdges.length === 549, `Expected 549 frozen edges for new players, found ${createEdges.length}.`);

const edgesByPlayer = new Map();
for (const edge of createEdges) {
  if (!edgesByPlayer.has(edge.playerId)) edgesByPlayer.set(edge.playerId, []);
  edgesByPlayer.get(edge.playerId).push(edge);
}
assert(edgesByPlayer.size === 442, `Expected edges for 442 new players, found ${edgesByPlayer.size}.`);

const expectedNewIds = new Set(manifest.map((entry) => entry.playerId));
const baselinePlayers = currentPlayers.filter((player) => !expectedNewIds.has(player.id));
const presentNewPlayers = currentPlayers.filter((player) => expectedNewIds.has(player.id));
const baselineBytes = canonicalJson(baselinePlayers);
assert(
  sha256(baselineBytes) === expectedPlayerStoreSha256,
  "The non-Atlanta baseline player records do not match the guarded pre-import player store.",
);
assert(baselinePlayers.length === 67, `Expected 67 baseline players, found ${baselinePlayers.length}.`);

const importedAt = args["imported-at"];
const newPlayers = manifest
  .slice()
  .sort((left, right) =>
    left.preferredName.localeCompare(right.preferredName, "en") ||
    left.playerId.localeCompare(right.playerId, "en"),
  )
  .map((entry) => {
    const identity = identityById.get(entry.playerId);
    assert(identity, `${entry.playerId}: missing Phase 3C identity.`);
    assert(identity.identityAction === "create-new-player-preview", `${entry.playerId}: unexpected identity action.`);
    assert(identity.provisionalPlayerId === entry.playerId, `${entry.playerId}: provisional ID mismatch.`);
    assert(identity.playerDataReady === true, `${entry.playerId}: identity is not player-data-ready.`);
    assert(identity.automaticMerge === false, `${entry.playerId}: automatic merge is enabled.`);
    assert(entry.playerDataReady === true, `${entry.playerId}: freeze manifest is not player-data-ready.`);
    assert(entry.blockers.length === 0, `${entry.playerId}: freeze manifest contains blockers.`);
    assert(entry.publishStatus === "private", `${entry.playerId}: freeze privacy failure.`);
    assert(entry.indexEligible === false && entry.adEligible === false, `${entry.playerId}: freeze eligibility failure.`);
    assert(entry.automaticMerge === false, `${entry.playerId}: freeze automatic merge enabled.`);

    const playerEdges = (edgesByPlayer.get(entry.playerId) ?? []).slice().sort((left, right) =>
      left.edgeId.localeCompare(right.edgeId, "en"),
    );
    assert(playerEdges.length > 0, `${entry.playerId}: no frozen pending relationships.`);

    const matchedReferences = [];
    for (const edge of playerEdges) {
      assert(edge.playerAction === "create-new-player-preview", `${entry.playerId}: unexpected frozen edge action.`);
      assert(edge.relationshipImportReady === true, `${entry.playerId}: frozen edge is not import-ready.`);
      const matches = identity.sourceReferences.filter((reference) =>
        reference.canonicalTradeId === edge.canonicalTradeId &&
        reference.sourceTradeId === edge.sourceTradeId &&
        reference.assetId === edge.assetId &&
        reference.referenceType === edge.referenceType
      );
      assert(matches.length === 1, `${entry.playerId}: frozen edge did not match exactly one source reference.`);
      matchedReferences.push({
        ...matches[0],
        edgeId: edge.edgeId,
        edgeFreezeSha256: edge.freezeSha256,
        relationshipStatus: "pending-canonical-import",
      });
    }

    const sourceVariants = uniqueSorted(identity.sourceVariants ?? []);
    const aliases = sourceVariants.filter((value) => value !== identity.preferredName);
    const pendingReferenceKeys = matchedReferences.map((reference) =>
      `${reference.canonicalTradeId}|${reference.assetId}|${reference.referenceType}`,
    );
    assert(new Set(pendingReferenceKeys).size === pendingReferenceKeys.length, `${entry.playerId}: duplicate pending references.`);

    return {
      id: entry.playerId,
      league: "nba",
      name: entry.preferredName,
      normalizedName: entry.normalizedName,
      slug: entry.slug,
      aliases,
      sourceCandidateId: `atlanta-hawks-phase-3d2a:${entry.playerId}`,
      identityStatus: "source-derived-shell",
      externalIdentityStatus: "unverified",
      externalIds: {},
      referenceCount: 0,
      sourceTradeCount: 0,
      sourceTradeIds: [],
      canonicalTradeIds: [],
      referenceTypes: [],
      teams: [],
      draftReferences: [],
      sourceReferences: [],
      pendingRelationshipCount: matchedReferences.length,
      pendingSourceTradeIds: uniqueSorted(playerEdges.map((edge) => edge.sourceTradeId)),
      pendingCanonicalTradeIds: uniqueSorted(playerEdges.map((edge) => edge.canonicalTradeId)),
      pendingReferenceTypes: uniqueSorted(playerEdges.map((edge) => edge.referenceType)),
      pendingTeams: uniqueSorted(matchedReferences.flatMap((reference) => reference.teams ?? [])),
      pendingSourceReferences: matchedReferences,
      sourceFreezeSha256: entry.freezeSha256,
      aliasDecision: aliases.length > 0
        ? {
            reason: "Frozen source-name variants retained without automatic merging.",
            sourceTradeIds: uniqueSorted(playerEdges.map((edge) => edge.sourceTradeId)),
          }
        : null,
      publishStatus: "private",
      reviewStatus: "identity-imported-links-pending",
      indexEligible: false,
      adEligible: false,
      publicationReady: false,
      automaticMerge: false,
      playerImportPerformed: true,
      createdAt: importedAt,
      updatedAt: importedAt,
      importMetadata: {
        phase: "3D2B",
        batchId: "atlanta-hawks-phase-3d2b-player-shells",
        importedAt,
        sourceFreezeSha256: expectedFreezeSha256,
        sourcePhase3cSha256: normalizedTextHash(phase3cBytes),
        sourcePlayerStoreSha256: expectedPlayerStoreSha256,
        sourceCanonicalStoreSha256: expectedTradeStoreSha256,
        sourceCheckpoint: args["starting-head"],
        identityPolicy: "exact-frozen-player-id-and-slug-no-automatic-merge",
        relationshipPolicy: "frozen-edges-staged-as-pending-until-canonical-import",
        visibilityPolicy: "private-noindex-ad-free",
      },
    };
  });

const newIds = newPlayers.map((player) => player.id);
const newSlugs = newPlayers.map((player) => player.slug);
assert(new Set(newIds).size === newIds.length, "Duplicate imported player IDs.");
assert(new Set(newSlugs).size === newSlugs.length, "Duplicate imported player slugs.");

const baselineIds = new Set(baselinePlayers.map((player) => player.id));
const baselineSlugs = new Set(baselinePlayers.map((player) => player.slug));
for (const player of newPlayers) {
  assert(!baselineIds.has(player.id), `Player ID collides with baseline: ${player.id}`);
  assert(!baselineSlugs.has(player.slug), `Player slug collides with baseline: ${player.slug}`);
}

const identityOwners = new Map();
for (const player of [...baselinePlayers, ...newPlayers]) {
  for (const value of [player.name, ...(player.aliases ?? [])]) {
    const key = normalizeIdentity(value);
    assert(key, `${player.id}: empty exact identity key.`);
    if (!identityOwners.has(key)) identityOwners.set(key, new Set());
    identityOwners.get(key).add(player.id);
  }
}
const ambiguousIdentityKeys = [...identityOwners.entries()].filter(([, owners]) => owners.size > 1);
assert(ambiguousIdentityKeys.length === 0, `Exact identity collisions: ${JSON.stringify(ambiguousIdentityKeys)}`);

const expectedPlayers = [...baselinePlayers, ...newPlayers];
const expectedPlayerBytes = canonicalJson(expectedPlayers);
const expectedPostSha256 = sha256(expectedPlayerBytes);

const receipt = {
  result: "PASS",
  phase: "3D2B",
  mode: "FROZEN_PRIVATE_PLAYER_SHELL_IMPORT",
  batchId: "atlanta-hawks-phase-3d2b-player-shells",
  startingHead: args["starting-head"],
  importedAt,
  sourceFreezeSha256: expectedFreezeSha256,
  sourcePhase3cSha256: normalizedTextHash(phase3cBytes),
  sourcePlayerStoreSha256: expectedPlayerStoreSha256,
  sourceCanonicalStoreSha256: expectedTradeStoreSha256,
  preImportPlayerRecords: 67,
  importedPlayerShells: 442,
  reusedExistingPlayers: 7,
  postImportPlayerRecords: 509,
  pendingRelationshipEdges: 549,
  activeRelationshipEdgesAdded: 0,
  canonicalTradesImported: 0,
  canonicalStoreModified: false,
  automaticPlayerMerges: 0,
  privateRecords: 442,
  noindexRecords: 442,
  adFreeRecords: 442,
  publicationReadyRecords: 0,
  playerIds: newIds,
  playerStoreSha256: expectedPostSha256,
  receiptPolicy: "idempotent-exact-freeze-replay",
};
const expectedReceiptBytes = canonicalJson(receipt);

let changesApplied = 0;
let idempotentReplay = false;

if (presentNewPlayers.length === 0) {
  assert(currentPlayers.length === 67, `Expected 67 pre-import records, found ${currentPlayers.length}.`);
  await atomicWrite(args["players-json"], expectedPlayerBytes, "phase3d2b");
  await atomicWrite(args["receipt-json"], expectedReceiptBytes, "phase3d2b");
  changesApplied = 442;
} else {
  assert(presentNewPlayers.length === 442, `Partial Atlanta player import detected: ${presentNewPlayers.length}/442.`);
  assert(currentPlayers.length === 509, `Expected 509 records on replay, found ${currentPlayers.length}.`);
  assert(playerBytes.equals(expectedPlayerBytes), "Existing Atlanta player-shell records differ from the exact frozen import.");
  const existingReceiptBytes = await readFile(args["receipt-json"]).catch(() => null);
  assert(existingReceiptBytes, "Atlanta player-shell receipt is missing on replay.");
  assert(existingReceiptBytes.equals(expectedReceiptBytes), "Atlanta player-shell receipt differs from the exact frozen import.");
  idempotentReplay = true;
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "3D2B",
  preImportPlayerRecords: 67,
  importedPlayerShells: 442,
  reusedExistingPlayers: 7,
  postImportPlayerRecords: 509,
  pendingRelationshipEdges: 549,
  activeRelationshipEdgesAdded: 0,
  identityCollisions: 0,
  automaticPlayerMerges: 0,
  canonicalStoreModified: false,
  changesApplied,
  idempotentReplay,
  playerStoreSha256: expectedPostSha256,
  receiptSha256: sha256(expectedReceiptBytes),
}, null, 2));
