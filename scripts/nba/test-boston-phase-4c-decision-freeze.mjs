#!/usr/bin/env node
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
function assert(value, message) { if (!value) throw new Error(message); }

const args = parseArgs(process.argv);
for (const required of ["freeze-json", "decisions-json", "trades-json"]) {
  assert(args[required], `Missing --${required}`);
}
const [freezeBytes, decisionsBytes, tradesBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["decisions-json"]),
  readFile(args["trades-json"]),
]);
const freeze = JSON.parse(freezeBytes.toString("utf8"));
const decisions = JSON.parse(decisionsBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));

assert(freeze.result === "PASS" && freeze.phase === "4C", "Phase 4C freeze failed.");
assert(decisions.phase === "4C" && decisions.decisions.length === 223, "Decision manifest invalid.");
assert(Array.isArray(trades) && trades.length === 256, "Canonical store changed.");
assert(freeze.records.length === 223, "Freeze record count changed.");
assert(freeze.approvedNewCanonicalIdentities === 183, "Approved-new count changed.");
assert(freeze.approvedExistingCanonicalPerspectives === 10, "Approved-perspective count changed.");
assert(freeze.routingHolds === 18, "Routing-hold count changed.");
assert(freeze.excludedNonStandalone === 12, "Excluded count changed.");
assert(freeze.sourceOverrides === 6, "Source-override count changed.");
assert(freeze.unresolvedParserHolds === 0, "Parser holds remain.");
assert(freeze.unresolvedEvidenceHolds === 0, "Evidence holds remain.");
assert(freeze.automaticMerges === 0, "Automatic merge detected.");
assert(freeze.canonicalImports === 0, "Canonical import detected.");

const byId = new Map(freeze.records.map((record) => [record.sourceTradeId, record]));
const exactTargets = {
  "BOS-1950-0017": "nba-trade-19500129-3d93db5cc062",
  "BOS-1951-0027": "nba-trade-19510203-0a92490e5a8d",
  "BOS-1953-0034": "nba-trade-19530701-44d1159c42f1",
  "BOS-1953-0036": "nba-trade-19531129-cad95c0931cb",
  "BOS-1954-0037": "nba-trade-19540528-bb3a74d2728f",
  "BOS-1956-0040": "nba-trade-19560430-26fae14dd040",
  "BOS-1962-0043": "nba-trade-19621015-704048850266",
  "BOS-2005-0135": "nba-trade-20050224-3ec32f85a480",
  "BOS-2019-0183": "nba-trade-20190207-7e53f8e40484",
  "BOS-2023-0207": "nba-trade-20230628-ccf1fd3f9046",
};
for (const [tradeId, target] of Object.entries(exactTargets)) {
  const record = byId.get(tradeId);
  assert(record?.phase4CDecision === "approve-existing-canonical-perspective", `${tradeId}: perspective decision missing.`);
  assert(record.targetIdentity === target, `${tradeId}: canonical target drift.`);
}

assert(byId.get("BOS-2023-0204")?.phase4CDecision === "hold-existing-canonical-routing", "Porzingis multi-team identity decision drift.");
assert(byId.get("BOS-1949-0016")?.phase4CDecision === "approve-new-canonical-identity", "Unmatched Atlanta-lineage record must remain new.");
assert(byId.get("BOS-1988-0097")?.phase4CDecision === "approve-new-canonical-identity", "Expansion-draft transaction was not resolved.");
assert(byId.get("BOS-1969-0055")?.unclassifiedAssetCount === 0, "Cousy-Dinwiddie correction did not clear parser hold.");

for (const record of freeze.records) {
  assert(record.privateOnly === true, `${record.sourceTradeId}: private-only guard missing.`);
  assert(record.indexEligible === false, `${record.sourceTradeId}: index eligible.`);
  assert(record.adEligible === false, `${record.sourceTradeId}: ad eligible.`);
  assert(record.publicationReady === false, `${record.sourceTradeId}: publication ready.`);
  assert(record.automaticMerge === false, `${record.sourceTradeId}: automatic merge enabled.`);
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "4C",
  verified: {
    sourceRows: 223,
    approvedNewCanonicalIdentities: 183,
    approvedExistingCanonicalPerspectives: 10,
    routingHolds: 18,
    excludedNonStandalone: 12,
    sourceOverrides: 6,
    unresolvedParserHolds: 0,
    unresolvedEvidenceHolds: 0,
    canonicalStoreCount: 256,
    automaticMerges: 0,
    canonicalImports: 0,
  },
}, null, 2));
