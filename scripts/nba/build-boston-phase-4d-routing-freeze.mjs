#!/usr/bin/env node
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

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function routeAsset(asset, route) {
  assert(
    asset.direction === route.expectedDirection,
    `${route.assetId}: direction drift.`,
  );
  assert(
    asset.type === route.expectedType,
    `${route.assetId}: type drift. Expected ${route.expectedType}, found ${asset.type}.`,
  );
  assert(
    asset.displayText === route.expectedDisplayText,
    `${route.assetId}: display-text drift.`,
  );

  const routed = {
    ...asset,
    fromTeam: route.fromTeam,
    toTeam: route.toTeam,
    possibleFromTeams: [],
    possibleToTeams: [],
    routingStatus: route.routingStatus,
    phase4DRoutingEvidence: route.evidenceNote,
  };

  if (route.typeOverride) routed.type = route.typeOverride;
  if (route.statusOverride) routed.status = route.statusOverride;
  if (route.correctionNote) routed.phase4DCorrectionNote = route.correctionNote;
  if (route.swapContractId) routed.swapContractId = route.swapContractId;
  if (route.pairedSwapLeg === true) routed.pairedSwapLeg = true;
  if (route.swapRole) routed.swapRole = route.swapRole;

  return routed;
}

const args = parseArgs(process.argv);
for (const required of ["phase4c-freeze", "routing-json", "output-dir"]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, routingBytes] = await Promise.all([
  readFile(args["phase4c-freeze"]),
  readFile(args["routing-json"]),
]);

const phase4c = JSON.parse(freezeBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));

assert(
  phase4c.result === "PASS" &&
    phase4c.phase === "4C" &&
    phase4c.records.length === 223,
  "Invalid Phase 4C decision freeze.",
);
assert(
  routing.phase === "4D" &&
    routing.counts.transactions === 18 &&
    routing.counts.sourceAssetRoutes === 89 &&
    routing.counts.supplementalRoutes === 1,
  "Invalid Phase 4D routing manifest.",
);

const sourceRoutesByTrade = new Map();
const sourceRouteIds = new Set();

for (const route of routing.sourceRoutes) {
  assert(route.routeKind === "source-asset", `${route.routeId}: invalid route kind.`);
  assert(!sourceRouteIds.has(route.assetId), `${route.assetId}: duplicate source route.`);
  sourceRouteIds.add(route.assetId);

  if (!sourceRoutesByTrade.has(route.sourceTradeId)) {
    sourceRoutesByTrade.set(route.sourceTradeId, new Map());
  }
  sourceRoutesByTrade.get(route.sourceTradeId).set(route.assetId, route);
}

assert(sourceRouteIds.size === 89, "Expected 89 unique source-asset routes.");
assert(sourceRoutesByTrade.size === 18, "Expected routes for 18 transactions.");

const supplementalByTrade = new Map();
for (const route of routing.supplementalRoutes) {
  assert(
    route.routeKind === "supplemental-context",
    `${route.routeId}: invalid supplemental route kind.`,
  );
  if (!supplementalByTrade.has(route.sourceTradeId)) {
    supplementalByTrade.set(route.sourceTradeId, []);
  }
  supplementalByTrade.get(route.sourceTradeId).push(route);
}

const allowedRoutingDecisions = new Set([
  "hold-new-canonical-routing",
  "hold-existing-canonical-routing",
  "hold-shared-atlanta-routing",
]);

const outputRecords = [];
const routedTransactionRows = [];
const routeEdgeRows = [];
const sharedRows = [];
const existingRows = [];

let routedSourceAssets = 0;
let newCanonicalRoutingResolutions = 0;
let existingCanonicalRoutingResolutions = 0;
let sharedAtlantaRoutingResolutions = 0;

for (const record of phase4c.records) {
  if (!allowedRoutingDecisions.has(record.phase4CDecision)) {
    outputRecords.push({
      ...record,
      phase4DDecision: record.phase4CDecision,
      phase4DRoutingStatus: "not-required",
    });
    continue;
  }

  const routeMap = sourceRoutesByTrade.get(record.sourceTradeId);
  assert(routeMap, `${record.sourceTradeId}: routing rules missing.`);

  const sourceAssetIds = record.assetLedger.map((asset) => asset.assetId).sort();
  const routeAssetIds = [...routeMap.keys()].sort();
  assert(
    JSON.stringify(sourceAssetIds) === JSON.stringify(routeAssetIds),
    `${record.sourceTradeId}: source asset/routes mismatch.`,
  );

  const routedLedger = record.assetLedger.map((asset) => {
    const routed = routeAsset(asset, routeMap.get(asset.assetId));
    routedSourceAssets += 1;
    return routed;
  });
  const routedById = new Map(routedLedger.map((asset) => [asset.assetId, asset]));
  const routedReceived = record.assetsReceived.map((asset) => routedById.get(asset.assetId));
  const routedSent = record.assetsSent.map((asset) => routedById.get(asset.assetId));

  assert(
    routedReceived.every(Boolean) && routedSent.every(Boolean),
    `${record.sourceTradeId}: received/sent route reconstruction failed.`,
  );
  assert(
    routedLedger.every(
      (asset) =>
        asset.fromTeam &&
        asset.toTeam &&
        asset.routingStatus === "resolved-phase-4d" &&
        asset.possibleFromTeams.length === 0 &&
        asset.possibleToTeams.length === 0,
    ),
    `${record.sourceTradeId}: unresolved routed asset remains.`,
  );

  let phase4DDecision;
  let nextPhase;
  if (record.phase4CDecision === "hold-new-canonical-routing") {
    phase4DDecision = "approve-new-canonical-identity";
    nextPhase = "identity-and-canonical-packaging";
    newCanonicalRoutingResolutions += 1;
  } else if (record.phase4CDecision === "hold-existing-canonical-routing") {
    phase4DDecision = "approve-existing-canonical-perspective";
    nextPhase = "perspective-packaging";
    existingCanonicalRoutingResolutions += 1;
  } else {
    phase4DDecision = "approve-shared-reviewed-canonical-identity";
    nextPhase = "shared-cross-team-canonical-packaging";
    sharedAtlantaRoutingResolutions += 1;
  }

  const supplemental = structuredClone(
    supplementalByTrade.get(record.sourceTradeId) ?? [],
  );

  const routedRecord = {
    ...record,
    assetsReceived: routedReceived,
    assetsSent: routedSent,
    assetLedger: routedLedger,
    unclassifiedAssetCount: routedLedger.filter(
      (asset) => asset.type === "other" || asset.status === "unclassified",
    ).length,
    phase4DDecision,
    nextPhase,
    phase4DRoutingStatus: "resolved",
    supplementalRouteEdges: supplemental,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    automaticMerge: false,
  };

  assert(
    routedRecord.unclassifiedAssetCount === 0,
    `${record.sourceTradeId}: unclassified asset remains after routing corrections.`,
  );

  outputRecords.push(routedRecord);

  const counterpartPairs = sortedUnique(
    routedLedger.map((asset) => `${asset.fromTeam}->${asset.toTeam}`),
  );
  routedTransactionRows.push({
    sourceTradeId: record.sourceTradeId,
    tradeDate: record.tradeDate,
    phase4CDecision: record.phase4CDecision,
    phase4DDecision,
    targetIdentity: record.targetIdentity ?? "",
    routedSourceAssets: routedLedger.length,
    supplementalRoutes: supplemental.length,
    counterpartPairs: counterpartPairs.join(" | "),
    routingStatus: "resolved",
  });

  for (const asset of routedLedger) {
    routeEdgeRows.push({
      sourceTradeId: record.sourceTradeId,
      routeKind: "source-asset",
      assetId: asset.assetId,
      type: asset.type,
      displayText: asset.displayText,
      direction: asset.direction,
      fromTeam: asset.fromTeam,
      toTeam: asset.toTeam,
      routingStatus: asset.routingStatus,
      swapContractId: asset.swapContractId ?? "",
      swapRole: asset.swapRole ?? "",
      correction: asset.phase4DCorrectionNote ?? "",
    });
  }

  for (const route of supplemental) {
    routeEdgeRows.push({
      sourceTradeId: record.sourceTradeId,
      routeKind: route.routeKind,
      assetId: route.assetId,
      type: route.type,
      displayText: route.displayText,
      direction: "supplemental",
      fromTeam: route.fromTeam,
      toTeam: route.toTeam,
      routingStatus: route.routingStatus,
      swapContractId: "",
      swapRole: "",
      correction: route.correctionNote,
    });
  }

  if (phase4DDecision === "approve-shared-reviewed-canonical-identity") {
    assert(record.sharedCanonicalGroup, `${record.sourceTradeId}: shared group missing.`);
    assert(record.atlantaSourceTradeId, `${record.sourceTradeId}: Atlanta source ID missing.`);
    sharedRows.push({
      sourceTradeId: record.sourceTradeId,
      atlantaSourceTradeId: record.atlantaSourceTradeId,
      sharedCanonicalGroup: record.sharedCanonicalGroup,
      tradeDate: record.tradeDate,
      teams: record.teams.join(" | "),
      routedSourceAssets: routedLedger.length,
      routingStatus: "resolved",
      canonicalWriteAuthorized: false,
    });
  }

  if (phase4DDecision === "approve-existing-canonical-perspective") {
    existingRows.push({
      sourceTradeId: record.sourceTradeId,
      existingCanonicalTarget: record.targetIdentity,
      tradeDate: record.tradeDate,
      teams: record.teams.join(" | "),
      routedSourceAssets: routedLedger.length,
      routingStatus: "resolved",
      perspectiveWriteAuthorized: false,
    });
  }
}

assert(routedSourceAssets === 89, `Expected 89 routed source assets, found ${routedSourceAssets}.`);
assert(
  newCanonicalRoutingResolutions === 14,
  `Expected 14 new-canonical routing resolutions, found ${newCanonicalRoutingResolutions}.`,
);
assert(
  existingCanonicalRoutingResolutions === 1,
  `Expected one existing-canonical routing resolution, found ${existingCanonicalRoutingResolutions}.`,
);
assert(
  sharedAtlantaRoutingResolutions === 3,
  `Expected three shared-Atlanta routing resolutions, found ${sharedAtlantaRoutingResolutions}.`,
);
assert(routedTransactionRows.length === 18, "Expected 18 routed transactions.");
assert(routeEdgeRows.length === 90, "Expected 90 total route edges.");
assert(sharedRows.length === 3, "Expected three shared-Atlanta rows.");
assert(existingRows.length === 1, "Expected one existing-canonical routed row.");

const finalDecisionCounts = Object.fromEntries(
  [...new Set(outputRecords.map((record) => record.phase4DDecision))]
    .sort()
    .map((decision) => [
      decision,
      outputRecords.filter((record) => record.phase4DDecision === decision).length,
    ]),
);

assert(
  finalDecisionCounts["approve-new-canonical-identity"] === 197,
  "Expected 197 approved new canonical identities.",
);
assert(
  finalDecisionCounts["approve-existing-canonical-perspective"] === 11,
  "Expected 11 approved existing-canonical perspectives.",
);
assert(
  finalDecisionCounts["approve-shared-reviewed-canonical-identity"] === 3,
  "Expected three approved shared reviewed identities.",
);
assert(
  finalDecisionCounts["exclude-nonstandalone"] === 12,
  "Expected 12 excluded non-standalone records.",
);
assert(
  !Object.keys(finalDecisionCounts).some((decision) => decision.includes("routing")),
  "A routing hold remains after Phase 4D.",
);

const sourceAssetRouteIds = new Set(
  routeEdgeRows
    .filter((row) => row.routeKind === "source-asset")
    .map((row) => row.assetId),
);
assert(sourceAssetRouteIds.size === 89, "Source route-edge IDs are not unique.");

const supplementRows = routeEdgeRows.filter(
  (row) => row.routeKind === "supplemental-context",
);
assert(
  supplementRows.length === 1 &&
    supplementRows[0].assetId === "BOS-2009-0148-supplemental-cash-01",
  "Unexpected supplemental routing edge.",
);

const porzingis = outputRecords.find(
  (record) => record.sourceTradeId === "BOS-2023-0204",
);
assert(
  porzingis?.phase4DDecision === "approve-existing-canonical-perspective" &&
    porzingis.targetIdentity === "nba-trade-20230623-085fc0ce6d13",
  "Porzingis existing-canonical routing resolution drifted.",
);

const cashCorrection = outputRecords
  .find((record) => record.sourceTradeId === "BOS-2025-0216")
  ?.assetLedger.find(
    (asset) => asset.assetId === "BOS-2025-0216-received-03",
  );
assert(
  cashCorrection?.type === "cash" &&
    cashCorrection.fromTeam === "brooklyn-nets" &&
    cashCorrection.toTeam === "boston-celtics",
  "2025 Brooklyn cash correction failed.",
);

const swapLegs = outputRecords
  .find((record) => record.sourceTradeId === "BOS-2023-0209")
  ?.assetLedger.filter(
    (asset) => asset.swapContractId === "nba-swap-2025-second-boston-dallas",
  );
assert(
  swapLegs?.length === 2 &&
    swapLegs.every((asset) => asset.pairedSwapLeg === true),
  "Boston-Dallas paired swap routing failed.",
);

const summary = {
  result: "PASS",
  phase: "4D",
  mode: "BOSTON_MULTI_TEAM_ROUTING_FREEZE",
  sourceRows: 223,
  routedTransactions: 18,
  routedSourceAssets: 89,
  supplementalRoutes: 1,
  totalRouteEdges: 90,
  newCanonicalRoutingResolutions: 14,
  existingCanonicalRoutingResolutions: 1,
  sharedAtlantaRoutingResolutions: 3,
  unresolvedRoutingTransactions: 0,
  unresolvedSourceAssets: 0,
  finalDecisionCounts,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const packagingRows = outputRecords
  .filter((record) => record.phase4DDecision !== "exclude-nonstandalone")
  .map((record) => ({
    sourceTradeId: record.sourceTradeId,
    tradeDate: record.tradeDate,
    teams: record.teams.join(" | "),
    phase4DDecision: record.phase4DDecision,
    targetIdentity: record.targetIdentity ?? "",
    nextPhase: record.nextPhase,
    routingStatus: record.phase4DRoutingStatus,
    privateOnly: true,
    canonicalWriteAuthorized: false,
  }));

await Promise.all([
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4d-routing-freeze.json"),
    `${JSON.stringify({ ...summary, records: outputRecords }, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4d-route-edges.csv"),
    toCsv(routeEdgeRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4d-transaction-summary.csv"),
    toCsv(routedTransactionRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4d-shared-atlanta.csv"),
    toCsv(sharedRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4d-existing-canonical.csv"),
    toCsv(existingRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4d-packaging-queue.csv"),
    toCsv(packagingRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4d-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(JSON.stringify(summary, null, 2));
