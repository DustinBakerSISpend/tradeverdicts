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
for (const required of [
  "preview-json",
  "reviewed-json",
  "trades-json",
  "teams-json",
  "lineage-json",
  "atlanta-reviewed-json",
  "boston-reviewed-json",
]) assert(args[required], `Missing --${required}`);

const [
  previewBytes,
  reviewedBytes,
  tradesBytes,
  teamsBytes,
  lineageBytes,
  atlantaBytes,
  bostonBytes,
] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["reviewed-json"]),
  readFile(args["trades-json"]),
  readFile(args["teams-json"]),
  readFile(args["lineage-json"]),
  readFile(args["atlanta-reviewed-json"]),
  readFile(args["boston-reviewed-json"]),
]);

const preview = JSON.parse(previewBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const teams = JSON.parse(teamsBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));
const boston = JSON.parse(bostonBytes.toString("utf8"));

assert(preview.result === "PASS", "Preview result is not PASS.");
assert(preview.phase === "5B", "Preview phase is not 5B.");
assert(preview.mode === "DUPLICATE_SAFE_BROOKLYN_NETS_CANONICAL_AND_CROSS_TEAM_PREVIEW", "Unexpected preview mode.");
assert(preview.batchId === "brooklyn-nets-phase-5a", "Unexpected preview batch.");
assert(Array.isArray(preview.records) && preview.records.length === 251, "Expected 251 preview records.");
assert(Array.isArray(reviewed.records) && reviewed.records.length === 251, "Expected 251 reviewed records.");
assert(Array.isArray(trades), "Canonical store root is not an array.");
assert(Array.isArray(teams), "Team registry root is not an array.");
assert(Array.isArray(atlanta.records), "Atlanta reviewed records unavailable.");
assert(Array.isArray(boston.records), "Boston reviewed records unavailable.");

const counts = preview.counts;
assert(counts.sourceRows === 251, "Source-row count drifted.");
assert(counts.standalonePreviewRows === 243, "Standalone-row count drifted.");
assert(counts.nonStandaloneRows === 8, "Non-standalone row count drifted.");
assert(counts.partnerReferences === 278, "Partner-reference count drifted.");
assert(counts.currentMatchedSourceRows === 12, "Current canonical match count drifted.");
assert(counts.ambiguousCurrentMatchRows === 0, "Ambiguous current canonical match found.");
assert(counts.atlantaMatchedSourceRows === 11, "Atlanta match count drifted.");
assert(counts.bostonMatchedSourceRows === 7, "Boston match count drifted.");
assert(counts.crossTeamRequiredRows === 17, "Cross-team required count drifted.");
assert(counts.unmatchedCrossTeamRequiredRows === 0, "Required cross-team row is unmatched.");
assert(counts.routingRequiredRows === 17, "Routing-required count drifted.");

assert(preview.hashes.reviewedBatchSha256 === sha256(reviewedBytes), "Reviewed-batch hash mismatch.");
assert(preview.hashes.canonicalStoreSha256 === sha256(tradesBytes), "Canonical-store hash mismatch.");
assert(preview.hashes.teamRegistrySha256 === sha256(teamsBytes), "Team-registry hash mismatch.");
assert(preview.hashes.lineageRulesSha256 === sha256(lineageBytes), "Lineage-rules hash mismatch.");
assert(preview.hashes.atlantaReviewedBatchSha256 === sha256(atlantaBytes), "Atlanta reviewed hash mismatch.");
assert(preview.hashes.bostonReviewedBatchSha256 === sha256(bostonBytes), "Boston reviewed hash mismatch.");
assert(preview.hashes.previewRecordsSha256 === sha256(stable(preview.records)), "Preview-record hash mismatch.");

const sourceIds = preview.records.map((record) => record.sourceTradeId);
assert(new Set(sourceIds).size === 251, "Duplicate source IDs in preview.");
assert(
  stable(sourceIds) === stable(reviewed.records.map((record) => record.tradeId)),
  "Preview source order differs from reviewed source order."
);
assert(
  Object.values(preview.actionCounts).reduce((sum, value) => sum + value, 0) === 251,
  "Action accounting does not total 251."
);
assert(
  stable(preview.actionCounts) === stable(countBy(preview.records.map((record) => record.candidateAction))),
  "Action counts do not match records."
);
assert(
  stable(preview.duplicateGuardCounts) === stable(countBy(preview.records.map((record) => record.duplicateGuardStatus))),
  "Duplicate-guard counts do not match records."
);

const nonStandalone = new Set(["merge-followup", "exclude-duplicate", "retain-void-history"]);
assert(
  preview.records.filter((record) => nonStandalone.has(record.canonicalDisposition)).length === 8,
  "Non-standalone disposition accounting drifted."
);
assert(
  preview.records.every((record) =>
    record.publishStatus === "private" &&
    record.indexEligible === false &&
    record.adEligible === false &&
    record.publicationReady === false &&
    record.automaticMerge === false
  ),
  "A preview record escaped private/no-merge policy."
);

const perspectiveRows = preview.records.filter(
  (record) => record.candidateAction === "add-nets-perspective-to-existing-canonical-preview"
);
assert(
  perspectiveRows.every((record) =>
    typeof record.existingCanonicalMatch === "string" &&
    record.existingCanonicalMatch.length > 0 &&
    record.currentCanonicalComparisons.length === 1 &&
    record.currentCanonicalComparisons[0].classification === "semantic-existing-match"
  ),
  "Perspective recommendation lacks a unique semantic current match."
);
assert(
  new Set(perspectiveRows.map((record) => record.existingCanonicalMatch)).size === perspectiveRows.length,
  "Duplicate current-canonical perspective target recommended."
);
assert(
  preview.records.filter((record) => record.canonicalCreateReady).length === counts.canonicalCreateReady,
  "Canonical-create-ready count drifted."
);
assert(
  preview.records.filter((record) => record.perspectiveReconciliationReady).length === counts.perspectiveReconciliationReady,
  "Perspective-ready count drifted."
);
assert(
  preview.records.filter((record) => record.currentCanonicalComparisons.length > 0).length === 12,
  "Current canonical comparison source-row count drifted."
);
assert(
  preview.records.filter((record) => record.atlantaReviewedComparisons.length > 0).length === 11,
  "Atlanta comparison source-row count drifted."
);
assert(
  preview.records.filter((record) => record.bostonReviewedComparisons.length > 0).length === 7,
  "Boston comparison source-row count drifted."
);
assert(preview.unmatchedCrossTeamTradeIds.length === 0, "Unmatched required cross-team IDs remain.");
assert(preview.duplicatePerspectiveTargets.length === 0, "Duplicate perspective targets remain.");

for (const key of [
  "automaticMerges",
  "canonicalImports",
  "playerImports",
  "relationshipWrites",
  "routeDataWrites",
  "teamRegistryWrites",
]) assert(preview[key] === 0, `${key} is not zero.`);
assert(preview.publicationAuthorized === false, "Publication was authorized.");
assert(preview.pushPerformed === false, "Push was performed.");
assert(preview.deployPerformed === false, "Deployment was performed.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "5B",
  verified: {
    sourceRows: counts.sourceRows,
    standalonePreviewRows: counts.standalonePreviewRows,
    nonStandaloneRows: counts.nonStandaloneRows,
    currentMatchedSourceRows: counts.currentMatchedSourceRows,
    atlantaMatchedSourceRows: counts.atlantaMatchedSourceRows,
    bostonMatchedSourceRows: counts.bostonMatchedSourceRows,
    crossTeamRequiredRows: counts.crossTeamRequiredRows,
    unmatchedCrossTeamRequiredRows: counts.unmatchedCrossTeamRequiredRows,
    routingRequiredRows: counts.routingRequiredRows,
    canonicalCreateReady: counts.canonicalCreateReady,
    perspectiveReconciliationReady: counts.perspectiveReconciliationReady,
    canonicalDataBlocked: counts.canonicalDataBlocked,
    blockerRows: counts.blockerRows,
  },
  previewRecordsSha256: preview.hashes.previewRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
}, null, 2));
