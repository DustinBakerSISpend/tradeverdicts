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
for (const required of ["freeze-json", "phase5d-freeze", "trades-json", "players-json"]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, phase5DBytes, tradesBytes, playersBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["phase5d-freeze"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const phase5D = JSON.parse(phase5DBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));

assert(freeze.result === "PASS", "Packaging freeze result is not PASS.");
assert(freeze.phase === "5E", "Packaging freeze phase is not 5E.");
assert(freeze.mode === "BROOKLYN_NETS_CANONICAL_PACKAGING_AND_ELIGIBILITY_FREEZE", "Unexpected packaging mode.");
assert(Array.isArray(freeze.packages) && freeze.packages.length === 208, "Expected 208 packages.");
assert(Array.isArray(freeze.uniquePlayerDependencies), "Player dependency array missing.");
assert(Array.isArray(phase5D.records) && phase5D.records.length === 251, "Invalid Phase 5D source.");
assert(Array.isArray(trades) && trades.length === 456, "Canonical store count changed.");
assert(Array.isArray(players), "Player store is not an array.");

const counts = freeze.counts;
assert(counts.sourceRows === 251, "Source-row count drifted.");
assert(counts.packagingQueueRecords === 208, "Packaging queue count drifted.");
assert(counts.totalPackagingActions === 208, "Packaging action count drifted.");
assert(counts.remainingSourceHolds === 35, "Remaining source-hold count drifted.");
assert(counts.excludedNonStandalone === 8, "Excluded count drifted.");
assert(
  counts.canonicalCreatePackages +
    counts.perspectiveAppendPackages +
    counts.canonicalCollisionHoldPackages +
    counts.reviewedSourceCollisionHoldPackages === 208,
  "Package-type accounting does not total 208."
);
assert(counts.totalPackagingActions + counts.remainingSourceHolds + counts.excludedNonStandalone === 251, "Phase 5E accounting does not total 251.");
assert(
  Object.values(counts.importEligibilityCounts).reduce((sum, value) => sum + value, 0) === 208,
  "Eligibility accounting does not total 208."
);
assert(
  Object.values(counts.dependencyStatusCounts).reduce((sum, value) => sum + value, 0) === counts.uniquePlayerDependencies,
  "Dependency status accounting drifted."
);

assert(freeze.sourceFreeze.phase5DFileSha256 === sha256(phase5DBytes), "Phase 5D file hash mismatch.");
assert(freeze.storeHashes.canonicalTradesSha256 === sha256(tradesBytes), "Canonical store hash mismatch.");
assert(freeze.storeHashes.playersSha256 === sha256(playersBytes), "Player store hash mismatch.");
assert(freeze.packageRecordsSha256 === sha256(Buffer.from(stable(freeze.packages))), "Package-record hash mismatch.");
assert(
  freeze.dependencyRecordsSha256 === sha256(Buffer.from(stable(freeze.uniquePlayerDependencies))),
  "Dependency-record hash mismatch."
);

assert(new Set(freeze.packages.map((item) => item.packageId)).size === 208, "Duplicate package ID.");
const actionable = freeze.packages.filter((item) =>
  ["canonical-create", "perspective-append"].includes(item.packageType)
);
assert(
  new Set(actionable.map((item) => `${item.packageType}|${item.targetCanonicalId}`)).size === actionable.length,
  "Duplicate actionable package target."
);
const currentTradeIds = new Set(trades.map((trade) => trade.id));
assert(
  freeze.packages.filter((item) => item.packageType === "canonical-create")
    .every((item) => !currentTradeIds.has(item.targetCanonicalId)),
  "A canonical-create target already exists."
);
assert(
  freeze.packages.filter((item) => item.packageType === "perspective-append")
    .every((item) => currentTradeIds.has(item.targetCanonicalId)),
  "A perspective target is absent."
);

for (const packageItem of freeze.packages) {
  assert(packageItem.privateOnly === true, `${packageItem.packageId}: not private.`);
  assert(packageItem.canonicalImportAuthorized === false, `${packageItem.packageId}: canonical import authorized.`);
  assert(packageItem.playerImportAuthorized === false, `${packageItem.packageId}: player import authorized.`);
  assert(packageItem.perspectiveWriteAuthorized === false, `${packageItem.packageId}: perspective write authorized.`);
  assert(packageItem.relationshipWriteAuthorized === false, `${packageItem.packageId}: relationship write authorized.`);
  assert(packageItem.routeDataWriteAuthorized === false, `${packageItem.packageId}: route write authorized.`);
  assert(packageItem.automaticMergeAuthorized === false, `${packageItem.packageId}: automatic merge authorized.`);
  assert(packageItem.publicationAuthorized === false, `${packageItem.packageId}: publication authorized.`);
  assert(packageItem.importEligibility && typeof packageItem.importEligibility.status === "string", `${packageItem.packageId}: eligibility missing.`);
}

assert(
  stable(countBy(freeze.packages.map((item) => item.packageType))) ===
    stable({
      ...(counts.canonicalCreatePackages ? { "canonical-create": counts.canonicalCreatePackages } : {}),
      ...(counts.perspectiveAppendPackages ? { "perspective-append": counts.perspectiveAppendPackages } : {}),
      ...(counts.canonicalCollisionHoldPackages ? { "canonical-collision-hold": counts.canonicalCollisionHoldPackages } : {}),
      ...(counts.reviewedSourceCollisionHoldPackages ? { "reviewed-source-collision-hold": counts.reviewedSourceCollisionHoldPackages } : {}),
    }),
  "Package-type counts do not match records."
);

for (const key of [
  "canonicalImports",
  "playerImports",
  "perspectiveWrites",
  "relationshipWrites",
  "routeDataWrites",
  "automaticMerges",
]) assert(freeze[key] === 0, `${key} is not zero.`);
assert(freeze.publicationAuthorized === false, "Publication was authorized.");
assert(freeze.pushPerformed === false, "Push was performed.");
assert(freeze.deployPerformed === false, "Deployment was performed.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "5E",
  verified: {
    sourceRows: counts.sourceRows,
    packagingQueueRecords: counts.packagingQueueRecords,
    canonicalCreatePackages: counts.canonicalCreatePackages,
    perspectiveAppendPackages: counts.perspectiveAppendPackages,
    canonicalCollisionHoldPackages: counts.canonicalCollisionHoldPackages,
    reviewedSourceCollisionHoldPackages: counts.reviewedSourceCollisionHoldPackages,
    totalPackagingActions: counts.totalPackagingActions,
    remainingSourceHolds: counts.remainingSourceHolds,
    excludedNonStandalone: counts.excludedNonStandalone,
    uniquePlayerDependencies: counts.uniquePlayerDependencies,
    dependencyOccurrences: counts.dependencyOccurrences,
    playerShellPreviews: counts.playerShellPreviews,
    ambiguousPlayerDependencies: counts.ambiguousPlayerDependencies,
  },
  packageRecordsSha256: freeze.packageRecordsSha256,
  dependencyRecordsSha256: freeze.dependencyRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
}, null, 2));
