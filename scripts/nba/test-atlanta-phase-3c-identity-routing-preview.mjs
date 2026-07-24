#!/usr/bin/env node
import { readFile } from "node:fs/promises";

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

const args = parseArgs(process.argv);
assert(args["preview-json"], "Missing --preview-json");
const preview = JSON.parse(await readFile(args["preview-json"], "utf8"));
assert(preview.result === "PASS" && preview.phase === "3C", "Expected a passing Phase 3C preview.");
assert(preview.canonicalImports === 0, "Canonical imports are prohibited in Phase 3C.");
assert(preview.playerImports === 0, "Player imports are prohibited in Phase 3C.");
assert(preview.relationshipImports === 0, "Relationship imports are prohibited in Phase 3C.");
assert(preview.routeCreation === 0, "Route creation is prohibited in Phase 3C.");
assert(preview.automaticPlayerMerges === 0, "Automatic player merging is prohibited.");
assert(preview.automaticAssetRouting === 0, "Automatic multi-team routing is prohibited.");
assert(preview.pushPerformed === false && preview.deployPerformed === false, "Push/deploy flags must remain false.");
assert(preview.counts.phase3bSourceRows === 308, "Expected 308 source rows.");
assert(preview.counts.standaloneTradePreviews === 299, "Expected 299 standalone trade previews.");
assert(preview.counts.existingPlayerStoreRecords === 67, "Expected 67 existing players.");
assert(preview.playerIdentity.collisions.length === 0, "Player identity collisions must be zero.");
assert(preview.counts.rawPlayerReferences === 771, "Expected 771 raw player-like references.");
assert(preview.counts.validPlayerReferences === 748, "Expected 748 valid player references.");
assert(preview.counts.excludedPlaceholderReferences === 23, "Expected 23 non-player placeholder references.");
assert(preview.counts.uniquePlayerIdentities === 554, "Expected 554 unique player identities.");
assert(preview.counts.existingPlayerMatches === 11, "Expected 11 existing-player matches.");
assert(preview.counts.newPlayerPreviews === 543, "Expected 543 new player previews.");
assert(preview.counts.newPlayerImportReady === 497, "Expected 497 player-data-ready previews.");
assert(preview.counts.playerIdentityHolds === 0, "Expected zero unresolved normalized-name collisions.");
assert(preview.counts.parserPlaceholderTrades === 22, "Expected 22 trades with parser placeholder references.");
assert(preview.counts.phase3bFalseReadyPlaceholderTrades === 15, "Expected 15 Phase 3B false-ready rows exposed by identity review.");
assert(preview.counts.phase3cCanonicalImportReady === 242, "Expected 242 fully ready new canonical previews after Phase 3C guards.");
assert(preview.counts.phase3cCanonicalImportBlocked === 56, "Expected 56 new canonical previews blocked after Phase 3C guards.");
assert(preview.counts.existingPerspectiveOnlyRows === 1, "Expected one existing-perspective-only row.");
assert(preview.counts.playerTradePreviewEdges === 748, "Expected 748 player-trade preview edges.");
assert(preview.counts.playerTradeImportReadyEdges === 602, "Expected 602 relationship-import-ready edges.");
assert(preview.counts.teamTradePreviewEdges === 628, "Expected 628 team-trade preview edges.");
assert(preview.counts.resolvedAssetRoutes === 875, "Expected 875 resolved two-team asset routes.");
assert(preview.playerIdentity.placeholderReferences.length > 0, "Expected parser placeholder references to be isolated.");
assert(preview.counts.manualRoutingTrades === 21, "Expected all 21 multi-team Atlanta previews to remain manual-routing holds.");
assert(preview.counts.routingReadyTrades === 278, "Expected 278 two-team/existing-match routing-ready previews.");
assert(preview.counts.manualAssetRoutingRows === 91, "Expected 91 multi-team asset-routing rows to remain manual.");
assert(preview.counts.assetRoutingRows === 966, "Expected 966 standalone asset-routing rows.");
assert(preview.counts.teamTradePreviewEdges > 0, "Expected team-trade preview edges.");
assert(preview.counts.playerTradePreviewEdges > 0, "Expected player-trade preview edges.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "3C",
  counts: preview.counts,
  identityCollisions: preview.playerIdentity.collisions.length,
  automaticPlayerMerges: preview.automaticPlayerMerges,
  automaticAssetRouting: preview.automaticAssetRouting,
  repositoryDataWrites: preview.repositoryDataWrites,
}, null, 2));
