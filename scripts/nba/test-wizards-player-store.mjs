#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const args = parseArgs(process.argv);
for (const required of [
  "candidate-json",
  "trades-json",
  "players-json",
  "receipt-json",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [candidateBytes, tradeBytes, playerBytes, receiptBytes] = await Promise.all([
  readFile(args["candidate-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["receipt-json"]),
]);

const candidateDocument = JSON.parse(candidateBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));

assert(receipt.phase === "2M" && receipt.result === "PASS", "Invalid Phase 2M receipt.");
assert(receipt.sourceCandidateSha256 === sha256(candidateBytes), "Receipt candidate hash mismatch.");
assert(receipt.canonicalStoreSha256 === sha256(tradeBytes), "Receipt canonical-store hash mismatch.");
assert(receipt.postImportPlayerStoreSha256 === sha256(playerBytes), "Receipt player-store hash mismatch.");
assert(receipt.importedPlayerRecords === 67, "Receipt must contain 67 player imports.");
assert(receipt.identityReferences === 90, "Receipt must contain 90 identity references.");
assert(receipt.publicationReadyRecords === 0, "No player may be publication-ready.");
assert(receipt.externalIdentityVerifiedRecords === 0, "No external identity may be marked verified.");
assert(receipt.automaticMergesPerformed === 0, "Automatic merges must remain zero.");
assert(receipt.canonicalStoreModified === false, "Receipt must say canonical store was untouched.");

assert(Array.isArray(trades) && trades.length === 27, "Expected 27 canonical trades.");
assert(Array.isArray(players) && players.length === 67, "Expected 67 imported players.");

const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
const candidateById = new Map(
  candidateDocument.candidates.map((candidate) => [candidate.candidateId, candidate]),
);
const ids = new Set();
const slugs = new Set();
const normalizedNames = new Set();
const identityOwners = new Map();

for (const player of players) {
  const candidate = candidateById.get(player.sourceCandidateId);
  assert(candidate, `${player.name}: source candidate is missing.`);

  const expected = {
    id: candidate.candidateId.replace(/^nba-player-candidate-/u, "nba-player-"),
    league: "nba",
    name: candidate.preferredName,
    normalizedName: candidate.normalizedName,
    slug: candidate.slug,
    aliases: candidate.aliases,
    sourceCandidateId: candidate.candidateId,
    identityStatus: "source-derived-accepted",
    externalIdentityStatus: "unverified",
    externalIds: {},
    referenceCount: candidate.referenceCount,
    sourceTradeCount: candidate.sourceTradeCount,
    sourceTradeIds: candidate.sourceTradeIds,
    canonicalTradeIds: candidate.canonicalTradeIds,
    referenceTypes: candidate.referenceTypes,
    teams: candidate.teams,
    draftReferences: candidate.draftReferences,
    sourceReferences: candidate.sourceReferences,
    aliasDecision: candidate.aliasDecision,
    publishStatus: "private",
    reviewStatus: "manual-review",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    automaticMerge: false,
    playerImportPerformed: true,
    createdAt: receipt.importedAt,
    updatedAt: receipt.importedAt,
    importMetadata: {
      phase: "2M",
      batchId: candidateDocument.batchId,
      importedAt: receipt.importedAt,
      sourceCandidateSha256: receipt.sourceCandidateSha256,
      sourceCanonicalStoreSha256: receipt.canonicalStoreSha256,
      sourceCheckpoint: receipt.startingHead,
      identityPolicy: "exact-source-derived-with-approved-aliases",
      visibilityPolicy: "private-noindex-ad-free",
    },
  };

  assert(
    JSON.stringify(stable(player)) === JSON.stringify(stable(expected)),
    `${player.name}: imported player differs from the approved candidate plus Phase 2M metadata.`,
  );

  assert(!ids.has(player.id), `Duplicate player ID: ${player.id}`);
  assert(!slugs.has(player.slug), `Duplicate player slug: ${player.slug}`);
  assert(!normalizedNames.has(player.normalizedName), `Duplicate normalized player identity: ${player.normalizedName}`);
  ids.add(player.id);
  slugs.add(player.slug);
  normalizedNames.add(player.normalizedName);

  for (const identity of [player.name, ...player.aliases]) {
    const key = normalizeIdentity(identity);
    const owner = identityOwners.get(key);
    assert(!owner || owner === player.id, `Identity collision for ${identity}.`);
    identityOwners.set(key, player.id);
  }

  for (const reference of player.sourceReferences) {
    const trade = tradeById.get(reference.canonicalTradeId);
    assert(trade, `${player.name}: missing trade ${reference.canonicalTradeId}.`);
    assert(trade.sourceTradeId === reference.sourceTradeId, `${player.name}: source Trade ID mismatch.`);
    assert(
      trade.assetLedger.some((asset) => asset.assetId === reference.assetId),
      `${player.name}: asset ${reference.assetId} is missing from its trade.`,
    );
  }

  assert(player.identityStatus === "source-derived-accepted", `${player.name}: identity status mismatch.`);
  assert(player.externalIdentityStatus === "unverified", `${player.name}: external identity status mismatch.`);
  assert(Object.keys(player.externalIds).length === 0, `${player.name}: external IDs must remain empty.`);
  assert(player.publishStatus === "private", `${player.name}: player is not private.`);
  assert(player.reviewStatus === "manual-review", `${player.name}: player is not manual-review.`);
  assert(player.indexEligible === false, `${player.name}: player is index-eligible.`);
  assert(player.adEligible === false, `${player.name}: player is ad-eligible.`);
  assert(player.publicationReady === false, `${player.name}: player is publication-ready.`);
  assert(player.automaticMerge === false, `${player.name}: automatic merge is enabled.`);
  assert(player.playerImportPerformed === true, `${player.name}: import flag is missing.`);
}

const counts = {
  identityReferences: players.reduce((sum, player) => sum + player.referenceCount, 0),
  directPlayerReferences: players.reduce(
    (sum, player) => sum + player.sourceReferences.filter(
      (reference) => reference.referenceType === "direct_player",
    ).length,
    0,
  ),
  draftRightsReferences: players.reduce(
    (sum, player) => sum + player.sourceReferences.filter(
      (reference) => reference.referenceType === "draft_rights",
    ).length,
    0,
  ),
  draftOutcomeReferences: players.reduce(
    (sum, player) => sum + player.sourceReferences.filter(
      (reference) => reference.referenceType === "draft_outcome",
    ).length,
    0,
  ),
  repeatedPlayerRecords: players.filter((player) => player.referenceCount > 1).length,
  aliasValues: players.reduce((sum, player) => sum + player.aliases.length, 0),
};

assert(counts.identityReferences === 90, "Identity-reference count mismatch.");
assert(counts.directPlayerReferences === 70, "Direct-player count mismatch.");
assert(counts.draftRightsReferences === 14, "Draft-rights count mismatch.");
assert(counts.draftOutcomeReferences === 6, "Draft-outcome count mismatch.");
assert(counts.repeatedPlayerRecords === 20, "Repeated-player count mismatch.");
assert(counts.aliasValues === 5, "Alias-value count mismatch.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "2M",
  canonicalStoreRecords: trades.length,
  importedPlayerRecords: players.length,
  ...counts,
  privateRecords: players.filter((player) => player.publishStatus === "private").length,
  noindexRecords: players.filter((player) => player.indexEligible === false).length,
  adFreeRecords: players.filter((player) => player.adEligible === false).length,
  publicationReadyRecords: players.filter((player) => player.publicationReady === true).length,
  externalIdentityVerifiedRecords: players.filter(
    (player) => player.externalIdentityStatus === "verified",
  ).length,
  identityCollisions: 0,
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  receiptSha256: sha256(receiptBytes),
  automaticMergesPerformed: 0,
  canonicalStoreModified: false,
}, null, 2));
