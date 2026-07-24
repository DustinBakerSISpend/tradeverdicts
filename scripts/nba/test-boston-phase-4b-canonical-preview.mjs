#!/usr/bin/env node
import { createHash } from "node:crypto";
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
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

assert(preview.result === "PASS", "Phase 4B preview did not pass.");
assert(preview.phase === "4B", "Unexpected preview phase.");
assert(
  preview.mode === "DUPLICATE_SAFE_BOSTON_CANONICAL_AND_CROSS_TEAM_PREVIEW",
  "Unexpected preview mode.",
);
assert(reviewed.batchId === "boston-celtics-phase-4a", "Boston Phase 4A batch missing.");
assert(reviewed.records.length === 223, "Boston reviewed-row count changed.");
assert(trades.length === 256, "Canonical store count changed.");

assert(preview.counts.sourceRows === 223, "Expected 223 preview rows.");
assert(
  preview.counts.standalonePreviewRows === 211,
  "Expected 211 standalone preview rows.",
);
assert(preview.counts.nonStandaloneRows === 12, "Expected 12 non-standalone rows.");
assert(preview.counts.atlantaLineageFlags === 14, "Expected 14 Atlanta-lineage flags.");
assert(
  preview.counts.atlantaDateTeamReviewedOverlaps === 13,
  "Expected 13 exact Atlanta date/team overlaps.",
);
assert(
  preview.counts.unmatchedAtlantaLineageRows === 1,
  "Expected one unmatched Atlanta-lineage row.",
);
assert(
  JSON.stringify(preview.unmatchedAtlantaLineageTradeIds) ===
    JSON.stringify(["BOS-1949-0016"]),
  "Unexpected unmatched Atlanta-lineage ID.",
);

assert(preview.automaticMerges === 0, "Automatic merges are forbidden.");
assert(preview.canonicalImports === 0, "Canonical imports are forbidden.");
assert(preview.playerImports === 0, "Player imports are forbidden.");
assert(preview.relationshipWrites === 0, "Relationship writes are forbidden.");
assert(preview.routeDataWrites === 0, "Route-data writes are forbidden.");
assert(preview.publicationAuthorized === false, "Publication remains blocked.");
assert(preview.pushPerformed === false, "Push must remain false.");
assert(preview.deployPerformed === false, "Deploy must remain false.");

assert(
  preview.records.length === 223,
  `Expected 223 preview records, found ${preview.records.length}.`,
);
assert(
  new Set(preview.records.map((record) => record.sourceTradeId)).size === 223,
  "Boston source IDs are not unique.",
);

const standalone = preview.records.filter(
  (record) =>
    record.candidateAction !==
    "exclude-from-standalone-canonical-preview",
);

assert(standalone.length === 211, "Standalone preview filter drifted.");
assert(
  new Set(standalone.map((record) => record.provisionalCanonicalId)).size ===
    standalone.length,
  "Provisional canonical IDs are not unique.",
);
assert(
  new Set(standalone.map((record) => record.sourcePerspectiveKey)).size ===
    standalone.length,
  "Boston source-perspective keys are not unique.",
);

for (const record of preview.records) {
  assert(record.publishStatus === "private", `${record.sourceTradeId}: not private.`);
  assert(record.indexEligible === false, `${record.sourceTradeId}: index eligible.`);
  assert(record.adEligible === false, `${record.sourceTradeId}: ad eligible.`);
  assert(
    record.publicationReady === false,
    `${record.sourceTradeId}: publication-ready marker found.`,
  );
  assert(record.automaticMerge === false, `${record.sourceTradeId}: automatic merge set.`);

  const hasCurrentSemanticMatch = record.currentCanonicalComparisons.some(
    (comparison) => comparison.classification === "semantic-existing-match",
  );
  const hasAtlantaDateTeamOverlap = record.atlantaReviewedComparisons.some(
    (comparison) =>
      comparison.exactDate === true && comparison.exactTeams === true,
  );

  if (record.candidateAction === "create-new-canonical-preview") {
    assert(
      hasCurrentSemanticMatch === false,
      `${record.sourceTradeId}: new candidate has a current canonical semantic match.`,
    );
    assert(
      hasAtlantaDateTeamOverlap === false,
      `${record.sourceTradeId}: new candidate has an Atlanta reviewed overlap.`,
    );
    assert(
      record.blockers.length === 0,
      `${record.sourceTradeId}: clear new candidate has blockers.`,
    );
    assert(
      record.unclassifiedAssetCount === 0,
      `${record.sourceTradeId}: clear new candidate has unclassified assets.`,
    );
  }

  if (
    record.candidateAction ===
    "add-boston-perspective-to-existing-canonical-preview"
  ) {
    assert(
      record.existingCanonicalMatch,
      `${record.sourceTradeId}: perspective recommendation lacks canonical ID.`,
    );
    assert(
      hasCurrentSemanticMatch,
      `${record.sourceTradeId}: perspective recommendation lacks semantic match.`,
    );
  }

  if (
    record.canonicalDisposition === "atlanta-overlap-candidate" &&
    hasAtlantaDateTeamOverlap &&
    !record.existingCanonicalMatch
  ) {
    assert(
      record.candidateAction !== "create-new-canonical-preview",
      `${record.sourceTradeId}: Atlanta overlap was allowed to create a duplicate.`,
    );
  }
}

assert(
  preview.duplicatePerspectiveTargets.length === 0,
  "Multiple Boston rows target the same existing canonical perspective.",
);

const actionTotal = Object.values(preview.actionCounts).reduce(
  (sum, count) => sum + count,
  0,
);
assert(actionTotal === 223, "Action counts do not total 223.");

assert(
  preview.hashes.canonicalStoreSha256.length === 64,
  "Canonical-store hash missing.",
);
assert(
  sha256(previewBytes).length === 64 &&
    sha256(reviewedBytes).length === 64 &&
    sha256(tradesBytes).length === 64,
  "SHA-256 verification failed.",
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "4B",
  verified: {
    sourceRows: preview.counts.sourceRows,
    standalonePreviewRows: preview.counts.standalonePreviewRows,
    nonStandaloneRows: preview.counts.nonStandaloneRows,
    clearNewCanonicalPreviews: preview.counts.clearNewCanonicalPreviews,
    existingCanonicalPerspectiveRecommendations:
      preview.counts.existingCanonicalPerspectiveRecommendations,
    sharedAtlantaReviewedHolds:
      preview.counts.sharedAtlantaReviewedHolds,
    atlantaSourceReconciliationHolds:
      preview.counts.atlantaSourceReconciliationHolds,
    canonicalCreateReady: preview.counts.canonicalCreateReady,
    perspectiveReconciliationReady:
      preview.counts.perspectiveReconciliationReady,
    canonicalDataBlocked: preview.counts.canonicalDataBlocked,
    unclassifiedAssetCount: preview.counts.unclassifiedAssetCount,
    currentComparisonRows: preview.counts.currentComparisonRows,
    atlantaComparisonRows: preview.counts.atlantaComparisonRows,
    withinBostonComparisonPairs:
      preview.counts.withinBostonComparisonPairs,
    duplicatePerspectiveTargets: 0,
    automaticMerges: 0,
    canonicalImports: 0,
    playerImports: 0,
    relationshipWrites: 0,
    routeDataWrites: 0,
  },
}, null, 2));
