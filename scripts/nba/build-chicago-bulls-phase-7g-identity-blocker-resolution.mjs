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
function nameShapeSafe(value) {
  const text = clean(value);
  const normalized = normalizeIdentity(text);
  const tokens = normalized.split(" ").filter(Boolean);
  const forbidden = new Set([
    "cash",
    "consideration",
    "considerations",
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
    "salary",
    "cap",
    "player",
    "person",
    "coach",
    "executive",
    "manager",
    "president",
    "owner",
    "staff",
    "trainer",
    "tbd",
    "ptbnl",
  ]);
  return (
    Boolean(text) &&
    Boolean(normalized) &&
    /\p{L}/u.test(text) &&
    !/[\d?]/u.test(text) &&
    tokens.length >= 1 &&
    tokens.length <= 8 &&
    !tokens.some((token) => forbidden.has(token)) &&
    /^[\p{L}.'’ -]+$/u.test(text)
  );
}
function repairUnsafeIdentity(assetText) {
  const original = clean(assetText);
  let value = original
    .replace(/[–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();

  const quoted =
    value.match(/["“]([^"”]+)["”]/u)?.[1] ??
    value.match(/'([^']+)'/u)?.[1] ??
    null;
  if (quoted && nameShapeSafe(quoted)) {
    return {
      rule: "quoted-name-extraction",
      candidateNames: [clean(quoted)],
      repaired: true,
    };
  }

  value = value
    .replace(/\[[^\]]*\]/gu, " ")
    .replace(/\([^)]*\)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  value = value.replace(
    /^(?:the\s+)?(?:draft\s+rights\s+to|rights\s+to|player\s+rights\s+to)\s+/iu,
    "",
  );
  value = value.replace(
    /^(?:acquired|received|sent|traded|signed-and-traded|sign-and-traded)\s+/iu,
    "",
  );
  value = value.replace(
    /^(?:\d{4}\s+)?(?:nba\s+)?(?:draft\s+)?#?\d+\s*[-:]\s*/iu,
    "",
  );
  value = value.replace(/^#\d+\s*[-:]\s*/u, "");
  value = value.replace(
    /^(?:rights|draft rights|player rights)\s*[-:]\s*/iu,
    "",
  );
  value = value.replace(
    /\s+(?:from|to)\s+(?:the\s+)?[A-Z].*$/u,
    "",
  );
  value = value.replace(
    /\s*[-:]\s*(?:rights|draft rights|player rights|contract|waiver claim)\s*$/iu,
    "",
  );
  value = value
    .replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+/u, "")
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ.'’ -]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();

  const genericUnknown =
    /\b(?:unknown|tbd|ptbnl|player to be named later|to be determined)\b/iu.test(
      original,
    ) ||
    /\?/u.test(original);

  if (genericUnknown) {
    return {
      rule: "unresolved-unknown-marker",
      candidateNames: [],
      repaired: false,
    };
  }

  const splitCandidates = value
    .split(/\s+(?:and|&)\s+|[;/]/u)
    .map(clean)
    .filter(Boolean);

  if (
    splitCandidates.length > 1 &&
    splitCandidates.every(nameShapeSafe)
  ) {
    return {
      rule: "safe-composite-name-split",
      candidateNames: splitCandidates,
      repaired: true,
    };
  }

  if (nameShapeSafe(value)) {
    return {
      rule: "annotation-and-prefix-cleanup",
      candidateNames: [value],
      repaired: true,
    };
  }

  return {
    rule: "unresolved-name-shape",
    candidateNames: [],
    repaired: false,
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
  "phase7f-freeze-json",
  "players-json",
  "contract-md",
  "expected-package-readiness-sha",
  "expected-identity-occurrences-sha",
  "expected-proposed-shells-sha",
  "expected-relationship-previews-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [freezeBytes, playersBytes, contractBytes] = await Promise.all([
  readFile(args["phase7f-freeze-json"]),
  readFile(args["players-json"]),
  readFile(args["contract-md"]),
]);

const phase7F = JSON.parse(freezeBytes.toString("utf8"));
const playerStore = JSON.parse(playersBytes.toString("utf8"));
const existingPlayers = recordsFrom(playerStore);

assert(phase7F.result === "PASS" && phase7F.phase === "7F", "Invalid Phase 7F freeze.");
assert(Array.isArray(phase7F.packageReadiness) && phase7F.packageReadiness.length === 187, "Expected 187 package-readiness records.");
assert(Array.isArray(phase7F.identityOccurrences) && phase7F.identityOccurrences.length === 371, "Expected 371 identity occurrences.");
assert(Array.isArray(phase7F.proposedPlayerShells) && phase7F.proposedPlayerShells.length === 218, "Expected 218 proposed shells.");
assert(Array.isArray(phase7F.relationshipPreviews) && phase7F.relationshipPreviews.length === 349, "Expected 349 relationship previews.");
assert(existingPlayers.length === 1292, "Expected the unchanged 1,292-player store.");

for (const [field, expected] of [
  ["packageReadinessSha256", args["expected-package-readiness-sha"]],
  ["identityOccurrencesSha256", args["expected-identity-occurrences-sha"]],
  ["proposedPlayerShellsSha256", args["expected-proposed-shells-sha"]],
  ["relationshipPreviewsSha256", args["expected-relationship-previews-sha"]],
]) {
  assert(phase7F[field] === expected, `${field} differs from the frozen checkpoint.`);
}
assert(
  sha256(JSON.stringify(phase7F.packageReadiness)) ===
    args["expected-package-readiness-sha"],
  "Package-readiness records fail hash recomputation.",
);
assert(
  sha256(JSON.stringify(phase7F.identityOccurrences)) ===
    args["expected-identity-occurrences-sha"],
  "Identity occurrences fail hash recomputation.",
);
assert(
  sha256(JSON.stringify(phase7F.proposedPlayerShells)) ===
    args["expected-proposed-shells-sha"],
  "Proposed shells fail hash recomputation.",
);
assert(
  sha256(JSON.stringify(phase7F.relationshipPreviews)) ===
    args["expected-relationship-previews-sha"],
  "Relationship previews fail hash recomputation.",
);

const existingById = new Map();
const identityIndex = new Map();
const existingIdSet = new Set();

for (const [index, player] of existingPlayers.entries()) {
  const id = playerId(player, index);
  assert(!existingIdSet.has(id), `Duplicate existing player ID: ${id}`);
  existingIdSet.add(id);
  const displayName = clean(
    player.displayName ??
      player.fullName ??
      player.name ??
      player.playerName ??
      player.slug ??
      id,
  );
  existingById.set(id, { playerId: id, displayName });

  for (const value of playerIdentityValues(player)) {
    const key = normalizeIdentity(value);
    if (!key) continue;
    if (!identityIndex.has(key)) identityIndex.set(key, new Set());
    identityIndex.get(key).add(id);
  }
}

const unsafeOccurrences = phase7F.identityOccurrences.filter(
  (record) => record.identityStatus === "unsafe-identity-held",
);
const ambiguousOccurrences = phase7F.identityOccurrences.filter(
  (record) => record.identityStatus === "ambiguous-existing-identity",
);

assert(unsafeOccurrences.length === 16, "Expected 16 unsafe identity occurrences.");
assert(ambiguousOccurrences.length === 0, "Phase 7F ambiguity count drifted.");

const resolutionRecords = unsafeOccurrences.map((occurrence) => {
  const repair = repairUnsafeIdentity(occurrence.assetText);
  const entityResolutions = repair.candidateNames.map((candidateName, index) => {
    const normalizedIdentityKey = normalizeIdentity(candidateName);
    const matchIds = [
      ...(identityIndex.get(normalizedIdentityKey) ?? new Set()),
    ].sort();

    let resolutionStatus = "proposed-player-shell";
    if (matchIds.length === 1) resolutionStatus = "existing-player-exact";
    if (matchIds.length > 1) resolutionStatus = "ambiguous-existing-identity";

    const proposedPlayerKey =
      resolutionStatus === "proposed-player-shell"
        ? `proposed-player:${slug(candidateName)}`
        : null;
    const proposedPlayerId =
      proposedPlayerKey
        ? `nba-player-${slug(candidateName)}`
        : null;
    const idCollision =
      proposedPlayerId != null &&
      existingIdSet.has(proposedPlayerId);

    if (idCollision) {
      resolutionStatus = "proposed-player-id-collision";
    }

    return {
      entityIndex: index + 1,
      candidateName,
      normalizedIdentityKey,
      resolutionStatus,
      existingPlayerIds: matchIds,
      proposedPlayerKey,
      proposedPlayerId,
      proposedPlayerIdCollision: idCollision,
    };
  });

  const resolved =
    repair.repaired === true &&
    entityResolutions.length > 0 &&
    entityResolutions.every(
      (entity) =>
        entity.resolutionStatus === "existing-player-exact" ||
        entity.resolutionStatus === "proposed-player-shell",
    );

  return {
    dependencySeedKey: occurrence.dependencySeedKey,
    packageKey: occurrence.packageKey,
    sourceTradeId: occurrence.sourceTradeId,
    sourceRow: occurrence.sourceRow,
    tradeDate: occurrence.tradeDate,
    direction: occurrence.direction,
    assetText: occurrence.assetText,
    repairRule: repair.rule,
    candidateNames: repair.candidateNames,
    entityResolutions,
    resolved,
    finalStatus: resolved
      ? "unsafe-occurrence-resolved"
      : "unsafe-occurrence-remains-held",
    privateOnly: true,
    automaticPlayerCreate: false,
    automaticIdentityMerge: false,
    playerImport: false,
    relationshipWrite: false,
  };
});

const resolutionByOccurrence = new Map(
  resolutionRecords.map((record) => [record.dependencySeedKey, record]),
);
assert(resolutionByOccurrence.size === 16, "Unsafe resolution records are not unique.");

const occurrencesByPackage = new Map();
for (const occurrence of phase7F.identityOccurrences) {
  if (!occurrencesByPackage.has(occurrence.packageKey)) {
    occurrencesByPackage.set(occurrence.packageKey, []);
  }
  occurrencesByPackage.get(occurrence.packageKey).push(occurrence);
}

const finalPackageRecords = phase7F.packageReadiness.map((record) => {
  const occurrences = occurrencesByPackage.get(record.packageKey) ?? [];
  const unresolvedAmbiguous = occurrences.filter(
    (occurrence) =>
      occurrence.identityStatus === "ambiguous-existing-identity",
  );
  const unsafe = occurrences.filter(
    (occurrence) => occurrence.identityStatus === "unsafe-identity-held",
  );
  const unresolvedUnsafe = unsafe.filter(
    (occurrence) =>
      resolutionByOccurrence.get(occurrence.dependencySeedKey)?.resolved !== true,
  );
  const newlyResolvedUnsafe = unsafe.length - unresolvedUnsafe.length;

  const finalReady =
    unresolvedAmbiguous.length === 0 &&
    unresolvedUnsafe.length === 0;
  const newlyAdvanced =
    record.packageHeld === true &&
    finalReady === true;

  return {
    ...record,
    phase7fPackageReady: record.packageReady,
    phase7fPackageHeld: record.packageHeld,
    unsafeOccurrenceCountBefore: unsafe.length,
    newlyResolvedUnsafeOccurrenceCount: newlyResolvedUnsafe,
    remainingUnsafeOccurrenceCount: unresolvedUnsafe.length,
    remainingAmbiguousOccurrenceCount: unresolvedAmbiguous.length,
    finalReady,
    finalHeld: !finalReady,
    newlyAdvanced,
    finalStatus: finalReady
      ? newlyAdvanced
        ? "advanced-after-identity-repair"
        : "ready-before-identity-repair"
      : "held-after-identity-repair",
    finalHoldReasons: [
      ...(unresolvedUnsafe.length > 0
        ? ["unresolved-unsafe-identity"]
        : []),
      ...(unresolvedAmbiguous.length > 0
        ? ["ambiguous-existing-identity"]
        : []),
    ],
    automaticPlayerCreate: false,
    automaticIdentityMerge: false,
    canonicalImport: false,
    playerImport: false,
    relationshipWrite: false,
  };
});

const finalReadyPackages = finalPackageRecords.filter(
  (record) => record.finalReady,
);
const remainingHeldPackages = finalPackageRecords.filter(
  (record) => record.finalHeld,
);
const newlyAdvancedPackages = finalPackageRecords.filter(
  (record) => record.newlyAdvanced,
);
const finalReadyPackageKeys = new Set(
  finalReadyPackages.map((record) => record.packageKey),
);

const shellAccumulator = new Map();
function addShell({
  proposedPlayerKey,
  proposedPlayerId,
  displayName,
  normalizedIdentityKey,
  dependencySeedKey,
  packageKey,
  sourceTradeId,
}) {
  if (!shellAccumulator.has(proposedPlayerKey)) {
    shellAccumulator.set(proposedPlayerKey, {
      proposedPlayerKey,
      proposedPlayerId,
      displayName,
      normalizedIdentityKey,
      occurrenceKeys: new Set(),
      packageKeys: new Set(),
      sourceTradeIds: new Set(),
      privateOnly: true,
      indexEligible: false,
      adEligible: false,
      automaticPlayerCreate: false,
      playerImport: false,
    });
  }
  const shell = shellAccumulator.get(proposedPlayerKey);
  assert(
    shell.proposedPlayerId === proposedPlayerId,
    `${proposedPlayerKey}: proposed player ID drifted.`,
  );
  assert(
    shell.normalizedIdentityKey === normalizedIdentityKey,
    `${proposedPlayerKey}: normalized identity drifted.`,
  );
  shell.occurrenceKeys.add(dependencySeedKey);
  shell.packageKeys.add(packageKey);
  shell.sourceTradeIds.add(sourceTradeId);
}

const relationshipPreviews = [];

for (const occurrence of phase7F.identityOccurrences) {
  if (!finalReadyPackageKeys.has(occurrence.packageKey)) continue;

  let entities = [];
  if (occurrence.identityStatus === "existing-player-exact") {
    assert(
      occurrence.existingPlayerIds.length === 1,
      `${occurrence.dependencySeedKey}: exact match count drifted.`,
    );
    entities = [{
      resolutionStatus: "existing-player-exact",
      candidateName: occurrence.extractedName,
      normalizedIdentityKey: occurrence.normalizedIdentityKey,
      existingPlayerIds: occurrence.existingPlayerIds,
      proposedPlayerKey: null,
      proposedPlayerId: null,
    }];
  } else if (occurrence.identityStatus === "proposed-player-shell") {
    const proposedPlayerId = `nba-player-${slug(occurrence.extractedName)}`;
    entities = [{
      resolutionStatus: "proposed-player-shell",
      candidateName: occurrence.extractedName,
      normalizedIdentityKey: occurrence.normalizedIdentityKey,
      existingPlayerIds: [],
      proposedPlayerKey: occurrence.proposedPlayerKey,
      proposedPlayerId,
    }];
  } else if (occurrence.identityStatus === "unsafe-identity-held") {
    const resolution = resolutionByOccurrence.get(
      occurrence.dependencySeedKey,
    );
    assert(
      resolution?.resolved === true,
      `${occurrence.dependencySeedKey}: ready package retains unsafe identity.`,
    );
    entities = resolution.entityResolutions;
  } else {
    throw new Error(
      `${occurrence.dependencySeedKey}: ready package has unresolved status ${occurrence.identityStatus}.`,
    );
  }

  for (const [entityIndex, entity] of entities.entries()) {
    const existingPlayerId =
      entity.resolutionStatus === "existing-player-exact"
        ? entity.existingPlayerIds[0]
        : null;
    const targetPlayerKey =
      existingPlayerId ?? entity.proposedPlayerId;

    assert(
      targetPlayerKey,
      `${occurrence.dependencySeedKey}: target player is unavailable.`,
    );

    if (entity.resolutionStatus === "proposed-player-shell") {
      addShell({
        proposedPlayerKey: entity.proposedPlayerKey,
        proposedPlayerId: entity.proposedPlayerId,
        displayName: entity.candidateName,
        normalizedIdentityKey: entity.normalizedIdentityKey,
        dependencySeedKey: occurrence.dependencySeedKey,
        packageKey: occurrence.packageKey,
        sourceTradeId: occurrence.sourceTradeId,
      });
    }

    relationshipPreviews.push({
      relationshipEdgeKey:
        `${occurrence.dependencySeedKey}:entity:${String(entityIndex + 1).padStart(2, "0")}:player:${targetPlayerKey}`,
      packageKey: occurrence.packageKey,
      sourceTradeId: occurrence.sourceTradeId,
      sourceRow: occurrence.sourceRow,
      tradeDate: occurrence.tradeDate,
      dependencySeedKey: occurrence.dependencySeedKey,
      entityIndex: entityIndex + 1,
      direction: occurrence.direction,
      relationshipType:
        occurrence.direction === "incoming"
          ? "chicago-acquired-player"
          : "chicago-sent-player",
      assetText: occurrence.assetText,
      resolutionStatus: entity.resolutionStatus,
      targetPlayerKey,
      existingPlayerId,
      proposedPlayerId: entity.proposedPlayerId,
      privateOnly: true,
      indexEligible: false,
      adEligible: false,
      relationshipWrite: false,
      playerImport: false,
      canonicalImport: false,
    });
  }
}

relationshipPreviews.sort((left, right) =>
  left.relationshipEdgeKey.localeCompare(right.relationshipEdgeKey, "en"),
);
assert(
  new Set(relationshipPreviews.map((record) => record.relationshipEdgeKey))
    .size === relationshipPreviews.length,
  "Final relationship preview keys are not unique.",
);

const proposedPlayerShells = [...shellAccumulator.values()]
  .map((record) => ({
    ...record,
    occurrenceKeys: [...record.occurrenceKeys].sort(),
    packageKeys: [...record.packageKeys].sort(),
    sourceTradeIds: [...record.sourceTradeIds].sort(),
    occurrenceCount: record.occurrenceKeys.size,
    packageCount: record.packageKeys.size,
  }))
  .sort((left, right) =>
    left.proposedPlayerKey.localeCompare(right.proposedPlayerKey, "en"),
  );

assert(
  new Set(proposedPlayerShells.map((record) => record.proposedPlayerKey))
    .size === proposedPlayerShells.length,
  "Final proposed player keys are not unique.",
);
assert(
  new Set(proposedPlayerShells.map((record) => record.proposedPlayerId))
    .size === proposedPlayerShells.length,
  "Final proposed player IDs are not unique.",
);

const resolvedUnsafeOccurrences = resolutionRecords.filter(
  (record) => record.resolved,
);
const remainingUnsafeOccurrences = resolutionRecords.filter(
  (record) => !record.resolved,
);

const counts = {
  sourceRows: phase7F.counts.sourceRows,
  eligibleInputPackages: phase7F.counts.eligibleInputPackages,
  phase7fReadyPackages: phase7F.counts.readyPackages,
  phase7fHeldIdentityPackages: phase7F.counts.heldIdentityPackages,
  phase7fProposedPlayerShells: phase7F.counts.proposedPlayerShells,
  phase7fRelationshipPreviewEdges:
    phase7F.counts.relationshipPreviewEdges,
  phase7fAmbiguousIdentityOccurrences:
    phase7F.counts.ambiguousIdentityOccurrences,
  phase7fUnsafeIdentityOccurrences:
    phase7F.counts.unsafeIdentityOccurrences,
  resolvedUnsafeOccurrences: resolvedUnsafeOccurrences.length,
  remainingUnsafeOccurrences: remainingUnsafeOccurrences.length,
  newlyAdvancedPackages: newlyAdvancedPackages.length,
  finalReadyPackages: finalReadyPackages.length,
  remainingHeldPackages: remainingHeldPackages.length,
  finalProposedPlayerShells: proposedPlayerShells.length,
  finalRelationshipPreviewEdges: relationshipPreviews.length,
  existingHeldRecords: phase7F.counts.inputHeldRecords,
  excludedRecords: phase7F.counts.excludedRecords,
  archiveReadyInputRows: phase7F.counts.archiveReadyInputRows,
  resolutionRuleCounts: countBy(
    resolutionRecords.map((record) => record.repairRule),
  ),
  resolutionStatusCounts: countBy(
    resolutionRecords.map((record) => record.finalStatus),
  ),
  finalPackageStatusCounts: countBy(
    finalPackageRecords.map((record) => record.finalStatus),
  ),
  relationshipTypeCounts: countBy(
    relationshipPreviews.map((record) => record.relationshipType),
  ),
};

assert(counts.sourceRows === 219, "Source-row count drifted.");
assert(counts.eligibleInputPackages === 187, "Eligible input package count drifted.");
assert(counts.phase7fReadyPackages === 173, "Phase 7F ready-package count drifted.");
assert(counts.phase7fHeldIdentityPackages === 14, "Phase 7F held-package count drifted.");
assert(counts.phase7fProposedPlayerShells === 218, "Phase 7F shell count drifted.");
assert(counts.phase7fRelationshipPreviewEdges === 349, "Phase 7F relationship count drifted.");
assert(counts.phase7fAmbiguousIdentityOccurrences === 0, "Phase 7F ambiguity count drifted.");
assert(counts.phase7fUnsafeIdentityOccurrences === 16, "Phase 7F unsafe count drifted.");
assert(
  counts.resolvedUnsafeOccurrences +
    counts.remainingUnsafeOccurrences === 16,
  "Unsafe occurrence partition does not close.",
);
assert(
  counts.finalReadyPackages +
    counts.remainingHeldPackages === 187,
  "Final eligible-package partition does not close.",
);
assert(
  counts.finalReadyPackages ===
    counts.phase7fReadyPackages + counts.newlyAdvancedPackages,
  "Final ready-package accounting drifted.",
);
assert(
  counts.finalReadyPackages >= counts.phase7fReadyPackages,
  "Identity resolution reduced the ready-package set.",
);
assert(
  counts.remainingHeldPackages <= counts.phase7fHeldIdentityPackages,
  "Identity resolution increased the held-package set.",
);
assert(counts.existingHeldRecords === 25, "Existing Phase 7E held-record count drifted.");
assert(counts.excludedRecords === 7, "Excluded-record count drifted.");
assert(counts.archiveReadyInputRows === 15, "Archive-ready input count drifted.");

assert(
  finalPackageRecords.every(
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
  proposedPlayerShells.every(
    (record) =>
      record.automaticPlayerCreate === false &&
      record.playerImport === false,
  ),
  "A proposed shell enabled a player-store write.",
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

const finalPackageRecordsSha256 = sha256(
  JSON.stringify(finalPackageRecords),
);
const resolutionRecordsSha256 = sha256(JSON.stringify(resolutionRecords));
const proposedPlayerShellsSha256 = sha256(
  JSON.stringify(proposedPlayerShells),
);
const relationshipPreviewsSha256 = sha256(
  JSON.stringify(relationshipPreviews),
);
const importPartitionSha256 = sha256(
  JSON.stringify({
    finalReadyPackageKeys: finalReadyPackages
      .map((record) => record.packageKey)
      .sort(),
    remainingHeldPackageKeys: remainingHeldPackages
      .map((record) => record.packageKey)
      .sort(),
    existingHeldRecordCount: phase7F.counts.inputHeldRecords,
    excludedRecordCount: phase7F.counts.excludedRecords,
  }),
);

const manifest = {
  result: "PASS",
  phase: "7G",
  mode: "IDENTITY_BLOCKER_RESOLUTION_AND_FINAL_PARTITION",
  sourceTeam: "chicago-bulls",
  counts,
  finalPackageRecordsSha256,
  resolutionRecordsSha256,
  proposedPlayerShellsSha256,
  relationshipPreviewsSha256,
  importPartitionSha256,
  sourceHashes: {
    phase7FFreezeJsonSha256: sha256(freezeBytes),
    playerStoreSha256: sha256(playersBytes),
    contractSha256: sha256(contractBytes),
    phase7FPackageReadinessSha256:
      phase7F.packageReadinessSha256,
    phase7FIdentityOccurrencesSha256:
      phase7F.identityOccurrencesSha256,
    phase7FProposedPlayerShellsSha256:
      phase7F.proposedPlayerShellsSha256,
    phase7FRelationshipPreviewsSha256:
      phase7F.relationshipPreviewsSha256,
  },
  finalPackageRecords,
  resolutionRecords,
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
  "verdict", "contentClass", "databaseStatus", "archiveDatabaseReady",
  "phase7fPackageReady", "phase7fPackageHeld",
  "unsafeOccurrenceCountBefore", "newlyResolvedUnsafeOccurrenceCount",
  "remainingUnsafeOccurrenceCount", "remainingAmbiguousOccurrenceCount",
  "finalReady", "finalHeld", "newlyAdvanced", "finalStatus",
  "finalHoldReasons", "automaticPlayerCreate",
  "automaticIdentityMerge",
];
function packageRows(records) {
  return records.map((record) => ({
    ...record,
    teams: record.teams.join(" | "),
    finalHoldReasons: record.finalHoldReasons.join(" | "),
  }));
}
const resolutionHeaders = [
  "dependencySeedKey", "packageKey", "sourceTradeId", "sourceRow",
  "tradeDate", "direction", "assetText", "repairRule",
  "candidateNames", "entityResolutionCount", "entityResolutions",
  "resolved", "finalStatus", "automaticPlayerCreate",
  "automaticIdentityMerge",
];
function resolutionRows(records) {
  return records.map((record) => ({
    ...record,
    candidateNames: record.candidateNames.join(" | "),
    entityResolutionCount: record.entityResolutions.length,
    entityResolutions: record.entityResolutions
      .map((entity) =>
        [
          entity.candidateName,
          entity.resolutionStatus,
          entity.existingPlayerIds.join("+"),
          entity.proposedPlayerId ?? "",
        ].join(" :: "),
      )
      .join(" || "),
  }));
}

await Promise.all([
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-identity-resolution.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-all-package-records.csv"),
    toCsv(packageRows(finalPackageRecords), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-final-ready-packages.csv"),
    toCsv(packageRows(finalReadyPackages), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-newly-advanced-packages.csv"),
    toCsv(packageRows(newlyAdvancedPackages), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-remaining-held-packages.csv"),
    toCsv(packageRows(remainingHeldPackages), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-resolution-records.csv"),
    toCsv(resolutionRows(resolutionRecords), resolutionHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-resolved-unsafe-occurrences.csv"),
    toCsv(resolutionRows(resolvedUnsafeOccurrences), resolutionHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-remaining-unsafe-occurrences.csv"),
    toCsv(resolutionRows(remainingUnsafeOccurrences), resolutionHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-final-proposed-player-shells.csv"),
    toCsv(proposedPlayerShells, [
      "proposedPlayerKey", "proposedPlayerId", "displayName",
      "normalizedIdentityKey", "occurrenceCount", "packageCount",
      "occurrenceKeys", "packageKeys", "sourceTradeIds",
      "automaticPlayerCreate", "playerImport",
    ]),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-final-relationship-previews.csv"),
    toCsv(relationshipPreviews, [
      "relationshipEdgeKey", "packageKey", "sourceTradeId",
      "sourceRow", "tradeDate", "dependencySeedKey", "entityIndex",
      "direction", "relationshipType", "assetText", "resolutionStatus",
      "targetPlayerKey", "existingPlayerId", "proposedPlayerId",
      "relationshipWrite", "playerImport", "canonicalImport",
    ]),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7g-summary.json"),
    JSON.stringify({
      result: "PASS",
      phase: "7G",
      counts,
      finalPackageRecordsSha256,
      resolutionRecordsSha256,
      proposedPlayerShellsSha256,
      relationshipPreviewsSha256,
      importPartitionSha256,
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
  phase: "7G",
  counts,
  finalPackageRecordsSha256,
  resolutionRecordsSha256,
  proposedPlayerShellsSha256,
  relationshipPreviewsSha256,
  importPartitionSha256,
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
