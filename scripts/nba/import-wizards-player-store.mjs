#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function atomicWrite(filePath, bytes) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.phase2m-${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

const args = parseArgs(process.argv);
for (const required of [
  "candidate-json",
  "trades-json",
  "players-json",
  "receipt-json",
  "expected-candidate-sha256",
  "imported-at",
  "starting-head",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const expectedCandidateSha256 = args["expected-candidate-sha256"].toLowerCase();
const [candidateBytes, tradeBytes, currentPlayerBytes] = await Promise.all([
  readFile(args["candidate-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const actualCandidateSha256 = sha256(candidateBytes);
assert(
  actualCandidateSha256 === expectedCandidateSha256,
  `Player candidate hash mismatch. Expected=${expectedCandidateSha256} Actual=${actualCandidateSha256}`,
);

const candidateDocument = JSON.parse(candidateBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const currentPlayers = JSON.parse(currentPlayerBytes.toString("utf8"));

assert(
  candidateDocument.mode === "DRY_RUN_PLAYER_CANDIDATE_PREVIEW_ONLY",
  `Unexpected candidate mode: ${candidateDocument.mode}`,
);
assert(candidateDocument.phase === "2L", "Player candidates must come from Phase 2L.");
assert(Array.isArray(candidateDocument.candidates), "Candidate records must be an array.");
assert(candidateDocument.candidates.length === 67, "Expected exactly 67 player candidates.");
assert(candidateDocument.counts?.identityReferences === 90, "Expected 90 identity references.");
assert(candidateDocument.counts?.directPlayerReferences === 70, "Expected 70 direct-player references.");
assert(candidateDocument.counts?.draftRightsReferences === 14, "Expected 14 draft-rights references.");
assert(candidateDocument.counts?.draftOutcomeReferences === 6, "Expected six draft-outcome references.");
assert(candidateDocument.counts?.duplicateNameCandidates === 20, "Expected 20 repeated player candidates.");
assert(candidateDocument.counts?.identityCollisions === 0, "Identity collisions must be zero.");
assert(candidateDocument.playerStoreWrites === false, "Candidate preview must report no player-store writes.");
assert(candidateDocument.canonicalStoreWrites === false, "Candidate preview must report no canonical-store writes.");
assert(candidateDocument.automaticMerges === false, "Automatic player merging must remain disabled.");

assert(Array.isArray(trades) && trades.length === 27, "Expected 27 canonical trades.");
assert(
  candidateDocument.canonicalStoreSha256 === sha256(tradeBytes),
  "Candidate preview does not match the canonical store.",
);
assert(Array.isArray(currentPlayers), "Player store must be a JSON array.");
assert(
  currentPlayers.length === 0,
  `Phase 2M is the first guarded player import and requires an empty player store; found ${currentPlayers.length} records.`,
);

const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
const importedAt = args["imported-at"];
const importMetadata = {
  phase: "2M",
  batchId: candidateDocument.batchId,
  importedAt,
  sourceCandidateSha256: actualCandidateSha256,
  sourceCanonicalStoreSha256: sha256(tradeBytes),
  sourceCheckpoint: args["starting-head"],
  identityPolicy: "exact-source-derived-with-approved-aliases",
  visibilityPolicy: "private-noindex-ad-free",
};

const playerRecords = candidateDocument.candidates.map((candidate) => {
  assert(candidate.candidateDataReady === true, `${candidate.preferredName}: candidateDataReady must be true.`);
  assert(candidate.playerImportReady === false, `${candidate.preferredName}: Phase 2L preview must remain pre-authorization.`);
  assert(candidate.playerImportPerformed === false, `${candidate.preferredName}: preview import flag must be false.`);
  assert(candidate.externalIdentityStatus === "unverified", `${candidate.preferredName}: external identity must remain unverified.`);
  assert(candidate.identityStatus === "source-derived-candidate", `${candidate.preferredName}: unexpected identity status.`);
  assert(candidate.publishStatus === "private", `${candidate.preferredName}: candidate must be private.`);
  assert(candidate.reviewStatus === "manual-review", `${candidate.preferredName}: candidate must remain manual-review.`);
  assert(candidate.indexEligible === false, `${candidate.preferredName}: candidate must be noindex.`);
  assert(candidate.adEligible === false, `${candidate.preferredName}: candidate must be ad-free.`);
  assert(candidate.publicationReady === false, `${candidate.preferredName}: candidate cannot be publication-ready.`);
  assert(candidate.automaticMerge === false, `${candidate.preferredName}: automatic merge must remain disabled.`);

  for (const reference of candidate.sourceReferences) {
    const trade = tradeById.get(reference.canonicalTradeId);
    assert(trade, `${candidate.preferredName}: missing canonical trade ${reference.canonicalTradeId}.`);
    assert(
      trade.sourceTradeId === reference.sourceTradeId,
      `${candidate.preferredName}: source Trade ID mismatch for ${reference.referenceId}.`,
    );
    const asset = trade.assetLedger.find((entry) => entry.assetId === reference.assetId);
    assert(asset, `${candidate.preferredName}: missing asset ${reference.assetId}.`);
  }

  const canonicalId = candidate.candidateId.replace(
    /^nba-player-candidate-/u,
    "nba-player-",
  );
  assert(
    canonicalId !== candidate.candidateId,
    `${candidate.preferredName}: candidate ID did not use the expected prefix.`,
  );

  return {
    id: canonicalId,
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
    createdAt: importedAt,
    updatedAt: importedAt,
    importMetadata: { ...importMetadata },
  };
});

const ids = new Set();
const slugs = new Set();
const normalizedNames = new Set();
const identityOwners = new Map();

for (const player of playerRecords) {
  assert(!ids.has(player.id), `Duplicate player ID: ${player.id}`);
  assert(!slugs.has(player.slug), `Duplicate player slug: ${player.slug}`);
  assert(!normalizedNames.has(player.normalizedName), `Duplicate normalized player name: ${player.normalizedName}`);
  ids.add(player.id);
  slugs.add(player.slug);
  normalizedNames.add(player.normalizedName);

  for (const identity of [player.name, ...player.aliases]) {
    const key = normalizeIdentity(identity);
    const owner = identityOwners.get(key);
    assert(!owner || owner === player.id, `Identity '${identity}' belongs to both ${owner} and ${player.id}.`);
    identityOwners.set(key, player.id);
  }
}

const storeBytes = Buffer.from(`${JSON.stringify(playerRecords, null, 2)}\n`, "utf8");
const preImportPlayerStoreSha256 = sha256(currentPlayerBytes);
const postImportPlayerStoreSha256 = sha256(storeBytes);

const counts = {
  importedPlayerRecords: playerRecords.length,
  identityReferences: playerRecords.reduce((sum, player) => sum + player.referenceCount, 0),
  directPlayerReferences: playerRecords.reduce(
    (sum, player) => sum + player.sourceReferences.filter(
      (reference) => reference.referenceType === "direct_player",
    ).length,
    0,
  ),
  draftRightsReferences: playerRecords.reduce(
    (sum, player) => sum + player.sourceReferences.filter(
      (reference) => reference.referenceType === "draft_rights",
    ).length,
    0,
  ),
  draftOutcomeReferences: playerRecords.reduce(
    (sum, player) => sum + player.sourceReferences.filter(
      (reference) => reference.referenceType === "draft_outcome",
    ).length,
    0,
  ),
  repeatedPlayerRecords: playerRecords.filter((player) => player.referenceCount > 1).length,
  aliasValues: playerRecords.reduce((sum, player) => sum + player.aliases.length, 0),
  privateRecords: playerRecords.filter((player) => player.publishStatus === "private").length,
  noindexRecords: playerRecords.filter((player) => player.indexEligible === false).length,
  adFreeRecords: playerRecords.filter((player) => player.adEligible === false).length,
  publicationReadyRecords: playerRecords.filter((player) => player.publicationReady === true).length,
  externalIdentityVerifiedRecords: playerRecords.filter(
    (player) => player.externalIdentityStatus === "verified",
  ).length,
};

const receipt = {
  schemaVersion: 1,
  phase: "2M",
  result: "PASS",
  batchId: candidateDocument.batchId,
  importedAt,
  startingHead: args["starting-head"],
  sourceCandidateSha256: actualCandidateSha256,
  canonicalStoreSha256: sha256(tradeBytes),
  preImportPlayerStoreSha256,
  postImportPlayerStoreSha256,
  ...counts,
  automaticMergesPerformed: 0,
  canonicalStoreModified: false,
  playerIds: playerRecords.map((player) => player.id),
  playerNames: playerRecords.map((player) => player.name),
};

const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");

await atomicWrite(args["players-json"], storeBytes);
await atomicWrite(args["receipt-json"], receiptBytes);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2M",
  ...counts,
  sourceCandidateSha256: actualCandidateSha256,
  preImportPlayerStoreSha256,
  postImportPlayerStoreSha256,
  canonicalStoreSha256: sha256(tradeBytes),
  automaticMergesPerformed: 0,
  canonicalStoreModified: false,
}, null, 2));
