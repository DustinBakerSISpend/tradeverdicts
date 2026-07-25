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
function playerName(player) {
  return clean(
    player.displayName ??
    player.name ??
    player.fullName ??
    player.playerName ??
    player.identity?.displayName ??
    player.identity?.name
  );
}
function playerAliases(player) {
  return [
    ...(Array.isArray(player.aliases) ? player.aliases : []),
    ...(Array.isArray(player.playerAliases) ? player.playerAliases : []),
    ...(Array.isArray(player.alternateNames) ? player.alternateNames : []),
    ...(Array.isArray(player.identity?.aliases) ? player.identity.aliases : []),
  ].map(clean).filter(Boolean);
}
function perspectiveTeam(perspective) {
  return clean(
    perspective.sourceTeam ??
    perspective.teamId ??
    perspective.team ??
    perspective.perspectiveTeam
  );
}
function findReviewedRecord(batch, id) {
  return (batch.records ?? []).find((record) =>
    clean(record.tradeId ?? record.id ?? record.sourceTradeId) === clean(id)
  ) ?? null;
}
function buildReviewedPerspective(record, fallbackTeam, fallbackBatchId) {
  assert(record, `Missing reviewed source record for ${fallbackTeam}.`);
  const sourceTeam = clean(record.sourceTeam ?? fallbackTeam);
  const sourceTradeId = clean(record.tradeId ?? record.id ?? record.sourceTradeId);
  return {
    sourceTeam,
    sourceBatchId: clean(record.sourceBatchId ?? fallbackBatchId),
    sourceTradeId,
    summary: clean(record.summary ?? record.finalSummary ?? record.tradeSummary),
    analysis: clean(record.analysis ?? record.finalAnalysis ?? record.tradeAnalysis),
    verdict: clean(record.verdict ?? record.finalVerdict),
    grades: record.grades ?? {
      [sourceTeam]: clean(record.sourceTeamGrade ?? record.finalTeamGrade ?? record.finalGrade),
      partnerAggregate: clean(record.partnerAggregateGrade ?? record.finalPartnerGrade),
    },
    aggregatePartnerGrade: clean(record.partnerAggregateGrade ?? record.finalPartnerGrade) || null,
    confidence: clean(record.confidence ?? record.finalConfidence).toLowerCase(),
    reviewStatus: clean(record.reviewStatus),
    sourcePerspectiveKey: clean(record.sourcePerspectiveKey) || null,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  };
}
function routeAssetsByReceivingTeam(record) {
  const teams = [...new Set(record.teams ?? [])].sort();
  const assetsReceived = Object.fromEntries(teams.map((team) => [team, []]));
  const allAssets = [
    ...(Array.isArray(record.assetLedger) ? record.assetLedger : []),
    ...(Array.isArray(record.supplementalRouteEdges) ? record.supplementalRouteEdges : []),
  ];
  for (const asset of allAssets) {
    const toTeam = clean(asset.toTeam);
    assert(toTeam && assetsReceived[toTeam], `${record.sourceTradeId}: routed asset has invalid receiving team.`);
    assetsReceived[toTeam].push({ ...asset, privateOnly: true });
  }
  return assetsReceived;
}
function conservativeIdentityResolution(hold, playersById) {
  const candidates = hold.candidatePlayerIds
    .map((id) => playersById.get(id))
    .filter(Boolean);
  assert(candidates.length === hold.candidatePlayerIds.length, `${hold.playerName}: candidate player missing.`);

  const raw = clean(hold.playerName).toLowerCase();
  const normalized = hold.normalizedName;
  const evaluated = candidates.map((player) => {
    const id = playerId(player);
    const primary = playerName(player);
    const aliases = playerAliases(player);
    return {
      playerId: id,
      primaryName: primary,
      aliases,
      rawPrimaryExact: primary.toLowerCase() === raw,
      normalizedPrimaryExact: normalizeName(primary) === normalized,
      rawAliasExact: aliases.some((alias) => alias.toLowerCase() === raw),
      normalizedAliasExact: aliases.some((alias) => normalizeName(alias) === normalized),
    };
  });

  const rawPrimary = evaluated.filter((item) => item.rawPrimaryExact);
  if (rawPrimary.length === 1) {
    return {
      resolved: true,
      playerId: rawPrimary[0].playerId,
      method: "unique-exact-primary-display-name",
      candidates: evaluated,
    };
  }

  const normalizedPrimary = evaluated.filter((item) => item.normalizedPrimaryExact);
  if (normalizedPrimary.length === 1) {
    return {
      resolved: true,
      playerId: normalizedPrimary[0].playerId,
      method: "unique-normalized-primary-name-versus-aliases",
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
function syntheticAssetReference(packageItem, dependency) {
  return `phase5g-asset-${sha256([
    packageItem.packageId,
    dependency.sourceTradeId,
    packageItem.targetCanonicalId ?? "",
    dependency.normalizedName,
    dependency.role,
    dependency.dependencyId,
  ].join("|")).slice(0, 20)}`;
}
function relationshipId(packageItem, dependency, playerTarget, assetReference) {
  return `nba-rel-${sha256([
    packageItem.packageId,
    dependency.sourceTradeId,
    packageItem.targetCanonicalId ?? "",
    assetReference,
    dependency.role,
    playerTarget,
  ].join("|")).slice(0, 20)}`;
}
function readiness(packageItem, unresolvedAmbiguousNames, sharedUnionResolved) {
  const original = Array.isArray(packageItem.importEligibility?.blockers)
    ? packageItem.importEligibility.blockers
    : [];
  const blockers = new Set(original);

  if (sharedUnionResolved) blockers.delete("cross-team-source-collision");
  if (packageItem.packageType === "canonical-collision-hold") blockers.add("existing-canonical-collision");
  if (packageItem.packageType === "reviewed-source-collision-hold" && !sharedUnionResolved) {
    blockers.add("cross-team-source-collision");
  }
  if (unresolvedAmbiguousNames.length) blockers.add("ambiguous-player");
  else blockers.delete("ambiguous-player");

  let status;
  if (blockers.has("ambiguous-player")) status = "hold-ambiguous-player";
  else if (blockers.has("existing-canonical-collision")) status = "hold-existing-canonical-collision";
  else if (blockers.has("cross-team-source-collision")) status = "hold-cross-team-source-collision";
  else if (blockers.has("unclassified-asset")) status = "hold-unclassified-asset";
  else if (blockers.has("recent-or-provisional")) status = "hold-recent-or-provisional";
  else if (packageItem.playerDependencies.some((item) => item.status === "missing-player-shell")) {
    status = "ready-with-player-shells";
  } else if (packageItem.playerDependencies.length) {
    status = "ready-existing-player-dependencies";
  } else {
    status = "ready-no-player-dependencies";
  }

  return {
    status,
    ready: status.startsWith("ready-"),
    held: status.startsWith("hold-"),
    blockers: [...blockers].sort(),
    unresolvedAmbiguousNames,
  };
}

const args = parseArgs(process.argv);
for (const required of [
  "phase5d-freeze",
  "phase5e-freeze",
  "phase5f-freeze",
  "trades-json",
  "players-json",
  "atlanta-reviewed-json",
  "boston-reviewed-json",
  "output-dir",
]) assert(args[required], `Missing --${required}`);

const [
  phase5DBytes,
  phase5EBytes,
  phase5FBytes,
  tradesBytes,
  playersBytes,
  atlantaBytes,
  bostonBytes,
] = await Promise.all([
  readFile(args["phase5d-freeze"]),
  readFile(args["phase5e-freeze"]),
  readFile(args["phase5f-freeze"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["atlanta-reviewed-json"]),
  readFile(args["boston-reviewed-json"]),
]);

const phase5D = JSON.parse(phase5DBytes.toString("utf8"));
const phase5E = JSON.parse(phase5EBytes.toString("utf8"));
const phase5F = JSON.parse(phase5FBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));
const boston = JSON.parse(bostonBytes.toString("utf8"));
const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

assert(phase5D.result === "PASS" && phase5D.phase === "5D", "Invalid Phase 5D source.");
assert(phase5E.result === "PASS" && phase5E.phase === "5E", "Invalid Phase 5E source.");
assert(phase5F.result === "PASS" && phase5F.phase === "5F", "Invalid Phase 5F source.");
assert(Array.isArray(phase5D.records) && phase5D.records.length === 251, "Expected 251 Phase 5D records.");
assert(Array.isArray(phase5E.packages) && phase5E.packages.length === 208, "Expected 208 Phase 5E packages.");
assert(Array.isArray(phase5F.packageReadinessRecords) && phase5F.packageReadinessRecords.length === 208, "Expected 208 Phase 5F readiness records.");
assert(Array.isArray(trades) && trades.length === 456, "Canonical store changed.");
assert(Array.isArray(players), "Player store is not an array.");

const playersById = new Map(players.map((player) => [playerId(player), player]).filter(([id]) => id));
const packagesById = new Map(phase5E.packages.map((item) => [item.packageId, item]));
const sourceRecordById = new Map(phase5D.records.map((record) => [record.sourceTradeId, record]));
assert(packagesById.size === 208, "Duplicate package ID.");

const resolvedAmbiguousIdentities = [];
const remainingAmbiguousHolds = [];
const resolvedPlayerByNormalizedName = new Map();

for (const hold of phase5F.ambiguousPlayerHoldRecords) {
  const resolution = conservativeIdentityResolution(hold, playersById);
  if (resolution.resolved) {
    resolvedPlayerByNormalizedName.set(hold.normalizedName, resolution.playerId);
    resolvedAmbiguousIdentities.push({
      playerName: hold.playerName,
      normalizedName: hold.normalizedName,
      selectedPlayerId: resolution.playerId,
      method: resolution.method,
      candidatePlayerIds: hold.candidatePlayerIds,
      packageIds: hold.packageIds,
      sourceTradeIds: hold.sourceTradeIds,
      roles: hold.roles,
      occurrenceCount: hold.occurrenceCount,
      candidates: resolution.candidates,
      automaticMergeAuthorized: false,
      actualWriteAuthorized: false,
    });
  } else {
    remainingAmbiguousHolds.push({
      ...hold,
      method: resolution.method,
      candidates: resolution.candidates,
      holdReason: "No uniquely stronger primary-name identity signal exists.",
      automaticResolutionAuthorized: false,
    });
  }
}

const sharedUnionResolutions = [];
const sharedUnionByPackageId = new Map();

for (const packageItem of phase5E.packages.filter(
  (item) => item.packageType === "reviewed-source-collision-hold"
)) {
  const sourceRecord = sourceRecordById.get(packageItem.sourceTradeId);
  assert(sourceRecord, `${packageItem.packageId}: Phase 5D source record missing.`);
  assert(
    !sourceRecord.currentCanonicalComparisons?.length,
    `${packageItem.packageId}: current canonical collision cannot be union-resolved.`
  );

  const perspectiveSources = [];
  for (const match of sourceRecord.atlantaReviewedComparisons ?? []) {
    const reviewed = findReviewedRecord(atlanta, match.sourceTradeId);
    if (reviewed) perspectiveSources.push(
      buildReviewedPerspective(reviewed, "atlanta-hawks", "atlanta-hawks-phase-3a")
    );
  }
  for (const match of sourceRecord.bostonReviewedComparisons ?? []) {
    const reviewed = findReviewedRecord(boston, match.sourceTradeId);
    if (reviewed) perspectiveSources.push(
      buildReviewedPerspective(reviewed, "boston-celtics", "boston-celtics-phase-4a")
    );
  }

  const uniquePerspectives = [
    ...packageItem.perspectives,
    ...perspectiveSources,
  ].filter((item, index, values) =>
    values.findIndex((candidate) => perspectiveTeam(candidate) === perspectiveTeam(item)) === index
  );

  assert(uniquePerspectives.length >= 2, `${packageItem.packageId}: shared union lacks a second team perspective.`);
  const targetCanonicalId = sourceRecord.provisionalCanonicalId;
  assert(targetCanonicalId?.startsWith("nba-trade-"), `${packageItem.packageId}: union target is invalid.`);
  assert(!trades.some((trade) => trade.id === targetCanonicalId), `${packageItem.packageId}: union target already exists.`);

  const assetsReceived = routeAssetsByReceivingTeam(sourceRecord);
  const assetLedger = Object.values(assetsReceived).flat();
  assert(assetLedger.length > 0, `${packageItem.packageId}: union asset ledger is empty.`);

  const resolvedPackage = {
    ...packageItem,
    packageType: "canonical-create",
    canonicalIdentityStatus: "shared-reviewed-union-resolved",
    targetCanonicalId,
    canonicalPayload: {
      id: targetCanonicalId,
      league: "nba",
      slug: targetCanonicalId.replace(/^nba-trade-/u, ""),
      tradeDate: sourceRecord.tradeDate,
      seasonLabel: sourceRecord.seasonLabel,
      teams: [...sourceRecord.teams].sort(),
      sourceTeams: [...new Set(uniquePerspectives.map(perspectiveTeam))].sort(),
      assetLedger,
      assetsReceived,
      perspectives: uniquePerspectives,
      privateOnly: true,
      indexEligible: false,
      adEligible: false,
      publicationReady: false,
    },
    perspectivePayload: null,
    perspectives: uniquePerspectives,
    packageBlockers: packageItem.packageBlockers.filter(
      (blocker) => blocker !== "cross-team-source-collision"
    ),
    sharedUnionResolution: {
      method: "same-date-team-reviewed-perspective-union",
      sourceTeams: [...new Set(uniquePerspectives.map(perspectiveTeam))].sort(),
      reviewedSourceTradeIds: perspectiveSources.map((item) => item.sourceTradeId).sort(),
      sourceRecordHash: sha256(Buffer.from(stable(sourceRecord))),
      automaticMergeAuthorized: false,
    },
  };
  sharedUnionByPackageId.set(packageItem.packageId, resolvedPackage);
  sharedUnionResolutions.push({
    packageId: packageItem.packageId,
    sourceTradeId: packageItem.sourceTradeId,
    tradeDate: packageItem.tradeDate,
    targetCanonicalId,
    sourceTeams: resolvedPackage.canonicalPayload.sourceTeams,
    reviewedSourceTradeIds: resolvedPackage.sharedUnionResolution.reviewedSourceTradeIds,
    method: resolvedPackage.sharedUnionResolution.method,
    automaticMergeAuthorized: false,
    actualWriteAuthorized: false,
  });
}

const finalPackages = [];
const additionalRelationships = [];
let resolvedAmbiguousOccurrences = 0;
let remainingAmbiguousOccurrences = 0;

for (const originalPackage of phase5E.packages) {
  const packageItem = sharedUnionByPackageId.get(originalPackage.packageId) ?? originalPackage;
  const unresolvedAmbiguousNames = [];

  for (const dependency of packageItem.playerDependencies) {
    if (dependency.status !== "ambiguous-player") continue;
    const playerTarget = resolvedPlayerByNormalizedName.get(dependency.normalizedName);
    if (!playerTarget) {
      unresolvedAmbiguousNames.push(dependency.normalizedName);
      remainingAmbiguousOccurrences += 1;
      continue;
    }

    resolvedAmbiguousOccurrences += 1;
    const assetReference = clean(dependency.sourceAssetId) ||
      syntheticAssetReference(packageItem, dependency);
    additionalRelationships.push({
      relationshipId: relationshipId(packageItem, dependency, playerTarget, assetReference),
      packageId: packageItem.packageId,
      packageType: packageItem.packageType,
      sourceTradeId: packageItem.sourceTradeId,
      targetCanonicalId: packageItem.targetCanonicalId,
      assetReference,
      sourceAssetId: clean(dependency.sourceAssetId) || null,
      syntheticAssetReference: !clean(dependency.sourceAssetId),
      relationshipRole: dependency.role,
      playerId: playerTarget,
      playerDisplayName: dependency.playerName,
      playerDependencyStatus: "resolved-ambiguous-existing-player",
      resolutionMethod: resolvedAmbiguousIdentities.find(
        (item) => item.normalizedName === dependency.normalizedName
      )?.method,
      privateOnly: true,
      relationshipWriteAuthorized: false,
      importAuthorized: false,
    });
  }

  const eligibility = readiness(
    packageItem,
    [...new Set(unresolvedAmbiguousNames)].sort(),
    sharedUnionByPackageId.has(packageItem.packageId),
  );

  finalPackages.push({
    ...packageItem,
    phase5GEligibility: eligibility,
    importEligible: eligibility.ready,
    importAuthorized: false,
    canonicalImportAuthorized: false,
    playerImportAuthorized: false,
    perspectiveWriteAuthorized: false,
    relationshipWriteAuthorized: false,
    routeDataWriteAuthorized: false,
    privateOnly: true,
  });
}

assert(finalPackages.length === 208, "Final package count drifted.");
assert(new Set(finalPackages.map((item) => item.packageId)).size === 208, "Duplicate final package ID.");
assert(
  new Set(additionalRelationships.map((item) => item.relationshipId)).size === additionalRelationships.length,
  "Duplicate additional relationship ID."
);
assert(
  resolvedAmbiguousOccurrences + remainingAmbiguousOccurrences ===
    phase5F.ambiguousRelationshipOccurrences,
  "Ambiguous occurrence accounting drifted."
);

const allRelationships = [
  ...phase5F.relationshipPreviewRecords,
  ...additionalRelationships,
];
assert(
  new Set(allRelationships.map((item) => item.relationshipId)).size === allRelationships.length,
  "Duplicate final relationship ID."
);

const readyPackages = finalPackages.filter((item) => item.phase5GEligibility.ready);
const heldPackages = finalPackages.filter((item) => item.phase5GEligibility.held);
assert(readyPackages.length + heldPackages.length === 208, "Import partition does not total 208.");

const readyPackageIds = new Set(readyPackages.map((item) => item.packageId));
const readyPlayerShellIds = new Set();
for (const packageItem of readyPackages) {
  for (const dependency of packageItem.playerDependencies) {
    if (dependency.status === "missing-player-shell" && dependency.proposedPlayerId) {
      readyPlayerShellIds.add(dependency.proposedPlayerId);
    }
  }
}
const readyPlayerShellPackages = phase5F.playerShellPackageRecords.filter(
  (item) => readyPlayerShellIds.has(item.playerPayload.id)
);
const readyRelationships = allRelationships.filter(
  (item) => readyPackageIds.has(item.packageId)
);

const eligibilityCounts = countBy(
  finalPackages.map((item) => item.phase5GEligibility.status)
);
const readyPackageTypeCounts = countBy(readyPackages.map((item) => item.packageType));
const heldPackageTypeCounts = countBy(heldPackages.map((item) => item.packageType));

const resolution = {
  result: "PASS",
  phase: "5G",
  mode: "BROOKLYN_NETS_FINAL_BLOCKER_RESOLUTION_AND_IMPORT_PARTITION",
  batchId: "brooklyn-nets-phase-5g",
  sourcePhase: "5F",
  sourceHashes: {
    phase5DFileSha256: sha256(phase5DBytes),
    phase5EFileSha256: sha256(phase5EBytes),
    phase5FFileSha256: sha256(phase5FBytes),
    canonicalTradesSha256: sha256(tradesBytes),
    playersSha256: sha256(playersBytes),
  },
  sourceRows: 251,
  packagingActions: 208,
  sharedUnionResolutions: sharedUnionResolutions.length,
  resolvedAmbiguousIdentities: resolvedAmbiguousIdentities.length,
  resolvedAmbiguousOccurrences,
  remainingAmbiguousIdentities: remainingAmbiguousHolds.length,
  remainingAmbiguousOccurrences,
  readyPackages: readyPackages.length,
  heldPackages: heldPackages.length,
  readyCanonicalCreatePackages: readyPackageTypeCounts["canonical-create"] ?? 0,
  readyPerspectiveAppendPackages: readyPackageTypeCounts["perspective-append"] ?? 0,
  heldPackageTypeCounts,
  playerShellPackages: phase5F.playerShellPackages,
  readyPlayerShellPackages: readyPlayerShellPackages.length,
  baseRelationshipPreviews: phase5F.relationshipPreviewEdges,
  additionalRelationships: additionalRelationships.length,
  totalRelationshipPreviews: allRelationships.length,
  readyRelationshipPreviews: readyRelationships.length,
  eligibilityCounts,
  finalPackageRecordsSha256: sha256(Buffer.from(stable(finalPackages))),
  finalRelationshipRecordsSha256: sha256(Buffer.from(stable(allRelationships))),
  importPartitionSha256: sha256(Buffer.from(stable(
    finalPackages.map((item) => ({
      packageId: item.packageId,
      status: item.phase5GEligibility.status,
      ready: item.phase5GEligibility.ready,
    }))
  ))),
  policy: {
    privateOnly: true,
    canonicalImportsAuthorized: false,
    playerImportsAuthorized: false,
    perspectiveWritesAuthorized: false,
    relationshipWritesAuthorized: false,
    routeDataWritesAuthorized: false,
    automaticIdentityMergesAuthorized: false,
    automaticCanonicalMergesAuthorized: false,
    publicationAuthorized: false,
    pushAuthorized: false,
    deploymentAuthorized: false,
  },
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
  resolvedAmbiguousIdentityRecords: resolvedAmbiguousIdentities,
  remainingAmbiguousHoldRecords: remainingAmbiguousHolds,
  sharedUnionResolutionRecords: sharedUnionResolutions,
  additionalRelationshipRecords: additionalRelationships,
  allRelationshipRecords: allRelationships,
  readyPlayerShellPackageRecords: readyPlayerShellPackages,
  finalPackages,
};

const importRows = finalPackages.map((item) => ({
  packageId: item.packageId,
  sourceTradeId: item.sourceTradeId,
  tradeDate: item.tradeDate,
  packageType: item.packageType,
  targetCanonicalId: item.targetCanonicalId ?? "",
  eligibilityStatus: item.phase5GEligibility.status,
  ready: item.phase5GEligibility.ready,
  blockers: item.phase5GEligibility.blockers.join(" | "),
  unresolvedAmbiguousNames: item.phase5GEligibility.unresolvedAmbiguousNames.join(" | "),
  importAuthorized: item.importAuthorized,
}));
const resolvedRows = resolvedAmbiguousIdentities.map((item) => ({
  playerName: item.playerName,
  normalizedName: item.normalizedName,
  selectedPlayerId: item.selectedPlayerId,
  method: item.method,
  candidatePlayerIds: item.candidatePlayerIds.join(" | "),
  packageIds: item.packageIds.join(" | "),
  sourceTradeIds: item.sourceTradeIds.join(" | "),
  roles: item.roles.join(" | "),
  occurrenceCount: item.occurrenceCount,
  actualWriteAuthorized: item.actualWriteAuthorized,
}));
const remainingRows = remainingAmbiguousHolds.map((item) => ({
  playerName: item.playerName,
  normalizedName: item.normalizedName,
  candidatePlayerIds: item.candidatePlayerIds.join(" | "),
  packageIds: item.packageIds.join(" | "),
  sourceTradeIds: item.sourceTradeIds.join(" | "),
  roles: item.roles.join(" | "),
  occurrenceCount: item.occurrenceCount,
  method: item.method,
  holdReason: item.holdReason,
  automaticResolutionAuthorized: item.automaticResolutionAuthorized,
}));
const unionRows = sharedUnionResolutions.map((item) => ({
  packageId: item.packageId,
  sourceTradeId: item.sourceTradeId,
  tradeDate: item.tradeDate,
  targetCanonicalId: item.targetCanonicalId,
  sourceTeams: item.sourceTeams.join(" | "),
  reviewedSourceTradeIds: item.reviewedSourceTradeIds.join(" | "),
  method: item.method,
  actualWriteAuthorized: item.actualWriteAuthorized,
}));
const relationshipRows = additionalRelationships.map((item) => ({
  relationshipId: item.relationshipId,
  packageId: item.packageId,
  sourceTradeId: item.sourceTradeId,
  targetCanonicalId: item.targetCanonicalId,
  assetReference: item.assetReference,
  sourceAssetId: item.sourceAssetId ?? "",
  syntheticAssetReference: item.syntheticAssetReference,
  relationshipRole: item.relationshipRole,
  playerId: item.playerId,
  playerDisplayName: item.playerDisplayName,
  resolutionMethod: item.resolutionMethod,
  relationshipWriteAuthorized: item.relationshipWriteAuthorized,
}));

const summary = {
  result: resolution.result,
  phase: resolution.phase,
  mode: resolution.mode,
  sourceRows: resolution.sourceRows,
  packagingActions: resolution.packagingActions,
  sharedUnionResolutions: resolution.sharedUnionResolutions,
  resolvedAmbiguousIdentities: resolution.resolvedAmbiguousIdentities,
  resolvedAmbiguousOccurrences: resolution.resolvedAmbiguousOccurrences,
  remainingAmbiguousIdentities: resolution.remainingAmbiguousIdentities,
  remainingAmbiguousOccurrences: resolution.remainingAmbiguousOccurrences,
  readyPackages: resolution.readyPackages,
  heldPackages: resolution.heldPackages,
  readyCanonicalCreatePackages: resolution.readyCanonicalCreatePackages,
  readyPerspectiveAppendPackages: resolution.readyPerspectiveAppendPackages,
  heldPackageTypeCounts: resolution.heldPackageTypeCounts,
  playerShellPackages: resolution.playerShellPackages,
  readyPlayerShellPackages: resolution.readyPlayerShellPackages,
  baseRelationshipPreviews: resolution.baseRelationshipPreviews,
  additionalRelationships: resolution.additionalRelationships,
  totalRelationshipPreviews: resolution.totalRelationshipPreviews,
  readyRelationshipPreviews: resolution.readyRelationshipPreviews,
  eligibilityCounts: resolution.eligibilityCounts,
  finalPackageRecordsSha256: resolution.finalPackageRecordsSha256,
  finalRelationshipRecordsSha256: resolution.finalRelationshipRecordsSha256,
  importPartitionSha256: resolution.importPartitionSha256,
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

await Promise.all([
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5g-blocker-resolution.json"), JSON.stringify(resolution, null, 2) + "\n", "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5g-resolved-ambiguous-identities.csv"), toCsv(resolvedRows, [
    "playerName", "normalizedName", "selectedPlayerId", "method", "candidatePlayerIds",
    "packageIds", "sourceTradeIds", "roles", "occurrenceCount", "actualWriteAuthorized",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5g-remaining-ambiguous-holds.csv"), toCsv(remainingRows, [
    "playerName", "normalizedName", "candidatePlayerIds", "packageIds",
    "sourceTradeIds", "roles", "occurrenceCount", "method", "holdReason",
    "automaticResolutionAuthorized",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5g-shared-union-resolutions.csv"), toCsv(unionRows, [
    "packageId", "sourceTradeId", "tradeDate", "targetCanonicalId", "sourceTeams",
    "reviewedSourceTradeIds", "method", "actualWriteAuthorized",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5g-additional-relationships.csv"), toCsv(relationshipRows, [
    "relationshipId", "packageId", "sourceTradeId", "targetCanonicalId", "assetReference",
    "sourceAssetId", "syntheticAssetReference", "relationshipRole", "playerId",
    "playerDisplayName", "resolutionMethod", "relationshipWriteAuthorized",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5g-import-partition.csv"), toCsv(importRows), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5g-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8"),
]);

console.log(JSON.stringify(summary, null, 2));
