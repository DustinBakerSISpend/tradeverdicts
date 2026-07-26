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
function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function sortedUnique(values) {
  return [...new Set((values ?? []).map(clean).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right, "en"),
  );
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
  "matrix-json",
  "reviewed-json",
  "expected-decision-records-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [matrixBytes, reviewedBytes] = await Promise.all([
  readFile(args["matrix-json"]),
  readFile(args["reviewed-json"]),
]);
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(matrix.result === "PASS" && matrix.phase === "8C", "Invalid Phase 8C matrix.");
assert(reviewed.result === "PASS" && reviewed.phase === "8A", "Invalid Phase 8A reviewed source.");
assert(Array.isArray(matrix.decisions) && matrix.decisions.length === 204, "Expected 204 decision records.");
assert(Array.isArray(reviewed.records) && reviewed.records.length === 204, "Expected 204 reviewed records.");
assert(
  matrix.hashes.decisionRecordsSha256 === args["expected-decision-records-sha"],
  "Phase 8C decision-record hash differs from the frozen checkpoint.",
);
assert(
  sha256(JSON.stringify(matrix.decisions)) === args["expected-decision-records-sha"],
  "Phase 8C decision-record hash recomputation failed.",
);

const reviewedById = new Map(
  reviewed.records.map((record) => [record.sourceTradeId, record]),
);
assert(reviewedById.size === 204, "Duplicate reviewed source-trade ID.");

const routeRecords = [];
const freezeRecords = [];

for (const decision of matrix.decisions) {
  const reviewedRecord = reviewedById.get(decision.sourceTradeId);
  assert(reviewedRecord, `${decision.sourceTradeId}: reviewed source row is missing.`);

  const isRoutingCandidate =
    decision.routingCandidate === true &&
    decision.resolutionClass === "routing-candidate";

  if (isRoutingCandidate) {
    assert(decision.routingRequired === true, `${decision.sourceTradeId}: routing candidate is not routing-required.`);
    assert(
      reviewedRecord.routingRequired === true,
      `${decision.sourceTradeId}: reviewed routing flag drifted.`,
    );
    assert(
      reviewedRecord.explicitEdgeReview === "Complete",
      `${decision.sourceTradeId}: explicit edge review is incomplete.`,
    );
    assert(
      clean(reviewedRecord.canonicalRoutingNotes).length >= 40,
      `${decision.sourceTradeId}: canonical routing notes are incomplete.`,
    );
    assert(
      Array.isArray(reviewedRecord.partnerTeams) &&
        reviewedRecord.partnerTeams.length >= 2,
      `${decision.sourceTradeId}: multi-team partner set is incomplete.`,
    );
    assert(
      Array.isArray(reviewedRecord.assetsReceived) &&
        Array.isArray(reviewedRecord.assetsSent) &&
        reviewedRecord.assetsReceived.length + reviewedRecord.assetsSent.length > 0,
      `${decision.sourceTradeId}: Cavaliers-facing asset package is empty.`,
    );
    assert(
      decision.blockers.length === 1 &&
        decision.blockers[0] === "explicit-routing-required",
      `${decision.sourceTradeId}: routing candidate carries an unexpected blocker.`,
    );

    routeRecords.push({
      routeKey: `cleveland-cavaliers:${decision.sourceTradeId}:phase-8d`,
      sourceTradeId: decision.sourceTradeId,
      sourceRow: decision.sourceRow,
      tradeDate: decision.tradeDate,
      sourceTeam: "cleveland-cavaliers",
      partnerTeams: sortedUnique(reviewedRecord.partnerTeams),
      declaredTeamCount: reviewedRecord.declaredTeamCount,
      assetsReceived: [...reviewedRecord.assetsReceived],
      assetsSent: [...reviewedRecord.assetsSent],
      explicitEdgeReview: reviewedRecord.explicitEdgeReview,
      canonicalRoutingNotes: reviewedRecord.canonicalRoutingNotes,
      routingBasis: "reviewed-cavaliers-facing-route",
      routingStatus: "frozen",
      advanceToPackaging: true,
      automaticRoute: false,
      routeDataWrite: false,
      canonicalImport: false,
      playerImport: false,
      relationshipWrite: false,
    });
  }

  const finalPackagingReady =
    decision.directPackagingCandidate === true || isRoutingCandidate;

  freezeRecords.push({
    sourceTradeId: decision.sourceTradeId,
    sourceRow: decision.sourceRow,
    tradeDate: decision.tradeDate,
    teams: [...decision.teams],
    partnerTeams: [...decision.partnerTeams],
    verdict: decision.verdict,
    contentClass: decision.contentClass,
    databaseStatus: decision.databaseStatus,
    archiveImportReady: decision.archiveImportReady,
    routingRequired: decision.routingRequired,
    routingCandidate: isRoutingCandidate,
    routeFrozen: isRoutingCandidate,
    directPackagingCandidate: decision.directPackagingCandidate,
    newlyAdvancedByRouting: isRoutingCandidate,
    finalPackagingReady,
    remainingHeld: !finalPackagingReady,
    finalStatus:
      decision.directPackagingCandidate === true
        ? "packaging-ready-before-routing"
        : isRoutingCandidate
          ? "packaging-ready-after-routing"
          : decision.nextAction,
    priorResolutionClass: decision.resolutionClass,
    priorBlockers: [...decision.blockers],
    automaticMerge: false,
    automaticRoute: false,
    canonicalImport: false,
    playerImport: false,
    relationshipWrite: false,
    routeDataWrite: false,
  });
}

routeRecords.sort(
  (left, right) =>
    Number(left.sourceRow) - Number(right.sourceRow) ||
    left.sourceTradeId.localeCompare(right.sourceTradeId, "en"),
);
freezeRecords.sort(
  (left, right) =>
    Number(left.sourceRow) - Number(right.sourceRow) ||
    left.sourceTradeId.localeCompare(right.sourceTradeId, "en"),
);

const packagingQueue = freezeRecords.filter((record) => record.finalPackagingReady);
const remainingHolds = freezeRecords.filter((record) => record.remainingHeld);
const routingRequiredLedger = freezeRecords.filter((record) => record.routingRequired);
const archiveReady = freezeRecords.filter((record) => record.archiveImportReady);
const archiveReadyPackaging = archiveReady.filter((record) => record.finalPackagingReady);
const archiveReadyHeld = archiveReady.filter((record) => record.remainingHeld);

const counts = {
  sourceRows: freezeRecords.length,
  phase8CDirectPackagingRows: matrix.counts.directPackagingCandidateRows,
  phase8CBlockedOrReconciliationRows: matrix.counts.blockedOrReconciliationRows,
  routingRequiredRows: matrix.counts.routingRequiredRows,
  routingCandidateRows: matrix.counts.routingCandidateRows,
  routesFrozen: routeRecords.length,
  newlyAdvancedByRouting: freezeRecords.filter(
    (record) => record.newlyAdvancedByRouting,
  ).length,
  packagingQueueRows: packagingQueue.length,
  remainingHeldRows: remainingHolds.length,
  nonCandidateRoutingRows: routingRequiredLedger.filter(
    (record) => !record.routingCandidate,
  ).length,
  archiveImportReadyRows: archiveReady.length,
  archiveReadyPackagingRows: archiveReadyPackaging.length,
  archiveReadyHeldRows: archiveReadyHeld.length,
  finalStatusCounts: countBy(freezeRecords.map((record) => record.finalStatus)),
  remainingHoldResolutionCounts: countBy(
    remainingHolds.map((record) => record.priorResolutionClass),
  ),
};

assert(counts.sourceRows === 204, "Source-row count drifted.");
assert(counts.phase8CDirectPackagingRows === 133, "Phase 8C direct packaging count drifted.");
assert(counts.phase8CBlockedOrReconciliationRows === 71, "Phase 8C held count drifted.");
assert(counts.routingRequiredRows === 24, "Routing-required count drifted.");
assert(counts.routingCandidateRows === 17, "Routing-candidate count drifted.");
assert(counts.routesFrozen === 17, "Route-freeze count drifted.");
assert(counts.newlyAdvancedByRouting === 17, "Newly advanced routing count drifted.");
assert(counts.packagingQueueRows === 150, "Packaging queue count drifted.");
assert(counts.remainingHeldRows === 54, "Remaining-held count drifted.");
assert(counts.nonCandidateRoutingRows === 7, "Non-candidate routing count drifted.");
assert(counts.archiveImportReadyRows === 6, "Archive-ready count drifted.");
assert(
  counts.archiveReadyPackagingRows + counts.archiveReadyHeldRows === 6,
  "Archive-ready partition does not close.",
);
assert(
  counts.packagingQueueRows + counts.remainingHeldRows === 204,
  "Final routing partition does not close.",
);
assert(
  counts.packagingQueueRows ===
    counts.phase8CDirectPackagingRows + counts.newlyAdvancedByRouting,
  "Packaging queue does not equal direct candidates plus newly routed records.",
);
assert(
  routeRecords.every(
    (record) =>
      record.routingStatus === "frozen" &&
      record.advanceToPackaging === true &&
      record.automaticRoute === false &&
      record.routeDataWrite === false &&
      record.canonicalImport === false &&
      record.playerImport === false &&
      record.relationshipWrite === false,
  ),
  "A routing record enabled a forbidden action.",
);
assert(
  freezeRecords.every(
    (record) =>
      record.automaticMerge === false &&
      record.automaticRoute === false &&
      record.canonicalImport === false &&
      record.playerImport === false &&
      record.relationshipWrite === false &&
      record.routeDataWrite === false,
  ),
  "A freeze record enabled a forbidden action.",
);

const hashes = {
  routeRecordsSha256: sha256(JSON.stringify(routeRecords)),
  freezeRecordsSha256: sha256(JSON.stringify(freezeRecords)),
  packagingQueueSha256: sha256(JSON.stringify(packagingQueue)),
  remainingHoldsSha256: sha256(JSON.stringify(remainingHolds)),
  routingRequiredLedgerSha256: sha256(JSON.stringify(routingRequiredLedger)),
  archiveReadyPartitionSha256: sha256(
    JSON.stringify({
      all: archiveReady,
      packaging: archiveReadyPackaging,
      held: archiveReadyHeld,
    }),
  ),
  decisionRecordsSha256: matrix.hashes.decisionRecordsSha256,
  reviewedRecordsSha256: reviewed.recordsSha256,
};

const freeze = {
  result: "PASS",
  phase: "8D",
  mode: "CLEVELAND_MULTI_TEAM_ROUTING_FREEZE",
  sourceTeam: "cleveland-cavaliers",
  counts,
  hashes,
  routeRecords,
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

const flatten = (records) =>
  records.map((record) => ({
    ...record,
    teams: Array.isArray(record.teams) ? record.teams.join(" | ") : "",
    partnerTeams: Array.isArray(record.partnerTeams)
      ? record.partnerTeams.join(" | ")
      : "",
    assetsReceived: Array.isArray(record.assetsReceived)
      ? record.assetsReceived.join(" || ")
      : "",
    assetsSent: Array.isArray(record.assetsSent)
      ? record.assetsSent.join(" || ")
      : "",
    priorBlockers: Array.isArray(record.priorBlockers)
      ? record.priorBlockers.join(" | ")
      : "",
  }));

const routeHeaders = [
  "routeKey","sourceTradeId","sourceRow","tradeDate","sourceTeam",
  "partnerTeams","declaredTeamCount","assetsReceived","assetsSent",
  "explicitEdgeReview","canonicalRoutingNotes","routingBasis",
  "routingStatus","advanceToPackaging","automaticRoute","routeDataWrite",
];
const freezeHeaders = [
  "sourceTradeId","sourceRow","tradeDate","teams","partnerTeams","verdict",
  "contentClass","databaseStatus","archiveImportReady","routingRequired",
  "routingCandidate","routeFrozen","directPackagingCandidate",
  "newlyAdvancedByRouting","finalPackagingReady","remainingHeld",
  "finalStatus","priorResolutionClass","priorBlockers","automaticMerge",
  "automaticRoute","canonicalImport","playerImport","relationshipWrite",
  "routeDataWrite",
];

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const files = {
  freeze: "cleveland-cavaliers-phase-8d-routing-freeze.json",
  routes: "cleveland-cavaliers-phase-8d-route-records.csv",
  all: "cleveland-cavaliers-phase-8d-all-freeze-records.csv",
  packaging: "cleveland-cavaliers-phase-8d-packaging-queue.csv",
  holds: "cleveland-cavaliers-phase-8d-remaining-holds.csv",
  routingLedger: "cleveland-cavaliers-phase-8d-routing-required-ledger.csv",
  summary: "cleveland-cavaliers-phase-8d-summary.json",
};

await Promise.all([
  writeFile(path.join(outputDir, files.freeze), JSON.stringify(freeze, null, 2) + "\n"),
  writeFile(path.join(outputDir, files.routes), toCsv(flatten(routeRecords), routeHeaders)),
  writeFile(path.join(outputDir, files.all), toCsv(flatten(freezeRecords), freezeHeaders)),
  writeFile(path.join(outputDir, files.packaging), toCsv(flatten(packagingQueue), freezeHeaders)),
  writeFile(path.join(outputDir, files.holds), toCsv(flatten(remainingHolds), freezeHeaders)),
  writeFile(path.join(outputDir, files.routingLedger), toCsv(flatten(routingRequiredLedger), freezeHeaders)),
  writeFile(
    path.join(outputDir, files.summary),
    JSON.stringify({
      result: "PASS",
      phase: "8D",
      counts,
      hashes,
      canonicalImports: 0,
      playerImports: 0,
      teamRegistryWrites: 0,
      relationshipWrites: 0,
      routeDataWrites: 0,
      automaticMerges: 0,
      automaticRoutes: 0,
      publicationAuthorized: false,
    }, null, 2) + "\n",
  ),
]);

console.log(JSON.stringify({
  result: freeze.result,
  phase: freeze.phase,
  mode: freeze.mode,
  counts: freeze.counts,
  hashes: freeze.hashes,
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
