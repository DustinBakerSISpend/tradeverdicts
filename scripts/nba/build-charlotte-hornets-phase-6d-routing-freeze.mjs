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
function unique(values) {
  return [...new Set(values)];
}
function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}
function toCsv(rows, fallbackHeaders) {
  const headers = rows.length ? Object.keys(rows[0]) : fallbackHeaders;
  assert(headers.length > 0, "CSV headers are unavailable.");
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}
function slug(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "asset";
}
function edgeKey(tradeId, edge, index) {
  return `${tradeId}:${String(index + 1).padStart(3, "0")}:${slug(edge.fromTeam)}:${slug(edge.toTeam)}:${slug(edge.asset)}`;
}

const args = parseArgs(process.argv);
for (const required of [
  "decision-json",
  "preview-json",
  "routing-json",
  "contract-md",
  "expected-decision-records-sha",
  "expected-preview-records-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}`);
}

const [decisionBytes, previewBytes, routingBytes, contractBytes] = await Promise.all([
  readFile(args["decision-json"]),
  readFile(args["preview-json"]),
  readFile(args["routing-json"]),
  readFile(args["contract-md"]),
]);

const decision = JSON.parse(decisionBytes.toString("utf8"));
const preview = JSON.parse(previewBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));

assert(decision.result === "PASS", "Phase 6C decision matrix did not pass.");
assert(decision.phase === "6C", "Unexpected decision phase.");
assert(
  decision.decisionRecordsSha256 === args["expected-decision-records-sha"],
  "Phase 6C decision-record hash does not match the frozen checkpoint.",
);
assert(
  sha256(JSON.stringify(decision.records)) === decision.decisionRecordsSha256,
  "Phase 6C decision records do not match their declared hash.",
);
assert(preview.result === "PASS", "Phase 6B preview did not pass.");
assert(preview.phase === "6B", "Unexpected preview phase.");
assert(
  preview.hashes.previewRecordsSha256 === args["expected-preview-records-sha"],
  "Phase 6B preview-record hash does not match the frozen checkpoint.",
);
assert(routing.schemaVersion === 1, "Unexpected routing schema.");
assert(routing.phase === "6D", "Unexpected routing phase.");
assert(routing.sourceTeam === "charlotte-hornets", "Unexpected routing source team.");
assert(
  routing.decisionRecordsSha256 === decision.decisionRecordsSha256,
  "Routing spec decision hash drifted.",
);
assert(
  routing.previewRecordsSha256 === preview.hashes.previewRecordsSha256,
  "Routing spec preview hash drifted.",
);
assert(Array.isArray(decision.records) && decision.records.length === 125, "Expected 125 decision rows.");
assert(Array.isArray(routing.routingTransactions), "Routing transactions are unavailable.");
assert(routing.routingTransactions.length === 10, "Expected exactly 10 routing transactions.");

const decisionById = new Map(decision.records.map((record) => [record.tradeId, record]));
assert(decisionById.size === 125, "Duplicate decision trade IDs.");

const expectedRoutingIds = new Set(
  decision.records.filter((record) => record.routingRequired).map((record) => record.tradeId),
);
assert(expectedRoutingIds.size === 10, "Phase 6C routing-required count drifted.");
const routingIds = routing.routingTransactions.map((transaction) => transaction.tradeId);
assert(new Set(routingIds).size === routingIds.length, "Duplicate routing transaction IDs.");
assert(
  JSON.stringify([...new Set(routingIds)].sort()) ===
    JSON.stringify([...expectedRoutingIds].sort()),
  "Routing spec does not exactly cover the Phase 6C routing holds.",
);

const routeEdges = [];
const corrections = [];
const supplementalContext = [];
const transactionSummaries = [];

for (const transaction of routing.routingTransactions) {
  const source = decisionById.get(transaction.tradeId);
  assert(source, `Routing transaction missing from Phase 6C: ${transaction.tradeId}.`);
  assert(source.routingRequired === true, `${transaction.tradeId} was not a routing hold.`);
  assert(source.tradeDate === transaction.tradeDate, `${transaction.tradeId} date mismatch.`);
  assert(
    Array.isArray(transaction.participants) &&
      transaction.participants.includes("charlotte-hornets") &&
      transaction.participants.length === source.teamCount,
    `${transaction.tradeId} participant accounting mismatch.`,
  );
  assert(Array.isArray(transaction.sourceEdges) && transaction.sourceEdges.length > 0, `${transaction.tradeId} lacks source edges.`);
  assert(
    transaction.sourceEdges.every(
      (edge) =>
        edge.fromTeam === "charlotte-hornets" ||
        edge.toTeam === "charlotte-hornets",
    ),
    `${transaction.tradeId} source edge does not touch Charlotte.`,
  );
  assert(
    transaction.sourceEdges.some((edge) => edge.fromTeam === "charlotte-hornets"),
    `${transaction.tradeId} lacks a Charlotte outgoing edge.`,
  );
  assert(
    transaction.sourceEdges.some((edge) => edge.toTeam === "charlotte-hornets"),
    `${transaction.tradeId} lacks a Charlotte incoming edge.`,
  );

  const combined = [
    ...transaction.sourceEdges.map((edge) => ({ ...edge, edgeClass: "charlotte-source-route" })),
    ...(transaction.supplementalEdges ?? []).map((edge) => ({ ...edge, edgeClass: "supplemental-partner-route" })),
  ];

  const localKeys = new Set();
  combined.forEach((edge, index) => {
    assert(transaction.participants.includes(edge.fromTeam), `${transaction.tradeId}: unknown fromTeam ${edge.fromTeam}.`);
    assert(transaction.participants.includes(edge.toTeam), `${transaction.tradeId}: unknown toTeam ${edge.toTeam}.`);
    assert(edge.fromTeam !== edge.toTeam, `${transaction.tradeId}: self-route found.`);
    assert(edge.assetType && edge.asset, `${transaction.tradeId}: incomplete edge.`);
    const key = edgeKey(transaction.tradeId, edge, index);
    assert(!localKeys.has(`${edge.fromTeam}|${edge.toTeam}|${edge.assetType}|${edge.asset}`), `${transaction.tradeId}: duplicate edge.`);
    localKeys.add(`${edge.fromTeam}|${edge.toTeam}|${edge.assetType}|${edge.asset}`);
    routeEdges.push({
      routeEdgeId: key,
      tradeId: transaction.tradeId,
      tradeDate: transaction.tradeDate,
      edgeClass: edge.edgeClass,
      fromTeam: edge.fromTeam,
      toTeam: edge.toTeam,
      assetType: edge.assetType,
      asset: edge.asset,
      frozen: true,
      importAuthorized: false,
    });
  });

  for (const correction of transaction.corrections ?? []) {
    corrections.push({
      tradeId: transaction.tradeId,
      tradeDate: transaction.tradeDate,
      kind: correction.kind,
      detail: correction.detail,
      appliedToRoutingFreeze: true,
      canonicalStoreWrite: false,
    });
  }
  for (const sourceRef of transaction.sources ?? []) {
    supplementalContext.push({
      tradeId: transaction.tradeId,
      tradeDate: transaction.tradeDate,
      contextType: "source-reference",
      label: sourceRef.label,
      value: sourceRef.url,
    });
  }
  supplementalContext.push({
    tradeId: transaction.tradeId,
    tradeDate: transaction.tradeDate,
    contextType: "participant-set",
    label: "participants",
    value: transaction.participants.join(" | "),
  });

  transactionSummaries.push({
    tradeId: transaction.tradeId,
    tradeDate: transaction.tradeDate,
    teamCount: transaction.participants.length,
    sourceRouteEdges: transaction.sourceEdges.length,
    supplementalRouteEdges: (transaction.supplementalEdges ?? []).length,
    totalRouteEdges: combined.length,
    corrections: (transaction.corrections ?? []).length,
    routeStatus: "resolved-and-frozen",
    remainingRoutingHold: false,
  });
}

const routeIds = new Set(routeEdges.map((edge) => edge.routeEdgeId));
assert(routeIds.size === routeEdges.length, "Duplicate route-edge IDs.");
assert(routeEdges.filter((edge) => edge.edgeClass === "charlotte-source-route").length > 0, "No Charlotte route edges.");
assert(routeEdges.filter((edge) => edge.edgeClass === "supplemental-partner-route").length > 0, "No supplemental route edges.");

const updatedDecisions = decision.records.map((record) => {
  const routed = expectedRoutingIds.has(record.tradeId);
  let blockers = [...record.blockers];
  if (routed) blockers = blockers.filter((blocker) => blocker !== "explicit-routing-required");

  if (
    record.resolutionClass === "new-canonical-candidate" &&
    blockers.length === 0
  ) {
    blockers.push("canonical-create-approval-required");
  }

  const packagingEligible =
    record.resolutionClass === "new-canonical-candidate" &&
    blockers.length === 1 &&
    blockers[0] === "canonical-create-approval-required";

  return {
    ...record,
    routingStatus: routed ? "resolved-and-frozen" : "not-required",
    blockers: unique(blockers),
    packagingEligible,
    newlyAdvancedByRouting: routed && packagingEligible && !record.nextPhaseCandidate,
    canonicalImportAuthorized: false,
    automaticMergeAuthorized: false,
    automaticRoutingAuthorized: false,
    publicationAuthorized: false,
  };
});

const excluded = updatedDecisions.filter(
  (record) => record.resolutionClass === "administrative-followup",
);
const packagingQueue = updatedDecisions.filter((record) => record.packagingEligible);
const remainingHolds = updatedDecisions.filter(
  (record) => !record.packagingEligible &&
    record.resolutionClass !== "administrative-followup",
);
const newlyAdvanced = updatedDecisions.filter((record) => record.newlyAdvancedByRouting);
const routedButHeld = updatedDecisions.filter(
  (record) =>
    expectedRoutingIds.has(record.tradeId) &&
    !record.packagingEligible,
);

const counts = {
  sourceRows: updatedDecisions.length,
  phase6cNextPhaseCandidates: decision.counts.nextPhaseCandidateRows,
  routingHoldTransactions: routing.routingTransactions.length,
  routedTransactions: transactionSummaries.filter((row) => row.routeStatus === "resolved-and-frozen").length,
  sourceRouteEdges: routeEdges.filter((edge) => edge.edgeClass === "charlotte-source-route").length,
  supplementalRouteEdges: routeEdges.filter((edge) => edge.edgeClass === "supplemental-partner-route").length,
  totalRouteEdges: routeEdges.length,
  corrections: corrections.length,
  sourceReferences: supplementalContext.filter((row) => row.contextType === "source-reference").length,
  remainingRoutingHolds: 0,
  newlyAdvancedByRouting: newlyAdvanced.length,
  routedButStillHeld: routedButHeld.length,
  packagingQueueRecords: packagingQueue.length,
  remainingHeldRecords: remainingHolds.length,
  excludedNonStandalone: excluded.length,
  packagingActionCounts: countBy(packagingQueue.map((record) => record.recommendedAction)),
  remainingHoldClassCounts: countBy(remainingHolds.map((record) => record.resolutionClass)),
  remainingBlockerCounts: countBy(remainingHolds.flatMap((record) => record.blockers)),
};

assert(counts.sourceRows === 125, "Phase 6D source count drifted.");
assert(counts.phase6cNextPhaseCandidates === 95, "Phase 6C candidate count drifted.");
assert(counts.routingHoldTransactions === 10, "Routing hold count drifted.");
assert(counts.routedTransactions === 10, "Not all routing transactions were resolved.");
assert(counts.remainingRoutingHolds === 0, "Routing holds remain.");
assert(counts.totalRouteEdges === counts.sourceRouteEdges + counts.supplementalRouteEdges, "Route-edge accounting drifted.");
assert(
  counts.packagingQueueRecords ===
    counts.phase6cNextPhaseCandidates + counts.newlyAdvancedByRouting,
  "Packaging queue did not advance only routing-resolved rows.",
);
assert(
  counts.packagingQueueRecords +
    counts.remainingHeldRecords +
    counts.excludedNonStandalone === 125,
  "Phase 6D row accounting drifted.",
);
assert(counts.excludedNonStandalone === 2, "Administrative exclusion count drifted.");
assert(
  updatedDecisions.every((record) => record.canonicalImportAuthorized === false),
  "Canonical import authorization escaped.",
);
assert(
  updatedDecisions.every((record) => record.automaticRoutingAuthorized === false),
  "Automatic route authorization escaped.",
);

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const outputFiles = {
  routingFreezeJson: "charlotte-hornets-phase-6d-routing-freeze.json",
  routeEdgesCsv: "charlotte-hornets-phase-6d-route-edges.csv",
  transactionSummaryCsv: "charlotte-hornets-phase-6d-transaction-summary.csv",
  correctionsCsv: "charlotte-hornets-phase-6d-corrections.csv",
  supplementalContextCsv: "charlotte-hornets-phase-6d-supplemental-context.csv",
  crossTeamRoutingCsv: "charlotte-hornets-phase-6d-cross-team-routing.csv",
  packagingQueueCsv: "charlotte-hornets-phase-6d-packaging-queue.csv",
  remainingHoldsCsv: "charlotte-hornets-phase-6d-remaining-holds.csv",
  summaryJson: "charlotte-hornets-phase-6d-summary.json",
};

function flatDecision(record) {
  return {
    tradeId: record.tradeId,
    tradeDate: record.tradeDate,
    partnerTeams: record.partnerTeams,
    teamCount: record.teamCount,
    resolutionClass: record.resolutionClass,
    recommendedAction: record.recommendedAction,
    routingStatus: record.routingStatus,
    verdict: record.verdict,
    confidence: record.confidence,
    contentClass: record.contentClass,
    blockers: record.blockers.join(" | "),
    packagingEligible: record.packagingEligible,
    newlyAdvancedByRouting: record.newlyAdvancedByRouting,
    canonicalImportAuthorized: false,
  };
}

const crossTeamRows = routeEdges.map((edge) => ({
  tradeId: edge.tradeId,
  tradeDate: edge.tradeDate,
  edgeClass: edge.edgeClass,
  fromTeam: edge.fromTeam,
  toTeam: edge.toTeam,
  assetType: edge.assetType,
  asset: edge.asset,
  canonicalImportAuthorized: false,
}));

const freezeRecords = updatedDecisions.map((record) => ({
  tradeId: record.tradeId,
  tradeDate: record.tradeDate,
  routingStatus: record.routingStatus,
  packagingEligible: record.packagingEligible,
  newlyAdvancedByRouting: record.newlyAdvancedByRouting,
  blockers: record.blockers,
}));

const freeze = {
  result: "PASS",
  phase: "6D",
  mode: "MULTI_TEAM_ROUTING_FREEZE",
  sourceDecision: {
    decisionRecordsSha256: decision.decisionRecordsSha256,
    previewRecordsSha256: preview.hashes.previewRecordsSha256,
  },
  routingSpecSha256: sha256(routingBytes),
  contractSha256: sha256(contractBytes),
  counts,
  routeEdgesSha256: sha256(JSON.stringify(routeEdges)),
  freezeRecordsSha256: sha256(JSON.stringify(freezeRecords)),
  records: freezeRecords,
  outputFiles,
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

const summary = {
  result: "PASS",
  phase: "6D",
  counts,
  decisionRecordsSha256: decision.decisionRecordsSha256,
  previewRecordsSha256: preview.hashes.previewRecordsSha256,
  routingSpecSha256: freeze.routingSpecSha256,
  routeEdgesSha256: freeze.routeEdgesSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256,
  canonicalImports: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
};

const decisionHeaders = [
  "tradeId", "tradeDate", "partnerTeams", "teamCount", "resolutionClass",
  "recommendedAction", "routingStatus", "verdict", "confidence",
  "contentClass", "blockers", "packagingEligible",
  "newlyAdvancedByRouting", "canonicalImportAuthorized",
];

await Promise.all([
  writeFile(
    path.join(outputDir, outputFiles.routingFreezeJson),
    JSON.stringify(freeze, null, 2) + "\n",
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.routeEdgesCsv),
    toCsv(routeEdges, [
      "routeEdgeId", "tradeId", "tradeDate", "edgeClass", "fromTeam",
      "toTeam", "assetType", "asset", "frozen", "importAuthorized",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.transactionSummaryCsv),
    toCsv(transactionSummaries, [
      "tradeId", "tradeDate", "teamCount", "sourceRouteEdges",
      "supplementalRouteEdges", "totalRouteEdges", "corrections",
      "routeStatus", "remainingRoutingHold",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.correctionsCsv),
    toCsv(corrections, [
      "tradeId", "tradeDate", "kind", "detail",
      "appliedToRoutingFreeze", "canonicalStoreWrite",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.supplementalContextCsv),
    toCsv(supplementalContext, [
      "tradeId", "tradeDate", "contextType", "label", "value",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.crossTeamRoutingCsv),
    toCsv(crossTeamRows, [
      "tradeId", "tradeDate", "edgeClass", "fromTeam", "toTeam",
      "assetType", "asset", "canonicalImportAuthorized",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.packagingQueueCsv),
    toCsv(packagingQueue.map(flatDecision), decisionHeaders),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.remainingHoldsCsv),
    toCsv(remainingHolds.map(flatDecision), decisionHeaders),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.summaryJson),
    JSON.stringify(summary, null, 2) + "\n",
    "utf8",
  ),
]);

console.log(JSON.stringify({
  result: freeze.result,
  phase: freeze.phase,
  mode: freeze.mode,
  counts: freeze.counts,
  routingSpecSha256: freeze.routingSpecSha256,
  routeEdgesSha256: freeze.routeEdgesSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256,
  outputFiles: freeze.outputFiles,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
}, null, 2));
