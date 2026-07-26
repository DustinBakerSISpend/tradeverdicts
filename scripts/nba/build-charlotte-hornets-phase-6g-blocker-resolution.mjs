#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalizeName(value) {
  return String(value ?? "").normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/&/gu, " and ").replace(/['’`]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");
}
function unique(values) { return [...new Set(values)]; }
function primaryNames(player) {
  return unique([player.name, player.displayName, player.fullName, player.canonicalName]
    .filter(Boolean).map(normalizeName).filter(Boolean));
}
function playerId(player, index) {
  return String(player.id ?? player.playerId ?? player.slug ?? `existing-player-index-${index}`);
}
function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function toCsv(rows, headers) {
  return [headers.join(","), ...rows.map((row) => headers.map((h) => csv(row[h])).join(","))].join("\r\n") + "\r\n";
}
function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field.");
  if (field.length || row.length) { row.push(field); rows.push(row); }
  while (rows.length && rows.at(-1).every((v) => v === "")) rows.pop();
  assert(rows.length > 0, "CSV input is empty.");
  const headers = rows[0];
  assert(new Set(headers).size === headers.length, "Duplicate CSV headers.");
  return rows.slice(1).map((values, index) => {
    assert(values.length === headers.length, `CSV row ${index + 2} has ${values.length} columns; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
}
function bool(value) { return String(value).toLowerCase() === "true"; }
function number(value) { return Number.parseInt(String(value), 10); }
function splitPipe(value) { return String(value ?? "").split("|").map((v) => v.trim()).filter(Boolean); }

const args = parseArgs(process.argv);
for (const required of [
  "phase6e-freeze", "phase6f-freeze", "phase6f-readiness-csv",
  "phase6f-ambiguous-csv", "phase6f-relationships-csv",
  "phase6f-player-shells-csv", "players-json", "trades-json",
  "contract-md", "expected-eligibility-sha", "expected-readiness-sha",
  "expected-relationships-sha", "expected-freeze-sha", "output-dir",
]) assert(args[required], `Missing --${required}`);

const [eBytes, fBytes, readinessBytes, ambiguousBytes, relBytes, shellBytes, playerBytes, tradeBytes, contractBytes] = await Promise.all([
  readFile(args["phase6e-freeze"]), readFile(args["phase6f-freeze"]),
  readFile(args["phase6f-readiness-csv"]), readFile(args["phase6f-ambiguous-csv"]),
  readFile(args["phase6f-relationships-csv"]), readFile(args["phase6f-player-shells-csv"]),
  readFile(args["players-json"]), readFile(args["trades-json"]), readFile(args["contract-md"]),
]);
const phase6e = JSON.parse(eBytes.toString("utf8"));
const phase6f = JSON.parse(fBytes.toString("utf8"));
const readiness = parseCsv(readinessBytes.toString("utf8"));
const ambiguous = parseCsv(ambiguousBytes.toString("utf8"));
const relationships = parseCsv(relBytes.toString("utf8"));
const shells = parseCsv(shellBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));

assert(phase6e.result === "PASS" && phase6e.phase === "6E", "Phase 6E freeze did not pass.");
assert(phase6f.result === "PASS" && phase6f.phase === "6F", "Phase 6F freeze did not pass.");
assert(phase6e.eligibilityRecordsSha256 === args["expected-eligibility-sha"], "Phase 6E eligibility hash mismatch.");
assert(phase6f.packageReadinessRecordsSha256 === args["expected-readiness-sha"], "Phase 6F readiness hash mismatch.");
assert(phase6f.relationshipPreviewRecordsSha256 === args["expected-relationships-sha"], "Phase 6F relationship hash mismatch.");
assert(phase6f.freezeRecordsSha256 === args["expected-freeze-sha"], "Phase 6F freeze hash mismatch.");
assert(sha256(JSON.stringify(phase6f.records)) === phase6f.freezeRecordsSha256, "Phase 6F records do not match their hash.");
assert(Array.isArray(players) && Array.isArray(trades), "Stores must be arrays.");
assert(phase6f.counts.phase6eEligiblePackages === 103, "Eligible count drifted.");
assert(phase6f.counts.readyPackages === 102 && phase6f.counts.heldPackages === 1, "Starting partition drifted.");
assert(phase6f.counts.ambiguousPlayerDependencyOccurrences === 1, "Ambiguous count drifted.");
assert(phase6f.counts.proposedPlayerShellPackages === 115, "Shell count drifted.");
assert(phase6f.counts.relationshipPreviewEdges === 201, "Relationship count drifted.");
assert(readiness.length === 103 && ambiguous.length === 1 && relationships.length === 201 && shells.length === 115, "Phase 6F CSV accounting drifted.");

const playersById = new Map();
players.forEach((player, index) => playersById.set(playerId(player, index), player));
const resolved = []; const remaining = []; const additional = [];
for (const item of ambiguous) {
  const candidateName = item.candidateName || item.rawAsset;
  const normalized = normalizeName(candidateName);
  const primaryMatches = [];
  for (const id of splitPipe(item.candidateReferences)) {
    const player = playersById.get(id);
    if (player && primaryNames(player).includes(normalized)) {
      primaryMatches.push({ id, name: String(player.name ?? player.displayName ?? player.fullName ?? candidateName), slug: String(player.slug ?? "") });
    }
  }
  if (primaryMatches.length === 1) {
    const match = primaryMatches[0];
    resolved.push({
      eligibilityKey: item.eligibilityKey, tradeId: item.tradeId, tradeDate: item.tradeDate,
      direction: item.direction, ordinal: number(item.ordinal), rawAsset: item.rawAsset,
      candidateName, playerId: match.id, playerName: match.name, playerSlug: match.slug,
      resolutionSignal: "unique-normalized-primary-name", automaticIdentityMerge: false,
      relationshipWriteAuthorized: false,
    });
    additional.push({
      relationshipKey: `${item.eligibilityKey}:${item.direction}:${String(item.ordinal).padStart(3, "0")}:resolved:${match.id}`,
      eligibilityKey: item.eligibilityKey, tradeId: item.tradeId, tradeDate: item.tradeDate,
      direction: item.direction, ordinal: number(item.ordinal), rawAsset: item.rawAsset,
      playerReferenceType: "existing-player", playerReference: match.id, playerName: match.name,
      relationshipStatus: "frozen-preview", resolutionSignal: "unique-normalized-primary-name",
      relationshipWriteAuthorized: false,
    });
  } else {
    remaining.push({
      eligibilityKey: item.eligibilityKey, tradeId: item.tradeId, tradeDate: item.tradeDate,
      direction: item.direction, ordinal: number(item.ordinal), rawAsset: item.rawAsset,
      candidateName, candidateReferences: item.candidateReferences, ambiguityReason: item.ambiguityReason,
      primaryNameMatchCount: primaryMatches.length,
      holdReason: primaryMatches.length === 0 ? "no-unique-primary-name-signal" : "multiple-primary-name-signals",
      playerImportAuthorized: false,
    });
  }
}
assert(resolved.length + remaining.length === 1, "Ambiguous accounting drifted.");

const partition = readiness.map((item) => {
  const resolvedCount = resolved.filter((r) => r.eligibilityKey === item.eligibilityKey).length;
  const remainingCount = remaining.filter((r) => r.eligibilityKey === item.eligibilityKey).length;
  const importReady = bool(item.importReady) || (resolvedCount > 0 && remainingCount === 0);
  return {
    eligibilityKey: item.eligibilityKey, tradeId: item.tradeId, tradeDate: item.tradeDate,
    routingStatus: item.routingStatus, packageAction: "canonical-create",
    phase6fReadinessStatus: item.readinessStatus,
    resolvedAmbiguousOccurrences: resolvedCount, remainingAmbiguousOccurrences: remainingCount,
    finalReadinessStatus: importReady ? "ready-for-guarded-private-import" : "held-ambiguous-player-dependency",
    importReady, canonicalImportAuthorized: false, playerImportAuthorized: false,
    relationshipWriteAuthorized: false,
  };
}).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.tradeId.localeCompare(b.tradeId));
const ready = partition.filter((r) => r.importReady);
const held = partition.filter((r) => !r.importReady);
assert(ready.length + held.length === 103, "Final partition accounting drifted.");

const finalRelationships = [
  ...relationships.map((r) => ({
    relationshipKey: r.relationshipKey, eligibilityKey: r.eligibilityKey, tradeId: r.tradeId,
    tradeDate: r.tradeDate, direction: r.direction, ordinal: number(r.ordinal), rawAsset: r.rawAsset,
    playerReferenceType: r.playerReferenceType, playerReference: r.playerReference,
    playerName: r.playerName, relationshipStatus: r.relationshipStatus,
    resolutionSignal: "", relationshipWriteAuthorized: false,
  })),
  ...additional,
].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.tradeId.localeCompare(b.tradeId) || a.direction.localeCompare(b.direction) || a.ordinal - b.ordinal);
assert(new Set(finalRelationships.map((r) => r.relationshipKey)).size === finalRelationships.length, "Duplicate relationship keys.");
const readyKeys = new Set(ready.map((r) => r.eligibilityKey));
const readyRelationships = finalRelationships.filter((r) => readyKeys.has(r.eligibilityKey));
const shellCounts = new Map(); const shellTradeIds = new Map();
for (const rel of readyRelationships) {
  if (rel.playerReferenceType !== "proposed-player-shell") continue;
  shellCounts.set(rel.playerReference, (shellCounts.get(rel.playerReference) ?? 0) + 1);
  if (!shellTradeIds.has(rel.playerReference)) shellTradeIds.set(rel.playerReference, new Set());
  shellTradeIds.get(rel.playerReference).add(rel.tradeId);
}
const readyShells = shells.filter((s) => shellCounts.has(s.proposedPlayerKey)).map((s) => ({
  proposedPlayerKey: s.proposedPlayerKey, proposedName: s.proposedName,
  normalizedName: s.normalizedName, proposedSlug: s.proposedSlug,
  dependencyOccurrences: shellCounts.get(s.proposedPlayerKey),
  sourceTradeIds: [...shellTradeIds.get(s.proposedPlayerKey)].sort(),
  playerStoreWriteAuthorized: false, automaticMergeAuthorized: false,
})).sort((a, b) => a.proposedPlayerKey.localeCompare(b.proposedPlayerKey));

const counts = {
  sourceRows: 125, packagingActions: 103, sharedUnionResolutions: 0,
  resolvedAmbiguousIdentities: resolved.length, resolvedAmbiguousOccurrences: resolved.length,
  remainingAmbiguousIdentities: remaining.length, remainingAmbiguousOccurrences: remaining.length,
  readyPackages: ready.length, heldPackages: held.length,
  readyCanonicalCreatePackages: ready.length, readyPerspectiveAppendPackages: 0,
  playerShellPackages: shells.length, readyPlayerShellPackages: readyShells.length,
  baseRelationshipPreviews: relationships.length, additionalRelationships: additional.length,
  totalRelationshipPreviews: finalRelationships.length, readyRelationshipPreviews: readyRelationships.length,
  eligibilityCounts: countBy(partition.map((r) => r.finalReadinessStatus)),
  heldPackageTypeCounts: countBy(held.map((r) => r.finalReadinessStatus)),
};
assert(counts.resolvedAmbiguousOccurrences + counts.remainingAmbiguousOccurrences === 1, "Ambiguous accounting drifted.");
assert(counts.readyPackages + counts.heldPackages === 103, "Ready/held accounting drifted.");
assert(counts.totalRelationshipPreviews === counts.baseRelationshipPreviews + counts.additionalRelationships, "Relationship accounting drifted.");

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });
const files = {
  resolutionJson: "charlotte-hornets-phase-6g-blocker-resolution.json",
  resolvedCsv: "charlotte-hornets-phase-6g-resolved-ambiguous-identities.csv",
  remainingCsv: "charlotte-hornets-phase-6g-remaining-ambiguous-holds.csv",
  sharedUnionCsv: "charlotte-hornets-phase-6g-shared-union-resolutions.csv",
  additionalRelationshipCsv: "charlotte-hornets-phase-6g-additional-relationships.csv",
  importPartitionCsv: "charlotte-hornets-phase-6g-import-partition.csv",
  summaryJson: "charlotte-hornets-phase-6g-summary.json",
};
const resolution = {
  result: "PASS", phase: "6G", mode: "FINAL_BLOCKER_RESOLUTION_AND_IMPORT_PARTITION",
  sourceHashes: {
    phase6eEligibilityRecordsSha256: phase6e.eligibilityRecordsSha256,
    phase6fPackageReadinessRecordsSha256: phase6f.packageReadinessRecordsSha256,
    phase6fRelationshipPreviewRecordsSha256: phase6f.relationshipPreviewRecordsSha256,
    phase6fFreezeRecordsSha256: phase6f.freezeRecordsSha256,
    playersStoreSha256: sha256(playerBytes), canonicalStoreSha256: sha256(tradeBytes), contractSha256: sha256(contractBytes),
  },
  ...counts,
  resolvedAmbiguousIdentityRecords: resolved,
  remainingAmbiguousHoldRecords: remaining,
  sharedUnionResolutionRecords: [],
  additionalRelationshipRecords: additional,
  finalPackageRecords: partition,
  readyPlayerShellRecords: readyShells,
  finalRelationshipRecords: finalRelationships,
  readyRelationshipRecords: readyRelationships,
  finalPackageRecordsSha256: sha256(JSON.stringify(partition)),
  readyPlayerShellRecordsSha256: sha256(JSON.stringify(readyShells)),
  finalRelationshipRecordsSha256: sha256(JSON.stringify(finalRelationships)),
  readyRelationshipRecordsSha256: sha256(JSON.stringify(readyRelationships)),
  importPartitionSha256: sha256(JSON.stringify(partition.map((r) => ({ eligibilityKey: r.eligibilityKey, tradeId: r.tradeId, finalReadinessStatus: r.finalReadinessStatus, importReady: r.importReady })))),
  outputFiles: files,
  canonicalImports: 0, playerImports: 0, perspectiveWrites: 0, relationshipWrites: 0,
  routeDataWrites: 0, automaticIdentityMerges: 0, automaticCanonicalMerges: 0,
  publicationAuthorized: false, pushPerformed: false, deployPerformed: false,
};
const summary = {
  result: "PASS", phase: "6G", counts,
  finalPackageRecordsSha256: resolution.finalPackageRecordsSha256,
  readyPlayerShellRecordsSha256: resolution.readyPlayerShellRecordsSha256,
  finalRelationshipRecordsSha256: resolution.finalRelationshipRecordsSha256,
  readyRelationshipRecordsSha256: resolution.readyRelationshipRecordsSha256,
  importPartitionSha256: resolution.importPartitionSha256,
  canonicalImports: 0, playerImports: 0, perspectiveWrites: 0,
  relationshipWrites: 0, automaticIdentityMerges: 0, automaticCanonicalMerges: 0,
};
await Promise.all([
  writeFile(path.join(outputDir, files.resolutionJson), JSON.stringify(resolution, null, 2) + "\n"),
  writeFile(path.join(outputDir, files.resolvedCsv), toCsv(resolved, ["eligibilityKey","tradeId","tradeDate","direction","ordinal","rawAsset","candidateName","playerId","playerName","playerSlug","resolutionSignal","automaticIdentityMerge","relationshipWriteAuthorized"])),
  writeFile(path.join(outputDir, files.remainingCsv), toCsv(remaining, ["eligibilityKey","tradeId","tradeDate","direction","ordinal","rawAsset","candidateName","candidateReferences","ambiguityReason","primaryNameMatchCount","holdReason","playerImportAuthorized"])),
  writeFile(path.join(outputDir, files.sharedUnionCsv), toCsv([], ["tradeId","resolutionType","canonicalTarget","resolutionSignal"])),
  writeFile(path.join(outputDir, files.additionalRelationshipCsv), toCsv(additional, ["relationshipKey","eligibilityKey","tradeId","tradeDate","direction","ordinal","rawAsset","playerReferenceType","playerReference","playerName","relationshipStatus","resolutionSignal","relationshipWriteAuthorized"])),
  writeFile(path.join(outputDir, files.importPartitionCsv), toCsv(partition, ["eligibilityKey","tradeId","tradeDate","routingStatus","packageAction","phase6fReadinessStatus","resolvedAmbiguousOccurrences","remainingAmbiguousOccurrences","finalReadinessStatus","importReady","canonicalImportAuthorized","playerImportAuthorized","relationshipWriteAuthorized"])),
  writeFile(path.join(outputDir, files.summaryJson), JSON.stringify(summary, null, 2) + "\n"),
]);
console.log(JSON.stringify({
  result: resolution.result, phase: resolution.phase, mode: resolution.mode, ...counts,
  finalPackageRecordsSha256: resolution.finalPackageRecordsSha256,
  readyPlayerShellRecordsSha256: resolution.readyPlayerShellRecordsSha256,
  finalRelationshipRecordsSha256: resolution.finalRelationshipRecordsSha256,
  readyRelationshipRecordsSha256: resolution.readyRelationshipRecordsSha256,
  importPartitionSha256: resolution.importPartitionSha256,
  outputFiles: files, canonicalImports: 0, playerImports: 0, perspectiveWrites: 0,
  relationshipWrites: 0, routeDataWrites: 0, automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
}, null, 2));
