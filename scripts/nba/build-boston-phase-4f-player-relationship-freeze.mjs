#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/['’`]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function slugify(value) {
  return normalizeName(value).replace(/\s+/gu, "-") || "unknown";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

function readPlayerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id);
}

function packageAssets(item) {
  const assets =
    item.packageKind === "perspective-append"
      ? item.routedAssetLedger
      : item.canonicalPayload?.assetLedger;

  assert(
    Array.isArray(assets),
    `${item.packageId}: package asset ledger is missing.`,
  );

  return assets;
}

function assetMatchesOccurrence(asset, occurrence) {
  if (asset.type !== occurrence.assetType) return false;

  if (
    occurrence.role === "traded-player" ||
    occurrence.role === "draft-rights-player"
  ) {
    return (
      normalizeName(asset.playerName) ===
      normalizeName(occurrence.playerName)
    );
  }

  if (occurrence.role === "pick-became-player") {
    return (
      normalizeName(asset.becamePlayerName) ===
      normalizeName(occurrence.playerName)
    );
  }

  return false;
}

function resolveOccurrenceAsset(item, occurrence) {
  const assets = packageAssets(item);
  const sourceAssetId = clean(occurrence.assetId);

  if (sourceAssetId) {
    const exact = assets.find((asset) => clean(asset.assetId) === sourceAssetId);
    assert(exact, `${sourceAssetId}: source package asset is missing.`);
    return {
      asset: exact,
      assetReference: sourceAssetId,
      sourceAssetId,
      syntheticAssetReference: false,
    };
  }

  const candidates = assets.filter((asset) =>
    assetMatchesOccurrence(asset, occurrence)
  );

  assert(
    candidates.length === 1,
    `${occurrence.packageId}: expected one fallback asset for ` +
      `${occurrence.playerName} (${occurrence.role}); found ${candidates.length}.`,
  );

  const asset = candidates[0];
  const assetReference = `phase4f-asset-${sha256([
    occurrence.packageId,
    occurrence.sourceTradeId,
    occurrence.assetType,
    occurrence.role,
    occurrence.playerName,
    asset.direction ?? "",
    asset.fromTeam ?? "",
    asset.toTeam ?? "",
    asset.displayText ?? "",
  ].join("|")).slice(0, 18)}`;

  return {
    asset,
    assetReference,
    sourceAssetId: null,
    syntheticAssetReference: true,
  };
}

function relationshipId(occurrence, playerId, assetReference) {
  return `nba-rel-${sha256([
    occurrence.packageId,
    occurrence.sourceTradeId,
    assetReference,
    occurrence.role,
    playerId,
  ].join("|")).slice(0, 18)}`;
}

const args = parseArgs(process.argv);
for (const required of [
  "phase4e-freeze",
  "trades-json",
  "players-json",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, tradesBytes, playersBytes] = await Promise.all([
  readFile(args["phase4e-freeze"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const phase4e = JSON.parse(freezeBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));

assert(
  phase4e.result === "PASS" &&
    phase4e.phase === "4E" &&
    phase4e.packages.length === 211,
  "Invalid Phase 4E packaging freeze.",
);
assert(Array.isArray(trades) && trades.length === 256, "Canonical store changed.");
assert(Array.isArray(players) && players.length === 509, "Player store changed.");

const canonicalIds = new Set(trades.map((trade) => clean(trade.id)).filter(Boolean));
const playerIds = new Set(players.map(readPlayerId).filter(Boolean));
const packageById = new Map(
  phase4e.packages.map((item) => [item.packageId, item]),
);

assert(packageById.size === 211, "Phase 4E package IDs are not unique.");

const shellPackages = [];
const relationshipPreviews = [];
const ambiguousHolds = [];
let syntheticAssetReferences = 0;

for (const dependency of phase4e.dependencies) {
  if (dependency.dependencyStatus === "existing-player") {
    assert(
      dependency.existingPlayerId &&
        playerIds.has(dependency.existingPlayerId),
      `${dependency.displayName}: existing player target is missing.`,
    );
  } else if (dependency.dependencyStatus === "new-player-shell-required") {
    assert(
      dependency.provisionalPlayerId?.startsWith("nba-player-"),
      `${dependency.displayName}: provisional player ID is missing.`,
    );
    assert(
      !playerIds.has(dependency.provisionalPlayerId),
      `${dependency.displayName}: provisional player ID collides with the store.`,
    );

    shellPackages.push({
      packageId: `${dependency.provisionalPlayerId}:shell`,
      packageKind: "player-shell-create",
      playerPayload: {
        id: dependency.provisionalPlayerId,
        league: "nba",
        slug: dependency.provisionalPlayerId.replace(/^nba-player-/u, ""),
        displayName: dependency.displayName,
        normalizedName: dependency.normalizedName,
        aliases: dependency.displayNames
          .filter((name) => name !== dependency.displayName)
          .sort(),
        sourceTradeIds: dependency.sourceTradeIds,
        packageIds: dependency.packageIds,
        publishStatus: "private",
        reviewStatus: "shell-packaged-import-blocked",
        indexEligible: false,
        adEligible: false,
        publicationReady: false,
        importAuthorized: false,
        createdAt: "2026-07-24T00:00:00.000Z",
        updatedAt: "2026-07-24T00:00:00.000Z",
      },
      dependencyStatus: dependency.dependencyStatus,
      actualWriteAuthorized: false,
      importAuthorized: false,
    });
  } else {
    assert(
      dependency.dependencyStatus === "ambiguous-existing-player",
      `${dependency.displayName}: unexpected dependency status.`,
    );
    assert(
      dependency.matchedPlayerIds.length >= 2,
      `${dependency.displayName}: ambiguous match set is incomplete.`,
    );

    ambiguousHolds.push({
      displayName: dependency.displayName,
      normalizedName: dependency.normalizedName,
      matchedPlayerIds: dependency.matchedPlayerIds,
      packageIds: dependency.packageIds,
      sourceTradeIds: dependency.sourceTradeIds,
      occurrenceCount: dependency.occurrenceCount,
      holdReason: "Multiple current player records match the normalized identity.",
      automaticResolutionAuthorized: false,
    });
  }

  if (dependency.dependencyStatus === "ambiguous-existing-player") {
    continue;
  }

  const playerId =
    dependency.dependencyStatus === "existing-player"
      ? dependency.existingPlayerId
      : dependency.provisionalPlayerId;

  for (const occurrence of dependency.occurrences) {
    const packageItem = packageById.get(occurrence.packageId);
    assert(packageItem, `${occurrence.packageId}: source package is missing.`);

    const resolvedAsset = resolveOccurrenceAsset(packageItem, occurrence);
    const {
      asset,
      assetReference,
      sourceAssetId,
      syntheticAssetReference,
    } = resolvedAsset;

    if (syntheticAssetReference) syntheticAssetReferences += 1;

    assert(
      normalizeName(occurrence.playerName) === dependency.normalizedName,
      `${assetReference}: dependency identity drift.`,
    );

    relationshipPreviews.push({
      relationshipId: relationshipId(
        occurrence,
        playerId,
        assetReference,
      ),
      packageId: occurrence.packageId,
      packageKind: occurrence.packageKind,
      sourceTradeId: occurrence.sourceTradeId,
      targetCanonicalId: packageItem.targetCanonicalId,
      assetId: assetReference,
      sourceAssetId,
      syntheticAssetReference,
      assetType: occurrence.assetType,
      relationshipRole: occurrence.role,
      playerId,
      playerDisplayName: dependency.displayName,
      playerDependencyStatus: dependency.dependencyStatus,
      direction: asset.direction ?? null,
      fromTeam: asset.fromTeam ?? null,
      toTeam: asset.toTeam ?? null,
      privateOnly: true,
      indexEligible: false,
      adEligible: false,
      publicationReady: false,
      actualWriteAuthorized: false,
      importAuthorized: false,
    });
  }
}

shellPackages.sort((left, right) =>
  left.playerPayload.id.localeCompare(right.playerPayload.id)
);
relationshipPreviews.sort((left, right) =>
  left.relationshipId.localeCompare(right.relationshipId)
);
ambiguousHolds.sort((left, right) =>
  left.normalizedName.localeCompare(right.normalizedName)
);

assert(
  new Set(shellPackages.map((item) => item.playerPayload.id)).size ===
    shellPackages.length,
  "Player-shell IDs are not unique.",
);
assert(
  new Set(relationshipPreviews.map((item) => item.relationshipId)).size ===
    relationshipPreviews.length,
  "Relationship preview IDs are not unique.",
);

const ambiguousNames = new Set(
  ambiguousHolds.map((item) => item.normalizedName),
);
const ambiguousOccurrences = phase4e.dependencies
  .filter((item) => ambiguousNames.has(item.normalizedName))
  .reduce((sum, item) => sum + item.occurrenceCount, 0);

assert(
  relationshipPreviews.length + ambiguousOccurrences ===
    phase4e.dependencyOccurrences,
  "Relationship and ambiguous occurrence accounting does not reconcile.",
);

const packageReadinessRows = [];

for (const item of phase4e.packages) {
  const dependencyItems = phase4e.dependencies.filter((dependency) =>
    dependency.packageIds.includes(item.packageId)
  );
  const ambiguousDependencies = dependencyItems.filter(
    (dependency) =>
      dependency.dependencyStatus === "ambiguous-existing-player",
  );
  const shellDependencies = dependencyItems.filter(
    (dependency) =>
      dependency.dependencyStatus === "new-player-shell-required",
  );

  let phase4FEligibility;
  const blockers = [];

  if (item.packageKind === "shared-canonical-create") {
    phase4FEligibility = "blocked-shared-cross-team-asset-union";
    blockers.push("Shared Atlanta/Boston asset union remains unresolved.");
  } else if (item.perspectiveAlreadyPresent === true) {
    phase4FEligibility = "blocked-existing-perspective";
    blockers.push("Boston perspective already exists on the target.");
  } else if (ambiguousDependencies.length > 0) {
    phase4FEligibility = "blocked-ambiguous-player-identity";
    blockers.push(
      `Ambiguous player identities: ${ambiguousDependencies
        .map((dependency) => dependency.displayName)
        .join(", ")}`,
    );
  } else if (shellDependencies.length > 0) {
    phase4FEligibility = "ready-after-player-shell-import";
  } else {
    phase4FEligibility = "player-dependencies-clear";
  }

  packageReadinessRows.push({
    packageId: item.packageId,
    packageKind: item.packageKind,
    sourceTradeId: item.sourceTradeId,
    targetCanonicalId: item.targetCanonicalId,
    phase4EEligibility: item.importEligibility,
    phase4FEligibility,
    playerDependencies: dependencyItems.length,
    playerShellDependencies: shellDependencies.length,
    ambiguousPlayerDependencies: ambiguousDependencies.length,
    blockers,
    importAuthorized: false,
  });
}

const packageReadinessCounts = Object.fromEntries(
  [...new Set(packageReadinessRows.map((item) => item.phase4FEligibility))]
    .sort()
    .map((status) => [
      status,
      packageReadinessRows.filter((item) => item.phase4FEligibility === status)
        .length,
    ]),
);

assert(
  Object.values(packageReadinessCounts).reduce((sum, count) => sum + count, 0) ===
    211,
  "Package readiness counts do not total 211.",
);

const dependencyStatusCounts = phase4e.dependencyStatusCounts;
assert(
  shellPackages.length ===
    (dependencyStatusCounts["new-player-shell-required"] ?? 0),
  "Shell-package count does not match Phase 4E dependencies.",
);
assert(
  ambiguousHolds.length ===
    (dependencyStatusCounts["ambiguous-existing-player"] ?? 0),
  "Ambiguous-hold count does not match Phase 4E dependencies.",
);

const summary = {
  result: "PASS",
  phase: "4F",
  mode: "BOSTON_PLAYER_SHELL_AND_RELATIONSHIP_PACKAGING_FREEZE",
  sourceRows: 223,
  packagingActions: 211,
  canonicalCreatePackages: 200,
  perspectiveAppendPackages: 11,
  uniquePlayerDependencies: phase4e.uniquePlayerDependencies,
  dependencyOccurrences: phase4e.dependencyOccurrences,
  dependencyStatusCounts,
  playerShellPackages: shellPackages.length,
  relationshipPreviewEdges: relationshipPreviews.length,
  ambiguousPlayerHolds: ambiguousHolds.length,
  ambiguousRelationshipOccurrences: ambiguousOccurrences,
  syntheticAssetReferences,
  packageReadinessCounts,
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

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const shellRows = shellPackages.map((item) => ({
  playerId: item.playerPayload.id,
  displayName: item.playerPayload.displayName,
  normalizedName: item.playerPayload.normalizedName,
  aliases: item.playerPayload.aliases.join(" | "),
  sourceTradeCount: item.playerPayload.sourceTradeIds.length,
  sourceTradeIds: item.playerPayload.sourceTradeIds.join(" | "),
  packageCount: item.playerPayload.packageIds.length,
  importAuthorized: false,
}));

const relationshipRows = relationshipPreviews.map((item) => ({
  relationshipId: item.relationshipId,
  packageId: item.packageId,
  packageKind: item.packageKind,
  sourceTradeId: item.sourceTradeId,
  targetCanonicalId: item.targetCanonicalId,
  assetId: item.assetId,
  sourceAssetId: item.sourceAssetId ?? "",
  syntheticAssetReference: item.syntheticAssetReference,
  assetType: item.assetType,
  relationshipRole: item.relationshipRole,
  playerId: item.playerId,
  playerDisplayName: item.playerDisplayName,
  playerDependencyStatus: item.playerDependencyStatus,
  direction: item.direction ?? "",
  fromTeam: item.fromTeam ?? "",
  toTeam: item.toTeam ?? "",
  importAuthorized: false,
}));

const ambiguousRows = ambiguousHolds.map((item) => ({
  displayName: item.displayName,
  normalizedName: item.normalizedName,
  matchedPlayerIds: item.matchedPlayerIds.join(" | "),
  packageIds: item.packageIds.join(" | "),
  sourceTradeIds: item.sourceTradeIds.join(" | "),
  occurrenceCount: item.occurrenceCount,
  holdReason: item.holdReason,
  automaticResolutionAuthorized: false,
}));

const readinessRows = packageReadinessRows.map((item) => ({
  packageId: item.packageId,
  packageKind: item.packageKind,
  sourceTradeId: item.sourceTradeId,
  targetCanonicalId: item.targetCanonicalId,
  phase4EEligibility: item.phase4EEligibility,
  phase4FEligibility: item.phase4FEligibility,
  playerDependencies: item.playerDependencies,
  playerShellDependencies: item.playerShellDependencies,
  ambiguousPlayerDependencies: item.ambiguousPlayerDependencies,
  blockers: item.blockers.join(" | "),
  importAuthorized: false,
}));

await Promise.all([
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4f-player-relationship-freeze.json"),
    `${JSON.stringify({
      ...summary,
      shellPackages,
      relationshipPreviews,
      ambiguousHolds,
      packageReadiness: packageReadinessRows,
    }, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4f-player-shell-packages.csv"),
    toCsv(shellRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4f-relationship-previews.csv"),
    toCsv(relationshipRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4f-ambiguous-player-holds.csv"),
    toCsv(ambiguousRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4f-package-readiness.csv"),
    toCsv(readinessRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4f-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(JSON.stringify(summary, null, 2));
