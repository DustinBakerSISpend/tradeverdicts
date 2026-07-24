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
for (const required of ["freeze-json", "trades-json", "players-json"]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, tradesBytes, playersBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));

assert(freeze.result === "PASS" && freeze.phase === "4F", "Phase 4F freeze failed.");
assert(Array.isArray(trades) && trades.length === 256, "Canonical store changed.");
assert(Array.isArray(players) && players.length === 509, "Player store changed.");

assert(freeze.sourceRows === 223, "Source count changed.");
assert(freeze.packagingActions === 211, "Packaging-action count changed.");
assert(freeze.canonicalCreatePackages === 200, "Canonical-create count changed.");
assert(freeze.perspectiveAppendPackages === 11, "Perspective count changed.");

assert(
  freeze.playerShellPackages ===
    (freeze.dependencyStatusCounts["new-player-shell-required"] ?? 0),
  "Player-shell count does not match dependency status.",
);
assert(
  freeze.ambiguousPlayerHolds ===
    (freeze.dependencyStatusCounts["ambiguous-existing-player"] ?? 0),
  "Ambiguous-hold count does not match dependency status.",
);
assert(
  freeze.relationshipPreviewEdges +
    freeze.ambiguousRelationshipOccurrences ===
    freeze.dependencyOccurrences,
  "Relationship occurrence accounting does not reconcile.",
);
assert(
  freeze.syntheticAssetReferences >= 1,
  "Expected at least one deterministic fallback asset reference.",
);

assert(
  new Set(
    freeze.shellPackages.map((item) => item.playerPayload.id),
  ).size === freeze.shellPackages.length,
  "Player-shell IDs are not unique.",
);
assert(
  new Set(
    freeze.relationshipPreviews.map((item) => item.relationshipId),
  ).size === freeze.relationshipPreviews.length,
  "Relationship IDs are not unique.",
);

const currentPlayerIds = new Set(
  players.map((player) =>
    String(
      player.id ??
        player.playerId ??
        player.slug ??
        player.identity?.id ??
        "",
    ).trim()
  ).filter(Boolean),
);

for (const item of freeze.shellPackages) {
  assert(item.packageKind === "player-shell-create", "Invalid shell package kind.");
  assert(
    item.playerPayload.id.startsWith("nba-player-"),
    `${item.playerPayload.displayName}: invalid shell ID.`,
  );
  assert(
    !currentPlayerIds.has(item.playerPayload.id),
    `${item.playerPayload.displayName}: shell ID collides with current store.`,
  );
  assert(
    item.playerPayload.publishStatus === "private" &&
      item.playerPayload.indexEligible === false &&
      item.playerPayload.adEligible === false &&
      item.playerPayload.importAuthorized === false &&
      item.actualWriteAuthorized === false &&
      item.importAuthorized === false,
    `${item.playerPayload.displayName}: shell safety guard failed.`,
  );
}

for (const item of freeze.relationshipPreviews) {
  assert(item.playerId, `${item.relationshipId}: player ID missing.`);
  assert(item.assetId, `${item.relationshipId}: asset reference missing.`);
  assert(
    item.syntheticAssetReference === true ||
      Boolean(item.sourceAssetId),
    `${item.relationshipId}: source/synthetic asset provenance missing.`,
  );
  assert(item.targetCanonicalId, `${item.relationshipId}: canonical target missing.`);
  assert(
    item.actualWriteAuthorized === false &&
      item.importAuthorized === false &&
      item.privateOnly === true &&
      item.indexEligible === false &&
      item.adEligible === false,
    `${item.relationshipId}: relationship safety guard failed.`,
  );
}

for (const hold of freeze.ambiguousHolds) {
  assert(
    hold.matchedPlayerIds.length >= 2,
    `${hold.displayName}: ambiguous match set incomplete.`,
  );
  assert(
    hold.automaticResolutionAuthorized === false,
    `${hold.displayName}: automatic identity resolution enabled.`,
  );
}

const readinessTotal = Object.values(
  freeze.packageReadinessCounts,
).reduce((sum, count) => sum + count, 0);
assert(readinessTotal === 211, "Package-readiness counts do not total 211.");

assert(freeze.canonicalImports === 0, "Canonical import detected.");
assert(freeze.playerImports === 0, "Player import detected.");
assert(freeze.perspectiveWrites === 0, "Perspective write detected.");
assert(freeze.relationshipWrites === 0, "Relationship write detected.");
assert(freeze.routeDataWrites === 0, "Route-data write detected.");
assert(
  freeze.automaticIdentityResolutions === 0,
  "Automatic identity resolution detected.",
);
assert(freeze.automaticMerges === 0, "Automatic merge detected.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");
assert(freeze.pushPerformed === false, "Push marker changed.");
assert(freeze.deployPerformed === false, "Deploy marker changed.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "4F",
  verified: {
    sourceRows: 223,
    packagingActions: 211,
    canonicalCreatePackages: 200,
    perspectiveAppendPackages: 11,
    uniquePlayerDependencies: freeze.uniquePlayerDependencies,
    dependencyOccurrences: freeze.dependencyOccurrences,
    playerShellPackages: freeze.playerShellPackages,
    relationshipPreviewEdges: freeze.relationshipPreviewEdges,
    ambiguousPlayerHolds: freeze.ambiguousPlayerHolds,
    ambiguousRelationshipOccurrences:
      freeze.ambiguousRelationshipOccurrences,
    syntheticAssetReferences: freeze.syntheticAssetReferences,
    packageReadinessCounts: freeze.packageReadinessCounts,
    canonicalStoreCount: 256,
    playerStoreCount: 509,
    canonicalImports: 0,
    playerImports: 0,
    perspectiveWrites: 0,
    relationshipWrites: 0,
    routeDataWrites: 0,
    automaticIdentityResolutions: 0,
    automaticMerges: 0,
  },
}, null, 2));
