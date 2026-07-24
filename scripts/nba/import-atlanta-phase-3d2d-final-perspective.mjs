#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function uniquePreservingOrder(values) { return [...new Set(values.filter(Boolean))]; }
async function atomicWrite(filePath, bytes, suffix) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${suffix}-${process.pid}.tmp`;
  try {
    await writeFile(temp, bytes);
    await rename(temp, filePath);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}
function immutableProjection(trade) {
  const {
    sourceTeams,
    grades,
    perspectives,
    sources,
    updatedAt,
    perspectiveReconciliations,
    ...immutable
  } = trade;
  return immutable;
}
function sourceSubmission(row, manifest) {
  return {
    submissionId: `atlanta-hawks-phase-3a-${row.tradeId}`,
    batchId: "atlanta-hawks-phase-3a",
    sourceTeam: "atlanta-hawks",
    sourceRowId: row.tradeId,
    sourceFileName: "src/data/nba/raw/atlanta-hawks-phase-3a.txt",
    sourceLabel: "User-provided Atlanta Hawks trade-history batch with Meta/Grok and ChatGPT reconciliation",
    receivedAt: "2026-07-23T00:00:00.000Z",
    rawText: row.sourceRawText,
    rawFields: {
      tradeDate: row.tradeDate,
      teams: manifest.teams,
      partnerTeams: row.partnerTeams,
      assetsReceived: row.assetsReceivedText,
      assetsSent: row.assetsSentText,
      relationshipText: row.relationshipText,
    },
    contentHash: sha256(row.sourceRawText),
  };
}
function externalSource(row) {
  if (!row.externalSourceUrl) return null;
  return {
    sourceType: "external_reference",
    sourceUrl: row.externalSourceUrl,
    sourceLabel: row.sourceBasis,
    reviewStatus: row.reviewStatus,
  };
}
function atlantaPerspective(row) {
  return {
    sourceSubmissionId: `atlanta-hawks-phase-3a-${row.tradeId}`,
    editorialStatus: "reconciled-private-perspective",
    grade: row.sourceTeamGrade,
    verdict: row.verdict,
    summary: row.summary,
    analysis: row.analysis,
    confidence: row.confidence,
    reviewStatus: row.reviewStatus,
    tradeTier: row.tradeTier,
  };
}
function assertExistingPerspective(trade, row, manifest, receipt, currentTradeBytes, currentPlayerBytes) {
  assert(trade.id === manifest.canonicalTradeId, "Trae canonical ID drifted on replay.");
  assert(trade.sourceTeams?.filter((team) => team === "atlanta-hawks").length === 1, "Atlanta source-team reconciliation is missing or duplicated.");
  assert(Object.keys(trade.perspectives ?? {}).filter((team) => team === "atlanta-hawks").length === 1, "Atlanta perspective is missing or duplicated.");
  assert(JSON.stringify(trade.perspectives["atlanta-hawks"]) === JSON.stringify(atlantaPerspective(row)), "Atlanta perspective differs from the reconciled source row.");
  assert(trade.grades?.["atlanta-hawks"] === row.sourceTeamGrade, "Atlanta canonical grade differs from the reconciled source-team grade.");
  const submissions = (trade.sources ?? []).filter((source) => source.submissionId === `atlanta-hawks-phase-3a-${row.tradeId}`);
  assert(submissions.length === 1, "Atlanta source submission is missing or duplicated.");
  assert((trade.perspectiveReconciliations ?? []).length === 1, "Perspective reconciliation metadata is missing or duplicated.");
  const reconciliation = trade.perspectiveReconciliations[0];
  assert(reconciliation.phase === "3D2D" && reconciliation.sourceTradeId === row.tradeId && reconciliation.sourcePerspectiveKey === manifest.sourcePerspectiveKey, "Perspective reconciliation metadata drifted.");
  assert(sha256(currentTradeBytes) === receipt.canonicalStoreSha256, "Canonical store differs from the Phase 3D2D receipt.");
  assert(sha256(currentPlayerBytes) === receipt.playerStoreSha256, "Player store differs from the Phase 3D2D receipt.");
  assert(sha256(canonicalJson(trade)) === receipt.targetPostimageSha256, "Trae target postimage differs from the receipt.");
  assert(sha256(canonicalJson(immutableProjection(trade))) === receipt.targetImmutableProjectionSha256, "An immutable Trae canonical field changed after reconciliation.");
}

const args = parseArgs(process.argv);
for (const required of [
  "freeze-json",
  "reviewed-json",
  "trades-json",
  "players-json",
  "player-receipt-json",
  "canonical-receipt-json",
  "final-receipt-json",
  "expected-freeze-sha256",
  "expected-trade-store-sha256",
  "expected-player-store-sha256",
  "expected-player-receipt-sha256",
  "expected-canonical-receipt-sha256",
  "reconciled-at",
  "starting-head",
]) assert(args[required], `Missing --${required}`);

const [freezeBytes, reviewedBytes, tradeBytes, playerBytes, playerReceiptBytes, canonicalReceiptBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["reviewed-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["player-receipt-json"]),
  readFile(args["canonical-receipt-json"]),
]);
const expectedFreezeSha = args["expected-freeze-sha256"].toLowerCase();
const expectedTradeSha = args["expected-trade-store-sha256"].toLowerCase();
const expectedPlayerSha = args["expected-player-store-sha256"].toLowerCase();
const expectedPlayerReceiptSha = args["expected-player-receipt-sha256"].toLowerCase();
const expectedCanonicalReceiptSha = args["expected-canonical-receipt-sha256"].toLowerCase();
assert(sha256(freezeBytes) === expectedFreezeSha, "Corrected freeze SHA-256 mismatch.");
assert(sha256(playerReceiptBytes) === expectedPlayerReceiptSha, "Phase 3D2B receipt SHA-256 mismatch.");
assert(sha256(canonicalReceiptBytes) === expectedCanonicalReceiptSha, "Phase 3D2C receipt SHA-256 mismatch.");
assert(sha256(playerBytes) === expectedPlayerSha, "Player store changed before perspective reconciliation.");

const freeze = JSON.parse(freezeBytes);
const reviewed = JSON.parse(reviewedBytes);
const currentTrades = JSON.parse(tradeBytes);
const players = JSON.parse(playerBytes);
const playerReceipt = JSON.parse(playerReceiptBytes);
const canonicalReceipt = JSON.parse(canonicalReceiptBytes);
const existingFinalReceiptBytes = await readFile(args["final-receipt-json"]).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));

assert(freeze.result === "PASS" && freeze.phase === "3D1", "Unexpected corrected freeze.");
assert(freeze.counts.sourceRows === 308, "Expected 308 Atlanta source rows.");
assert(freeze.counts.createCanonical === 229 && freeze.counts.updatePerspectiveReconcile === 1, "Corrected freeze action counts drifted.");
assert(freeze.counts.holdPlayerDependency === 15 && freeze.counts.holdPhase3c === 54 && freeze.counts.mergeFollowup === 4 && freeze.counts.excludeDuplicate === 4 && freeze.counts.holdConflict === 1, "Corrected freeze held/excluded counts drifted.");
assert(playerReceipt.result === "PASS" && playerReceipt.phase === "3D2B" && playerReceipt.importedPlayerShells === 442, "Unexpected Phase 3D2B receipt.");
assert(canonicalReceipt.result === "PASS" && canonicalReceipt.phase === "3D2C" && canonicalReceipt.importedCanonicalTrades === 229 && canonicalReceipt.activatedPlayerTradeEdges === 556, "Unexpected Phase 3D2C receipt.");
assert(currentTrades.length === 256, `Expected 256 canonical trades, found ${currentTrades.length}.`);
assert(players.length === 509, `Expected 509 players, found ${players.length}.`);
assert(canonicalReceipt.playerStoreSha256 === sha256(playerBytes), "Phase 3D2C receipt does not own the current player store.");

const updateManifest = freeze.updatePerspectiveManifest;
assert(Array.isArray(updateManifest) && updateManifest.length === 1, "Expected one frozen perspective reconciliation.");
const manifest = updateManifest[0];
assert(manifest.sourceTradeId === "ATL-2026-0300", "Unexpected perspective source row.");
assert(manifest.canonicalTradeId === "nba-trade-20260109-e1724a128785", "Unexpected perspective target canonical.");
assert(manifest.importAction === "update-perspective-reconcile" && manifest.duplicateGuardStatus === "explicit-existing-perspective-match", "Perspective update is not explicitly frozen.");
assert(manifest.automaticMerge === false && manifest.automaticRouting === false, "Perspective reconciliation cannot use automatic merge or routing.");
const rows = reviewed.records.filter((row) => row.tradeId === manifest.sourceTradeId);
assert(rows.length === 1, "Expected one reviewed Atlanta Trae source row.");
const row = rows[0];
assert(row.existingCanonicalMatch === manifest.canonicalTradeId && row.canonicalDisposition === "existing-perspective", "Reviewed Trae row no longer targets the existing canonical.");
assert(row.sourceTeam === "atlanta-hawks" && row.sourceTeamGrade === "D+" && row.partnerAggregateGrade === "A-" && row.verdict === "Partner Win", "Reviewed Trae editorial result drifted.");

const targetIndexes = currentTrades.map((trade, index) => trade.id === manifest.canonicalTradeId ? index : -1).filter((index) => index >= 0);
assert(targetIndexes.length === 1, "Expected exactly one Trae Young canonical trade.");
const targetIndex = targetIndexes[0];
const target = currentTrades[targetIndex];
assert(target.tradeDate === "2026-01-09" && target.dateTeamsKey === manifest.dateTeamsKey, "Trae date/team identity drifted.");
assert(target.teams?.slice().sort().join("|") === manifest.teams.slice().sort().join("|"), "Trae teams drifted.");
assert(target.assetLedger?.length === 3 && target.routingCompleteness === "complete" && target.unresolvedAssetRouting?.length === 0, "Trae asset/routing preimage drifted.");
assert(target.publishStatus === "private" && target.indexEligible === false && target.adEligible === false && target.publicationReady === false && target.automaticMerge === false, "Trae privacy preimage drifted.");

if (existingFinalReceiptBytes !== null) {
  const receipt = JSON.parse(existingFinalReceiptBytes);
  assert(receipt.result === "PASS" && receipt.phase === "3D2D" && receipt.mode === "FINAL_ATLANTA_PERSPECTIVE_RECONCILIATION", "Unexpected Phase 3D2D receipt on replay.");
  assert(receipt.startingHead === args["starting-head"] && receipt.sourceFreezeSha256 === expectedFreezeSha, "Phase 3D2D replay authorization drifted.");
  assert(receipt.preReconciliationCanonicalStoreSha256 === canonicalReceipt.canonicalStoreSha256, "Phase 3D2D replay preimage no longer matches the Phase 3D2C receipt.");
  assertExistingPerspective(target, row, manifest, receipt, tradeBytes, playerBytes);
  console.log(JSON.stringify({
    result: "PASS",
    phase: "3D2D",
    mode: "IDEMPOTENT_REPLAY",
    canonicalTradesAdded: 0,
    perspectivesAdded: 0,
    playerRecordsChanged: 0,
    assetsChanged: 0,
    routesChanged: 0,
    relationshipsChanged: 0,
    repositoryDataWrites: 0,
    canonicalStoreSha256: receipt.canonicalStoreSha256,
    playerStoreSha256: receipt.playerStoreSha256,
    receiptSha256: sha256(existingFinalReceiptBytes),
  }, null, 2));
  process.exit(0);
}

assert(sha256(tradeBytes) === expectedTradeSha, "Canonical-store preimage mismatch.");
assert(canonicalReceipt.canonicalStoreSha256 === expectedTradeSha, "Phase 3D2C receipt does not own the canonical-store preimage.");
assert(sha256(canonicalJson(target)) === "c1f1b0cb22634c4f052403530c587b3f847dab5021c0b3de73e2145f3458d675", "Trae canonical target preimage hash mismatch.");
assert(!(target.sourceTeams ?? []).includes("atlanta-hawks"), "Atlanta source team already exists without a Phase 3D2D receipt.");
assert(!Object.prototype.hasOwnProperty.call(target.perspectives ?? {}, "atlanta-hawks"), "Atlanta perspective already exists without a Phase 3D2D receipt.");
assert(!(target.sources ?? []).some((source) => source.submissionId === `atlanta-hawks-phase-3a-${row.tradeId}`), "Atlanta source submission already exists without a Phase 3D2D receipt.");
assert((target.perspectiveReconciliations ?? []).length === 0, "Unexpected existing perspective reconciliation metadata.");

const beforeImmutableHash = sha256(canonicalJson(immutableProjection(target)));
const submission = sourceSubmission(row, manifest);
const reference = externalSource(row);
const reconciliation = {
  phase: "3D2D",
  sourceTradeId: row.tradeId,
  sourceTeam: "atlanta-hawks",
  reconciledAt: args["reconciled-at"],
  sourceCheckpoint: args["starting-head"],
  sourceFreezeSha256: expectedFreezeSha,
  sourcePerspectiveFreezeSha256: manifest.freezeSha256,
  sourcePerspectiveKey: manifest.sourcePerspectiveKey,
  transactionFingerprint: manifest.transactionFingerprint,
  policy: "explicit-existing-canonical-perspective-only-no-asset-route-or-relationship-change",
};
const updatedTarget = {
  ...target,
  sourceTeams: uniquePreservingOrder([...(target.sourceTeams ?? []), "atlanta-hawks"]),
  grades: { ...(target.grades ?? {}), "atlanta-hawks": row.sourceTeamGrade },
  perspectives: { ...(target.perspectives ?? {}), "atlanta-hawks": atlantaPerspective(row) },
  sources: [...(target.sources ?? []), submission, ...(reference ? [reference] : [])],
  updatedAt: args["reconciled-at"],
  perspectiveReconciliations: [reconciliation],
};
assert(sha256(canonicalJson(immutableProjection(updatedTarget))) === beforeImmutableHash, "Perspective reconciliation changed an immutable canonical field.");
assert(JSON.stringify(updatedTarget.assetLedger) === JSON.stringify(target.assetLedger), "Perspective reconciliation changed the asset ledger.");
assert(JSON.stringify(updatedTarget.assetsReceived) === JSON.stringify(target.assetsReceived), "Perspective reconciliation changed received assets.");
assert(JSON.stringify(updatedTarget.assetsSentByTeam) === JSON.stringify(target.assetsSentByTeam), "Perspective reconciliation changed sent assets.");

const updatedTrades = currentTrades.slice();
updatedTrades[targetIndex] = updatedTarget;
assert(updatedTrades.length === 256, "Perspective reconciliation changed canonical trade count.");
assert(updatedTrades.filter((trade) => trade.id === manifest.canonicalTradeId).length === 1, "Perspective reconciliation created a duplicate Trae canonical.");
assert(updatedTrades.filter((trade) => trade.importMetadata?.phase === "3D2C").length === 229, "Perspective reconciliation changed the Phase 3D2C import set.");

const updatedTradeBytes = canonicalJson(updatedTrades);
const targetPostimageSha256 = sha256(canonicalJson(updatedTarget));
const receipt = {
  result: "PASS",
  phase: "3D2D",
  mode: "FINAL_ATLANTA_PERSPECTIVE_RECONCILIATION",
  startingHead: args["starting-head"],
  reconciledAt: args["reconciled-at"],
  sourceFreezeSha256: expectedFreezeSha,
  canonicalTradeId: manifest.canonicalTradeId,
  sourceTradeId: manifest.sourceTradeId,
  sourcePerspectiveKey: manifest.sourcePerspectiveKey,
  preReconciliationCanonicalTrades: 256,
  postReconciliationCanonicalTrades: 256,
  perspectivesAdded: 1,
  canonicalTradesAdded: 0,
  playerRecords: 509,
  playerRecordsChanged: 0,
  assetsChanged: 0,
  routesChanged: 0,
  relationshipsChanged: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  sourceRowsAccounted: 308,
  sourceRowDispositionCounts: {
    canonicalCreatesImported: 229,
    existingPerspectiveReconciled: 1,
    holdPlayerDependency: 15,
    holdPhase3c: 54,
    mergeFollowup: 4,
    excludeDuplicate: 4,
    holdConflict: 1,
  },
  heldSourceRows: 70,
  nonStandaloneRows: 9,
  atlantaBatchStatus: "COMPLETE_PRIVATE_BATCH_ACCOUNTING",
  preReconciliationCanonicalStoreSha256: expectedTradeSha,
  targetPreimageSha256: sha256(canonicalJson(target)),
  targetPostimageSha256,
  targetImmutableProjectionSha256: beforeImmutableHash,
  canonicalStoreSha256: sha256(updatedTradeBytes),
  playerStoreSha256: sha256(playerBytes),
  playerReceiptSha256: sha256(playerReceiptBytes),
  canonicalImportReceiptSha256: sha256(canonicalReceiptBytes),
  privacyPolicy: "private-noindex-ad-free-sitemap-excluded-publicly-unlinked",
  repositoryDataWrites: 2,
  pushPerformed: false,
  deployPerformed: false,
};
const receiptBytes = canonicalJson(receipt);
await atomicWrite(args["trades-json"], updatedTradeBytes, "phase3d2d-trades");
await atomicWrite(args["final-receipt-json"], receiptBytes, "phase3d2d-receipt");
console.log(JSON.stringify({
  result: "PASS",
  phase: "3D2D",
  mode: "FIRST_RECONCILIATION",
  canonicalTradesAdded: 0,
  perspectivesAdded: 1,
  playerRecordsChanged: 0,
  assetsChanged: 0,
  routesChanged: 0,
  relationshipsChanged: 0,
  sourceRowsAccounted: 308,
  canonicalStoreSha256: receipt.canonicalStoreSha256,
  playerStoreSha256: receipt.playerStoreSha256,
  receiptSha256: sha256(receiptBytes),
  repositoryDataWrites: 2,
}, null, 2));
