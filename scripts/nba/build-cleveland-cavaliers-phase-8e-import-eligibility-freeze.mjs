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
function normalizeIdentityName(value) {
  return clean(value)
    .replace(/^[#\d\s.-]+/u, "")
    .replace(/\s*\([^)]*$/u, "")
    .replace(/[;,.:]+$/u, "")
    .trim();
}
function identityKey(value) {
  return normalizeIdentityName(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
function looksLikePersonName(value) {
  const name = normalizeIdentityName(value);
  if (!name || name.length < 3 || name.length > 80) return false;
  const lower = name.toLowerCase();
  if (
    /\b(cash|consideration|pick|round|swap|exception|protected|conditional|future|draft|option|rights|trade|player to be named|ptbnl|unknown|tbd)\b/u.test(
      lower,
    )
  ) {
    return false;
  }
  const tokens = name.split(/\s+/u).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return false;
  return tokens.every((token) =>
    /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’\-]*$/u.test(token),
  );
}
function classifyAsset(rawAsset) {
  const text = clean(rawAsset);
  const lower = text.toLowerCase();
  if (/\bcash\b/u.test(lower)) return "cash";
  if (/\btrade exception\b|\btpe\b/u.test(lower)) return "trade-exception";
  if (/^rights to\b/u.test(lower)) return "player-rights";
  if (
    /\b(first|second|third|fourth|fifth|sixth|seventh)\s+round\b/u.test(
      lower,
    ) ||
    /\bpick\b|\bswap\b|#\d+/u.test(lower)
  ) {
    return "draft-capital";
  }
  if (
    /\bfuture considerations?\b|\bplayer to be named later\b|\bptbnl\b/u.test(
      lower,
    )
  ) {
    return "future-consideration";
  }
  if (looksLikePersonName(text.replace(/\s*\([^)]*\)\s*$/u, ""))) {
    return "player";
  }
  return "other";
}
function extractIdentitySeeds(rawAsset, dependencyKey) {
  const text = clean(rawAsset);
  const output = [];

  const draftMatches = [
    ...text.matchAll(/#\d+\s*-\s*([A-Z][A-Za-zÀ-ÖØ-öø-ÿ.'’\-]*(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ.'’\-]*){1,5})/gu),
  ];
  for (const match of draftMatches) {
    const name = normalizeIdentityName(match[1]);
    if (looksLikePersonName(name)) {
      output.push({
        identityKind: "draft-outcome-player",
        displayName: name,
      });
    }
  }

  const rightsMatch = text.match(
    /^rights to\s+(.+?)(?:\s*\(|,|;|$)/iu,
  );
  if (rightsMatch) {
    const name = normalizeIdentityName(rightsMatch[1]);
    if (looksLikePersonName(name)) {
      output.push({
        identityKind: "player-rights",
        displayName: name,
      });
    }
  }

  if (classifyAsset(text) === "player") {
    const withoutParenthetical = text.replace(/\s*\([^)]*\)\s*$/u, "");
    const parts = withoutParenthetical
      .split(/\s+(?:and|&)\s+|;/iu)
      .map(normalizeIdentityName)
      .filter(looksLikePersonName);
    for (const name of parts) {
      output.push({
        identityKind: "direct-player",
        displayName: name,
      });
    }
  }

  const seen = new Set();
  return output
    .filter((entry) => {
      const key = `${entry.identityKind}|${identityKey(entry.displayName)}`;
      if (!identityKey(entry.displayName) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry, index) => ({
      identitySeedKey: `${dependencyKey}:identity:${index + 1}`,
      dependencyKey,
      identityKind: entry.identityKind,
      displayName: entry.displayName,
      normalizedIdentityKey: identityKey(entry.displayName),
      safetyStatus: looksLikePersonName(entry.displayName) ? "safe-format" : "unsafe-format",
      automaticPlayerCreate: false,
      automaticIdentityMerge: false,
    }));
}

const args = parseArgs(process.argv);
for (const required of [
  "routing-freeze-json",
  "reviewed-json",
  "expected-freeze-records-sha",
  "expected-route-records-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [freezeBytes, reviewedBytes] = await Promise.all([
  readFile(args["routing-freeze-json"]),
  readFile(args["reviewed-json"]),
]);

const routingFreeze = JSON.parse(freezeBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(
  routingFreeze.result === "PASS" && routingFreeze.phase === "8D",
  "Invalid Phase 8D routing freeze.",
);
assert(
  reviewed.result === "PASS" && reviewed.phase === "8A",
  "Invalid Phase 8A reviewed source.",
);
assert(
  Array.isArray(routingFreeze.freezeRecords) &&
    routingFreeze.freezeRecords.length === 204,
  "Expected 204 Phase 8D freeze records.",
);
assert(
  Array.isArray(routingFreeze.routeRecords) &&
    routingFreeze.routeRecords.length === 17,
  "Expected 17 Phase 8D route records.",
);
assert(
  routingFreeze.hashes.freezeRecordsSha256 ===
    args["expected-freeze-records-sha"],
  "Phase 8D freeze-record hash differs from the checkpoint.",
);
assert(
  routingFreeze.hashes.routeRecordsSha256 ===
    args["expected-route-records-sha"],
  "Phase 8D route-record hash differs from the checkpoint.",
);
assert(
  sha256(JSON.stringify(routingFreeze.freezeRecords)) ===
    args["expected-freeze-records-sha"],
  "Phase 8D freeze-record hash recomputation failed.",
);
assert(
  sha256(JSON.stringify(routingFreeze.routeRecords)) ===
    args["expected-route-records-sha"],
  "Phase 8D route-record hash recomputation failed.",
);

const reviewedById = new Map(
  reviewed.records.map((record) => [record.sourceTradeId, record]),
);
assert(reviewedById.size === 204, "Duplicate reviewed source-trade ID.");

const routeIds = new Set(
  routingFreeze.routeRecords.map((record) => record.sourceTradeId),
);
assert(routeIds.size === 17, "Duplicate Phase 8D route source ID.");

const eligibilityRecords = [];
const dependencySeeds = [];
const playerIdentitySeeds = [];

for (const freezeRecord of routingFreeze.freezeRecords) {
  const reviewedRecord = reviewedById.get(freezeRecord.sourceTradeId);
  assert(
    reviewedRecord,
    `${freezeRecord.sourceTradeId}: reviewed source row is missing.`,
  );

  const excluded =
    reviewedRecord.mergeExclude === true ||
    freezeRecord.priorResolutionClass === "administrative-followup";
  const recentProvisionalHold =
    reviewedRecord.publishStatus === "hold-recent-provisional";
  const eligible =
    freezeRecord.finalPackagingReady === true &&
    excluded === false &&
    recentProvisionalHold === false &&
    reviewedRecord.databaseImportAuthorized === true;
  const held = !eligible && !excluded;

  const eligibilityStatus = eligible
    ? "eligible"
    : excluded
      ? "excluded"
      : "held";

  const holdReasons = [];
  if (excluded) holdReasons.push("linked-administrative-row");
  if (recentProvisionalHold) holdReasons.push("recent-provisional-hold");
  if (freezeRecord.remainingHeld) {
    holdReasons.push(freezeRecord.priorResolutionClass);
  }
  if (
    freezeRecord.routingRequired &&
    freezeRecord.routeFrozen !== true
  ) {
    holdReasons.push("routing-required-not-advanced");
  }

  const packageKey = `cleveland-cavaliers:${freezeRecord.sourceTradeId}`;
  const assets = [
    ...reviewedRecord.assetsReceived.map((rawAsset, index) => ({
      side: "received",
      index,
      rawAsset,
    })),
    ...reviewedRecord.assetsSent.map((rawAsset, index) => ({
      side: "sent",
      index,
      rawAsset,
    })),
  ];

  if (eligible) {
    assert(
      assets.length > 0,
      `${freezeRecord.sourceTradeId}: eligible package has no asset dependencies.`,
    );
    for (const asset of assets) {
      const dependencyKey =
        `${packageKey}:${asset.side}:${asset.index + 1}`;
      const dependency = {
        dependencyKey,
        packageKey,
        sourceTradeId: freezeRecord.sourceTradeId,
        sourceRow: freezeRecord.sourceRow,
        tradeDate: freezeRecord.tradeDate,
        side: asset.side,
        ordinal: asset.index + 1,
        rawAsset: clean(asset.rawAsset),
        normalizedAsset: clean(asset.rawAsset),
        assetClass: classifyAsset(asset.rawAsset),
        routedPackage: freezeRecord.routeFrozen === true,
        privateOnly: true,
        automaticWrite: false,
      };
      dependencySeeds.push(dependency);

      for (const identity of extractIdentitySeeds(
        asset.rawAsset,
        dependencyKey,
      )) {
        playerIdentitySeeds.push({
          ...identity,
          packageKey,
          sourceTradeId: freezeRecord.sourceTradeId,
          sourceRow: freezeRecord.sourceRow,
          tradeDate: freezeRecord.tradeDate,
          side: asset.side,
          rawAsset: clean(asset.rawAsset),
          privateOnly: true,
        });
      }
    }
  }

  eligibilityRecords.push({
    eligibilityKey: packageKey,
    sourceTradeId: freezeRecord.sourceTradeId,
    sourceRow: freezeRecord.sourceRow,
    tradeDate: freezeRecord.tradeDate,
    teams: [...freezeRecord.teams],
    partnerTeams: [...freezeRecord.partnerTeams],
    verdict: freezeRecord.verdict,
    contentClass: freezeRecord.contentClass,
    databaseStatus: freezeRecord.databaseStatus,
    databaseImportAuthorized: reviewedRecord.databaseImportAuthorized,
    privateNoindexArchive: reviewedRecord.privateNoindexArchive,
    archiveImportReady: freezeRecord.archiveImportReady,
    routingRequired: freezeRecord.routingRequired,
    routeFrozen: freezeRecord.routeFrozen,
    newlyAdvancedByRouting: freezeRecord.newlyAdvancedByRouting,
    finalPackagingReady: freezeRecord.finalPackagingReady,
    priorResolutionClass: freezeRecord.priorResolutionClass,
    priorBlockers: [...freezeRecord.priorBlockers],
    recentProvisionalHold,
    mergeExclude: reviewedRecord.mergeExclude,
    eligibilityStatus,
    eligible,
    held,
    excluded,
    holdReasons: [...new Set(holdReasons)].sort(),
    dependencySeedCount: eligible ? assets.length : 0,
    canonicalImport: false,
    playerImport: false,
    teamRegistryWrite: false,
    relationshipWrite: false,
    routeDataWrite: false,
    automaticMerge: false,
    automaticRoute: false,
  });
}

eligibilityRecords.sort(
  (left, right) =>
    Number(left.sourceRow) - Number(right.sourceRow) ||
    left.sourceTradeId.localeCompare(right.sourceTradeId, "en"),
);
dependencySeeds.sort(
  (left, right) =>
    Number(left.sourceRow) - Number(right.sourceRow) ||
    left.dependencyKey.localeCompare(right.dependencyKey, "en"),
);
playerIdentitySeeds.sort(
  (left, right) =>
    Number(left.sourceRow) - Number(right.sourceRow) ||
    left.identitySeedKey.localeCompare(right.identitySeedKey, "en"),
);

const eligibleRecords = eligibilityRecords.filter((record) => record.eligible);
const heldRecords = eligibilityRecords.filter((record) => record.held);
const excludedRecords = eligibilityRecords.filter((record) => record.excluded);
const archiveRecords = eligibilityRecords.filter(
  (record) => record.archiveImportReady,
);
const archiveEligible = archiveRecords.filter((record) => record.eligible);
const archiveHeld = archiveRecords.filter((record) => record.held);
const archiveExcluded = archiveRecords.filter((record) => record.excluded);
const routedEligible = eligibleRecords.filter((record) => record.routeFrozen);
const nonCandidateRouting = eligibilityRecords.filter(
  (record) => record.routingRequired && !record.routeFrozen,
);

const counts = {
  sourceRows: eligibilityRecords.length,
  eligibleRows: eligibleRecords.length,
  heldRows: heldRecords.length,
  excludedRows: excludedRecords.length,
  phase8DPackagingQueueRows: routingFreeze.counts.packagingQueueRows,
  phase8DRemainingHeldRows: routingFreeze.counts.remainingHeldRows,
  routesFrozen: routingFreeze.counts.routesFrozen,
  routedEligibleRows: routedEligible.length,
  nonCandidateRoutingRows: nonCandidateRouting.length,
  recentProvisionalHoldRows: eligibilityRecords.filter(
    (record) => record.recentProvisionalHold,
  ).length,
  archiveImportReadyRows: archiveRecords.length,
  archiveEligibleRows: archiveEligible.length,
  archiveHeldRows: archiveHeld.length,
  archiveExcludedRows: archiveExcluded.length,
  dependencySeeds: dependencySeeds.length,
  playerIdentitySeeds: playerIdentitySeeds.length,
  safeFormatIdentitySeeds: playerIdentitySeeds.filter(
    (record) => record.safetyStatus === "safe-format",
  ).length,
  unsafeFormatIdentitySeeds: playerIdentitySeeds.filter(
    (record) => record.safetyStatus !== "safe-format",
  ).length,
  eligibilityStatusCounts: countBy(
    eligibilityRecords.map((record) => record.eligibilityStatus),
  ),
  holdReasonCounts: countBy(
    eligibilityRecords.flatMap((record) => record.holdReasons),
  ),
  dependencyClassCounts: countBy(
    dependencySeeds.map((record) => record.assetClass),
  ),
  identityKindCounts: countBy(
    playerIdentitySeeds.map((record) => record.identityKind),
  ),
};

assert(counts.sourceRows === 204, "Source-row count drifted.");
assert(counts.eligibleRows === 150, "Eligible package count drifted.");
assert(counts.heldRows === 44, "Held package count drifted.");
assert(counts.excludedRows === 10, "Excluded package count drifted.");
assert(counts.phase8DPackagingQueueRows === 150, "Phase 8D packaging count drifted.");
assert(counts.phase8DRemainingHeldRows === 54, "Phase 8D held count drifted.");
assert(counts.routesFrozen === 17, "Phase 8D route count drifted.");
assert(counts.routedEligibleRows === 17, "Routed eligible count drifted.");
assert(counts.nonCandidateRoutingRows === 7, "Non-candidate routing count drifted.");
assert(counts.recentProvisionalHoldRows === 6, "Recent provisional hold count drifted.");
assert(counts.archiveImportReadyRows === 6, "Archive-ready count drifted.");
assert(
  counts.archiveEligibleRows +
    counts.archiveHeldRows +
    counts.archiveExcludedRows === 6,
  "Archive-ready partition does not close.",
);
assert(
  counts.eligibleRows + counts.heldRows + counts.excludedRows === 204,
  "Eligibility partition does not close.",
);
assert(
  eligibleRecords.every(
    (record) =>
      record.finalPackagingReady === true &&
      record.databaseImportAuthorized === true &&
      record.recentProvisionalHold === false &&
      record.mergeExclude === false,
  ),
  "An ineligible row entered the eligibility queue.",
);
assert(
  excludedRecords.every((record) => record.mergeExclude === true),
  "An excluded row is not a linked administrative row.",
);
assert(
  eligibilityRecords
    .filter((record) => record.recentProvisionalHold)
    .every((record) => !record.eligible),
  "A recent provisional hold became eligible.",
);
assert(
  nonCandidateRouting.every((record) => !record.eligible),
  "A non-candidate routing row became eligible.",
);
assert(
  [...routeIds].every((sourceTradeId) =>
    routedEligible.some((record) => record.sourceTradeId === sourceTradeId),
  ),
  "A frozen route failed to enter the eligible queue.",
);
assert(
  dependencySeeds.every(
    (seed) =>
      eligibleRecords.some(
        (record) => record.eligibilityKey === seed.packageKey,
      ) &&
      seed.automaticWrite === false,
  ),
  "A dependency seed is detached from the eligible queue.",
);
assert(
  playerIdentitySeeds.every(
    (seed) =>
      dependencySeeds.some(
        (dependency) =>
          dependency.dependencyKey === seed.dependencyKey &&
          dependency.packageKey === seed.packageKey,
      ) &&
      seed.automaticPlayerCreate === false &&
      seed.automaticIdentityMerge === false,
  ),
  "A player-identity seed is detached or unsafe.",
);
assert(
  eligibilityRecords.every(
    (record) =>
      record.canonicalImport === false &&
      record.playerImport === false &&
      record.teamRegistryWrite === false &&
      record.relationshipWrite === false &&
      record.routeDataWrite === false &&
      record.automaticMerge === false &&
      record.automaticRoute === false,
  ),
  "An eligibility record enabled a forbidden action.",
);

const hashes = {
  eligibilityRecordsSha256: sha256(JSON.stringify(eligibilityRecords)),
  eligibleRecordsSha256: sha256(JSON.stringify(eligibleRecords)),
  heldRecordsSha256: sha256(JSON.stringify(heldRecords)),
  excludedRecordsSha256: sha256(JSON.stringify(excludedRecords)),
  dependencySeedsSha256: sha256(JSON.stringify(dependencySeeds)),
  playerIdentitySeedsSha256: sha256(JSON.stringify(playerIdentitySeeds)),
  archivePartitionSha256: sha256(
    JSON.stringify({
      all: archiveRecords,
      eligible: archiveEligible,
      held: archiveHeld,
      excluded: archiveExcluded,
    }),
  ),
  freezeRecordsSha256: routingFreeze.hashes.freezeRecordsSha256,
  routeRecordsSha256: routingFreeze.hashes.routeRecordsSha256,
  reviewedRecordsSha256: reviewed.recordsSha256,
};

const freeze = {
  result: "PASS",
  phase: "8E",
  mode: "CLEVELAND_IMPORT_ELIGIBILITY_FREEZE",
  sourceTeam: "cleveland-cavaliers",
  counts,
  hashes,
  eligibilityRecords,
  dependencySeeds,
  playerIdentitySeeds,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const flattenEligibility = (records) =>
  records.map((record) => ({
    ...record,
    teams: record.teams.join(" | "),
    partnerTeams: record.partnerTeams.join(" | "),
    priorBlockers: record.priorBlockers.join(" | "),
    holdReasons: record.holdReasons.join(" | "),
  }));

const eligibilityHeaders = [
  "eligibilityKey","sourceTradeId","sourceRow","tradeDate","teams",
  "partnerTeams","verdict","contentClass","databaseStatus",
  "databaseImportAuthorized","privateNoindexArchive","archiveImportReady",
  "routingRequired","routeFrozen","newlyAdvancedByRouting",
  "finalPackagingReady","priorResolutionClass","priorBlockers",
  "recentProvisionalHold","mergeExclude","eligibilityStatus","eligible",
  "held","excluded","holdReasons","dependencySeedCount",
];
const dependencyHeaders = [
  "dependencyKey","packageKey","sourceTradeId","sourceRow","tradeDate",
  "side","ordinal","rawAsset","normalizedAsset","assetClass",
  "routedPackage","privateOnly","automaticWrite",
];
const identityHeaders = [
  "identitySeedKey","dependencyKey","packageKey","sourceTradeId",
  "sourceRow","tradeDate","side","rawAsset","identityKind","displayName",
  "normalizedIdentityKey","safetyStatus","privateOnly",
  "automaticPlayerCreate","automaticIdentityMerge",
];

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const files = {
  freeze: "cleveland-cavaliers-phase-8e-import-eligibility-freeze.json",
  all: "cleveland-cavaliers-phase-8e-all-eligibility-records.csv",
  eligible: "cleveland-cavaliers-phase-8e-eligible-packages.csv",
  held: "cleveland-cavaliers-phase-8e-held-records.csv",
  excluded: "cleveland-cavaliers-phase-8e-excluded-records.csv",
  dependencies: "cleveland-cavaliers-phase-8e-dependency-seeds.csv",
  identities: "cleveland-cavaliers-phase-8e-player-identity-seeds.csv",
  archive: "cleveland-cavaliers-phase-8e-archive-partition.csv",
  summary: "cleveland-cavaliers-phase-8e-summary.json",
};

await Promise.all([
  writeFile(
    path.join(outputDir, files.freeze),
    JSON.stringify(freeze, null, 2) + "\n",
  ),
  writeFile(
    path.join(outputDir, files.all),
    toCsv(flattenEligibility(eligibilityRecords), eligibilityHeaders),
  ),
  writeFile(
    path.join(outputDir, files.eligible),
    toCsv(flattenEligibility(eligibleRecords), eligibilityHeaders),
  ),
  writeFile(
    path.join(outputDir, files.held),
    toCsv(flattenEligibility(heldRecords), eligibilityHeaders),
  ),
  writeFile(
    path.join(outputDir, files.excluded),
    toCsv(flattenEligibility(excludedRecords), eligibilityHeaders),
  ),
  writeFile(
    path.join(outputDir, files.dependencies),
    toCsv(dependencySeeds, dependencyHeaders),
  ),
  writeFile(
    path.join(outputDir, files.identities),
    toCsv(playerIdentitySeeds, identityHeaders),
  ),
  writeFile(
    path.join(outputDir, files.archive),
    toCsv(flattenEligibility(archiveRecords), eligibilityHeaders),
  ),
  writeFile(
    path.join(outputDir, files.summary),
    JSON.stringify({
      result: "PASS",
      phase: "8E",
      counts,
      hashes,
      canonicalImports: 0,
      playerImports: 0,
      teamRegistryWrites: 0,
      relationshipWrites: 0,
      routeDataWrites: 0,
      automaticMerges: 0,
      automaticRoutes: 0,
      publicationAuthorized: false,
    }, null, 2) + "\n",
  ),
]);

console.log(JSON.stringify({
  result: freeze.result,
  phase: freeze.phase,
  mode: freeze.mode,
  counts: freeze.counts,
  hashes: freeze.hashes,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
