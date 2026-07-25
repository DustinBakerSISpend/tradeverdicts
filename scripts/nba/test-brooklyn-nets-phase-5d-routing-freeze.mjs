#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

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
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const args = parseArgs(process.argv);
for (const required of ["freeze-json", "routing-json", "phase5c-freeze", "trades-json", "players-json"]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, routingBytes, phase5CBytes, tradesBytes, playersBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["routing-json"]),
  readFile(args["phase5c-freeze"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));
const phase5C = JSON.parse(phase5CBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));

assert(freeze.result === "PASS", "Routing freeze result is not PASS.");
assert(freeze.phase === "5D", "Routing freeze phase is not 5D.");
assert(freeze.mode === "BROOKLYN_NETS_MULTI_TEAM_ASSET_ROUTING_FREEZE", "Unexpected routing mode.");
assert(routing.phase === "5D", "Routing manifest phase drifted.");
assert(Array.isArray(freeze.records) && freeze.records.length === 251, "Expected 251 routing-freeze records.");
assert(Array.isArray(freeze.sourceRouteEdges) && freeze.sourceRouteEdges.length > 0, "No source route edges.");
assert(Array.isArray(freeze.supplementalRouteEdges), "Supplemental route array missing.");
assert(Array.isArray(trades), "Canonical store is not an array.");
assert(Array.isArray(players), "Player store is not an array.");

const counts = freeze.counts;
assert(counts.sourceRows === 251, "Source-row count drifted.");
assert(counts.routingHoldTransactions === 14, "Routing-hold count drifted.");
assert(counts.routedTransactions === 14, "Routed transaction count drifted.");
assert(counts.routedSourceAssets === freeze.sourceRouteEdges.length, "Source-route count mismatch.");
assert(counts.supplementalRoutes === freeze.supplementalRouteEdges.length, "Supplemental-route count mismatch.");
assert(counts.totalRouteEdges === counts.routedSourceAssets + counts.supplementalRoutes, "Total route-edge count mismatch.");
assert(counts.sourceRouteCorrections === 2, "Expected two source routing corrections.");
assert(counts.sourceOmissionCorrections === 3, "Expected three source omission corrections.");
assert(counts.remainingRoutingHolds === 0, "A routing hold remains.");
assert(counts.approvedBeforeRouting === 194, "Pre-routing approval count drifted.");
assert(counts.routingResolvedForPackaging === 14, "Routing-resolved packaging count drifted.");
assert(counts.packagingQueueRecords === 208, "Packaging queue count drifted.");
assert(counts.remainingHeldRecords === 35, "Remaining hold count drifted.");
assert(counts.excludedNonStandalone === 8, "Excluded row count drifted.");
assert(counts.packagingQueueRecords + counts.remainingHeldRecords + counts.excludedNonStandalone === 251, "Phase 5D accounting does not total 251.");

assert(freeze.sourceFreeze.previewRecordsSha256 === "7d3224666ffd1cae073cac3ed6a8bc270aa2f0e843f130f49bcd4b7fa936ff05", "Source preview hash drifted.");
assert(freeze.sourceFreeze.freezeRecordsSha256 === phase5C.freezeRecordsSha256, "Phase 5C freeze-record hash drifted.");
assert(freeze.sourceFreeze.decisionsManifestSha256 === phase5C.decisionsManifestSha256, "Phase 5C decisions hash drifted.");
assert(freeze.sourceFreeze.phase5CFreezeSha256 === sha256(phase5CBytes), "Phase 5C file hash mismatch.");
assert(freeze.routingManifestSha256 === sha256(routingBytes), "Routing manifest hash mismatch.");
assert(freeze.routeRecordsSha256 === sha256(Buffer.from(stable(freeze.records))), "Routing records hash mismatch.");

assert(new Set(freeze.sourceRouteEdges.map((edge) => edge.assetId)).size === freeze.sourceRouteEdges.length, "Duplicate source asset route.");
assert(new Set([...freeze.sourceRouteEdges, ...freeze.supplementalRouteEdges].map((edge) => edge.routeId)).size === counts.totalRouteEdges, "Duplicate route ID.");
assert(freeze.sourceRouteEdges.every((edge) =>
  edge.routingStatus === "resolved" || edge.routingStatus === "corrected-routing"
), "Unresolved source route.");
assert(freeze.supplementalRouteEdges.every((edge) => edge.routingStatus === "resolved"), "Unresolved supplemental route.");
assert(freeze.records.filter((record) => record.phase5CDecision === "hold-routing").length === 0, "Routing hold remains in records.");
assert(freeze.records.filter((record) => record.phase5CDecision === "routing-resolved-for-packaging").length === 14, "Routing resolution count drifted.");

const hardenedCorrection = freeze.sourceRouteEdges.filter((edge) =>
  edge.sourceTradeId === "BKN-2021-0223" &&
  edge.routingStatus === "corrected-routing" &&
  edge.fromTeam === "cleveland-cavaliers" &&
  edge.toTeam === "indiana-pacers"
);
assert(hardenedCorrection.length === 1, "Revised Harden pick routing correction is missing.");

const omissions = freeze.supplementalRouteEdges.filter((edge) => edge.supplementalKind === "source-omission-correction");
assert(omissions.length === 3, "Source omission correction count drifted.");
assert(
  new Set(omissions.map((edge) => edge.sourceTradeId)).size === 3,
  "Source omission corrections are not distributed across three transactions."
);

assert(freeze.records.every((record) =>
  record.indexEligible === false &&
  record.adEligible === false &&
  record.publicationReady === false &&
  record.publicationAuthorized === false &&
  record.automaticMergeAuthorized === false
), "A Phase 5D record escaped private/no-merge policy.");

for (const key of [
  "canonicalImports",
  "playerImports",
  "relationshipWrites",
  "routeDataWrites",
  "teamRegistryWrites",
  "automaticMerges",
]) assert(freeze[key] === 0, `${key} is not zero.`);
assert(freeze.publicationAuthorized === false, "Publication was authorized.");
assert(freeze.pushPerformed === false, "Push was performed.");
assert(freeze.deployPerformed === false, "Deployment was performed.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "5D",
  verified: {
    sourceRows: counts.sourceRows,
    routedTransactions: counts.routedTransactions,
    routedSourceAssets: counts.routedSourceAssets,
    supplementalRoutes: counts.supplementalRoutes,
    totalRouteEdges: counts.totalRouteEdges,
    sourceRouteCorrections: counts.sourceRouteCorrections,
    sourceOmissionCorrections: counts.sourceOmissionCorrections,
    remainingRoutingHolds: counts.remainingRoutingHolds,
    packagingQueueRecords: counts.packagingQueueRecords,
    remainingHeldRecords: counts.remainingHeldRecords,
    excludedNonStandalone: counts.excludedNonStandalone,
  },
  routingManifestSha256: freeze.routingManifestSha256,
  routeRecordsSha256: freeze.routeRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
}, null, 2));
