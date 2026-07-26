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
  return String(value ?? "").trim();
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
function extractPersonName(assetText) {
  let value = clean(assetText)
    .replace(/[–—]/gu, "-")
    .replace(/\s+/gu, " ");

  value = value.replace(
    /^(?:the\s+)?(?:draft\s+rights\s+to|rights\s+to|player\s+rights\s+to)\s+/iu,
    "",
  );
  value = value.replace(
    /^(?:acquired|received|sent|traded|signed-and-traded|sign-and-traded)\s+/iu,
    "",
  );

  // Parenthetical material in this dataset is provenance, draft outcome,
  // nickname clarification or another non-identity annotation.
  value = value.replace(/\s*\([^)]*\)\s*/gu, " ").replace(/\s+/gu, " ").trim();
  value = value.replace(/\s+(?:from|to)\s+[A-Z].*$/u, "").trim();
  value = value.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+|[^A-Za-zÀ-ÖØ-öø-ÿ.' -]+$/gu, "").trim();

  const normalized = normalizeIdentity(value);
  const tokens = normalized.split(" ").filter(Boolean);
  const forbidden = new Set([
    "cash",
    "considerations",
    "consideration",
    "future",
    "pick",
    "picks",
    "round",
    "swap",
    "exception",
    "protected",
    "unprotected",
    "conditional",
    "rights",
    "draft",
    "unknown",
    "none",
    "waived",
    "player",
    "person",
    "salary",
    "cap",
  ]);
  const hasForbiddenToken = tokens.some((token) => forbidden.has(token));
  const hasDigitOrQuestion = /[\d?]/u.test(value);
  const hasLetter = /\p{L}/u.test(value);
  const tokenCountSafe = tokens.length >= 1 && tokens.length <= 8;

  return {
    extractedName: value,
    normalizedIdentityKey: normalized,
    safe:
      Boolean(value) &&
      Boolean(normalized) &&
      hasLetter &&
      !hasDigitOrQuestion &&
      !hasForbiddenToken &&
      tokenCountSafe,
  };
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
  "expected-dependency-seed-sha",
  "expected-player-identity-seed-sha",
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

assert(eligibility.result === "PASS" && eligibility.phase === "7E", "Invalid Phase 7E eligibility freeze.");
assert(Array.isArray(eligibility.eligibilityRecords) && eligibility.eligibilityRecords.length === 219, "Expected 219 eligibility rows.");
assert(Array.isArray(eligibility.dependencySeedRecords) && eligibility.dependencySeedRecords.length === 620, "Expected 620 dependency seeds.");
assert(
  eligibility.eligibilityRecordsSha256 === args["expected-eligibility-records-sha"],
  "Eligibility-record hash differs from the frozen checkpoint.",
);
assert(
  eligibility.dependencySeedSha256 === args["expected-dependency-seed-sha"],
  "Dependency-seed hash differs from the frozen checkpoint.",
);
assert(
  eligibility.playerIdentitySeedSha256 === args["expected-player-identity-seed-sha"],
  "Player-identity seed hash differs from the frozen checkpoint.",
);
assert(
  sha256(JSON.stringify(eligibility.eligibilityRecords)) ===
    args["expected-eligibility-records-sha"],
  "Eligibility records fail hash recomputation.",
);
assert(
  sha256(JSON.stringify(eligibility.dependencySeedRecords)) ===
    args["expected-dependency-seed-sha"],
  "Dependency seeds fail hash recomputation.",
);

const playerIdentitySeeds = eligibility.dependencySeedRecords.filter(
  (record) => record.identityResolutionRequired,
);
assert(playerIdentitySeeds.length === 371, "Expected 371 player-identity seeds.");
assert(
  sha256(JSON.stringify(playerIdentitySeeds)) ===
    args["expected-player-identity-seed-sha"],
  "Player-identity seeds fail hash recomputation.",
);
assert(existingPlayers.length === 1292, "Expected the unchanged 1,292-player store.");

const existingById = new Map();
const identityIndex = new Map();

for (const [index, player] of existingPlayers.entries()) {
  const id = playerId(player, index);
  assert(!existingById.has(id), `Duplicate existing player ID: ${id}`);
  const names = playerIdentityValues(player);
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
    identityValues: names,
  });

  for (const value of names) {
    const key = normalizeIdentity(value);
    if (!key) continue;
    if (!identityIndex.has(key)) identityIndex.set(key, new Set());
    identityIndex.get(key).add(id);
  }
}

const identityOccurrences = playerIdentitySeeds.map((seed) => {
  const parsed = extractPersonName(seed.assetText);
  const matchIds = parsed.safe
    ? [...(identityIndex.get(parsed.normalizedIdentityKey) ?? new Set())].sort()
    : [];

  let identityStatus = "proposed-player-shell";
  if (!parsed.safe) identityStatus = "unsafe-identity-held";
  else if (matchIds.length === 1) identityStatus = "existing-player-exact";
  else if (matchIds.length > 1) identityStatus = "ambiguous-existing-identity";

  const proposedPlayerKey =
    identityStatus === "proposed-player-shell"
      ? `proposed-player:${slug(parsed.extractedName)}`
      : null;

  return {
    dependencySeedKey: seed.dependencySeedKey,
    packageKey: seed.packageKey,
    sourceTradeId: seed.sourceTradeId,
    sourceRow: seed.sourceRow,
    tradeDate: seed.tradeDate,
    direction: seed.direction,
    assetIndex: seed.assetIndex,
    assetText: seed.assetText,
    assetClass: seed.assetClass,
    extractedName: parsed.extractedName,
    normalizedIdentityKey: parsed.normalizedIdentityKey,
    extractionSafe: parsed.safe,
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
});

assert(
  new Set(identityOccurrences.map((record) => record.dependencySeedKey)).size ===
    371,
  "Identity occurrence keys are not unique.",
);

const occurrencesByPackage = new Map();
for (const occurrence of identityOccurrences) {
  if (!occurrencesByPackage.has(occurrence.packageKey)) {
    occurrencesByPackage.set(occurrence.packageKey, []);
  }
  occurrencesByPackage.get(occurrence.packageKey).push(occurrence);
}

const eligibleInputPackages = eligibility.eligibilityRecords.filter(
  (record) => record.importEligible,
);
const inputHeldRecords = eligibility.eligibilityRecords.filter(
  (record) => record.held,
);
const excludedRecords = eligibility.eligibilityRecords.filter(
  (record) => record.excluded,
);

assert(eligibleInputPackages.length === 187, "Eligible input package count drifted.");
assert(inputHeldRecords.length === 25, "Input held-record count drifted.");
assert(excludedRecords.length === 7, "Excluded-record count drifted.");

const packageReadiness = eligibleInputPackages.map((record) => {
  const occurrences = occurrencesByPackage.get(record.packageKey) ?? [];
  const ambiguous = occurrences.filter(
    (occurrence) =>
      occurrence.identityStatus === "ambiguous-existing-identity",
  );
  const unsafe = occurrences.filter(
    (occurrence) => occurrence.identityStatus === "unsafe-identity-held",
  );
  const held = ambiguous.length > 0 || unsafe.length > 0;

  return {
    packageKey: record.packageKey,
    sourceTradeId: record.sourceTradeId,
    sourceRow: record.sourceRow,
    tradeDate: record.tradeDate,
    teams: record.teams,
    verdict: record.verdict,
    contentClass: record.contentClass,
    databaseStatus: record.databaseStatus,
    privateArchive: record.privateArchive,
    archiveDatabaseReady: record.archiveDatabaseReady,
    routingRequired: record.routingRequired,
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
      ...(ambiguous.length > 0 ? ["ambiguous-existing-identity"] : []),
      ...(unsafe.length > 0 ? ["unsafe-identity-extraction"] : []),
    ],
    automaticPlayerCreate: false,
    automaticIdentityMerge: false,
    canonicalImport: false,
    playerImport: false,
    relationshipWrite: false,
  };
});

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

const readyIdentityOccurrences = identityOccurrences.filter(
  (record) => readyPackageKeys.has(record.packageKey),
);
const heldPackageIdentityOccurrences = identityOccurrences.filter(
  (record) => heldPackageKeys.has(record.packageKey),
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
  if (!proposedShellMap.has(occurrence.proposedPlayerKey)) {
    proposedShellMap.set(occurrence.proposedPlayerKey, {
      proposedPlayerKey: occurrence.proposedPlayerKey,
      proposedPlayerId: `nba-player-${slug(occurrence.extractedName)}`,
      displayName: occurrence.extractedName,
      normalizedIdentityKey: occurrence.normalizedIdentityKey,
      occurrenceKeys: [],
      packageKeys: new Set(),
      sourceTradeIds: new Set(),
      privateOnly: true,
      indexEligible: false,
      adEligible: false,
      automaticPlayerCreate: false,
      playerImport: false,
    });
  }
  const shell = proposedShellMap.get(occurrence.proposedPlayerKey);
  shell.occurrenceKeys.push(occurrence.dependencySeedKey);
  shell.packageKeys.add(occurrence.packageKey);
  shell.sourceTradeIds.add(occurrence.sourceTradeId);
}

const proposedPlayerShells = [...proposedShellMap.values()]
  .map((record) => ({
    ...record,
    occurrenceKeys: [...record.occurrenceKeys].sort(),
    packageKeys: [...record.packageKeys].sort(),
    sourceTradeIds: [...record.sourceTradeIds].sort(),
    occurrenceCount: record.occurrenceKeys.length,
    packageCount: record.packageKeys.size,
  }))
  .sort((left, right) =>
    left.proposedPlayerKey.localeCompare(right.proposedPlayerKey, "en"),
  );

const relationshipPreviews = readyIdentityOccurrences
  .map((occurrence) => {
    const existingPlayerId =
      occurrence.identityStatus === "existing-player-exact"
        ? occurrence.existingPlayerIds[0]
        : null;
    const proposedPlayer = proposedPlayerShells.find(
      (record) =>
        record.proposedPlayerKey === occurrence.proposedPlayerKey,
    );
    const targetPlayerKey =
      existingPlayerId ?? proposedPlayer?.proposedPlayerId ?? null;

    assert(targetPlayerKey, `${occurrence.dependencySeedKey}: target player key is missing.`);

    return {
      relationshipEdgeKey:
        `${occurrence.dependencySeedKey}:player:${targetPlayerKey}`,
      packageKey: occurrence.packageKey,
      sourceTradeId: occurrence.sourceTradeId,
      sourceRow: occurrence.sourceRow,
      tradeDate: occurrence.tradeDate,
      direction: occurrence.direction,
      relationshipType:
        occurrence.direction === "incoming"
          ? "chicago-acquired-player"
          : "chicago-sent-player",
      assetText: occurrence.assetText,
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

const counts = {
  sourceRows: eligibility.counts.sourceRows,
  eligibleInputPackages: eligibleInputPackages.length,
  inputHeldRecords: inputHeldRecords.length,
  excludedRecords: excludedRecords.length,
  dependencySeedRows: eligibility.dependencySeedRecords.length,
  playerIdentitySeedRows: identityOccurrences.length,
  nonIdentityAssetSeedRows:
    eligibility.dependencySeedRecords.length - identityOccurrences.length,
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
  archiveReadyInputRows: eligibility.counts.archiveImportReadyRows,
  archiveEligibleInputRows: eligibility.counts.archiveEligibleRows,
  archiveHeldInputRows: eligibility.counts.archiveHeldRows,
  archiveExcludedInputRows: eligibility.counts.archiveExcludedRows,
  identityStatusCounts: countBy(
    identityOccurrences.map((record) => record.identityStatus),
  ),
  packageStatusCounts: countBy(
    packageReadiness.map((record) => record.packageStatus),
  ),
  relationshipTypeCounts: countBy(
    relationshipPreviews.map((record) => record.relationshipType),
  ),
};

assert(counts.sourceRows === 219, "Source-row count drifted.");
assert(counts.eligibleInputPackages === 187, "Eligible input count drifted.");
assert(counts.inputHeldRecords === 25, "Input held count drifted.");
assert(counts.excludedRecords === 7, "Excluded input count drifted.");
assert(counts.dependencySeedRows === 620, "Dependency-seed count drifted.");
assert(counts.playerIdentitySeedRows === 371, "Player-identity seed count drifted.");
assert(counts.nonIdentityAssetSeedRows === 249, "Non-identity asset count drifted.");
assert(counts.readyPackages + counts.heldIdentityPackages === 187, "Eligible package partition does not close.");
assert(
  counts.readyIdentityOccurrences +
    counts.heldPackageIdentityOccurrences === 371,
  "Identity occurrence package partition does not close.",
);
assert(
  counts.exactExistingReadyOccurrences +
    counts.proposedShellReadyOccurrences ===
      counts.readyIdentityOccurrences,
  "Ready identity occurrence partition does not close.",
);
assert(
  counts.relationshipPreviewEdges ===
    counts.readyIdentityOccurrences,
  "Relationship preview count differs from ready identity occurrences.",
);
assert(counts.archiveReadyInputRows === 15, "Archive-ready input count drifted.");
assert(
  counts.archiveEligibleInputRows +
    counts.archiveHeldInputRows +
    counts.archiveExcludedInputRows === 15,
  "Archive input split does not close.",
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

const packageReadinessSha256 = sha256(JSON.stringify(packageReadiness));
const identityOccurrencesSha256 = sha256(JSON.stringify(identityOccurrences));
const proposedPlayerShellsSha256 = sha256(JSON.stringify(proposedPlayerShells));
const relationshipPreviewsSha256 = sha256(JSON.stringify(relationshipPreviews));

const manifest = {
  result: "PASS",
  phase: "7F",
  mode: "PLAYER_IDENTITY_AND_RELATIONSHIP_FREEZE",
  sourceTeam: "chicago-bulls",
  counts,
  packageReadinessSha256,
  identityOccurrencesSha256,
  proposedPlayerShellsSha256,
  relationshipPreviewsSha256,
  sourceHashes: {
    eligibilityFreezeJsonSha256: sha256(eligibilityBytes),
    playerStoreSha256: sha256(playersBytes),
    contractSha256: sha256(contractBytes),
    phase7EEligibilityRecordsSha256:
      eligibility.eligibilityRecordsSha256,
    phase7EDependencySeedSha256:
      eligibility.dependencySeedSha256,
    phase7EPlayerIdentitySeedSha256:
      eligibility.playerIdentitySeedSha256,
  },
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
  "packageKey", "sourceTradeId", "sourceRow", "tradeDate", "teams",
  "verdict", "contentClass", "databaseStatus", "privateArchive",
  "archiveDatabaseReady", "routingRequired", "identityOccurrenceCount",
  "exactExistingOccurrenceCount", "proposedShellOccurrenceCount",
  "ambiguousOccurrenceCount", "unsafeOccurrenceCount", "packageReady",
  "packageHeld", "packageStatus", "identityHoldReasons",
  "automaticPlayerCreate", "automaticIdentityMerge",
];
function packageRows(records) {
  return records.map((record) => ({
    ...record,
    teams: record.teams.join(" | "),
    identityHoldReasons: record.identityHoldReasons.join(" | "),
  }));
}
const occurrenceHeaders = [
  "dependencySeedKey", "packageKey", "sourceTradeId", "sourceRow",
  "tradeDate", "direction", "assetIndex", "assetText", "assetClass",
  "extractedName", "normalizedIdentityKey", "extractionSafe",
  "identityStatus", "exactExistingMatchCount", "existingPlayerIds",
  "proposedPlayerKey", "automaticPlayerCreate", "automaticIdentityMerge",
];
function occurrenceRows(records) {
  return records.map((record) => ({
    ...record,
    existingPlayerIds: record.existingPlayerIds.join(" | "),
  }));
}

await Promise.all([
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-player-relationship-freeze.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-package-readiness.csv"),
    toCsv(packageRows(packageReadiness), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-ready-packages.csv"),
    toCsv(packageRows(readyPackages), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-held-identity-packages.csv"),
    toCsv(packageRows(heldIdentityPackages), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-exact-existing-player-matches.csv"),
    toCsv(occurrenceRows(exactExistingReadyOccurrences), occurrenceHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-proposed-player-shells.csv"),
    toCsv(proposedPlayerShells, [
      "proposedPlayerKey", "proposedPlayerId", "displayName",
      "normalizedIdentityKey", "occurrenceCount", "packageCount",
      "occurrenceKeys", "packageKeys", "sourceTradeIds",
      "automaticPlayerCreate", "playerImport",
    ]),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-ambiguous-player-occurrences.csv"),
    toCsv(occurrenceRows(ambiguousOccurrences), occurrenceHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-unsafe-player-occurrences.csv"),
    toCsv(occurrenceRows(unsafeOccurrences), occurrenceHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-held-package-identity-occurrences.csv"),
    toCsv(occurrenceRows(heldPackageIdentityOccurrences), occurrenceHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-relationship-previews.csv"),
    toCsv(relationshipPreviews, [
      "relationshipEdgeKey", "packageKey", "sourceTradeId", "sourceRow",
      "tradeDate", "direction", "relationshipType", "assetText",
      "identityStatus", "targetPlayerKey", "existingPlayerId",
      "proposedPlayerId", "relationshipWrite", "playerImport",
      "canonicalImport",
    ]),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-input-held-records.csv"),
    toCsv(inputHeldRecords.map((record) => ({
      ...record,
      teams: record.teams.join(" | "),
      blockersAfterRouting: record.blockersAfterRouting.join(" | "),
    })), [
      "packageKey", "sourceTradeId", "sourceRow", "tradeDate", "teams",
      "verdict", "contentClass", "databaseStatus", "archiveDatabaseReady",
      "blockersAfterRouting", "eligibilityStatus",
    ]),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-excluded-followups.csv"),
    toCsv(excludedRecords.map((record) => ({
      ...record,
      teams: record.teams.join(" | "),
    })), [
      "packageKey", "sourceTradeId", "sourceRow", "tradeDate", "teams",
      "parentTradeId", "eligibilityStatus",
    ]),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7f-summary.json"),
    JSON.stringify({
      result: "PASS",
      phase: "7F",
      counts,
      packageReadinessSha256,
      identityOccurrencesSha256,
      proposedPlayerShellsSha256,
      relationshipPreviewsSha256,
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
  phase: "7F",
  counts,
  packageReadinessSha256,
  identityOccurrencesSha256,
  proposedPlayerShellsSha256,
  relationshipPreviewsSha256,
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
