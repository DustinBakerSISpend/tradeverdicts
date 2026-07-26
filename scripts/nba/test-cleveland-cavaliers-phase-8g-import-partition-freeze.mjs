#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function sha256Json(value) {
  return sha256Bytes(JSON.stringify(value));
}
function parseCsv(bytes, label) {
  let text = bytes.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const finishField = () => { row.push(field); field = ""; };
  const finishRow = () => { finishField(); rows.push(row); row = []; };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") finishField();
    else if (character === "\n") finishRow();
    else if (character === "\r") { if (text[index + 1] === "\n") index += 1; finishRow(); }
    else field += character;
  }
  assert(!quoted, `${label} CSV ended inside a quoted field.`);
  if (field.length > 0 || row.length > 0) finishRow();
  while (rows.length > 0 && rows.at(-1).every((value) => value === "")) rows.pop();
  assert(rows.length >= 1, `${label} CSV is empty.`);
  const headers = rows[0].map((value) => value.trim());
  assert(headers.length > 0 && headers.every(Boolean), `${label} CSV has a blank header.`);
  assert(new Set(headers).size === headers.length, `${label} CSV has duplicate headers.`);
  return rows.slice(1).map((values, rowIndex) => {
    assert(values.length === headers.length, `${label} CSV row ${rowIndex + 2} has an invalid field count.`);
    return Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex]]));
  });
}

const args = parseArgs(process.argv);
for (const required of ["partition-json", "phase8f-freeze-json", "contract-md"]) {
  assert(args[required], `Missing --${required}.`);
}

const phase8FDirectory = path.dirname(args["phase8f-freeze-json"]);
const heldCsvPath = path.join(phase8FDirectory, "cleveland-cavaliers-phase-8f-input-held-records.csv");
const excludedCsvPath = path.join(phase8FDirectory, "cleveland-cavaliers-phase-8f-excluded-followups.csv");
const [partitionBytes, phase8FBytes, contractBytes, heldCsvBytes, excludedCsvBytes] = await Promise.all([
  readFile(args["partition-json"]),
  readFile(args["phase8f-freeze-json"]),
  readFile(args["contract-md"]),
  readFile(heldCsvPath),
  readFile(excludedCsvPath),
]);
const partition = JSON.parse(partitionBytes.toString("utf8"));
const phase8F = JSON.parse(phase8FBytes.toString("utf8"));
const sourceHeldRecords = parseCsv(heldCsvBytes, "Phase 8F input-held records");
const sourceExcludedRecords = parseCsv(excludedCsvBytes, "Phase 8F excluded followups");

assert(partition.result === "PASS" && partition.phase === "8G", "Invalid Phase 8G partition.");
assert(partition.mode === "zero-blocker-final-import-partition-freeze", "Unexpected Phase 8G mode.");
assert(phase8F.result === "PASS" && phase8F.phase === "8F", "Invalid Phase 8F source.");
assert(partition.counts?.sourceRows === 204, "Source count drifted.");
assert(partition.counts?.phase8FEligiblePackages === 150, "Eligible count drifted.");
assert(partition.counts?.finalReadyPackages === 150, "Ready count drifted.");
assert(partition.counts?.remainingHeldPackages === 0, "Held packages must be zero.");
assert(partition.counts?.priorHeldRecords === 44, "Prior-held count drifted.");
assert(partition.counts?.excludedRecords === 10, "Excluded count drifted.");
assert(partition.counts?.proposedPlayerShells === 238, "Shell count drifted.");
assert(partition.counts?.relationshipPreviews === 446, "Relationship count drifted.");
assert(partition.counts?.ambiguousIdentityOccurrences === 0, "Ambiguous identities remain.");
assert(partition.counts?.unsafeIdentityOccurrences === 0, "Unsafe identities remain.");

assert(Array.isArray(partition.finalReadyPackages), "Missing final-ready array.");
assert(partition.finalReadyPackages.length === 150, "Final-ready array drifted.");
assert(Array.isArray(partition.remainingHeldPackages), "Missing held-package array.");
assert(partition.remainingHeldPackages.length === 0, "Held-package array must be empty.");
assert(Array.isArray(partition.priorHeldRecords), "Missing prior-held array.");
assert(partition.priorHeldRecords.length === 44, "Prior-held array drifted.");
assert(Array.isArray(partition.excludedRecords), "Missing excluded array.");
assert(partition.excludedRecords.length === 10, "Excluded array drifted.");
assert(Array.isArray(partition.proposedPlayerShells), "Missing shell array.");
assert(partition.proposedPlayerShells.length === 238, "Shell array drifted.");
assert(Array.isArray(partition.relationshipPreviews), "Missing relationship array.");
assert(partition.relationshipPreviews.length === 446, "Relationship array drifted.");
assert(JSON.stringify(partition.priorHeldRecords) === JSON.stringify(sourceHeldRecords), "Prior-held CSV lineage failed.");
assert(JSON.stringify(partition.excludedRecords) === JSON.stringify(sourceExcludedRecords), "Excluded CSV lineage failed.");

const finalPackageRecordsSha256 = sha256Json(partition.finalReadyPackages);
const priorHeldRecordsSha256 = sha256Json(partition.priorHeldRecords);
const excludedRecordsSha256 = sha256Json(partition.excludedRecords);
const finalProposedPlayerShellsSha256 = sha256Json(partition.proposedPlayerShells);
const finalRelationshipPreviewsSha256 = sha256Json(partition.relationshipPreviews);
const importPartitionSha256 = sha256Json({
  finalReadyPackages: partition.finalReadyPackages,
  remainingHeldPackages: partition.remainingHeldPackages,
  priorHeldRecords: partition.priorHeldRecords,
  excludedRecords: partition.excludedRecords,
  proposedPlayerShells: partition.proposedPlayerShells,
  relationshipPreviews: partition.relationshipPreviews,
});

for (const [actual, expected, label] of [
  [finalPackageRecordsSha256, partition.hashes?.finalPackageRecordsSha256, "Final package"],
  [priorHeldRecordsSha256, partition.hashes?.priorHeldRecordsSha256, "Prior-held"],
  [excludedRecordsSha256, partition.hashes?.excludedRecordsSha256, "Excluded"],
  [finalProposedPlayerShellsSha256, partition.hashes?.finalProposedPlayerShellsSha256, "Final shell"],
  [finalRelationshipPreviewsSha256, partition.hashes?.finalRelationshipPreviewsSha256, "Final relationship"],
  [importPartitionSha256, partition.hashes?.importPartitionSha256, "Import-partition"],
]) {
  assert(actual === expected, `${label} hash failed recomputation.`);
}
assert(partition.hashes?.contractSha256 === sha256Bytes(contractBytes), "Contract hash drifted.");
assert(partition.sourceHashes?.phase8FFileSha256 === sha256Bytes(phase8FBytes), "Phase 8F source-file hash drifted.");
assert(partition.sourceHashes?.phase8FInputHeldCsvSha256 === sha256Bytes(heldCsvBytes), "Phase 8F held CSV hash drifted.");
assert(partition.sourceHashes?.phase8FExcludedFollowupsCsvSha256 === sha256Bytes(excludedCsvBytes), "Phase 8F excluded CSV hash drifted.");
assert(partition.hashes?.finalPackageRecordsSha256 === String(phase8F.hashes?.packageReadinessSha256 ?? "").toUpperCase(), "Phase 8F readiness lineage failed.");
assert(partition.hashes?.finalProposedPlayerShellsSha256 === String(phase8F.hashes?.proposedPlayerShellsSha256 ?? "").toUpperCase(), "Phase 8F shell lineage failed.");
assert(partition.hashes?.finalRelationshipPreviewsSha256 === String(phase8F.hashes?.relationshipPreviewsSha256 ?? "").toUpperCase(), "Phase 8F relationship lineage failed.");

for (const field of [
  "canonicalImports", "playerImports", "teamRegistryWrites", "perspectiveWrites",
  "relationshipWrites", "routeDataWrites", "automaticIdentityMerges", "automaticCanonicalMerges",
]) {
  assert(Number(partition[field]) === 0, `${field} must be zero.`);
}
assert(partition.publicationAuthorized === false, "Publication must remain unauthorized.");
assert(partition.pushPerformed === false, "Push must remain false.");
assert(partition.deployPerformed === false, "Deploy must remain false.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "8G",
  verified: {
    sourceRows: 204,
    finalReadyPackages: 150,
    remainingHeldPackages: 0,
    priorHeldRecords: 44,
    excludedRecords: 10,
    proposedPlayerShells: 238,
    relationshipPreviews: 446,
    ambiguousIdentityOccurrences: 0,
    unsafeIdentityOccurrences: 0,
  },
  hashes: partition.hashes,
  sourceHashes: partition.sourceHashes,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
