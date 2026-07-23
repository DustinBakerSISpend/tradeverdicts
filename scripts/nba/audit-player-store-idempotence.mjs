#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const args = parseArgs(process.argv);
for (const required of [
  "candidate-json",
  "trades-json",
  "players-json",
  "output-json",
  "output-csv",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [candidateBytes, tradeBytes, playerBytes] = await Promise.all([
  readFile(args["candidate-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const candidateDocument = JSON.parse(candidateBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));

assert(candidateDocument.phase === "2L", "Expected Phase 2L player candidates.");
assert(candidateDocument.candidates?.length === 67, "Expected 67 player candidates.");
assert(Array.isArray(trades) && trades.length === 27, "Expected 27 canonical trades.");
assert(Array.isArray(players) && players.length === 67, "Expected 67 imported players.");

const candidateHash = sha256(candidateBytes);
const tradeHash = sha256(tradeBytes);
const playerByCandidateId = new Map(
  players.map((player) => [player.sourceCandidateId, player]),
);
const candidateIds = new Set(
  candidateDocument.candidates.map((candidate) => candidate.candidateId),
);

let exactExisting = 0;
let wouldInsert = 0;
let wouldUpdate = 0;
let conflicts = 0;
const rows = [];

for (const candidate of candidateDocument.candidates) {
  const existing = playerByCandidateId.get(candidate.candidateId);
  if (!existing) {
    wouldInsert += 1;
    rows.push([
      candidate.candidateId,
      candidate.preferredName,
      "would-insert",
      "No player-store record exists for this source candidate.",
    ]);
    continue;
  }

  const metadata = existing.importMetadata;
  assert(metadata?.phase === "2M", `${existing.name}: Phase 2M metadata is missing.`);
  assert(
    metadata.sourceCandidateSha256 === candidateHash,
    `${existing.name}: candidate hash metadata mismatch.`,
  );
  assert(
    metadata.sourceCanonicalStoreSha256 === tradeHash,
    `${existing.name}: canonical-store hash metadata mismatch.`,
  );

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
    createdAt: metadata.importedAt,
    updatedAt: metadata.importedAt,
    importMetadata: {
      phase: "2M",
      batchId: candidateDocument.batchId,
      importedAt: metadata.importedAt,
      sourceCandidateSha256: metadata.sourceCandidateSha256,
      sourceCanonicalStoreSha256: metadata.sourceCanonicalStoreSha256,
      sourceCheckpoint: metadata.sourceCheckpoint,
      identityPolicy: "exact-source-derived-with-approved-aliases",
      visibilityPolicy: "private-noindex-ad-free",
    },
  };

  const same = JSON.stringify(stable(existing)) === JSON.stringify(stable(expected));
  if (same) {
    exactExisting += 1;
    rows.push([
      candidate.candidateId,
      candidate.preferredName,
      "exact-existing",
      "Player-store record is semantically identical to the approved candidate plus Phase 2M import metadata.",
    ]);
  } else if (
    existing.id === expected.id &&
    existing.normalizedName === expected.normalizedName
  ) {
    wouldUpdate += 1;
    rows.push([
      candidate.candidateId,
      candidate.preferredName,
      "would-update",
      "Player identity matches, but stored content differs.",
    ]);
  } else {
    conflicts += 1;
    rows.push([
      candidate.candidateId,
      candidate.preferredName,
      "conflict",
      "Source candidate exists with a different canonical player identity.",
    ]);
  }
}

const unexpectedStoreRecords = players.filter(
  (player) => !candidateIds.has(player.sourceCandidateId),
).length;

const result = {
  mode: "DRY_RUN_PLAYER_STORE_IDEMPOTENCE_AUDIT_ONLY",
  phase: "2N",
  batchId: candidateDocument.batchId,
  counts: {
    candidateRecords: candidateDocument.candidates.length,
    storeRecords: players.length,
    exactExisting,
    wouldInsert,
    wouldUpdate,
    conflicts,
    unexpectedStoreRecords,
  },
  idempotent: (
    exactExisting === 67 &&
    wouldInsert === 0 &&
    wouldUpdate === 0 &&
    conflicts === 0 &&
    unexpectedStoreRecords === 0
  ),
  playerCandidateSha256: candidateHash,
  canonicalStoreSha256: tradeHash,
  playerStoreSha256: sha256(playerBytes),
  playerStoreWrites: false,
  canonicalStoreWrites: false,
  automaticMerges: false,
};

if (!result.idempotent) {
  throw new Error(`Player-store idempotence failed:\n${JSON.stringify(result, null, 2)}`);
}

await mkdir(path.dirname(args["output-json"]), { recursive: true });
await mkdir(path.dirname(args["output-csv"]), { recursive: true });
await writeFile(args["output-json"], `${JSON.stringify(result, null, 2)}\n`, "utf8");

const headers = ["Source Candidate ID", "Player", "Disposition", "Notes"];
await writeFile(
  args["output-csv"],
  `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
  "utf8",
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2N",
  ...result.counts,
  idempotent: result.idempotent,
  playerStoreWrites: false,
  canonicalStoreWrites: false,
}, null, 2));
