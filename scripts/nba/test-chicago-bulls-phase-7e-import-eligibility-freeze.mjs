#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error(`Invalid argument near ${key}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
}

const args = parseArgs(process.argv);
for (const required of [
  "freeze-json",
  "routing-freeze-json",
  "reviewed-json",
  "contract-md",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [freezeBytes, routingBytes, reviewedBytes, contractBytes] =
  await Promise.all([
    readFile(args["freeze-json"]),
    readFile(args["routing-freeze-json"]),
    readFile(args["reviewed-json"]),
    readFile(args["contract-md"]),
  ]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(freeze.result === "PASS" && freeze.phase === "7E", "Invalid Phase 7E freeze.");
assert(routing.result === "PASS" && routing.phase === "7D", "Invalid Phase 7D routing freeze.");
assert(reviewed.result === "PASS" && reviewed.phase === "7A", "Invalid reviewed batch.");
assert(Array.isArray(freeze.eligibilityRecords) && freeze.eligibilityRecords.length === 219, "Eligibility count drifted.");
assert(Array.isArray(freeze.dependencySeedRecords), "Dependency seed is unavailable.");

assert(
  freeze.eligibilityRecordsSha256 ===
    sha256(JSON.stringify(freeze.eligibilityRecords)),
  "Eligibility-record hash drifted.",
);
assert(
  freeze.dependencySeedSha256 ===
    sha256(JSON.stringify(freeze.dependencySeedRecords)),
  "Dependency-seed hash drifted.",
);
const playerSeeds = freeze.dependencySeedRecords.filter(
  (record) => record.identityResolutionRequired,
);
assert(
  freeze.playerIdentitySeedSha256 === sha256(JSON.stringify(playerSeeds)),
  "Player-identity seed hash drifted.",
);

assert(freeze.sourceHashes.routingFreezeJsonSha256 === sha256(routingBytes), "Routing-freeze file hash drifted.");
assert(freeze.sourceHashes.reviewedJsonSha256 === sha256(reviewedBytes), "Reviewed file hash drifted.");
assert(freeze.sourceHashes.contractSha256 === sha256(contractBytes), "Contract hash drifted.");
assert(
  freeze.sourceHashes.phase7DFreezeRecordsSha256 ===
    routing.freezeRecordsSha256,
  "Phase 7D freeze-record source hash drifted.",
);
assert(
  freeze.sourceHashes.phase7DRouteEdgesSha256 === routing.routeEdgesSha256,
  "Phase 7D route-edge source hash drifted.",
);

const counts = freeze.counts;
const fixed = {
  sourceRows: 219,
  eligibleRows: 187,
  heldRows: 25,
  excludedRows: 7,
  packagingQueueInputRows: 187,
  phase7dRemainingHeldRows: 25,
  archiveImportReadyRows: 15,
};
assert(
  counts.archiveEligibleRows +
    counts.archiveHeldRows +
    counts.archiveExcludedRows === 15,
  "Private archive eligibility split does not close.",
);
for (const field of [
  "archiveEligibleRows",
  "archiveHeldRows",
  "archiveExcludedRows",
]) {
  assert(
    Number.isInteger(counts[field]) && counts[field] >= 0,
    `${field} is invalid.`,
  );
}
for (const [field, expected] of Object.entries(fixed)) {
  assert(counts[field] === expected, `${field} expected ${expected}, received ${counts[field]}.`);
}
assert(counts.eligibleRows + counts.heldRows + counts.excludedRows === 219, "Eligibility partition does not close.");
assert(Number.isInteger(counts.dependencySeedRows) && counts.dependencySeedRows > 0, "Dependency-seed count is invalid.");
assert(Number.isInteger(counts.playerIdentitySeedRows) && counts.playerIdentitySeedRows > 0, "Player-identity seed count is invalid.");
assert(counts.playerIdentitySeedRows <= counts.dependencySeedRows, "Player seed exceeds dependency seed.");
assert(
  counts.nonIdentityAssetSeedRows ===
    counts.dependencySeedRows - counts.playerIdentitySeedRows,
  "Non-identity seed accounting drifted.",
);
assert(
  Object.values(counts.eligibilityStatusCounts).reduce(
    (sum, value) => sum + value,
    0,
  ) === 219,
  "Eligibility statuses do not sum to 219.",
);
assert(
  Object.values(counts.dependencyClassCounts).reduce(
    (sum, value) => sum + value,
    0,
  ) === counts.dependencySeedRows,
  "Dependency classes do not sum to the dependency seed.",
);

const seedKeys = freeze.dependencySeedRecords.map(
  (record) => record.dependencySeedKey,
);
assert(new Set(seedKeys).size === seedKeys.length, "Dependency seed keys are not unique.");

for (const record of freeze.eligibilityRecords) {
  assert(record.automaticCanonicalMerge === false, `${record.sourceTradeId}: automatic canonical merge occurred.`);
  assert(record.automaticIdentityMerge === false, `${record.sourceTradeId}: automatic identity merge occurred.`);
  assert(record.automaticRoute === false, `${record.sourceTradeId}: automatic route occurred.`);
  assert(record.canonicalImport === false, `${record.sourceTradeId}: canonical import occurred.`);
  assert(record.playerImport === false, `${record.sourceTradeId}: player import occurred.`);
  assert(record.teamRegistryWrite === false, `${record.sourceTradeId}: team-registry write occurred.`);
  assert(record.relationshipWrite === false, `${record.sourceTradeId}: relationship write occurred.`);
  assert(record.routeDataWrite === false, `${record.sourceTradeId}: route-data write occurred.`);

  if (record.importEligible) {
    assert(record.held === false && record.excluded === false, `${record.sourceTradeId}: eligible partition drifted.`);
    assert(record.blockersAfterRouting.length === 0, `${record.sourceTradeId}: eligible record retains blockers.`);
    assert(record.databaseImportAuthorized === true, `${record.sourceTradeId}: eligible record lacks import authorization.`);
    assert(record.dependencySeedCount > 0, `${record.sourceTradeId}: eligible record lacks dependency seeds.`);
    assert(record.canonicalDisposition === "private-canonical-create-candidate", `${record.sourceTradeId}: canonical disposition drifted.`);
  }
  if (record.held) {
    assert(record.importEligible === false && record.excluded === false, `${record.sourceTradeId}: held partition drifted.`);
    assert(record.blockersAfterRouting.length > 0, `${record.sourceTradeId}: held record lacks blockers.`);
  }
  if (record.excluded) {
    assert(record.mergeExclude === true, `${record.sourceTradeId}: excluded record is not merge/exclude.`);
    assert(record.parentTradeId, `${record.sourceTradeId}: excluded record lacks parent.`);
    assert(record.importEligible === false, `${record.sourceTradeId}: excluded record is eligible.`);
  }
  if (record.insufficientEvidence) {
    assert(record.privateArchive === true, `${record.sourceTradeId}: insufficient-evidence row was not preserved privately.`);
    assert(record.archiveDatabaseReady === true, `${record.sourceTradeId}: insufficient-evidence row lost database-ready archival status.`);
  }
}

for (const seed of freeze.dependencySeedRecords) {
  assert(seed.privateOnly === true, `${seed.dependencySeedKey}: dependency seed is not private.`);
  assert(seed.indexEligible === false, `${seed.dependencySeedKey}: dependency seed is indexable.`);
  assert(seed.adEligible === false, `${seed.dependencySeedKey}: dependency seed is ad-eligible.`);
  assert(seed.automaticPlayerCreate === false, `${seed.dependencySeedKey}: automatic player creation enabled.`);
  assert(seed.automaticIdentityMerge === false, `${seed.dependencySeedKey}: automatic identity merge enabled.`);
  assert(seed.canonicalImport === false, `${seed.dependencySeedKey}: canonical import occurred.`);
  assert(seed.playerImport === false, `${seed.dependencySeedKey}: player import occurred.`);
  assert(seed.relationshipWrite === false, `${seed.dependencySeedKey}: relationship write occurred.`);
}

assert(
  freeze.eligibilityRecords.filter(
    (record) => record.insufficientEvidence,
  ).length === 15,
  "Insufficient-evidence source count drifted.",
);
assert(
  freeze.eligibilityRecords.filter(
    (record) => record.archiveDatabaseReady,
  ).length === 15,
  "Archive-ready source count drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.eligibilityRecords.map((record) => record.eligibilityStatus),
    ),
  ) === JSON.stringify(counts.eligibilityStatusCounts),
  "Eligibility-status accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.dependencySeedRecords.map((record) => record.assetClass),
    ),
  ) === JSON.stringify(counts.dependencyClassCounts),
  "Dependency-class accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.eligibilityRecords
        .filter((record) => record.held)
        .flatMap((record) => record.blockersAfterRouting),
    ),
  ) === JSON.stringify(counts.heldBlockerCounts),
  "Held-blocker accounting drifted.",
);

assert(freeze.canonicalImports === 0, "Canonical imports occurred.");
assert(freeze.playerImports === 0, "Player imports occurred.");
assert(freeze.teamRegistryWrites === 0, "Team-registry writes occurred.");
assert(freeze.relationshipWrites === 0, "Relationship writes occurred.");
assert(freeze.routeDataWrites === 0, "Route-data writes occurred.");
assert(freeze.automaticCanonicalMerges === 0, "Automatic canonical merges occurred.");
assert(freeze.automaticIdentityMerges === 0, "Automatic identity merges occurred.");
assert(freeze.automaticRoutes === 0, "Automatic routes occurred.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");
assert(freeze.pushPerformed === false, "Push occurred.");
assert(freeze.deployPerformed === false, "Deployment occurred.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "7E",
  verified: counts,
  eligibilityRecordsSha256: freeze.eligibilityRecordsSha256,
  dependencySeedSha256: freeze.dependencySeedSha256,
  playerIdentitySeedSha256: freeze.playerIdentitySeedSha256,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticCanonicalMerges: 0,
  automaticIdentityMerges: 0,
  automaticRoutes: 0,
}, null, 2));
