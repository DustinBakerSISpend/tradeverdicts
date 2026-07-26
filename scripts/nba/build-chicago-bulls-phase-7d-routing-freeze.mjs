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
function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
}
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}
function toCsv(rows, headers) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

const args = parseArgs(process.argv);
for (const required of [
  "decision-json",
  "reviewed-json",
  "routing-json",
  "contract-md",
  "expected-decision-records-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [decisionBytes, reviewedBytes, routingBytes, contractBytes] =
  await Promise.all([
    readFile(args["decision-json"]),
    readFile(args["reviewed-json"]),
    readFile(args["routing-json"]),
    readFile(args["contract-md"]),
  ]);

const decision = JSON.parse(decisionBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));

assert(decision.result === "PASS" && decision.phase === "7C", "Invalid Phase 7C decision manifest.");
assert(reviewed.result === "PASS" && reviewed.phase === "7A", "Invalid reviewed batch.");
assert(routing.result === "PASS" && routing.phase === "7D", "Invalid routing specification.");
assert(Array.isArray(decision.decisions) && decision.decisions.length === 219, "Expected 219 decisions.");
assert(Array.isArray(reviewed.records) && reviewed.records.length === 219, "Expected 219 reviewed rows.");
assert(Array.isArray(routing.transactions) && routing.transactions.length === 15, "Expected 15 routing transactions.");
assert(
  decision.decisionRecordsSha256 === args["expected-decision-records-sha"],
  "Phase 7C decision-record hash differs from the frozen checkpoint.",
);
assert(
  sha256(JSON.stringify(decision.decisions)) === args["expected-decision-records-sha"],
  "Phase 7C decision records fail hash recomputation.",
);
assert(
  sha256(JSON.stringify(routing.transactions)) === routing.transactionsSha256,
  "Routing-transaction hash drifted.",
);
const routeEdges = routing.transactions.flatMap((record) => record.bullsFacingRouteEdges);
assert(
  sha256(JSON.stringify(routeEdges)) === routing.routeEdgesSha256,
  "Route-edge hash drifted.",
);

const reviewedById = new Map(
  reviewed.records.map((record) => [record.sourceTradeId, record]),
);
const routingById = new Map(
  routing.transactions.map((record) => [record.sourceTradeId, record]),
);
assert(routingById.size === 15, "Routing source IDs are not unique.");

for (const route of routing.transactions) {
  const reviewedRecord = reviewedById.get(route.sourceTradeId);
  assert(reviewedRecord, `${route.sourceTradeId}: reviewed row is missing.`);
  assert(reviewedRecord.routingRequired === true, `${route.sourceTradeId}: reviewed routing flag drifted.`);
  assert(route.routingComplete === true, `${route.sourceTradeId}: routing is incomplete.`);
  assert(route.automaticRoute === false, `${route.sourceTradeId}: automatic route enabled.`);
  assert(route.routeDataWrite === false, `${route.sourceTradeId}: route-data write enabled.`);
  assert(
    JSON.stringify(route.sourceAssetsReceived) === JSON.stringify(reviewedRecord.assetsReceived),
    `${route.sourceTradeId}: received assets differ from reviewed source.`,
  );
  assert(
    JSON.stringify(route.sourceAssetsSent) === JSON.stringify(reviewedRecord.assetsSent),
    `${route.sourceTradeId}: sent assets differ from reviewed source.`,
  );
  assert(
    route.routingNarrative === reviewedRecord.canonicalRoutingNotes,
    `${route.sourceTradeId}: routing narrative drifted.`,
  );
  assert(
    Array.isArray(route.bullsFacingRouteEdges) &&
      route.bullsFacingRouteEdges.length >= 2,
    `${route.sourceTradeId}: Bulls-facing route edges are incomplete.`,
  );
  for (const edge of route.bullsFacingRouteEdges) {
    assert(edge.bullsFacing === true, `${route.sourceTradeId}: non-Bulls edge in Bulls route list.`);
    assert(edge.fromTeam && edge.toTeam, `${route.sourceTradeId}: route endpoint is missing.`);
    assert(edge.fromTeam === "chicago-bulls" || edge.toTeam === "chicago-bulls", `${route.sourceTradeId}: route does not touch Chicago.`);
  }
}

const freezeRecords = decision.decisions.map((record) => {
  const route = routingById.get(record.sourceTradeId) ?? null;
  if (record.routingRequired) {
    assert(route, `${record.sourceTradeId}: routing-required decision lacks routing spec.`);
  } else {
    assert(!route, `${record.sourceTradeId}: non-routing decision has routing spec.`);
  }

  const blockersBefore = [...record.blockers];
  const blockersAfter = blockersBefore.filter(
    (blocker) => blocker !== "explicit-routing-required",
  );
  const newlyAdvancedByRouting =
    record.nextPhaseCandidate === false &&
    record.routingRequired === true &&
    route?.routingComplete === true &&
    blockersAfter.length === 0 &&
    record.mergeExclude === false;

  const packagingReady =
    record.nextPhaseCandidate === true || newlyAdvancedByRouting;

  let finalRoutingStatus = "not-required";
  if (record.routingRequired) {
    finalRoutingStatus = route?.routingComplete
      ? "routing-frozen"
      : "routing-incomplete";
  }

  let finalStatus = "held-after-routing";
  if (record.mergeExclude) {
    finalStatus = "excluded-linked-followup";
  } else if (packagingReady) {
    finalStatus = newlyAdvancedByRouting
      ? "advanced-by-routing"
      : "ready-before-routing";
  }

  return {
    sourceTradeId: record.sourceTradeId,
    sourceRow: record.sourceRow,
    tradeDate: record.tradeDate,
    teams: record.teams,
    declaredTeamCount: record.declaredTeamCount,
    verdict: record.verdict,
    contentClass: record.contentClass,
    databaseStatus: record.databaseStatus,
    resolutionClass: record.resolutionClass,
    routingRequired: record.routingRequired,
    routingSpecPresent: Boolean(route),
    routingComplete: route?.routingComplete ?? false,
    routeEdgeCount: route?.bullsFacingRouteEdges.length ?? 0,
    blockersBeforeRouting: blockersBefore,
    blockersAfterRouting: blockersAfter,
    phase7cNextPhaseCandidate: record.nextPhaseCandidate,
    newlyAdvancedByRouting,
    packagingReady,
    mergeExclude: record.mergeExclude,
    parentTradeId: record.parentTradeId,
    finalRoutingStatus,
    finalStatus,
    automaticMerge: false,
    automaticRoute: false,
    canonicalImport: false,
    playerImport: false,
    relationshipWrite: false,
    routeDataWrite: false,
  };
});

const packagingQueue = freezeRecords.filter((record) => record.packagingReady);
const remainingHolds = freezeRecords.filter(
  (record) => !record.packagingReady && !record.mergeExclude,
);
const excluded = freezeRecords.filter((record) => record.mergeExclude);
const routingHolds = freezeRecords.filter((record) => record.routingRequired);
const newlyAdvanced = freezeRecords.filter(
  (record) => record.newlyAdvancedByRouting,
);

const counts = {
  sourceRows: freezeRecords.length,
  phase7cNextPhaseCandidates: decision.counts.nextPhaseCandidateRows,
  phase7cBlockedOrReconciliationRows: decision.counts.blockedOrReconciliationRows,
  routingHoldTransactions: routingHolds.length,
  routedTransactions: routingHolds.filter((record) => record.routingComplete).length,
  remainingRoutingHolds: routingHolds.filter((record) => !record.routingComplete).length,
  bullsFacingRouteEdges: routeEdges.length,
  newlyAdvancedByRouting: newlyAdvanced.length,
  packagingQueueRecords: packagingQueue.length,
  remainingHeldRecords: remainingHolds.length,
  excludedNonStandalone: excluded.length,
  archiveImportReadyRows: decision.counts.archiveImportReadyRows,
  finalStatusCounts: countBy(freezeRecords.map((record) => record.finalStatus)),
  remainingBlockerCounts: countBy(
    remainingHolds.flatMap((record) => record.blockersAfterRouting),
  ),
};

assert(counts.sourceRows === 219, "Source-row count drifted.");
assert(counts.phase7cNextPhaseCandidates === 177, "Phase 7C candidate count drifted.");
assert(counts.phase7cBlockedOrReconciliationRows === 42, "Phase 7C held count drifted.");
assert(counts.routingHoldTransactions === 15, "Routing-hold count drifted.");
assert(counts.routedTransactions === 15, "Not every routing transaction was frozen.");
assert(counts.remainingRoutingHolds === 0, "A routing transaction remains unresolved.");
assert(counts.excludedNonStandalone === 7, "Excluded non-standalone count drifted.");
assert(counts.archiveImportReadyRows === 15, "Archive-import-ready count drifted.");
assert(
  counts.packagingQueueRecords ===
    counts.phase7cNextPhaseCandidates + counts.newlyAdvancedByRouting,
  "Packaging queue does not equal prior candidates plus routing advancements.",
);
assert(
  counts.packagingQueueRecords +
    counts.remainingHeldRecords +
    counts.excludedNonStandalone === 219,
  "Final routing partition does not close.",
);
assert(freezeRecords.every((record) => record.automaticMerge === false), "Automatic merge enabled.");
assert(freezeRecords.every((record) => record.automaticRoute === false), "Automatic route enabled.");
assert(freezeRecords.every((record) => record.canonicalImport === false), "Canonical import occurred.");
assert(freezeRecords.every((record) => record.routeDataWrite === false), "Route-data write occurred.");

const freezeRecordsSha256 = sha256(JSON.stringify(freezeRecords));
const manifest = {
  result: "PASS",
  phase: "7D",
  mode: "MULTI_TEAM_ROUTING_FREEZE",
  sourceTeam: "chicago-bulls",
  counts,
  routingTransactionsSha256: routing.transactionsSha256,
  routeEdgesSha256: routing.routeEdgesSha256,
  freezeRecordsSha256,
  sourceHashes: {
    decisionJsonSha256: sha256(decisionBytes),
    reviewedJsonSha256: sha256(reviewedBytes),
    routingJsonSha256: sha256(routingBytes),
    contractSha256: sha256(contractBytes),
    phase7CDecisionRecordsSha256: decision.decisionRecordsSha256,
  },
  freezeRecords,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const headers = [
  "sourceTradeId", "sourceRow", "tradeDate", "teams", "declaredTeamCount",
  "verdict", "contentClass", "databaseStatus", "resolutionClass",
  "routingRequired", "routingSpecPresent", "routingComplete", "routeEdgeCount",
  "blockersBeforeRouting", "blockersAfterRouting",
  "phase7cNextPhaseCandidate", "newlyAdvancedByRouting", "packagingReady",
  "mergeExclude", "parentTradeId", "finalRoutingStatus", "finalStatus",
  "automaticMerge", "automaticRoute",
];
function csvRows(records) {
  return records.map((record) => ({
    ...record,
    teams: record.teams.join(" | "),
    blockersBeforeRouting: record.blockersBeforeRouting.join(" | "),
    blockersAfterRouting: record.blockersAfterRouting.join(" | "),
  }));
}

await Promise.all([
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7d-routing-freeze.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7d-route-edges.csv"),
    toCsv(routeEdges, [
      "routeEdgeId", "asset", "direction", "fromTeam", "toTeam", "bullsFacing",
    ]),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7d-transaction-routing.csv"),
    toCsv(
      routing.transactions.map((record) => ({
        ...record,
        teams: record.teams.join(" | "),
        sourceAssetsReceived: record.sourceAssetsReceived.join(" || "),
        sourceAssetsSent: record.sourceAssetsSent.join(" || "),
        partnerOnlyLegs: record.partnerOnlyLegs.join(" || "),
        routeEdgeCount: record.bullsFacingRouteEdges.length,
      })),
      [
        "sourceTradeId", "tradeDate", "teams", "declaredTeamCount",
        "sourceAssetsReceived", "sourceAssetsSent", "routingNarrative",
        "partnerOnlyLegs", "routeEdgeCount", "routingStatus",
        "routingComplete", "automaticRoute", "routeDataWrite",
      ],
    ),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7d-packaging-queue.csv"),
    toCsv(csvRows(packagingQueue), headers),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7d-newly-advanced-by-routing.csv"),
    toCsv(csvRows(newlyAdvanced), headers),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7d-remaining-holds.csv"),
    toCsv(csvRows(remainingHolds), headers),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7d-excluded-followups.csv"),
    toCsv(csvRows(excluded), headers),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7d-summary.json"),
    JSON.stringify({
      result: "PASS",
      phase: "7D",
      counts,
      routingTransactionsSha256: routing.transactionsSha256,
      routeEdgesSha256: routing.routeEdgesSha256,
      freezeRecordsSha256,
      canonicalImports: 0,
      playerImports: 0,
      relationshipWrites: 0,
      routeDataWrites: 0,
      automaticMerges: 0,
      automaticRoutes: 0,
    }, null, 2) + "\n",
  ),
]);

console.log(JSON.stringify({
  result: "PASS",
  phase: "7D",
  counts,
  routingTransactionsSha256: routing.transactionsSha256,
  routeEdgesSha256: routing.routeEdgesSha256,
  freezeRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
