#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
function clean(value) {
  return String(value ?? "").trim();
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function toCsv(rows, fallbackHeaders = []) {
  const headers = rows.length ? Object.keys(rows[0]) : fallbackHeaders;
  if (!headers.length) return "";
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}
function countBy(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)));
}
function playerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id);
}
function syntheticAssetReference(dependency) {
  return `phase5f-asset-${sha256([
    dependency.packageId,
    dependency.sourceTradeId,
    dependency.packageTarget,
    dependency.normalizedName,
    dependency.role,
    dependency.dependencyId,
  ].join("|")).slice(0, 20)}`;
}
function relationshipId(dependency, resolvedPlayerId, assetReference) {
  return `nba-rel-${sha256([
    dependency.packageId,
    dependency.sourceTradeId,
    dependency.packageTarget,
    assetReference,
    dependency.role,
    resolvedPlayerId,
  ].join("|")).slice(0, 20)}`;
}
function readinessFor(packageItem, dependencyOccurrences) {
  const originalStatus = clean(packageItem.importEligibility?.status);
  const originalBlockers = Array.isArray(packageItem.importEligibility?.blockers)
    ? packageItem.importEligibility.blockers
    : [];
  const statuses = new Set(dependencyOccurrences.map((item) => item.status));
  const blockers = [...new Set([
    ...originalBlockers,
    ...(packageItem.packageType === "canonical-collision-hold"
      ? ["existing-canonical-collision"]
      : []),
    ...(packageItem.packageType === "reviewed-source-collision-hold"
      ? ["cross-team-source-collision"]
      : []),
  ])];

  let status;
  if (statuses.has("ambiguous-player")) {
    status = "hold-ambiguous-player";
    blockers.push("ambiguous-player");
  } else if (blockers.includes("existing-canonical-collision")) {
    status = "hold-existing-canonical-collision";
  } else if (blockers.includes("cross-team-source-collision")) {
    status = "hold-cross-team-source-collision";
  } else if (blockers.includes("unclassified-asset") || originalStatus === "hold-unclassified-asset") {
    status = "hold-unclassified-asset";
  } else if (blockers.includes("recent-or-provisional") || originalStatus === "hold-recent-or-provisional") {
    status = "hold-recent-or-provisional";
  } else if (statuses.has("missing-player-shell")) {
    status = "ready-with-player-shells";
  } else if (dependencyOccurrences.length > 0) {
    status = "ready-existing-player-dependencies";
  } else {
    status = "ready-no-player-dependencies";
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    status,
    ready: status.startsWith("ready-"),
    held: status.startsWith("hold-"),
    blockers: uniqueBlockers,
    shellCreationRequired: statuses.has("missing-player-shell"),
    ambiguousIdentityReviewRequired: statuses.has("ambiguous-player"),
  };
}

const args = parseArgs(process.argv);
for (const required of [
  "phase5e-freeze",
  "trades-json",
  "players-json",
  "output-dir",
]) assert(args[required], `Missing --${required}`);

const [phase5EBytes, tradesBytes, playersBytes] = await Promise.all([
  readFile(args["phase5e-freeze"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const phase5E = JSON.parse(phase5EBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));
const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

assert(phase5E.result === "PASS" && phase5E.phase === "5E", "Invalid Phase 5E packaging freeze.");
assert(Array.isArray(phase5E.packages) && phase5E.packages.length === 208, "Expected 208 Phase 5E packages.");
assert(Array.isArray(phase5E.uniquePlayerDependencies), "Phase 5E unique dependencies are missing.");
assert(Array.isArray(trades) && trades.length === 456, "Canonical trade store changed.");
assert(Array.isArray(players), "Player store is not an array.");

const canonicalIds = new Set(trades.map((trade) => clean(trade.id)).filter(Boolean));
const playerIds = new Set(players.map(playerId).filter(Boolean));
const packageById = new Map(phase5E.packages.map((item) => [item.packageId, item]));
assert(packageById.size === 208, "Duplicate Phase 5E package ID.");

const uniqueDependencyByName = new Map(
  phase5E.uniquePlayerDependencies.map((item) => [item.normalizedName, item])
);
assert(
  uniqueDependencyByName.size === phase5E.uniquePlayerDependencies.length,
  "Duplicate unique player dependency."
);

const shellPackages = [];
const ambiguousHolds = [];
for (const dependency of phase5E.uniquePlayerDependencies) {
  if (dependency.status === "existing-player") {
    assert(dependency.resolvedPlayerId, `${dependency.playerName}: existing player ID missing.`);
    assert(playerIds.has(dependency.resolvedPlayerId), `${dependency.playerName}: existing player target is absent.`);
  } else if (dependency.status === "missing-player-shell") {
    assert(
      clean(dependency.proposedPlayerId).startsWith("nba-player-"),
      `${dependency.playerName}: proposed shell ID is invalid.`
    );
    assert(!playerIds.has(dependency.proposedPlayerId), `${dependency.playerName}: proposed shell ID collides.`);
    shellPackages.push({
      packageId: `${dependency.proposedPlayerId}:shell`,
      packageType: "player-shell-create",
      playerPayload: {
        id: dependency.proposedPlayerId,
        league: "nba",
        slug: dependency.proposedPlayerId.replace(/^nba-player-/u, ""),
        displayName: dependency.playerName,
        normalizedName: dependency.normalizedName,
        aliases: [],
        sourceTradeIds: dependency.sourceTradeIds,
        roles: dependency.roles,
        publishStatus: "private",
        reviewStatus: "shell-packaged-import-blocked",
        indexEligible: false,
        adEligible: false,
        publicationReady: false,
        createdAt: "2026-07-24T00:00:00.000Z",
        updatedAt: "2026-07-24T00:00:00.000Z",
      },
      dependencyStatus: dependency.status,
      occurrenceCount: dependency.occurrenceCount,
      actualWriteAuthorized: false,
      importAuthorized: false,
      privateOnly: true,
    });
  } else {
    assert(dependency.status === "ambiguous-player", `${dependency.playerName}: unexpected dependency status.`);
    assert(
      Array.isArray(dependency.candidatePlayerIds) && dependency.candidatePlayerIds.length >= 2,
      `${dependency.playerName}: ambiguous candidate set is incomplete.`
    );
    assert(
      dependency.candidatePlayerIds.every((id) => playerIds.has(id)),
      `${dependency.playerName}: ambiguous candidate is absent from the player store.`
    );
    ambiguousHolds.push({
      playerName: dependency.playerName,
      normalizedName: dependency.normalizedName,
      candidatePlayerIds: dependency.candidatePlayerIds,
      packageIds: phase5E.packages
        .filter((item) =>
          item.playerDependencies.some((occurrence) =>
            occurrence.normalizedName === dependency.normalizedName
          )
        )
        .map((item) => item.packageId)
        .sort(),
      sourceTradeIds: dependency.sourceTradeIds,
      roles: dependency.roles,
      occurrenceCount: dependency.occurrenceCount,
      holdReason: "Multiple current player records match the normalized identity.",
      automaticResolutionAuthorized: false,
    });
  }
}

assert(
  new Set(shellPackages.map((item) => item.playerPayload.id)).size === shellPackages.length,
  "Duplicate player-shell target ID."
);

const relationshipPreviews = [];
const packageReadiness = [];
let syntheticAssetReferences = 0;
let dependencyOccurrences = 0;
let ambiguousRelationshipOccurrences = 0;

for (const packageItem of phase5E.packages) {
  const occurrences = Array.isArray(packageItem.playerDependencies)
    ? packageItem.playerDependencies
    : [];
  dependencyOccurrences += occurrences.length;

  for (const dependency of occurrences) {
    const uniqueDependency = uniqueDependencyByName.get(dependency.normalizedName);
    assert(uniqueDependency, `${dependency.playerName}: unique dependency is missing.`);
    assert(
      uniqueDependency.status === dependency.status,
      `${dependency.playerName}: dependency status drifted.`
    );

    if (dependency.status === "ambiguous-player") {
      ambiguousRelationshipOccurrences += 1;
      continue;
    }

    const resolvedPlayerId = dependency.status === "existing-player"
      ? dependency.resolvedPlayerId
      : dependency.proposedPlayerId;
    assert(resolvedPlayerId, `${dependency.playerName}: relationship player ID is missing.`);

    const sourceAssetId = clean(dependency.sourceAssetId);
    const assetReference = sourceAssetId || syntheticAssetReference({
      ...dependency,
      packageId: packageItem.packageId,
    });
    const synthetic = !sourceAssetId;
    if (synthetic) syntheticAssetReferences += 1;

    relationshipPreviews.push({
      relationshipId: relationshipId({
        ...dependency,
        packageId: packageItem.packageId,
      }, resolvedPlayerId, assetReference),
      packageId: packageItem.packageId,
      packageType: packageItem.packageType,
      sourceTradeId: packageItem.sourceTradeId,
      targetCanonicalId: packageItem.targetCanonicalId,
      assetReference,
      sourceAssetId: sourceAssetId || null,
      syntheticAssetReference: synthetic,
      relationshipRole: dependency.role,
      playerId: resolvedPlayerId,
      playerDisplayName: dependency.playerName,
      playerDependencyStatus: dependency.status,
      privateOnly: true,
      relationshipWriteAuthorized: false,
      importAuthorized: false,
    });
  }

  const readiness = readinessFor(packageItem, occurrences);
  packageReadiness.push({
    packageId: packageItem.packageId,
    sourceTradeId: packageItem.sourceTradeId,
    tradeDate: packageItem.tradeDate,
    packageType: packageItem.packageType,
    targetCanonicalId: packageItem.targetCanonicalId,
    playerDependencyOccurrences: occurrences.length,
    existingPlayerOccurrences: occurrences.filter((item) => item.status === "existing-player").length,
    playerShellOccurrences: occurrences.filter((item) => item.status === "missing-player-shell").length,
    ambiguousPlayerOccurrences: occurrences.filter((item) => item.status === "ambiguous-player").length,
    readinessStatus: readiness.status,
    ready: readiness.ready,
    held: readiness.held,
    blockers: readiness.blockers,
    shellCreationRequired: readiness.shellCreationRequired,
    ambiguousIdentityReviewRequired: readiness.ambiguousIdentityReviewRequired,
    privateOnly: true,
    importAuthorized: false,
  });
}

assert(dependencyOccurrences === phase5E.counts.dependencyOccurrences, "Dependency occurrence count drifted.");
assert(
  new Set(relationshipPreviews.map((item) => item.relationshipId)).size === relationshipPreviews.length,
  "Duplicate relationship preview ID."
);
assert(
  relationshipPreviews.length + ambiguousRelationshipOccurrences === dependencyOccurrences,
  "Relationship occurrence accounting drifted."
);
assert(packageReadiness.length === 208, "Package readiness count drifted.");

const readinessCounts = countBy(packageReadiness.map((item) => item.readinessStatus));
const dependencyStatusCounts = countBy(
  phase5E.uniquePlayerDependencies.map((item) => item.status)
);
const readyPackages = packageReadiness.filter((item) => item.ready).length;
const heldPackages = packageReadiness.filter((item) => item.held).length;

assert(readyPackages + heldPackages === 208, "Readiness accounting does not total 208.");
assert(shellPackages.length === (dependencyStatusCounts["missing-player-shell"] ?? 0), "Shell package count drifted.");
assert(ambiguousHolds.length === (dependencyStatusCounts["ambiguous-player"] ?? 0), "Ambiguous hold count drifted.");

const freeze = {
  result: "PASS",
  phase: "5F",
  mode: "BROOKLYN_NETS_PLAYER_SHELL_AND_RELATIONSHIP_FREEZE",
  batchId: "brooklyn-nets-phase-5f",
  sourcePhase: "5E",
  sourceFreeze: {
    phase5EFileSha256: sha256(phase5EBytes),
    packageRecordsSha256: phase5E.packageRecordsSha256,
    dependencyRecordsSha256: phase5E.dependencyRecordsSha256,
  },
  storeHashes: {
    canonicalTradesSha256: sha256(tradesBytes),
    playersSha256: sha256(playersBytes),
  },
  sourceRows: phase5E.counts.sourceRows,
  packagingActions: phase5E.packages.length,
  canonicalCreatePackages: phase5E.counts.canonicalCreatePackages,
  perspectiveAppendPackages: phase5E.counts.perspectiveAppendPackages,
  canonicalCollisionHoldPackages: phase5E.counts.canonicalCollisionHoldPackages,
  reviewedSourceCollisionHoldPackages: phase5E.counts.reviewedSourceCollisionHoldPackages,
  uniquePlayerDependencies: phase5E.uniquePlayerDependencies.length,
  dependencyOccurrences,
  dependencyStatusCounts,
  playerShellPackages: shellPackages.length,
  relationshipPreviewEdges: relationshipPreviews.length,
  ambiguousPlayerHolds: ambiguousHolds.length,
  ambiguousRelationshipOccurrences,
  syntheticAssetReferences,
  readyPackages,
  heldPackages,
  packageReadinessCounts: readinessCounts,
  playerShellRecordsSha256: sha256(Buffer.from(stable(shellPackages))),
  relationshipRecordsSha256: sha256(Buffer.from(stable(relationshipPreviews))),
  packageReadinessRecordsSha256: sha256(Buffer.from(stable(packageReadiness))),
  policy: {
    privateOnly: true,
    canonicalImportsAuthorized: false,
    playerImportsAuthorized: false,
    perspectiveWritesAuthorized: false,
    relationshipWritesAuthorized: false,
    routeDataWritesAuthorized: false,
    automaticIdentityResolutionsAuthorized: false,
    automaticMergesAuthorized: false,
    publicationAuthorized: false,
    pushAuthorized: false,
    deploymentAuthorized: false,
  },
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticIdentityResolutions: 0,
  automaticMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
  playerShellPackageRecords: shellPackages,
  relationshipPreviewRecords: relationshipPreviews,
  ambiguousPlayerHoldRecords: ambiguousHolds,
  packageReadinessRecords: packageReadiness,
};

const shellRows = shellPackages.map((item) => ({
  packageId: item.packageId,
  playerId: item.playerPayload.id,
  displayName: item.playerPayload.displayName,
  normalizedName: item.playerPayload.normalizedName,
  sourceTradeIds: item.playerPayload.sourceTradeIds.join(" | "),
  roles: item.playerPayload.roles.join(" | "),
  occurrenceCount: item.occurrenceCount,
  importAuthorized: item.importAuthorized,
}));
const relationshipRows = relationshipPreviews.map((item) => ({
  relationshipId: item.relationshipId,
  packageId: item.packageId,
  packageType: item.packageType,
  sourceTradeId: item.sourceTradeId,
  targetCanonicalId: item.targetCanonicalId,
  assetReference: item.assetReference,
  sourceAssetId: item.sourceAssetId ?? "",
  syntheticAssetReference: item.syntheticAssetReference,
  relationshipRole: item.relationshipRole,
  playerId: item.playerId,
  playerDisplayName: item.playerDisplayName,
  playerDependencyStatus: item.playerDependencyStatus,
  relationshipWriteAuthorized: item.relationshipWriteAuthorized,
}));
const ambiguousRows = ambiguousHolds.map((item) => ({
  playerName: item.playerName,
  normalizedName: item.normalizedName,
  candidatePlayerIds: item.candidatePlayerIds.join(" | "),
  packageIds: item.packageIds.join(" | "),
  sourceTradeIds: item.sourceTradeIds.join(" | "),
  roles: item.roles.join(" | "),
  occurrenceCount: item.occurrenceCount,
  holdReason: item.holdReason,
  automaticResolutionAuthorized: item.automaticResolutionAuthorized,
}));
const readinessRows = packageReadiness.map((item) => ({
  packageId: item.packageId,
  sourceTradeId: item.sourceTradeId,
  tradeDate: item.tradeDate,
  packageType: item.packageType,
  targetCanonicalId: item.targetCanonicalId,
  playerDependencyOccurrences: item.playerDependencyOccurrences,
  existingPlayerOccurrences: item.existingPlayerOccurrences,
  playerShellOccurrences: item.playerShellOccurrences,
  ambiguousPlayerOccurrences: item.ambiguousPlayerOccurrences,
  readinessStatus: item.readinessStatus,
  ready: item.ready,
  held: item.held,
  blockers: item.blockers.join(" | "),
  shellCreationRequired: item.shellCreationRequired,
  ambiguousIdentityReviewRequired: item.ambiguousIdentityReviewRequired,
  importAuthorized: item.importAuthorized,
}));

const summary = {
  result: freeze.result,
  phase: freeze.phase,
  mode: freeze.mode,
  sourceRows: freeze.sourceRows,
  packagingActions: freeze.packagingActions,
  canonicalCreatePackages: freeze.canonicalCreatePackages,
  perspectiveAppendPackages: freeze.perspectiveAppendPackages,
  canonicalCollisionHoldPackages: freeze.canonicalCollisionHoldPackages,
  reviewedSourceCollisionHoldPackages: freeze.reviewedSourceCollisionHoldPackages,
  uniquePlayerDependencies: freeze.uniquePlayerDependencies,
  dependencyOccurrences: freeze.dependencyOccurrences,
  dependencyStatusCounts: freeze.dependencyStatusCounts,
  playerShellPackages: freeze.playerShellPackages,
  relationshipPreviewEdges: freeze.relationshipPreviewEdges,
  ambiguousPlayerHolds: freeze.ambiguousPlayerHolds,
  ambiguousRelationshipOccurrences: freeze.ambiguousRelationshipOccurrences,
  syntheticAssetReferences: freeze.syntheticAssetReferences,
  readyPackages: freeze.readyPackages,
  heldPackages: freeze.heldPackages,
  packageReadinessCounts: freeze.packageReadinessCounts,
  playerShellRecordsSha256: freeze.playerShellRecordsSha256,
  relationshipRecordsSha256: freeze.relationshipRecordsSha256,
  packageReadinessRecordsSha256: freeze.packageReadinessRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticIdentityResolutions: 0,
  automaticMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

await Promise.all([
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5f-player-relationship-freeze.json"), JSON.stringify(freeze, null, 2) + "\n", "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5f-player-shell-packages.csv"), toCsv(shellRows, [
    "packageId", "playerId", "displayName", "normalizedName", "sourceTradeIds",
    "roles", "occurrenceCount", "importAuthorized",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5f-relationship-previews.csv"), toCsv(relationshipRows, [
    "relationshipId", "packageId", "packageType", "sourceTradeId",
    "targetCanonicalId", "assetReference", "sourceAssetId", "syntheticAssetReference",
    "relationshipRole", "playerId", "playerDisplayName", "playerDependencyStatus",
    "relationshipWriteAuthorized",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5f-ambiguous-player-holds.csv"), toCsv(ambiguousRows, [
    "playerName", "normalizedName", "candidatePlayerIds", "packageIds",
    "sourceTradeIds", "roles", "occurrenceCount", "holdReason",
    "automaticResolutionAuthorized",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5f-package-readiness.csv"), toCsv(readinessRows), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5f-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8"),
]);

console.log(JSON.stringify(summary, null, 2));
