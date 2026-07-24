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

function assert(value, message) {
  if (!value) throw new Error(message);
}

const args = parseArgs(process.argv);
for (const required of ["preview-json", "reviewed-json", "trades-json"]) {
  assert(args[required], `Missing --${required}`);
}

const [previewBytes, reviewedBytes, tradesBytes] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["reviewed-json"]),
  readFile(args["trades-json"]),
]);
const preview = JSON.parse(previewBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));

assert(preview.result === "PASS", "Preview result must be PASS.");
assert(preview.phase === "3B", "Preview phase must be 3B.");
assert(preview.mode === "DUPLICATE_SAFE_CANONICAL_CONVERSION_PREVIEW", "Unexpected preview mode.");
assert(reviewed.records.length === 308, "Reviewed row count changed.");
assert(trades.length === 27, "Canonical store count changed.");

const expectedCounts = {
  sourceRows: 308,
  standalonePreviewRows: 299,
  clearNewCanonicalPreviews: 298,
  existingPerspectiveMatches: 1,
  nonStandaloneRows: 9,
  canonicalDataReady: 277,
  canonicalDataBlocked: 22,
  typedAssetTotal: 997,
  unclassifiedAssetCount: 13,
  existingComparisonRows: 1,
  withinBatchComparisonPairs: 2,
  blockerRows: 9,
};
for (const [key, expected] of Object.entries(expectedCounts)) {
  assert(preview.counts[key] === expected, `${key}: expected ${expected}, found ${preview.counts[key]}`);
}

assert(preview.canonicalImports === 0, "Canonical imports must remain zero.");
assert(preview.playerImports === 0, "Player imports must remain zero.");
assert(preview.repositoryDataWrites === 0, "Repository data writes must remain zero.");
assert(preview.routesCreated === 0, "Routes created must remain zero.");
assert(preview.automaticMerges === 0, "Automatic merges must remain zero.");
assert(preview.pushPerformed === false, "Push must remain false.");
assert(preview.deployPerformed === false, "Deploy must remain false.");

const records = preview.records;
assert(records.length === 308, "Preview record count changed.");
const bySourceId = new Map(records.map((record) => [record.sourceTradeId, record]));
assert(bySourceId.size === 308, "Duplicate source trade IDs detected.");

const provisionalIds = records
  .filter((record) => record.candidateAction !== "exclude-from-standalone-canonical-preview")
  .map((record) => record.provisionalCanonicalId);
assert(new Set(provisionalIds).size === provisionalIds.length, "Duplicate provisional canonical IDs detected.");

const perspectiveKeys = records
  .filter((record) => record.candidateAction !== "exclude-from-standalone-canonical-preview")
  .map((record) => record.sourcePerspectiveKey);
assert(new Set(perspectiveKeys).size === perspectiveKeys.length, "Duplicate source perspective keys detected.");

const existing = bySourceId.get("ATL-2026-0300");
assert(existing, "Missing Trae Young source record.");
assert(existing.candidateAction === "add-source-perspective-to-existing-canonical", "Trae Young must add a perspective, not create a new trade.");
assert(existing.existingCanonicalMatch === "nba-trade-20260109-e1724a128785", "Trae Young canonical match changed.");
assert(existing.duplicateGuardStatus === "explicit-existing-perspective-match", "Trae Young duplicate guard status changed.");

for (const record of records) {
  assert(record.publishStatus === "private", `${record.sourceTradeId}: publish status is not private.`);
  assert(record.indexEligible === false, `${record.sourceTradeId}: indexEligible must remain false.`);
  assert(record.adEligible === false, `${record.sourceTradeId}: adEligible must remain false.`);
  assert(record.publicationReady === false, `${record.sourceTradeId}: publicationReady must remain false.`);
  assert(record.automaticMerge === false, `${record.sourceTradeId}: automatic merge must remain false.`);
}

const nonStandalone = records.filter((record) => record.candidateAction === "exclude-from-standalone-canonical-preview");
assert(nonStandalone.length === 9, "Non-standalone count changed.");
assert(nonStandalone.filter((record) => record.duplicateGuardStatus === "merge-followup").length === 4, "Expected four follow-up merge rows.");
assert(nonStandalone.filter((record) => record.duplicateGuardStatus === "exclude-duplicate").length === 4, "Expected four duplicate exclusions.");
assert(nonStandalone.filter((record) => record.duplicateGuardStatus === "hold-conflict").length === 1, "Expected one source-conflict exclusion.");

const unannouncedRisks = records.filter((record) => [
  "unannounced-existing-semantic-match",
  "ambiguous-existing-semantic-match",
  "probable-existing-date-variant",
  "existing-date-team-collision",
  "within-batch-duplicate-risk",
].includes(record.duplicateGuardStatus));
assert(unannouncedRisks.length === 0, `Unexpected duplicate risks: ${unannouncedRisks.map((record) => record.sourceTradeId).join(", ")}`);

const sameDayDistinct = records
  .flatMap((record) => record.withinBatchComparisons ?? [])
  .filter((pair) => pair.classification === "distinct-same-day-team-collision");
const pairKeys = new Set(sameDayDistinct.map((pair) => [pair.leftTradeId, pair.rightTradeId].sort().join("|")));
assert(pairKeys.size === 2, `Expected two distinct same-day collision pairs, found ${pairKeys.size}.`);
assert(pairKeys.has("ATL-1960-0054|ATL-1960-0055"), "Missing January 31, 1960 distinct same-day pair.");
assert(pairKeys.has("ATL-1960-0057|ATL-1960-0058"), "Missing April 14, 1960 distinct same-day pair.");

assert(preview.hashes.reviewedBatchSha256 === "bdff6305938509a1ac7f50b8af1ae6f0f3f44e7bce7d6dac2d6030a2670845ca", "Reviewed-batch hash changed.");
assert(preview.hashes.canonicalStoreSha256 === "6ef5f01c8472792a9291a045ccadce37c677b0da8204c76c7966484f935d72aa", "Canonical-store hash changed.");
assert(preview.hashes.previewRecordsSha256 === "425725b346ae3df1af57e7dfcfa9c1301e676df152f213ad4c587655f2bb3da1", "Deterministic preview hash changed.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "3B",
  verified: {
    sourceRows: records.length,
    clearNewCanonicalPreviews: preview.counts.clearNewCanonicalPreviews,
    existingPerspectiveMatches: preview.counts.existingPerspectiveMatches,
    nonStandaloneRows: preview.counts.nonStandaloneRows,
    canonicalDataReady: preview.counts.canonicalDataReady,
    canonicalDataBlocked: preview.counts.canonicalDataBlocked,
    distinctSameDayPairs: pairKeys.size,
    duplicateProvisionalIds: 0,
    duplicateSourcePerspectiveKeys: 0,
    unannouncedExistingDuplicateRisks: 0,
    automaticMerges: 0,
    canonicalImports: 0,
  },
}, null, 2));
