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
function clean(value) {
  return String(value ?? "").trim();
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function countBy(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(output).sort(([left], [right]) => left.localeCompare(right)),
  );
}
function sameObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const args = parseArgs(process.argv);
assert(args["reviewed-json"], "Missing --reviewed-json.");

const bytes = await readFile(args["reviewed-json"]);
const batch = JSON.parse(bytes.toString("utf8"));
const records = batch.records;

assert(batch.result === "PASS" && batch.phase === "8A", "Invalid Phase 8A batch.");
assert(batch.batchId === "cleveland-cavaliers-phase-8a", "Unexpected batch ID.");
assert(batch.sourceTeam === "cleveland-cavaliers", "Unexpected source team.");
assert(Array.isArray(records) && records.length === 204, "Expected 204 reviewed rows.");
assert(
  sha256(JSON.stringify(records)) === batch.recordsSha256,
  "Reviewed-record hash drifted.",
);

const expectedVerdicts = {
  "Cavaliers Win": 42,
  "Even Trade": 48,
  "Follow-up Resolution": 10,
  "Insufficient Evidence": 6,
  "Partner Win": 23,
  "Slight Cavaliers Edge": 41,
  "Slight Partner Edge": 34,
};
const expectedContent = {
  "Merge/Exclude": 10,
  "Private/Noindex Archive": 117,
  "Public Candidate": 77,
};
const expectedPublish = {
  "hold-recent-provisional": 6,
  "ready-merge-exclude": 10,
  "ready-private-noindex": 111,
  "ready-public-candidate": 77,
};

assert(sameObject(countBy(records.map((record) => record.verdict)), expectedVerdicts), "Verdict curve drifted.");
assert(sameObject(countBy(records.map((record) => record.contentClass)), expectedContent), "Content-class curve drifted.");
assert(sameObject(countBy(records.map((record) => record.publishStatus)), expectedPublish), "Publish-status curve drifted.");

const expectedScore = new Map([
  ["Cavaliers Win", 2],
  ["Slight Cavaliers Edge", 1],
  ["Even Trade", 0],
  ["Slight Partner Edge", -1],
  ["Partner Win", -2],
  ["Insufficient Evidence", null],
  ["Follow-up Resolution", null],
]);
const cavaliersGrades = new Map([
  ["Cavaliers Win", new Set(["A+", "A", "A-", "B+"])],
  ["Slight Cavaliers Edge", new Set(["A-", "B+", "B"])],
  ["Even Trade", new Set(["B+", "B", "B-", "C+", "C"])],
  ["Slight Partner Edge", new Set(["B-", "C+", "C"])],
  ["Partner Win", new Set(["C", "D", "D-", "F"])],
  ["Insufficient Evidence", new Set(["N/A"])],
  ["Follow-up Resolution", new Set(["N/A"])],
]);
const partnerGrades = new Map([
  ["Cavaliers Win", new Set(["B-", "C+", "C", "D", "F"])],
  ["Slight Cavaliers Edge", new Set(["B+", "B", "B-"])],
  ["Even Trade", new Set(["B+", "B", "B-", "C+", "C"])],
  ["Slight Partner Edge", new Set(["B+", "B"])],
  ["Partner Win", new Set(["B+", "A+", "A", "A-"])],
  ["Insufficient Evidence", new Set(["N/A"])],
  ["Follow-up Resolution", new Set(["N/A"])],
]);

const ids = new Set();
const slugs = new Set();
const publicSummaries = new Set();
const publicAnalyses = new Set();
const forbiddenPublicPhrases = [
  "a depth transaction involving rotation players",
  "future considerations (?)",
  "unknown partner",
  "needs research",
  "research required",
  "source integrity notes",
  "curve discipline",
];

for (const [index, record] of records.entries()) {
  assert(record.sourceRow === index + 1, `${record.sourceTradeId}: source row is not contiguous.`);
  assert(/^CLE-\d{4}-\d{4}$/u.test(record.sourceTradeId), `${record.sourceTradeId}: invalid trade ID.`);
  assert(!ids.has(record.sourceTradeId), `${record.sourceTradeId}: duplicate trade ID.`);
  ids.add(record.sourceTradeId);

  assert(/^\d{4}-\d{2}-\d{2}$/u.test(record.tradeDate), `${record.sourceTradeId}: invalid date.`);
  assert(record.sourceTeam === "cleveland-cavaliers", `${record.sourceTradeId}: source-team drift.`);
  assert(Array.isArray(record.partnerTeams), `${record.sourceTradeId}: partner teams unavailable.`);
  assert(Array.isArray(record.partnerTeamLabels), `${record.sourceTradeId}: partner labels unavailable.`);
  assert(
    record.declaredTeamCount === record.partnerTeams.length + 1,
    `${record.sourceTradeId}: declared team count differs from explicit partners.`,
  );
  assert(
    record.routingRequired === (record.declaredTeamCount > 2),
    `${record.sourceTradeId}: routing flag differs from team count.`,
  );
  if (record.routingRequired) {
    assert(record.explicitEdgeReview === "Complete", `${record.sourceTradeId}: explicit edge review is incomplete.`);
    assert(clean(record.canonicalRoutingNotes).length >= 200, `${record.sourceTradeId}: routing note is incomplete.`);
  } else {
    assert(record.explicitEdgeReview === "Not required", `${record.sourceTradeId}: two-team edge-review status drifted.`);
  }

  assert(expectedScore.get(record.verdict) === record.outcomeScore, `${record.sourceTradeId}: outcome score drift.`);
  assert(cavaliersGrades.get(record.verdict).has(record.grades["cleveland-cavaliers"]), `${record.sourceTradeId}: Cavaliers grade mismatch.`);
  assert(partnerGrades.get(record.verdict).has(record.grades.partnerAggregate), `${record.sourceTradeId}: partner grade mismatch.`);

  assert(record.reviewStatus !== "Needs Research", `${record.sourceTradeId}: research blocker remains.`);
  assert(record.researchBeforePublic === false, `${record.sourceTradeId}: research-before-public blocker remains.`);
  assert(record.privateOnly === true, `${record.sourceTradeId}: private-only drift.`);
  assert(record.indexEligible === false, `${record.sourceTradeId}: index eligibility drift.`);
  assert(record.adEligible === false, `${record.sourceTradeId}: ad eligibility drift.`);
  assert(record.publicationReady === false, `${record.sourceTradeId}: publication readiness drift.`);
  assert(record.automaticMergeAuthorized === false, `${record.sourceTradeId}: automatic merge was authorized.`);
  assert(record.automaticRouteAuthorized === false, `${record.sourceTradeId}: automatic route was authorized.`);

  assert(clean(record.summary).length >= 100, `${record.sourceTradeId}: summary is too thin.`);
  assert(clean(record.analysis).length >= 240, `${record.sourceTradeId}: analysis is too thin.`);
  assert(/^https?:\/\//u.test(record.primaryOfficialSourceUrl), `${record.sourceTradeId}: primary source URL missing.`);
  assert(/^https?:\/\//u.test(record.secondaryAuthoritativeSourceUrl), `${record.sourceTradeId}: secondary source URL missing.`);
  assert(clean(record.slug).length > 20, `${record.sourceTradeId}: slug missing.`);
  assert(!slugs.has(record.slug), `${record.sourceTradeId}: duplicate slug.`);
  slugs.add(record.slug);

  if (record.mergeExclude) {
    assert(record.verdict === "Follow-up Resolution", `${record.sourceTradeId}: merge row is directionally graded.`);
    assert(clean(record.parentTradeId), `${record.sourceTradeId}: merge row lacks parent.`);
    assert(record.databaseImportAuthorized === false, `${record.sourceTradeId}: merge row is standalone import-authorized.`);
    assert(record.databaseStatus === "Ready — merge with parent", `${record.sourceTradeId}: merge status drift.`);
    assert(record.publishStatus === "ready-merge-exclude", `${record.sourceTradeId}: merge publish status drift.`);
  } else if (record.publishStatus === "hold-recent-provisional") {
    assert(record.provisional === true, `${record.sourceTradeId}: recent hold lacks provisional flag.`);
    assert(Number(record.tradeDate.slice(0, 4)) >= 2025, `${record.sourceTradeId}: recent hold predates 2025.`);
    assert(record.databaseImportAuthorized === false, `${record.sourceTradeId}: recent hold is import-authorized.`);
    assert(record.databaseStatus === "Hold — provisional recent outcome", `${record.sourceTradeId}: recent hold database status drift.`);
    assert(record.publicCandidate === false, `${record.sourceTradeId}: recent hold is public.`);
    assert(record.privateNoindexArchive === true, `${record.sourceTradeId}: recent hold is not private/noindex.`);
    assert(record.confidence !== "High", `${record.sourceTradeId}: recent hold confidence exceeds Medium.`);
    assert(clean(record.provisionalRevisitNote).startsWith("Provisional"), `${record.sourceTradeId}: recent hold lacks revisit note.`);
  } else {
    assert(record.databaseImportAuthorized === true, `${record.sourceTradeId}: closed standalone row is not import-authorized.`);
    assert(["Ready — canonical import", "Ready — archival import"].includes(record.databaseStatus), `${record.sourceTradeId}: database status drift.`);
  }

  if (record.provisional) {
    assert(record.confidence !== "High", `${record.sourceTradeId}: provisional grade confidence exceeds Medium.`);
    assert(clean(record.analysis).includes("Provisional"), `${record.sourceTradeId}: provisional analysis language missing.`);
    assert(clean(record.provisionalRevisitNote).startsWith("Provisional"), `${record.sourceTradeId}: provisional revisit note missing.`);
  }

  if (record.publicCandidate) {
    assert(record.contentClass === "Public Candidate", `${record.sourceTradeId}: public content class drift.`);
    assert(record.publishStatus === "ready-public-candidate", `${record.sourceTradeId}: public publish status drift.`);
    assert(record.publicCopyQaStatus === "Pass — asset-specific copy, two sources and closed routing", `${record.sourceTradeId}: public-copy QA status drift.`);
    assert(!publicSummaries.has(record.summary), `${record.sourceTradeId}: duplicate public summary.`);
    assert(!publicAnalyses.has(record.analysis), `${record.sourceTradeId}: duplicate public analysis.`);
    publicSummaries.add(record.summary);
    publicAnalyses.add(record.analysis);
    const copy = `${record.summary} ${record.analysis}`.toLowerCase();
    for (const phrase of forbiddenPublicPhrases) {
      assert(!copy.includes(phrase), `${record.sourceTradeId}: forbidden public phrase remains: ${phrase}`);
    }
    assert(clean(record.analysis).length >= 300, `${record.sourceTradeId}: public analysis is too thin.`);
  }
}

assert(ids.size === 204, "Trade-ID count drifted.");
assert(slugs.size === 204, "Slug count drifted.");
assert(publicSummaries.size === 77, "Public-summary count drifted.");
assert(publicAnalyses.size === 77, "Public-analysis count drifted.");
assert(records.filter((record) => record.outcomeScore != null).length === 188, "Directional-row count drifted.");
assert(records.filter((record) => record.routingRequired).length === 24, "Routing-row count drifted.");
assert(records.filter((record) => record.priorReviewedMatch).length === 41, "Prior-reviewed row count drifted.");
assert(records.filter((record) => record.provisional).length === 7, "Provisional-row count drifted.");
assert(records.filter((record) => record.publishStatus === "hold-recent-provisional").length === 6, "Recent-hold count drifted.");
assert(records.filter((record) => record.mergeExclude).length === 10, "Merge-row count drifted.");
assert(records.filter((record) => record.databaseImportAuthorized).length === 188, "Import-authorized count drifted.");
assert(records.filter((record) => record.researchBeforePublic).length === 0, "Research-before-public rows remain.");

assert(batch.canonicalImports === 0, "Canonical imports occurred.");
assert(batch.playerImports === 0, "Player imports occurred.");
assert(batch.teamRegistryWrites === 0, "Team-registry writes occurred.");
assert(batch.relationshipWrites === 0, "Relationship writes occurred.");
assert(batch.routeDataWrites === 0, "Route-data writes occurred.");
assert(batch.automaticMerges === 0, "Automatic merges occurred.");
assert(batch.automaticRoutes === 0, "Automatic routes occurred.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "8A",
  reviewedRows: records.length,
  directionalRows: records.filter((record) => record.outcomeScore != null).length,
  publicCandidates: records.filter((record) => record.publicCandidate).length,
  privateNoindexArchive: records.filter((record) => record.privateNoindexArchive).length,
  mergeExclude: records.filter((record) => record.mergeExclude).length,
  routingRequiredRows: records.filter((record) => record.routingRequired).length,
  priorReviewedMatchRows: records.filter((record) => record.priorReviewedMatch).length,
  provisionalRows: records.filter((record) => record.provisional).length,
  recentProvisionalHolds: records.filter((record) => record.publishStatus === "hold-recent-provisional").length,
  standaloneImportAuthorizedRows: records.filter((record) => record.databaseImportAuthorized).length,
  researchBlockers: 0,
  uniquePublicSummaries: publicSummaries.size,
  uniquePublicAnalyses: publicAnalyses.size,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  recordsSha256: batch.recordsSha256,
}, null, 2));
