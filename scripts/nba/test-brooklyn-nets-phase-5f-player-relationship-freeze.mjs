#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

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
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function countBy(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)));
}

const args = parseArgs(process.argv);
for (const required of ["freeze-json", "phase5e-freeze", "trades-json", "players-json"]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, phase5EBytes, tradesBytes, playersBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["phase5e-freeze"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const phase5E = JSON.parse(phase5EBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));

assert(freeze.result === "PASS", "Player/relationship freeze result is not PASS.");
assert(freeze.phase === "5F", "Player/relationship freeze phase is not 5F.");
assert(freeze.mode === "BROOKLYN_NETS_PLAYER_SHELL_AND_RELATIONSHIP_FREEZE", "Unexpected freeze mode.");
assert(Array.isArray(phase5E.packages) && phase5E.packages.length === 208, "Invalid Phase 5E source.");
assert(Array.isArray(trades) && trades.length === 456, "Canonical trade store changed.");
assert(Array.isArray(players), "Player store is not an array.");
assert(Array.isArray(freeze.playerShellPackageRecords), "Player shell array missing.");
assert(Array.isArray(freeze.relationshipPreviewRecords), "Relationship preview array missing.");
assert(Array.isArray(freeze.ambiguousPlayerHoldRecords), "Ambiguous hold array missing.");
assert(Array.isArray(freeze.packageReadinessRecords) && freeze.packageReadinessRecords.length === 208, "Expected 208 readiness records.");

assert(freeze.sourceRows === 251, "Source-row count drifted.");
assert(freeze.packagingActions === 208, "Packaging action count drifted.");
assert(
  freeze.canonicalCreatePackages +
    freeze.perspectiveAppendPackages +
    freeze.canonicalCollisionHoldPackages +
    freeze.reviewedSourceCollisionHoldPackages === 208,
  "Package type accounting does not total 208."
);
assert(freeze.readyPackages + freeze.heldPackages === 208, "Readiness accounting does not total 208.");
assert(
  Object.values(freeze.dependencyStatusCounts).reduce((sum, value) => sum + value, 0) ===
    freeze.uniquePlayerDependencies,
  "Unique dependency status accounting drifted."
);
assert(
  freeze.relationshipPreviewEdges + freeze.ambiguousRelationshipOccurrences ===
    freeze.dependencyOccurrences,
  "Relationship occurrence accounting drifted."
);
assert(freeze.playerShellPackageRecords.length === freeze.playerShellPackages, "Player-shell count mismatch.");
assert(freeze.relationshipPreviewRecords.length === freeze.relationshipPreviewEdges, "Relationship-preview count mismatch.");
assert(freeze.ambiguousPlayerHoldRecords.length === freeze.ambiguousPlayerHolds, "Ambiguous-hold count mismatch.");

assert(freeze.sourceFreeze.phase5EFileSha256 === sha256(phase5EBytes), "Phase 5E file hash mismatch.");
assert(freeze.storeHashes.canonicalTradesSha256 === sha256(tradesBytes), "Canonical store hash mismatch.");
assert(freeze.storeHashes.playersSha256 === sha256(playersBytes), "Player store hash mismatch.");
assert(
  freeze.playerShellRecordsSha256 === sha256(Buffer.from(stable(freeze.playerShellPackageRecords))),
  "Player-shell records hash mismatch."
);
assert(
  freeze.relationshipRecordsSha256 === sha256(Buffer.from(stable(freeze.relationshipPreviewRecords))),
  "Relationship records hash mismatch."
);
assert(
  freeze.packageReadinessRecordsSha256 === sha256(Buffer.from(stable(freeze.packageReadinessRecords))),
  "Package-readiness records hash mismatch."
);

assert(new Set(freeze.playerShellPackageRecords.map((item) => item.playerPayload.id)).size === freeze.playerShellPackageRecords.length, "Duplicate player-shell ID.");
assert(new Set(freeze.relationshipPreviewRecords.map((item) => item.relationshipId)).size === freeze.relationshipPreviewRecords.length, "Duplicate relationship ID.");
assert(new Set(freeze.packageReadinessRecords.map((item) => item.packageId)).size === 208, "Duplicate package-readiness ID.");

const readinessCounts = countBy(freeze.packageReadinessRecords.map((item) => item.readinessStatus));
assert(stable(readinessCounts) === stable(freeze.packageReadinessCounts), "Readiness counts do not match records.");
assert(freeze.packageReadinessRecords.every((item) => item.ready !== item.held), "A readiness record is not exclusively ready or held.");

for (const shell of freeze.playerShellPackageRecords) {
  assert(shell.packageType === "player-shell-create", `${shell.packageId}: unexpected shell package type.`);
  assert(shell.playerPayload.id.startsWith("nba-player-"), `${shell.packageId}: invalid player ID.`);
  assert(shell.playerPayload.publishStatus === "private", `${shell.packageId}: player shell is not private.`);
  assert(shell.actualWriteAuthorized === false, `${shell.packageId}: shell write authorized.`);
  assert(shell.importAuthorized === false, `${shell.packageId}: shell import authorized.`);
}
for (const relationship of freeze.relationshipPreviewRecords) {
  assert(relationship.relationshipId.startsWith("nba-rel-"), `${relationship.relationshipId}: invalid relationship ID.`);
  assert(relationship.playerId, `${relationship.relationshipId}: player ID missing.`);
  assert(relationship.assetReference, `${relationship.relationshipId}: asset reference missing.`);
  assert(relationship.relationshipWriteAuthorized === false, `${relationship.relationshipId}: relationship write authorized.`);
  assert(relationship.importAuthorized === false, `${relationship.relationshipId}: relationship import authorized.`);
}
for (const hold of freeze.ambiguousPlayerHoldRecords) {
  assert(hold.candidatePlayerIds.length >= 2, `${hold.playerName}: ambiguous candidates missing.`);
  assert(hold.automaticResolutionAuthorized === false, `${hold.playerName}: automatic resolution authorized.`);
}

for (const key of [
  "canonicalImports",
  "playerImports",
  "perspectiveWrites",
  "relationshipWrites",
  "routeDataWrites",
  "automaticIdentityResolutions",
  "automaticMerges",
]) assert(freeze[key] === 0, `${key} is not zero.`);
assert(freeze.publicationAuthorized === false, "Publication was authorized.");
assert(freeze.pushPerformed === false, "Push was performed.");
assert(freeze.deployPerformed === false, "Deployment was performed.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "5F",
  verified: {
    sourceRows: freeze.sourceRows,
    packagingActions: freeze.packagingActions,
    canonicalCreatePackages: freeze.canonicalCreatePackages,
    perspectiveAppendPackages: freeze.perspectiveAppendPackages,
    canonicalCollisionHoldPackages: freeze.canonicalCollisionHoldPackages,
    reviewedSourceCollisionHoldPackages: freeze.reviewedSourceCollisionHoldPackages,
    uniquePlayerDependencies: freeze.uniquePlayerDependencies,
    dependencyOccurrences: freeze.dependencyOccurrences,
    playerShellPackages: freeze.playerShellPackages,
    relationshipPreviewEdges: freeze.relationshipPreviewEdges,
    ambiguousPlayerHolds: freeze.ambiguousPlayerHolds,
    ambiguousRelationshipOccurrences: freeze.ambiguousRelationshipOccurrences,
    syntheticAssetReferences: freeze.syntheticAssetReferences,
    readyPackages: freeze.readyPackages,
    heldPackages: freeze.heldPackages,
  },
  playerShellRecordsSha256: freeze.playerShellRecordsSha256,
  relationshipRecordsSha256: freeze.relationshipRecordsSha256,
  packageReadinessRecordsSha256: freeze.packageReadinessRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticIdentityResolutions: 0,
}, null, 2));
