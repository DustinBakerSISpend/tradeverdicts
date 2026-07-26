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
  "decision-json",
  "reviewed-json",
  "routing-json",
  "contract-md",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [freezeBytes, decisionBytes, reviewedBytes, routingBytes, contractBytes] =
  await Promise.all([
    readFile(args["freeze-json"]),
    readFile(args["decision-json"]),
    readFile(args["reviewed-json"]),
    readFile(args["routing-json"]),
    readFile(args["contract-md"]),
  ]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const decision = JSON.parse(decisionBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));

assert(freeze.result === "PASS" && freeze.phase === "7D", "Invalid Phase 7D freeze.");
assert(decision.result === "PASS" && decision.phase === "7C", "Invalid Phase 7C decision.");
assert(reviewed.result === "PASS" && reviewed.phase === "7A", "Invalid reviewed batch.");
assert(routing.result === "PASS" && routing.phase === "7D", "Invalid routing spec.");
assert(Array.isArray(freeze.freezeRecords) && freeze.freezeRecords.length === 219, "Freeze count drifted.");
assert(
  freeze.freezeRecordsSha256 === sha256(JSON.stringify(freeze.freezeRecords)),
  "Freeze-record hash drifted.",
);
assert(
  freeze.routingTransactionsSha256 === routing.transactionsSha256,
  "Routing-transaction hash drifted.",
);
assert(
  freeze.routeEdgesSha256 === routing.routeEdgesSha256,
  "Route-edge hash drifted.",
);
assert(freeze.sourceHashes.decisionJsonSha256 === sha256(decisionBytes), "Decision file hash drifted.");
assert(freeze.sourceHashes.reviewedJsonSha256 === sha256(reviewedBytes), "Reviewed file hash drifted.");
assert(freeze.sourceHashes.routingJsonSha256 === sha256(routingBytes), "Routing file hash drifted.");
assert(freeze.sourceHashes.contractSha256 === sha256(contractBytes), "Contract hash drifted.");

const counts = freeze.counts;
const fixed = {
  sourceRows: 219,
  phase7cNextPhaseCandidates: 177,
  phase7cBlockedOrReconciliationRows: 42,
  routingHoldTransactions: 15,
  routedTransactions: 15,
  remainingRoutingHolds: 0,
  excludedNonStandalone: 7,
  archiveImportReadyRows: 15,
};
for (const [field, expected] of Object.entries(fixed)) {
  assert(counts[field] === expected, `${field} expected ${expected}, received ${counts[field]}.`);
}
assert(Number.isInteger(counts.bullsFacingRouteEdges) && counts.bullsFacingRouteEdges > 0, "Route-edge count is invalid.");
assert(Number.isInteger(counts.newlyAdvancedByRouting) && counts.newlyAdvancedByRouting >= 0, "Routing advancement count is invalid.");
assert(
  counts.packagingQueueRecords ===
    counts.phase7cNextPhaseCandidates + counts.newlyAdvancedByRouting,
  "Packaging queue accounting drifted.",
);
assert(
  counts.packagingQueueRecords +
    counts.remainingHeldRecords +
    counts.excludedNonStandalone === 219,
  "Final routing partition does not close.",
);
assert(
  JSON.stringify(countBy(freeze.freezeRecords.map((record) => record.finalStatus))) ===
    JSON.stringify(counts.finalStatusCounts),
  "Final-status accounting drifted.",
);
assert(
  JSON.stringify(
    countBy(
      freeze.freezeRecords
        .filter((record) => !record.packagingReady && !record.mergeExclude)
        .flatMap((record) => record.blockersAfterRouting),
    ),
  ) === JSON.stringify(counts.remainingBlockerCounts),
  "Remaining-blocker accounting drifted.",
);

for (const record of freeze.freezeRecords) {
  assert(record.automaticMerge === false, `${record.sourceTradeId}: automatic merge occurred.`);
  assert(record.automaticRoute === false, `${record.sourceTradeId}: automatic route occurred.`);
  assert(record.canonicalImport === false, `${record.sourceTradeId}: canonical import occurred.`);
  assert(record.playerImport === false, `${record.sourceTradeId}: player import occurred.`);
  assert(record.relationshipWrite === false, `${record.sourceTradeId}: relationship write occurred.`);
  assert(record.routeDataWrite === false, `${record.sourceTradeId}: route-data write occurred.`);

  if (record.routingRequired) {
    assert(record.routingSpecPresent === true, `${record.sourceTradeId}: routing spec is missing.`);
    assert(record.routingComplete === true, `${record.sourceTradeId}: routing is incomplete.`);
    assert(record.routeEdgeCount >= 2, `${record.sourceTradeId}: route edges are incomplete.`);
    assert(!record.blockersAfterRouting.includes("explicit-routing-required"), `${record.sourceTradeId}: routing blocker remains.`);
  }
  if (record.newlyAdvancedByRouting) {
    assert(record.packagingReady === true, `${record.sourceTradeId}: advanced row is not packaging-ready.`);
    assert(record.blockersAfterRouting.length === 0, `${record.sourceTradeId}: advanced row retains blockers.`);
  }
  if (record.mergeExclude) {
    assert(record.finalStatus === "excluded-linked-followup", `${record.sourceTradeId}: excluded status drifted.`);
  }
}

assert(freeze.canonicalImports === 0, "Canonical imports occurred.");
assert(freeze.playerImports === 0, "Player imports occurred.");
assert(freeze.teamRegistryWrites === 0, "Team-registry writes occurred.");
assert(freeze.relationshipWrites === 0, "Relationship writes occurred.");
assert(freeze.routeDataWrites === 0, "Route-data writes occurred.");
assert(freeze.automaticMerges === 0, "Automatic merges occurred.");
assert(freeze.automaticRoutes === 0, "Automatic routes occurred.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");
assert(freeze.pushPerformed === false, "Push occurred.");
assert(freeze.deployPerformed === false, "Deployment occurred.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "7D",
  verified: counts,
  routingTransactionsSha256: freeze.routingTransactionsSha256,
  routeEdgesSha256: freeze.routeEdgesSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
}, null, 2));
