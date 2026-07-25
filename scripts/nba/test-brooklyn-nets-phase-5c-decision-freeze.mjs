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
function countBy(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)));
}

const args = parseArgs(process.argv);
for (const required of ["freeze-json", "decisions-json", "preview-json", "trades-json"]) {
  assert(args[required], `Missing --${required}`);
}

const [freezeBytes, decisionsBytes, previewBytes, tradesBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["decisions-json"]),
  readFile(args["preview-json"]),
  readFile(args["trades-json"]),
]);

const freeze = JSON.parse(freezeBytes.toString("utf8"));
const decisions = JSON.parse(decisionsBytes.toString("utf8"));
const preview = JSON.parse(previewBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));

assert(freeze.result === "PASS", "Freeze result is not PASS.");
assert(freeze.phase === "5C", "Freeze phase is not 5C.");
assert(freeze.mode === "BROOKLYN_NETS_CANONICAL_RECONCILIATION_DECISION_FREEZE", "Unexpected freeze mode.");
assert(decisions.phase === "5C", "Decision manifest phase is not 5C.");
assert(Array.isArray(freeze.records) && freeze.records.length === 251, "Expected 251 freeze records.");
assert(Array.isArray(decisions.decisions) && decisions.decisions.length === 251, "Expected 251 manifest decisions.");
assert(Array.isArray(preview.records) && preview.records.length === 251, "Expected 251 preview records.");
assert(Array.isArray(trades), "Canonical trade store is not an array.");

assert(freeze.sourcePreview.previewRecordsSha256 === "7d3224666ffd1cae073cac3ed6a8bc270aa2f0e843f130f49bcd4b7fa936ff05", "Frozen source-preview hash drifted.");
assert(preview.hashes.previewRecordsSha256 === freeze.sourcePreview.previewRecordsSha256, "Preview-record hash mismatch.");
assert(freeze.decisionsManifestSha256 === sha256(decisionsBytes), "Decision-manifest hash mismatch.");
assert(freeze.freezeRecordsSha256 === sha256(Buffer.from(stable(freeze.records))), "Freeze-record hash mismatch.");

const counts = freeze.counts;
assert(counts.sourceRows === 251, "Source count drifted.");
assert(counts.approvedNewCanonicalIdentities === 190, "Approved new-canonical count drifted.");
assert(counts.approvedExistingCanonicalPerspectives === 4, "Approved existing-perspective count drifted.");
assert(counts.routingHolds === 14, "Routing-hold count drifted.");
assert(counts.evidenceHolds === 21, "Evidence-hold count drifted.");
assert(counts.parserHolds === 3, "Parser-hold count drifted.");
assert(counts.provisionalHolds === 5, "Provisional-hold count drifted.");
assert(counts.existingCollisionHolds === 4, "Existing-collision hold count drifted.");
assert(counts.crossTeamReconciliationHolds === 2, "Cross-team hold count drifted.");
assert(counts.excludedNonStandalone === 8, "Excluded count drifted.");
assert(counts.approvedForPackaging === 194, "Approved packaging count drifted.");
assert(counts.held === 49, "Held count drifted.");
assert(counts.approvedForPackaging + counts.held + counts.excludedNonStandalone === 251, "Freeze accounting does not total 251.");

const actualDecisionCounts = countBy(freeze.records.map((record) => record.phase5CDecision));
assert(stable(actualDecisionCounts) === stable(counts.decisionCounts), "Decision counts do not match records.");
assert(
  stable(freeze.records.map((record) => record.sourceTradeId)) ===
    stable(preview.records.map((record) => record.sourceTradeId)),
  "Freeze record order differs from Phase 5B."
);
assert(new Set(freeze.records.map((record) => record.sourceTradeId)).size === 251, "Duplicate source IDs in freeze.");

const currentTradeIds = new Set(trades.map((trade) => trade.id));
const approvedNew = freeze.records.filter((record) => record.phase5CDecision === "approve-new-canonical-identity");
const approvedExisting = freeze.records.filter((record) => record.phase5CDecision === "approve-existing-canonical-perspective");
assert(approvedNew.length === 190, "Approved new count mismatch.");
assert(approvedExisting.length === 4, "Approved existing count mismatch.");
assert(new Set(approvedNew.map((record) => record.targetIdentity)).size === 190, "Duplicate approved new target.");
assert(new Set(approvedExisting.map((record) => record.targetIdentity)).size === 4, "Duplicate approved existing target.");
assert(approvedNew.every((record) => !currentTradeIds.has(record.targetIdentity)), "Approved new identity already exists in canonical store.");
assert(approvedExisting.every((record) => currentTradeIds.has(record.targetIdentity)), "Approved existing target is absent from canonical store.");

assert(freeze.records.every((record) =>
  record.privateOnly === true &&
  record.indexEligible === false &&
  record.adEligible === false &&
  record.publicationReady === false &&
  record.publicationAuthorized === false &&
  record.automaticMergeAuthorized === false
), "A Phase 5C record escaped private/no-merge policy.");

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
  phase: "5C",
  verified: {
    sourceRows: counts.sourceRows,
    approvedNewCanonicalIdentities: counts.approvedNewCanonicalIdentities,
    approvedExistingCanonicalPerspectives: counts.approvedExistingCanonicalPerspectives,
    routingHolds: counts.routingHolds,
    evidenceHolds: counts.evidenceHolds,
    parserHolds: counts.parserHolds,
    provisionalHolds: counts.provisionalHolds,
    existingCollisionHolds: counts.existingCollisionHolds,
    crossTeamReconciliationHolds: counts.crossTeamReconciliationHolds,
    excludedNonStandalone: counts.excludedNonStandalone,
    approvedForPackaging: counts.approvedForPackaging,
    held: counts.held,
  },
  decisionsManifestSha256: freeze.decisionsManifestSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  teamRegistryWrites: 0,
  automaticMerges: 0,
}, null, 2));
