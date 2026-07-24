#!/usr/bin/env node
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

const args = parseArgs(process.argv);
for (const required of [
  "resolution-json",
  "trades-json",
  "players-json",
]) {
  assert(args[required], `Missing --${required}`);
}

const [resolutionBytes, tradesBytes, playersBytes] = await Promise.all([
  readFile(args["resolution-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const result = JSON.parse(resolutionBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));

assert(result.result === "PASS" && result.phase === "4G", "Phase 4G failed.");
assert(Array.isArray(trades) && trades.length === 256, "Canonical store changed.");
assert(Array.isArray(players) && players.length === 509, "Player store changed.");

assert(result.sourceRows === 223, "Source count changed.");
assert(result.packagingActions === 211, "Packaging-action count changed.");
assert(result.sharedUnionResolutions === 3, "Shared-union count changed.");
assert(result.readyPackages + result.heldPackages === 211, "Import partition drift.");
assert(
  Object.values(result.eligibilityCounts).reduce((sum, count) => sum + count, 0) ===
    211,
  "Eligibility counts do not total 211.",
);

assert(
  result.baseRelationshipPreviews +
    result.additionalRelationshipPreviews +
    result.remainingAmbiguousOccurrences >=
    result.totalRelationshipPreviews,
  "Relationship accounting is internally inconsistent.",
);
assert(
  result.totalRelationshipPreviews ===
    result.baseRelationshipPreviews + result.additionalRelationshipPreviews,
  "Relationship preview total drift.",
);
assert(
  result.additionalRelationshipPreviews ===
    result.resolvedAmbiguousOccurrences,
  "Resolved ambiguous occurrence count drift.",
);

assert(
  result.sharedUnionResolutions ===
    result.sharedUnionResolutionRecords.length,
  "Shared-union array count drift.",
);
for (const union of result.sharedUnionResolutionRecords) {
  assert(union.resolutionStatus === "resolved", `${union.packageId}: union unresolved.`);
  assert(
    union.unionMethod ===
      "boston-routed-ledger-authoritative-with-atlanta-perspective",
    `${union.packageId}: union method drift.`,
  );
  assert(union.assetCount > 0, `${union.packageId}: asset union empty.`);
  assert(union.perspectiveCount === 2, `${union.packageId}: perspective count drift.`);
  assert(union.importAuthorized === false, `${union.packageId}: import authorized.`);
}

for (const identity of result.resolvedAmbiguousIdentityRecords) {
  assert(identity.selectedPlayerId, `${identity.displayName}: selected player missing.`);
  assert(
    [
      "unique-exact-primary-display-name",
      "unique-normalized-primary-name-versus-alias",
    ].includes(identity.method),
    `${identity.displayName}: unsafe resolution method.`,
  );
  assert(identity.actualWriteAuthorized === false, `${identity.displayName}: write authorized.`);
}

for (const hold of result.remainingAmbiguousHolds) {
  assert(
    hold.method === "manual-review-required",
    `${hold.displayName}: remaining hold method drift.`,
  );
  assert(
    hold.automaticResolutionAuthorized === false,
    `${hold.displayName}: automatic resolution authorized.`,
  );
  assert(
    hold.automaticMergeAuthorized === false,
    `${hold.displayName}: automatic merge authorized.`,
  );
}

for (const item of result.readiness) {
  assert(item.importAuthorized === false, `${item.packageId}: import authorized.`);
  if (item.packageKind === "shared-canonical-create") {
    assert(item.sharedUnionResolved === true, `${item.packageId}: shared union unresolved.`);
    assert(
      item.finalEligibility !== "blocked-shared-cross-team-asset-union",
      `${item.packageId}: obsolete shared blocker remains.`,
    );
  }
}

assert(result.canonicalImports === 0, "Canonical import detected.");
assert(result.playerImports === 0, "Player import detected.");
assert(result.perspectiveWrites === 0, "Perspective write detected.");
assert(result.relationshipWrites === 0, "Relationship write detected.");
assert(result.routeDataWrites === 0, "Route-data write detected.");
assert(result.automaticIdentityMerges === 0, "Automatic identity merge detected.");
assert(result.publicationAuthorized === false, "Publication authorized.");
assert(result.pushPerformed === false, "Push marker changed.");
assert(result.deployPerformed === false, "Deploy marker changed.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "4G",
  verified: {
    sourceRows: 223,
    packagingActions: 211,
    sharedUnionResolutions: result.sharedUnionResolutions,
    resolvedAmbiguousIdentities: result.resolvedAmbiguousIdentities,
    remainingAmbiguousIdentities: result.remainingAmbiguousIdentities,
    readyPackages: result.readyPackages,
    heldPackages: result.heldPackages,
    baseRelationshipPreviews: result.baseRelationshipPreviews,
    additionalRelationshipPreviews: result.additionalRelationshipPreviews,
    totalRelationshipPreviews: result.totalRelationshipPreviews,
    playerShellPackages: result.playerShellPackages,
    eligibilityCounts: result.eligibilityCounts,
    canonicalStoreCount: 256,
    playerStoreCount: 509,
    canonicalImports: 0,
    playerImports: 0,
    perspectiveWrites: 0,
    relationshipWrites: 0,
    routeDataWrites: 0,
    automaticIdentityMerges: 0,
  },
}, null, 2));
