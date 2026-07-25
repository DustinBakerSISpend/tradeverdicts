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
function slugify(value) {
  return normalizeName(value).replace(/\s+/gu, "-") || "unknown";
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
function playerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id);
}
function playerAliases(player) {
  return [
    ...(Array.isArray(player.aliases) ? player.aliases : []),
    ...(Array.isArray(player.playerAliases) ? player.playerAliases : []),
    ...(Array.isArray(player.alternateNames) ? player.alternateNames : []),
    ...(Array.isArray(player.identity?.aliases) ? player.identity.aliases : []),
  ].map(clean).filter(Boolean);
}
function buildPlayerIndex(players) {
  const byName = new Map();
  function add(name, player) {
    const key = normalizeName(name);
    if (!key) return;
    if (!byName.has(key)) byName.set(key, []);
    const list = byName.get(key);
    if (!list.some((item) => playerId(item) === playerId(player))) list.push(player);
  }
  for (const player of players) {
    add(playerName(player), player);
    for (const alias of playerAliases(player)) add(alias, player);
  }
  return byName;
}
function perspectiveTeam(perspective) {
  return clean(
    perspective.sourceTeam ??
    perspective.teamId ??
    perspective.team ??
    perspective.perspectiveTeam
  );
}
function buildNetsPerspective(record) {
  return {
    sourceTeam: "brooklyn-nets",
    sourceBatchId: record.sourceBatchId ?? "brooklyn-nets-phase-5a",
    sourceTradeId: record.sourceTradeId,
    summary: record.summary,
    analysis: record.analysis,
    verdict: record.verdict,
    grades: record.grades,
    aggregatePartnerGrade: record.aggregatePartnerGrade ?? null,
    confidence: record.confidence,
    reviewStatus: record.reviewStatus,
    sourcePerspectiveKey: record.sourcePerspectiveKey,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  };
}
function findRecordById(batch, id) {
  return (batch.records ?? []).find((record) =>
    clean(record.tradeId ?? record.id ?? record.sourceTradeId) === clean(id)
  ) ?? null;
}
function buildReviewedPerspective(record, fallbackTeam, fallbackBatchId) {
  assert(record, `Missing reviewed record for ${fallbackTeam}.`);
  const team = clean(record.sourceTeam ?? fallbackTeam);
  const tradeId = clean(record.tradeId ?? record.id ?? record.sourceTradeId);
  return {
    sourceTeam: team,
    sourceBatchId: clean(record.sourceBatchId ?? fallbackBatchId),
    sourceTradeId: tradeId,
    summary: clean(record.summary ?? record.finalSummary ?? record.tradeSummary),
    analysis: clean(record.analysis ?? record.finalAnalysis ?? record.tradeAnalysis),
    verdict: clean(record.verdict ?? record.finalVerdict),
    grades: record.grades ?? {
      [team]: clean(record.sourceTeamGrade ?? record.finalTeamGrade ?? record.finalGrade),
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
function assetType(asset) {
  return clean(asset?.type).toLowerCase().replaceAll("_", "-");
}
function assetName(asset) {
  return clean(
    asset?.playerName ??
    asset?.becamePlayerName ??
    asset?.name ??
    asset?.displayText
  );
}
function extractPlayerReferences(asset) {
  const refs = [];
  const type = assetType(asset);
  const directName = clean(asset?.playerName);
  const becameName = clean(asset?.becamePlayerName);
  const display = clean(asset?.displayText);

  if (["player", "draft-rights", "draft-rights-player"].includes(type)) {
    const name = directName || display;
    if (name) refs.push({
      name,
      role: type === "player" ? "traded-player" : "draft-rights-player",
      sourceAssetId: clean(asset.assetId),
    });
  }
  if (becameName) {
    refs.push({
      name: becameName,
      role: "pick-became-player",
      sourceAssetId: clean(asset.assetId),
    });
  }
  return refs;
}
function provisionalPlayerId(name) {
  return `nba-player-${slugify(name)}-${sha256(normalizeName(name)).slice(0, 10)}`;
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
    assert(toTeam, `${record.sourceTradeId}/${asset.assetId ?? asset.routeId}: missing toTeam.`);
    assert(assetsReceived[toTeam], `${record.sourceTradeId}: receiving team is outside canonical teams: ${toTeam}.`);
    assetsReceived[toTeam].push({
      ...asset,
      privateOnly: true,
    });
  }
  return assetsReceived;
}
function recentOrProvisional(record) {
  return (
    record.tradeDate >= "2025-01-01" ||
    clean(record.confidence).toLowerCase() === "low" ||
    /provisional|insufficient/iu.test(`${record.reviewStatus} ${record.verdict}`)
  );
}
function uniqueSemanticCurrentMatch(record) {
  const comparisons = Array.isArray(record.currentCanonicalComparisons)
    ? record.currentCanonicalComparisons
    : [];
  const semantic = comparisons.filter((item) => item.classification === "semantic-existing-match");
  return comparisons.length === 1 && semantic.length === 1 ? semantic[0] : null;
}
function reviewedSemanticMatches(record, field) {
  return (Array.isArray(record[field]) ? record[field] : [])
    .filter((item) => item.classification === "semantic-reviewed-match");
}
function choosePackageKind(record) {
  if (record.phase5CDecision === "approve-existing-canonical-perspective") {
    return {
      packageType: "perspective-append",
      targetCanonicalId: record.existingCanonicalMatch ?? record.targetIdentity,
      canonicalIdentityStatus: "existing-semantic-match",
      packageBlockers: [],
    };
  }

  const currentSemantic = uniqueSemanticCurrentMatch(record);
  if (currentSemantic) {
    return {
      packageType: "perspective-append",
      targetCanonicalId: currentSemantic.canonicalId,
      canonicalIdentityStatus: recentOrProvisional(record)
        ? "existing-semantic-match-provisional"
        : "existing-semantic-match-after-routing",
      packageBlockers: recentOrProvisional(record) ? ["recent-or-provisional"] : [],
    };
  }

  const currentComparisons = Array.isArray(record.currentCanonicalComparisons)
    ? record.currentCanonicalComparisons
    : [];
  if (currentComparisons.length > 0) {
    return {
      packageType: "canonical-collision-hold",
      targetCanonicalId: null,
      canonicalIdentityStatus: "same-date-team-current-collision",
      packageBlockers: ["existing-canonical-collision"],
    };
  }

  const atlantaSemantic = reviewedSemanticMatches(record, "atlantaReviewedComparisons");
  const bostonSemantic = reviewedSemanticMatches(record, "bostonReviewedComparisons");
  const allReviewed = [...atlantaSemantic, ...bostonSemantic];
  const allReviewedComparisons = [
    ...(Array.isArray(record.atlantaReviewedComparisons) ? record.atlantaReviewedComparisons : []),
    ...(Array.isArray(record.bostonReviewedComparisons) ? record.bostonReviewedComparisons : []),
  ];

  if (allReviewedComparisons.length > 0 && allReviewed.length !== allReviewedComparisons.length) {
    return {
      packageType: "reviewed-source-collision-hold",
      targetCanonicalId: null,
      canonicalIdentityStatus: "cross-team-reviewed-collision",
      packageBlockers: ["cross-team-source-collision"],
    };
  }

  return {
    packageType: "canonical-create",
    targetCanonicalId: record.targetIdentity ?? record.provisionalCanonicalId,
    canonicalIdentityStatus: allReviewed.length
      ? "new-shared-reviewed-canonical"
      : "new-nets-canonical",
    packageBlockers: recentOrProvisional(record) ? ["recent-or-provisional"] : [],
  };
}
function eligibilityFor(packageItem) {
  const dependencyStatuses = new Set(packageItem.playerDependencies.map((item) => item.status));
  const blockers = [...packageItem.packageBlockers];

  if (dependencyStatuses.has("ambiguous-player")) blockers.push("ambiguous-player");
  if (dependencyStatuses.has("missing-player-shell")) blockers.push("missing-player-shell");
  if (packageItem.unclassifiedAssetCount > 0) blockers.push("unclassified-asset");
  if (packageItem.packageType.endsWith("-hold")) blockers.push(packageItem.packageType);

  const uniqueBlockers = [...new Set(blockers)];
  let status = "ready-existing-player-dependencies";
  if (!packageItem.playerDependencies.length) status = "ready-no-player-dependencies";
  if (uniqueBlockers.includes("ambiguous-player")) status = "hold-ambiguous-player";
  else if (uniqueBlockers.includes("existing-canonical-collision")) status = "hold-existing-canonical-collision";
  else if (uniqueBlockers.includes("cross-team-source-collision")) status = "hold-cross-team-source-collision";
  else if (uniqueBlockers.includes("unclassified-asset")) status = "hold-unclassified-asset";
  else if (uniqueBlockers.includes("recent-or-provisional")) status = "hold-recent-or-provisional";
  else if (uniqueBlockers.includes("missing-player-shell")) status = "requires-player-shells";

  return {
    status,
    blockers: uniqueBlockers,
    importEligibleNow: status.startsWith("ready-"),
    relationshipFreezeRequired: packageItem.playerDependencies.length > 0,
  };
}

const args = parseArgs(process.argv);
for (const required of [
  "phase5d-freeze",
  "trades-json",
  "players-json",
  "atlanta-reviewed-json",
  "boston-reviewed-json",
  "output-dir",
]) assert(args[required], `Missing --${required}`);

const [
  phase5DBytes,
  tradesBytes,
  playersBytes,
  atlantaBytes,
  bostonBytes,
] = await Promise.all([
  readFile(args["phase5d-freeze"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["atlanta-reviewed-json"]),
  readFile(args["boston-reviewed-json"]),
]);

const phase5D = JSON.parse(phase5DBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));
const boston = JSON.parse(bostonBytes.toString("utf8"));
const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

assert(phase5D.result === "PASS" && phase5D.phase === "5D", "Invalid Phase 5D routing freeze.");
assert(Array.isArray(phase5D.records) && phase5D.records.length === 251, "Expected 251 Phase 5D records.");
assert(phase5D.counts.packagingQueueRecords === 208, "Expected 208 Phase 5D packaging records.");
assert(phase5D.counts.remainingHeldRecords === 35, "Expected 35 non-routing held records.");
assert(phase5D.counts.excludedNonStandalone === 8, "Expected 8 excluded records.");
assert(Array.isArray(trades) && trades.length === 456, "Canonical store count changed.");
assert(Array.isArray(players), "Player store is not an array.");
assert(Array.isArray(atlanta.records), "Atlanta reviewed records unavailable.");
assert(Array.isArray(boston.records), "Boston reviewed records unavailable.");

const canonicalById = new Map(trades.map((trade) => [clean(trade.id), trade]));
const playerIndex = buildPlayerIndex(players);

const packagingSourceRecords = phase5D.records.filter((record) =>
  [
    "approve-new-canonical-identity",
    "approve-existing-canonical-perspective",
    "routing-resolved-for-packaging",
  ].includes(record.phase5CDecision)
);
const heldSourceRecords = phase5D.records.filter((record) =>
  !packagingSourceRecords.includes(record) &&
  record.phase5CDecision !== "exclude-non-standalone"
);
const excludedSourceRecords = phase5D.records.filter(
  (record) => record.phase5CDecision === "exclude-non-standalone"
);

assert(packagingSourceRecords.length === 208, "Packaging source count drifted.");
assert(heldSourceRecords.length === 35, "Held source count drifted.");
assert(excludedSourceRecords.length === 8, "Excluded source count drifted.");

const packages = [];
const dependencyOccurrences = [];
const sharedPerspectiveRows = [];

for (const record of packagingSourceRecords) {
  const kind = choosePackageKind(record);
  const targetCanonicalId = clean(kind.targetCanonicalId);
  if (kind.packageType === "canonical-create") {
    assert(targetCanonicalId.startsWith("nba-trade-"), `${record.sourceTradeId}: invalid new canonical target.`);
    assert(!canonicalById.has(targetCanonicalId), `${record.sourceTradeId}: new canonical target already exists.`);
  } else if (kind.packageType === "perspective-append") {
    assert(canonicalById.has(targetCanonicalId), `${record.sourceTradeId}: perspective target is absent.`);
  }

  const perspectives = [buildNetsPerspective(record)];
  const atlantaSemantic = reviewedSemanticMatches(record, "atlantaReviewedComparisons");
  const bostonSemantic = reviewedSemanticMatches(record, "bostonReviewedComparisons");

  if (kind.packageType === "canonical-create") {
    for (const match of atlantaSemantic) {
      const sourceRecord = findRecordById(atlanta, match.sourceTradeId);
      const perspective = buildReviewedPerspective(sourceRecord, "atlanta-hawks", "atlanta-hawks-phase-3a");
      if (!perspectives.some((item) => perspectiveTeam(item) === perspective.sourceTeam)) {
        perspectives.push(perspective);
        sharedPerspectiveRows.push({
          sourceTradeId: record.sourceTradeId,
          tradeDate: record.tradeDate,
          canonicalTarget: targetCanonicalId,
          sourceTeam: perspective.sourceTeam,
          reviewedTradeId: perspective.sourceTradeId,
          matchClassification: match.classification,
        });
      }
    }
    for (const match of bostonSemantic) {
      const sourceRecord = findRecordById(boston, match.sourceTradeId);
      const perspective = buildReviewedPerspective(sourceRecord, "boston-celtics", "boston-celtics-phase-4a");
      if (!perspectives.some((item) => perspectiveTeam(item) === perspective.sourceTeam)) {
        perspectives.push(perspective);
        sharedPerspectiveRows.push({
          sourceTradeId: record.sourceTradeId,
          tradeDate: record.tradeDate,
          canonicalTarget: targetCanonicalId,
          sourceTeam: perspective.sourceTeam,
          reviewedTradeId: perspective.sourceTradeId,
          matchClassification: match.classification,
        });
      }
    }
  }

  const assetsReceived = routeAssetsByReceivingTeam(record);
  const allAssets = Object.values(assetsReceived).flat();
  const references = [];
  for (const asset of allAssets) {
    for (const reference of extractPlayerReferences(asset)) {
      references.push({
        ...reference,
        sourceTradeId: record.sourceTradeId,
        packageTarget: targetCanonicalId,
      });
    }
  }

  const playerDependencies = references.map((reference, index) => {
    const key = normalizeName(reference.name);
    const matches = playerIndex.get(key) ?? [];
    let status;
    let resolvedPlayerId = null;
    let proposedPlayerId = null;
    if (matches.length === 1) {
      status = "existing-player";
      resolvedPlayerId = playerId(matches[0]);
      assert(resolvedPlayerId, `${record.sourceTradeId}/${reference.name}: matched player lacks ID.`);
    } else if (matches.length === 0) {
      status = "missing-player-shell";
      proposedPlayerId = provisionalPlayerId(reference.name);
    } else {
      status = "ambiguous-player";
    }
    const dependency = {
      dependencyId: `${record.sourceTradeId}-player-dependency-${String(index + 1).padStart(3, "0")}`,
      sourceTradeId: record.sourceTradeId,
      packageTarget: targetCanonicalId,
      playerName: reference.name,
      normalizedName: key,
      role: reference.role,
      sourceAssetId: reference.sourceAssetId,
      status,
      resolvedPlayerId,
      proposedPlayerId,
      candidatePlayerIds: matches.map(playerId).filter(Boolean).sort(),
      privateOnly: true,
    };
    dependencyOccurrences.push(dependency);
    return dependency;
  });

  const canonicalPayload = kind.packageType === "canonical-create"
    ? {
        id: targetCanonicalId,
        league: "nba",
        slug: targetCanonicalId.replace(/^nba-trade-/u, ""),
        tradeDate: record.tradeDate,
        seasonLabel: record.seasonLabel,
        teams: [...record.teams].sort(),
        sourceTeams: [...new Set(perspectives.map(perspectiveTeam))].sort(),
        assetLedger: allAssets,
        assetsReceived,
        perspectives,
        privateOnly: true,
        indexEligible: false,
        adEligible: false,
        publicationReady: false,
      }
    : null;

  const packageItem = {
    packageId: `brooklyn-nets-phase-5e-${record.sourceTradeId}`,
    sourceTradeId: record.sourceTradeId,
    tradeDate: record.tradeDate,
    teams: [...record.teams].sort(),
    packageType: kind.packageType,
    canonicalIdentityStatus: kind.canonicalIdentityStatus,
    targetCanonicalId: targetCanonicalId || null,
    canonicalPayload,
    perspectivePayload: kind.packageType === "perspective-append" ? buildNetsPerspective(record) : null,
    perspectives,
    playerDependencies,
    dependencyOccurrenceCount: playerDependencies.length,
    unclassifiedAssetCount: Number(record.unclassifiedAssetCount ?? 0),
    packageBlockers: [...kind.packageBlockers],
    sourcePhase5DDecision: record.phase5CDecision,
    sourcePhase5DRecordHash: sha256(Buffer.from(stable(record))),
    privateOnly: true,
    canonicalImportAuthorized: false,
    playerImportAuthorized: false,
    perspectiveWriteAuthorized: false,
    relationshipWriteAuthorized: false,
    routeDataWriteAuthorized: false,
    automaticMergeAuthorized: false,
    publicationAuthorized: false,
  };
  packageItem.importEligibility = eligibilityFor(packageItem);
  packages.push(packageItem);
}

assert(packages.length === 208, "Package count drifted.");
assert(new Set(packages.map((item) => item.packageId)).size === 208, "Duplicate package ID.");
const actionableTargets = packages
  .filter((item) => ["canonical-create", "perspective-append"].includes(item.packageType))
  .map((item) => `${item.packageType}|${item.targetCanonicalId}`);
assert(new Set(actionableTargets).size === actionableTargets.length, "Duplicate canonical package target.");

const uniqueDependenciesMap = new Map();
for (const occurrence of dependencyOccurrences) {
  const key = occurrence.normalizedName;
  if (!uniqueDependenciesMap.has(key)) {
    uniqueDependenciesMap.set(key, {
      playerName: occurrence.playerName,
      normalizedName: occurrence.normalizedName,
      status: occurrence.status,
      resolvedPlayerId: occurrence.resolvedPlayerId,
      proposedPlayerId: occurrence.proposedPlayerId,
      candidatePlayerIds: occurrence.candidatePlayerIds,
      occurrenceCount: 0,
      sourceTradeIds: [],
      roles: [],
    });
  }
  const item = uniqueDependenciesMap.get(key);
  item.occurrenceCount += 1;
  item.sourceTradeIds.push(occurrence.sourceTradeId);
  item.roles.push(occurrence.role);
  assert(item.status === occurrence.status, `${occurrence.playerName}: dependency status is inconsistent.`);
}
const uniqueDependencies = [...uniqueDependenciesMap.values()]
  .map((item) => ({
    ...item,
    sourceTradeIds: [...new Set(item.sourceTradeIds)].sort(),
    roles: [...new Set(item.roles)].sort(),
  }))
  .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName));

const playerShellPreview = uniqueDependencies
  .filter((item) => item.status === "missing-player-shell")
  .map((item) => ({
    proposedPlayerId: item.proposedPlayerId,
    displayName: item.playerName,
    normalizedName: item.normalizedName,
    sourceTradeIds: item.sourceTradeIds.join(" | "),
    roles: item.roles.join(" | "),
    occurrenceCount: item.occurrenceCount,
    privateOnly: true,
    importAuthorized: false,
  }));

const ambiguousPlayers = uniqueDependencies
  .filter((item) => item.status === "ambiguous-player")
  .map((item) => ({
    playerName: item.playerName,
    normalizedName: item.normalizedName,
    candidatePlayerIds: item.candidatePlayerIds.join(" | "),
    sourceTradeIds: item.sourceTradeIds.join(" | "),
    roles: item.roles.join(" | "),
    occurrenceCount: item.occurrenceCount,
    resolutionStatus: "manual-review-required",
  }));

const packageTypeCounts = countBy(packages.map((item) => item.packageType));
const dependencyStatusCounts = countBy(uniqueDependencies.map((item) => item.status));
const importEligibilityCounts = countBy(packages.map((item) => item.importEligibility.status));

const counts = {
  sourceRows: phase5D.records.length,
  packagingQueueRecords: packagingSourceRecords.length,
  canonicalCreatePackages: packageTypeCounts["canonical-create"] ?? 0,
  perspectiveAppendPackages: packageTypeCounts["perspective-append"] ?? 0,
  canonicalCollisionHoldPackages: packageTypeCounts["canonical-collision-hold"] ?? 0,
  reviewedSourceCollisionHoldPackages: packageTypeCounts["reviewed-source-collision-hold"] ?? 0,
  totalPackagingActions: packages.length,
  remainingSourceHolds: heldSourceRecords.length,
  excludedNonStandalone: excludedSourceRecords.length,
  uniquePlayerDependencies: uniqueDependencies.length,
  dependencyOccurrences: dependencyOccurrences.length,
  playerShellPreviews: playerShellPreview.length,
  ambiguousPlayerDependencies: ambiguousPlayers.length,
  sharedReviewedPerspectiveRows: sharedPerspectiveRows.length,
  dependencyStatusCounts,
  importEligibilityCounts,
};

assert(counts.sourceRows === 251, "Source-row count drifted.");
assert(counts.packagingQueueRecords === 208, "Packaging queue count drifted.");
assert(counts.totalPackagingActions === 208, "Packaging action count drifted.");
assert(
  counts.canonicalCreatePackages +
    counts.perspectiveAppendPackages +
    counts.canonicalCollisionHoldPackages +
    counts.reviewedSourceCollisionHoldPackages === 208,
  "Package-type accounting does not total 208."
);
assert(counts.remainingSourceHolds === 35, "Remaining source-hold count drifted.");
assert(counts.excludedNonStandalone === 8, "Excluded non-standalone count drifted.");
assert(counts.totalPackagingActions + counts.remainingSourceHolds + counts.excludedNonStandalone === 251, "Phase 5E accounting does not total 251.");
assert(
  Object.values(importEligibilityCounts).reduce((sum, value) => sum + value, 0) === 208,
  "Import-eligibility accounting does not total 208."
);

const freeze = {
  result: "PASS",
  phase: "5E",
  mode: "BROOKLYN_NETS_CANONICAL_PACKAGING_AND_ELIGIBILITY_FREEZE",
  batchId: "brooklyn-nets-phase-5e",
  sourcePhase: "5D",
  sourceFreeze: {
    phase5DFileSha256: sha256(phase5DBytes),
    routeRecordsSha256: phase5D.routeRecordsSha256,
    routingManifestSha256: phase5D.routingManifestSha256,
  },
  storeHashes: {
    canonicalTradesSha256: sha256(tradesBytes),
    playersSha256: sha256(playersBytes),
    atlantaReviewedSha256: sha256(atlantaBytes),
    bostonReviewedSha256: sha256(bostonBytes),
  },
  counts,
  packageRecordsSha256: sha256(Buffer.from(stable(packages))),
  dependencyRecordsSha256: sha256(Buffer.from(stable(uniqueDependencies))),
  policy: {
    privateOnly: true,
    canonicalImportsAuthorized: false,
    playerImportsAuthorized: false,
    perspectiveWritesAuthorized: false,
    relationshipWritesAuthorized: false,
    routeDataWritesAuthorized: false,
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
  automaticMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
  packages,
  uniquePlayerDependencies: uniqueDependencies,
};

const packageRows = packages.map((item) => ({
  packageId: item.packageId,
  sourceTradeId: item.sourceTradeId,
  tradeDate: item.tradeDate,
  teams: item.teams.join(" | "),
  packageType: item.packageType,
  canonicalIdentityStatus: item.canonicalIdentityStatus,
  targetCanonicalId: item.targetCanonicalId ?? "",
  perspectives: item.perspectives.map(perspectiveTeam).join(" | "),
  dependencyOccurrences: item.dependencyOccurrenceCount,
  importEligibility: item.importEligibility.status,
  importEligibleNow: item.importEligibility.importEligibleNow,
  blockers: item.importEligibility.blockers.join(" | "),
}));

const createRows = packageRows.filter((row) => row.packageType === "canonical-create");
const perspectiveRows = packageRows.filter((row) => row.packageType === "perspective-append");
const collisionRows = packageRows.filter((row) => row.packageType.endsWith("-hold"));
const eligibilityRows = packageRows;
const dependencyRows = uniqueDependencies.map((item) => ({
  playerName: item.playerName,
  normalizedName: item.normalizedName,
  status: item.status,
  resolvedPlayerId: item.resolvedPlayerId ?? "",
  proposedPlayerId: item.proposedPlayerId ?? "",
  candidatePlayerIds: item.candidatePlayerIds.join(" | "),
  occurrenceCount: item.occurrenceCount,
  sourceTradeIds: item.sourceTradeIds.join(" | "),
  roles: item.roles.join(" | "),
}));
const shellRows = playerShellPreview;
const summary = {
  result: freeze.result,
  phase: freeze.phase,
  mode: freeze.mode,
  ...counts,
  packageRecordsSha256: freeze.packageRecordsSha256,
  dependencyRecordsSha256: freeze.dependencyRecordsSha256,
  storeHashes: freeze.storeHashes,
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

await Promise.all([
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5e-packaging-freeze.json"), JSON.stringify(freeze, null, 2) + "\n", "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5e-canonical-create-packages.csv"), toCsv(createRows), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5e-perspective-packages.csv"), toCsv(perspectiveRows), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5e-canonical-collision-holds.csv"), toCsv(collisionRows, [
    "packageId", "sourceTradeId", "tradeDate", "teams", "packageType",
    "canonicalIdentityStatus", "targetCanonicalId", "perspectives",
    "dependencyOccurrences", "importEligibility", "importEligibleNow", "blockers",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5e-package-eligibility.csv"), toCsv(eligibilityRows), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5e-player-dependencies.csv"), toCsv(dependencyRows, [
    "playerName", "normalizedName", "status", "resolvedPlayerId", "proposedPlayerId",
    "candidatePlayerIds", "occurrenceCount", "sourceTradeIds", "roles",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5e-player-shell-preview.csv"), toCsv(shellRows, [
    "proposedPlayerId", "displayName", "normalizedName", "sourceTradeIds",
    "roles", "occurrenceCount", "privateOnly", "importAuthorized",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5e-ambiguous-player-holds.csv"), toCsv(ambiguousPlayers, [
    "playerName", "normalizedName", "candidatePlayerIds", "sourceTradeIds",
    "roles", "occurrenceCount", "resolutionStatus",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5e-shared-reviewed-perspectives.csv"), toCsv(sharedPerspectiveRows, [
    "sourceTradeId", "tradeDate", "canonicalTarget", "sourceTeam",
    "reviewedTradeId", "matchClassification",
  ]), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5e-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8"),
]);

console.log(JSON.stringify(summary, null, 2));
