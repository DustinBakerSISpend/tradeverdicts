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
function dependencyClass(asset) {
  const text = String(asset).toLowerCase();
  if (/\bcash\b/u.test(text)) return "cash";
  if (/\b(draft|pick|swap)\b/u.test(text)) return "draft-or-swap";
  if (/\bright(s)?\b/u.test(text)) return "rights-or-stash";
  return "player-or-contract-review";
}
function eligibilityKey(tradeId) {
  return `charlotte-hornets:${tradeId.toLowerCase()}`;
}

const args = parseArgs(process.argv);
for (const required of [
  "routing-freeze-json",
  "decision-json",
  "reviewed-json",
  "contract-md",
  "expected-freeze-records-sha",
  "expected-route-edges-sha",
  "expected-decision-records-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}`);
}

const [routingBytes, decisionBytes, reviewedBytes, contractBytes] =
  await Promise.all([
    readFile(args["routing-freeze-json"]),
    readFile(args["decision-json"]),
    readFile(args["reviewed-json"]),
    readFile(args["contract-md"]),
  ]);

const routing = JSON.parse(routingBytes.toString("utf8"));
const decision = JSON.parse(decisionBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(routing.result === "PASS", "Phase 6D routing freeze did not pass.");
assert(routing.phase === "6D", "Unexpected routing phase.");
assert(
  routing.freezeRecordsSha256 === args["expected-freeze-records-sha"],
  "Phase 6D freeze-record hash does not match the checkpoint.",
);
assert(
  routing.routeEdgesSha256 === args["expected-route-edges-sha"],
  "Phase 6D route-edge hash does not match the checkpoint.",
);
assert(
  sha256(JSON.stringify(routing.records)) === routing.freezeRecordsSha256,
  "Phase 6D freeze records do not match their declared hash.",
);
assert(decision.result === "PASS", "Phase 6C decision matrix did not pass.");
assert(decision.phase === "6C", "Unexpected decision phase.");
assert(
  decision.decisionRecordsSha256 === args["expected-decision-records-sha"],
  "Phase 6C decision-record hash does not match the checkpoint.",
);
assert(
  sha256(JSON.stringify(decision.records)) === decision.decisionRecordsSha256,
  "Phase 6C decision records do not match their declared hash.",
);
assert(Array.isArray(reviewed.records), "Reviewed Charlotte records are unavailable.");
assert(reviewed.records.length === 125, "Expected 125 reviewed Charlotte records.");
assert(routing.counts.packagingQueueRecords === 103, "Expected 103 packaging-eligible rows.");
assert(routing.counts.remainingHeldRecords === 20, "Expected 20 held rows.");
assert(routing.counts.excludedNonStandalone === 2, "Expected 2 excluded follow-ups.");

const routingById = new Map(routing.records.map((record) => [record.tradeId, record]));
const decisionById = new Map(decision.records.map((record) => [record.tradeId, record]));
const reviewedById = new Map(reviewed.records.map((record) => [record.tradeId, record]));

assert(routingById.size === 125, "Duplicate Phase 6D trade IDs.");
assert(decisionById.size === 125, "Duplicate Phase 6C trade IDs.");
assert(reviewedById.size === 125, "Duplicate reviewed trade IDs.");
assert(
  JSON.stringify([...routingById.keys()].sort()) ===
    JSON.stringify([...decisionById.keys()].sort()),
  "Phase 6C and Phase 6D trade IDs differ.",
);
assert(
  JSON.stringify([...routingById.keys()].sort()) ===
    JSON.stringify([...reviewedById.keys()].sort()),
  "Reviewed and Phase 6D trade IDs differ.",
);

const eligibilityRecords = [];
const heldRecords = [];
const excludedRecords = [];
const dependencyRows = [];

for (const decisionRecord of decision.records) {
  const routed = routingById.get(decisionRecord.tradeId);
  const source = reviewedById.get(decisionRecord.tradeId);
  assert(routed, `Routing record missing for ${decisionRecord.tradeId}.`);
  assert(source, `Reviewed record missing for ${decisionRecord.tradeId}.`);

  if (decisionRecord.resolutionClass === "administrative-followup") {
    assert(routed.packagingEligible === false, `${decisionRecord.tradeId}: follow-up became eligible.`);
    excludedRecords.push({
      tradeId: decisionRecord.tradeId,
      tradeDate: decisionRecord.tradeDate,
      exclusionClass: "non-standalone-followup",
      recommendedAction: decisionRecord.recommendedAction,
      blockers: routed.blockers,
      canonicalImportAuthorized: false,
    });
    continue;
  }

  if (routed.packagingEligible === true) {
    assert(
      decisionRecord.resolutionClass === "new-canonical-candidate",
      `${decisionRecord.tradeId}: eligible row is not a new-canonical candidate.`,
    );
    assert(
      routed.blockers.length === 1 &&
        routed.blockers[0] === "canonical-create-approval-required",
      `${decisionRecord.tradeId}: eligible row has unexpected blockers.`,
    );

    const eligibility = {
      eligibilityKey: eligibilityKey(decisionRecord.tradeId),
      tradeId: decisionRecord.tradeId,
      tradeDate: decisionRecord.tradeDate,
      sourceTeam: decisionRecord.sourceTeam,
      partnerTeams: decisionRecord.partnerTeams,
      teamCount: decisionRecord.teamCount,
      routingStatus: routed.routingStatus,
      resolutionClass: decisionRecord.resolutionClass,
      recommendedAction: decisionRecord.recommendedAction,
      verdict: decisionRecord.verdict,
      confidence: decisionRecord.confidence,
      sourceTeamGrade: source.sourceTeamGrade,
      partnerAggregateGrade: source.partnerAggregateGrade,
      contentClass: decisionRecord.contentClass,
      lowValueRisk: decisionRecord.lowValueRisk,
      blockers: routed.blockers,
      eligibilityStatus: "frozen-eligible-for-package-construction",
      canonicalIdentityStatus: "unassigned",
      playerDependencyStatus: "not-yet-evaluated",
      canonicalCreateAuthorized: false,
      canonicalImportAuthorized: false,
      publicationAuthorized: false,
    };
    eligibilityRecords.push(eligibility);

    for (const [direction, assets] of [
      ["incoming-to-charlotte", source.sourceTeamAssets],
      ["outgoing-from-charlotte", source.partnerAggregateAssets],
    ]) {
      assert(Array.isArray(assets), `${source.tradeId}: reviewed assets are not arrays.`);
      assets.forEach((asset, index) => {
        dependencyRows.push({
          eligibilityKey: eligibility.eligibilityKey,
          tradeId: source.tradeId,
          tradeDate: source.tradeDate,
          direction,
          ordinal: index + 1,
          rawAsset: asset,
          dependencyClass: dependencyClass(asset),
          playerIdResolutionStatus: "not-evaluated",
          canonicalAssetWriteAuthorized: false,
        });
      });
    }
  } else {
    heldRecords.push({
      tradeId: decisionRecord.tradeId,
      tradeDate: decisionRecord.tradeDate,
      sourceTeam: decisionRecord.sourceTeam,
      partnerTeams: decisionRecord.partnerTeams,
      routingStatus: routed.routingStatus,
      resolutionClass: decisionRecord.resolutionClass,
      recommendedAction: decisionRecord.recommendedAction,
      verdict: decisionRecord.verdict,
      confidence: decisionRecord.confidence,
      blockers: routed.blockers,
      holdStatus: "frozen-held",
      canonicalImportAuthorized: false,
    });
  }
}

eligibilityRecords.sort((left, right) =>
  left.tradeDate.localeCompare(right.tradeDate) ||
  left.tradeId.localeCompare(right.tradeId)
);
heldRecords.sort((left, right) =>
  left.tradeDate.localeCompare(right.tradeDate) ||
  left.tradeId.localeCompare(right.tradeId)
);
excludedRecords.sort((left, right) =>
  left.tradeDate.localeCompare(right.tradeDate) ||
  left.tradeId.localeCompare(right.tradeId)
);
dependencyRows.sort((left, right) =>
  left.tradeDate.localeCompare(right.tradeDate) ||
  left.tradeId.localeCompare(right.tradeId) ||
  left.direction.localeCompare(right.direction) ||
  left.ordinal - right.ordinal
);

assert(eligibilityRecords.length === 103, "Eligibility count drifted.");
assert(heldRecords.length === 20, "Held count drifted.");
assert(excludedRecords.length === 2, "Excluded count drifted.");
assert(
  eligibilityRecords.length + heldRecords.length + excludedRecords.length === 125,
  "Phase 6E row accounting drifted.",
);
assert(
  new Set(eligibilityRecords.map((record) => record.eligibilityKey)).size === 103,
  "Duplicate eligibility keys.",
);
assert(
  eligibilityRecords.every((record) => record.canonicalIdentityStatus === "unassigned"),
  "A canonical identity was assigned.",
);
assert(
  eligibilityRecords.every((record) => record.canonicalCreateAuthorized === false),
  "Canonical creation was authorized.",
);
assert(
  dependencyRows.every((record) => record.canonicalAssetWriteAuthorized === false),
  "An asset write was authorized.",
);

const counts = {
  sourceRows: 125,
  eligibleRows: eligibilityRecords.length,
  heldRows: heldRecords.length,
  excludedRows: excludedRecords.length,
  dependencySeedRows: dependencyRows.length,
  incomingDependencyRows: dependencyRows.filter(
    (record) => record.direction === "incoming-to-charlotte",
  ).length,
  outgoingDependencyRows: dependencyRows.filter(
    (record) => record.direction === "outgoing-from-charlotte",
  ).length,
  dependencyClassCounts: countBy(
    dependencyRows.map((record) => record.dependencyClass),
  ),
  holdClassCounts: countBy(heldRecords.map((record) => record.resolutionClass)),
  holdBlockerCounts: countBy(heldRecords.flatMap((record) => record.blockers)),
  routingStatusCounts: countBy(
    eligibilityRecords.map((record) => record.routingStatus),
  ),
};

const freezeRecords = eligibilityRecords.map((record) => ({
  eligibilityKey: record.eligibilityKey,
  tradeId: record.tradeId,
  tradeDate: record.tradeDate,
  routingStatus: record.routingStatus,
  blockers: record.blockers,
  eligibilityStatus: record.eligibilityStatus,
  canonicalIdentityStatus: record.canonicalIdentityStatus,
  playerDependencyStatus: record.playerDependencyStatus,
}));

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const outputFiles = {
  eligibilityFreezeJson: "charlotte-hornets-phase-6e-import-eligibility-freeze.json",
  eligibleCsv: "charlotte-hornets-phase-6e-eligible-records.csv",
  heldCsv: "charlotte-hornets-phase-6e-held-records.csv",
  excludedCsv: "charlotte-hornets-phase-6e-excluded-followups.csv",
  dependencySeedCsv: "charlotte-hornets-phase-6e-asset-dependency-seed.csv",
  summaryJson: "charlotte-hornets-phase-6e-summary.json",
};

function flatEligible(record) {
  return {
    eligibilityKey: record.eligibilityKey,
    tradeId: record.tradeId,
    tradeDate: record.tradeDate,
    sourceTeam: record.sourceTeam,
    partnerTeams: record.partnerTeams,
    teamCount: record.teamCount,
    routingStatus: record.routingStatus,
    resolutionClass: record.resolutionClass,
    recommendedAction: record.recommendedAction,
    verdict: record.verdict,
    confidence: record.confidence,
    sourceTeamGrade: record.sourceTeamGrade,
    partnerAggregateGrade: record.partnerAggregateGrade,
    contentClass: record.contentClass,
    lowValueRisk: record.lowValueRisk,
    blockers: record.blockers.join(" | "),
    eligibilityStatus: record.eligibilityStatus,
    canonicalIdentityStatus: record.canonicalIdentityStatus,
    playerDependencyStatus: record.playerDependencyStatus,
    canonicalCreateAuthorized: false,
    canonicalImportAuthorized: false,
  };
}
function flatHeld(record) {
  return {
    tradeId: record.tradeId,
    tradeDate: record.tradeDate,
    sourceTeam: record.sourceTeam,
    partnerTeams: record.partnerTeams,
    routingStatus: record.routingStatus,
    resolutionClass: record.resolutionClass,
    recommendedAction: record.recommendedAction,
    verdict: record.verdict,
    confidence: record.confidence,
    blockers: record.blockers.join(" | "),
    holdStatus: record.holdStatus,
    canonicalImportAuthorized: false,
  };
}
function flatExcluded(record) {
  return {
    tradeId: record.tradeId,
    tradeDate: record.tradeDate,
    exclusionClass: record.exclusionClass,
    recommendedAction: record.recommendedAction,
    blockers: record.blockers.join(" | "),
    canonicalImportAuthorized: false,
  };
}

const freeze = {
  result: "PASS",
  phase: "6E",
  mode: "IMPORT_ELIGIBILITY_FREEZE",
  sourceRouting: {
    freezeRecordsSha256: routing.freezeRecordsSha256,
    routeEdgesSha256: routing.routeEdgesSha256,
  },
  sourceDecision: {
    decisionRecordsSha256: decision.decisionRecordsSha256,
  },
  reviewedBatchSha256: sha256(reviewedBytes),
  contractSha256: sha256(contractBytes),
  counts,
  eligibilityRecordsSha256: sha256(JSON.stringify(eligibilityRecords)),
  dependencySeedSha256: sha256(JSON.stringify(dependencyRows)),
  freezeRecordsSha256: sha256(JSON.stringify(freezeRecords)),
  records: freezeRecords,
  outputFiles,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  canonicalIdsAssigned: 0,
  automaticMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const summary = {
  result: "PASS",
  phase: "6E",
  counts,
  eligibilityRecordsSha256: freeze.eligibilityRecordsSha256,
  dependencySeedSha256: freeze.dependencySeedSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256,
  canonicalImports: 0,
  playerImports: 0,
  canonicalIdsAssigned: 0,
  automaticMerges: 0,
};

await Promise.all([
  writeFile(
    path.join(outputDir, outputFiles.eligibilityFreezeJson),
    JSON.stringify(freeze, null, 2) + "\n",
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.eligibleCsv),
    toCsv(eligibilityRecords.map(flatEligible), [
      "eligibilityKey", "tradeId", "tradeDate", "sourceTeam", "partnerTeams",
      "teamCount", "routingStatus", "resolutionClass", "recommendedAction",
      "verdict", "confidence", "sourceTeamGrade", "partnerAggregateGrade",
      "contentClass", "lowValueRisk", "blockers", "eligibilityStatus",
      "canonicalIdentityStatus", "playerDependencyStatus",
      "canonicalCreateAuthorized", "canonicalImportAuthorized",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.heldCsv),
    toCsv(heldRecords.map(flatHeld), [
      "tradeId", "tradeDate", "sourceTeam", "partnerTeams", "routingStatus",
      "resolutionClass", "recommendedAction", "verdict", "confidence",
      "blockers", "holdStatus", "canonicalImportAuthorized",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.excludedCsv),
    toCsv(excludedRecords.map(flatExcluded), [
      "tradeId", "tradeDate", "exclusionClass", "recommendedAction",
      "blockers", "canonicalImportAuthorized",
    ]),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, outputFiles.dependencySeedCsv),
    toCsv(dependencyRows, [
      "eligibilityKey", "tradeId", "tradeDate", "direction", "ordinal",
      "rawAsset", "dependencyClass", "playerIdResolutionStatus",
      "canonicalAssetWriteAuthorized",
    ]),
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
  eligibilityRecordsSha256: freeze.eligibilityRecordsSha256,
  dependencySeedSha256: freeze.dependencySeedSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256,
  outputFiles: freeze.outputFiles,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  canonicalIdsAssigned: 0,
  automaticMerges: 0,
}, null, 2));
