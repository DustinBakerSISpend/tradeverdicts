#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createNbaTeamRegistry, loadNbaTeams } from "../../src/lib/nba/team-registry.mjs";
import { validateCanonicalNbaTrade } from "../../src/lib/nba/validate-canonical-trade.mjs";

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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const args = parseArgs(process.argv);
for (const required of [
  "preview-json",
  "trades-json",
  "players-json",
  "receipt-json",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [previewBytes, storeBytes, playerBytes, receiptBytes] = await Promise.all([
  readFile(args["preview-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["receipt-json"]),
]);

const preview = JSON.parse(previewBytes.toString("utf8"));
const store = JSON.parse(storeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));

assert(Array.isArray(store), "Canonical store must be an array.");
assert(Array.isArray(players), "Player store must be an array.");
assert(receipt.phase === "2K" && receipt.result === "PASS", "Invalid Phase 2K receipt.");
assert(receipt.sourcePreviewSha256 === sha256(previewBytes), "Receipt preview hash mismatch.");
assert(receipt.postImportStoreSha256 === sha256(storeBytes), "Receipt store hash mismatch.");
assert(receipt.importedCanonicalRecords === 27, "Receipt must contain 27 imports.");
assert(receipt.sourcePerspectives === 29, "Receipt must contain 29 source perspectives.");
assert(receipt.assetLedgerEntries === 145, "Receipt must contain 145 asset-ledger entries.");
assert(receipt.pickSwapContracts === 6, "Receipt must contain six pick-swap contracts.");
assert(receipt.unresolvedAssetRoutingEntries === 32, "Receipt routing count mismatch.");
assert(receipt.publicationReadyRecords === 0, "No imported record may be publication-ready.");
assert(receipt.automaticMergesPerformed === 0, "Automatic merges must remain zero.");
assert(receipt.playerStoreModified === false, "Receipt must say player store was untouched.");

const storeBySourceTradeId = new Map(store.map((record) => [record.sourceTradeId, record]));
assert(storeBySourceTradeId.size === store.length, "Global source Trade IDs are not unique.");

const imported = receipt.sourceTradeIds.map((sourceTradeId) => {
  const record = storeBySourceTradeId.get(sourceTradeId);
  assert(record, `Imported record is missing from canonical store: ${sourceTradeId}`);
  return record;
});
assert(imported.length === 27, "Expected 27 imported records.");

const previewBySourceTradeId = new Map(
  preview.records.map((record) => [record.sourceTradeId, record]),
);
for (const record of imported) {
  const previewRecord = previewBySourceTradeId.get(record.sourceTradeId);
  assert(previewRecord, `Preview record missing for ${record.sourceTradeId}`);

  const expectedRecord = {
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

  assert(
    JSON.stringify(stable(record)) === JSON.stringify(stable(expectedRecord)),
    `${record.sourceTradeId}: canonical store record differs from the approved repaired preview.`,
  );
}

const globalIds = new Set(store.map((record) => record.id));
const globalSlugs = new Set(store.map((record) => record.slug));
const globalKeys = new Set(store.map((record) => record.canonicalKey));
assert(globalIds.size === store.length, "Duplicate canonical IDs exist in the store.");
assert(globalSlugs.size === store.length, "Duplicate canonical slugs exist in the store.");
assert(globalKeys.size === store.length, "Duplicate canonical keys exist in the store.");

const registry = createNbaTeamRegistry(await loadNbaTeams());
const validation = imported.map((record) => ({
  id: record.id,
  sourceTradeId: record.sourceTradeId,
  ...validateCanonicalNbaTrade(record, registry),
}));
const invalid = validation.filter((result) => !result.valid);
assert(invalid.length === 0, `Imported schema validation failed:\n${JSON.stringify(invalid, null, 2)}`);

const sourcePerspectives = imported.reduce(
  (sum, record) => sum + Object.keys(record.perspectives ?? {}).length,
  0,
);
const assetLedgerEntries = imported.reduce(
  (sum, record) => sum + record.assetLedger.length,
  0,
);
const pickSwapContracts = imported.reduce(
  (sum, record) => sum + record.assetLedger.filter((asset) => asset.type === "pick_swap").length,
  0,
);
const unresolvedAssetRoutingEntries = imported.reduce(
  (sum, record) => sum + record.unresolvedAssetRouting.length,
  0,
);
const sharedPerspectiveRecords = imported.filter(
  (record) => Object.keys(record.perspectives ?? {}).length === 2,
);
const contaminatedIdentities = imported.flatMap((record) =>
  record.assetLedger.filter(
    (asset) =>
      ["player", "draft_rights"].includes(asset.type) &&
      /[()#]/u.test(asset.playerName ?? ""),
  ),
);

assert(sourcePerspectives === 29, "Imported source perspective count mismatch.");
assert(assetLedgerEntries === 145, "Imported asset-ledger count mismatch.");
assert(pickSwapContracts === 6, "Imported pick-swap count mismatch.");
assert(unresolvedAssetRoutingEntries === 32, "Imported unresolved-routing count mismatch.");
assert(sharedPerspectiveRecords.length === 2, "Expected two Lakers/Wizards shared records.");
assert(contaminatedIdentities.length === 0, "Player or draft-rights identities remain contaminated.");
assert(imported.every((record) => record.publishStatus === "private"), "A record is not private.");
assert(imported.every((record) => record.reviewStatus === "manual-review"), "A record is not manual-review.");
assert(imported.every((record) => record.indexEligible === false), "A record is index-eligible.");
assert(imported.every((record) => record.adEligible === false), "A record is ad-eligible.");
assert(imported.every((record) => record.publicationReady === false), "A record is publication-ready.");
assert(imported.every((record) => record.automaticMerge === false), "A record enables automatic merging.");
assert(imported.every((record) => record.canonicalImportPerformed === true), "A record lacks its import flag.");

if (args["require-empty-players"] === "true") {
  assert(players.length === 0, `Player store changed unexpectedly; found ${players.length} records.`);
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "2K",
  canonicalStoreRecords: store.length,
  importedCanonicalRecords: imported.length,
  schemaValidImportedRecords: validation.length,
  sourcePerspectives,
  sharedPerspectiveRecords: sharedPerspectiveRecords.length,
  assetLedgerEntries,
  pickSwapContracts,
  unresolvedAssetRoutingEntries,
  privateRecords: imported.filter((record) => record.publishStatus === "private").length,
  noindexRecords: imported.filter((record) => record.indexEligible === false).length,
  adFreeRecords: imported.filter((record) => record.adEligible === false).length,
  publicationReadyRecords: imported.filter((record) => record.publicationReady === true).length,
  contaminatedPlayerIdentities: contaminatedIdentities.length,
  playerStoreRecords: players.length,
  storeSha256: sha256(storeBytes),
  receiptSha256: sha256(receiptBytes),
  automaticMergesPerformed: 0,
}, null, 2));
