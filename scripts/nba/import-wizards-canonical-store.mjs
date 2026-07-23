#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function atomicWrite(filePath, bytes) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.phase2k-${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

const args = parseArgs(process.argv);
for (const required of [
  "preview-json",
  "trades-json",
  "receipt-json",
  "expected-preview-sha256",
  "imported-at",
  "starting-head",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const expectedPreviewSha256 = args["expected-preview-sha256"].toLowerCase();
const [previewBytes, currentStoreBytes] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["trades-json"]),
]);

const actualPreviewSha256 = sha256(previewBytes);
assert(
  actualPreviewSha256 === expectedPreviewSha256,
  `Structured preview hash mismatch. Expected=${expectedPreviewSha256} Actual=${actualPreviewSha256}`,
);

const preview = JSON.parse(previewBytes.toString("utf8"));
const currentStore = JSON.parse(currentStoreBytes.toString("utf8"));

assert(
  preview.mode === "DRY_RUN_STRUCTURED_CANONICAL_REPAIR_PREVIEW_ONLY",
  `Unexpected preview mode: ${preview.mode}`,
);
assert(Array.isArray(preview.records), "Preview records must be an array.");
assert(preview.records.length === 27, "Expected exactly 27 preview records.");
assert(preview.counts?.schemaValidRecords === 27, "All 27 preview records must be schema-valid.");
assert(preview.counts?.sourcePerspectives === 29, "Expected 29 source perspectives.");
assert(preview.counts?.auditedAssetLedgerEntries === 145, "Expected 145 asset-ledger entries.");
assert(preview.counts?.pickSwapContracts === 6, "Expected six pick-swap contracts.");
assert(preview.counts?.unresolvedAssetRoutingEntries === 32, "Expected 32 unresolved routing entries.");
assert(preview.canonicalImports === 0, "Preview must report zero canonical imports.");
assert(preview.repositoryWrites === false, "Preview must report no repository writes.");
assert(preview.automaticMerges === false, "Automatic merging must remain disabled.");

assert(Array.isArray(currentStore), "Canonical trade store must be a JSON array.");
assert(
  currentStore.length === 0,
  `Phase 2K is the guarded first import and requires an empty canonical store; found ${currentStore.length} records.`,
);

const importedAt = args["imported-at"];
const importMetadata = {
  phase: "2K",
  batchId: preview.batchId,
  importedAt,
  sourcePreviewSha256: actualPreviewSha256,
  sourceCheckpoint: args["starting-head"],
  visibilityPolicy: "private-noindex-ad-free",
};

const importedRecords = preview.records.map((record) => ({
  ...record,
  updatedAt: importedAt,
  canonicalImportPerformed: true,
  importMetadata: { ...importMetadata },
}));

const ids = new Set();
const slugs = new Set();
const canonicalKeys = new Set();
const sourceTradeIds = new Set();

for (const record of importedRecords) {
  assert(record.publishStatus === "private", `${record.sourceTradeId}: publishStatus must be private.`);
  assert(record.reviewStatus === "manual-review", `${record.sourceTradeId}: reviewStatus must be manual-review.`);
  assert(record.indexEligible === false, `${record.sourceTradeId}: indexEligible must be false.`);
  assert(record.adEligible === false, `${record.sourceTradeId}: adEligible must be false.`);
  assert(record.publicationReady === false, `${record.sourceTradeId}: publicationReady must be false.`);
  assert(record.automaticMerge === false, `${record.sourceTradeId}: automaticMerge must be false.`);
  assert(record.canonicalImportPerformed === true, `${record.sourceTradeId}: import flag was not set.`);
  assert(record.verdict, `${record.sourceTradeId}: canonical verdict is missing.`);
  assert(Array.isArray(record.assetLedger) && record.assetLedger.length > 0, `${record.sourceTradeId}: asset ledger is empty.`);

  assert(!ids.has(record.id), `Duplicate canonical ID: ${record.id}`);
  assert(!slugs.has(record.slug), `Duplicate canonical slug: ${record.slug}`);
  assert(!canonicalKeys.has(record.canonicalKey), `Duplicate canonical key: ${record.canonicalKey}`);
  assert(!sourceTradeIds.has(record.sourceTradeId), `Duplicate source Trade ID: ${record.sourceTradeId}`);

  ids.add(record.id);
  slugs.add(record.slug);
  canonicalKeys.add(record.canonicalKey);
  sourceTradeIds.add(record.sourceTradeId);
}

const storeText = `${JSON.stringify(importedRecords, null, 2)}\n`;
const storeBytes = Buffer.from(storeText, "utf8");
const preImportStoreSha256 = sha256(currentStoreBytes);
const postImportStoreSha256 = sha256(storeBytes);

const receipt = {
  schemaVersion: 1,
  phase: "2K",
  result: "PASS",
  batchId: preview.batchId,
  importedAt,
  startingHead: args["starting-head"],
  sourcePreviewSha256: actualPreviewSha256,
  preImportStoreSha256,
  postImportStoreSha256,
  importedCanonicalRecords: importedRecords.length,
  sourcePerspectives: importedRecords.reduce(
    (sum, record) => sum + Object.keys(record.perspectives ?? {}).length,
    0,
  ),
  assetLedgerEntries: importedRecords.reduce(
    (sum, record) => sum + record.assetLedger.length,
    0,
  ),
  pickSwapContracts: importedRecords.reduce(
    (sum, record) => sum + record.assetLedger.filter((asset) => asset.type === "pick_swap").length,
    0,
  ),
  unresolvedAssetRoutingEntries: importedRecords.reduce(
    (sum, record) => sum + record.unresolvedAssetRouting.length,
    0,
  ),
  privateRecords: importedRecords.filter((record) => record.publishStatus === "private").length,
  noindexRecords: importedRecords.filter((record) => record.indexEligible === false).length,
  adFreeRecords: importedRecords.filter((record) => record.adEligible === false).length,
  publicationReadyRecords: importedRecords.filter((record) => record.publicationReady === true).length,
  automaticMergesPerformed: 0,
  playerStoreModified: false,
  canonicalIds: importedRecords.map((record) => record.id),
  sourceTradeIds: importedRecords.map((record) => record.sourceTradeId),
};

const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");

await atomicWrite(args["trades-json"], storeBytes);
await atomicWrite(args["receipt-json"], receiptBytes);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2K",
  importedCanonicalRecords: receipt.importedCanonicalRecords,
  sourcePerspectives: receipt.sourcePerspectives,
  assetLedgerEntries: receipt.assetLedgerEntries,
  pickSwapContracts: receipt.pickSwapContracts,
  unresolvedAssetRoutingEntries: receipt.unresolvedAssetRoutingEntries,
  privateRecords: receipt.privateRecords,
  noindexRecords: receipt.noindexRecords,
  adFreeRecords: receipt.adFreeRecords,
  publicationReadyRecords: receipt.publicationReadyRecords,
  preImportStoreSha256,
  postImportStoreSha256,
  sourcePreviewSha256: actualPreviewSha256,
  automaticMergesPerformed: 0,
  playerStoreModified: false,
}, null, 2));
