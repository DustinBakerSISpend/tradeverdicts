#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPreviewPlayerIdentityPlan } from "../../src/lib/nba/preview-player-identity.mjs";
import { buildPreviewRoutingPlan } from "../../src/lib/nba/preview-asset-routing.mjs";

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

function normalizedTextHash(bytes) {
  return sha256(Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n"));
}

function csv(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csv).join(","))
    .join("\r\n")}\r\n`;
}

const args = parseArgs(process.argv);
for (const required of ["phase-3b-json", "players-json", "trades-json", "output-dir"]) {
  assert(args[required], `Missing --${required}`);
}

const [previewBytes, playerBytes, tradeBytes] = await Promise.all([
  readFile(args["phase-3b-json"]),
  readFile(args["players-json"]),
  readFile(args["trades-json"]),
]);
const preview = JSON.parse(previewBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
assert(preview.phase === "3B" && preview.result === "PASS", "Phase 3C requires a passing Phase 3B preview.");
assert(preview.records.length === 308, `Expected 308 Phase 3B records, found ${preview.records.length}`);
assert(Array.isArray(players) && players.length === 67, `Expected 67 existing players, found ${players.length}`);
assert(Array.isArray(trades) && trades.length === 27, `Expected 27 canonical trades, found ${trades.length}`);

const identityPlan = buildPreviewPlayerIdentityPlan({
  previewRecords: preview.records,
  players,
});
const routingPlan = buildPreviewRoutingPlan({
  previewRecords: preview.records,
  canonicalTrades: trades,
});

const routingByAssetKey = new Map(
  routingPlan.routes.map((route) => [`${route.sourceTradeId}|${route.assetId}`, route]),
);
const placeholderTradeIds = new Set(
  identityPlan.placeholderReferences.map((reference) => reference.sourceTradeId),
);
const routingSummaryByTradeId = new Map(
  routingPlan.recordSummaries.map((record) => [record.sourceTradeId, record]),
);
const recordEligibility = preview.records
  .filter((record) => record.candidateAction !== "exclude-from-standalone-canonical-preview")
  .map((record) => {
    const routingSummary = routingSummaryByTradeId.get(record.sourceTradeId);
    const parserPlaceholderBlock = placeholderTradeIds.has(record.sourceTradeId);
    const existingPerspectiveOnly = record.candidateAction === "add-source-perspective-to-existing-canonical";
    const blockers = [
      ...record.blockers,
      ...(parserPlaceholderBlock ? ["A non-player placeholder was emitted as a player identity reference."] : []),
      ...(!routingSummary?.routingReady ? ["One or more multi-team asset routes require manual resolution."] : []),
      ...(existingPerspectiveOnly ? ["Existing canonical perspective must reconcile against existing assets rather than create a new trade."] : []),
    ];
    return {
      sourceTradeId: record.sourceTradeId,
      canonicalTradeId: record.existingCanonicalMatch ?? record.provisionalCanonicalId,
      candidateAction: record.candidateAction,
      phase3bCanonicalDataReady: record.canonicalDataReady,
      parserPlaceholderBlock,
      routingReady: Boolean(routingSummary?.routingReady),
      existingPerspectiveOnly,
      phase3cCanonicalImportReady:
        record.candidateAction === "create-new-canonical-preview" &&
        record.canonicalDataReady &&
        !parserPlaceholderBlock &&
        Boolean(routingSummary?.routingReady),
      blockers,
    };
  });
const eligibilityByTradeId = new Map(recordEligibility.map((record) => [record.sourceTradeId, record]));

const existingMatches = identityPlan.identities.filter((identity) => identity.identityAction === "match-existing-player");
const newPlayers = identityPlan.identities.filter((identity) => identity.identityAction === "create-new-player-preview");
const identityHolds = identityPlan.identities.filter((identity) => identity.blockers.length > 0);
const importReadyPlayers = newPlayers.filter((identity) => identity.playerDataReady);
const standaloneRecords = preview.records.filter((record) => record.candidateAction !== "exclude-from-standalone-canonical-preview");
const multiTeamRecords = standaloneRecords.filter((record) => record.teams.length > 2);
const relationshipEdges = identityPlan.validReferences.map((reference) => {
  const identity = identityPlan.identities.find((entry) => entry.normalizedName === reference.normalizedName);
  return {
    edgeId: `preview-player-trade-${sha256(`${identity.existingPlayerId ?? identity.provisionalPlayerId}|${reference.referenceKey}`).slice(0, 14)}`,
    playerId: identity.existingPlayerId ?? identity.provisionalPlayerId,
    playerAction: identity.identityAction,
    playerName: identity.preferredName,
    canonicalTradeId: reference.canonicalTradeId,
    sourceTradeId: reference.sourceTradeId,
    assetId: reference.assetId,
    referenceType: reference.referenceType,
    tradeDate: reference.tradeDate,
    existingCanonicalPerspective: Boolean(reference.existingCanonicalMatch),
    relationshipImportReady:
      identity.blockers.length === 0 &&
      Boolean(eligibilityByTradeId.get(reference.sourceTradeId)?.phase3cCanonicalImportReady) &&
      Boolean(routingByAssetKey.get(`${reference.sourceTradeId}|${reference.assetId}`)?.routingReady),
  };
});
const teamTradeEdges = standaloneRecords.flatMap((record) =>
  record.teams.map((teamSlug) => ({
    edgeId: `preview-team-trade-${sha256(`${teamSlug}|${record.existingCanonicalMatch ?? record.provisionalCanonicalId}`).slice(0, 14)}`,
    teamSlug,
    canonicalTradeId: record.existingCanonicalMatch ?? record.provisionalCanonicalId,
    sourceTradeId: record.sourceTradeId,
    tradeDate: record.tradeDate,
    existingCanonicalPerspective: Boolean(record.existingCanonicalMatch),
  })),
);

const duplicatePlayerIds = newPlayers
  .map((identity) => identity.provisionalPlayerId)
  .filter((value, index, values) => values.indexOf(value) !== index);
const duplicatePlayerSlugs = newPlayers
  .map((identity) => identity.slug)
  .filter((value, index, values) => values.indexOf(value) !== index);
const duplicateRelationshipEdges = relationshipEdges
  .map((edge) => edge.edgeId)
  .filter((value, index, values) => values.indexOf(value) !== index);
const duplicateTeamEdges = teamTradeEdges
  .map((edge) => edge.edgeId)
  .filter((value, index, values) => values.indexOf(value) !== index);

assert(identityPlan.duplicateReferenceKeys.length === 0, `Duplicate player reference keys: ${identityPlan.duplicateReferenceKeys.join(", ")}`);
assert(duplicatePlayerIds.length === 0, `Duplicate provisional player IDs: ${[...new Set(duplicatePlayerIds)].join(", ")}`);
assert(duplicatePlayerSlugs.length === 0, `Duplicate provisional player slugs: ${[...new Set(duplicatePlayerSlugs)].join(", ")}`);
assert(duplicateRelationshipEdges.length === 0, "Duplicate player-trade preview edges.");
assert(duplicateTeamEdges.length === 0, "Duplicate team-trade preview edges.");
assert(identityPlan.identityCollisions.length === 0, `Existing/source identity collisions detected: ${JSON.stringify(identityPlan.identityCollisions)}`);

const counts = {
  phase3bSourceRows: preview.records.length,
  standaloneTradePreviews: standaloneRecords.length,
  multiTeamTradePreviews: multiTeamRecords.length,
  existingPlayerStoreRecords: players.length,
  rawPlayerReferences: identityPlan.references.length,
  validPlayerReferences: identityPlan.validReferences.length,
  excludedPlaceholderReferences: identityPlan.placeholderReferences.length,
  uniquePlayerIdentities: identityPlan.identities.length,
  existingPlayerMatches: existingMatches.length,
  newPlayerPreviews: newPlayers.length,
  newPlayerImportReady: importReadyPlayers.length,
  playerIdentityHolds: identityHolds.length,
  parserPlaceholderTrades: placeholderTradeIds.size,
  phase3bFalseReadyPlaceholderTrades: recordEligibility.filter(
    (record) => record.phase3bCanonicalDataReady && record.parserPlaceholderBlock,
  ).length,
  phase3cCanonicalImportReady: recordEligibility.filter(
    (record) => record.phase3cCanonicalImportReady,
  ).length,
  phase3cCanonicalImportBlocked: recordEligibility.filter(
    (record) => !record.phase3cCanonicalImportReady && !record.existingPerspectiveOnly,
  ).length,
  existingPerspectiveOnlyRows: recordEligibility.filter(
    (record) => record.existingPerspectiveOnly,
  ).length,
  playerTradePreviewEdges: relationshipEdges.length,
  playerTradeImportReadyEdges: relationshipEdges.filter((edge) => edge.relationshipImportReady).length,
  teamTradePreviewEdges: teamTradeEdges.length,
  assetRoutingRows: routingPlan.routes.length,
  resolvedAssetRoutes: routingPlan.routes.filter((route) => route.routingReady).length,
  manualAssetRoutingRows: routingPlan.routes.filter((route) => !route.routingReady).length,
  routingReadyTrades: routingPlan.recordSummaries.filter((record) => record.routingReady).length,
  manualRoutingTrades: routingPlan.recordSummaries.filter((record) => !record.routingReady).length,
};

const result = {
  result: "PASS",
  phase: "3C",
  mode: "PLAYER_IDENTITY_RELATIONSHIP_AND_ROUTING_PREVIEW_ONLY",
  counts,
  hashes: {
    phase3bPreviewSha256: normalizedTextHash(previewBytes),
    playerStoreSha256: normalizedTextHash(playerBytes),
    canonicalStoreSha256: normalizedTextHash(tradeBytes),
    identityPlanSha256: identityPlan.hashes.identityPlanSha256,
    routingPlanSha256: sha256(JSON.stringify(routingPlan)),
  },
  playerIdentity: {
    identities: identityPlan.identities,
    placeholderReferences: identityPlan.placeholderReferences,
    collisions: identityPlan.identityCollisions,
  },
  routing: routingPlan,
  recordEligibility,
  relationships: {
    playerTradeEdges: relationshipEdges,
    teamTradeEdges,
  },
  canonicalImports: 0,
  playerImports: 0,
  relationshipImports: 0,
  routeCreation: 0,
  automaticPlayerMerges: 0,
  automaticAssetRouting: 0,
  repositoryDataWrites: 0,
  pushPerformed: false,
  deployPerformed: false,
};

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });
const identityRows = identityPlan.identities.map((identity) => ({
  preferredName: identity.preferredName,
  normalizedName: identity.normalizedName,
  identityAction: identity.identityAction,
  existingPlayerId: identity.existingPlayerId ?? "",
  provisionalPlayerId: identity.provisionalPlayerId ?? "",
  sourceVariants: identity.sourceVariants,
  referenceCount: identity.referenceCount,
  sourceTradeCount: identity.sourceTradeCount,
  yearRange: identity.yearRange,
  playerDataReady: identity.playerDataReady,
  blockers: identity.blockers,
}));
const placeholderRows = identityPlan.placeholderReferences.map((reference) => ({
  sourceTradeId: reference.sourceTradeId,
  tradeDate: reference.tradeDate,
  assetId: reference.assetId,
  assetType: reference.assetType,
  referenceType: reference.referenceType,
  playerName: reference.playerName,
  displayText: reference.displayText,
  canonicalDataReady: reference.canonicalDataReady,
}));
const routingRows = routingPlan.routes.map((route) => ({
  sourceTradeId: route.sourceTradeId,
  tradeDate: route.tradeDate,
  teams: route.teams,
  assetId: route.assetId,
  assetType: route.assetType,
  displayText: route.displayText,
  direction: route.direction,
  routingAction: route.routingAction,
  matchedCanonicalAssetId: route.matchedCanonicalAssetId ?? "",
  fromTeam: route.fromTeam ?? "",
  toTeam: route.toTeam ?? "",
  possibleFromTeams: route.possibleFromTeams,
  possibleToTeams: route.possibleToTeams,
  routingReady: route.routingReady,
  blockers: route.blockers,
}));
const blockerRows = [
  ...identityPlan.identities
    .filter((identity) => identity.blockers.length > 0)
    .map((identity) => ({
      blockerType: "player-identity",
      sourceTradeId: identity.sourceTradeIds.join(" | "),
      subject: identity.preferredName,
      action: identity.identityAction,
      blockers: identity.blockers,
    })),
  ...identityPlan.placeholderReferences.map((reference) => ({
    blockerType: "non-player-placeholder",
    sourceTradeId: reference.sourceTradeId,
    subject: reference.playerName,
    action: "exclude-from-player-identity-plan",
    blockers: [`Parser emitted ${reference.referenceType} for a non-player placeholder.`],
  })),
  ...routingPlan.issues.map((issue) => ({
    blockerType: "asset-routing",
    sourceTradeId: issue.sourceTradeId,
    subject: issue.assetId,
    action: issue.routingAction,
    blockers: issue.blockers,
  })),
  ...recordEligibility
    .filter((record) => !record.phase3cCanonicalImportReady && !record.existingPerspectiveOnly)
    .map((record) => ({
      blockerType: "canonical-import-readiness",
      sourceTradeId: record.sourceTradeId,
      subject: record.canonicalTradeId,
      action: "hold-before-canonical-import",
      blockers: record.blockers,
    })),
];

await Promise.all([
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3c-identity-routing-preview.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3c-player-identities.csv"), toCsv(identityRows), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3c-placeholder-references.csv"), toCsv(placeholderRows), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3c-asset-routing.csv"), toCsv(routingRows), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3c-player-trade-edges.csv"), toCsv(relationshipEdges), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3c-team-trade-edges.csv"), toCsv(teamTradeEdges), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3c-blockers.csv"), toCsv(blockerRows), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3c-trade-eligibility.csv"), toCsv(recordEligibility), "utf8"),
]);

console.log(JSON.stringify({
  result: result.result,
  phase: result.phase,
  counts: result.counts,
  automaticPlayerMerges: result.automaticPlayerMerges,
  automaticAssetRouting: result.automaticAssetRouting,
  canonicalImports: result.canonicalImports,
  playerImports: result.playerImports,
  relationshipImports: result.relationshipImports,
  routeCreation: result.routeCreation,
  pushPerformed: result.pushPerformed,
  deployPerformed: result.deployPerformed,
}, null, 2));
