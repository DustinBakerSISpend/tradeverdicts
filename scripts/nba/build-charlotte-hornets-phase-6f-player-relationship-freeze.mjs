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
function slug(value) { return normalizeName(value).replace(/\s+/gu, "-") || "unknown-player"; }
function unique(values) { return [...new Set(values)]; }
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
function collectStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return [];
}
function identityStrings(player) {
  return unique([
    player.name, player.displayName, player.fullName, player.canonicalName, player.slug,
    ...collectStrings(player.aliases), ...collectStrings(player.nameVariants),
    ...collectStrings(player.alternateNames), ...collectStrings(player.sourceNames),
  ].filter(Boolean).map(normalizeName).filter(Boolean));
}
function playerId(player, index) {
  return String(player.id ?? player.playerId ?? player.slug ?? `existing-player-index-${index}`);
}
function cleanCandidate(rawAsset) {
  let value = String(rawAsset ?? "").trim();
  if (/\b(traded player exception|trade exception|tpe|salary exception|cap space|salary relief|future considerations|cash considerations|financial considerations|roster exception)\b/iu.test(value)) {
    return { status: "non-player-mechanism", name: "", reason: "contract-or-mechanism-reference" };
  }
  value = value.replace(/^\s*(acquired|received|sent|traded)\s+/iu, "")
    .replace(/\s+\((?:sign-and-trade|sign and trade|via [^)]+|salary match|contract)\)\s*$/iu, "")
    .replace(/\s+\[(?:via [^\]]+|contract)\]\s*$/iu, "").trim();
  if (/\s+(?:and|&|\/)\s+/iu.test(value)) {
    return { status: "ambiguous", name: value, reason: "multiple-player-or-composite-string" };
  }
  const normalized = normalizeName(value);
  const words = normalized.split(" ").filter(Boolean);
  const suffix = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  const main = words.filter((word) => !suffix.has(word));
  if (!/[a-z]/u.test(normalized) || main.length < 2 || main.length > 6 || words.some((word) => /^\d+$/u.test(word))) {
    return { status: "ambiguous", name: value, reason: "not-a-clean-person-name" };
  }
  return { status: "clean", name: value, reason: "" };
}

const args = parseArgs(process.argv);
for (const required of [
  "eligibility-freeze-json", "dependency-seed-csv", "players-json",
  "trades-json", "contract-md", "expected-eligibility-records-sha",
  "expected-dependency-seed-sha", "expected-freeze-records-sha", "output-dir",
]) assert(args[required], `Missing --${required}`);

const [eligibilityBytes, dependencyBytes, playerBytes, tradeBytes, contractBytes] = await Promise.all([
  readFile(args["eligibility-freeze-json"]), readFile(args["dependency-seed-csv"]),
  readFile(args["players-json"]), readFile(args["trades-json"]), readFile(args["contract-md"]),
]);
const eligibility = JSON.parse(eligibilityBytes.toString("utf8"));
const dependencies = parseCsv(dependencyBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));

assert(eligibility.result === "PASS" && eligibility.phase === "6E", "Phase 6E freeze did not pass.");
assert(eligibility.eligibilityRecordsSha256 === args["expected-eligibility-records-sha"], "Eligibility hash mismatch.");
assert(eligibility.dependencySeedSha256 === args["expected-dependency-seed-sha"], "Dependency hash mismatch.");
assert(eligibility.freezeRecordsSha256 === args["expected-freeze-records-sha"], "Freeze hash mismatch.");
assert(sha256(JSON.stringify(eligibility.records)) === eligibility.freezeRecordsSha256, "Freeze records mismatch.");
assert(Array.isArray(eligibility.records) && eligibility.records.length === 103, "Expected 103 eligible packages.");
assert(dependencies.length === 363, "Expected 363 dependency rows.");
assert(Array.isArray(players) && Array.isArray(trades), "Stores must be arrays.");

const eligibleByKey = new Map(eligibility.records.map((r) => [r.eligibilityKey, r]));
assert(eligibleByKey.size === 103, "Duplicate eligibility keys.");
for (const row of dependencies) {
  assert(eligibleByKey.has(row.eligibilityKey), `Unknown eligibility key ${row.eligibilityKey}.`);
  assert(row.tradeId === eligibleByKey.get(row.eligibilityKey).tradeId, `${row.eligibilityKey}: trade ID drift.`);
}

const identityIndex = new Map();
players.forEach((player, index) => {
  for (const identity of identityStrings(player)) {
    if (!identityIndex.has(identity)) identityIndex.set(identity, new Map());
    identityIndex.get(identity).set(playerId(player, index), {
      playerId: playerId(player, index),
      playerName: String(player.name ?? player.displayName ?? player.fullName ?? player.slug ?? `Existing Player ${index}`),
      playerSlug: String(player.slug ?? ""),
    });
  }
});
for (const [identity, matches] of identityIndex) {
  identityIndex.set(identity, [...matches.values()].sort((a, b) => a.playerId.localeCompare(b.playerId)));
}

const shells = new Map();
const existing = [];
const relationships = [];
const ambiguous = [];
const mechanisms = [];
const results = [];

for (const row of dependencies) {
  if (row.dependencyClass !== "player-or-contract-review") {
    results.push({ ...row, dependencyStatus: "non-player-dependency", playerReference: "" });
    continue;
  }
  const candidate = cleanCandidate(row.rawAsset);
  if (candidate.status === "non-player-mechanism") {
    const result = { ...row, dependencyStatus: "non-player-mechanism", playerReference: "", playerName: "", ambiguityReason: candidate.reason };
    mechanisms.push(result); results.push(result); continue;
  }
  if (candidate.status === "ambiguous") {
    const result = { ...row, dependencyStatus: "ambiguous-player-dependency", playerReference: "", playerName: candidate.name, ambiguityReason: candidate.reason };
    ambiguous.push(result); results.push(result); continue;
  }

  const normalized = normalizeName(candidate.name);
  const matches = identityIndex.get(normalized) ?? [];
  if (matches.length > 1) {
    const result = { ...row, dependencyStatus: "ambiguous-player-dependency", playerReference: matches.map((m) => m.playerId).join(" | "), playerName: candidate.name, ambiguityReason: "multiple-exact-existing-player-candidates" };
    ambiguous.push(result); results.push(result); continue;
  }

  if (matches.length === 1) {
    const match = matches[0];
    const relationshipKey = `${row.eligibilityKey}:${row.direction}:${String(row.ordinal).padStart(3, "0")}:existing:${match.playerId}`;
    existing.push({
      eligibilityKey: row.eligibilityKey, tradeId: row.tradeId, tradeDate: row.tradeDate,
      direction: row.direction, ordinal: Number(row.ordinal), rawAsset: row.rawAsset,
      normalizedName: normalized, playerId: match.playerId, playerName: match.playerName,
      playerSlug: match.playerSlug, matchMethod: "normalized-exact-name-or-alias",
      playerStoreWriteAuthorized: false,
    });
    relationships.push({
      relationshipKey, eligibilityKey: row.eligibilityKey, tradeId: row.tradeId,
      tradeDate: row.tradeDate, direction: row.direction, ordinal: Number(row.ordinal),
      rawAsset: row.rawAsset, playerReferenceType: "existing-player",
      playerReference: match.playerId, playerName: match.playerName,
      relationshipStatus: "frozen-preview", relationshipWriteAuthorized: false,
    });
    results.push({ ...row, dependencyStatus: "exact-existing-player", playerReference: match.playerId, playerName: match.playerName, ambiguityReason: "" });
    continue;
  }

  const shellKey = `proposed-player:${slug(candidate.name)}`;
  if (!shells.has(shellKey)) {
    shells.set(shellKey, {
      proposedPlayerKey: shellKey, proposedName: candidate.name,
      normalizedName: normalized, proposedSlug: slug(candidate.name),
      dependencyOccurrences: 0, sourceTradeIds: new Set(),
      playerStoreWriteAuthorized: false, automaticMergeAuthorized: false,
    });
  }
  const shell = shells.get(shellKey);
  shell.dependencyOccurrences += 1;
  shell.sourceTradeIds.add(row.tradeId);
  relationships.push({
    relationshipKey: `${row.eligibilityKey}:${row.direction}:${String(row.ordinal).padStart(3, "0")}:proposed:${shell.proposedSlug}`,
    eligibilityKey: row.eligibilityKey, tradeId: row.tradeId, tradeDate: row.tradeDate,
    direction: row.direction, ordinal: Number(row.ordinal), rawAsset: row.rawAsset,
    playerReferenceType: "proposed-player-shell", playerReference: shellKey,
    playerName: candidate.name, relationshipStatus: "frozen-preview",
    relationshipWriteAuthorized: false,
  });
  results.push({ ...row, dependencyStatus: "proposed-player-shell", playerReference: shellKey, playerName: candidate.name, ambiguityReason: "" });
}

const proposedShells = [...shells.values()].map((s) => ({ ...s, sourceTradeIds: [...s.sourceTradeIds].sort() }))
  .sort((a, b) => a.proposedPlayerKey.localeCompare(b.proposedPlayerKey));
relationships.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.tradeId.localeCompare(b.tradeId) || a.direction.localeCompare(b.direction) || a.ordinal - b.ordinal);
existing.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.tradeId.localeCompare(b.tradeId) || a.direction.localeCompare(b.direction) || a.ordinal - b.ordinal);
ambiguous.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.tradeId.localeCompare(b.tradeId) || a.direction.localeCompare(b.direction) || Number(a.ordinal) - Number(b.ordinal));

const ambiguousByKey = new Map();
for (const item of ambiguous) {
  if (!ambiguousByKey.has(item.eligibilityKey)) ambiguousByKey.set(item.eligibilityKey, []);
  ambiguousByKey.get(item.eligibilityKey).push(item);
}
const readiness = eligibility.records.map((record) => {
  const deps = results.filter((r) => r.eligibilityKey === record.eligibilityKey);
  const amb = ambiguousByKey.get(record.eligibilityKey) ?? [];
  const playerDeps = deps.filter((r) => ["exact-existing-player", "proposed-player-shell", "ambiguous-player-dependency"].includes(r.dependencyStatus));
  const edges = relationships.filter((r) => r.eligibilityKey === record.eligibilityKey).length;
  return {
    eligibilityKey: record.eligibilityKey, tradeId: record.tradeId, tradeDate: record.tradeDate,
    routingStatus: record.routingStatus, dependencySeedRows: deps.length,
    playerDependencyOccurrences: playerDeps.length, relationshipPreviewEdges: edges,
    ambiguousPlayerDependencies: amb.length,
    readinessStatus: amb.length === 0 ? "ready-after-player-dependency-gate" : "hold-ambiguous-player-dependency",
    importReady: amb.length === 0, canonicalImportAuthorized: false,
    playerImportAuthorized: false, relationshipWriteAuthorized: false,
  };
}).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.tradeId.localeCompare(b.tradeId));

const ready = readiness.filter((r) => r.importReady);
const held = readiness.filter((r) => !r.importReady);
const playerDeps = results.filter((r) => ["exact-existing-player", "proposed-player-shell", "ambiguous-player-dependency"].includes(r.dependencyStatus));
const counts = {
  phase6eEligiblePackages: 103, dependencySeedRows: 363,
  playerDependencyOccurrences: playerDeps.length,
  nonPlayerDependencyRows: results.filter((r) => r.dependencyStatus === "non-player-dependency").length,
  nonPlayerMechanismRows: mechanisms.length,
  exactExistingPlayerOccurrences: existing.length,
  proposedPlayerShellOccurrences: results.filter((r) => r.dependencyStatus === "proposed-player-shell").length,
  proposedPlayerShellPackages: proposedShells.length,
  ambiguousPlayerDependencyOccurrences: ambiguous.length,
  ambiguousPlayerHoldPackages: held.length,
  relationshipPreviewEdges: relationships.length,
  readyPackages: ready.length, heldPackages: held.length,
  dependencyStatusCounts: countBy(results.map((r) => r.dependencyStatus)),
  packageReadinessCounts: countBy(readiness.map((r) => r.readinessStatus)),
};

assert(counts.readyPackages + counts.heldPackages === 103, "Package accounting drifted.");
assert(counts.relationshipPreviewEdges + counts.ambiguousPlayerDependencyOccurrences === counts.playerDependencyOccurrences, "Dependency accounting drifted.");
assert(counts.relationshipPreviewEdges === counts.exactExistingPlayerOccurrences + counts.proposedPlayerShellOccurrences, "Relationship accounting drifted.");
assert(new Set(relationships.map((r) => r.relationshipKey)).size === relationships.length, "Duplicate relationship keys.");
assert(new Set(proposedShells.map((r) => r.proposedPlayerKey)).size === proposedShells.length, "Duplicate proposed-player keys.");

const freezeRecords = readiness.map((r) => ({
  eligibilityKey: r.eligibilityKey, tradeId: r.tradeId, tradeDate: r.tradeDate,
  readinessStatus: r.readinessStatus, importReady: r.importReady,
  playerDependencyOccurrences: r.playerDependencyOccurrences,
  relationshipPreviewEdges: r.relationshipPreviewEdges,
  ambiguousPlayerDependencies: r.ambiguousPlayerDependencies,
}));

const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });
const files = {
  freezeJson: "charlotte-hornets-phase-6f-player-relationship-freeze.json",
  playerShellCsv: "charlotte-hornets-phase-6f-player-shell-packages.csv",
  existingPlayerCsv: "charlotte-hornets-phase-6f-existing-player-references.csv",
  relationshipCsv: "charlotte-hornets-phase-6f-relationship-previews.csv",
  ambiguousCsv: "charlotte-hornets-phase-6f-ambiguous-player-holds.csv",
  readinessCsv: "charlotte-hornets-phase-6f-package-readiness.csv",
  mechanismCsv: "charlotte-hornets-phase-6f-non-player-mechanisms.csv",
  summaryJson: "charlotte-hornets-phase-6f-summary.json",
};

const freeze = {
  result: "PASS", phase: "6F", mode: "PLAYER_SHELL_AND_RELATIONSHIP_FREEZE",
  sourceEligibility: {
    eligibilityRecordsSha256: eligibility.eligibilityRecordsSha256,
    dependencySeedSha256: eligibility.dependencySeedSha256,
    freezeRecordsSha256: eligibility.freezeRecordsSha256,
  },
  playersStoreSha256: sha256(playerBytes), canonicalStoreSha256: sha256(tradeBytes),
  contractSha256: sha256(contractBytes), counts,
  proposedPlayerShellsSha256: sha256(JSON.stringify(proposedShells)),
  existingPlayerReferencesSha256: sha256(JSON.stringify(existing)),
  relationshipPreviewRecordsSha256: sha256(JSON.stringify(relationships)),
  ambiguousDependencyRecordsSha256: sha256(JSON.stringify(ambiguous)),
  packageReadinessRecordsSha256: sha256(JSON.stringify(readiness)),
  freezeRecordsSha256: sha256(JSON.stringify(freezeRecords)),
  records: freezeRecords, outputFiles: files,
  canonicalImports: 0, playerImports: 0, relationshipWrites: 0,
  routeDataWrites: 0, canonicalIdsAssigned: 0,
  automaticIdentityResolutions: 0, automaticMerges: 0,
  publicationAuthorized: false, pushPerformed: false, deployPerformed: false,
};

const shellRows = proposedShells.map((r) => ({
  proposedPlayerKey: r.proposedPlayerKey, proposedName: r.proposedName,
  normalizedName: r.normalizedName, proposedSlug: r.proposedSlug,
  dependencyOccurrences: r.dependencyOccurrences, sourceTradeIds: r.sourceTradeIds.join(" | "),
  playerStoreWriteAuthorized: false, automaticMergeAuthorized: false,
}));
const ambiguousRows = ambiguous.map((r) => ({
  eligibilityKey: r.eligibilityKey, tradeId: r.tradeId, tradeDate: r.tradeDate,
  direction: r.direction, ordinal: r.ordinal, rawAsset: r.rawAsset,
  candidateName: r.playerName, candidateReferences: r.playerReference,
  ambiguityReason: r.ambiguityReason, playerImportAuthorized: false,
}));
const readinessRows = readiness.map((r) => ({ ...r }));
const mechanismRows = mechanisms.map((r) => ({
  eligibilityKey: r.eligibilityKey, tradeId: r.tradeId, tradeDate: r.tradeDate,
  direction: r.direction, ordinal: r.ordinal, rawAsset: r.rawAsset,
  reason: r.ambiguityReason, playerRelationshipRequired: false,
}));
const summary = {
  result: "PASS", phase: "6F", counts,
  proposedPlayerShellsSha256: freeze.proposedPlayerShellsSha256,
  relationshipPreviewRecordsSha256: freeze.relationshipPreviewRecordsSha256,
  ambiguousDependencyRecordsSha256: freeze.ambiguousDependencyRecordsSha256,
  packageReadinessRecordsSha256: freeze.packageReadinessRecordsSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256,
  canonicalImports: 0, playerImports: 0, relationshipWrites: 0,
  automaticIdentityResolutions: 0, automaticMerges: 0,
};

await Promise.all([
  writeFile(path.join(outputDir, files.freezeJson), JSON.stringify(freeze, null, 2) + "\n"),
  writeFile(path.join(outputDir, files.playerShellCsv), toCsv(shellRows, ["proposedPlayerKey","proposedName","normalizedName","proposedSlug","dependencyOccurrences","sourceTradeIds","playerStoreWriteAuthorized","automaticMergeAuthorized"])),
  writeFile(path.join(outputDir, files.existingPlayerCsv), toCsv(existing, ["eligibilityKey","tradeId","tradeDate","direction","ordinal","rawAsset","normalizedName","playerId","playerName","playerSlug","matchMethod","playerStoreWriteAuthorized"])),
  writeFile(path.join(outputDir, files.relationshipCsv), toCsv(relationships, ["relationshipKey","eligibilityKey","tradeId","tradeDate","direction","ordinal","rawAsset","playerReferenceType","playerReference","playerName","relationshipStatus","relationshipWriteAuthorized"])),
  writeFile(path.join(outputDir, files.ambiguousCsv), toCsv(ambiguousRows, ["eligibilityKey","tradeId","tradeDate","direction","ordinal","rawAsset","candidateName","candidateReferences","ambiguityReason","playerImportAuthorized"])),
  writeFile(path.join(outputDir, files.readinessCsv), toCsv(readinessRows, ["eligibilityKey","tradeId","tradeDate","routingStatus","dependencySeedRows","playerDependencyOccurrences","relationshipPreviewEdges","ambiguousPlayerDependencies","readinessStatus","importReady","canonicalImportAuthorized","playerImportAuthorized","relationshipWriteAuthorized"])),
  writeFile(path.join(outputDir, files.mechanismCsv), toCsv(mechanismRows, ["eligibilityKey","tradeId","tradeDate","direction","ordinal","rawAsset","reason","playerRelationshipRequired"])),
  writeFile(path.join(outputDir, files.summaryJson), JSON.stringify(summary, null, 2) + "\n"),
]);

console.log(JSON.stringify({
  result: freeze.result, phase: freeze.phase, mode: freeze.mode, counts,
  proposedPlayerShellsSha256: freeze.proposedPlayerShellsSha256,
  existingPlayerReferencesSha256: freeze.existingPlayerReferencesSha256,
  relationshipPreviewRecordsSha256: freeze.relationshipPreviewRecordsSha256,
  ambiguousDependencyRecordsSha256: freeze.ambiguousDependencyRecordsSha256,
  packageReadinessRecordsSha256: freeze.packageReadinessRecordsSha256,
  freezeRecordsSha256: freeze.freezeRecordsSha256, outputFiles: files,
  canonicalImports: 0, playerImports: 0, relationshipWrites: 0,
  routeDataWrites: 0, canonicalIdsAssigned: 0,
  automaticIdentityResolutions: 0, automaticMerges: 0,
}, null, 2));
