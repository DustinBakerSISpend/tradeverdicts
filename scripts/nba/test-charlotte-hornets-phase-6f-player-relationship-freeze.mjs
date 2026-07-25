#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }

const args = parseArgs(process.argv);
for (const required of [
  "freeze-json", "eligibility-freeze-json", "dependency-seed-csv",
  "players-json", "trades-json", "contract-md",
]) assert(args[required], `Missing --${required}`);

const [freezeBytes, eligibilityBytes, dependencyBytes, playerBytes, tradeBytes, contractBytes] =
  await Promise.all([
    readFile(args["freeze-json"]), readFile(args["eligibility-freeze-json"]),
    readFile(args["dependency-seed-csv"]), readFile(args["players-json"]),
    readFile(args["trades-json"]), readFile(args["contract-md"]),
  ]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const eligibility = JSON.parse(eligibilityBytes.toString("utf8"));

assert(freeze.result === "PASS", "Phase 6F freeze did not pass.");
assert(freeze.phase === "6F", "Unexpected Phase 6F phase.");
assert(freeze.mode === "PLAYER_SHELL_AND_RELATIONSHIP_FREEZE", "Unexpected Phase 6F mode.");
assert(Array.isArray(freeze.records) && freeze.records.length === 103, "Expected 103 freeze records.");
assert(freeze.sourceEligibility.eligibilityRecordsSha256 === eligibility.eligibilityRecordsSha256, "Eligibility hash drifted.");
assert(freeze.sourceEligibility.dependencySeedSha256 === eligibility.dependencySeedSha256, "Dependency hash drifted.");
assert(freeze.sourceEligibility.freezeRecordsSha256 === eligibility.freezeRecordsSha256, "Phase 6E freeze hash drifted.");
assert(freeze.playersStoreSha256 === sha256(playerBytes), "Player-store hash drifted.");
assert(freeze.canonicalStoreSha256 === sha256(tradeBytes), "Canonical-store hash drifted.");
assert(freeze.contractSha256 === sha256(contractBytes), "Contract hash drifted.");
assert(freeze.freezeRecordsSha256 === sha256(JSON.stringify(freeze.records)), "Phase 6F freeze hash drifted.");

const counts = freeze.counts;
assert(counts.phase6eEligiblePackages === 103, "Eligible package count drifted.");
assert(counts.dependencySeedRows === 363, "Dependency count drifted.");
assert(counts.readyPackages + counts.heldPackages === 103, "Package accounting drifted.");
assert(
  counts.relationshipPreviewEdges + counts.ambiguousPlayerDependencyOccurrences ===
    counts.playerDependencyOccurrences,
  "Player dependency accounting drifted.",
);
assert(
  counts.relationshipPreviewEdges ===
    counts.exactExistingPlayerOccurrences + counts.proposedPlayerShellOccurrences,
  "Relationship accounting drifted.",
);
assert(
  freeze.records.filter((record) => record.importReady).length === counts.readyPackages,
  "Ready count drifted.",
);
assert(
  freeze.records.filter((record) => !record.importReady).length === counts.heldPackages,
  "Held count drifted.",
);
assert(
  freeze.records.every((record) =>
    record.readinessStatus === "ready-after-player-dependency-gate" ||
    record.readinessStatus === "hold-ambiguous-player-dependency"
  ),
  "Invalid readiness status.",
);
assert(freeze.canonicalImports === 0, "Canonical import occurred.");
assert(freeze.playerImports === 0, "Player import occurred.");
assert(freeze.relationshipWrites === 0, "Relationship write occurred.");
assert(freeze.routeDataWrites === 0, "Route-data write occurred.");
assert(freeze.canonicalIdsAssigned === 0, "Canonical IDs assigned.");
assert(freeze.automaticIdentityResolutions === 0, "Automatic identity resolution occurred.");
assert(freeze.automaticMerges === 0, "Automatic merge occurred.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "6F",
  verified: counts,
  proposedPlayerShellsSha256: freeze.proposedPlayerShellsSha256,
  relationshipPreviewRecordsSha256: freeze.relationshipPreviewRecordsSha256,
  ambiguousDependencyRecordsSha256: freeze.ambiguousDependencyRecordsSha256,
  packageReadinessRecordsSha256: freeze.packageReadinessRecordsSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  automaticIdentityResolutions: 0,
  automaticMerges: 0,
}, null, 2));
