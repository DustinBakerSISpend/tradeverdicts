#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const args = parseArgs(process.argv);
for (const required of [
  "trades-json",
  "players-json",
  "receipt-json",
  "alias-decisions",
  "output-json",
  "output-csv",
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

if (!Array.isArray(records) || records.length !== 27) {
  throw new Error("Phase 2L requires exactly 27 canonical trade records.");
}
if (!Array.isArray(players) || players.length !== 0) {
  throw new Error("Phase 2L requires the player store to remain empty.");
}
if (receipt.postImportStoreSha256 !== sha256(tradeBytes)) {
  throw new Error("Canonical store hash does not match the Phase 2K receipt.");
}

const {
  references,
  candidates,
  aliasDecisionCount,
  aliasValueCount,
} = buildPlayerCandidates(records, aliases);

const referenceCounts = {
  directPlayerReferences: references.filter(
    (reference) => reference.referenceType === "direct_player",
  ).length,
  draftRightsReferences: references.filter(
    (reference) => reference.referenceType === "draft_rights",
  ).length,
  draftOutcomeReferences: references.filter(
    (reference) => reference.referenceType === "draft_outcome",
  ).length,
};

const duplicateNameCandidates = candidates.filter(
  (candidate) => candidate.referenceCount > 1,
);
const playerIds = new Set(candidates.map((candidate) => candidate.candidateId));
const slugs = new Set(candidates.map((candidate) => candidate.slug));
const identityKeys = new Set(candidates.map((candidate) => candidate.normalizedName));

if (playerIds.size !== candidates.length) throw new Error("Duplicate player candidate IDs.");
if (slugs.size !== candidates.length) throw new Error("Duplicate player candidate slugs.");
if (identityKeys.size !== candidates.length) throw new Error("Duplicate normalized player identities.");

const christianLeak = candidates.some((candidate) =>
  candidate.aliases.some(
    (alias) => normalizePlayerIdentity(alias) === "christian",
  ),
);
if (christianLeak) {
  throw new Error("The excluded Johnny Davis annotation leaked into aliases.");
}

const counts = {
  canonicalTradeRecordsRead: records.length,
  identityReferences: references.length,
  ...referenceCounts,
  uniquePlayerCandidates: candidates.length,
  duplicateNameCandidates: duplicateNameCandidates.length,
  aliasDecisionCount,
  aliasValueCount,
  identityCollisions: 0,
  candidateDataReady: candidates.filter(
    (candidate) => candidate.candidateDataReady === true,
  ).length,
  playerImportReadyCandidates: candidates.filter(
    (candidate) => candidate.playerImportReady === true,
  ).length,
  privateCandidates: candidates.filter(
    (candidate) => candidate.publishStatus === "private",
  ).length,
  noindexCandidates: candidates.filter(
    (candidate) => candidate.indexEligible === false,
  ).length,
  adFreeCandidates: candidates.filter(
    (candidate) => candidate.adEligible === false,
  ).length,
};

const expected = {
  canonicalTradeRecordsRead: 27,
  identityReferences: 90,
  directPlayerReferences: 70,
  draftRightsReferences: 14,
  draftOutcomeReferences: 6,
  uniquePlayerCandidates: 67,
  duplicateNameCandidates: 20,
  aliasDecisionCount: 4,
  aliasValueCount: 5,
  identityCollisions: 0,
  candidateDataReady: 67,
  playerImportReadyCandidates: 0,
  privateCandidates: 67,
  noindexCandidates: 67,
  adFreeCandidates: 67,
};
if (JSON.stringify(counts) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected player-candidate counts:\n${JSON.stringify(counts, null, 2)}`);
}

const output = {
  mode: "DRY_RUN_PLAYER_CANDIDATE_PREVIEW_ONLY",
  phase: "2L",
  batchId: receipt.batchId,
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  receiptSha256: sha256(receiptBytes),
  aliasDecisionSha256: sha256(aliasBytes),
  counts,
  duplicateNameCandidates: duplicateNameCandidates.map((candidate) => ({
    preferredName: candidate.preferredName,
    referenceCount: candidate.referenceCount,
    sourceTradeCount: candidate.sourceTradeCount,
    sourceTradeIds: candidate.sourceTradeIds,
    referenceTypes: candidate.referenceTypes,
  })),
  candidates,
  playerStoreWrites: false,
  canonicalStoreWrites: false,
  automaticMerges: false,
  routesCreated: false,
  buildPerformed: false,
  pushPerformed: false,
  deployPerformed: false,
};

await mkdir(path.dirname(args["output-json"]), { recursive: true });
await mkdir(path.dirname(args["output-csv"]), { recursive: true });
await writeFile(args["output-json"], `${JSON.stringify(output, null, 2)}\n`, "utf8");

const headers = [
  "Candidate ID",
  "Preferred Name",
  "Aliases",
  "Reference Count",
  "Source Trade Count",
  "Reference Types",
  "Source Trade IDs",
  "Teams",
  "External Identity Status",
  "Candidate Data Ready",
  "Player Import Ready",
  "Review Status",
  "Publish Status",
  "Index Eligible",
  "Ad Eligible",
];
const rows = candidates.map((candidate) => [
  candidate.candidateId,
  candidate.preferredName,
  candidate.aliases.join("; "),
  candidate.referenceCount,
  candidate.sourceTradeCount,
  candidate.referenceTypes.join("; "),
  candidate.sourceTradeIds.join("; "),
  candidate.teams.join("; "),
  candidate.externalIdentityStatus,
  candidate.candidateDataReady,
  candidate.playerImportReady,
  candidate.reviewStatus,
  candidate.publishStatus,
  candidate.indexEligible,
  candidate.adEligible,
]);

await writeFile(
  args["output-csv"],
  `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
  "utf8",
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2L",
  ...counts,
  playerStoreWrites: false,
  canonicalStoreWrites: false,
  publicationReady: false,
}, null, 2));
