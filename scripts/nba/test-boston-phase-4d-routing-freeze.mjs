#!/usr/bin/env node
import { readFile } from "node:fs/promises";

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

const args = parseArgs(process.argv);
for (const required of ["freeze-json", "routing-json", "trades-json", "players-json"]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, routingBytes, tradesBytes, playersBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["routing-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));

assert(freeze.result === "PASS" && freeze.phase === "4D", "Phase 4D freeze failed.");
assert(freeze.records.length === 223, "Phase 4D source count changed.");
assert(Array.isArray(trades) && trades.length === 256, "Canonical trade store changed.");
assert(Array.isArray(players) && players.length === 509, "Player store changed.");

assert(freeze.routedTransactions === 18, "Expected 18 routed transactions.");
assert(freeze.routedSourceAssets === 89, "Expected 89 routed source assets.");
assert(freeze.supplementalRoutes === 1, "Expected one supplemental route.");
assert(freeze.totalRouteEdges === 90, "Expected 90 total route edges.");
assert(freeze.newCanonicalRoutingResolutions === 14, "Expected 14 new-canonical resolutions.");
assert(freeze.existingCanonicalRoutingResolutions === 1, "Expected one existing-canonical resolution.");
assert(freeze.sharedAtlantaRoutingResolutions === 3, "Expected three shared-Atlanta resolutions.");
assert(freeze.unresolvedRoutingTransactions === 0, "Routing transactions remain unresolved.");
assert(freeze.unresolvedSourceAssets === 0, "Source assets remain unresolved.");

assert(
  freeze.finalDecisionCounts["approve-new-canonical-identity"] === 197,
  "Approved-new total changed.",
);
assert(
  freeze.finalDecisionCounts["approve-existing-canonical-perspective"] === 11,
  "Approved-perspective total changed.",
);
assert(
  freeze.finalDecisionCounts["approve-shared-reviewed-canonical-identity"] === 3,
  "Approved-shared total changed.",
);
assert(
  freeze.finalDecisionCounts["exclude-nonstandalone"] === 12,
  "Excluded total changed.",
);

assert(freeze.canonicalImports === 0, "Canonical import detected.");
assert(freeze.playerImports === 0, "Player import detected.");
assert(freeze.relationshipWrites === 0, "Relationship write detected.");
assert(freeze.routeDataWrites === 0, "Route-data write detected.");
assert(freeze.automaticMerges === 0, "Automatic merge detected.");
assert(freeze.publicationAuthorized === false, "Publication was authorized.");
assert(freeze.pushPerformed === false, "Push marker changed.");
assert(freeze.deployPerformed === false, "Deploy marker changed.");

const routingRecords = freeze.records.filter(
  (record) => record.phase4DRoutingStatus === "resolved",
);
assert(routingRecords.length === 18, "Expected 18 resolved routing records.");

let routedAssetCount = 0;
for (const record of routingRecords) {
  for (const asset of record.assetLedger) {
    routedAssetCount += 1;
    assert(asset.fromTeam, `${asset.assetId}: missing fromTeam.`);
    assert(asset.toTeam, `${asset.assetId}: missing toTeam.`);
    assert(
      asset.routingStatus === "resolved-phase-4d",
      `${asset.assetId}: routing status drift.`,
    );
    assert(
      Array.isArray(asset.possibleFromTeams) && asset.possibleFromTeams.length === 0,
      `${asset.assetId}: possibleFromTeams remains populated.`,
    );
    assert(
      Array.isArray(asset.possibleToTeams) && asset.possibleToTeams.length === 0,
      `${asset.assetId}: possibleToTeams remains populated.`,
    );
  }
}
assert(routedAssetCount === 89, "Routed asset count changed.");

const byId = new Map(freeze.records.map((record) => [record.sourceTradeId, record]));

const sharedExpected = {
  "BOS-2004-0131": "ATL-2004-0207",
  "BOS-2021-0194": "ATL-2021-0276",
  "BOS-2025-0216": "ATL-2025-0298",
};
for (const [tradeId, atlantaId] of Object.entries(sharedExpected)) {
  const record = byId.get(tradeId);
  assert(
    record?.phase4DDecision === "approve-shared-reviewed-canonical-identity",
    `${tradeId}: shared decision drift.`,
  );
  assert(record.atlantaSourceTradeId === atlantaId, `${tradeId}: Atlanta ID drift.`);
}

const porzingis = byId.get("BOS-2023-0204");
assert(
  porzingis?.phase4DDecision === "approve-existing-canonical-perspective",
  "Porzingis perspective decision drift.",
);
assert(
  porzingis.targetIdentity === "nba-trade-20230623-085fc0ce6d13",
  "Porzingis canonical target drift.",
);

const brooklynCash = byId
  .get("BOS-2025-0216")
  ?.assetLedger.find(
    (asset) => asset.assetId === "BOS-2025-0216-received-03",
  );
assert(
  brooklynCash?.type === "cash" &&
    brooklynCash.fromTeam === "brooklyn-nets" &&
    brooklynCash.toTeam === "boston-celtics",
  "Brooklyn cash route/correction failed.",
);

const grantSwap = byId
  .get("BOS-2023-0209")
  ?.assetLedger.filter(
    (asset) => asset.swapContractId === "nba-swap-2025-second-boston-dallas",
  );
assert(
  grantSwap?.length === 2 &&
    grantSwap.every((asset) => asset.pairedSwapLeg === true),
  "Boston-Dallas swap legs are not paired.",
);

const supplemental = byId.get("BOS-2009-0148")?.supplementalRouteEdges;
assert(
  supplemental?.length === 1 &&
    supplemental[0].fromTeam === "boston-celtics" &&
    supplemental[0].toTeam === "sacramento-kings" &&
    supplemental[0].canonicalWriteAuthorized === false,
  "2009 supplemental cash route failed.",
);

for (const record of freeze.records) {
  assert(record.privateOnly === true, `${record.sourceTradeId}: private-only guard missing.`);
  assert(record.indexEligible === false, `${record.sourceTradeId}: index eligible.`);
  assert(record.adEligible === false, `${record.sourceTradeId}: ad eligible.`);
  assert(record.publicationReady === false, `${record.sourceTradeId}: publication ready.`);
  assert(record.automaticMerge === false, `${record.sourceTradeId}: automatic merge enabled.`);
}

assert(
  routing.counts.sourceAssetRoutes === 89 &&
    routing.counts.totalRouteEdges === 90,
  "Routing manifest counts changed.",
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "4D",
  verified: {
    sourceRows: 223,
    routedTransactions: 18,
    routedSourceAssets: 89,
    supplementalRoutes: 1,
    totalRouteEdges: 90,
    approvedNewCanonicalIdentities: 197,
    approvedExistingCanonicalPerspectives: 11,
    approvedSharedReviewedIdentities: 3,
    excludedNonStandalone: 12,
    canonicalStoreCount: 256,
    playerStoreCount: 509,
    unresolvedRoutingTransactions: 0,
    automaticMerges: 0,
    canonicalImports: 0,
    playerImports: 0,
    relationshipWrites: 0,
    routeDataWrites: 0,
  },
}, null, 2));
