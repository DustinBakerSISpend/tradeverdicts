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

function readPlayerName(player) {
  return clean(
    player.displayName ??
      player.name ??
      player.fullName ??
      player.playerName ??
      player.identity?.displayName ??
      player.identity?.name,
  );
}

function readPlayerAliases(player) {
  return [
    ...(Array.isArray(player.aliases) ? player.aliases : []),
    ...(Array.isArray(player.playerAliases) ? player.playerAliases : []),
    ...(Array.isArray(player.alternateNames) ? player.alternateNames : []),
    ...(Array.isArray(player.identity?.aliases) ? player.identity.aliases : []),
  ].map(clean).filter(Boolean);
}

function packageAssets(item) {
  const assets =
    item.packageKind === "perspective-append"
      ? item.routedAssetLedger
      : item.canonicalPayload?.assetLedger;

  assert(Array.isArray(assets), `${item.packageId}: asset ledger missing.`);
  return assets;
}

function assetMatchesOccurrence(asset, occurrence) {
  if (asset.type !== occurrence.assetType) return false;

  if (
    occurrence.role === "traded-player" ||
    occurrence.role === "draft-rights-player"
  ) {
    return normalizeName(asset.playerName) === normalizeName(occurrence.playerName);
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
    assert(exact, `${sourceAssetId}: package asset missing.`);
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
    `${occurrence.packageId}: fallback asset match for ${occurrence.playerName} ` +
      `returned ${candidates.length} candidates.`,
  );

  const asset = candidates[0];
  return {
    asset,
    assetReference: `phase4g-asset-${sha256([
      occurrence.packageId,
      occurrence.sourceTradeId,
      occurrence.assetType,
      occurrence.role,
      occurrence.playerName,
      asset.direction ?? "",
      asset.fromTeam ?? "",
      asset.toTeam ?? "",
      asset.displayText ?? "",
    ].join("|")).slice(0, 18)}`,
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

function conservativeIdentityResolution(dependency, playersById) {
  const candidates = dependency.matchedPlayerIds
    .map((id) => playersById.get(id))
    .filter(Boolean);

  assert(
    candidates.length === dependency.matchedPlayerIds.length,
    `${dependency.displayName}: candidate player record missing.`,
  );

  const dependencyRaw = clean(dependency.displayName).toLowerCase();
  const dependencyNormalized = dependency.normalizedName;

  const evaluated = candidates.map((player) => {
    const playerId = readPlayerId(player);
    const primaryName = readPlayerName(player);
    const aliases = readPlayerAliases(player);

    return {
      playerId,
      primaryName,
      aliases,
      rawPrimaryExact: primaryName.toLowerCase() === dependencyRaw,
      normalizedPrimaryExact:
        normalizeName(primaryName) === dependencyNormalized,
      rawAliasExact: aliases.some(
        (alias) => alias.toLowerCase() === dependencyRaw,
      ),
      normalizedAliasExact: aliases.some(
        (alias) => normalizeName(alias) === dependencyNormalized,
      ),
    };
  });

  const rawPrimary = evaluated.filter((item) => item.rawPrimaryExact);
  const normalizedPrimary = evaluated.filter(
    (item) => item.normalizedPrimaryExact,
  );

  if (
    rawPrimary.length === 1 &&
    evaluated
      .filter((item) => item.playerId !== rawPrimary[0].playerId)
      .every((item) => !item.rawPrimaryExact)
  ) {
    return {
      resolved: true,
      playerId: rawPrimary[0].playerId,
      method: "unique-exact-primary-display-name",
      candidates: evaluated,
    };
  }

  if (
    normalizedPrimary.length === 1 &&
    evaluated
      .filter((item) => item.playerId !== normalizedPrimary[0].playerId)
      .every((item) => !item.normalizedPrimaryExact)
  ) {
    return {
      resolved: true,
      playerId: normalizedPrimary[0].playerId,
      method: "unique-normalized-primary-name-versus-alias",
      candidates: evaluated,
    };
  }

  return {
    resolved: false,
    playerId: null,
    method: "manual-review-required",
    candidates: evaluated,
  };
}

const args = parseArgs(process.argv);
for (const required of [
  "phase4e-freeze",
  "phase4f-freeze",
  "trades-json",
  "players-json",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  phase4eBytes,
  phase4fBytes,
  tradesBytes,
  playersBytes,
] = await Promise.all([
  readFile(args["phase4e-freeze"]),
  readFile(args["phase4f-freeze"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const phase4e = JSON.parse(phase4eBytes.toString("utf8"));
const phase4f = JSON.parse(phase4fBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));

assert(
  phase4e.result === "PASS" &&
    phase4e.phase === "4E" &&
    phase4e.packages.length === 211,
  "Invalid Phase 4E freeze.",
);
assert(
  phase4f.result === "PASS" &&
    phase4f.phase === "4F" &&
    phase4f.packagingActions === 211,
  "Invalid Phase 4F freeze.",
);
assert(Array.isArray(trades) && trades.length === 256, "Canonical store changed.");
assert(Array.isArray(players) && players.length === 509, "Player store changed.");

const canonicalIds = new Set(trades.map((trade) => clean(trade.id)).filter(Boolean));
const playersById = new Map(
  players.map((player) => [readPlayerId(player), player]).filter(([id]) => id),
);
const packageById = new Map(
  phase4e.packages.map((item) => [item.packageId, item]),
);

assert(packageById.size === 211, "Phase 4E package IDs are not unique.");

const resolvedAmbiguousIdentities = [];
const remainingAmbiguousHolds = [];
const resolvedIdentityByName = new Map();

for (const dependency of phase4e.dependencies.filter(
  (item) => item.dependencyStatus === "ambiguous-existing-player"
)) {
  const resolution = conservativeIdentityResolution(dependency, playersById);

  if (resolution.resolved) {
    const selected = playersById.get(resolution.playerId);
    resolvedIdentityByName.set(dependency.normalizedName, resolution.playerId);
    resolvedAmbiguousIdentities.push({
      displayName: dependency.displayName,
      normalizedName: dependency.normalizedName,
      selectedPlayerId: resolution.playerId,
      selectedPrimaryName: readPlayerName(selected),
      method: resolution.method,
      matchedPlayerIds: dependency.matchedPlayerIds,
      sourceTradeIds: dependency.sourceTradeIds,
      packageIds: dependency.packageIds,
      occurrenceCount: dependency.occurrenceCount,
      candidates: resolution.candidates,
      automaticMergeAuthorized: false,
      actualWriteAuthorized: false,
    });
  } else {
    remainingAmbiguousHolds.push({
      displayName: dependency.displayName,
      normalizedName: dependency.normalizedName,
      matchedPlayerIds: dependency.matchedPlayerIds,
      sourceTradeIds: dependency.sourceTradeIds,
      packageIds: dependency.packageIds,
      occurrenceCount: dependency.occurrenceCount,
      method: resolution.method,
      candidates: resolution.candidates,
      holdReason:
        "No single candidate has a uniquely stronger primary-name identity signal.",
      automaticResolutionAuthorized: false,
      automaticMergeAuthorized: false,
    });
  }
}

resolvedAmbiguousIdentities.sort((left, right) =>
  left.normalizedName.localeCompare(right.normalizedName)
);
remainingAmbiguousHolds.sort((left, right) =>
  left.normalizedName.localeCompare(right.normalizedName)
);

const additionalRelationships = [];
let syntheticAssetReferences = 0;

for (const dependency of phase4e.dependencies.filter((item) =>
  resolvedIdentityByName.has(item.normalizedName)
)) {
  const playerId = resolvedIdentityByName.get(dependency.normalizedName);

  for (const occurrence of dependency.occurrences) {
    const packageItem = packageById.get(occurrence.packageId);
    assert(packageItem, `${occurrence.packageId}: package missing.`);
    const resolvedAsset = resolveOccurrenceAsset(packageItem, occurrence);
    if (resolvedAsset.syntheticAssetReference) syntheticAssetReferences += 1;

    additionalRelationships.push({
      relationshipId: relationshipId(
        occurrence,
        playerId,
        resolvedAsset.assetReference,
      ),
      packageId: occurrence.packageId,
      packageKind: occurrence.packageKind,
      sourceTradeId: occurrence.sourceTradeId,
      targetCanonicalId: packageItem.targetCanonicalId,
      assetId: resolvedAsset.assetReference,
      sourceAssetId: resolvedAsset.sourceAssetId,
      syntheticAssetReference: resolvedAsset.syntheticAssetReference,
      assetType: occurrence.assetType,
      relationshipRole: occurrence.role,
      playerId,
      playerDisplayName: dependency.displayName,
      playerDependencyStatus: "resolved-ambiguous-existing-player",
      resolutionMethod: resolvedAmbiguousIdentities.find(
        (item) => item.normalizedName === dependency.normalizedName
      )?.method,
      direction: resolvedAsset.asset.direction ?? null,
      fromTeam: resolvedAsset.asset.fromTeam ?? null,
      toTeam: resolvedAsset.asset.toTeam ?? null,
      privateOnly: true,
      indexEligible: false,
      adEligible: false,
      publicationReady: false,
      actualWriteAuthorized: false,
      importAuthorized: false,
    });
  }
}

additionalRelationships.sort((left, right) =>
  left.relationshipId.localeCompare(right.relationshipId)
);
assert(
  new Set(additionalRelationships.map((item) => item.relationshipId)).size ===
    additionalRelationships.length,
  "Additional relationship IDs are not unique.",
);

const sharedUnionResolutions = [];

for (const item of phase4e.packages.filter(
  (packageItem) => packageItem.packageKind === "shared-canonical-create"
)) {
  const payload = item.canonicalPayload;
  assert(payload, `${item.packageId}: shared canonical payload missing.`);
  assert(!canonicalIds.has(item.targetCanonicalId), `${item.packageId}: target collision.`);
  assert(
    Array.isArray(payload.sourceTeams) &&
      payload.sourceTeams.includes("atlanta-hawks") &&
      payload.sourceTeams.includes("boston-celtics"),
    `${item.packageId}: shared source-team set incomplete.`,
  );
  assert(
    Array.isArray(payload.perspectives) &&
      payload.perspectives.length === 2,
    `${item.packageId}: shared perspectives incomplete.`,
  );
  assert(
    Array.isArray(payload.assetLedger) &&
      payload.assetLedger.length > 0 &&
      payload.assetLedger.every(
        (asset) =>
          asset.fromTeam &&
          asset.toTeam &&
          asset.type !== "other" &&
          asset.status !== "unclassified",
      ),
    `${item.packageId}: shared routed ledger is incomplete.`,
  );

  const touchedTeams = new Set(
    payload.assetLedger.flatMap((asset) => [asset.fromTeam, asset.toTeam])
  );
  assert(
    payload.teams.every((team) => touchedTeams.has(team)),
    `${item.packageId}: not every declared team appears in the routed ledger.`,
  );

  sharedUnionResolutions.push({
    packageId: item.packageId,
    sourceTradeId: item.sourceTradeId,
    atlantaSourceTradeId: item.atlantaSourceTradeId,
    sharedCanonicalGroup: item.sharedCanonicalGroup,
    targetCanonicalId: item.targetCanonicalId,
    teams: payload.teams,
    sourceTeams: payload.sourceTeams,
    perspectiveCount: payload.perspectives.length,
    assetCount: payload.assetLedger.length,
    unionMethod: "boston-routed-ledger-authoritative-with-atlanta-perspective",
    resolutionStatus: "resolved",
    importAuthorized: false,
    actualWriteAuthorized: false,
  });
}

assert(sharedUnionResolutions.length === 3, "Expected three shared union resolutions.");

const remainingAmbiguousNames = new Set(
  remainingAmbiguousHolds.map((item) => item.normalizedName)
);
const readiness = [];

for (const item of phase4e.packages) {
  const dependencies = phase4e.dependencies.filter((dependency) =>
    dependency.packageIds.includes(item.packageId)
  );
  const unresolvedAmbiguous = dependencies.filter((dependency) =>
    remainingAmbiguousNames.has(dependency.normalizedName)
  );
  const shellDependencies = dependencies.filter(
    (dependency) =>
      dependency.dependencyStatus === "new-player-shell-required"
  );

  let finalEligibility;
  const blockers = [];

  if (item.perspectiveAlreadyPresent === true) {
    finalEligibility = "blocked-existing-perspective";
    blockers.push("Boston perspective already exists on the canonical target.");
  } else if (unresolvedAmbiguous.length > 0) {
    finalEligibility = "blocked-ambiguous-player-identity";
    blockers.push(
      `Ambiguous player identities: ${unresolvedAmbiguous
        .map((dependency) => dependency.displayName)
        .join(", ")}`
    );
  } else if (shellDependencies.length > 0) {
    finalEligibility = "ready-after-player-shell-import";
  } else {
    finalEligibility = "dependency-clear";
  }

  readiness.push({
    packageId: item.packageId,
    packageKind: item.packageKind,
    sourceTradeId: item.sourceTradeId,
    targetCanonicalId: item.targetCanonicalId,
    finalEligibility,
    playerDependencies: dependencies.length,
    playerShellDependencies: shellDependencies.length,
    unresolvedAmbiguousDependencies: unresolvedAmbiguous.length,
    sharedUnionResolved:
      item.packageKind !== "shared-canonical-create" ||
      sharedUnionResolutions.some(
        (resolution) => resolution.packageId === item.packageId
      ),
    blockers,
    importAuthorized: false,
  });
}

const eligibilityCounts = Object.fromEntries(
  [...new Set(readiness.map((item) => item.finalEligibility))]
    .sort()
    .map((status) => [
      status,
      readiness.filter((item) => item.finalEligibility === status).length,
    ]),
);

const readyPackages = readiness.filter((item) =>
  ["dependency-clear", "ready-after-player-shell-import"].includes(
    item.finalEligibility
  )
);
const heldPackages = readiness.filter((item) =>
  item.finalEligibility.startsWith("blocked-")
);

assert(readyPackages.length + heldPackages.length === 211, "Partition does not total 211.");
assert(
  readiness
    .filter((item) => packageById.get(item.packageId)?.packageKind === "shared-canonical-create")
    .every((item) => item.sharedUnionResolved === true),
  "A shared package remains unresolved.",
);

const remainingAmbiguousOccurrences = remainingAmbiguousHolds.reduce(
  (sum, item) => sum + item.occurrenceCount,
  0,
);
const resolvedAmbiguousOccurrences = resolvedAmbiguousIdentities.reduce(
  (sum, item) => sum + item.occurrenceCount,
  0,
);

assert(
  phase4f.relationshipPreviewEdges +
    additionalRelationships.length +
    remainingAmbiguousOccurrences ===
    phase4e.dependencyOccurrences,
  "Relationship occurrence accounting does not reconcile.",
);
assert(
  additionalRelationships.length === resolvedAmbiguousOccurrences,
  "Resolved ambiguous relationship count mismatch.",
);

const summary = {
  result: "PASS",
  phase: "4G",
  mode: "BOSTON_FINAL_BLOCKER_RESOLUTION_AND_IMPORT_PARTITION",
  sourceRows: 223,
  packagingActions: 211,
  sharedUnionResolutions: sharedUnionResolutions.length,
  resolvedAmbiguousIdentities: resolvedAmbiguousIdentities.length,
  resolvedAmbiguousOccurrences,
  remainingAmbiguousIdentities: remainingAmbiguousHolds.length,
  remainingAmbiguousOccurrences,
  baseRelationshipPreviews: phase4f.relationshipPreviewEdges,
  additionalRelationshipPreviews: additionalRelationships.length,
  totalRelationshipPreviews:
    phase4f.relationshipPreviewEdges + additionalRelationships.length,
  syntheticAssetReferences,
  playerShellPackages: phase4f.playerShellPackages,
  readyPackages: readyPackages.length,
  heldPackages: heldPackages.length,
  eligibilityCounts,
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticIdentityMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const resolvedRows = resolvedAmbiguousIdentities.map((item) => ({
  displayName: item.displayName,
  normalizedName: item.normalizedName,
  selectedPlayerId: item.selectedPlayerId,
  selectedPrimaryName: item.selectedPrimaryName,
  method: item.method,
  matchedPlayerIds: item.matchedPlayerIds.join(" | "),
  occurrenceCount: item.occurrenceCount,
  packageIds: item.packageIds.join(" | "),
  sourceTradeIds: item.sourceTradeIds.join(" | "),
  actualWriteAuthorized: false,
}));

const remainingRows = remainingAmbiguousHolds.map((item) => ({
  displayName: item.displayName,
  normalizedName: item.normalizedName,
  matchedPlayerIds: item.matchedPlayerIds.join(" | "),
  occurrenceCount: item.occurrenceCount,
  packageIds: item.packageIds.join(" | "),
  sourceTradeIds: item.sourceTradeIds.join(" | "),
  holdReason: item.holdReason,
  automaticResolutionAuthorized: false,
}));

const unionRows = sharedUnionResolutions.map((item) => ({
  packageId: item.packageId,
  sourceTradeId: item.sourceTradeId,
  atlantaSourceTradeId: item.atlantaSourceTradeId,
  sharedCanonicalGroup: item.sharedCanonicalGroup,
  targetCanonicalId: item.targetCanonicalId,
  teams: item.teams.join(" | "),
  sourceTeams: item.sourceTeams.join(" | "),
  perspectiveCount: item.perspectiveCount,
  assetCount: item.assetCount,
  unionMethod: item.unionMethod,
  resolutionStatus: item.resolutionStatus,
  importAuthorized: false,
}));

const relationshipRows = additionalRelationships.map((item) => ({
  relationshipId: item.relationshipId,
  packageId: item.packageId,
  sourceTradeId: item.sourceTradeId,
  targetCanonicalId: item.targetCanonicalId,
  assetId: item.assetId,
  sourceAssetId: item.sourceAssetId ?? "",
  syntheticAssetReference: item.syntheticAssetReference,
  relationshipRole: item.relationshipRole,
  playerId: item.playerId,
  playerDisplayName: item.playerDisplayName,
  resolutionMethod: item.resolutionMethod,
  fromTeam: item.fromTeam ?? "",
  toTeam: item.toTeam ?? "",
  importAuthorized: false,
}));

const readinessRows = readiness.map((item) => ({
  packageId: item.packageId,
  packageKind: item.packageKind,
  sourceTradeId: item.sourceTradeId,
  targetCanonicalId: item.targetCanonicalId,
  finalEligibility: item.finalEligibility,
  playerDependencies: item.playerDependencies,
  playerShellDependencies: item.playerShellDependencies,
  unresolvedAmbiguousDependencies: item.unresolvedAmbiguousDependencies,
  sharedUnionResolved: item.sharedUnionResolved,
  blockers: item.blockers.join(" | "),
  importAuthorized: false,
}));

await Promise.all([
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4g-blocker-resolution.json"),
    `${JSON.stringify({
      ...summary,
      resolvedAmbiguousIdentityRecords: resolvedAmbiguousIdentities,
      remainingAmbiguousHolds,
      sharedUnionResolutionRecords: sharedUnionResolutions,
      additionalRelationships,
      readiness,
    }, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4g-resolved-ambiguous-identities.csv"),
    toCsv(resolvedRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4g-remaining-ambiguous-holds.csv"),
    toCsv(remainingRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4g-shared-union-resolutions.csv"),
    toCsv(unionRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4g-additional-relationships.csv"),
    toCsv(relationshipRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4g-import-partition.csv"),
    toCsv(readinessRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4g-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(JSON.stringify(summary, null, 2));
