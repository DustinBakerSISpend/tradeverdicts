#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  buildPlayerCandidates,
  normalizePlayerIdentity,
} from "../../src/lib/nba/player-identity-candidates.mjs";

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

const args = parseArgs(process.argv);
for (const required of [
  "trades-json",
  "players-json",
  "receipt-json",
  "alias-decisions",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [tradeBytes, playerBytes, receiptBytes, aliasBytes] = await Promise.all([
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["receipt-json"]),
  readFile(args["alias-decisions"]),
]);

const records = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const aliases = JSON.parse(aliasBytes.toString("utf8"));

assert(records.length === 27, "Expected 27 canonical records.");
assert(players.length === 0, "Player store must remain empty.");
assert(receipt.postImportStoreSha256 === sha256(tradeBytes), "Receipt/store mismatch.");

const { references, candidates, aliasDecisionCount, aliasValueCount } =
  buildPlayerCandidates(records, aliases);
const byName = new Map(
  candidates.map((candidate) => [candidate.preferredName, candidate]),
);

assert(references.length === 90, "Expected 90 player identity references.");
assert(
  references.filter((reference) => reference.referenceType === "direct_player").length === 70,
  "Expected 70 direct player references.",
);
assert(
  references.filter((reference) => reference.referenceType === "draft_rights").length === 14,
  "Expected 14 draft-rights references.",
);
assert(
  references.filter((reference) => reference.referenceType === "draft_outcome").length === 6,
  "Expected six draft-outcome references.",
);
assert(candidates.length === 67, "Expected 67 exact player candidates.");
assert(
  candidates.filter((candidate) => candidate.referenceCount > 1).length === 20,
  "Expected 20 repeated player candidates.",
);
assert(aliasDecisionCount === 4 && aliasValueCount === 5, "Alias counts are incorrect.");

const requiredAliases = {
  "AJ Johnson": ["A.J. Johnson"],
  "CJ McCollum": ["C.J. McCollum"],
  "Carlton 'Bub' Carrington": ["Bub Carrington", "Carlton Carrington"],
  "Ish Smith": ["Ishmael Smith"],
};
for (const [name, expectedAliases] of Object.entries(requiredAliases)) {
  const candidate = byName.get(name);
  assert(candidate, `Missing candidate: ${name}`);
  assert(
    JSON.stringify(candidate.aliases) === JSON.stringify(expectedAliases),
    `Alias mismatch for ${name}: ${JSON.stringify(candidate.aliases)}`,
  );
}

const johnny = byName.get("Johnny Davis");
assert(johnny, "Johnny Davis candidate is missing.");
assert(
  !johnny.aliases.some((alias) => normalizePlayerIdentity(alias) === "christian"),
  "Christian was incorrectly treated as a Johnny Davis alias.",
);

const expectedReferenceShapes = {
  "Dillon Jones": ["direct_player", "draft_outcome", "draft_rights"],
  "Walter Clayton Jr.": ["draft_outcome", "draft_rights"],
  "Julian Phillips": ["draft_outcome", "draft_rights"],
};
for (const [name, expectedTypes] of Object.entries(expectedReferenceShapes)) {
  const candidate = byName.get(name);
  assert(candidate, `Missing mixed-reference candidate: ${name}`);
  assert(
    JSON.stringify(candidate.referenceTypes) === JSON.stringify(expectedTypes),
    `Reference-type mismatch for ${name}: ${JSON.stringify(candidate.referenceTypes)}`,
  );
}

assert(
  candidates.every((candidate) => candidate.candidateDataReady === true),
  "A player candidate is not data-ready.",
);
assert(
  candidates.every((candidate) => candidate.playerImportReady === false),
  "Player import was prematurely authorized.",
);
assert(
  candidates.every((candidate) =>
    candidate.publishStatus === "private" &&
    candidate.reviewStatus === "manual-review" &&
    candidate.indexEligible === false &&
    candidate.adEligible === false &&
    candidate.publicationReady === false &&
    candidate.automaticMerge === false &&
    candidate.playerImportPerformed === false
  ),
  "A player candidate violates privacy or import policy.",
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2L",
  canonicalStoreRecords: records.length,
  identityReferences: references.length,
  directPlayerReferences: 70,
  draftRightsReferences: 14,
  draftOutcomeReferences: 6,
  uniquePlayerCandidates: candidates.length,
  duplicateNameCandidates: candidates.filter(
    (candidate) => candidate.referenceCount > 1,
  ).length,
  aliasDecisionCount,
  aliasValueCount,
  identityCollisions: 0,
  playerStoreRecords: players.length,
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  playerStoreWrites: false,
  canonicalStoreWrites: false,
}, null, 2));
