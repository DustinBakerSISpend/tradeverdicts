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
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}
function stable(value) {
  return JSON.stringify(value);
}

const args = parseArgs(process.argv);
for (const required of [
  "freeze-json",
  "decision-json",
  "preview-json",
  "routing-json",
  "contract-md",
]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, decisionBytes, previewBytes, routingBytes, contractBytes] =
  await Promise.all([
    readFile(args["freeze-json"]),
    readFile(args["decision-json"]),
    readFile(args["preview-json"]),
    readFile(args["routing-json"]),
    readFile(args["contract-md"]),
  ]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const decision = JSON.parse(decisionBytes.toString("utf8"));
const preview = JSON.parse(previewBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));

assert(freeze.result === "PASS", "Phase 6D freeze did not pass.");
assert(freeze.phase === "6D", "Unexpected Phase 6D phase.");
assert(freeze.mode === "MULTI_TEAM_ROUTING_FREEZE", "Unexpected Phase 6D mode.");
assert(Array.isArray(freeze.records) && freeze.records.length === 125, "Expected 125 freeze records.");
assert(
  freeze.sourceDecision.decisionRecordsSha256 === decision.decisionRecordsSha256,
  "Decision-record hash drifted.",
);
assert(
  freeze.sourceDecision.previewRecordsSha256 === preview.hashes.previewRecordsSha256,
  "Preview-record hash drifted.",
);
assert(freeze.routingSpecSha256 === sha256(routingBytes), "Routing-spec hash drifted.");
assert(freeze.contractSha256 === sha256(contractBytes), "Contract hash drifted.");
assert(
  freeze.freezeRecordsSha256 === sha256(JSON.stringify(freeze.records)),
  "Freeze-record hash drifted.",
);

const counts = freeze.counts;
assert(counts.sourceRows === 125, "Source-row count drifted.");
assert(counts.phase6cNextPhaseCandidates === 95, "Phase 6C candidate count drifted.");
assert(counts.routingHoldTransactions === 10, "Routing-hold count drifted.");
assert(counts.routedTransactions === 10, "Routed-transaction count drifted.");
assert(counts.remainingRoutingHolds === 0, "Routing holds remain.");
assert(
  counts.totalRouteEdges === counts.sourceRouteEdges + counts.supplementalRouteEdges,
  "Route-edge accounting drifted.",
);
assert(
  counts.packagingQueueRecords ===
    counts.phase6cNextPhaseCandidates + counts.newlyAdvancedByRouting,
  "Packaging queue accounting drifted.",
);
assert(
  counts.packagingQueueRecords +
    counts.remainingHeldRecords +
    counts.excludedNonStandalone === 125,
  "Final row accounting drifted.",
);
assert(counts.excludedNonStandalone === 2, "Non-standalone count drifted.");
assert(
  counts.routedButStillHeld + counts.newlyAdvancedByRouting === 10,
  "Routed-row disposition accounting drifted.",
);
assert(
  freeze.records.filter((record) => record.routingStatus === "resolved-and-frozen").length === 10,
  "Freeze records do not contain exactly 10 routed rows.",
);
assert(
  freeze.records.every((record) => !record.blockers.includes("explicit-routing-required")),
  "Explicit routing blocker remains after freeze.",
);
assert(freeze.canonicalImports === 0, "Canonical import occurred.");
assert(freeze.playerImports === 0, "Player import occurred.");
assert(freeze.teamRegistryWrites === 0, "Team-registry write occurred.");
assert(freeze.relationshipWrites === 0, "Relationship write occurred.");
assert(freeze.routeDataWrites === 0, "Route-data write occurred.");
assert(freeze.automaticMerges === 0, "Automatic merge occurred.");
assert(freeze.automaticRoutes === 0, "Automatic routing occurred.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");
assert(routing.safety.canonicalImports === 0, "Routing spec authorized an import.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "6D",
  verified: counts,
  routingSpecSha256: freeze.routingSpecSha256,
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
