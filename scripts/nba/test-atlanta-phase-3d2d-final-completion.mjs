#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

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
function immutableProjection(trade) {
  const { sourceTeams, grades, perspectives, sources, updatedAt, perspectiveReconciliations, ...immutable } = trade;
  return immutable;
}
async function atomicWrite(filePath, bytes) {
  if (!filePath) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.phase3d2d-audit-${process.pid}.tmp`;
  try {
    await writeFile(temp, bytes);
    await rename(temp, filePath);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

const args = parseArgs(process.argv);
for (const required of [
  "freeze-json",
  "reviewed-json",
  "trades-json",
  "players-json",
  "teams-json",
  "player-receipt-json",
  "canonical-receipt-json",
  "final-receipt-json",
  "expected-freeze-sha256",
  "expected-pre-reconciliation-trade-sha256",
  "expected-player-store-sha256",
  "expected-player-receipt-sha256",
  "expected-canonical-receipt-sha256",
  "starting-head",
]) assert(args[required], `Missing --${required}`);

const [freezeBytes, reviewedBytes, tradeBytes, playerBytes, teamBytes, playerReceiptBytes, canonicalReceiptBytes, finalReceiptBytes] = await Promise.all([
  readFile(args["freeze-json"]),
  readFile(args["reviewed-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["player-receipt-json"]),
  readFile(args["canonical-receipt-json"]),
  readFile(args["final-receipt-json"]),
]);
const expectedFreezeSha = args["expected-freeze-sha256"].toLowerCase();
assert(sha256(freezeBytes) === expectedFreezeSha, "Corrected freeze SHA mismatch.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"].toLowerCase(), "Player store changed during Phase 3D2D.");
assert(sha256(playerReceiptBytes) === args["expected-player-receipt-sha256"].toLowerCase(), "Phase 3D2B receipt changed.");
assert(sha256(canonicalReceiptBytes) === args["expected-canonical-receipt-sha256"].toLowerCase(), "Phase 3D2C receipt changed.");

const freeze = JSON.parse(freezeBytes);
const reviewed = JSON.parse(reviewedBytes);
const trades = JSON.parse(tradeBytes);
const players = JSON.parse(playerBytes);
const teams = JSON.parse(teamBytes);
const playerReceipt = JSON.parse(playerReceiptBytes);
const canonicalReceipt = JSON.parse(canonicalReceiptBytes);
const finalReceipt = JSON.parse(finalReceiptBytes);

assert(freeze.result === "PASS" && freeze.phase === "3D1", "Unexpected corrected freeze.");
assert(reviewed.records.length === 308, "Expected 308 reviewed Atlanta rows.");
assert(new Set(reviewed.records.map((row) => row.tradeId)).size === 308, "Reviewed Atlanta source IDs are not unique.");
assert(freeze.tradeManifest.length === 308 && new Set(freeze.tradeManifest.map((entry) => entry.sourceTradeId)).size === 308, "Frozen Atlanta trade manifest is incomplete or duplicated.");
assert(trades.length === 256, `Expected 256 canonical trades, found ${trades.length}.`);
assert(players.length === 509, `Expected 509 players, found ${players.length}.`);
assert(playerReceipt.result === "PASS" && playerReceipt.phase === "3D2B" && playerReceipt.importedPlayerShells === 442, "Unexpected Phase 3D2B receipt.");
assert(canonicalReceipt.result === "PASS" && canonicalReceipt.phase === "3D2C" && canonicalReceipt.importedCanonicalTrades === 229 && canonicalReceipt.postImportCanonicalTrades === 256, "Unexpected Phase 3D2C receipt.");
assert(canonicalReceipt.canonicalStoreSha256 === args["expected-pre-reconciliation-trade-sha256"].toLowerCase(), "Phase 3D2C receipt does not match the guarded Phase 3D2D preimage.");
assert(canonicalReceipt.playerStoreSha256 === sha256(playerBytes), "Phase 3D2C player-store ownership drifted.");
assert(finalReceipt.result === "PASS" && finalReceipt.phase === "3D2D" && finalReceipt.mode === "FINAL_ATLANTA_PERSPECTIVE_RECONCILIATION", "Unexpected Phase 3D2D receipt.");
assert(finalReceipt.startingHead === args["starting-head"] && finalReceipt.sourceFreezeSha256 === expectedFreezeSha, "Phase 3D2D receipt authorization drifted.");
assert(finalReceipt.canonicalStoreSha256 === sha256(tradeBytes) && finalReceipt.playerStoreSha256 === sha256(playerBytes), "Phase 3D2D receipt does not own the current stores.");
assert(finalReceipt.playerReceiptSha256 === sha256(playerReceiptBytes) && finalReceipt.canonicalImportReceiptSha256 === sha256(canonicalReceiptBytes), "Phase 3D2D upstream receipt hashes drifted.");
assert(finalReceipt.repositoryDataWrites === 2 && finalReceipt.pushPerformed === false && finalReceipt.deployPerformed === false, "Phase 3D2D receipt contains an unauthorized action.");

const actionCounts = Object.fromEntries([...new Set(freeze.tradeManifest.map((entry) => entry.importAction))].map((action) => [action, freeze.tradeManifest.filter((entry) => entry.importAction === action).length]));
assert(actionCounts["create-canonical"] === 229, "Expected 229 canonical-create rows.");
assert(actionCounts["update-perspective-reconcile"] === 1, "Expected one perspective-reconciliation row.");
assert(actionCounts["hold-player-dependency"] === 15, "Expected 15 player-dependency holds.");
assert(actionCounts["hold-phase3c"] === 54, "Expected 54 Phase 3C holds.");
assert(actionCounts["merge-followup"] === 4, "Expected four follow-up merges.");
assert(actionCounts["exclude-duplicate"] === 4, "Expected four duplicate exclusions.");
assert(actionCounts["hold-conflict"] === 1, "Expected one source-conflict hold.");
assert(Object.values(actionCounts).reduce((sum, count) => sum + count, 0) === 308, "Atlanta action accounting does not total 308.");
assert(finalReceipt.sourceRowsAccounted === 308 && Object.values(finalReceipt.sourceRowDispositionCounts).reduce((sum, count) => sum + count, 0) === 308, "Phase 3D2D receipt does not account for all Atlanta source rows.");

const createManifest = freeze.tradeManifest.filter((entry) => entry.importAction === "create-canonical");
const importedIds = new Set(canonicalReceipt.canonicalTradeIds);
assert(importedIds.size === 229 && createManifest.every((entry) => importedIds.has(entry.canonicalTradeId)), "Phase 3D2C receipt does not match the frozen create manifest.");
assert(trades.filter((trade) => trade.importMetadata?.phase === "3D2C").length === 229, "Expected exactly 229 Phase 3D2C canonical imports.");
for (const entry of freeze.tradeManifest.filter((item) => item.importAction !== "create-canonical" && item.importAction !== "update-perspective-reconcile")) {
  assert(!trades.some((trade) => trade.sourceTradeId === entry.sourceTradeId && trade.importMetadata?.phase === "3D2C"), `${entry.sourceTradeId}: held/excluded row was imported.`);
}

const targetId = "nba-trade-20260109-e1724a128785";
const targets = trades.filter((trade) => trade.id === targetId);
assert(targets.length === 1, "Expected exactly one Trae Young canonical trade.");
const target = targets[0];
const row = reviewed.records.find((record) => record.tradeId === "ATL-2026-0300");
const manifest = freeze.updatePerspectiveManifest[0];
assert(row && manifest && manifest.canonicalTradeId === targetId, "Trae reconciliation source data is missing.");
assert(target.sourceTeams?.filter((team) => team === "atlanta-hawks").length === 1 && target.sourceTeams?.includes("washington-wizards"), "Trae source-team set is incomplete or duplicated.");
assert(Object.keys(target.perspectives ?? {}).sort().join("|") === "atlanta-hawks|washington-wizards", "Trae must contain exactly the Atlanta and Washington perspectives.");
assert(target.perspectives["atlanta-hawks"].sourceSubmissionId === "atlanta-hawks-phase-3a-ATL-2026-0300", "Atlanta perspective submission ID drifted.");
assert(target.perspectives["atlanta-hawks"].grade === "D+" && target.perspectives["atlanta-hawks"].verdict === "Partner Win", "Atlanta perspective grade or verdict drifted.");
assert(target.perspectives["atlanta-hawks"].summary === row.summary && target.perspectives["atlanta-hawks"].analysis === row.analysis, "Atlanta perspective prose drifted.");
assert(target.grades["washington-wizards"] === "A-" && target.grades["atlanta-hawks"] === "D+", "Trae canonical grades are not reconciled by source team.");
assert((target.sources ?? []).filter((source) => source.submissionId === "atlanta-hawks-phase-3a-ATL-2026-0300").length === 1, "Atlanta source submission is missing or duplicated.");
assert((target.perspectiveReconciliations ?? []).length === 1 && target.perspectiveReconciliations[0].sourcePerspectiveKey === manifest.sourcePerspectiveKey, "Trae perspective reconciliation metadata drifted.");
assert(target.assetLedger.length === 3 && target.unresolvedAssetRouting.length === 0 && target.routingCompleteness === "complete", "Trae assets or routing changed.");
assert(target.publishStatus === "private" && target.indexEligible === false && target.adEligible === false && target.publicationReady === false && target.automaticMerge === false, "Trae privacy flags changed.");
assert(sha256(canonicalJson(target)) === finalReceipt.targetPostimageSha256, "Trae target postimage hash drifted.");
assert(sha256(canonicalJson(immutableProjection(target))) === finalReceipt.targetImmutableProjectionSha256, "An immutable Trae canonical field changed.");
assert(finalReceipt.targetPreimageSha256 === "c1f1b0cb22634c4f052403530c587b3f847dab5021c0b3de73e2145f3458d675", "Unexpected Trae preimage authorization.");

for (const trade of trades) {
  assert(trade.publishStatus === "private" && trade.indexEligible === false && trade.adEligible === false && trade.publicationReady === false, `${trade.id}: canonical privacy invariant failed.`);
  assert(trade.automaticMerge === false, `${trade.id}: automatic merge marker detected.`);
}
for (const player of players) {
  assert(player.publishStatus === "private" && player.indexEligible === false && player.adEligible === false && player.publicationReady === false, `${player.id}: player privacy invariant failed.`);
  assert(player.automaticMerge === false, `${player.id}: automatic player merge marker detected.`);
}

const queryIndex = buildPrivateQueryIndex({ trades, players, teams });
assert(queryIndex.counts.canonicalTrades === 256, "Private query canonical count drifted.");
assert(queryIndex.counts.players === 509, "Private query player count drifted.");
assert(queryIndex.counts.representedTeams === 36, "Private query team count drifted.");
assert(queryIndex.counts.playerTradeReferences === 646, "Private query player-reference count drifted.");
assert(queryIndex.counts.ambiguousExactIdentityKeys === 0, "Ambiguous exact player identity keys detected.");
const routeModels = buildPrivateRouteModels({ trades, players, teams });
assert(routeModels.counts.routeModels === 805, "Private route-model count drifted.");
assert(routeModels.counts.tradeDetailModels === 256 && routeModels.counts.playerDetailModels === 509 && routeModels.counts.teamDetailModels === 36, "Private detail-route counts drifted.");
assert(routeModels.counts.internalLinks === 3144 && routeModels.counts.brokenLinks === 0 && routeModels.counts.privacyViolations === 0, "Private route graph drifted.");

const audit = {
  result: "PASS",
  phase: "3D2D-FINAL-ATLANTA-COMPLETION",
  atlantaBatchStatus: "COMPLETE_PRIVATE_BATCH_ACCOUNTING",
  sourceRowsReviewed: 308,
  sourceRowsAccounted: 308,
  canonicalCreatesImported: 229,
  existingPerspectiveReconciled: 1,
  playerDependencyHolds: 15,
  phase3cHolds: 54,
  followupMerges: 4,
  duplicateExclusions: 4,
  sourceConflictHolds: 1,
  totalCanonicalTrades: 256,
  totalPlayerRecords: 509,
  privateRouteModels: 805,
  privateInternalLinks: 3144,
  playerTradeReferences: 646,
  representedTeams: 36,
  duplicateTraeCanonicals: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  privacyFailures: 0,
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  finalReceiptSha256: sha256(finalReceiptBytes),
  publicationPolicy: "private-noindex-ad-free-sitemap-excluded-publicly-unlinked",
  pushPerformed: false,
  deployPerformed: false,
};
await atomicWrite(args["output-json"], canonicalJson(audit));
console.log(JSON.stringify(audit, null, 2));
