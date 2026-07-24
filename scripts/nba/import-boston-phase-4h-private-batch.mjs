#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    String(left).localeCompare(String(right), "en"),
  );
}

function uniquePreservingOrder(values) {
  return [...new Set(values.filter(Boolean))];
}

async function atomicWrite(filePath, bytes, suffix) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${suffix}-${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function readPlayerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id);
}

function packageAssets(item) {
  const assets =
    item.packageKind === "perspective-append"
      ? item.routedAssetLedger
      : item.canonicalPayload?.assetLedger;

  assert(Array.isArray(assets), `${item.packageId}: asset ledger missing.`);
  return assets;
}

function normalizedIdentity(value) {
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

function relationshipMatchesAsset(relationship, asset) {
  if (relationship.assetType !== asset.type) return false;

  if (
    relationship.relationshipRole === "traded-player" ||
    relationship.relationshipRole === "draft-rights-player"
  ) {
    return (
      normalizedIdentity(relationship.playerDisplayName) ===
      normalizedIdentity(asset.playerName)
    );
  }

  if (relationship.relationshipRole === "pick-became-player") {
    return (
      normalizedIdentity(relationship.playerDisplayName) ===
      normalizedIdentity(asset.becamePlayerName)
    );
  }

  return false;
}

function allCanonicalAssets(item, relationshipsByPackage) {
  const packageRelationships =
    relationshipsByPackage.get(item.packageId) ?? [];

  const baseAssets = packageAssets(item);

  const base = baseAssets.map((asset, assetOrdinal) => {
    const sourceAssetId = clean(asset.assetId);
    if (sourceAssetId) {
      return {
        ...asset,
        possibleFromTeams: [],
        possibleToTeams: [],
        routingStatus: "resolved",
        auditStatus: asset.auditStatus ?? "frozen-boston-phase-4h",
      };
    }

    const syntheticCandidates = packageRelationships.filter(
      (relationship) =>
        relationship.syntheticAssetReference === true &&
        relationshipMatchesAsset(relationship, asset),
    );

    assert(
      syntheticCandidates.length <= 1,
      `${item.packageId}: missing source asset ID matched more than one ` +
        `synthetic relationship reference.`,
    );

    if (syntheticCandidates.length === 1) {
      const synthetic = syntheticCandidates[0];

      return {
        ...asset,
        assetId: synthetic.assetId,
        sourceAssetId: null,
        syntheticAssetReference: true,
        syntheticAssetReferenceMethod: "relationship-reference",
        syntheticAssetReferenceSource: synthetic.relationshipId,
        possibleFromTeams: [],
        possibleToTeams: [],
        routingStatus: "resolved",
        auditStatus: "frozen-boston-phase-4h-synthetic-asset-id",
      };
    }

    const fingerprint = sha256([
      item.packageId,
      assetOrdinal,
      asset.type ?? "",
      asset.displayText ?? "",
      asset.fromTeam ?? "",
      asset.toTeam ?? "",
      asset.direction ?? "",
      asset.playerName ?? "",
      asset.becamePlayerName ?? "",
      asset.status ?? "",
    ].join("|"));

    return {
      ...asset,
      assetId: `phase4h-asset-${fingerprint.slice(0, 18)}`,
      sourceAssetId: null,
      syntheticAssetReference: true,
      syntheticAssetReferenceMethod:
        "deterministic-canonical-asset-fields",
      syntheticAssetReferenceSource:
        `phase4h-canonical-fingerprint:${fingerprint}`,
      syntheticAssetOrdinal: assetOrdinal,
      possibleFromTeams: [],
      possibleToTeams: [],
      routingStatus: "resolved",
      auditStatus:
        "frozen-boston-phase-4h-field-derived-synthetic-asset-id",
    };
  });

  const supplemental = (item.canonicalPayload?.supplementalRouteEdges ?? []).map(
    (edge) => ({
      assetId: edge.assetId,
      type: edge.type,
      displayText: edge.displayText,
      fromTeam: edge.fromTeam,
      toTeam: edge.toTeam,
      status: "supplemental-context",
      notes: [edge.correctionNote].filter(Boolean),
      direction: "supplemental",
      sourceTeam: "boston-celtics",
      possibleFromTeams: [],
      possibleToTeams: [],
      routingStatus: "resolved",
      auditStatus: "frozen-boston-phase-4h-supplemental",
      supplementalContext: true,
      canonicalWriteAuthorized: false,
    }),
  );

  const assets = [...base, ...supplemental];
  const ids = assets.map((asset) => clean(asset.assetId));
  assert(
    ids.every(Boolean) && new Set(ids).size === ids.length,
    `${item.packageId}: normalized asset IDs are missing or duplicated.`,
  );
  assert(
    assets.every(
      (asset) =>
        asset.fromTeam &&
        asset.toTeam &&
        asset.type !== "other" &&
        asset.status !== "unclassified",
    ),
    `${item.packageId}: unresolved or unclassified canonical asset.`,
  );

  return assets;
}

function assetsByTeam(teams, assets, direction) {
  return Object.fromEntries(
    teams.map((team) => [
      team,
      assets.filter((asset) =>
        direction === "received"
          ? asset.toTeam === team
          : asset.fromTeam === team,
      ),
    ]),
  );
}

function bostonSubmission(row) {
  return {
    submissionId: `boston-celtics-phase-4a-${row.tradeId}`,
    batchId: "boston-celtics-phase-4a",
    sourceTeam: "boston-celtics",
    sourceRowId: row.tradeId,
    sourceFileName: "src/data/nba/raw/boston-celtics-phase-4a.txt",
    sourceLabel:
      "User-provided Boston Celtics trade-history batch with Meta/Grok and ChatGPT reconciliation",
    receivedAt: "2026-07-24T00:00:00.000Z",
    rawText: row.sourceRawText,
    rawFields: {
      tradeDate: row.tradeDate,
      partnerTeams: row.partnerTeams,
      assetsReceived: row.assetsReceivedText,
      assetsSent: row.assetsSentText,
      relationshipText: row.relationshipText,
    },
    contentHash: sha256(row.sourceRawText),
  };
}

function atlantaSubmission(row) {
  return {
    submissionId: `atlanta-hawks-phase-3a-${row.tradeId}`,
    batchId: "atlanta-hawks-phase-3a",
    sourceTeam: "atlanta-hawks",
    sourceRowId: row.tradeId,
    sourceFileName: "src/data/nba/raw/atlanta-hawks-phase-3a.txt",
    sourceLabel:
      "User-provided Atlanta Hawks trade-history batch with Meta/Grok and ChatGPT reconciliation",
    receivedAt: "2026-07-23T00:00:00.000Z",
    rawText: row.sourceRawText,
    rawFields: {
      tradeDate: row.tradeDate,
      partnerTeams: row.partnerTeams,
      assetsReceived: row.assetsReceivedText,
      assetsSent: row.assetsSentText,
      relationshipText: row.relationshipText,
    },
    contentHash: sha256(row.sourceRawText),
  };
}

function externalSource(row) {
  if (!clean(row.externalSourceUrl)) return null;
  return {
    sourceType: "external_reference",
    sourceUrl: row.externalSourceUrl,
    sourceLabel: row.sourceBasis,
    reviewStatus: row.reviewStatus,
  };
}

function perspectiveFromRow(row, status) {
  return {
    sourceSubmissionId:
      row.sourceTeam === "atlanta-hawks"
        ? `atlanta-hawks-phase-3a-${row.tradeId}`
        : `boston-celtics-phase-4a-${row.tradeId}`,
    editorialStatus: status,
    grade: row.sourceTeamGrade,
    verdict: row.verdict,
    summary: row.summary,
    analysis: row.analysis,
    confidence: row.confidence,
    reviewStatus: row.reviewStatus,
    tradeTier: row.tradeTier,
  };
}

function tradeSlug(item) {
  const suffix = item.targetCanonicalId.replace(/^nba-trade-\d{8}-/u, "");
  return `boston-celtics-${item.canonicalPayload.tradeDate}-${suffix}`;
}

function immutablePerspectiveProjection(trade) {
  const {
    sourceTeams,
    grades,
    perspectives,
    sources,
    updatedAt,
    perspectiveReconciliations,
    ...immutable
  } = trade;
  return immutable;
}

function relationshipReferenceType(role) {
  if (role === "traded-player") return "direct_player";
  if (role === "draft-rights-player") return "draft_rights";
  if (role === "pick-became-player") return "draft_outcome";
  throw new Error(`Unsupported relationship role: ${role}`);
}

function sourceReference(relationship, packageItem, playerId) {
  const asset = packageAssets(packageItem).find(
    (candidate) =>
      clean(candidate.assetId) === clean(relationship.sourceAssetId) ||
      clean(candidate.assetId) === clean(relationship.assetId),
  );

  let resolvedAsset = asset;
  if (!resolvedAsset && relationship.syntheticAssetReference === true) {
    const candidates = packageAssets(packageItem).filter((candidate) => {
      if (candidate.type !== relationship.assetType) return false;
      if (
        relationship.relationshipRole === "traded-player" ||
        relationship.relationshipRole === "draft-rights-player"
      ) {
        return clean(candidate.playerName) === clean(relationship.playerDisplayName);
      }
      if (relationship.relationshipRole === "pick-became-player") {
        return clean(candidate.becamePlayerName) === clean(relationship.playerDisplayName);
      }
      return false;
    });
    assert(
      candidates.length === 1,
      `${relationship.relationshipId}: synthetic asset lookup returned ${candidates.length}.`,
    );
    resolvedAsset = candidates[0];
  }

  assert(resolvedAsset, `${relationship.relationshipId}: source asset missing.`);

  const canonicalTradeId = packageItem.targetCanonicalId;
  const assetReference = relationship.assetId;
  const referenceType = relationshipReferenceType(
    relationship.relationshipRole,
  );

  return {
    referenceId: `${canonicalTradeId}|${assetReference}|${referenceType}`,
    referenceType,
    playerName: relationship.playerDisplayName,
    canonicalTradeId,
    sourceTradeId: relationship.sourceTradeId,
    tradeDate:
      packageItem.canonicalPayload?.tradeDate ??
      packageItem.perspectivePayload?.tradeDate ??
      null,
    teams:
      packageItem.canonicalPayload?.teams ??
      [],
    assetId: assetReference,
    sourceAssetId: relationship.sourceAssetId ?? null,
    syntheticAssetReference:
      relationship.syntheticAssetReference === true,
    assetType: relationship.assetType,
    displayText: resolvedAsset.displayText,
    direction: resolvedAsset.direction ?? relationship.direction ?? null,
    fromTeam: resolvedAsset.fromTeam ?? relationship.fromTeam ?? null,
    toTeam: resolvedAsset.toTeam ?? relationship.toTeam ?? null,
    possibleFromTeams: [],
    possibleToTeams: [],
    overall: resolvedAsset.overall ?? null,
    edgeId: relationship.relationshipId,
    relationshipStatus: "active-frozen-boston-phase-4h",
    playerId,
  };
}

function draftReference(reference) {
  if (!["draft_rights", "draft_outcome"].includes(reference.referenceType)) {
    return null;
  }
  return {
    referenceType: reference.referenceType,
    sourceTradeId: reference.sourceTradeId,
    tradeDate: reference.tradeDate,
    overall: reference.overall ?? null,
    displayText: reference.displayText,
  };
}

function updatePlayer(player, newReferences, importedAt, startingHead, sourceFreezeSha) {
  const byId = new Map(
    (player.sourceReferences ?? []).map((reference) => [
      reference.referenceId,
      reference,
    ]),
  );

  for (const reference of newReferences) {
    if (byId.has(reference.referenceId)) {
      assert(
        JSON.stringify(byId.get(reference.referenceId)) ===
          JSON.stringify(reference),
        `${player.id}: existing source reference differs: ${reference.referenceId}`,
      );
    } else {
      byId.set(reference.referenceId, reference);
    }
  }

  const sourceReferences = [...byId.values()].sort((left, right) =>
    left.referenceId.localeCompare(right.referenceId, "en"),
  );
  const sourceTradeIds = uniqueSorted(
    sourceReferences.map((reference) => reference.sourceTradeId),
  );
  const canonicalTradeIds = uniqueSorted(
    sourceReferences.map((reference) => reference.canonicalTradeId),
  );
  const referenceTypes = uniqueSorted(
    sourceReferences.map((reference) => reference.referenceType),
  );
  const teams = uniqueSorted(
    sourceReferences.flatMap((reference) => reference.teams ?? []),
  );
  const draftReferences = sourceReferences
    .map(draftReference)
    .filter(Boolean)
    .sort(
      (left, right) =>
        String(left.tradeDate).localeCompare(String(right.tradeDate)) ||
        left.sourceTradeId.localeCompare(right.sourceTradeId) ||
        left.referenceType.localeCompare(right.referenceType),
    );

  return {
    ...player,
    identityStatus:
      player.identityStatus === "source-derived-shell"
        ? "source-derived-accepted"
        : player.identityStatus,
    referenceCount: sourceReferences.length,
    sourceTradeCount: sourceTradeIds.length,
    sourceTradeIds,
    canonicalTradeIds,
    referenceTypes,
    teams,
    draftReferences,
    sourceReferences,
    pendingRelationshipCount: 0,
    pendingSourceTradeIds: [],
    pendingCanonicalTradeIds: [],
    pendingReferenceTypes: [],
    pendingTeams: [],
    pendingSourceReferences: [],
    reviewStatus: "manual-review",
    updatedAt: importedAt,
    importMetadata: {
      ...(player.importMetadata ?? {}),
      bostonRelationshipActivationPhase: "4H",
      bostonRelationshipActivatedAt: importedAt,
      bostonRelationshipSourceCheckpoint: startingHead,
      bostonRelationshipSourceFreezeSha256: sourceFreezeSha,
      bostonRelationshipPolicy:
        "exact-ready-package-player-references-no-held-package-activation",
    },
  };
}

function newPlayerFromShell(shellPackage, references, importedAt, startingHead, sourceFreezeSha) {
  const payload = shellPackage.playerPayload;
  assert(references.length > 0, `${payload.id}: shell has no imported relationships.`);

  const sourceTradeIds = uniqueSorted(
    references.map((reference) => reference.sourceTradeId),
  );
  const canonicalTradeIds = uniqueSorted(
    references.map((reference) => reference.canonicalTradeId),
  );
  const referenceTypes = uniqueSorted(
    references.map((reference) => reference.referenceType),
  );
  const teams = uniqueSorted(
    references.flatMap((reference) => reference.teams ?? []),
  );

  return {
    id: payload.id,
    league: "nba",
    name: payload.displayName,
    normalizedName: payload.normalizedName,
    slug: payload.slug,
    aliases: payload.aliases ?? [],
    sourceCandidateId: `boston-celtics-phase-4f:${payload.id}`,
    identityStatus: "source-derived-accepted",
    externalIdentityStatus: "unverified",
    externalIds: {},
    referenceCount: references.length,
    sourceTradeCount: sourceTradeIds.length,
    sourceTradeIds,
    canonicalTradeIds,
    referenceTypes,
    teams,
    draftReferences: references
      .map(draftReference)
      .filter(Boolean)
      .sort(
        (left, right) =>
          String(left.tradeDate).localeCompare(String(right.tradeDate)) ||
          left.sourceTradeId.localeCompare(right.sourceTradeId) ||
          left.referenceType.localeCompare(right.referenceType),
      ),
    sourceReferences: references.sort((left, right) =>
      left.referenceId.localeCompare(right.referenceId, "en"),
    ),
    pendingRelationshipCount: 0,
    pendingSourceTradeIds: [],
    pendingCanonicalTradeIds: [],
    pendingReferenceTypes: [],
    pendingTeams: [],
    pendingSourceReferences: [],
    aliasDecision:
      (payload.aliases ?? []).length > 0
        ? {
            reason:
              "Frozen Boston source-name variants retained without automatic merging.",
            sourceTradeIds,
          }
        : null,
    publishStatus: "private",
    reviewStatus: "manual-review",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    automaticMerge: false,
    playerImportPerformed: true,
    createdAt: importedAt,
    updatedAt: importedAt,
    importMetadata: {
      phase: "4H",
      batchId: "boston-celtics-phase-4h-private-import",
      importedAt,
      sourceCheckpoint: startingHead,
      sourceFreezeSha256,
      identityPolicy:
        "deterministic-phase-4f-player-shell-no-automatic-merge",
      relationshipPolicy:
        "ready-package-relationships-activated-with-private-import",
      visibilityPolicy: "private-noindex-ad-free",
    },
  };
}

const args = parseArgs(process.argv);
for (const required of [
  "phase4e-freeze",
  "phase4f-freeze",
  "phase4g-resolution",
  "boston-reviewed-json",
  "atlanta-reviewed-json",
  "trades-json",
  "players-json",
  "receipt-json",
  "expected-trade-store-sha256",
  "expected-player-store-sha256",
  "imported-at",
  "starting-head",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  phase4eBytes,
  phase4fBytes,
  phase4gBytes,
  bostonReviewedBytes,
  atlantaReviewedBytes,
  tradeBytes,
  playerBytes,
] = await Promise.all([
  readFile(args["phase4e-freeze"]),
  readFile(args["phase4f-freeze"]),
  readFile(args["phase4g-resolution"]),
  readFile(args["boston-reviewed-json"]),
  readFile(args["atlanta-reviewed-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const phase4e = JSON.parse(phase4eBytes.toString("utf8"));
const phase4f = JSON.parse(phase4fBytes.toString("utf8"));
const phase4g = JSON.parse(phase4gBytes.toString("utf8"));
const bostonReviewed = JSON.parse(bostonReviewedBytes.toString("utf8"));
const atlantaReviewed = JSON.parse(atlantaReviewedBytes.toString("utf8"));
const currentTrades = JSON.parse(tradeBytes.toString("utf8"));
const currentPlayers = JSON.parse(playerBytes.toString("utf8"));

assert(phase4e.result === "PASS" && phase4e.phase === "4E", "Invalid Phase 4E freeze.");
assert(phase4f.result === "PASS" && phase4f.phase === "4F", "Invalid Phase 4F freeze.");
assert(phase4g.result === "PASS" && phase4g.phase === "4G", "Invalid Phase 4G resolution.");
assert(Array.isArray(currentTrades) && currentTrades.length >= 256, "Unexpected canonical store.");
assert(Array.isArray(currentPlayers) && currentPlayers.length >= 509, "Unexpected player store.");
assert(bostonReviewed.records.length === 223, "Boston reviewed source changed.");
assert(atlantaReviewed.records.length === 308, "Atlanta reviewed source changed.");

const receiptBytes = await readFile(args["receipt-json"]).catch((error) =>
  error.code === "ENOENT" ? null : Promise.reject(error),
);

if (receiptBytes !== null) {
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert(receipt.result === "PASS" && receipt.phase === "4H", "Unexpected Phase 4H receipt.");
  assert(receipt.startingHead === args["starting-head"], "Receipt checkpoint drifted.");
  assert(sha256(tradeBytes) === receipt.canonicalStoreSha256, "Canonical store differs from receipt.");
  assert(sha256(playerBytes) === receipt.playerStoreSha256, "Player store differs from receipt.");
  console.log(JSON.stringify({
    result: "PASS",
    phase: "4H",
    mode: "IDEMPOTENT_REPLAY",
    canonicalTradesAdded: 0,
    perspectivesAdded: 0,
    playerShellsAdded: 0,
    relationshipReferencesAdded: 0,
    repositoryDataWrites: 0,
    canonicalStoreSha256: receipt.canonicalStoreSha256,
    playerStoreSha256: receipt.playerStoreSha256,
    receiptSha256: sha256(receiptBytes),
  }, null, 2));
  process.exit(0);
}

assert(
  sha256(tradeBytes) === args["expected-trade-store-sha256"].toLowerCase(),
  "Canonical-store preimage mismatch.",
);
assert(
  sha256(playerBytes) === args["expected-player-store-sha256"].toLowerCase(),
  "Player-store preimage mismatch.",
);
assert(currentTrades.length === 256, `Expected 256 pre-import trades, found ${currentTrades.length}.`);
assert(currentPlayers.length === 509, `Expected 509 pre-import players, found ${currentPlayers.length}.`);

const sourceFreezeSha256 = sha256(phase4gBytes);
const importedAt = args["imported-at"];
const packageById = new Map(
  phase4e.packages.map((item) => [item.packageId, item]),
);
const bostonById = new Map(
  bostonReviewed.records.map((row) => [row.tradeId, row]),
);
const atlantaById = new Map(
  atlantaReviewed.records.map((row) => [row.tradeId, row]),
);

const readyStatuses = new Set([
  "dependency-clear",
  "ready-after-player-shell-import",
]);
const readyPackageIds = new Set(
  phase4g.readiness
    .filter((item) => readyStatuses.has(item.finalEligibility))
    .map((item) => item.packageId),
);
const heldPackageIds = new Set(
  phase4g.readiness
    .filter((item) => !readyStatuses.has(item.finalEligibility))
    .map((item) => item.packageId),
);

assert(
  readyPackageIds.size === phase4g.readyPackages,
  "Ready-package count drifted.",
);
assert(
  heldPackageIds.size === phase4g.heldPackages,
  "Held-package count drifted.",
);
assert(
  readyPackageIds.size + heldPackageIds.size === 211,
  "Import partition does not total 211.",
);

const readyPackages = [...readyPackageIds]
  .map((id) => packageById.get(id))
  .sort((left, right) => left.packageId.localeCompare(right.packageId, "en"));
assert(readyPackages.every(Boolean), "A ready package is missing.");

const allRelationshipPreviews = [
  ...phase4f.relationshipPreviews,
  ...phase4g.additionalRelationships,
];
const relationshipsByPackage = new Map();

for (const relationship of allRelationshipPreviews) {
  if (!relationshipsByPackage.has(relationship.packageId)) {
    relationshipsByPackage.set(relationship.packageId, []);
  }
  relationshipsByPackage.get(relationship.packageId).push(relationship);
}

const createPackages = readyPackages.filter((item) =>
  ["canonical-create", "shared-canonical-create"].includes(item.packageKind),
);
const perspectivePackages = readyPackages.filter(
  (item) => item.packageKind === "perspective-append",
);
assert(
  createPackages.length + perspectivePackages.length === readyPackages.length,
  "Unexpected ready package kind.",
);

const existingTradeById = new Map(
  currentTrades.map((trade) => [trade.id, trade]),
);
const existingTradeSlugs = new Set(currentTrades.map((trade) => trade.slug));
const importedTrades = [];

for (const item of createPackages) {
  assert(!existingTradeById.has(item.targetCanonicalId), `${item.packageId}: target already exists.`);
  const bostonRow = bostonById.get(item.sourceTradeId);
  assert(bostonRow, `${item.sourceTradeId}: Boston reviewed row missing.`);

  const payload = item.canonicalPayload;
  const assets = allCanonicalAssets(item, relationshipsByPackage);
  const teams = payload.teams.slice();
  const slug = tradeSlug(item);
  assert(!existingTradeSlugs.has(slug), `${item.packageId}: slug collision.`);

  const perspectives = {
    "boston-celtics": perspectiveFromRow(
      bostonRow,
      "reconciled-ready-for-private-import",
    ),
  };
  const sourceTeams = ["boston-celtics"];
  const sources = [
    bostonSubmission(bostonRow),
    ...(externalSource(bostonRow) ? [externalSource(bostonRow)] : []),
  ];
  const grades = {
    ...(payload.grades ?? {}),
    "boston-celtics": bostonRow.sourceTeamGrade,
  };

  if (item.packageKind === "shared-canonical-create") {
    const atlantaRow = atlantaById.get(item.atlantaSourceTradeId);
    assert(atlantaRow, `${item.atlantaSourceTradeId}: Atlanta reviewed row missing.`);
    perspectives["atlanta-hawks"] = perspectiveFromRow(
      atlantaRow,
      "reconciled-shared-private-perspective",
    );
    sourceTeams.push("atlanta-hawks");
    sources.push(
      atlantaSubmission(atlantaRow),
      ...(externalSource(atlantaRow) ? [externalSource(atlantaRow)] : []),
    );
    grades["atlanta-hawks"] = atlantaRow.sourceTeamGrade;
  }

  importedTrades.push({
    id: item.targetCanonicalId,
    league: "nba",
    slug,
    tradeDate: payload.tradeDate,
    seasonLabel: payload.seasonLabel,
    teams,
    sourceTeams: uniquePreservingOrder(sourceTeams),
    assetsReceived: assetsByTeam(teams, assets, "received"),
    assetsSentByTeam: assetsByTeam(teams, assets, "sent"),
    assetLedger: assets,
    unresolvedAssetRouting: [],
    routingCompleteness: "complete",
    summary: bostonRow.summary,
    verdict: bostonRow.verdict,
    grades,
    aggregatePartnerGrade: bostonRow.partnerAggregateGrade ?? null,
    perspectives,
    sources,
    canonicalKey: payload.canonicalKey,
    dateTeamsKey: payload.dateTeamsKey,
    publishStatus: "private",
    reviewStatus: "manual-review",
    indexEligible: false,
    adEligible: false,
    createdAt: importedAt,
    updatedAt: importedAt,
    candidateAction:
      item.packageKind === "shared-canonical-create"
        ? "create-shared-reviewed-canonical"
        : "create-new-canonical-candidate",
    candidateId: `nba-candidate-${item.sourceTradeId.toLowerCase()}`,
    sourceTradeId: item.sourceTradeId,
    canonicalDataReady: true,
    publicationReady: false,
    automaticMerge: false,
    canonicalImportPerformed: true,
    auditResolution: null,
    auditMetadata: {
      confidence: bostonRow.confidence,
      sourceReviewStatus: bostonRow.reviewStatus,
      tradeTier: bostonRow.tradeTier,
      dataQualityFlags: bostonRow.dataQualityFlags,
      contentClass: bostonRow.contentClass,
      lowValueRisk: bostonRow.lowValueRisk,
      contentRationale: bostonRow.contentRationale,
      minimumPublicTreatment: bostonRow.minimumPublicTreatment,
      sharedAtlantaSourceTradeId: item.atlantaSourceTradeId ?? null,
    },
    importMetadata: {
      phase: "4H",
      batchId: "boston-celtics-phase-4h-private-import",
      importedAt,
      sourceFreezeSha256,
      sourceCheckpoint: args["starting-head"],
      sourcePackageId: item.packageId,
      visibilityPolicy: "private-noindex-ad-free",
      routingPolicy: "exact-phase-4d-routes",
      relationshipPolicy:
        "ready-package-player-relationships-activated-with-import",
      sharedUnionPolicy:
        item.packageKind === "shared-canonical-create"
          ? "boston-routed-ledger-authoritative-with-atlanta-perspective"
          : null,
    },
  });
}

assert(
  new Set(importedTrades.map((trade) => trade.id)).size === importedTrades.length,
  "Imported canonical IDs are not unique.",
);
assert(
  new Set(importedTrades.map((trade) => trade.slug)).size === importedTrades.length,
  "Imported canonical slugs are not unique.",
);

const updatedTrades = currentTrades.slice();
const perspectiveUpdatedIds = [];

for (const item of perspectivePackages) {
  const targetIndex = updatedTrades.findIndex(
    (trade) => trade.id === item.targetCanonicalId,
  );
  assert(targetIndex >= 0, `${item.packageId}: perspective target missing.`);

  const target = updatedTrades[targetIndex];
  const bostonRow = bostonById.get(item.sourceTradeId);
  assert(bostonRow, `${item.sourceTradeId}: Boston reviewed row missing.`);
  assert(
    !Object.prototype.hasOwnProperty.call(
      target.perspectives ?? {},
      "boston-celtics",
    ),
    `${item.packageId}: Boston perspective already exists.`,
  );

  const beforeImmutable = sha256(
    canonicalJson(immutablePerspectiveProjection(target)),
  );
  const submission = bostonSubmission(bostonRow);
  const reference = externalSource(bostonRow);
  const reconciliation = {
    phase: "4H",
    sourceTradeId: bostonRow.tradeId,
    sourceTeam: "boston-celtics",
    reconciledAt: importedAt,
    sourceCheckpoint: args["starting-head"],
    sourceFreezeSha256,
    sourcePackageId: item.packageId,
    policy:
      "explicit-existing-canonical-perspective-only-no-asset-or-route-change",
  };

  const updated = {
    ...target,
    sourceTeams: uniquePreservingOrder([
      ...(target.sourceTeams ?? []),
      "boston-celtics",
    ]),
    grades: {
      ...(target.grades ?? {}),
      "boston-celtics": bostonRow.sourceTeamGrade,
    },
    perspectives: {
      ...(target.perspectives ?? {}),
      "boston-celtics": perspectiveFromRow(
        bostonRow,
        "reconciled-private-perspective",
      ),
    },
    sources: [
      ...(target.sources ?? []),
      submission,
      ...(reference ? [reference] : []),
    ],
    updatedAt: importedAt,
    perspectiveReconciliations: [
      ...(target.perspectiveReconciliations ?? []),
      reconciliation,
    ],
  };

  assert(
    sha256(canonicalJson(immutablePerspectiveProjection(updated))) ===
      beforeImmutable,
    `${item.packageId}: perspective update changed an immutable canonical field.`,
  );
  assert(
    JSON.stringify(updated.assetLedger) === JSON.stringify(target.assetLedger),
    `${item.packageId}: perspective update changed assets.`,
  );

  updatedTrades[targetIndex] = updated;
  perspectiveUpdatedIds.push(item.targetCanonicalId);
}

updatedTrades.push(...importedTrades);
assert(
  updatedTrades.length === currentTrades.length + importedTrades.length,
  "Post-import canonical count mismatch.",
);

const relationshipEligiblePackageIds = new Set(
  createPackages.map((item) => item.packageId),
);

const baseRelationships = phase4f.relationshipPreviews.filter((relationship) =>
  relationshipEligiblePackageIds.has(relationship.packageId),
);
const additionalRelationships = phase4g.additionalRelationships.filter(
  (relationship) =>
    relationshipEligiblePackageIds.has(relationship.packageId),
);
const relationships = [...baseRelationships, ...additionalRelationships].sort(
  (left, right) =>
    left.relationshipId.localeCompare(right.relationshipId, "en"),
);
assert(
  new Set(relationships.map((relationship) => relationship.relationshipId)).size ===
    relationships.length,
  "Imported relationship IDs are not unique.",
);

const expectedCanonicalCreateOccurrences = phase4e.dependencies.reduce(
  (sum, dependency) =>
    sum +
    dependency.occurrences.filter((occurrence) =>
      relationshipEligiblePackageIds.has(occurrence.packageId),
    ).length,
  0,
);
assert(
  relationships.length === expectedCanonicalCreateOccurrences,
  `Expected ${expectedCanonicalCreateOccurrences} canonical-create relationship ` +
    `occurrences, found ${relationships.length}.`,
);

const perspectiveRelationshipCandidates = [
  ...phase4f.relationshipPreviews,
  ...phase4g.additionalRelationships,
].filter((relationship) =>
  perspectivePackages.some(
    (item) => item.packageId === relationship.packageId,
  ),
);

const shellByPlayerId = new Map(
  phase4f.shellPackages.map((shell) => [shell.playerPayload.id, shell]),
);
const requiredShellIds = new Set(
  relationships
    .map((relationship) => relationship.playerId)
    .filter((playerId) => shellByPlayerId.has(playerId)),
);
const currentPlayerById = new Map(
  currentPlayers.map((player) => [readPlayerId(player), player]),
);

for (const playerId of requiredShellIds) {
  assert(!currentPlayerById.has(playerId), `${playerId}: shell already exists.`);
}

const referencesByPlayer = new Map();
for (const relationship of relationships) {
  const packageItem = packageById.get(relationship.packageId);
  assert(packageItem, `${relationship.packageId}: relationship package missing.`);
  const reference = sourceReference(
    relationship,
    packageItem,
    relationship.playerId,
  );

  if (!referencesByPlayer.has(relationship.playerId)) {
    referencesByPlayer.set(relationship.playerId, []);
  }
  referencesByPlayer.get(relationship.playerId).push(reference);
}

const importedPlayers = [];
const updatedPlayerById = new Map(currentPlayerById);
let existingPlayersUpdated = 0;

for (const [playerId, references] of referencesByPlayer) {
  if (requiredShellIds.has(playerId)) {
    const shell = shellByPlayerId.get(playerId);
    const player = newPlayerFromShell(
      shell,
      references,
      importedAt,
      args["starting-head"],
      sourceFreezeSha256,
    );
    importedPlayers.push(player);
    updatedPlayerById.set(playerId, player);
  } else {
    const player = updatedPlayerById.get(playerId);
    assert(player, `${playerId}: existing relationship player missing.`);
    updatedPlayerById.set(
      playerId,
      updatePlayer(
        player,
        references,
        importedAt,
        args["starting-head"],
        sourceFreezeSha256,
      ),
    );
    existingPlayersUpdated += 1;
  }
}

const postPlayers = [
  ...currentPlayers.map((player) => updatedPlayerById.get(readPlayerId(player))),
  ...importedPlayers.sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  ),
];

assert(
  postPlayers.length === currentPlayers.length + importedPlayers.length,
  "Post-import player count mismatch.",
);
assert(
  new Set(postPlayers.map((player) => player.id)).size === postPlayers.length,
  "Post-import player IDs are not unique.",
);
assert(
  new Set(postPlayers.map((player) => player.slug)).size === postPlayers.length,
  "Post-import player slugs are not unique.",
);

const heldCreateCanonicalIds = phase4e.packages
  .filter(
    (item) =>
      heldPackageIds.has(item.packageId) &&
      ["canonical-create", "shared-canonical-create"].includes(item.packageKind),
  )
  .map((item) => item.targetCanonicalId);
for (const canonicalId of heldCreateCanonicalIds) {
  assert(
    !updatedTrades.some((trade) => trade.id === canonicalId),
    `${canonicalId}: held canonical package was imported.`,
  );
}

const tradeOut = canonicalJson(updatedTrades);
const playerOut = canonicalJson(postPlayers);

const receipt = {
  result: "PASS",
  phase: "4H",
  mode: "GUARDED_PRIVATE_BOSTON_IMPORT",
  batchId: "boston-celtics-phase-4h-private-import",
  startingHead: args["starting-head"],
  importedAt,
  sourcePhase4ESha256: sha256(phase4eBytes),
  sourcePhase4FSha256: sha256(phase4fBytes),
  sourcePhase4GSha256: sourceFreezeSha256,
  preImportCanonicalStoreSha256:
    args["expected-trade-store-sha256"].toLowerCase(),
  preImportPlayerStoreSha256:
    args["expected-player-store-sha256"].toLowerCase(),
  sourceRows: 223,
  packagingActions: 211,
  readyPackages: readyPackageIds.size,
  heldPackages: heldPackageIds.size,
  excludedNonStandalone: 12,
  preImportCanonicalTrades: currentTrades.length,
  canonicalTradesAdded: importedTrades.length,
  perspectivesAdded: perspectiveUpdatedIds.length,
  postImportCanonicalTrades: updatedTrades.length,
  preImportPlayers: currentPlayers.length,
  playerShellsAdded: importedPlayers.length,
  existingPlayersUpdated,
  postImportPlayers: postPlayers.length,
  relationshipReferencesAdded: relationships.length,
  perspectiveRelationshipCandidatesSkipped:
    perspectiveRelationshipCandidates.length,
  relationshipEligiblePackageCount:
    relationshipEligiblePackageIds.size,
  syntheticCanonicalAssetIdsAdded: importedTrades.reduce(
    (sum, trade) =>
      sum +
      trade.assetLedger.filter(
        (asset) => asset.syntheticAssetReference === true,
      ).length,
    0,
  ),
  relationshipBackedSyntheticAssetIdsAdded: importedTrades.reduce(
    (sum, trade) =>
      sum +
      trade.assetLedger.filter(
        (asset) =>
          asset.syntheticAssetReferenceMethod ===
          "relationship-reference",
      ).length,
    0,
  ),
  fieldDerivedSyntheticAssetIdsAdded: importedTrades.reduce(
    (sum, trade) =>
      sum +
      trade.assetLedger.filter(
        (asset) =>
          asset.syntheticAssetReferenceMethod ===
          "deterministic-canonical-asset-fields",
      ).length,
    0,
  ),
  importedPackageIds: [...readyPackageIds].sort(),
  heldPackageIds: [...heldPackageIds].sort(),
  importedCanonicalTradeIds: importedTrades.map((trade) => trade.id).sort(),
  updatedPerspectiveCanonicalIds: perspectiveUpdatedIds.sort(),
  importedPlayerIds: importedPlayers.map((player) => player.id).sort(),
  relationshipIds: relationships
    .map((relationship) => relationship.relationshipId)
    .sort(),
  heldCanonicalTradeIds: heldCreateCanonicalIds.sort(),
  canonicalStoreSha256: sha256(tradeOut),
  playerStoreSha256: sha256(playerOut),
  repositoryDataWrites: 3,
  automaticMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
  visibilityPolicy: "private-noindex-ad-free",
  pushPerformed: false,
  deployPerformed: false,
};

const receiptOut = canonicalJson(receipt);

await atomicWrite(args["trades-json"], tradeOut, "phase4h-trades");
await atomicWrite(args["players-json"], playerOut, "phase4h-players");
await atomicWrite(args["receipt-json"], receiptOut, "phase4h-receipt");

console.log(JSON.stringify({
  result: "PASS",
  phase: "4H",
  mode: "FIRST_IMPORT",
  readyPackages: receipt.readyPackages,
  heldPackages: receipt.heldPackages,
  canonicalTradesAdded: receipt.canonicalTradesAdded,
  perspectivesAdded: receipt.perspectivesAdded,
  playerShellsAdded: receipt.playerShellsAdded,
  existingPlayersUpdated: receipt.existingPlayersUpdated,
  relationshipReferencesAdded: receipt.relationshipReferencesAdded,
  perspectiveRelationshipCandidatesSkipped:
    receipt.perspectiveRelationshipCandidatesSkipped,
  relationshipEligiblePackageCount:
    receipt.relationshipEligiblePackageCount,
  syntheticCanonicalAssetIdsAdded:
    receipt.syntheticCanonicalAssetIdsAdded,
  relationshipBackedSyntheticAssetIdsAdded:
    receipt.relationshipBackedSyntheticAssetIdsAdded,
  fieldDerivedSyntheticAssetIdsAdded:
    receipt.fieldDerivedSyntheticAssetIdsAdded,
  postImportCanonicalTrades: receipt.postImportCanonicalTrades,
  postImportPlayers: receipt.postImportPlayers,
  repositoryDataWrites: receipt.repositoryDataWrites,
  canonicalStoreSha256: receipt.canonicalStoreSha256,
  playerStoreSha256: receipt.playerStoreSha256,
  receiptSha256: sha256(receiptOut),
}, null, 2));
