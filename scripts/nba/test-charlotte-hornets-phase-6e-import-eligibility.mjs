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
function stable(value) {
  return JSON.stringify(value);
}

const args = parseArgs(process.argv);
for (const required of [
  "freeze-json",
  "routing-freeze-json",
  "decision-json",
  "reviewed-json",
  "contract-md",
]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, routingBytes, decisionBytes, reviewedBytes, contractBytes] =
  await Promise.all([
    readFile(args["freeze-json"]),
    readFile(args["routing-freeze-json"]),
    readFile(args["decision-json"]),
    readFile(args["reviewed-json"]),
    readFile(args["contract-md"]),
  ]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));
const decision = JSON.parse(decisionBytes.toString("utf8"));

assert(freeze.result === "PASS", "Phase 6E freeze did not pass.");
assert(freeze.phase === "6E", "Unexpected Phase 6E phase.");
assert(freeze.mode === "IMPORT_ELIGIBILITY_FREEZE", "Unexpected Phase 6E mode.");
assert(Array.isArray(freeze.records), "Phase 6E freeze records are unavailable.");
assert(freeze.records.length === 103, "Expected 103 Phase 6E freeze records.");
assert(
  freeze.sourceRouting.freezeRecordsSha256 === routing.freezeRecordsSha256,
  "Phase 6D freeze-record hash drifted.",
);
assert(
  freeze.sourceRouting.routeEdgesSha256 === routing.routeEdgesSha256,
  "Phase 6D route-edge hash drifted.",
);
assert(
  freeze.sourceDecision.decisionRecordsSha256 === decision.decisionRecordsSha256,
  "Phase 6C decision-record hash drifted.",
);
assert(freeze.reviewedBatchSha256 === sha256(reviewedBytes), "Reviewed-batch hash drifted.");
assert(freeze.contractSha256 === sha256(contractBytes), "Contract hash drifted.");
assert(
  freeze.freezeRecordsSha256 === sha256(JSON.stringify(freeze.records)),
  "Eligibility freeze-record hash drifted.",
);
assert(new Set(freeze.records.map((record) => record.eligibilityKey)).size === 103, "Duplicate eligibility keys.");
assert(new Set(freeze.records.map((record) => record.tradeId)).size === 103, "Duplicate eligible trade IDs.");

const counts = freeze.counts;
assert(counts.sourceRows === 125, "Source-row count drifted.");
assert(counts.eligibleRows === 103, "Eligible-row count drifted.");
assert(counts.heldRows === 20, "Held-row count drifted.");
assert(counts.excludedRows === 2, "Excluded-row count drifted.");
assert(counts.eligibleRows + counts.heldRows + counts.excludedRows === 125, "Phase 6E accounting drifted.");
assert(
  counts.dependencySeedRows ===
    counts.incomingDependencyRows + counts.outgoingDependencyRows,
  "Dependency-seed accounting drifted.",
);
assert(
  freeze.records.every(
    (record) =>
      record.eligibilityStatus === "frozen-eligible-for-package-construction",
  ),
  "An eligibility status drifted.",
);
assert(
  freeze.records.every((record) => record.canonicalIdentityStatus === "unassigned"),
  "A canonical identity was assigned.",
);
assert(
  freeze.records.every((record) => record.playerDependencyStatus === "not-yet-evaluated"),
  "A player dependency was prematurely evaluated.",
);
assert(freeze.canonicalImports === 0, "Canonical import occurred.");
assert(freeze.playerImports === 0, "Player import occurred.");
assert(freeze.teamRegistryWrites === 0, "Team-registry write occurred.");
assert(freeze.relationshipWrites === 0, "Relationship write occurred.");
assert(freeze.routeDataWrites === 0, "Route-data write occurred.");
assert(freeze.canonicalIdsAssigned === 0, "Canonical IDs were assigned.");
assert(freeze.automaticMerges === 0, "Automatic merge occurred.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "6E",
  verified: counts,
  eligibilityRecordsSha256: freeze.eligibilityRecordsSha256,
  dependencySeedSha256: freeze.dependencySeedSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  canonicalIdsAssigned: 0,
  automaticMerges: 0,
}, null, 2));
