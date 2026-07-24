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
assert(args["freeze-json"], "Missing --freeze-json");
const freeze = JSON.parse(await readFile(args["freeze-json"], "utf8"));
assert(freeze.result === "PASS" && freeze.phase === "3D1", "Expected a passing Phase 3D1 freeze.");
assert(freeze.mode === "IMMUTABLE_IMPORT_ELIGIBILITY_FREEZE_ONLY", "Unexpected Phase 3D1 mode.");
assert(freeze.counts.sourceRows === 308, "Expected 308 source rows.");
assert(freeze.counts.createCanonical === 226, "Expected 226 executable canonical creates.");
assert(freeze.counts.holdPlayerDependency === 16, "Expected 16 player-dependency holds.");
assert(freeze.counts.holdPhase3c === 56, "Expected 56 Phase 3C holds.");
assert(freeze.counts.updatePerspectiveReconcile === 1, "Expected one existing-perspective reconciliation.");
assert(freeze.counts.mergeFollowup === 4, "Expected four follow-up merges.");
assert(freeze.counts.excludeDuplicate === 4, "Expected four duplicate exclusions.");
assert(freeze.counts.holdConflict === 1, "Expected one source conflict hold.");
assert(freeze.counts.playerDependencyHoldRows === 19, "Expected 19 player-dependency hold rows.");
assert(freeze.counts.playerDependencyHoldTrades === 16, "Expected 16 dependency-held trades.");
assert(freeze.counts.playerDependencyHoldIdentities === 14, "Expected 14 dependency-held identities.");
assert(freeze.counts.playerIdentities === 554, "Expected 554 player identities.");
assert(freeze.counts.createNewPlayers === 442, "Expected 442 frozen new-player creates.");
assert(freeze.counts.useExistingPlayers === 7, "Expected seven frozen existing-player uses.");
assert(freeze.counts.deferUnusedReadyPlayers === 55, "Expected 55 unused ready-player deferrals.");
assert(freeze.counts.holdPlayerIdentity === 46, "Expected 46 player-identity holds.");
assert(freeze.counts.deferExistingPlayerMatch === 4, "Expected four unused existing-player matches.");
assert(freeze.counts.frozenAssetRoutes === 679, "Expected 679 frozen asset routes.");
assert(freeze.counts.frozenPlayerTradeEdges === 555, "Expected 555 frozen player-trade edges.");
assert(freeze.counts.frozenTeamTradeEdges === 452, "Expected 452 frozen team-trade edges.");
assert(freeze.updatePerspectiveManifest.length === 1, "Expected one existing-perspective manifest row.");
assert(freeze.updatePerspectiveManifest[0].canonicalTradeId === "nba-trade-20260109-e1724a128785", "Trae Young canonical match drifted.");
for (const [name, values] of Object.entries(freeze.guards)) {
  if (Array.isArray(values)) assert(values.length === 0, `${name} must be empty.`);
  else assert(values === 0, `${name} must remain zero.`);
}
assert(freeze.canonicalImports === 0, "Canonical imports are prohibited in Phase 3D1.");
assert(freeze.playerImports === 0, "Player imports are prohibited in Phase 3D1.");
assert(freeze.relationshipImports === 0, "Relationship imports are prohibited in Phase 3D1.");
assert(freeze.routeCreation === 0, "Route creation is prohibited in Phase 3D1.");
assert(freeze.repositoryDataWrites === 0, "Repository data writes are prohibited in Phase 3D1.");
assert(freeze.pushPerformed === false && freeze.deployPerformed === false, "Push/deploy flags must remain false.");
assert(freeze.tradeManifest.every((entry) => entry.publishStatus === "private" && !entry.indexEligible && !entry.adEligible), "Every frozen trade must remain private/noindex/ad-free.");
assert(freeze.playerManifest.every((entry) => entry.publishStatus === "private" && !entry.indexEligible && !entry.adEligible), "Every frozen player must remain private/noindex/ad-free.");
assert(freeze.tradeManifest.filter((entry) => entry.importAction === "create-canonical").every((entry) => entry.teams.length === 2), "Executable imports must be two-team transactions.");
assert(freeze.assetRoutes.every((route) => route.routingReady && route.fromTeam && route.toTeam && route.automaticRouting === false), "Every frozen asset route must be explicit and ready.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "3D1",
  counts: freeze.counts,
  guards: freeze.guards,
  repositoryDataWrites: freeze.repositoryDataWrites,
}, null, 2));
