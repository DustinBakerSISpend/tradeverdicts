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
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)));
}
function decisionFor(record) {
  switch (record.candidateAction) {
    case "create-new-canonical-preview":
      return {
        phase5CDecision: "approve-new-canonical-identity",
        nextPhase: "identity-and-canonical-packaging",
        targetIdentity: record.provisionalCanonicalId,
        reason: "Phase 5B found no current canonical or unresolved cross-team identity conflict.",
      };
    case "add-nets-perspective-to-existing-canonical-preview":
      return {
        phase5CDecision: "approve-existing-canonical-perspective",
        nextPhase: "existing-canonical-perspective-packaging",
        targetIdentity: record.existingCanonicalMatch,
        reason: "Phase 5B found one unique semantic current-canonical match.",
      };
    case "hold-new-canonical-routing":
      return {
        phase5CDecision: "hold-routing",
        nextPhase: "multi-team-routing-freeze",
        targetIdentity: record.provisionalCanonicalId,
        reason: "Explicit team-by-team asset routing must be frozen before packaging.",
      };
    case "hold-new-canonical-evidence":
      return {
        phase5CDecision: "hold-evidence",
        nextPhase: "research-resolution",
        targetIdentity: null,
        reason: "The audited row remains insufficiently supported for canonical creation.",
      };
    case "hold-new-canonical-parser":
      return {
        phase5CDecision: "hold-parser",
        nextPhase: "asset-parser-resolution",
        targetIdentity: record.provisionalCanonicalId,
        reason: "One or more audited assets remain unclassified.",
      };
    case "hold-new-canonical-provisional":
    case "hold-existing-canonical-provisional":
      return {
        phase5CDecision: "hold-provisional",
        nextPhase: "outcome-maturity-review",
        targetIdentity: record.existingCanonicalMatch ?? record.provisionalCanonicalId ?? null,
        reason: "The transaction or Nets perspective remains too recent or low-confidence to authorize.",
      };
    case "hold-for-existing-same-day-collision-review":
      return {
        phase5CDecision: "hold-existing-collision",
        nextPhase: "manual-canonical-collision-resolution",
        targetIdentity: null,
        reason: "The same date/team key exists, but the asset semantics do not support automatic reconciliation.",
      };
    case "hold-for-cross-team-source-reconciliation":
      return {
        phase5CDecision: "hold-cross-team-reconciliation",
        nextPhase: "manual-cross-team-source-resolution",
        targetIdentity: null,
        reason: "Atlanta or Boston contains a same-date/team reviewed source collision that is not a unique semantic match.",
      };
    case "exclude-from-standalone-canonical-preview":
      return {
        phase5CDecision: "exclude-non-standalone",
        nextPhase: "administrative-preservation",
        targetIdentity: null,
        reason: "The row is a follow-up, duplicate variant, or voided record and is not a standalone canonical transaction.",
      };
    default:
      throw new Error(`${record.sourceTradeId}: unsupported Phase 5B action ${record.candidateAction}`);
  }
}
function manifestCounts(decisions) {
  const decisionCounts = countBy(decisions.map((record) => record.phase5CDecision));
  return {
    sourceRows: decisions.length,
    approvedNewCanonicalIdentities: decisionCounts["approve-new-canonical-identity"] ?? 0,
    approvedExistingCanonicalPerspectives: decisionCounts["approve-existing-canonical-perspective"] ?? 0,
    routingHolds: decisionCounts["hold-routing"] ?? 0,
    evidenceHolds: decisionCounts["hold-evidence"] ?? 0,
    parserHolds: decisionCounts["hold-parser"] ?? 0,
    provisionalHolds: decisionCounts["hold-provisional"] ?? 0,
    existingCollisionHolds: decisionCounts["hold-existing-collision"] ?? 0,
    crossTeamReconciliationHolds: decisionCounts["hold-cross-team-reconciliation"] ?? 0,
    excludedNonStandalone: decisionCounts["exclude-non-standalone"] ?? 0,
    approvedForPackaging:
      (decisionCounts["approve-new-canonical-identity"] ?? 0) +
      (decisionCounts["approve-existing-canonical-perspective"] ?? 0),
    held:
      (decisionCounts["hold-routing"] ?? 0) +
      (decisionCounts["hold-evidence"] ?? 0) +
      (decisionCounts["hold-parser"] ?? 0) +
      (decisionCounts["hold-provisional"] ?? 0) +
      (decisionCounts["hold-existing-collision"] ?? 0) +
      (decisionCounts["hold-cross-team-reconciliation"] ?? 0),
    decisionCounts,
  };
}
function assertExpectedCounts(counts) {
  assert(counts.sourceRows === 251, "Phase 5C source count drifted.");
  assert(counts.approvedNewCanonicalIdentities === 190, "Approved new-canonical count drifted.");
  assert(counts.approvedExistingCanonicalPerspectives === 4, "Approved existing-perspective count drifted.");
  assert(counts.routingHolds === 14, "Routing-hold count drifted.");
  assert(counts.evidenceHolds === 21, "Evidence-hold count drifted.");
  assert(counts.parserHolds === 3, "Parser-hold count drifted.");
  assert(counts.provisionalHolds === 5, "Provisional-hold count drifted.");
  assert(counts.existingCollisionHolds === 4, "Existing-collision hold count drifted.");
  assert(counts.crossTeamReconciliationHolds === 2, "Cross-team reconciliation hold count drifted.");
  assert(counts.excludedNonStandalone === 8, "Excluded non-standalone count drifted.");
  assert(counts.approvedForPackaging === 194, "Packaging authorization count drifted.");
  assert(counts.held === 49, "Held source count drifted.");
  assert(
    counts.approvedForPackaging + counts.held + counts.excludedNonStandalone === 251,
    "Phase 5C accounting does not total 251."
  );
}

const args = parseArgs(process.argv);
for (const required of [
  "preview-json",
  "decisions-json",
  "contract-md",
  "output-dir",
  "expected-preview-records-sha",
]) assert(args[required], `Missing --${required}`);

const previewBytes = await readFile(args["preview-json"]);
const preview = JSON.parse(previewBytes.toString("utf8"));
const outputDir = path.resolve(args["output-dir"]);
const decisionsPath = path.resolve(args["decisions-json"]);
const contractPath = path.resolve(args["contract-md"]);
await Promise.all([
  mkdir(outputDir, { recursive: true }),
  mkdir(path.dirname(decisionsPath), { recursive: true }),
  mkdir(path.dirname(contractPath), { recursive: true }),
]);

assert(preview.result === "PASS", "Phase 5B preview result is not PASS.");
assert(preview.phase === "5B", "Expected a Phase 5B source preview.");
assert(preview.mode === "DUPLICATE_SAFE_BROOKLYN_NETS_CANONICAL_AND_CROSS_TEAM_PREVIEW", "Unexpected source preview mode.");
assert(Array.isArray(preview.records) && preview.records.length === 251, "Expected 251 source preview records.");
assert(
  preview.hashes.previewRecordsSha256 === args["expected-preview-records-sha"],
  "Phase 5B preview-record hash drifted."
);
assert(preview.counts.clearNewCanonicalPreviews === 190, "Phase 5B clear-new count drifted.");
assert(preview.counts.existingCanonicalPerspectiveRecommendations === 4, "Phase 5B existing-perspective count drifted.");
assert(preview.counts.currentCanonicalProvisionalHolds === 2, "Phase 5B current-provisional count drifted.");
assert(preview.counts.sharedReviewedHolds === 2, "Phase 5B shared-reviewed hold count drifted.");
assert(preview.counts.canonicalDataBlocked === 49, "Phase 5B blocked count drifted.");
assert(preview.counts.unclassifiedAssetCount === 5, "Phase 5B unclassified-asset count drifted.");
assert(preview.counts.blockerRows === 57, "Phase 5B blocker-row count drifted.");

const decisions = preview.records.map((record) => {
  const mapped = decisionFor(record);
  return {
    sourceTradeId: record.sourceTradeId,
    tradeDate: record.tradeDate,
    expectedPhase5BAction: record.candidateAction,
    expectedDuplicateGuardStatus: record.duplicateGuardStatus,
    expectedTransactionFingerprint: record.transactionFingerprint,
    expectedSourcePerspectiveKey: record.sourcePerspectiveKey,
    expectedProvisionalCanonicalId: record.provisionalCanonicalId,
    expectedExistingCanonicalMatch: record.existingCanonicalMatch ?? null,
    phase5CDecision: mapped.phase5CDecision,
    nextPhase: mapped.nextPhase,
    targetIdentity: mapped.targetIdentity,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationAuthorized: false,
    automaticMergeAuthorized: false,
    sourceOverride: null,
    reason: mapped.reason,
  };
});
const counts = manifestCounts(decisions);
assertExpectedCounts(counts);

const decisionsManifest = {
  schemaVersion: 1,
  phase: "5C",
  batchId: "brooklyn-nets-phase-5c",
  sourceBatchId: preview.batchId,
  sourcePreview: {
    phase: "5B",
    previewRecordsSha256: preview.hashes.previewRecordsSha256,
    sourceRows: preview.counts.sourceRows,
    sourcePreviewSha256: sha256(previewBytes),
  },
  policy: {
    privateOnly: true,
    canonicalImportsAuthorized: false,
    playerImportsAuthorized: false,
    relationshipWritesAuthorized: false,
    routeDataWritesAuthorized: false,
    teamRegistryWritesAuthorized: false,
    automaticMergesAuthorized: false,
    publicationAuthorized: false,
    pushAuthorized: false,
    deploymentAuthorized: false,
  },
  counts,
  decisions,
};
const decisionsText = JSON.stringify(decisionsManifest, null, 2) + "\n";

let existingManifest = null;
try {
  existingManifest = JSON.parse((await readFile(decisionsPath)).toString("utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (existingManifest) {
  assert(stable(existingManifest) === stable(decisionsManifest), "Existing Phase 5C decisions manifest does not match regenerated decisions.");
} else {
  await writeFile(decisionsPath, decisionsText, "utf8");
}

const contractText = `# Brooklyn Nets Phase 5C Decision Freeze Contract

## Status

- Phase: 5C
- Source phase: 5B
- Source rows: 251
- Phase 5B preview-record SHA-256: \`${preview.hashes.previewRecordsSha256}\`
- Private-only: yes
- Publication authorized: no
- Push or deployment authorized: no

## Frozen decision partition

- Approve new canonical identities: 190
- Approve Nets perspectives for existing canonicals: 4
- Hold for explicit multi-team routing: 14
- Hold for insufficient evidence: 21
- Hold for asset-parser resolution: 3
- Hold as recent or provisional: 5
- Hold for existing same-day/team collision review: 4
- Hold for Atlanta/Boston source reconciliation: 2
- Exclude as non-standalone administrative rows: 8

The 194 approved records may proceed to private identity or perspective packaging only. The 49 held records remain blocked until their specific gate is resolved. The eight excluded rows remain preserved without standalone canonical creation.

## Safety

This phase authorizes no canonical import, player import, relationship write, route-data write, team-registry write, automatic merge, public indexing, advertising, push, or deployment.
`;
let existingContract = null;
try {
  existingContract = await readFile(contractPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (existingContract != null) {
  assert(existingContract === contractText, "Existing Phase 5C contract does not match regenerated contract.");
} else {
  await writeFile(contractPath, contractText, "utf8");
}

const previewById = new Map(preview.records.map((record) => [record.sourceTradeId, record]));
const finalRecords = decisions.map((decision) => {
  const source = previewById.get(decision.sourceTradeId);
  assert(source, `${decision.sourceTradeId}: missing from Phase 5B preview.`);
  assert(source.tradeDate === decision.tradeDate, `${decision.sourceTradeId}: trade date drifted.`);
  assert(source.candidateAction === decision.expectedPhase5BAction, `${decision.sourceTradeId}: Phase 5B action drifted.`);
  assert(source.duplicateGuardStatus === decision.expectedDuplicateGuardStatus, `${decision.sourceTradeId}: duplicate guard drifted.`);
  assert(source.transactionFingerprint === decision.expectedTransactionFingerprint, `${decision.sourceTradeId}: transaction fingerprint drifted.`);
  assert(source.sourcePerspectiveKey === decision.expectedSourcePerspectiveKey, `${decision.sourceTradeId}: perspective key drifted.`);
  assert(source.provisionalCanonicalId === decision.expectedProvisionalCanonicalId, `${decision.sourceTradeId}: provisional canonical ID drifted.`);
  assert((source.existingCanonicalMatch ?? null) === decision.expectedExistingCanonicalMatch, `${decision.sourceTradeId}: existing canonical match drifted.`);
  return {
    ...source,
    phase5CDecision: decision.phase5CDecision,
    nextPhase: decision.nextPhase,
    targetIdentity: decision.targetIdentity,
    phase5CReason: decision.reason,
    sourceOverride: decision.sourceOverride,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    publicationAuthorized: false,
    automaticMergeAuthorized: false,
  };
});

const freezeCounts = manifestCounts(finalRecords);
assertExpectedCounts(freezeCounts);
const targetNew = finalRecords.filter((record) => record.phase5CDecision === "approve-new-canonical-identity");
const targetExisting = finalRecords.filter((record) => record.phase5CDecision === "approve-existing-canonical-perspective");
assert(new Set(targetNew.map((record) => record.targetIdentity)).size === 190, "Duplicate approved new-canonical target identity.");
assert(new Set(targetExisting.map((record) => record.targetIdentity)).size === 4, "Duplicate approved existing-canonical target identity.");
assert(targetNew.every((record) => record.targetIdentity === record.provisionalCanonicalId), "Approved new-canonical target mismatch.");
assert(targetExisting.every((record) => record.targetIdentity === record.existingCanonicalMatch), "Approved existing-perspective target mismatch.");

const freeze = {
  result: "PASS",
  phase: "5C",
  mode: "BROOKLYN_NETS_CANONICAL_RECONCILIATION_DECISION_FREEZE",
  batchId: decisionsManifest.batchId,
  sourceBatchId: decisionsManifest.sourceBatchId,
  sourcePreview: decisionsManifest.sourcePreview,
  counts: freezeCounts,
  decisionsManifestSha256: sha256(Buffer.from(decisionsText)),
  freezeRecordsSha256: sha256(Buffer.from(stable(finalRecords))),
  policy: decisionsManifest.policy,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  teamRegistryWrites: 0,
  automaticMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
  records: finalRecords,
};

const categories = {
  approvedNewCanonical: finalRecords.filter((record) => record.phase5CDecision === "approve-new-canonical-identity"),
  approvedExistingPerspective: finalRecords.filter((record) => record.phase5CDecision === "approve-existing-canonical-perspective"),
  routingHolds: finalRecords.filter((record) => record.phase5CDecision === "hold-routing"),
  evidenceHolds: finalRecords.filter((record) => record.phase5CDecision === "hold-evidence"),
  parserHolds: finalRecords.filter((record) => record.phase5CDecision === "hold-parser"),
  provisionalHolds: finalRecords.filter((record) => record.phase5CDecision === "hold-provisional"),
  existingCollisionHolds: finalRecords.filter((record) => record.phase5CDecision === "hold-existing-collision"),
  crossTeamHolds: finalRecords.filter((record) => record.phase5CDecision === "hold-cross-team-reconciliation"),
  excluded: finalRecords.filter((record) => record.phase5CDecision === "exclude-non-standalone"),
};
function row(record) {
  return {
    sourceTradeId: record.sourceTradeId,
    tradeDate: record.tradeDate,
    teams: record.teams.join(" | "),
    phase5CDecision: record.phase5CDecision,
    nextPhase: record.nextPhase,
    targetIdentity: record.targetIdentity ?? "",
    candidateAction: record.candidateAction,
    duplicateGuardStatus: record.duplicateGuardStatus,
    unclassifiedAssetCount: record.unclassifiedAssetCount,
    blockers: record.blockers.join(" | "),
    confidence: record.confidence,
    verdict: record.verdict,
  };
}

await Promise.all([
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-decision-freeze.json"), JSON.stringify(freeze, null, 2) + "\n", "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-approved-new-canonical.csv"), toCsv(categories.approvedNewCanonical.map(row)), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-approved-existing-perspectives.csv"), toCsv(categories.approvedExistingPerspective.map(row)), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-routing-holds.csv"), toCsv(categories.routingHolds.map(row)), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-evidence-holds.csv"), toCsv(categories.evidenceHolds.map(row)), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-parser-holds.csv"), toCsv(categories.parserHolds.map(row)), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-provisional-holds.csv"), toCsv(categories.provisionalHolds.map(row)), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-existing-collision-holds.csv"), toCsv(categories.existingCollisionHolds.map(row)), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-cross-team-holds.csv"), toCsv(categories.crossTeamHolds.map(row)), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-excluded.csv"), toCsv(categories.excluded.map(row)), "utf8"),
  writeFile(path.join(outputDir, "brooklyn-nets-phase-5c-summary.json"), JSON.stringify({
    result: freeze.result,
    phase: freeze.phase,
    mode: freeze.mode,
    counts: freeze.counts,
    sourcePreview: freeze.sourcePreview,
    decisionsManifestSha256: freeze.decisionsManifestSha256,
    freezeRecordsSha256: freeze.freezeRecordsSha256,
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
  decisionsManifestSha256: freeze.decisionsManifestSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256,
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
