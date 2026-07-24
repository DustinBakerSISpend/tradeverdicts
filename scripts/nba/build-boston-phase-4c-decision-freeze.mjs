#!/usr/bin/env node
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
function assert(value, message) { if (!value) throw new Error(message); }
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((key) => csv(row[key])).join(","))].join("\r\n") + "\r\n";
}
function applySourceOverride(record, sourceOverride) {
  const clone = structuredClone(record);
  if (!sourceOverride) return clone;

  if (sourceOverride.overrideKind === "replace-asset-ledger") {
    clone.assetsReceived = structuredClone(sourceOverride.assetsReceived ?? []);
    clone.assetsSent = structuredClone(sourceOverride.assetsSent ?? []);
    clone.assetLedger = [...clone.assetsReceived, ...clone.assetsSent];
  }

  if (Array.isArray(sourceOverride.removeAssetIds)) {
    const removed = new Set(sourceOverride.removeAssetIds);
    clone.assetsReceived = clone.assetsReceived.filter((asset) => !removed.has(asset.assetId));
    clone.assetsSent = clone.assetsSent.filter((asset) => !removed.has(asset.assetId));
    clone.assetLedger = clone.assetLedger.filter((asset) => !removed.has(asset.assetId));
  }

  for (const correction of sourceOverride.assetReclassifications ?? []) {
    for (const asset of clone.assetLedger) {
      if (asset.assetId === correction.assetId) Object.assign(asset, correction);
    }
    for (const asset of clone.assetsReceived) {
      if (asset.assetId === correction.assetId) Object.assign(asset, correction);
    }
    for (const asset of clone.assetsSent) {
      if (asset.assetId === correction.assetId) Object.assign(asset, correction);
    }
  }

  clone.phase4CSourceOverride = sourceOverride;
  clone.unclassifiedAssetCount = clone.assetLedger.filter(
    (asset) => asset.type === "other" || asset.status === "unclassified",
  ).length;
  return clone;
}

const args = parseArgs(process.argv);
for (const required of ["preview-json", "decisions-json", "output-dir"]) {
  assert(args[required], `Missing --${required}`);
}

const [previewBytes, decisionBytes] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["decisions-json"]),
]);
const preview = JSON.parse(previewBytes.toString("utf8"));
const manifest = JSON.parse(decisionBytes.toString("utf8"));

assert(preview.result === "PASS" && preview.phase === "4B", "Invalid Phase 4B preview.");
assert(manifest.phase === "4C", "Invalid Phase 4C manifest.");
assert(preview.records.length === 223, "Phase 4B source count changed.");
assert(manifest.decisions.length === 223, "Phase 4C decision count changed.");
assert(
  preview.hashes.previewRecordsSha256 === manifest.sourcePreview.previewRecordsSha256,
  "Phase 4B preview-record hash drifted.",
);

const previewById = new Map(preview.records.map((record) => [record.sourceTradeId, record]));
const finalRecords = [];

for (const decision of manifest.decisions) {
  const source = previewById.get(decision.sourceTradeId);
  assert(source, `${decision.sourceTradeId}: missing from Phase 4B preview.`);
  assert(source.tradeDate === decision.tradeDate, `${decision.sourceTradeId}: date drift.`);
  assert(source.transactionFingerprint === decision.expectedTransactionFingerprint, `${decision.sourceTradeId}: fingerprint drift.`);
  assert(source.sourcePerspectiveKey === decision.expectedSourcePerspectiveKey, `${decision.sourceTradeId}: perspective-key drift.`);
  assert(source.provisionalCanonicalId === decision.expectedProvisionalCanonicalId, `${decision.sourceTradeId}: provisional-ID drift.`);
  assert(source.candidateAction === decision.expectedPhase4BAction, `${decision.sourceTradeId}: Phase 4B action drift.`);

  const corrected = applySourceOverride(source, decision.sourceOverride);
  const finalRecord = {
    ...corrected,
    phase4CDecision: decision.phase4CDecision,
    nextPhase: decision.nextPhase,
    targetIdentity: decision.targetIdentity,
    sharedCanonicalGroup: decision.sharedCanonicalGroup ?? null,
    atlantaSourceTradeId: decision.atlantaSourceTradeId ?? null,
    phase4CReason: decision.reason,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    automaticMerge: false,
  };

  if (decision.phase4CDecision === "approve-new-canonical-identity") {
    assert(finalRecord.unclassifiedAssetCount === 0, `${decision.sourceTradeId}: approved new identity still has an unclassified asset.`);
  }
  finalRecords.push(finalRecord);
}

const categories = {
  approvedNew: finalRecords.filter((record) => record.phase4CDecision === "approve-new-canonical-identity"),
  approvedPerspectives: finalRecords.filter((record) => record.phase4CDecision === "approve-existing-canonical-perspective"),
  routingHolds: finalRecords.filter((record) => record.phase4CDecision.includes("routing")),
  excluded: finalRecords.filter((record) => record.phase4CDecision === "exclude-nonstandalone"),
};

assert(categories.approvedNew.length === 183, "Expected 183 approved new identities.");
assert(categories.approvedPerspectives.length === 10, "Expected 10 approved perspective targets.");
assert(categories.routingHolds.length === 18, "Expected 18 routing holds.");
assert(categories.excluded.length === 12, "Expected 12 excluded rows.");
assert(
  categories.approvedNew.length + categories.approvedPerspectives.length +
  categories.routingHolds.length + categories.excluded.length === 223,
  "Phase 4C categories do not total 223.",
);

const targetCounts = new Map();
for (const record of categories.approvedPerspectives) {
  assert(record.targetIdentity, `${record.sourceTradeId}: missing existing canonical target.`);
  targetCounts.set(record.targetIdentity, (targetCounts.get(record.targetIdentity) ?? 0) + 1);
}
assert([...targetCounts.values()].every((count) => count === 1), "Duplicate Boston perspective target.");

const identityIds = [
  ...categories.approvedNew.map((record) => record.targetIdentity),
  ...categories.approvedPerspectives.map((record) => record.targetIdentity),
];
assert(identityIds.every(Boolean), "Approved identity target missing.");

const summary = {
  result: "PASS",
  phase: "4C",
  mode: "CANONICAL_RECONCILIATION_DECISION_FREEZE",
  sourceRows: 223,
  approvedNewCanonicalIdentities: categories.approvedNew.length,
  approvedExistingCanonicalPerspectives: categories.approvedPerspectives.length,
  routingHolds: categories.routingHolds.length,
  excludedNonStandalone: categories.excluded.length,
  sourceOverrides: manifest.counts.sourceOverrides,
  unresolvedParserHolds: 0,
  unresolvedEvidenceHolds: 0,
  automaticMerges: 0,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const row = (record) => ({
  sourceTradeId: record.sourceTradeId,
  tradeDate: record.tradeDate,
  teams: record.teams.join(" | "),
  phase4CDecision: record.phase4CDecision,
  targetIdentity: record.targetIdentity ?? "",
  nextPhase: record.nextPhase,
  sourceOverride: record.phase4CSourceOverride?.overrideKind ?? "",
  reason: record.phase4CReason,
});

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDir, "boston-celtics-phase-4c-decision-freeze.json"), `${JSON.stringify({ ...summary, records: finalRecords }, null, 2)}\n`, "utf8"),
  writeFile(path.join(outputDir, "boston-celtics-phase-4c-approved-new.csv"), toCsv(categories.approvedNew.map(row)), "utf8"),
  writeFile(path.join(outputDir, "boston-celtics-phase-4c-approved-perspectives.csv"), toCsv(categories.approvedPerspectives.map(row)), "utf8"),
  writeFile(path.join(outputDir, "boston-celtics-phase-4c-routing-holds.csv"), toCsv(categories.routingHolds.map(row)), "utf8"),
  writeFile(path.join(outputDir, "boston-celtics-phase-4c-excluded.csv"), toCsv(categories.excluded.map(row)), "utf8"),
  writeFile(path.join(outputDir, "boston-celtics-phase-4c-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
]);

console.log(JSON.stringify(summary, null, 2));
