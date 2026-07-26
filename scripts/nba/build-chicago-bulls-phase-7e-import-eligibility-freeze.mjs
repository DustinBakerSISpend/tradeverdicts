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
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/['’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
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
function classifyAsset(assetText) {
  const value = clean(assetText).toLowerCase();
  if (value.includes("cash")) return "cash-asset";
  if (
    value.includes("trade exception") ||
    value.includes("traded player exception") ||
    value.includes("tpe")
  ) {
    return "trade-exception";
  }
  if (
    value.includes("draft pick") ||
    value.includes("first round") ||
    value.includes("second round") ||
    value.includes("third round") ||
    value.includes("fourth round") ||
    value.includes("pick swap") ||
    value.includes("round pick")
  ) {
    return "draft-asset";
  }
  if (
    value.includes("future considerations") ||
    value.includes("conditional consideration")
  ) {
    return "administrative-consideration";
  }
  if (value.startsWith("rights to ") || value.includes("draft rights")) {
    return "player-rights";
  }
  return "player-or-person";
}
function identityResolutionRequired(assetClass) {
  return assetClass === "player-rights" || assetClass === "player-or-person";
}

const args = parseArgs(process.argv);
for (const required of [
  "routing-freeze-json",
  "reviewed-json",
  "contract-md",
  "expected-freeze-records-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}.`);
}

const [routingBytes, reviewedBytes, contractBytes] = await Promise.all([
  readFile(args["routing-freeze-json"]),
  readFile(args["reviewed-json"]),
  readFile(args["contract-md"]),
]);

const routing = JSON.parse(routingBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));

assert(routing.result === "PASS" && routing.phase === "7D", "Invalid Phase 7D routing freeze.");
assert(reviewed.result === "PASS" && reviewed.phase === "7A", "Invalid Phase 7A reviewed batch.");
assert(Array.isArray(routing.freezeRecords) && routing.freezeRecords.length === 219, "Expected 219 routing-freeze rows.");
assert(Array.isArray(reviewed.records) && reviewed.records.length === 219, "Expected 219 reviewed rows.");
assert(
  routing.freezeRecordsSha256 === args["expected-freeze-records-sha"],
  "Phase 7D freeze-record hash differs from the frozen checkpoint.",
);
assert(
  sha256(JSON.stringify(routing.freezeRecords)) === args["expected-freeze-records-sha"],
  "Phase 7D freeze records fail hash recomputation.",
);

const reviewedById = new Map(
  reviewed.records.map((record) => [record.sourceTradeId, record]),
);
assert(reviewedById.size === 219, "Reviewed IDs are not unique.");

const eligibilityRecords = [];
const dependencySeedRecords = [];

for (const freezeRecord of routing.freezeRecords) {
  const sourceTradeId = clean(freezeRecord.sourceTradeId);
  const source = reviewedById.get(sourceTradeId);
  assert(source, `${sourceTradeId}: reviewed source row is missing.`);

  const importEligible =
    freezeRecord.packagingReady === true &&
    freezeRecord.mergeExclude === false &&
    freezeRecord.blockersAfterRouting.length === 0 &&
    source.databaseImportAuthorized === true &&
    source.reviewStatus !== "Needs Research" &&
    source.researchBeforePublic === false &&
    !clean(source.publishStatus).startsWith("hold-");

  const excluded = freezeRecord.mergeExclude === true;
  const held = !importEligible && !excluded;

  let eligibilityStatus = "held-reconciliation-or-identity";
  if (importEligible) eligibilityStatus = "eligible-private-canonical-package";
  if (excluded) eligibilityStatus = "excluded-linked-followup";

  const packageKey = `chicago-bulls:${sourceTradeId.toLowerCase()}`;
  const dependencySeedKeys = [];

  if (importEligible) {
    for (const [direction, assets] of [
      ["incoming", source.assetsReceived],
      ["outgoing", source.assetsSent],
    ]) {
      assert(Array.isArray(assets), `${sourceTradeId}: ${direction} assets are unavailable.`);
      for (const [index, assetText] of assets.entries()) {
        const assetClass = classifyAsset(assetText);
        const normalizedAssetKey = slug(assetText) || `asset-${index + 1}`;
        const dependencySeedKey =
          `${packageKey}:${direction}:${String(index + 1).padStart(2, "0")}:${normalizedAssetKey}`;
        dependencySeedKeys.push(dependencySeedKey);
        dependencySeedRecords.push({
          dependencySeedKey,
          packageKey,
          sourceTradeId,
          sourceRow: source.sourceRow,
          tradeDate: source.tradeDate,
          direction,
          assetIndex: index + 1,
          assetText,
          normalizedAssetKey,
          assetClass,
          identityResolutionRequired: identityResolutionRequired(assetClass),
          routingRequired: source.routingRequired,
          contentClass: source.contentClass,
          verdict: source.verdict,
          privateOnly: true,
          indexEligible: false,
          adEligible: false,
          automaticPlayerCreate: false,
          automaticIdentityMerge: false,
          canonicalImport: false,
          playerImport: false,
          relationshipWrite: false,
        });
      }
    }
  }

  const archiveDatabaseReady =
    source.verdict === "Insufficient Evidence" &&
    source.privateNoindexArchive === true &&
    source.databaseStatus === "Ready — archival import" &&
    source.reviewStatus !== "Needs Research" &&
    source.researchBeforePublic === false &&
    !clean(source.publishStatus).startsWith("hold-");

  eligibilityRecords.push({
    packageKey,
    sourceTradeId,
    sourceRow: source.sourceRow,
    tradeDate: source.tradeDate,
    teams: freezeRecord.teams,
    declaredTeamCount: freezeRecord.declaredTeamCount,
    verdict: source.verdict,
    outcomeScore: source.outcomeScore,
    confidence: source.confidence,
    tier: source.tier,
    contentClass: source.contentClass,
    publishStatus: source.publishStatus,
    databaseStatus: source.databaseStatus,
    databaseImportAuthorized: source.databaseImportAuthorized,
    privateArchive: source.privateNoindexArchive,
    insufficientEvidence: source.verdict === "Insufficient Evidence",
    archiveDatabaseReady,
    routingRequired: freezeRecord.routingRequired,
    routingComplete: freezeRecord.routingRequired
      ? freezeRecord.routingComplete
      : true,
    phase7dFinalStatus: freezeRecord.finalStatus,
    blockersAfterRouting: freezeRecord.blockersAfterRouting,
    mergeExclude: freezeRecord.mergeExclude,
    parentTradeId: freezeRecord.parentTradeId,
    importEligible,
    held,
    excluded,
    eligibilityStatus,
    dependencySeedCount: dependencySeedKeys.length,
    dependencySeedKeys,
    canonicalDisposition: importEligible
      ? "private-canonical-create-candidate"
      : "no-canonical-create",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    automaticCanonicalMerge: false,
    automaticIdentityMerge: false,
    automaticRoute: false,
    canonicalImport: false,
    playerImport: false,
    teamRegistryWrite: false,
    relationshipWrite: false,
    routeDataWrite: false,
  });
}

const eligibleRecords = eligibilityRecords.filter((record) => record.importEligible);
const heldRecords = eligibilityRecords.filter((record) => record.held);
const excludedRecords = eligibilityRecords.filter((record) => record.excluded);
const playerIdentitySeeds = dependencySeedRecords.filter(
  (record) => record.identityResolutionRequired,
);

const counts = {
  sourceRows: eligibilityRecords.length,
  eligibleRows: eligibleRecords.length,
  heldRows: heldRecords.length,
  excludedRows: excludedRecords.length,
  packagingQueueInputRows: routing.counts.packagingQueueRecords,
  phase7dRemainingHeldRows: routing.counts.remainingHeldRecords,
  archiveImportReadyRows: eligibilityRecords.filter(
    (record) => record.archiveDatabaseReady,
  ).length,
  archiveEligibleRows: eligibleRecords.filter(
    (record) => record.archiveDatabaseReady,
  ).length,
  archiveHeldRows: heldRecords.filter(
    (record) => record.archiveDatabaseReady,
  ).length,
  archiveExcludedRows: excludedRecords.filter(
    (record) => record.archiveDatabaseReady,
  ).length,
  publicCandidateEligibleRows: eligibleRecords.filter(
    (record) => record.contentClass === "Public Candidate",
  ).length,
  privateNoindexEligibleRows: eligibleRecords.filter(
    (record) => record.contentClass === "Private/Noindex Archive",
  ).length,
  routedEligibleRows: eligibleRecords.filter(
    (record) => record.routingRequired,
  ).length,
  dependencySeedRows: dependencySeedRecords.length,
  playerIdentitySeedRows: playerIdentitySeeds.length,
  nonIdentityAssetSeedRows:
    dependencySeedRecords.length - playerIdentitySeeds.length,
  eligibilityStatusCounts: countBy(
    eligibilityRecords.map((record) => record.eligibilityStatus),
  ),
  dependencyClassCounts: countBy(
    dependencySeedRecords.map((record) => record.assetClass),
  ),
  heldBlockerCounts: countBy(
    heldRecords.flatMap((record) => record.blockersAfterRouting),
  ),
};

assert(counts.sourceRows === 219, "Source-row count drifted.");
assert(counts.eligibleRows === 187, "Eligible-row count differs from Phase 7D packaging queue.");
assert(counts.heldRows === 25, "Held-row count differs from Phase 7D.");
assert(counts.excludedRows === 7, "Excluded-row count differs from Phase 7D.");
assert(counts.packagingQueueInputRows === 187, "Phase 7D packaging input count drifted.");
assert(counts.phase7dRemainingHeldRows === 25, "Phase 7D held input count drifted.");
assert(counts.archiveImportReadyRows === 15, "Private archive readiness drifted.");
assert(
  counts.archiveEligibleRows +
    counts.archiveHeldRows +
    counts.archiveExcludedRows === 15,
  "Private archive eligibility split does not close.",
);
assert(counts.eligibleRows + counts.heldRows + counts.excludedRows === 219, "Eligibility partition does not close.");
assert(counts.dependencySeedRows > 0, "Dependency seed is empty.");
assert(counts.playerIdentitySeedRows > 0, "Player identity seed is empty.");
assert(
  counts.playerIdentitySeedRows <= counts.dependencySeedRows,
  "Player identity seed exceeds all dependency seeds.",
);
assert(
  new Set(dependencySeedRecords.map((record) => record.dependencySeedKey)).size ===
    dependencySeedRecords.length,
  "Dependency seed keys are not unique.",
);
assert(
  eligibleRecords.every((record) => record.dependencySeedCount > 0),
  "An eligible package has no dependency seeds.",
);
assert(
  eligibleRecords.every(
    (record) =>
      record.blockersAfterRouting.length === 0 &&
      record.mergeExclude === false &&
      record.databaseImportAuthorized === true,
  ),
  "An eligible package violates the eligibility contract.",
);
assert(
  heldRecords.every(
    (record) =>
      record.importEligible === false &&
      record.excluded === false &&
      record.blockersAfterRouting.length > 0,
  ),
  "A held package lacks a blocker.",
);
assert(
  excludedRecords.every(
    (record) =>
      record.mergeExclude === true &&
      record.parentTradeId &&
      record.importEligible === false,
  ),
  "An excluded record is not a linked follow-up.",
);
const insufficientEvidenceRecords = eligibilityRecords.filter(
  (record) => record.insufficientEvidence,
);
assert(
  insufficientEvidenceRecords.length === 15,
  "Insufficient-evidence source count drifted.",
);
assert(
  insufficientEvidenceRecords.every(
    (record) =>
      record.archiveDatabaseReady === true &&
      record.privateArchive === true,
  ),
  "An insufficient-evidence record was reopened or lost archival readiness.",
);
assert(eligibilityRecords.every((record) => record.automaticCanonicalMerge === false), "Automatic canonical merge enabled.");
assert(eligibilityRecords.every((record) => record.automaticIdentityMerge === false), "Automatic identity merge enabled.");
assert(eligibilityRecords.every((record) => record.automaticRoute === false), "Automatic route enabled.");
assert(eligibilityRecords.every((record) => record.canonicalImport === false), "Canonical import occurred.");
assert(eligibilityRecords.every((record) => record.playerImport === false), "Player import occurred.");
assert(eligibilityRecords.every((record) => record.relationshipWrite === false), "Relationship write occurred.");
assert(eligibilityRecords.every((record) => record.routeDataWrite === false), "Route-data write occurred.");

const eligibilityRecordsSha256 = sha256(JSON.stringify(eligibilityRecords));
const dependencySeedSha256 = sha256(JSON.stringify(dependencySeedRecords));
const playerIdentitySeedSha256 = sha256(JSON.stringify(playerIdentitySeeds));

const manifest = {
  result: "PASS",
  phase: "7E",
  mode: "IMPORT_ELIGIBILITY_AND_DEPENDENCY_SEED_FREEZE",
  sourceTeam: "chicago-bulls",
  counts,
  eligibilityRecordsSha256,
  dependencySeedSha256,
  playerIdentitySeedSha256,
  sourceHashes: {
    routingFreezeJsonSha256: sha256(routingBytes),
    reviewedJsonSha256: sha256(reviewedBytes),
    contractSha256: sha256(contractBytes),
    phase7DFreezeRecordsSha256: routing.freezeRecordsSha256,
    phase7DRouteEdgesSha256: routing.routeEdgesSha256,
  },
  eligibilityRecords,
  dependencySeedRecords,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticCanonicalMerges: 0,
  automaticIdentityMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const packageHeaders = [
  "packageKey", "sourceTradeId", "sourceRow", "tradeDate", "teams",
  "declaredTeamCount", "verdict", "contentClass", "databaseStatus",
  "privateArchive", "insufficientEvidence", "archiveDatabaseReady", "routingRequired",
  "routingComplete", "phase7dFinalStatus", "blockersAfterRouting",
  "mergeExclude", "parentTradeId", "importEligible", "held", "excluded",
  "eligibilityStatus", "dependencySeedCount", "canonicalDisposition",
  "automaticCanonicalMerge", "automaticIdentityMerge", "automaticRoute",
];
function packageRows(records) {
  return records.map((record) => ({
    ...record,
    teams: record.teams.join(" | "),
    blockersAfterRouting: record.blockersAfterRouting.join(" | "),
  }));
}
const dependencyHeaders = [
  "dependencySeedKey", "packageKey", "sourceTradeId", "sourceRow",
  "tradeDate", "direction", "assetIndex", "assetText",
  "normalizedAssetKey", "assetClass", "identityResolutionRequired",
  "routingRequired", "contentClass", "verdict", "privateOnly",
  "automaticPlayerCreate", "automaticIdentityMerge",
];

await Promise.all([
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7e-import-eligibility-freeze.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7e-eligible-packages.csv"),
    toCsv(packageRows(eligibleRecords), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7e-held-packages.csv"),
    toCsv(packageRows(heldRecords), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7e-excluded-followups.csv"),
    toCsv(packageRows(excludedRecords), packageHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7e-dependency-seeds.csv"),
    toCsv(dependencySeedRecords, dependencyHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7e-player-identity-seeds.csv"),
    toCsv(playerIdentitySeeds, dependencyHeaders),
  ),
  writeFile(
    path.join(outputDir, "chicago-bulls-phase-7e-summary.json"),
    JSON.stringify({
      result: "PASS",
      phase: "7E",
      counts,
      eligibilityRecordsSha256,
      dependencySeedSha256,
      playerIdentitySeedSha256,
      canonicalImports: 0,
      playerImports: 0,
      relationshipWrites: 0,
      routeDataWrites: 0,
      automaticCanonicalMerges: 0,
      automaticIdentityMerges: 0,
      automaticRoutes: 0,
    }, null, 2) + "\n",
  ),
]);

console.log(JSON.stringify({
  result: "PASS",
  phase: "7E",
  counts,
  eligibilityRecordsSha256,
  dependencySeedSha256,
  playerIdentitySeedSha256,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticCanonicalMerges: 0,
  automaticIdentityMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
