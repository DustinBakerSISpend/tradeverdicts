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
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function clean(value) {
  return String(value ?? "").trim();
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
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}
function matchesRule(asset, rule) {
  if (asset.direction !== rule.direction) return false;
  if (rule.match === "*") return true;
  return new RegExp(rule.match, "iu").test(clean(asset.displayText));
}
function routeSourceAsset(asset, rule, record, index) {
  const transactionTeams = new Set(record.teams);
  assert(transactionTeams.has(rule.fromTeam), `${record.sourceTradeId}/${asset.assetId}: from-team is outside transaction.`);
  assert(transactionTeams.has(rule.toTeam), `${record.sourceTradeId}/${asset.assetId}: to-team is outside transaction.`);
  assert(rule.fromTeam !== rule.toTeam, `${record.sourceTradeId}/${asset.assetId}: self-route.`);
  if (!rule.allowNonNetsRoute) {
    assert(
      rule.fromTeam === record.sourceTeam || rule.toTeam === record.sourceTeam,
      `${record.sourceTradeId}/${asset.assetId}: source route does not touch Brooklyn.`
    );
  }
  return {
    ...asset,
    routeId: `${record.sourceTradeId}-source-route-${String(index).padStart(3, "0")}`,
    routeKind: "source-asset",
    sourceTradeId: record.sourceTradeId,
    tradeDate: record.tradeDate,
    fromTeam: rule.fromTeam,
    toTeam: rule.toTeam,
    possibleFromTeams: [],
    possibleToTeams: [],
    routingStatus: rule.statusOverride ?? "resolved",
    phase5DRoutingEvidence: rule.evidenceNote,
    phase5DSourceUrl: rule.sourceUrl,
    phase5DCorrectionNote: rule.correctionNote ?? null,
    allowNonNetsRoute: rule.allowNonNetsRoute === true,
    privateOnly: true,
    automaticMergeAuthorized: false,
  };
}
function routeSupplementalAsset(route, record, index) {
  const transactionTeams = new Set(record.teams);
  assert(transactionTeams.has(route.fromTeam), `${record.sourceTradeId}: supplemental from-team is outside transaction.`);
  assert(transactionTeams.has(route.toTeam), `${record.sourceTradeId}: supplemental to-team is outside transaction.`);
  assert(route.fromTeam !== route.toTeam, `${record.sourceTradeId}: supplemental self-route.`);
  return {
    routeId: `${record.sourceTradeId}-supplemental-route-${String(index).padStart(3, "0")}`,
    routeKind: "supplemental-context",
    sourceTradeId: record.sourceTradeId,
    tradeDate: record.tradeDate,
    assetId: null,
    direction: "supplemental",
    displayText: route.displayText,
    type: route.type,
    status: "supplemental",
    fromTeam: route.fromTeam,
    toTeam: route.toTeam,
    possibleFromTeams: [],
    possibleToTeams: [],
    routingStatus: route.routingStatus,
    supplementalKind: route.supplementalKind,
    phase5DRoutingEvidence: route.evidenceNote,
    phase5DSourceUrl: route.sourceUrl,
    phase5DCorrectionNote: null,
    privateOnly: true,
    automaticMergeAuthorized: false,
  };
}

const args = parseArgs(process.argv);
for (const required of ["phase5c-freeze", "routing-json", "output-dir"]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, routingBytes] = await Promise.all([
  readFile(args["phase5c-freeze"]),
  readFile(args["routing-json"]),
]);
const phase5C = JSON.parse(freezeBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));
const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

assert(phase5C.result === "PASS" && phase5C.phase === "5C", "Invalid Phase 5C freeze.");
assert(Array.isArray(phase5C.records) && phase5C.records.length === 251, "Expected 251 Phase 5C records.");
assert(phase5C.counts.routingHolds === 14, "Expected 14 Phase 5C routing holds.");
assert(phase5C.counts.approvedForPackaging === 194, "Expected 194 pre-routing packaging approvals.");
assert(phase5C.counts.held === 49, "Expected 49 Phase 5C holds.");
assert(routing.phase === "5D", "Invalid routing manifest phase.");
assert(routing.sourcePhase === "5C", "Invalid routing source phase.");
assert(routing.sourcePreviewRecordsSha256 === phase5C.sourcePreview.previewRecordsSha256, "Routing manifest source hash drifted.");
assert(Array.isArray(routing.transactions) && routing.transactions.length === 14, "Expected 14 routing transactions.");

const routingById = new Map(routing.transactions.map((transaction) => [transaction.sourceTradeId, transaction]));
assert(routingById.size === 14, "Duplicate transaction in routing manifest.");

const holdRecords = phase5C.records.filter((record) => record.phase5CDecision === "hold-routing");
assert(holdRecords.length === 14, "Phase 5C routing-hold record count drifted.");
assert(
  stable(holdRecords.map((record) => record.sourceTradeId).sort()) ===
    stable([...routingById.keys()].sort()),
  "Routing manifest IDs do not exactly match Phase 5C routing holds."
);

const routedRecordsById = new Map();
const sourceRouteEdges = [];
const supplementalRouteEdges = [];
const transactionRows = [];
const correctionRows = [];
const crossTeamRows = [];
let sourceIndex = 0;
let supplementalIndex = 0;

for (const record of holdRecords) {
  const transaction = routingById.get(record.sourceTradeId);
  assert(transaction.tradeDate === record.tradeDate, `${record.sourceTradeId}: routing date drifted.`);
  assert(Array.isArray(transaction.sourceRules) && transaction.sourceRules.length > 0, `${record.sourceTradeId}: no source rules.`);
  assert(Array.isArray(transaction.supplementalRoutes), `${record.sourceTradeId}: supplemental routes missing.`);
  assert(Array.isArray(record.assetLedger) && record.assetLedger.length > 0, `${record.sourceTradeId}: source asset ledger missing.`);

  const routedSourceAssets = [];
  for (const asset of record.assetLedger) {
    const matchedRules = transaction.sourceRules.filter((rule) => matchesRule(asset, rule));
    assert(
      matchedRules.length === 1,
      `${record.sourceTradeId}/${asset.assetId}/${asset.displayText}: expected exactly one routing rule, found ${matchedRules.length}.`
    );
    sourceIndex += 1;
    const routed = routeSourceAsset(asset, matchedRules[0], record, sourceIndex);
    routedSourceAssets.push(routed);
    sourceRouteEdges.push(routed);
    if (routed.phase5DCorrectionNote || routed.routingStatus === "corrected-routing") {
      correctionRows.push({
        sourceTradeId: record.sourceTradeId,
        tradeDate: record.tradeDate,
        assetId: routed.assetId,
        displayText: routed.displayText,
        correctionKind: "source-route-correction",
        fromTeam: routed.fromTeam,
        toTeam: routed.toTeam,
        correctionNote: routed.phase5DCorrectionNote ?? "",
        evidenceNote: routed.phase5DRoutingEvidence,
        sourceUrl: routed.phase5DSourceUrl,
      });
    }
  }

  const supplementalAssets = [];
  for (const supplemental of transaction.supplementalRoutes) {
    supplementalIndex += 1;
    const routed = routeSupplementalAsset(supplemental, record, supplementalIndex);
    supplementalAssets.push(routed);
    supplementalRouteEdges.push(routed);
    if (routed.supplementalKind === "source-omission-correction") {
      correctionRows.push({
        sourceTradeId: record.sourceTradeId,
        tradeDate: record.tradeDate,
        assetId: "",
        displayText: routed.displayText,
        correctionKind: "source-omission-correction",
        fromTeam: routed.fromTeam,
        toTeam: routed.toTeam,
        correctionNote: "Asset added as documented source-team routing context.",
        evidenceNote: routed.phase5DRoutingEvidence,
        sourceUrl: routed.phase5DSourceUrl,
      });
    }
  }

  const allEdges = [...routedSourceAssets, ...supplementalAssets];
  const routedRecord = {
    ...record,
    assetLedger: routedSourceAssets,
    supplementalRouteEdges: supplementalAssets,
    phase5DRoutingStatus: "resolved",
    phase5DSourceRouteCount: routedSourceAssets.length,
    phase5DSupplementalRouteCount: supplementalAssets.length,
    phase5DTotalRouteCount: allEdges.length,
    phase5DSourceCorrections: correctionRows.filter((row) => row.sourceTradeId === record.sourceTradeId).length,
    phase5CDecision: "routing-resolved-for-packaging",
    nextPhase: "identity-and-canonical-packaging",
    targetIdentity: record.provisionalCanonicalId,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    publicationAuthorized: false,
    automaticMergeAuthorized: false,
  };
  routedRecordsById.set(record.sourceTradeId, routedRecord);

  transactionRows.push({
    sourceTradeId: record.sourceTradeId,
    tradeDate: record.tradeDate,
    teams: record.teams.join(" | "),
    targetIdentity: routedRecord.targetIdentity,
    routedSourceAssets: routedSourceAssets.length,
    supplementalRoutes: supplementalAssets.length,
    totalRouteEdges: allEdges.length,
    sourceCorrections: routedRecord.phase5DSourceCorrections,
    routingStatus: routedRecord.phase5DRoutingStatus,
    nextPhase: routedRecord.nextPhase,
  });

  if (
    record.atlantaReviewedComparisons.length > 0 ||
    record.bostonReviewedComparisons.length > 0 ||
    record.currentCanonicalComparisons.length > 0
  ) {
    crossTeamRows.push({
      sourceTradeId: record.sourceTradeId,
      tradeDate: record.tradeDate,
      teams: record.teams.join(" | "),
      currentCanonicalCandidates: record.currentCanonicalComparisons.map((item) => item.canonicalId).join(" | "),
      atlantaReviewedCandidates: record.atlantaReviewedComparisons.map((item) => item.sourceTradeId).join(" | "),
      bostonReviewedCandidates: record.bostonReviewedComparisons.map((item) => item.sourceTradeId).join(" | "),
      routingStatus: "resolved",
      automaticMergeAuthorized: false,
    });
  }
}

const records = phase5C.records.map((record) => routedRecordsById.get(record.sourceTradeId) ?? record);
const remainingRoutingHolds = records.filter((record) => record.phase5CDecision === "hold-routing");
assert(remainingRoutingHolds.length === 0, "A Phase 5C routing hold remains unresolved.");

const packagingRecords = records.filter((record) =>
  record.phase5CDecision === "approve-new-canonical-identity" ||
  record.phase5CDecision === "approve-existing-canonical-perspective" ||
  record.phase5CDecision === "routing-resolved-for-packaging"
);
const excludedRecords = records.filter((record) => record.phase5CDecision === "exclude-non-standalone");
const remainingHeldRecords = records.filter((record) =>
  !packagingRecords.includes(record) && !excludedRecords.includes(record)
);

assert(packagingRecords.length === 208, `Expected 208 packaging records, found ${packagingRecords.length}.`);
assert(remainingHeldRecords.length === 35, `Expected 35 remaining held records, found ${remainingHeldRecords.length}.`);
assert(excludedRecords.length === 8, `Expected 8 excluded rows, found ${excludedRecords.length}.`);
assert(packagingRecords.length + remainingHeldRecords.length + excludedRecords.length === 251, "Phase 5D accounting does not total 251.");
assert(sourceRouteEdges.every((edge) => edge.routingStatus === "resolved" || edge.routingStatus === "corrected-routing"), "Unresolved source route.");
assert(supplementalRouteEdges.every((edge) => edge.routingStatus === "resolved"), "Unresolved supplemental route.");
assert(new Set(sourceRouteEdges.map((edge) => edge.assetId)).size === sourceRouteEdges.length, "Duplicate source asset route.");
assert(new Set(sourceRouteEdges.map((edge) => edge.routeId)).size === sourceRouteEdges.length, "Duplicate source route ID.");
assert(new Set(supplementalRouteEdges.map((edge) => edge.routeId)).size === supplementalRouteEdges.length, "Duplicate supplemental route ID.");

const packagingRows = packagingRecords.map((record) => ({
  sourceTradeId: record.sourceTradeId,
  tradeDate: record.tradeDate,
  teams: record.teams.join(" | "),
  targetIdentity: record.targetIdentity ?? "",
  packagingAction:
    record.phase5CDecision === "approve-existing-canonical-perspective"
      ? "package-existing-canonical-perspective"
      : "package-new-canonical-identity",
  routingStatus: record.phase5DRoutingStatus ?? "not-required",
  sourceRouteCount: record.phase5DSourceRouteCount ?? 0,
  supplementalRouteCount: record.phase5DSupplementalRouteCount ?? 0,
  confidence: record.confidence,
  verdict: record.verdict,
  privateOnly: true,
}));

const counts = {
  sourceRows: records.length,
  routingHoldTransactions: holdRecords.length,
  routedTransactions: routedRecordsById.size,
  routedSourceAssets: sourceRouteEdges.length,
  supplementalRoutes: supplementalRouteEdges.length,
  totalRouteEdges: sourceRouteEdges.length + supplementalRouteEdges.length,
  sourceRouteCorrections: correctionRows.filter((row) => row.correctionKind === "source-route-correction").length,
  sourceOmissionCorrections: correctionRows.filter((row) => row.correctionKind === "source-omission-correction").length,
  remainingRoutingHolds: remainingRoutingHolds.length,
  approvedBeforeRouting: phase5C.counts.approvedForPackaging,
  routingResolvedForPackaging: routedRecordsById.size,
  packagingQueueRecords: packagingRecords.length,
  remainingHeldRecords: remainingHeldRecords.length,
  excludedNonStandalone: excludedRecords.length,
  crossTeamRoutedTransactions: crossTeamRows.length,
  decisionCounts: countBy(records.map((record) => record.phase5CDecision)),
};

const freeze = {
  result: "PASS",
  phase: "5D",
  mode: "BROOKLYN_NETS_MULTI_TEAM_ASSET_ROUTING_FREEZE",
  batchId: routing.batchId,
  sourcePhase: "5C",
  sourceFreeze: {
    sourceRows: phase5C.counts.sourceRows,
    previewRecordsSha256: phase5C.sourcePreview.previewRecordsSha256,
    freezeRecordsSha256: phase5C.freezeRecordsSha256,
    decisionsManifestSha256: phase5C.decisionsManifestSha256,
    phase5CFreezeSha256: sha256(freezeBytes),
  },
  routingManifestSha256: sha256(routingBytes),
  routeRecordsSha256: sha256(Buffer.from(stable(records))),
  counts,
  policy: routing.policy,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  teamRegistryWrites: 0,
  automaticMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
  sourceRouteEdges,
  supplementalRouteEdges,
  records,
};

const edgeRows = [...sourceRouteEdges, ...supplementalRouteEdges].map((edge) => ({
  sourceTradeId: edge.sourceTradeId,
  tradeDate: edge.tradeDate,
  routeId: edge.routeId,
  routeKind: edge.routeKind,
  assetId: edge.assetId ?? "",
  direction: edge.direction,
  displayText: edge.displayText,
  type: edge.type,
  fromTeam: edge.fromTeam,
  toTeam: edge.toTeam,
  routingStatus: edge.routingStatus,
  supplementalKind: edge.supplementalKind ?? "",
  correctionNote: edge.phase5DCorrectionNote ?? "",
  evidenceNote: edge.phase5DRoutingEvidence,
  sourceUrl: edge.phase5DSourceUrl,
}));

const outputFiles = {
  freeze: path.join(outputDir, "brooklyn-nets-phase-5d-routing-freeze.json"),
  edges: path.join(outputDir, "brooklyn-nets-phase-5d-route-edges.csv"),
  transactions: path.join(outputDir, "brooklyn-nets-phase-5d-transaction-summary.csv"),
  corrections: path.join(outputDir, "brooklyn-nets-phase-5d-corrections.csv"),
  supplemental: path.join(outputDir, "brooklyn-nets-phase-5d-supplemental-context.csv"),
  crossTeam: path.join(outputDir, "brooklyn-nets-phase-5d-cross-team-routing.csv"),
  packaging: path.join(outputDir, "brooklyn-nets-phase-5d-packaging-queue.csv"),
  summary: path.join(outputDir, "brooklyn-nets-phase-5d-summary.json"),
};

await Promise.all([
  writeFile(outputFiles.freeze, JSON.stringify(freeze, null, 2) + "\n", "utf8"),
  writeFile(outputFiles.edges, toCsv(edgeRows), "utf8"),
  writeFile(outputFiles.transactions, toCsv(transactionRows), "utf8"),
  writeFile(outputFiles.corrections, toCsv(correctionRows, [
    "sourceTradeId", "tradeDate", "assetId", "displayText", "correctionKind",
    "fromTeam", "toTeam", "correctionNote", "evidenceNote", "sourceUrl",
  ]), "utf8"),
  writeFile(outputFiles.supplemental, toCsv(supplementalRouteEdges.map((edge) => ({
    sourceTradeId: edge.sourceTradeId,
    tradeDate: edge.tradeDate,
    routeId: edge.routeId,
    displayText: edge.displayText,
    type: edge.type,
    fromTeam: edge.fromTeam,
    toTeam: edge.toTeam,
    supplementalKind: edge.supplementalKind,
    evidenceNote: edge.phase5DRoutingEvidence,
    sourceUrl: edge.phase5DSourceUrl,
  }))), "utf8"),
  writeFile(outputFiles.crossTeam, toCsv(crossTeamRows, [
    "sourceTradeId", "tradeDate", "teams", "currentCanonicalCandidates",
    "atlantaReviewedCandidates", "bostonReviewedCandidates",
    "routingStatus", "automaticMergeAuthorized",
  ]), "utf8"),
  writeFile(outputFiles.packaging, toCsv(packagingRows), "utf8"),
  writeFile(outputFiles.summary, JSON.stringify({
    result: freeze.result,
    phase: freeze.phase,
    mode: freeze.mode,
    counts: freeze.counts,
    sourceFreeze: freeze.sourceFreeze,
    routingManifestSha256: freeze.routingManifestSha256,
    routeRecordsSha256: freeze.routeRecordsSha256,
    canonicalImports: 0,
    playerImports: 0,
    relationshipWrites: 0,
    routeDataWrites: 0,
    teamRegistryWrites: 0,
    automaticMerges: 0,
    publicationAuthorized: false,
    pushPerformed: false,
    deployPerformed: false,
  }, null, 2) + "\n", "utf8"),
]);

console.log(JSON.stringify({
  result: freeze.result,
  phase: freeze.phase,
  mode: freeze.mode,
  ...freeze.counts,
  routingManifestSha256: freeze.routingManifestSha256,
  routeRecordsSha256: freeze.routeRecordsSha256,
  outputFiles,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  teamRegistryWrites: 0,
  automaticMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
