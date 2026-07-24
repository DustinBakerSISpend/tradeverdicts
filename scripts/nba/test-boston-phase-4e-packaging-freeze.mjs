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

assert(freeze.result === "PASS" && freeze.phase === "4E", "Phase 4E freeze failed.");
assert(Array.isArray(trades) && trades.length === 256, "Canonical store changed.");
assert(Array.isArray(players) && players.length === 509, "Player store changed.");

assert(freeze.sourceRows === 223, "Source-row count changed.");
assert(freeze.canonicalCreatePackages === 200, "Canonical-create count changed.");
assert(freeze.bostonOnlyCanonicalCreatePackages === 197, "Boston-only create count changed.");
assert(freeze.sharedCanonicalCreatePackages === 3, "Shared create count changed.");
assert(freeze.perspectiveAppendPackages === 11, "Perspective count changed.");
assert(freeze.excludedNonStandalone === 12, "Excluded count changed.");
assert(freeze.totalPackagingActions === 211, "Packaging-action count changed.");
assert(freeze.packages.length === 211, "Package array count changed.");

assert(freeze.canonicalImports === 0, "Canonical import detected.");
assert(freeze.playerImports === 0, "Player import detected.");
assert(freeze.perspectiveWrites === 0, "Perspective write detected.");
assert(freeze.relationshipWrites === 0, "Relationship write detected.");
assert(freeze.routeDataWrites === 0, "Route-data write detected.");
assert(freeze.automaticMerges === 0, "Automatic merge detected.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");
assert(freeze.pushPerformed === false, "Push marker changed.");
assert(freeze.deployPerformed === false, "Deploy marker changed.");

assert(
  new Set(freeze.packages.map((item) => item.packageId)).size === 211,
  "Package IDs are not unique.",
);
assert(
  freeze.packages.every(
    (item) =>
      item.actualWriteAuthorized === false &&
      item.importAuthorized === false,
  ),
  "A package authorizes an actual write.",
);

const createPackages = freeze.packages.filter((item) =>
  ["canonical-create", "shared-canonical-create"].includes(item.packageKind)
);
const perspectivePackages = freeze.packages.filter(
  (item) => item.packageKind === "perspective-append"
);
const sharedPackages = freeze.packages.filter(
  (item) => item.packageKind === "shared-canonical-create"
);

assert(createPackages.length === 200, "Create package array count changed.");
assert(perspectivePackages.length === 11, "Perspective package array count changed.");
assert(sharedPackages.length === 3, "Shared package array count changed.");

const canonicalIds = new Set(trades.map((trade) => trade.id));
for (const item of createPackages) {
  assert(
    !canonicalIds.has(item.targetCanonicalId),
    `${item.sourceTradeId}: create target collides with canonical store.`,
  );
  assert(item.canonicalPayload, `${item.sourceTradeId}: canonical payload missing.`);
  assert(
    item.canonicalPayload.publishStatus === "private" &&
      item.canonicalPayload.indexEligible === false &&
      item.canonicalPayload.adEligible === false &&
      item.canonicalPayload.importAuthorized === false,
    `${item.sourceTradeId}: canonical privacy/import guard failed.`,
  );
  assert(
    item.canonicalPayload.assetLedger.every(
      (asset) =>
        asset.fromTeam &&
        asset.toTeam &&
        asset.type !== "other" &&
        asset.status !== "unclassified",
    ),
    `${item.sourceTradeId}: invalid packaged asset.`,
  );
}

for (const item of perspectivePackages) {
  assert(
    canonicalIds.has(item.targetCanonicalId),
    `${item.sourceTradeId}: perspective target is missing.`,
  );
  assert(item.targetExists === true, `${item.sourceTradeId}: targetExists drift.`);
  assert(
    item.perspectivePayload?.sourceTeam === "boston-celtics",
    `${item.sourceTradeId}: Boston perspective payload missing.`,
  );
}

for (const item of sharedPackages) {
  assert(
    item.importEligibility === "blocked-shared-cross-team-asset-union",
    `${item.sourceTradeId}: shared package was not held.`,
  );
  assert(
    item.atlantaSourceTradeId &&
      item.canonicalPayload.sourceTeams.includes("atlanta-hawks") &&
      item.canonicalPayload.sourceTeams.includes("boston-celtics") &&
      item.canonicalPayload.perspectives.length === 2,
    `${item.sourceTradeId}: shared source packaging failed.`,
  );
}

const dependencyStatusTotal = Object.values(
  freeze.dependencyStatusCounts,
).reduce((sum, count) => sum + count, 0);
assert(
  dependencyStatusTotal === freeze.uniquePlayerDependencies,
  "Dependency status counts do not total unique dependencies.",
);

const eligibilityTotal = Object.values(
  freeze.importEligibilityCounts,
).reduce((sum, count) => sum + count, 0);
assert(eligibilityTotal === 211, "Eligibility counts do not total packages.");

for (const dependency of freeze.dependencies) {
  assert(dependency.normalizedName, "Dependency normalized name missing.");
  assert(dependency.displayName, "Dependency display name missing.");
  assert(
    [
      "existing-player",
      "new-player-shell-required",
      "ambiguous-existing-player",
    ].includes(dependency.dependencyStatus),
    `${dependency.displayName}: invalid dependency status.`,
  );

  if (dependency.dependencyStatus === "existing-player") {
    assert(dependency.existingPlayerId, `${dependency.displayName}: player ID missing.`);
  }
  if (dependency.dependencyStatus === "new-player-shell-required") {
    assert(
      dependency.provisionalPlayerId?.startsWith("nba-player-"),
      `${dependency.displayName}: provisional player ID missing.`,
    );
  }
  if (dependency.dependencyStatus === "ambiguous-existing-player") {
    assert(
      dependency.matchedPlayerIds.length >= 2,
      `${dependency.displayName}: ambiguous match set is incomplete.`,
    );
  }
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "4E",
  verified: {
    sourceRows: 223,
    canonicalCreatePackages: 200,
    bostonOnlyCanonicalCreatePackages: 197,
    sharedCanonicalCreatePackages: 3,
    perspectiveAppendPackages: 11,
    excludedNonStandalone: 12,
    totalPackagingActions: 211,
    uniquePlayerDependencies: freeze.uniquePlayerDependencies,
    dependencyOccurrences: freeze.dependencyOccurrences,
    dependencyStatusCounts: freeze.dependencyStatusCounts,
    importEligibilityCounts: freeze.importEligibilityCounts,
    canonicalStoreCount: 256,
    playerStoreCount: 509,
    canonicalImports: 0,
    playerImports: 0,
    perspectiveWrites: 0,
    relationshipWrites: 0,
    routeDataWrites: 0,
    automaticMerges: 0,
  },
}, null, 2));
