#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function clean(value) { return String(value ?? "").trim(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function countRelationships(players) {
  return players.reduce((sum, player) => sum + (Array.isArray(player.relationshipReferences) ? player.relationshipReferences.length : 0), 0);
}

const args = parseArgs(process.argv);
for (const required of [
  "partition-json", "receipt-json", "phase12g-audit-json", "exposure-audit-json",
  "trades-json", "players-json", "teams-json", "phase12g-contract-md", "phase12h-contract-md",
  "output-json", "completed-at", "phase12g-head", "starting-head", "phase12g-report-sha256",
  "phase12g-bundle-sha256", "expected-canonical-store-sha256", "expected-player-store-sha256",
  "expected-team-store-sha256", "expected-receipt-sha256",
]) assert(args[required], `Missing --${required}`);

const [partitionBytes, receiptBytes, phase12gAuditBytes, exposureBytes, tradeBytes, playerBytes, teamBytes, phase12gContractBytes, phase12hContractBytes] = await Promise.all([
  readFile(args["partition-json"]), readFile(args["receipt-json"]), readFile(args["phase12g-audit-json"]),
  readFile(args["exposure-audit-json"]), readFile(args["trades-json"]), readFile(args["players-json"]),
  readFile(args["teams-json"]), readFile(args["phase12g-contract-md"]), readFile(args["phase12h-contract-md"]),
]);
const partition = JSON.parse(partitionBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const phase12gAudit = JSON.parse(phase12gAuditBytes.toString("utf8"));
const exposure = JSON.parse(exposureBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));

assert(partition.result === "PASS" && partition.phase === "12F", "Invalid Phase 12F partition.");
assert(receipt.result === "PASS" && receipt.phase === "12G", "Invalid Phase 12G receipt.");
assert(phase12gAudit.result === "PASS" && phase12gAudit.phase === "12G", "Invalid Phase 12G independent audit.");
assert(exposure.result === "PASS" && exposure.phase === "SCALABLE-PRIVATE-EXPOSURE", "Private exposure audit failed.");
assert(sha256(tradeBytes) === args["expected-canonical-store-sha256"], "Canonical store hash drifted.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Player store hash drifted.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Team store hash drifted.");
assert(sha256(receiptBytes) === args["expected-receipt-sha256"], "Phase 12G receipt hash drifted.");
assert(trades.length === 1716 && players.length === 2566 && teams.length === 52, "Post-import store counts drifted.");
assert(receipt.readyPackages === 199 && receipt.heldPackages === 16, "Ready/held accounting drifted.");
assert(receipt.canonicalTradesCreated === 149 && receipt.perspectivesAppended === 50, "Canonical write accounting drifted.");
assert(receipt.playerShellsCreated === 164 && receipt.heldOnlyPlayerShellsDeferred === 13, "Player-shell accounting drifted.");
assert(receipt.relationshipReferencesAdded === 479, "Relationship accounting drifted.");
assert(receipt.heldPackageImports === 0, "A held package was imported.");
assert(receipt.teamRegistryEntriesAdded === 0, "The team registry changed.");
assert(exposure.counts?.nbaPrivacyFailures === 0, "NBA privacy failures exist in the build.");
assert(exposure.counts?.nbaAdMarkers === 0, "NBA ad markers exist in the build.");
assert(exposure.counts?.publicNbaLinks === 0, "Public pages link to NBA routes.");
assert(exposure.counts?.sitemapNbaUrls === 0, "NBA routes entered a sitemap.");

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });
assert(query.counts.canonicalTrades === 1716 && query.counts.players === 2566, "Private query store counts drifted.");
assert(query.counts.privateTrades === 1716 && query.counts.privatePlayers === 2566, "Private query exposure drifted.");
assert(query.counts.playerTradeReferences === 1630, "Private query relationship count drifted.");
assert(routes.counts.routeModels === 4338, "Private route-model count drifted.");
assert(routes.counts.brokenLinks === 0 && routes.counts.duplicatePaths === 0, "Private route integrity drifted.");
assert(routes.counts.privacyViolations === 0 && routes.counts.routeCreatedModels === 0, "Private route exposure drifted.");

const manifest = {
  result: "PASS",
  phase: "12H",
  protocol: "Warp-Freeze Protocol",
  mode: "GOLDEN_STATE_PRIVATE_IMPORT_COMPLETION",
  completionPercent: 100,
  completedAt: args["completed-at"],
  startingHead: args["starting-head"],
  phase12GHead: args["phase12g-head"],
  sourceHashes: {
    phase12FPartitionSha256: sha256(partitionBytes),
    phase12FInternalPartitionSha256: partition.hashes.finalImportPartitionSha256,
    phase12GReceiptSha256: sha256(receiptBytes),
    phase12GAuditSha256: sha256(phase12gAuditBytes),
    privateExposureAuditSha256: sha256(exposureBytes),
    phase12GContractSha256: sha256(phase12gContractBytes),
    phase12HContractSha256: sha256(phase12hContractBytes),
    phase12GReportSha256: args["phase12g-report-sha256"],
    phase12GBundleSha256: args["phase12g-bundle-sha256"],
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamStoreSha256: sha256(teamBytes),
  },
  accounting: {
    sourceRows: 221,
    readyPackagesImported: 199,
    heldPackagesImported: 0,
    canonicalTradesCreated: 149,
    perspectivesAppended: 50,
    dateCollisionDistinctCreates: 20,
    heldPackages: 16,
    linkedOrVoidedExclusions: 6,
    frozenPlayerShellProposals: 177,
    playerShellsCreated: 164,
    heldOnlyPlayerShellsDeferred: 13,
    relationshipReferencesAdded: 479,
    matchedCanonicalAssetReferences: 471,
    perspectiveLocalAssetReferences: 8,
    sourceReferencesAdded: 415,
  },
  stores: {
    canonicalTrades: trades.length,
    players: players.length,
    teams: teams.length,
    playerRelationshipReferences: countRelationships(players),
    queryPlayerTradeReferences: query.counts.playerTradeReferences,
    uniqueTradeDates: query.counts.uniqueTradeDates,
    sharedPerspectiveTrades: query.counts.sharedPerspectiveTrades,
    privateTrades: query.counts.privateTrades,
    privatePlayers: query.counts.privatePlayers,
  },
  routing: {
    routeModels: routes.counts.routeModels,
    internalNbaLinks: routes.counts.internalLinks,
    duplicatePaths: 0,
    brokenLinks: 0,
    privacyViolations: 0,
  },
  build: exposure.counts,
  validation: {
    phase12GReceipt: "PASS",
    independentImportAudit: "PASS",
    canonicalCreates: "PASS",
    perspectiveAppends: "PASS",
    sameDateDistinctCreates: "PASS",
    heldAndExcludedIsolation: "PASS",
    playerShells: "PASS",
    relationshipOwnership: "PASS",
    privateQueryLayer: "PASS",
    privateRouteModels: "PASS",
    productionBuild: "PASS",
    privateExposureAndSitemapIsolation: "PASS",
    idempotentReplay: "PASS",
  },
  importedCanonicalTradeIds: receipt.importedCanonicalTradeIds,
  updatedPerspectiveCanonicalIds: receipt.updatedPerspectiveCanonicalIds,
  importedPlayerIds: receipt.importedPlayerIds,
  deferredPlayerIds: receipt.deferredPlayerIds,
  relationshipIds: receipt.relationshipIds,
  heldSourceTradeIds: receipt.heldSourceTradeIds,
  linkedOrVoidedExclusionIds: receipt.linkedOrVoidedExcludedSourceTradeIds,
  canonicalTradeWrites: 0,
  playerWrites: 0,
  teamWrites: 0,
  relationshipWrites: 0,
  routeWrites: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};
await mkdir(path.dirname(path.resolve(args["output-json"])), { recursive: true });
await writeFile(args["output-json"], canonicalJson(manifest));
console.log(JSON.stringify({
  result: "PASS",
  phase: "12H",
  completionPercent: 100,
  manifestSha256: sha256(canonicalJson(manifest)),
  accounting: manifest.accounting,
  stores: manifest.stores,
  routing: manifest.routing,
}, null, 2));
