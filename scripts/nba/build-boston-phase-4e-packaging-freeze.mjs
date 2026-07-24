#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/['’`]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function slugify(value) {
  return normalizeName(value).replace(/\s+/gu, "-") || "unknown";
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

function readPlayerName(player) {
  return clean(
    player.displayName ??
      player.name ??
      player.fullName ??
      player.playerName ??
      player.identity?.displayName ??
      player.identity?.name,
  );
}

function readPlayerAliases(player) {
  const aliases = [
    ...(Array.isArray(player.aliases) ? player.aliases : []),
    ...(Array.isArray(player.playerAliases) ? player.playerAliases : []),
    ...(Array.isArray(player.alternateNames) ? player.alternateNames : []),
    ...(Array.isArray(player.identity?.aliases) ? player.identity.aliases : []),
  ];
  return aliases.map(clean).filter(Boolean);
}

function readPlayerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id);
}

function buildPlayerIndex(players) {
  const byName = new Map();

  function add(key, player) {
    if (!key) return;
    if (!byName.has(key)) byName.set(key, []);
    const list = byName.get(key);
    if (!list.some((item) => readPlayerId(item) === readPlayerId(player))) {
      list.push(player);
    }
  }

  for (const player of players) {
    const displayName = readPlayerName(player);
    add(normalizeName(displayName), player);
    for (const alias of readPlayerAliases(player)) {
      add(normalizeName(alias), player);
    }
  }

  return byName;
}

function perspectiveTeam(perspective) {
  return clean(
    perspective.sourceTeam ??
      perspective.teamId ??
      perspective.team ??
      perspective.perspectiveTeam,
  );
}

function buildBostonPerspective(record) {
  return {
    sourceTeam: "boston-celtics",
    sourceBatchId: record.sourceBatchId ?? "boston-celtics-phase-4a",
    sourceTradeId: record.sourceTradeId,
    summary: record.summary,
    analysis: record.analysis,
    verdict: record.verdict,
    grades: record.grades,
    aggregatePartnerGrade: record.aggregatePartnerGrade ?? null,
    confidence: record.confidence,
    reviewStatus: record.reviewStatus,
    sourcePerspectiveKey: record.sourcePerspectiveKey,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  };
}

function buildAtlantaPerspective(record) {
  assert(record, "Shared Atlanta reviewed record is missing.");
  return {
    sourceTeam: clean(record.sourceTeam || "atlanta-hawks"),
    sourceBatchId: "atlanta-hawks-phase-3a",
    sourceTradeId: record.tradeId,
    summary: record.summary,
    analysis: record.analysis,
    verdict: record.verdict,
    grades: {
      "atlanta-hawks": record.sourceTeamGrade ?? null,
      partnerAggregate: record.partnerAggregateGrade ?? null,
    },
    confidence: record.confidence,
    reviewStatus: record.reviewStatus,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  };
}

function canonicalCreateId(record) {
  if (record.phase4DDecision === "approve-new-canonical-identity") {
    assert(
      clean(record.targetIdentity).startsWith("nba-trade-"),
      `${record.sourceTradeId}: invalid new canonical target.`,
    );
    return record.targetIdentity;
  }

  assert(
    record.phase4DDecision === "approve-shared-reviewed-canonical-identity",
    `${record.sourceTradeId}: unexpected canonical-create decision.`,
  );

  const dateToken = record.tradeDate.replaceAll("-", "");
  return `nba-trade-${dateToken}-${sha256(record.sharedCanonicalGroup).slice(0, 12)}`;
}

function playerReferencesFromAsset(asset) {
  const references = [];

  if (asset.type === "player" || asset.type === "draft_rights") {
    const name = clean(asset.playerName);
    if (name) {
      references.push({
        name,
        role: asset.type === "player" ? "traded-player" : "draft-rights-player",
      });
    }
  }

  const becamePlayerName = clean(asset.becamePlayerName);
  if (becamePlayerName) {
    references.push({
      name: becamePlayerName,
      role: "pick-became-player",
    });
  }

  return references;
}

function provisionalPlayerId(name) {
  return `nba-player-${slugify(name)}-${sha256(normalizeName(name)).slice(0, 10)}`;
}

const args = parseArgs(process.argv);
for (const required of [
  "phase4d-freeze",
  "trades-json",
  "players-json",
  "atlanta-reviewed-json",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  phase4dBytes,
  tradesBytes,
  playersBytes,
  atlantaBytes,
] = await Promise.all([
  readFile(args["phase4d-freeze"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["atlanta-reviewed-json"]),
]);

const phase4d = JSON.parse(phase4dBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));

assert(
  phase4d.result === "PASS" &&
    phase4d.phase === "4D" &&
    phase4d.records.length === 223,
  "Invalid Phase 4D routing freeze.",
);
assert(Array.isArray(trades) && trades.length === 256, "Canonical store count changed.");
assert(Array.isArray(players) && players.length === 509, "Player store count changed.");
assert(
  atlanta.batchId === "atlanta-hawks-phase-3a" &&
    atlanta.records.length === 308,
  "Atlanta reviewed batch changed.",
);

const canonicalById = new Map(trades.map((trade) => [clean(trade.id), trade]));
const atlantaById = new Map(atlanta.records.map((record) => [record.tradeId, record]));
const playerIndex = buildPlayerIndex(players);

const createRecords = phase4d.records.filter((record) =>
  [
    "approve-new-canonical-identity",
    "approve-shared-reviewed-canonical-identity",
  ].includes(record.phase4DDecision),
);
const perspectiveRecords = phase4d.records.filter(
  (record) =>
    record.phase4DDecision === "approve-existing-canonical-perspective",
);
const excludedRecords = phase4d.records.filter(
  (record) => record.phase4DDecision === "exclude-nonstandalone",
);

assert(createRecords.length === 200, `Expected 200 create records, found ${createRecords.length}.`);
assert(
  createRecords.filter(
    (record) => record.phase4DDecision === "approve-new-canonical-identity",
  ).length === 197,
  "Expected 197 Boston-only canonical creates.",
);
assert(
  createRecords.filter(
    (record) =>
      record.phase4DDecision === "approve-shared-reviewed-canonical-identity",
  ).length === 3,
  "Expected three shared canonical creates.",
);
assert(
  perspectiveRecords.length === 11,
  `Expected 11 perspective records, found ${perspectiveRecords.length}.`,
);
assert(
  excludedRecords.length === 12,
  `Expected 12 excluded records, found ${excludedRecords.length}.`,
);

const packages = [];
const dependencyOccurrences = [];

for (const record of createRecords) {
  const id = canonicalCreateId(record);
  assert(!canonicalById.has(id), `${record.sourceTradeId}: canonical ID already exists: ${id}`);

  const isShared =
    record.phase4DDecision === "approve-shared-reviewed-canonical-identity";
  const atlantaRecord = isShared
    ? atlantaById.get(record.atlantaSourceTradeId)
    : null;

  if (isShared) {
    assert(atlantaRecord, `${record.sourceTradeId}: Atlanta source record is missing.`);
    assert(
      clean(atlantaRecord.tradeDate) === clean(record.tradeDate),
      `${record.sourceTradeId}: Atlanta/Boston trade-date mismatch.`,
    );
  }

  const perspectives = [
    buildBostonPerspective(record),
    ...(isShared ? [buildAtlantaPerspective(atlantaRecord)] : []),
  ];

  const payload = {
    id,
    league: "nba",
    slug: id.replace(/^nba-trade-/u, ""),
    tradeDate: record.tradeDate,
    seasonLabel: record.seasonLabel,
    teams: [...record.teams].sort(),
    sourceTeams: isShared
      ? ["atlanta-hawks", "boston-celtics"]
      : ["boston-celtics"],
    assetLedger: record.assetLedger,
    assetsReceived: record.assetsReceived,
    assetsSent: record.assetsSent,
    supplementalRouteEdges: record.supplementalRouteEdges ?? [],
    summary: record.summary,
    verdict: record.verdict,
    grades: record.grades,
    perspectives,
    sources: [
      {
        kind: "reviewed-batch",
        batchId: "boston-celtics-phase-4a",
        sourceTradeId: record.sourceTradeId,
      },
      ...(isShared
        ? [{
            kind: "reviewed-batch",
            batchId: "atlanta-hawks-phase-3a",
            sourceTradeId: record.atlantaSourceTradeId,
          }]
        : []),
    ],
    canonicalKey:
      record.provisionalCanonicalKey ??
      record.sharedCanonicalGroup ??
      record.targetIdentity,
    dateTeamsKey: record.dateTeamsKey,
    publishStatus: "private",
    reviewStatus: "packaged-import-blocked",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    importAuthorized: false,
    automaticMerge: false,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
  };

  assert(payload.teams.length >= 2, `${record.sourceTradeId}: canonical team set incomplete.`);
  assert(
    payload.assetLedger.every((asset) => asset.fromTeam && asset.toTeam),
    `${record.sourceTradeId}: unrouted asset reached packaging.`,
  );
  assert(
    payload.assetLedger.every(
      (asset) => asset.type !== "other" && asset.status !== "unclassified",
    ),
    `${record.sourceTradeId}: unclassified asset reached packaging.`,
  );

  for (const asset of payload.assetLedger) {
    for (const reference of playerReferencesFromAsset(asset)) {
      dependencyOccurrences.push({
        packageId: id,
        packageKind: isShared
          ? "shared-canonical-create"
          : "canonical-create",
        sourceTradeId: record.sourceTradeId,
        assetId: asset.assetId,
        assetType: asset.type,
        playerName: reference.name,
        normalizedName: normalizeName(reference.name),
        role: reference.role,
      });
    }
  }

  packages.push({
    packageId: id,
    packageKind: isShared
      ? "shared-canonical-create"
      : "canonical-create",
    sourceTradeId: record.sourceTradeId,
    targetCanonicalId: id,
    sharedCanonicalGroup: record.sharedCanonicalGroup ?? null,
    atlantaSourceTradeId: record.atlantaSourceTradeId ?? null,
    canonicalPayload: payload,
    targetExists: false,
    actualWriteAuthorized: false,
  });
}

for (const record of perspectiveRecords) {
  const target = canonicalById.get(record.targetIdentity);
  assert(target, `${record.sourceTradeId}: existing canonical target is missing.`);

  const currentPerspectiveTeams = Array.isArray(target.perspectives)
    ? target.perspectives.map(perspectiveTeam).filter(Boolean)
    : [];

  const perspective = buildBostonPerspective(record);
  const alreadyPresent = currentPerspectiveTeams.includes("boston-celtics");

  for (const asset of record.assetLedger) {
    for (const reference of playerReferencesFromAsset(asset)) {
      dependencyOccurrences.push({
        packageId: `${record.targetIdentity}:boston-celtics`,
        packageKind: "perspective-append",
        sourceTradeId: record.sourceTradeId,
        assetId: asset.assetId,
        assetType: asset.type,
        playerName: reference.name,
        normalizedName: normalizeName(reference.name),
        role: reference.role,
      });
    }
  }

  packages.push({
    packageId: `${record.targetIdentity}:boston-celtics`,
    packageKind: "perspective-append",
    sourceTradeId: record.sourceTradeId,
    targetCanonicalId: record.targetIdentity,
    perspectivePayload: perspective,
    routedAssetLedger: record.assetLedger,
    targetExists: true,
    currentPerspectiveTeams: [...new Set(currentPerspectiveTeams)].sort(),
    perspectiveAlreadyPresent: alreadyPresent,
    actualWriteAuthorized: false,
  });
}

assert(packages.length === 211, `Expected 211 packages, found ${packages.length}.`);
assert(
  new Set(packages.map((item) => item.packageId)).size === packages.length,
  "Package IDs are not unique.",
);

const dependenciesByName = new Map();

for (const occurrence of dependencyOccurrences) {
  if (!dependenciesByName.has(occurrence.normalizedName)) {
    dependenciesByName.set(occurrence.normalizedName, {
      normalizedName: occurrence.normalizedName,
      displayNames: new Set(),
      occurrences: [],
    });
  }

  const group = dependenciesByName.get(occurrence.normalizedName);
  group.displayNames.add(occurrence.playerName);
  group.occurrences.push(occurrence);
}

const dependencies = [];

for (const group of dependenciesByName.values()) {
  const matches = playerIndex.get(group.normalizedName) ?? [];
  const displayName = [...group.displayNames].sort()[0];

  let dependencyStatus;
  let existingPlayerId = null;
  let provisionalId = null;

  if (matches.length === 1) {
    dependencyStatus = "existing-player";
    existingPlayerId = readPlayerId(matches[0]);
    assert(existingPlayerId, `${displayName}: existing player match lacks an ID.`);
  } else if (matches.length === 0) {
    dependencyStatus = "new-player-shell-required";
    provisionalId = provisionalPlayerId(displayName);
  } else {
    dependencyStatus = "ambiguous-existing-player";
  }

  dependencies.push({
    normalizedName: group.normalizedName,
    displayName,
    displayNames: [...group.displayNames].sort(),
    dependencyStatus,
    existingPlayerId,
    provisionalPlayerId: provisionalId,
    matchedPlayerIds: matches.map(readPlayerId).filter(Boolean).sort(),
    occurrenceCount: group.occurrences.length,
    packageIds: [...new Set(group.occurrences.map((item) => item.packageId))].sort(),
    sourceTradeIds: [
      ...new Set(group.occurrences.map((item) => item.sourceTradeId)),
    ].sort(),
    occurrences: group.occurrences.sort(
      (left, right) =>
        left.packageId.localeCompare(right.packageId) ||
        left.assetId.localeCompare(right.assetId) ||
        left.role.localeCompare(right.role),
    ),
  });
}

dependencies.sort((left, right) =>
  left.normalizedName.localeCompare(right.normalizedName)
);

const dependencyByName = new Map(
  dependencies.map((dependency) => [
    dependency.normalizedName,
    dependency,
  ]),
);

const packageRows = [];

for (const item of packages) {
  const relevantDependencies = dependencies.filter((dependency) =>
    dependency.packageIds.includes(item.packageId)
  );
  const ambiguous = relevantDependencies.filter(
    (dependency) =>
      dependency.dependencyStatus === "ambiguous-existing-player",
  );
  const missingShells = relevantDependencies.filter(
    (dependency) =>
      dependency.dependencyStatus === "new-player-shell-required",
  );

  let importEligibility;
  const blockers = [];

  if (
    item.packageKind === "shared-canonical-create"
  ) {
    importEligibility = "blocked-shared-cross-team-asset-union";
    blockers.push(
      "Shared Atlanta/Boston canonical payload requires a cross-team asset-union gate before import.",
    );
  } else if (
    item.packageKind === "perspective-append" &&
    item.perspectiveAlreadyPresent
  ) {
    importEligibility = "blocked-existing-perspective";
    blockers.push("Boston perspective already appears on the canonical target.");
  } else if (ambiguous.length > 0) {
    importEligibility = "blocked-ambiguous-player";
    blockers.push(
      `Ambiguous player identities: ${ambiguous
        .map((dependency) => dependency.displayName)
        .join(", ")}`,
    );
  } else if (missingShells.length > 0) {
    importEligibility = "ready-after-player-shells";
    blockers.push(
      `Player shells required: ${missingShells
        .map((dependency) => dependency.displayName)
        .join(", ")}`,
    );
  } else {
    importEligibility = "dependency-clear";
  }

  item.importEligibility = importEligibility;
  item.playerDependencyNames = relevantDependencies.map(
    (dependency) => dependency.displayName
  );
  item.playerShellDependencies = missingShells.map(
    (dependency) => dependency.provisionalPlayerId
  );
  item.ambiguousPlayerDependencies = ambiguous.map(
    (dependency) => dependency.displayName
  );
  item.blockers = blockers;
  item.importAuthorized = false;

  packageRows.push({
    packageId: item.packageId,
    packageKind: item.packageKind,
    sourceTradeId: item.sourceTradeId,
    targetCanonicalId: item.targetCanonicalId,
    importEligibility,
    playerDependencies: relevantDependencies.length,
    playerShellDependencies: missingShells.length,
    ambiguousPlayerDependencies: ambiguous.length,
    blockers: blockers.join(" | "),
    importAuthorized: false,
  });
}

const importEligibilityCounts = Object.fromEntries(
  [...new Set(packages.map((item) => item.importEligibility))]
    .sort()
    .map((status) => [
      status,
      packages.filter((item) => item.importEligibility === status).length,
    ]),
);

const dependencyStatusCounts = Object.fromEntries(
  [...new Set(dependencies.map((item) => item.dependencyStatus))]
    .sort()
    .map((status) => [
      status,
      dependencies.filter((item) => item.dependencyStatus === status).length,
    ]),
);

assert(
  Object.values(importEligibilityCounts).reduce((sum, count) => sum + count, 0) ===
    211,
  "Import-eligibility counts do not total 211.",
);
assert(
  Object.values(dependencyStatusCounts).reduce((sum, count) => sum + count, 0) ===
    dependencies.length,
  "Dependency-status counts do not total the unique player dependencies.",
);
assert(
  packages.every((item) => item.importAuthorized === false),
  "A package was marked import-authorized.",
);

const existingPerspectiveTargets = packages
  .filter((item) => item.packageKind === "perspective-append")
  .map((item) => item.targetCanonicalId);
assert(
  new Set(existingPerspectiveTargets).size === 11,
  "Perspective targets are not unique.",
);

const sharedPackages = packages.filter(
  (item) => item.packageKind === "shared-canonical-create",
);
assert(sharedPackages.length === 3, "Shared package count changed.");
assert(
  sharedPackages.every(
    (item) =>
      item.atlantaSourceTradeId &&
      item.canonicalPayload.perspectives.length === 2 &&
      item.importEligibility === "blocked-shared-cross-team-asset-union",
  ),
  "Shared package contract failed.",
);

const summary = {
  result: "PASS",
  phase: "4E",
  mode: "BOSTON_CANONICAL_PACKAGING_AND_IMPORT_ELIGIBILITY_FREEZE",
  sourceRows: 223,
  canonicalCreatePackages: 200,
  bostonOnlyCanonicalCreatePackages: 197,
  sharedCanonicalCreatePackages: 3,
  perspectiveAppendPackages: 11,
  excludedNonStandalone: 12,
  totalPackagingActions: 211,
  uniquePlayerDependencies: dependencies.length,
  dependencyOccurrences: dependencyOccurrences.length,
  dependencyStatusCounts,
  importEligibilityCounts,
  canonicalImports: 0,
  playerImports: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const dependencyRows = dependencies.map((dependency) => ({
  displayName: dependency.displayName,
  normalizedName: dependency.normalizedName,
  dependencyStatus: dependency.dependencyStatus,
  existingPlayerId: dependency.existingPlayerId ?? "",
  provisionalPlayerId: dependency.provisionalPlayerId ?? "",
  matchedPlayerIds: dependency.matchedPlayerIds.join(" | "),
  occurrenceCount: dependency.occurrenceCount,
  packageCount: dependency.packageIds.length,
  packageIds: dependency.packageIds.join(" | "),
  sourceTradeIds: dependency.sourceTradeIds.join(" | "),
}));

const shellRows = dependencies
  .filter(
    (dependency) =>
      dependency.dependencyStatus === "new-player-shell-required",
  )
  .map((dependency) => ({
    provisionalPlayerId: dependency.provisionalPlayerId,
    displayName: dependency.displayName,
    normalizedName: dependency.normalizedName,
    aliases: dependency.displayNames
      .filter((name) => name !== dependency.displayName)
      .join(" | "),
    packageCount: dependency.packageIds.length,
    sourceTradeIds: dependency.sourceTradeIds.join(" | "),
    importAuthorized: false,
  }));

const ambiguousRows = dependencies
  .filter(
    (dependency) =>
      dependency.dependencyStatus === "ambiguous-existing-player",
  )
  .map((dependency) => ({
    displayName: dependency.displayName,
    normalizedName: dependency.normalizedName,
    matchedPlayerIds: dependency.matchedPlayerIds.join(" | "),
    packageIds: dependency.packageIds.join(" | "),
    sourceTradeIds: dependency.sourceTradeIds.join(" | "),
  }));

const createRows = packages
  .filter((item) =>
    ["canonical-create", "shared-canonical-create"].includes(item.packageKind)
  )
  .map((item) => ({
    packageId: item.packageId,
    packageKind: item.packageKind,
    sourceTradeId: item.sourceTradeId,
    targetCanonicalId: item.targetCanonicalId,
    teams: item.canonicalPayload.teams.join(" | "),
    sourceTeams: item.canonicalPayload.sourceTeams.join(" | "),
    importEligibility: item.importEligibility,
    playerShellDependencies: item.playerShellDependencies.length,
    ambiguousPlayerDependencies: item.ambiguousPlayerDependencies.length,
    blockers: item.blockers.join(" | "),
    importAuthorized: false,
  }));

const perspectiveRows = packages
  .filter((item) => item.packageKind === "perspective-append")
  .map((item) => ({
    packageId: item.packageId,
    sourceTradeId: item.sourceTradeId,
    targetCanonicalId: item.targetCanonicalId,
    targetExists: item.targetExists,
    perspectiveAlreadyPresent: item.perspectiveAlreadyPresent,
    currentPerspectiveTeams: item.currentPerspectiveTeams.join(" | "),
    importEligibility: item.importEligibility,
    playerShellDependencies: item.playerShellDependencies.length,
    ambiguousPlayerDependencies: item.ambiguousPlayerDependencies.length,
    blockers: item.blockers.join(" | "),
    importAuthorized: false,
  }));

await Promise.all([
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4e-packaging-freeze.json"),
    `${JSON.stringify({ ...summary, packages, dependencies }, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4e-canonical-create-packages.csv"),
    toCsv(createRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4e-perspective-packages.csv"),
    toCsv(perspectiveRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4e-package-eligibility.csv"),
    toCsv(packageRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4e-player-dependencies.csv"),
    toCsv(dependencyRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4e-player-shell-preview.csv"),
    toCsv(shellRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4e-ambiguous-player-holds.csv"),
    toCsv(ambiguousRows),
    "utf8",
  ),
  writeFile(
    path.join(outputDir, "boston-celtics-phase-4e-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(JSON.stringify(summary, null, 2));
