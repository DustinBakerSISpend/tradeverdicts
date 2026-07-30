#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TEAM = "minnesota-timberwolves";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function asArrayDocument(raw, property) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw[property])) return raw[property];
  if (raw && Array.isArray(raw.records)) return raw.records;
  throw new Error(`JSON input does not contain ${property} array.`);
}

function tradeId(trade) {
  return clean(trade?.id ?? trade?.tradeId);
}

function playerId(player) {
  return clean(player?.id ?? player?.playerId ?? player?.slug ?? player?.identity?.id);
}

const PLAYER_ALLOWED_MUTATION_KEYS = new Set([
  "referenceTypes",
  "tradeIds",
  "tradeSlugs",
  "relationshipReferences",
  "sourceReferences",
  "privateOnly",
  "updatedAt",
]);

function playerCoreProjection(player) {
  return Object.fromEntries(
    Object.entries(player ?? {}).filter(
      ([key]) => !PLAYER_ALLOWED_MUTATION_KEYS.has(key)
    )
  );
}

function changedTopLevelKeys(before, after) {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  return [...keys]
    .filter(
      (key) =>
        JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])
    )
    .sort((a, b) => a.localeCompare(b, "en"));
}

function assertStringArraySuperset(currentValue, baselineValue, label) {
  const current = Array.isArray(currentValue) ? currentValue.map(clean) : [];
  const baseline = Array.isArray(baselineValue) ? baselineValue.map(clean) : [];
  const currentSet = new Set(current);
  for (const value of baseline) {
    assert(currentSet.has(value), `${label}: baseline value disappeared: ${value}`);
  }
}

function assertObjectArraySuperset(currentValue, baselineValue, label) {
  const current = Array.isArray(currentValue) ? currentValue : [];
  const baseline = Array.isArray(baselineValue) ? baselineValue : [];
  const currentSet = new Set(current.map((item) => JSON.stringify(item)));
  for (const item of baseline) {
    const serialized = JSON.stringify(item);
    assert(currentSet.has(serialized), `${label}: baseline object disappeared.`);
  }
}

function countPlayerArrayEntries(players, key) {
  return players.reduce(
    (sum, player) => sum + (Array.isArray(player?.[key]) ? player[key].length : 0),
    0
  );
}

function teamSlug(team) {
  return clean(team?.slug ?? team?.id ?? team?.teamId);
}

function assertPrivateSafe(record, label) {
  if (!record || typeof record !== "object") return;
  assert(record.privateOnly !== false, `${label}: explicitly public privateOnly flag detected.`);
  assert(record.publishStatus !== "public", `${label}: public publish status detected.`);
  assert(record.indexEligible !== true, `${label}: index eligibility detected.`);
  assert(record.adEligible !== true, `${label}: ad eligibility detected.`);
  assert(record.publicationReady !== true, `${label}: publication readiness detected.`);
}

function assertPrivateExplicit(record, label) {
  assert(record && typeof record === "object", `${label}: missing record.`);
  assert(record.privateOnly === true, `${label}: privateOnly drifted.`);
  assert(record.publishStatus === "private", `${label}: publish status drifted.`);
  assert(record.indexEligible === false, `${label}: index eligibility drifted.`);
  assert(record.adEligible === false, `${label}: ad eligibility drifted.`);
  assert(record.publicationReady === false, `${label}: publication readiness drifted.`);
}

function sourcePerspectives(trade, team) {
  const perspectives = trade?.perspectives;
  if (Array.isArray(perspectives)) {
    return perspectives.filter(
      (perspective) =>
        clean(
          perspective?.sourceTeam ??
          perspective?.teamId ??
          perspective?.team ??
          perspective?.perspectiveTeam
        ) === team
    );
  }
  if (perspectives && typeof perspectives === "object") {
    return Object.prototype.hasOwnProperty.call(perspectives, team)
      ? [perspectives[team]]
      : [];
  }
  return [];
}

async function repoImport(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

const args = parseArgs(process.argv);
for (const required of [
  "repo-root",
  "trades-json",
  "players-json",
  "teams-json",
  "receipt-json",
  "output-json",
  "expected-canonical-store-sha256",
  "expected-player-store-sha256",
  "expected-team-store-sha256",
  "baseline-players-json",
]) {
  assert(args[required], `Missing --${required}`);
}

const tradeBytes = await readFile(args["trades-json"]);
const playerBytes = await readFile(args["players-json"]);
const teamBytes = await readFile(args["teams-json"]);
const receiptBytes = await readFile(args["receipt-json"]);
const baselinePlayerBytes = await readFile(args["baseline-players-json"]);

assert(
  sha256(baselinePlayerBytes) === "A51A066C5F52356B9F27EBC13D94095244CCC19FF93DEFC7F984DF9699820711",
  "Baseline pre-import player store hash drifted."
);

assert(
  sha256(tradeBytes) === args["expected-canonical-store-sha256"],
  "Canonical store hash drifted."
);
assert(
  sha256(playerBytes) === args["expected-player-store-sha256"],
  "Player store hash drifted."
);
assert(
  sha256(teamBytes) === args["expected-team-store-sha256"],
  "Team store hash drifted."
);

const trades = asArrayDocument(JSON.parse(tradeBytes.toString("utf8")), "trades");
const players = asArrayDocument(JSON.parse(playerBytes.toString("utf8")), "players");
const teams = asArrayDocument(JSON.parse(teamBytes.toString("utf8")), "teams");
const baselinePlayers = asArrayDocument(
  JSON.parse(baselinePlayerBytes.toString("utf8")),
  "players"
);
const receipt = JSON.parse(receiptBytes.toString("utf8"));

assert(
  receipt.result === "PASS" &&
  receipt.phase === "20H" &&
  receipt.team === TEAM,
  "Receipt metadata invalid."
);

for (const [actual, expected, label] of [
  [receipt.readyPackages, 97, "ready packages"],
  [receipt.heldPackages, 23, "held packages"],
  [receipt.structuralEvidenceExclusions, 1, "structural exclusions"],
  [receipt.canonicalTradesCreated, 38, "canonical creates"],
  [receipt.perspectivesAppended, 59, "perspective appends"],
  [receipt.playerShellsCreated, 35, "player shells"],
  [receipt.readyShellsResolvedToExistingPlayers, 0, "resolved existing shells"],
  [receipt.heldOnlyPlayerShellsDeferred, 13, "held-only shells"],
  [receipt.relationshipReferencesAdded, 300, "relationship references"],
  [receipt.heldRelationshipEdgesDeferred, 93, "held relationship edges"],
  [receipt.readyTeamDependencies, 194, "ready team dependencies"],
  [receipt.heldTeamDependencies, 75, "held team dependencies"],
  [receipt.existingPerspectiveReviewHolds, 0, "existing-perspective holds"],
  [receipt.ambiguousIdentityOccurrencesDeferred, 0, "ambiguous identities"],
  [receipt.postImportCanonicalTrades, 2287, "post-import trades"],
  [receipt.postImportPlayers, 3128, "post-import players"],
  [receipt.postImportTeams, 52, "post-import teams"],
]) {
  assert(Number(actual) === expected, `${label} drifted: ${actual} !== ${expected}.`);
}

// Privacy coverage is exhaustive across all 97 imported package outputs:
// 38 newly-created canonical trades plus 59 appended Minnesota perspectives.
assert(
  receipt.canonicalTradesCreated + receipt.perspectivesAppended === receipt.readyPackages,
  "Imported package privacy-coverage accounting drifted."
);

assert(
  Object.keys(receipt.explicitPlayerTargetCorrections ?? {}).length === 0,
  "Minnesota explicit existing-player override receipt count drifted."
);
assert(
  (receipt.readyShellsResolvedToExistingPlayerIds?.length ?? 0) === 0,
  "Minnesota resolved-existing player ID receipt count drifted."
);
assert(receipt.automaticIdentityMerges === 0, "Automatic identity merge occurred.");
assert(receipt.automaticCanonicalMerges === 0, "Automatic canonical merge occurred.");
assert(receipt.automaticRoutes === 0, "Automatic route occurred.");
assert(receipt.automaticTeamRegistrations === 0, "Automatic team registration occurred.");
assert(receipt.heldPackageImports === 0, "Held package was imported.");
assert(receipt.heldPlayerShellImports === 0, "Held player shell was imported.");
assert(receipt.heldRelationshipWrites === 0, "Held relationship was written.");
assert(receipt.publicationAuthorized === false, "Publication was authorized.");
assert(receipt.pushPerformed === false, "Push was performed.");
assert(receipt.deployPerformed === false, "Deployment was performed.");

assert(
  clean(receipt.canonicalStoreSha256) === args["expected-canonical-store-sha256"],
  "Receipt canonical hash drifted."
);
assert(
  clean(receipt.playerStoreSha256) === args["expected-player-store-sha256"],
  "Receipt player hash drifted."
);
assert(
  clean(receipt.teamStoreSha256) === args["expected-team-store-sha256"],
  "Receipt team hash drifted."
);

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const baselinePlayerMap = new Map(
  baselinePlayers.map((player) => [playerId(player), player])
);
const teamSet = new Set(teams.map(teamSlug).filter(Boolean));

assert(tradeMap.size === trades.length, "Duplicate canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");
assert(
  baselinePlayerMap.size === baselinePlayers.length,
  "Duplicate baseline player ID."
);
assert(teamSet.size === teams.length, "Duplicate team slug.");
assert(trades.length === 2287, "Canonical trade count drifted.");
assert(players.length === 3128, "Player count drifted.");
assert(baselinePlayers.length === 3093, "Baseline player count drifted.");
assert(teams.length === 52, "Team count drifted.");

// R13 exact mutation contract derived from the R12 read-only diff:
// across all 3,093 pre-existing players, only these seven top-level keys may
// change: relationshipReferences, sourceReferences, tradeIds, tradeSlugs,
// referenceTypes, privateOnly, and updatedAt.
let existingPlayersWithAllowedMutation = 0;
let existingPlayersWithRelationshipLayerGrowth = 0;
const existingPlayerChangedKeyFrequency = new Map();

for (const [id, baselinePlayer] of baselinePlayerMap) {
  const currentPlayer = playerMap.get(id);
  assert(currentPlayer, `Pre-existing player disappeared: ${id}`);

  const changedKeys = changedTopLevelKeys(baselinePlayer, currentPlayer);
  for (const key of changedKeys) {
    assert(
      PLAYER_ALLOWED_MUTATION_KEYS.has(key),
      `Pre-existing player mutated outside exact allowed contract: ${id} -> ${key}`
    );
    existingPlayerChangedKeyFrequency.set(
      key,
      (existingPlayerChangedKeyFrequency.get(key) ?? 0) + 1
    );
  }

  assert(
    JSON.stringify(playerCoreProjection(currentPlayer)) ===
      JSON.stringify(playerCoreProjection(baselinePlayer)),
    `Pre-existing player immutable core mutated: ${id}`
  );

  // Relationship-layer arrays must be monotonic supersets.
  assertStringArraySuperset(
    currentPlayer.referenceTypes,
    baselinePlayer.referenceTypes,
    `${id} referenceTypes`
  );
  assertStringArraySuperset(
    currentPlayer.tradeIds,
    baselinePlayer.tradeIds,
    `${id} tradeIds`
  );
  assertStringArraySuperset(
    currentPlayer.tradeSlugs,
    baselinePlayer.tradeSlugs,
    `${id} tradeSlugs`
  );
  assertObjectArraySuperset(
    currentPlayer.relationshipReferences,
    baselinePlayer.relationshipReferences,
    `${id} relationshipReferences`
  );
  assertObjectArraySuperset(
    currentPlayer.sourceReferences,
    baselinePlayer.sourceReferences,
    `${id} sourceReferences`
  );

  // privateOnly may only stay as-is or tighten to true. It may never be
  // removed or weakened from true to false/non-true.
  if (baselinePlayer.privateOnly === true) {
    assert(
      currentPlayer.privateOnly === true,
      `Pre-existing player privateOnly weakened: ${id}`
    );
  }
  if (
    JSON.stringify(currentPlayer.privateOnly) !==
    JSON.stringify(baselinePlayer.privateOnly)
  ) {
    assert(
      currentPlayer.privateOnly === true,
      `Pre-existing player privateOnly changed to non-true value: ${id}`
    );
  }

  // updatedAt may only stay unchanged or advance to a valid later/equal ISO time.
  if (
    JSON.stringify(currentPlayer.updatedAt) !==
    JSON.stringify(baselinePlayer.updatedAt)
  ) {
    const currentTime = Date.parse(currentPlayer.updatedAt);
    const baselineTime = Date.parse(baselinePlayer.updatedAt);
    assert(
      Number.isFinite(currentTime),
      `Pre-existing player updatedAt became invalid: ${id}`
    );
    if (Number.isFinite(baselineTime)) {
      assert(
        currentTime >= baselineTime,
        `Pre-existing player updatedAt moved backward: ${id}`
      );
    }
  }

  const relationshipGrew =
    (currentPlayer.referenceTypes?.length ?? 0) >
      (baselinePlayer.referenceTypes?.length ?? 0) ||
    (currentPlayer.tradeIds?.length ?? 0) >
      (baselinePlayer.tradeIds?.length ?? 0) ||
    (currentPlayer.tradeSlugs?.length ?? 0) >
      (baselinePlayer.tradeSlugs?.length ?? 0) ||
    (currentPlayer.relationshipReferences?.length ?? 0) >
      (baselinePlayer.relationshipReferences?.length ?? 0) ||
    (currentPlayer.sourceReferences?.length ?? 0) >
      (baselinePlayer.sourceReferences?.length ?? 0);

  if (changedKeys.length > 0) existingPlayersWithAllowedMutation += 1;
  if (relationshipGrew) existingPlayersWithRelationshipLayerGrowth += 1;

  // Any changed pre-existing player must carry a forward/changed updatedAt,
  // matching the actual R12 diagnostic contract (191/191).
  if (changedKeys.length > 0) {
    assert(
      changedKeys.includes("updatedAt"),
      `Changed pre-existing player did not update updatedAt: ${id}`
    );
  }
}

// Freeze the exact diagnostic-derived key universe. Counts are useful as a
// regression sentinel while still deriving semantics from the stores.
assert(
  existingPlayersWithAllowedMutation === 191,
  `Changed pre-existing player count drifted: ${existingPlayersWithAllowedMutation} !== 191.`
);
for (const [key, expected] of [
  ["relationshipReferences", 191],
  ["updatedAt", 191],
  ["sourceReferences", 104],
  ["tradeIds", 93],
  ["tradeSlugs", 93],
  ["privateOnly", 54],
  ["referenceTypes", 17],
]) {
  assert(
    (existingPlayerChangedKeyFrequency.get(key) ?? 0) === expected,
    `Pre-existing player mutation frequency drifted for ${key}: ${
      existingPlayerChangedKeyFrequency.get(key) ?? 0
    } !== ${expected}.`
  );
}
assert(
  existingPlayerChangedKeyFrequency.size === 7,
  "Unexpected pre-existing player mutation key appeared."
);

const baselineRelationshipReferences = countPlayerArrayEntries(
  baselinePlayers,
  "relationshipReferences"
);
const postRelationshipReferences = countPlayerArrayEntries(
  players,
  "relationshipReferences"
);
const baselineSourceReferences = countPlayerArrayEntries(
  baselinePlayers,
  "sourceReferences"
);
const postSourceReferences = countPlayerArrayEntries(players, "sourceReferences");

assert(
  postRelationshipReferences - baselineRelationshipReferences ===
    receipt.relationshipReferencesAdded,
  "Player relationship-reference delta disagrees with receipt."
);
if (Number.isFinite(Number(receipt.sourceReferencesAdded))) {
  assert(
    postSourceReferences - baselineSourceReferences ===
      Number(receipt.sourceReferencesAdded),
    "Player source-reference delta disagrees with receipt."
  );
}

const importedCanonicalIds = [...(receipt.importedCanonicalTradeIds ?? [])];
const updatedPerspectiveIds = [...(receipt.updatedPerspectiveCanonicalIds ?? [])];
const importedPlayerIds = [...playerMap.keys()]
  .filter((id) => !baselinePlayerMap.has(id))
  .sort((a, b) => a.localeCompare(b, "en"));

assert(importedCanonicalIds.length === 38, "Imported canonical ID receipt count drifted.");
assert(updatedPerspectiveIds.length === 59, "Updated perspective ID receipt count drifted.");
assert(
  importedPlayerIds.length === 35,
  `Derived imported player count drifted: ${importedPlayerIds.length} !== 35.`
);
assert(new Set(importedCanonicalIds).size === 38, "Duplicate imported canonical ID.");
assert(new Set(updatedPerspectiveIds).size === 59, "Duplicate updated perspective ID.");
assert(new Set(importedPlayerIds).size === 35, "Duplicate derived imported player ID.");

// If the importer happens to expose any player-ID receipt array, it must agree
// exactly with the stronger baseline-diff derivation. The field is optional.
for (const key of ["importedPlayerIds", "createdPlayerIds", "playerShellIdsCreated"]) {
  if (Array.isArray(receipt[key])) {
    const receiptIds = [...receipt[key]]
      .map(clean)
      .sort((a, b) => a.localeCompare(b, "en"));
    assert(
      JSON.stringify(receiptIds) === JSON.stringify(importedPlayerIds),
      `Optional receipt ${key} disagrees with baseline-derived player IDs.`
    );
  }
}

for (const id of importedCanonicalIds) {
  const trade = tradeMap.get(clean(id));
  assert(trade, `Imported canonical trade missing: ${id}`);
  assertPrivateSafe(trade, `imported trade ${id}`);
  const perspectives = sourcePerspectives(trade, TEAM);
  assert(perspectives.length === 1, `${id}: expected exactly one Minnesota perspective.`);
  assertPrivateSafe(perspectives[0], `Minnesota perspective ${id}`);
}

for (const id of updatedPerspectiveIds) {
  const trade = tradeMap.get(clean(id));
  assert(trade, `Updated perspective target missing: ${id}`);
  const perspectives = sourcePerspectives(trade, TEAM);
  assert(perspectives.length === 1, `${id}: expected exactly one Minnesota perspective.`);
  assertPrivateSafe(perspectives[0], `Minnesota perspective ${id}`);
}

for (const id of importedPlayerIds) {
  const player = playerMap.get(clean(id));
  assert(player, `Imported player shell missing: ${id}`);
  assertPrivateExplicit(player, `imported player ${id}`);
}

const { buildPrivateRelationshipGraph } = await repoImport(
  args["repo-root"],
  "src/lib/nba/build-private-relationship-graph.mjs"
);
const { buildPrivateQueryIndex } = await repoImport(
  args["repo-root"],
  "src/lib/nba/build-private-query-index.mjs"
);
const { buildPrivateRouteModels } = await repoImport(
  args["repo-root"],
  "src/lib/nba/build-private-route-models.mjs"
);

const graph = buildPrivateRelationshipGraph({ trades, players, teams });
assert(graph.counts.invalidPlayerReferences === 0, "Invalid player references exist.");
assert(
  graph.counts.duplicateReferenceOwnership === 0,
  "Duplicate relationship/source-reference ownership exists."
);
assert(graph.counts.extraPlayerReferences === 0, "Extra player references exist.");
assert(graph.counts.invalidTradeTeams === 0, "Invalid trade teams exist.");

const query = buildPrivateQueryIndex({ trades, players, teams });
const routes = buildPrivateRouteModels({ trades, players, teams });

const queryCanonicalTrades = Number(
  query?.counts?.canonicalTrades ?? query?.canonicalTrades?.length
);
const queryPlayers = Number(
  query?.counts?.players ?? query?.players?.length
);
const queryRepresentedTeams = Number(
  query?.counts?.representedTeams ?? query?.representedTeams?.length
);
const queryPlayerTradeReferences = Number(
  query?.counts?.playerTradeReferences ?? 0
);

assert(
  queryCanonicalTrades === trades.length,
  "Private query canonical-trade count drifted."
);
assert(
  queryPlayers === players.length,
  "Private query player count drifted."
);
assert(
  queryRepresentedTeams === teams.length,
  `Private query represented-team count drifted: ${queryRepresentedTeams} !== ${teams.length}.`
);
assert(
  queryPlayerTradeReferences >= receipt.relationshipReferencesAdded,
  "Private query player-reference count is unexpectedly low."
);
assert(
  routes.counts.routeModels > 0 && routes.counts.internalLinks > 0,
  "Private route model audit produced no route graph."
);

const audit = {
  result: "PASS",
  phase: "20H",
  mode: "MINNESOTA_NATIVE_GUARDED_PRIVATE_IMPORT_AUDIT",
  team: TEAM,
  counts: {
    canonicalTrades: trades.length,
    players: players.length,
    teams: teams.length,
    readyPackages: receipt.readyPackages,
    heldPackages: receipt.heldPackages,
    structuralEvidenceExclusions: receipt.structuralEvidenceExclusions,
    canonicalTradesCreated: receipt.canonicalTradesCreated,
    perspectivesAppended: receipt.perspectivesAppended,
    playerShellsCreated: receipt.playerShellsCreated,
    baselinePlayers: baselinePlayers.length,
    baselineDerivedImportedPlayers: importedPlayerIds.length,
    existingPlayersWithAllowedMutation,
    existingPlayersWithRelationshipLayerGrowth,
    existingPlayerChangedKeyFrequency: Object.fromEntries(
      [...existingPlayerChangedKeyFrequency.entries()].sort((a, b) =>
        a[0].localeCompare(b[0], "en")
      )
    ),
    baselineRelationshipReferences,
    postRelationshipReferences,
    baselineSourceReferences,
    postSourceReferences,
    resolvedExistingPlayers: receipt.readyShellsResolvedToExistingPlayers,
    relationshipReferencesAdded: receipt.relationshipReferencesAdded,
    sourceReferencesAdded: receipt.sourceReferencesAdded,
    privateQueryCanonicalTrades: queryCanonicalTrades,
    privateQueryPlayers: queryPlayers,
    privateQueryRepresentedTeams: queryRepresentedTeams,
    privateQueryPlayerReferences: queryPlayerTradeReferences,
    routeModels: routes.counts.routeModels,
    internalLinks: routes.counts.internalLinks,
  },
  safety: {
    invalidPlayerReferences: graph.counts.invalidPlayerReferences,
    duplicateReferenceOwnership: graph.counts.duplicateReferenceOwnership,
    extraPlayerReferences: graph.counts.extraPlayerReferences,
    invalidTradeTeams: graph.counts.invalidTradeTeams,
    explicitExistingPlayerOverrides:
      Object.keys(receipt.explicitPlayerTargetCorrections ?? {}).length,
    resolvedExistingPlayerIds:
      receipt.readyShellsResolvedToExistingPlayerIds?.length ?? 0,
    exactExistingPlayerMutationContract: {
      changedPlayers: existingPlayersWithAllowedMutation,
      allowedKeys: [...PLAYER_ALLOWED_MUTATION_KEYS].sort((a, b) =>
        a.localeCompare(b, "en")
      ),
    },
    publicationAuthorized: receipt.publicationAuthorized,
    pushPerformed: receipt.pushPerformed,
    deployPerformed: receipt.deployPerformed,
  },
};

await writeFile(args["output-json"], `${JSON.stringify(audit, null, 2)}\n`, "utf8");
console.log(JSON.stringify(audit, null, 2));
