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
function clean(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function slug(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/['’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
function normalizeIdentity(value) {
  return slug(value).replaceAll("-", " ");
}
function recordsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.players)) return value.players;
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, record]) => {
      if (record && typeof record === "object" && !Array.isArray(record)) {
        return { __fallbackId: key, ...record };
      }
      return { __fallbackId: key, name: record };
    });
  }
  return [];
}
function playerId(record, index) {
  return clean(
    record.id ??
      record.playerId ??
      record.slug ??
      record.key ??
      record.routeId ??
      record.__fallbackId ??
      `existing-player-${String(index + 1).padStart(4, "0")}`,
  );
}
function collectStrings(value, output, depth = 0) {
  if (depth > 3 || value == null) return;
  if (typeof value === "string") {
    if (clean(value)) output.push(clean(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, output, depth + 1);
    }
  }
}
function playerIdentityValues(record) {
  const output = [];
  for (const field of [
    "name",
    "fullName",
    "displayName",
    "playerName",
    "canonicalName",
    "slug",
    "aliases",
    "alias",
    "identityKeys",
    "identityKey",
    "legacyNames",
  ]) {
    collectStrings(record?.[field], output);
  }
  return [...new Set(output.map(clean).filter(Boolean))];
}
function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
}
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}
function toCsv(rows, headers) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

const args = parseArgs(process.argv);
for (const required of [
  "eligibility-freeze-json",
  "players-json",
  "contract-md",
  "expected-eligibility-records-sha",
  "expected-dependency-seeds-sha",
  "expected-player-identity-seeds-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [eligibilityBytes, playersBytes, contractBytes] = await Promise.all([
  readFile(args["eligibility-freeze-json"]),
  readFile(args["players-json"]),
  readFile(args["contract-md"]),
]);

const eligibility = JSON.parse(eligibilityBytes.toString("utf8"));
const playerStore = JSON.parse(playersBytes.toString("utf8"));
const existingPlayers = recordsFrom(playerStore);

assert(
  eligibility.result === "PASS" && eligibility.phase === "8E",
  "Invalid Phase 8E eligibility freeze.",
);
assert(
  Array.isArray(eligibility.eligibilityRecords) &&
    eligibility.eligibilityRecords.length === 204,
  "Expected 204 eligibility records.",
);
assert(
  Array.isArray(eligibility.dependencySeeds) &&
    eligibility.dependencySeeds.length === 533,
  "Expected 533 dependency seeds.",
);
assert(
  Array.isArray(eligibility.playerIdentitySeeds) &&
    eligibility.playerIdentitySeeds.length === 446,
  "Expected 446 player identity seeds.",
);
assert(
  eligibility.hashes.eligibilityRecordsSha256 ===
    args["expected-eligibility-records-sha"],
  "Eligibility-record hash differs from the frozen checkpoint.",
);
assert(
  eligibility.hashes.dependencySeedsSha256 ===
    args["expected-dependency-seeds-sha"],
  "Dependency-seed hash differs from the frozen checkpoint.",
);
assert(
  eligibility.hashes.playerIdentitySeedsSha256 ===
    args["expected-player-identity-seeds-sha"],
  "Player-identity-seed hash differs from the frozen checkpoint.",
);
assert(
  sha256(JSON.stringify(eligibility.eligibilityRecords)) ===
    args["expected-eligibility-records-sha"],
  "Eligibility records fail hash recomputation.",
);
assert(
  sha256(JSON.stringify(eligibility.dependencySeeds)) ===
    args["expected-dependency-seeds-sha"],
  "Dependency seeds fail hash recomputation.",
);
assert(
  sha256(JSON.stringify(eligibility.playerIdentitySeeds)) ===
    args["expected-player-identity-seeds-sha"],
  "Player identity seeds fail hash recomputation.",
);
assert(existingPlayers.length === 1510, "Expected the unchanged 1,510-player store.");

const eligibilityByKey = new Map(
  eligibility.eligibilityRecords.map((record) => [
    record.eligibilityKey,
    record,
  ]),
);
assert(eligibilityByKey.size === 204, "Duplicate eligibility key.");

const eligibleInputPackages = eligibility.eligibilityRecords.filter(
  (record) => record.eligible,
);
const inputHeldRecords = eligibility.eligibilityRecords.filter(
  (record) => record.held,
);
const excludedRecords = eligibility.eligibilityRecords.filter(
  (record) => record.excluded,
);

assert(eligibleInputPackages.length === 150, "Eligible input count drifted.");
assert(inputHeldRecords.length === 44, "Input held count drifted.");
assert(excludedRecords.length === 10, "Excluded input count drifted.");

const eligiblePackageKeys = new Set(
  eligibleInputPackages.map((record) => record.eligibilityKey),
);
assert(
  eligibility.dependencySeeds.every((seed) =>
    eligiblePackageKeys.has(seed.packageKey),
  ),
  "A dependency seed is detached from the eligible queue.",
);
assert(
  eligibility.playerIdentitySeeds.every((seed) =>
    eligiblePackageKeys.has(seed.packageKey),
  ),
  "A player identity seed is detached from the eligible queue.",
);

const existingById = new Map();
const identityIndex = new Map();

for (const [index, player] of existingPlayers.entries()) {
  const id = playerId(player, index);
  assert(!existingById.has(id), `Duplicate existing player ID: ${id}`);

  const values = playerIdentityValues(player);
  existingById.set(id, {
    playerId: id,
    displayName: clean(
      player.displayName ??
        player.fullName ??
        player.name ??
        player.playerName ??
        player.slug ??
        id,
    ),
    identityValues: values,
  });

  for (const value of values) {
    const key = normalizeIdentity(value);
    if (!key) continue;
    if (!identityIndex.has(key)) identityIndex.set(key, new Set());
    identityIndex.get(key).add(id);
  }
}

const identityOccurrences = eligibility.playerIdentitySeeds
  .map((seed) => {
    const displayName = clean(seed.displayName);
    const normalizedIdentityKey = normalizeIdentity(
      seed.normalizedIdentityKey || displayName,
    );
    const extractionSafe =
      seed.safetyStatus === "safe-format" &&
      Boolean(displayName) &&
      Boolean(normalizedIdentityKey);

    const matchIds = extractionSafe
      ? [...(identityIndex.get(normalizedIdentityKey) ?? new Set())].sort()
      : [];

    let identityStatus = "proposed-player-shell";
    if (!extractionSafe) identityStatus = "unsafe-identity-held";
    else if (matchIds.length === 1) identityStatus = "existing-player-exact";
    else if (matchIds.length > 1) {
      identityStatus = "ambiguous-existing-identity";
    }

    const proposedPlayerKey =
      identityStatus === "proposed-player-shell"
        ? `proposed-player:${slug(displayName)}`
        : null;

    return {
      identitySeedKey: seed.identitySeedKey,
      dependencyKey: seed.dependencyKey,
      packageKey: seed.packageKey,
      sourceTradeId: seed.sourceTradeId,
      sourceRow: seed.sourceRow,
      tradeDate: seed.tradeDate,
      side: seed.side,
      rawAsset: seed.rawAsset,
      identityKind: seed.identityKind,
      displayName,
      normalizedIdentityKey,
      sourceSafetyStatus: seed.safetyStatus,
      extractionSafe,
      identityStatus,
      exactExistingMatchCount: matchIds.length,
      existingPlayerIds: matchIds,
      proposedPlayerKey,
      privateOnly: true,
      indexEligible: false,
      adEligible: false,
      automaticPlayerCreate: false,
      automaticIdentityMerge: false,
      playerImport: false,
      relationshipWrite: false,
    };
  })
  .sort((left, right) =>
    left.identitySeedKey.localeCompare(right.identitySeedKey, "en"),
  );

assert(
  new Set(identityOccurrences.map((record) => record.identitySeedKey)).size ===
    446,
  "Identity occurrence keys are not unique.",
);

const occurrencesByPackage = new Map();
for (const occurrence of identityOccurrences) {
  if (!occurrencesByPackage.has(occurrence.packageKey)) {
    occurrencesByPackage.set(occurrence.packageKey, []);
  }
  occurrencesByPackage.get(occurrence.packageKey).push(occurrence);
}

const dependencyCountByPackage = new Map();
for (const dependency of eligibility.dependencySeeds) {
  dependencyCountByPackage.set(
    dependency.packageKey,
    (dependencyCountByPackage.get(dependency.packageKey) ?? 0) + 1,
  );
}

const packageReadiness = eligibleInputPackages
  .map((record) => {
    const occurrences = occurrencesByPackage.get(record.eligibilityKey) ?? [];
    const ambiguous = occurrences.filter(
      (occurrence) =>
        occurrence.identityStatus === "ambiguous-existing-identity",
    );
    const unsafe = occurrences.filter(
      (occurrence) => occurrence.identityStatus === "unsafe-identity-held",
    );
    const held = ambiguous.length > 0 || unsafe.length > 0;

    return {
      packageKey: record.eligibilityKey,
      sourceTradeId: record.sourceTradeId,
      sourceRow: record.sourceRow,
      tradeDate: record.tradeDate,
      teams: [...record.teams],
      partnerTeams: [...record.partnerTeams],
      verdict: record.verdict,
      contentClass: record.contentClass,
      databaseStatus: record.databaseStatus,
      privateNoindexArchive: record.privateNoindexArchive,
      archiveImportReady: record.archiveImportReady,
      routingRequired: record.routingRequired,
      routeFrozen: record.routeFrozen,
      dependencySeedCount:
        dependencyCountByPackage.get(record.eligibilityKey) ?? 0,
      identityOccurrenceCount: occurrences.length,
      exactExistingOccurrenceCount: occurrences.filter(
        (occurrence) =>
          occurrence.identityStatus === "existing-player-exact",
      ).length,
      proposedShellOccurrenceCount: occurrences.filter(
        (occurrence) =>
          occurrence.identityStatus === "proposed-player-shell",
      ).length,
      ambiguousOccurrenceCount: ambiguous.length,
      unsafeOccurrenceCount: unsafe.length,
      packageReady: !held,
      packageHeld: held,
      packageStatus: held
        ? "held-for-player-identity-resolution"
        : "ready-for-private-canonical-packaging",
      identityHoldReasons: [
        ...(ambiguous.length > 0
          ? ["ambiguous-existing-identity"]
          : []),
        ...(unsafe.length > 0
          ? ["unsafe-identity-extraction"]
          : []),
      ],
      automaticPlayerCreate: false,
      automaticIdentityMerge: false,
      canonicalImport: false,
      playerImport: false,
      relationshipWrite: false,
    };
  })
  .sort(
    (left, right) =>
      Number(left.sourceRow) - Number(right.sourceRow) ||
      left.sourceTradeId.localeCompare(right.sourceTradeId, "en"),
  );

const readyPackages = packageReadiness.filter((record) => record.packageReady);
const heldIdentityPackages = packageReadiness.filter(
  (record) => record.packageHeld,
);
const readyPackageKeys = new Set(
  readyPackages.map((record) => record.packageKey),
);
const heldPackageKeys = new Set(
  heldIdentityPackages.map((record) => record.packageKey),
);

const readyIdentityOccurrences = identityOccurrences.filter((record) =>
  readyPackageKeys.has(record.packageKey),
);
const heldPackageIdentityOccurrences = identityOccurrences.filter((record) =>
  heldPackageKeys.has(record.packageKey),
);
const exactExistingReadyOccurrences = readyIdentityOccurrences.filter(
  (record) => record.identityStatus === "existing-player-exact",
);
const proposedReadyOccurrences = readyIdentityOccurrences.filter(
  (record) => record.identityStatus === "proposed-player-shell",
);
const ambiguousOccurrences = identityOccurrences.filter(
  (record) => record.identityStatus === "ambiguous-existing-identity",
);
const unsafeOccurrences = identityOccurrences.filter(
  (record) => record.identityStatus === "unsafe-identity-held",
);

assert(
  readyIdentityOccurrences.every(
    (record) =>
      record.identityStatus === "existing-player-exact" ||
      record.identityStatus === "proposed-player-shell",
  ),
  "A ready package contains an unresolved identity.",
);

const proposedShellMap = new Map();
for (const occurrence of proposedReadyOccurrences) {
  assert(
    occurrence.proposedPlayerKey,
    `${occurrence.identitySeedKey}: proposed player key is missing.`,
  );
  if (!proposedShellMap.has(occurrence.proposedPlayerKey)) {
    proposedShellMap.set(occurrence.proposedPlayerKey, {
      proposedPlayerKey: occurrence.proposedPlayerKey,
      proposedPlayerId: `nba-player-${slug(occurrence.displayName)}`,
      displayName: occurrence.displayName,
      normalizedIdentityKey: occurrence.normalizedIdentityKey,
      occurrenceKeys: [],
      packageKeys: new Set(),
      sourceTradeIds: new Set(),
      identityKinds: new Set(),
      privateOnly: true,
      indexEligible: false,
      adEligible: false,
      automaticPlayerCreate: false,
      playerImport: false,
    });
  }
  const shell = proposedShellMap.get(occurrence.proposedPlayerKey);
  shell.occurrenceKeys.push(occurrence.identitySeedKey);
  shell.packageKeys.add(occurrence.packageKey);
  shell.sourceTradeIds.add(occurrence.sourceTradeId);
  shell.identityKinds.add(occurrence.identityKind);
}

const proposedPlayerShells = [...proposedShellMap.values()]
  .map((record) => ({
    ...record,
    occurrenceKeys: [...record.occurrenceKeys].sort(),
    packageKeys: [...record.packageKeys].sort(),
    sourceTradeIds: [...record.sourceTradeIds].sort(),
    identityKinds: [...record.identityKinds].sort(),
    occurrenceCount: record.occurrenceKeys.length,
    packageCount: record.packageKeys.size,
  }))
  .sort((left, right) =>
    left.proposedPlayerKey.localeCompare(right.proposedPlayerKey, "en"),
  );

assert(
  new Set(proposedPlayerShells.map((record) => record.proposedPlayerId)).size ===
    proposedPlayerShells.length,
  "Proposed player IDs are not unique.",
);

const proposedShellByKey = new Map(
  proposedPlayerShells.map((record) => [
    record.proposedPlayerKey,
    record,
  ]),
);

const relationshipPreviews = readyIdentityOccurrences
  .map((occurrence) => {
    const existingPlayerId =
      occurrence.identityStatus === "existing-player-exact"
        ? occurrence.existingPlayerIds[0]
        : null;
    const proposedPlayer = occurrence.proposedPlayerKey
      ? proposedShellByKey.get(occurrence.proposedPlayerKey)
      : null;
    const targetPlayerKey =
      existingPlayerId ?? proposedPlayer?.proposedPlayerId ?? null;

    assert(
      targetPlayerKey,
      `${occurrence.identitySeedKey}: target player key is missing.`,
    );

    return {
      relationshipEdgeKey:
        `${occurrence.identitySeedKey}:player:${targetPlayerKey}`,
      packageKey: occurrence.packageKey,
      sourceTradeId: occurrence.sourceTradeId,
      sourceRow: occurrence.sourceRow,
      tradeDate: occurrence.tradeDate,
      side: occurrence.side,
      relationshipType:
        occurrence.side === "received"
          ? "cleveland-acquired-player"
          : "cleveland-sent-player",
      rawAsset: occurrence.rawAsset,
      identityKind: occurrence.identityKind,
      identityStatus: occurrence.identityStatus,
      targetPlayerKey,
      existingPlayerId,
      proposedPlayerId: proposedPlayer?.proposedPlayerId ?? null,
      privateOnly: true,
      indexEligible: false,
      adEligible: false,
      relationshipWrite: false,
      playerImport: false,
      canonicalImport: false,
    };
  })
  .sort((left, right) =>
    left.relationshipEdgeKey.localeCompare(right.relationshipEdgeKey, "en"),
  );

assert(
  new Set(relationshipPreviews.map((record) => record.relationshipEdgeKey))
    .size === relationshipPreviews.length,
  "Relationship preview keys are not unique.",
);

const archiveInputRecords = eligibleInputPackages.filter(
  (record) => record.archiveImportReady,
);
const archiveReadyPackages = readyPackages.filter(
  (record) => record.archiveImportReady,
);
const archiveHeldIdentityPackages = heldIdentityPackages.filter(
  (record) => record.archiveImportReady,
);

const counts = {
  sourceRows: eligibility.counts.sourceRows,
  eligibleInputPackages: eligibleInputPackages.length,
  inputHeldRecords: inputHeldRecords.length,
  excludedRecords: excludedRecords.length,
  dependencySeedRows: eligibility.dependencySeeds.length,
  playerIdentitySeedRows: identityOccurrences.length,
  nonIdentityAssetSeedRows:
    eligibility.dependencySeeds.length - identityOccurrences.length,
  readyPackages: readyPackages.length,
  heldIdentityPackages: heldIdentityPackages.length,
  readyIdentityOccurrences: readyIdentityOccurrences.length,
  heldPackageIdentityOccurrences: heldPackageIdentityOccurrences.length,
  exactExistingReadyOccurrences: exactExistingReadyOccurrences.length,
  proposedShellReadyOccurrences: proposedReadyOccurrences.length,
  ambiguousIdentityOccurrences: ambiguousOccurrences.length,
  unsafeIdentityOccurrences: unsafeOccurrences.length,
  proposedPlayerShells: proposedPlayerShells.length,
  exactExistingUniquePlayers: new Set(
    exactExistingReadyOccurrences.flatMap(
      (record) => record.existingPlayerIds,
    ),
  ).size,
  relationshipPreviewEdges: relationshipPreviews.length,
  archiveInputRows: archiveInputRecords.length,
  archiveReadyPackages: archiveReadyPackages.length,
  archiveHeldIdentityPackages: archiveHeldIdentityPackages.length,
  identityStatusCounts: countBy(
    identityOccurrences.map((record) => record.identityStatus),
  ),
  packageStatusCounts: countBy(
    packageReadiness.map((record) => record.packageStatus),
  ),
  relationshipTypeCounts: countBy(
    relationshipPreviews.map((record) => record.relationshipType),
  ),
  identityKindCounts: countBy(
    identityOccurrences.map((record) => record.identityKind),
  ),
};

assert(counts.sourceRows === 204, "Source-row count drifted.");
assert(counts.eligibleInputPackages === 150, "Eligible input count drifted.");
assert(counts.inputHeldRecords === 44, "Input held count drifted.");
assert(counts.excludedRecords === 10, "Excluded input count drifted.");
assert(counts.dependencySeedRows === 533, "Dependency-seed count drifted.");
assert(counts.playerIdentitySeedRows === 446, "Player identity count drifted.");
assert(counts.nonIdentityAssetSeedRows === 87, "Non-identity asset count drifted.");
assert(
  counts.readyPackages + counts.heldIdentityPackages === 150,
  "Eligible package partition does not close.",
);
assert(
  counts.readyIdentityOccurrences +
    counts.heldPackageIdentityOccurrences === 446,
  "Identity occurrence package partition does not close.",
);
assert(
  counts.exactExistingReadyOccurrences +
    counts.proposedShellReadyOccurrences ===
      counts.readyIdentityOccurrences,
  "Ready identity partition does not close.",
);
assert(
  counts.relationshipPreviewEdges === counts.readyIdentityOccurrences,
  "Relationship preview count differs from ready identity occurrences.",
);
assert(counts.archiveInputRows === 5, "Archive eligible input count drifted.");
assert(
  counts.archiveReadyPackages + counts.archiveHeldIdentityPackages === 5,
  "Archive identity partition does not close.",
);
assert(
  packageReadiness.every(
    (record) =>
      record.automaticPlayerCreate === false &&
      record.automaticIdentityMerge === false &&
      record.canonicalImport === false &&
      record.playerImport === false &&
      record.relationshipWrite === false,
  ),
  "A package write or automatic identity action was enabled.",
);
assert(
  relationshipPreviews.every(
    (record) =>
      record.relationshipWrite === false &&
      record.playerImport === false &&
      record.canonicalImport === false,
  ),
  "A relationship preview enabled a store write.",
);

const hashes = {
  packageReadinessSha256: sha256(JSON.stringify(packageReadiness)),
  identityOccurrencesSha256: sha256(JSON.stringify(identityOccurrences)),
  proposedPlayerShellsSha256: sha256(JSON.stringify(proposedPlayerShells)),
  relationshipPreviewsSha256: sha256(JSON.stringify(relationshipPreviews)),
  eligibilityRecordsSha256:
    eligibility.hashes.eligibilityRecordsSha256,
  dependencySeedsSha256: eligibility.hashes.dependencySeedsSha256,
  playerIdentitySeedsSha256:
    eligibility.hashes.playerIdentitySeedsSha256,
  playerStoreSha256: sha256(playersBytes),
  contractSha256: sha256(contractBytes),
};

const manifest = {
  result: "PASS",
  phase: "8F",
  mode: "PLAYER_IDENTITY_AND_RELATIONSHIP_FREEZE",
  sourceTeam: "cleveland-cavaliers",
  counts,
  hashes,
  packageReadiness,
  identityOccurrences,
  proposedPlayerShells,
  relationshipPreviews,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticPlayerCreates: 0,
  automaticIdentityMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const packageHeaders = [
  "packageKey","sourceTradeId","sourceRow","tradeDate","teams",
  "partnerTeams","verdict","contentClass","databaseStatus",
  "privateNoindexArchive","archiveImportReady","routingRequired",
  "routeFrozen","dependencySeedCount","identityOccurrenceCount",
  "exactExistingOccurrenceCount","proposedShellOccurrenceCount",
  "ambiguousOccurrenceCount","unsafeOccurrenceCount","packageReady",
  "packageHeld","packageStatus","identityHoldReasons",
  "automaticPlayerCreate","automaticIdentityMerge",
];
const packageRows = (records) =>
  records.map((record) => ({
    ...record,
    teams: record.teams.join(" | "),
    partnerTeams: record.partnerTeams.join(" | "),
    identityHoldReasons: record.identityHoldReasons.join(" | "),
  }));

const occurrenceHeaders = [
  "identitySeedKey","dependencyKey","packageKey","sourceTradeId",
  "sourceRow","tradeDate","side","rawAsset","identityKind","displayName",
  "normalizedIdentityKey","sourceSafetyStatus","extractionSafe",
  "identityStatus","exactExistingMatchCount","existingPlayerIds",
  "proposedPlayerKey","automaticPlayerCreate","automaticIdentityMerge",
];
const occurrenceRows = (records) =>
  records.map((record) => ({
    ...record,
    existingPlayerIds: record.existingPlayerIds.join(" | "),
  }));

const heldInputHeaders = [
  "eligibilityKey","sourceTradeId","sourceRow","tradeDate","teams",
  "partnerTeams","verdict","contentClass","databaseStatus",
  "archiveImportReady","routingRequired","routeFrozen",
  "priorResolutionClass","holdReasons","eligibilityStatus",
];
const heldInputRows = (records) =>
  records.map((record) => ({
    ...record,
    teams: record.teams.join(" | "),
    partnerTeams: record.partnerTeams.join(" | "),
    holdReasons: record.holdReasons.join(" | "),
  }));

await Promise.all([
  writeFile(
    path.join(
      outputDir,
      "cleveland-cavaliers-phase-8f-player-relationship-freeze.json",
    ),
    JSON.stringify(manifest, null, 2) + "\n",
  ),
  writeFile(
    path.join(outputDir, "cleveland-cavaliers-phase-8f-package-readiness.csv"),
    toCsv(packageRows(packageReadiness), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "cleveland-cavaliers-phase-8f-ready-packages.csv"),
    toCsv(packageRows(readyPackages), packageHeaders),
  ),
  writeFile(
    path.join(
      outputDir,
      "cleveland-cavaliers-phase-8f-held-identity-packages.csv",
    ),
    toCsv(packageRows(heldIdentityPackages), packageHeaders),
  ),
  writeFile(
    path.join(
      outputDir,
      "cleveland-cavaliers-phase-8f-exact-existing-player-matches.csv",
    ),
    toCsv(
      occurrenceRows(exactExistingReadyOccurrences),
      occurrenceHeaders,
    ),
  ),
  writeFile(
    path.join(
      outputDir,
      "cleveland-cavaliers-phase-8f-proposed-player-shells.csv",
    ),
    toCsv(proposedPlayerShells, [
      "proposedPlayerKey","proposedPlayerId","displayName",
      "normalizedIdentityKey","identityKinds","occurrenceCount",
      "packageCount","occurrenceKeys","packageKeys","sourceTradeIds",
      "automaticPlayerCreate","playerImport",
    ]),
  ),
  writeFile(
    path.join(
      outputDir,
      "cleveland-cavaliers-phase-8f-ambiguous-player-occurrences.csv",
    ),
    toCsv(occurrenceRows(ambiguousOccurrences), occurrenceHeaders),
  ),
  writeFile(
    path.join(
      outputDir,
      "cleveland-cavaliers-phase-8f-unsafe-player-occurrences.csv",
    ),
    toCsv(occurrenceRows(unsafeOccurrences), occurrenceHeaders),
  ),
  writeFile(
    path.join(
      outputDir,
      "cleveland-cavaliers-phase-8f-held-package-identity-occurrences.csv",
    ),
    toCsv(
      occurrenceRows(heldPackageIdentityOccurrences),
      occurrenceHeaders,
    ),
  ),
  writeFile(
    path.join(
      outputDir,
      "cleveland-cavaliers-phase-8f-relationship-previews.csv",
    ),
    toCsv(relationshipPreviews, [
      "relationshipEdgeKey","packageKey","sourceTradeId","sourceRow",
      "tradeDate","side","relationshipType","rawAsset","identityKind",
      "identityStatus","targetPlayerKey","existingPlayerId",
      "proposedPlayerId","relationshipWrite","playerImport",
      "canonicalImport",
    ]),
  ),
  writeFile(
    path.join(
      outputDir,
      "cleveland-cavaliers-phase-8f-input-held-records.csv",
    ),
    toCsv(heldInputRows(inputHeldRecords), heldInputHeaders),
  ),
  writeFile(
    path.join(
      outputDir,
      "cleveland-cavaliers-phase-8f-excluded-followups.csv",
    ),
    toCsv(heldInputRows(excludedRecords), heldInputHeaders),
  ),
  writeFile(
    path.join(outputDir, "cleveland-cavaliers-phase-8f-summary.json"),
    JSON.stringify({
      result: "PASS",
      phase: "8F",
      counts,
      hashes,
      canonicalImports: 0,
      playerImports: 0,
      relationshipWrites: 0,
      automaticPlayerCreates: 0,
      automaticIdentityMerges: 0,
    }, null, 2) + "\n",
  ),
]);

console.log(JSON.stringify({
  result: "PASS",
  phase: "8F",
  counts,
  hashes,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticPlayerCreates: 0,
  automaticIdentityMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
