#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const args = parseArgs(process.argv);
for (const required of [
  "preview-json",
  "trades-json",
  "receipt-json",
  "output-json",
  "output-csv",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [previewBytes, storeBytes, receiptBytes] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["trades-json"]),
  readFile(args["receipt-json"]),
]);

const preview = JSON.parse(previewBytes.toString("utf8"));
const store = JSON.parse(storeBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));

if (receipt.sourcePreviewSha256 !== sha256(previewBytes)) {
  throw new Error("Receipt does not match the regenerated repaired preview.");
}
if (receipt.postImportStoreSha256 !== sha256(storeBytes)) {
  throw new Error("Receipt does not match the committed canonical store.");
}

const storeBySourceTradeId = new Map(
  store.map((record) => [record.sourceTradeId, record]),
);
const rows = [];
let exactExisting = 0;
let wouldInsert = 0;
let wouldUpdate = 0;
let conflicts = 0;

for (const previewRecord of preview.records) {
  const existing = storeBySourceTradeId.get(previewRecord.sourceTradeId);
  if (!existing) {
    wouldInsert += 1;
    rows.push([
      previewRecord.sourceTradeId,
      previewRecord.id,
      "would-insert",
      "No canonical store record exists for this source Trade ID.",
    ]);
    continue;
  }

  const expected = {
    ...previewRecord,
    updatedAt: receipt.importedAt,
    canonicalImportPerformed: true,
    importMetadata: {
      phase: "2K",
      batchId: preview.batchId,
      importedAt: receipt.importedAt,
      sourcePreviewSha256: receipt.sourcePreviewSha256,
      sourceCheckpoint: receipt.startingHead,
      visibilityPolicy: "private-noindex-ad-free",
    },
  };

  const same = JSON.stringify(stable(existing)) === JSON.stringify(stable(expected));
  if (same) {
    exactExisting += 1;
    rows.push([
      previewRecord.sourceTradeId,
      previewRecord.id,
      "exact-existing",
      "Store record is byte-semantically identical to the approved preview plus Phase 2K import metadata.",
    ]);
  } else if (
    existing.id === previewRecord.id &&
    existing.canonicalKey === previewRecord.canonicalKey
  ) {
    wouldUpdate += 1;
    rows.push([
      previewRecord.sourceTradeId,
      previewRecord.id,
      "would-update",
      "Identity matches, but content differs.",
    ]);
  } else {
    conflicts += 1;
    rows.push([
      previewRecord.sourceTradeId,
      previewRecord.id,
      "conflict",
      "Source Trade ID exists with a different canonical identity.",
    ]);
  }
}

const previewSourceIds = new Set(
  preview.records.map((record) => record.sourceTradeId),
);
const unexpectedStoreRecords = store.filter(
  (record) => !previewSourceIds.has(record.sourceTradeId),
).length;

const result = {
  mode: "DRY_RUN_CANONICAL_IDEMPOTENCE_AUDIT_ONLY",
  phase: "2L",
  batchId: preview.batchId,
  counts: {
    previewRecords: preview.records.length,
    storeRecords: store.length,
    exactExisting,
    wouldInsert,
    wouldUpdate,
    conflicts,
    unexpectedStoreRecords,
  },
  idempotent: (
    exactExisting === preview.records.length &&
    wouldInsert === 0 &&
    wouldUpdate === 0 &&
    conflicts === 0 &&
    unexpectedStoreRecords === 0
  ),
  sourcePreviewSha256: sha256(previewBytes),
  canonicalStoreSha256: sha256(storeBytes),
  receiptSha256: sha256(receiptBytes),
  repositoryWrites: false,
  canonicalWrites: false,
  automaticMerges: false,
};

if (!result.idempotent) {
  throw new Error(`Canonical idempotence audit failed:\n${JSON.stringify(result, null, 2)}`);
}

await mkdir(path.dirname(args["output-json"]), { recursive: true });
await mkdir(path.dirname(args["output-csv"]), { recursive: true });
await writeFile(args["output-json"], `${JSON.stringify(result, null, 2)}\n`, "utf8");

const headers = ["Source Trade ID", "Canonical ID", "Disposition", "Notes"];
await writeFile(
  args["output-csv"],
  `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
  "utf8",
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2L",
  ...result.counts,
  idempotent: result.idempotent,
  repositoryWrites: false,
  canonicalWrites: false,
}, null, 2));
