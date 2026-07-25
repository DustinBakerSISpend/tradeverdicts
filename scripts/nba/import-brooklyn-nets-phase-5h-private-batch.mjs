#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
function clean(value) {
  return String(value ?? "").trim();
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function lfNormalizedUtf8Bytes(bytes, label) {
  assert(
    !(bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
    `${label} contains an unexpected UTF-8 BOM.`
  );

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }

  return Buffer.from(text.replace(/\r\n?/gu, "\n"), "utf8");
}
function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function normalizeIdentity(value) {
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
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
function uniqueSorted(values) {
  return unique(values).sort((left, right) => String(left).localeCompare(String(right), "en"));
}
function playerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id);
}
function tradeId(trade) {
  return clean(trade.id ?? trade.tradeId);
}
function tradeSlug(trade) {
  return clean(trade.slug ?? trade.routeSlug ?? trade.id);
}
function perspectiveTeam(perspective) {
  return clean(
    perspective.sourceTeam ??
    perspective.teamId ??
    perspective.team ??
    perspective.perspectiveTeam
  );
}
function teamSlug(team) {
  return clean(team.slug ?? team.id ?? team.teamId);
}
function titleCaseSlug(slug) {
  return clean(slug)
    .split("-")
    .filter(Boolean)
    .map((word) => word.length <= 3 && /^[a-z]+$/u.test(word)
      ? word.toUpperCase()
      : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
function lineageRules(lineage) {
  if (Array.isArray(lineage)) return lineage;
  for (const key of ["rules", "lineages", "entries", "historicalTeams"]) {
    if (Array.isArray(lineage?.[key])) return lineage[key];
  }
  return Object.values(lineage ?? {}).flatMap((value) =>
    Array.isArray(value) ? value : []
  );
}
function lineageRuleForSlug(slug, rules) {
  const exactId = rules.filter((rule) => clean(rule.id) === slug);
  if (exactId.length) return exactId[0];
  const exactTeam = rules.filter((rule) => clean(rule.team) === slug);
  if (exactTeam.length) return exactTeam[0];
  return null;
}
function collectTradeTeamSlugs(trades) {
  const slugs = new Set();
  for (const trade of trades) {
    for (const slug of Array.isArray(trade.teams) ? trade.teams : []) {
      if (clean(slug)) slugs.add(clean(slug));
    }
    for (const slug of Array.isArray(trade.sourceTeams) ? trade.sourceTeams : []) {
      if (clean(slug)) slugs.add(clean(slug));
    }
    for (const slug of Object.keys(trade.assetsReceived ?? {})) {
      if (clean(slug)) slugs.add(clean(slug));
    }
    for (const slug of Object.keys(trade.assetsSent ?? {})) {
      if (clean(slug)) slugs.add(clean(slug));
    }
    for (const asset of Array.isArray(trade.assetLedger) ? trade.assetLedger : []) {
      if (clean(asset.fromTeam)) slugs.add(clean(asset.fromTeam));
      if (clean(asset.toTeam)) slugs.add(clean(asset.toTeam));
    }
  }
  return [...slugs].sort((left, right) => left.localeCompare(right, "en"));
}
function deriveCeasedOperations(rule) {
  const validTo = clean(rule?.validTo);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(validTo)) return Number(validTo.slice(0, 4));
  return null;
}
function abbreviationForSlug(slug, used) {
  const words = slug.split("-").filter(Boolean);
  let base = words.map((word) => word[0]?.toUpperCase()).join("").slice(0, 4);
  if (base.length < 2) base = slug.replace(/[^a-z0-9]/giu, "").slice(0, 3).toUpperCase();
  if (!base) base = "HST";
  let candidate = base;
  let ordinal = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 3)}${ordinal}`;
    ordinal += 1;
  }
  used.add(candidate);
  return candidate;
}
function registerMissingHistoricalTeams(finalTrades, teams, lineage, importedAt) {
  const existingSlugs = new Set(teams.map(teamSlug).filter(Boolean));
  const requiredSlugs = collectTradeTeamSlugs(finalTrades);
  const missingSlugs = requiredSlugs.filter((slug) => !existingSlugs.has(slug));
  const rules = lineageRules(lineage);
  const usedAbbreviations = new Set(
    teams.map((team) => clean(team.abbreviation)).filter(Boolean)
  );

  const registrations = missingSlugs.map((slug) => {
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug), `Invalid historical team slug: ${slug}`);
    const rule = lineageRuleForSlug(slug, rules);
    const label = clean(rule?.label) || titleCaseSlug(slug);
    const evidenceStatus = rule ? "historical-lineage-rule" : "frozen-package-team";
    return {
      slug,
      name: label,
      abbreviation: abbreviationForSlug(slug, usedAbbreviations),
      conference: null,
      division: null,
      active: false,
      historicalAliases: unique([
        label,
        ...(Array.isArray(rule?.aliases) ? rule.aliases.map(clean) : []),
      ]),
      franchiseStatus: "defunct",
      ceasedOperations: deriveCeasedOperations(rule),
      privateOnly: true,
      registrySource: "brooklyn-nets-phase-5h",
      registryEvidenceStatus: evidenceStatus,
      lineageId: clean(rule?.id) || slug,
      lineageTeam: clean(rule?.team) || slug,
      lineageKind: clean(rule?.lineageKind) || "historical-defunct-team",
      validFrom: clean(rule?.validFrom) || null,
      validTo: clean(rule?.validTo) || null,
      createdAt: importedAt,
      updatedAt: importedAt,
    };
  });

  const finalTeams = [...teams, ...registrations];
  const finalSlugs = finalTeams.map(teamSlug);
  assert(finalSlugs.every(Boolean), "A team registry entry lacks a slug.");
  assert(new Set(finalSlugs).size === finalSlugs.length, "Duplicate team registry slug.");
  assert(
    collectTradeTeamSlugs(finalTrades).every((slug) => new Set(finalSlugs).has(slug)),
    "A post-import trade team remains absent from the registry."
  );

  return {
    teams: finalTeams,
    registrations,
    missingSlugs,
  };
}
function assetDisplay(asset) {
  return clean(
    asset.displayText ??
    asset.asset ??
    asset.playerName ??
    asset.name ??
    asset.label ??
    asset.description
  );
}
function assetPlayerName(asset) {
  return clean(asset.playerName ?? asset.name ?? asset.displayText);
}
function relationshipReferenceType(role) {
  if (role === "traded-player") return "direct_player";
  if (role === "draft-rights-player") return "draft_rights";
  if (role === "pick-became-player") return "draft_outcome";
  return "player_reference";
}
function assetMatchesRelationship(asset, relationship) {
  const role = clean(relationship.relationshipRole);
  const player = normalizeIdentity(relationship.playerDisplayName);
  if (!player) return false;

  if (role === "pick-became-player") {
    const became = normalizeIdentity(asset.becamePlayerName);
    if (became) return became === player;
  }

  const explicit = normalizeIdentity(asset.playerName ?? asset.name);
  if (explicit) return explicit === player;

  const display = normalizeIdentity(assetDisplay(asset));
  return display === player || display.includes(player) || player.includes(display);
}
function immutablePerspectiveProjection(trade) {
  const {
    sourceTeams,
    grades,
    perspectives,
    sources,
    updatedAt,
    perspectiveReconciliations,
    assetLedger,
    assetsReceived,
    assetsSent,
    publishStatus,
    privateOnly,
    indexEligible,
    adEligible,
    publicationReady,
    ...immutable
  } = trade;
  return immutable;
}
function normalizePerspective(perspective) {
  return {
    ...perspective,
    sourceTeam: perspectiveTeam(perspective),
    publishStatus: "private",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  };
}
function mergedGrades(perspectives, existing = {}) {
  const output = { ...(existing && typeof existing === "object" ? existing : {}) };
  for (const perspective of perspectives) {
    if (!perspective.grades || typeof perspective.grades !== "object") continue;
    for (const [team, grade] of Object.entries(perspective.grades)) {
      if (clean(team) && clean(grade)) output[team] = grade;
    }
  }
  return output;
}
function flattenAssets(trade) {
  if (Array.isArray(trade.assetLedger) && trade.assetLedger.length) {
    return trade.assetLedger.map((asset) => ({ ...asset }));
  }
  const output = [];
  for (const [team, assets] of Object.entries(trade.assetsReceived ?? {})) {
    for (const asset of Array.isArray(assets) ? assets : []) {
      output.push({
        ...asset,
        toTeam: clean(asset.toTeam ?? team),
      });
    }
  }
  return output;
}
function assetsByTeam(teams, assets, direction) {
  return Object.fromEntries(teams.map((team) => [
    team,
    assets.filter((asset) =>
      direction === "received"
        ? clean(asset.toTeam) === team
        : clean(asset.fromTeam) === team
    ),
  ]));
}
async function atomicWrite(filePath, bytes, suffix) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${suffix}-${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
function createAssetId(packageItem, asset, ordinal) {
  return `phase5h-asset-${sha256([
    packageItem.packageId,
    ordinal,
    clean(asset.type),
    assetDisplay(asset),
    clean(asset.fromTeam),
    clean(asset.toTeam),
    clean(asset.direction),
  ].join("|")).slice(0, 20)}`;
}
function normalizePackageAssets(packageItem, sourceAssets, packageRelationships) {
  const relationships = packageRelationships.map((item) => ({ ...item }));
  const relationshipAssetOverride = new Map();
  let relationshipBackedSyntheticAssetIdsAdded = 0;
  let fieldDerivedSyntheticAssetIdsAdded = 0;

  const normalized = sourceAssets.map((source, ordinal) => {
    const asset = {
      ...source,
      displayText: assetDisplay(source),
      asset: clean(source.asset ?? assetDisplay(source)),
      fromTeam: clean(source.fromTeam),
      toTeam: clean(source.toTeam),
      possibleFromTeams: [],
      possibleToTeams: [],
      routingStatus: "resolved",
      privateOnly: true,
    };

    if (clean(asset.assetId)) return asset;

    const candidates = relationships.filter((relationship) =>
      relationship.syntheticAssetReference === true &&
      assetMatchesRelationship(asset, relationship)
    );

    if (candidates.length) {
      const selected = [...candidates].sort((left, right) =>
        clean(left.relationshipId).localeCompare(clean(right.relationshipId), "en")
      )[0];
      asset.assetId = clean(selected.assetReference);
      asset.sourceAssetId = null;
      asset.syntheticAssetReference = true;
      asset.syntheticAssetReferenceMethod = "relationship-reference";
      asset.syntheticAssetReferenceSource = selected.relationshipId;
      relationshipBackedSyntheticAssetIdsAdded += 1;
      for (const candidate of candidates) {
        relationshipAssetOverride.set(candidate.relationshipId, asset.assetId);
      }
      return asset;
    }

    asset.assetId = createAssetId(packageItem, asset, ordinal);
    asset.sourceAssetId = null;
    asset.syntheticAssetReference = true;
    asset.syntheticAssetReferenceMethod = "deterministic-canonical-asset-fields";
    asset.syntheticAssetReferenceSource = `phase5h-field-fingerprint:${sha256([
      packageItem.packageId,
      ordinal,
      clean(asset.type),
      asset.displayText,
      asset.fromTeam,
      asset.toTeam,
    ].join("|"))}`;
    fieldDerivedSyntheticAssetIdsAdded += 1;
    return asset;
  });

  const ids = normalized.map((asset) => clean(asset.assetId));
  assert(ids.every(Boolean), `${packageItem.packageId}: canonical asset ID missing.`);
  assert(new Set(ids).size === ids.length, `${packageItem.packageId}: duplicate canonical asset ID.`);

  const normalizedRelationships = relationships.map((relationship) => {
    let assetReference = relationshipAssetOverride.get(relationship.relationshipId) ??
      clean(relationship.assetReference);

    if (!normalized.some((asset) => clean(asset.assetId) === assetReference)) {
      const candidates = normalized.filter((asset) =>
        assetMatchesRelationship(asset, relationship)
      );
      assert(
        candidates.length === 1,
        `${packageItem.packageId}/${relationship.relationshipId}: relationship matched ${candidates.length} canonical assets.`
      );
      assetReference = candidates[0].assetId;
    }

    return {
      ...relationship,
      assetReference,
      sourceAssetId: clean(relationship.sourceAssetId) || null,
      privateOnly: true,
      relationshipWriteAuthorized: true,
      importedBy: "brooklyn-nets-phase-5h",
    };
  });

  return {
    assets: normalized,
    relationships: normalizedRelationships,
    relationshipBackedSyntheticAssetIdsAdded,
    fieldDerivedSyntheticAssetIdsAdded,
  };
}
function sourceReference(relationship, packageItem, trade) {
  return {
    relationshipId: relationship.relationshipId,
    referenceType: relationshipReferenceType(relationship.relationshipRole),
    relationshipRole: relationship.relationshipRole,
    tradeId: packageItem.targetCanonicalId,
    canonicalTradeId: packageItem.targetCanonicalId,
    tradeSlug: tradeSlug(trade),
    assetId: relationship.assetReference,
    assetReference: relationship.assetReference,
    sourceAssetId: relationship.sourceAssetId,
    sourceTradeId: packageItem.sourceTradeId,
    packageId: packageItem.packageId,
    sourceTeam: "brooklyn-nets",
    privateOnly: true,
  };
}
function appendRelationshipReference(player, reference) {
  const references = [
    ...(Array.isArray(player.relationshipReferences) ? player.relationshipReferences : []),
  ];
  const byId = new Map(references.map((item) => [clean(item.relationshipId), item]));
  if (!byId.has(reference.relationshipId)) references.push(reference);

  return {
    ...player,
    aliases: Array.isArray(player.aliases) ? player.aliases : [],
    referenceTypes: uniqueSorted([
      ...(Array.isArray(player.referenceTypes) ? player.referenceTypes : []),
      clean(reference.referenceType),
    ]),
    tradeIds: uniqueSorted([
      ...(Array.isArray(player.tradeIds) ? player.tradeIds : []),
      reference.tradeId,
    ]),
    tradeSlugs: uniqueSorted([
      ...(Array.isArray(player.tradeSlugs) ? player.tradeSlugs : []),
      reference.tradeSlug,
    ]),
    relationshipReferences: references,
    updatedAt: player.updatedAt,
  };
}
function createPlayerShell(shell, importedAt) {
  const payload = shell.playerPayload;
  return {
    ...payload,
    id: payload.id,
    playerId: payload.id,
    slug: payload.slug,
    displayName: payload.displayName,
    name: payload.displayName,
    fullName: payload.displayName,
    playerName: payload.displayName,
    league: "nba",
    aliases: Array.isArray(payload.aliases) ? payload.aliases : [],
    referenceTypes: [],
    tradeIds: [],
    tradeSlugs: [],
    relationshipReferences: [],
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-shell-imported-nets-phase-5h",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    createdAt: payload.createdAt ?? importedAt,
    updatedAt: importedAt,
  };
}
function buildNewTrade(packageItem, normalized, importedAt) {
  const canonical = packageItem.canonicalPayload;
  assert(canonical, `${packageItem.packageId}: canonical payload missing.`);
  const perspectives = (canonical.perspectives ?? packageItem.perspectives ?? [])
    .map(normalizePerspective);
  assert(perspectives.some((item) => perspectiveTeam(item) === "brooklyn-nets"), `${packageItem.packageId}: Nets perspective missing.`);

  const teams = uniqueSorted(canonical.teams ?? packageItem.teams ?? []);
  const sourceTeams = uniqueSorted(perspectives.map(perspectiveTeam));
  const primary = perspectives.find((item) => perspectiveTeam(item) === "brooklyn-nets") ?? perspectives[0];

  return {
    id: packageItem.targetCanonicalId,
    tradeId: packageItem.targetCanonicalId,
    sourceTradeId: packageItem.sourceTradeId,
    canonicalKey: packageItem.targetCanonicalId,
    slug: clean(canonical.slug) || packageItem.targetCanonicalId.replace(/^nba-trade-/u, ""),
    league: "nba",
    tradeDate: canonical.tradeDate,
    date: canonical.tradeDate,
    seasonLabel: canonical.seasonLabel,
    season: Number(String(canonical.seasonLabel ?? canonical.tradeDate).slice(0, 4)),
    teams,
    assetsReceived: assetsByTeam(teams, normalized.assets, "received"),
    assetsSent: assetsByTeam(teams, normalized.assets, "sent"),
    assetLedger: normalized.assets,
    sourceTeams,
    perspectives,
    grades: mergedGrades(perspectives),
    verdict: primary?.verdict ?? "",
    summary: primary?.summary ?? "",
    analysis: primary?.analysis ?? "",
    confidence: primary?.confidence ?? "high",
    tier: "standard",
    sources: perspectives.map((perspective) => ({
      sourceType: "reviewed_private_batch",
      sourceTeam: perspective.sourceTeam,
      sourceBatchId: perspective.sourceBatchId,
      sourceTradeId: perspective.sourceTradeId,
      privateOnly: true,
    })),
    perspectiveReconciliations: [{
      sourceBatchId: "brooklyn-nets-phase-5g",
      packageId: packageItem.packageId,
      method: packageItem.canonicalIdentityStatus,
      importedAt,
      automaticMerge: false,
    }],
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-imported-nets-phase-5h",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}
function appendPerspective(existingTrade, packageItem, normalized, importedAt) {
  const before = immutablePerspectiveProjection(existingTrade);
  const perspective = normalizePerspective(packageItem.perspectivePayload);
  assert(perspective.sourceTeam === "brooklyn-nets", `${packageItem.packageId}: appended perspective is not Brooklyn.`);
  const existingPerspectives = Array.isArray(existingTrade.perspectives)
    ? existingTrade.perspectives
    : [];
  assert(
    !existingPerspectives.some((item) => perspectiveTeam(item) === "brooklyn-nets"),
    `${packageItem.packageId}: Brooklyn perspective already exists.`
  );

  const teams = uniqueSorted(existingTrade.teams ?? packageItem.teams ?? []);
  const updated = {
    ...existingTrade,
    sourceTeams: uniqueSorted([
      ...(Array.isArray(existingTrade.sourceTeams) ? existingTrade.sourceTeams : []),
      "brooklyn-nets",
    ]),
    perspectives: [...existingPerspectives, perspective],
    grades: mergedGrades([perspective], existingTrade.grades),
    assetLedger: normalized.assets,
    assetsReceived: assetsByTeam(teams, normalized.assets, "received"),
    assetsSent: assetsByTeam(teams, normalized.assets, "sent"),
    perspectiveReconciliations: [
      ...(Array.isArray(existingTrade.perspectiveReconciliations)
        ? existingTrade.perspectiveReconciliations
        : []),
      {
        sourceBatchId: "brooklyn-nets-phase-5g",
        sourceTradeId: packageItem.sourceTradeId,
        packageId: packageItem.packageId,
        method: "unique-existing-canonical-semantic-match",
        importedAt,
        automaticMerge: false,
      },
    ],
    publishStatus: "private",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    updatedAt: importedAt,
  };

  assert(
    JSON.stringify(before) === JSON.stringify(immutablePerspectiveProjection(updated)),
    `${packageItem.packageId}: perspective append altered protected canonical identity fields.`
  );
  return updated;
}

const args = parseArgs(process.argv);
for (const required of [
  "phase5e-freeze",
  "phase5f-freeze",
  "phase5g-resolution",
  "trades-json",
  "players-json",
  "teams-json",
  "lineage-json",
  "receipt-json",
  "expected-trade-store-sha256",
  "expected-player-store-sha256",
  "expected-team-store-sha256",
  "expected-package-records-sha256",
  "expected-relationship-records-sha256",
  "expected-import-partition-sha256",
  "imported-at",
  "starting-head",
]) assert(args[required], `Missing --${required}`);

const [
  phase5EBytes,
  phase5FBytes,
  phase5GBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  lineageBytes,
] = await Promise.all([
  readFile(args["phase5e-freeze"]),
  readFile(args["phase5f-freeze"]),
  readFile(args["phase5g-resolution"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["lineage-json"]),
]);

const phase5E = JSON.parse(phase5EBytes.toString("utf8"));
const phase5F = JSON.parse(phase5FBytes.toString("utf8"));
const phase5G = JSON.parse(phase5GBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const receiptPath = path.resolve(args["receipt-json"]);

assert(phase5E.result === "PASS" && phase5E.phase === "5E", "Invalid Phase 5E source.");
assert(phase5F.result === "PASS" && phase5F.phase === "5F", "Invalid Phase 5F source.");
assert(phase5G.result === "PASS" && phase5G.phase === "5G", "Invalid Phase 5G source.");
assert(Array.isArray(trades) && trades.length >= 456, "Canonical store is invalid.");
assert(Array.isArray(players) && players.length >= 883, "Player store is invalid.");
assert(Array.isArray(teams) && teams.length >= 41, "Team store is invalid.");
assert(lineage && typeof lineage === "object", "Historical lineage is invalid.");
assert(phase5G.finalPackageRecordsSha256 === args["expected-package-records-sha256"], "Frozen package hash drifted.");
assert(phase5G.finalRelationshipRecordsSha256 === args["expected-relationship-records-sha256"], "Frozen relationship hash drifted.");
assert(phase5G.importPartitionSha256 === args["expected-import-partition-sha256"], "Frozen import partition drifted.");
assert(phase5G.readyPackages === 205 && phase5G.heldPackages === 3, "Ready/held partition drifted.");
assert(phase5G.readyCanonicalCreatePackages === 201, "Ready canonical-create count drifted.");
assert(phase5G.readyPerspectiveAppendPackages === 4, "Ready perspective count drifted.");
assert(phase5G.readyPlayerShellPackages === 296, "Ready player-shell count drifted.");
assert(phase5G.readyRelationshipPreviews === 474, "Ready relationship count drifted.");

let existingReceipt = null;
try {
  existingReceipt = JSON.parse((await readFile(receiptPath)).toString("utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (existingReceipt) {
  const currentTradeHash = sha256(tradeBytes);
  const currentPlayerHash = sha256(playerBytes);
  const currentTeamHash = sha256(teamBytes);
  assert(existingReceipt.result === "PASS" && existingReceipt.phase === "5H", "Existing receipt is invalid.");
  assert(existingReceipt.canonicalStoreSha256 === currentTradeHash, "Replay canonical hash differs from receipt.");
  assert(existingReceipt.playerStoreSha256 === currentPlayerHash, "Replay player hash differs from receipt.");
  assert(existingReceipt.teamStoreSha256 === currentTeamHash, "Replay team hash differs from receipt.");
  assert(existingReceipt.readyPackages === 205 && existingReceipt.heldPackages === 3, "Replay receipt partition drifted.");

  console.log(JSON.stringify({
    result: "PASS",
    phase: "5H",
    mode: "IDEMPOTENT_REPLAY",
    readyPackages: existingReceipt.readyPackages,
    heldPackages: existingReceipt.heldPackages,
    canonicalTradesCreated: existingReceipt.canonicalTradesCreated,
    perspectivesAppended: existingReceipt.perspectivesAppended,
    playerShellsCreated: existingReceipt.playerShellsCreated,
    relationshipReferencesAdded: existingReceipt.relationshipReferencesAdded,
    postImportCanonicalTrades: existingReceipt.postImportCanonicalTrades,
    postImportPlayers: existingReceipt.postImportPlayers,
    postImportTeams: existingReceipt.postImportTeams,
    teamRegistryEntriesAdded: existingReceipt.teamRegistryEntriesAdded,
    repositoryDataWrites: 0,
    canonicalStoreSha256: currentTradeHash,
    playerStoreSha256: currentPlayerHash,
    teamStoreSha256: currentTeamHash,
    receiptSha256: sha256(canonicalJson(existingReceipt)),
  }, null, 2));
  process.exit(0);
}

const normalizedTradePreimageBytes = lfNormalizedUtf8Bytes(tradeBytes, "Canonical store");
const normalizedPlayerPreimageBytes = lfNormalizedUtf8Bytes(playerBytes, "Player store");
const normalizedTeamPreimageBytes = lfNormalizedUtf8Bytes(teamBytes, "Team store");

assert(
  sha256(normalizedTradePreimageBytes).toUpperCase() ===
    args["expected-trade-store-sha256"].toUpperCase(),
  "Canonical store LF-normalized preimage hash mismatch."
);
assert(
  sha256(normalizedPlayerPreimageBytes).toUpperCase() ===
    args["expected-player-store-sha256"].toUpperCase(),
  "Player store LF-normalized preimage hash mismatch."
);
assert(
  sha256(normalizedTeamPreimageBytes).toUpperCase() ===
    args["expected-team-store-sha256"].toUpperCase(),
  "Team store LF-normalized preimage hash mismatch."
);
assert(trades.length === 456, `Expected 456 pre-import trades, found ${trades.length}.`);
assert(players.length === 883, `Expected 883 pre-import players, found ${players.length}.`);
assert(teams.length === 41, `Expected 41 pre-import teams, found ${teams.length}.`);

const readyPackages = phase5G.finalPackages.filter((item) => item.phase5GEligibility?.ready === true);
const heldPackages = phase5G.finalPackages.filter((item) => item.phase5GEligibility?.held === true);
assert(readyPackages.length === 205 && heldPackages.length === 3, "Final package partition mismatch.");

const readyPackageIds = new Set(readyPackages.map((item) => item.packageId));
const relationships = phase5G.allRelationshipRecords.filter((item) =>
  readyPackageIds.has(item.packageId)
);
assert(relationships.length === 474, `Expected 474 ready relationships, found ${relationships.length}.`);

const shellPackages = phase5G.readyPlayerShellPackageRecords;
assert(Array.isArray(shellPackages) && shellPackages.length === 296, "Ready shell package count drifted.");

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
assert(tradeMap.size === trades.length, "Duplicate pre-import trade ID.");
assert(playerMap.size === players.length, "Duplicate pre-import player ID.");

for (const shell of shellPackages) {
  const id = clean(shell.playerPayload?.id);
  assert(id && !playerMap.has(id), `Player-shell target already exists: ${id}`);
  playerMap.set(id, createPlayerShell(shell, args["imported-at"]));
}

const relationshipsByPackage = new Map();
for (const relationship of relationships) {
  if (!relationshipsByPackage.has(relationship.packageId)) {
    relationshipsByPackage.set(relationship.packageId, []);
  }
  relationshipsByPackage.get(relationship.packageId).push(relationship);
}

const importedTrades = [];
const perspectiveUpdatedIds = [];
const importedRelationships = [];
let relationshipBackedSyntheticAssetIdsAdded = 0;
let fieldDerivedSyntheticAssetIdsAdded = 0;

for (const packageItem of readyPackages) {
  const packageRelationships = relationshipsByPackage.get(packageItem.packageId) ?? [];
  let sourceAssets;
  let existingTrade = null;

  if (packageItem.packageType === "canonical-create") {
    sourceAssets = packageItem.canonicalPayload?.assetLedger ?? [];
    assert(sourceAssets.length > 0, `${packageItem.packageId}: canonical-create package lacks assets.`);
  } else {
    assert(packageItem.packageType === "perspective-append", `${packageItem.packageId}: unsupported ready package type.`);
    existingTrade = tradeMap.get(packageItem.targetCanonicalId);
    assert(existingTrade, `${packageItem.packageId}: perspective target does not exist.`);
    sourceAssets = flattenAssets(existingTrade);
    assert(sourceAssets.length > 0, `${packageItem.packageId}: existing target lacks assets.`);
  }

  const normalized = normalizePackageAssets(packageItem, sourceAssets, packageRelationships);
  relationshipBackedSyntheticAssetIdsAdded += normalized.relationshipBackedSyntheticAssetIdsAdded;
  fieldDerivedSyntheticAssetIdsAdded += normalized.fieldDerivedSyntheticAssetIdsAdded;

  let importedTrade;
  if (packageItem.packageType === "canonical-create") {
    assert(!tradeMap.has(packageItem.targetCanonicalId), `${packageItem.packageId}: canonical target already exists.`);
    importedTrade = buildNewTrade(packageItem, normalized, args["imported-at"]);
    tradeMap.set(importedTrade.id, importedTrade);
    importedTrades.push(importedTrade);
  } else {
    importedTrade = appendPerspective(existingTrade, packageItem, normalized, args["imported-at"]);
    tradeMap.set(packageItem.targetCanonicalId, importedTrade);
    perspectiveUpdatedIds.push(packageItem.targetCanonicalId);
  }

  for (const relationship of normalized.relationships) {
    const player = playerMap.get(clean(relationship.playerId));
    assert(player, `${relationship.relationshipId}: player target does not exist: ${relationship.playerId}`);
    const reference = sourceReference(relationship, packageItem, importedTrade);
    playerMap.set(referencePlayerId(relationship), appendRelationshipReference(player, reference));
    importedRelationships.push({
      ...relationship,
      targetCanonicalId: packageItem.targetCanonicalId,
      assetReference: reference.assetId,
    });
  }
}
function referencePlayerId(relationship) {
  return clean(relationship.playerId);
}

assert(importedTrades.length === 201, `Expected 201 new canonical trades, found ${importedTrades.length}.`);
assert(perspectiveUpdatedIds.length === 4, `Expected 4 perspective appends, found ${perspectiveUpdatedIds.length}.`);
assert(importedRelationships.length === 474, `Expected 474 imported relationships, found ${importedRelationships.length}.`);
assert(playerMap.size === 1179, `Expected 1179 post-import players, found ${playerMap.size}.`);
assert(tradeMap.size === 657, `Expected 657 post-import trades, found ${tradeMap.size}.`);

const finalTrades = [...tradeMap.values()];
const finalPlayers = [...playerMap.values()];

const importedPlayerIdSet = new Set(
  shellPackages.map((item) => clean(item.playerPayload?.id)).filter(Boolean)
);
for (const id of importedPlayerIdSet) {
  const player = playerMap.get(id);
  assert(player, `${id}: imported player shell disappeared before write.`);
  assert(Array.isArray(player.aliases), `${id}: imported player aliases must be an array.`);
  assert(
    Array.isArray(player.referenceTypes),
    `${id}: imported player referenceTypes must be an array.`
  );
  assert(
    Array.isArray(player.relationshipReferences),
    `${id}: imported player relationshipReferences must be an array.`
  );
}
for (const relationship of importedRelationships) {
  const player = playerMap.get(clean(relationship.playerId));
  assert(player, `${relationship.relationshipId}: imported relationship owner disappeared.`);
  const expectedReferenceType = relationshipReferenceType(relationship.relationshipRole);
  assert(
    Array.isArray(player.referenceTypes) &&
      player.referenceTypes.includes(expectedReferenceType),
    `${relationship.relationshipId}: player referenceTypes lacks ${expectedReferenceType}.`
  );
  assert(
    Array.isArray(player.relationshipReferences) &&
      player.relationshipReferences.some(
        (reference) => clean(reference.relationshipId) === relationship.relationshipId
      ),
    `${relationship.relationshipId}: player relationship reference is missing.`
  );
}

const teamRegistration = registerMissingHistoricalTeams(
  finalTrades,
  teams,
  lineage,
  args["imported-at"],
);
const finalTeams = teamRegistration.teams;
assert(
  teamRegistration.registrations.length > 0,
  "Expected at least one frozen historical team missing from the 41-team registry."
);
const tradeOut = canonicalJson(finalTrades);
const playerOut = canonicalJson(finalPlayers);
const teamOut = canonicalJson(finalTeams);

const heldCanonicalTradeIds = heldPackages
  .filter((item) => item.packageType === "canonical-create")
  .map((item) => item.targetCanonicalId)
  .filter(Boolean)
  .sort();

const receipt = {
  result: "PASS",
  phase: "5H",
  mode: "FIRST_IMPORT",
  batchId: "brooklyn-nets-phase-5h",
  startingHead: args["starting-head"],
  importedAt: args["imported-at"],
  sourceHashes: {
    phase5EFileSha256: sha256(phase5EBytes),
    phase5FFileSha256: sha256(phase5FBytes),
    phase5GFileSha256: sha256(phase5GBytes),
    finalPackageRecordsSha256: phase5G.finalPackageRecordsSha256,
    finalRelationshipRecordsSha256: phase5G.finalRelationshipRecordsSha256,
    importPartitionSha256: phase5G.importPartitionSha256,
    preImportCanonicalStoreSha256: sha256(normalizedTradePreimageBytes),
    preImportCanonicalStoreRawSha256: sha256(tradeBytes),
    preImportPlayerStoreSha256: sha256(normalizedPlayerPreimageBytes),
    preImportPlayerStoreRawSha256: sha256(playerBytes),
    preImportTeamStoreSha256: sha256(normalizedTeamPreimageBytes),
    preImportTeamStoreRawSha256: sha256(teamBytes),
    historicalLineageSha256: sha256(lineageBytes),
  },
  preImportCanonicalTrades: trades.length,
  preImportPlayers: players.length,
  preImportTeams: teams.length,
  readyPackages: readyPackages.length,
  heldPackages: heldPackages.length,
  canonicalTradesCreated: importedTrades.length,
  perspectivesAppended: perspectiveUpdatedIds.length,
  playerShellsCreated: shellPackages.length,
  relationshipReferencesAdded: importedRelationships.length,
  relationshipBackedSyntheticAssetIdsAdded,
  fieldDerivedSyntheticAssetIdsAdded,
  postImportCanonicalTrades: finalTrades.length,
  postImportPlayers: finalPlayers.length,
  postImportTeams: finalTeams.length,
  teamRegistryEntriesAdded: teamRegistration.registrations.length,
  registeredHistoricalTeamSlugs: teamRegistration.missingSlugs,
  teamRegistryRegistrations: teamRegistration.registrations,
  readyPackageIds: uniqueSorted([...readyPackageIds]),
  heldPackageIds: uniqueSorted(heldPackages.map((item) => item.packageId)),
  importedCanonicalTradeIds: uniqueSorted(importedTrades.map((trade) => trade.id)),
  updatedPerspectiveCanonicalIds: uniqueSorted(perspectiveUpdatedIds),
  importedPlayerIds: uniqueSorted(shellPackages.map((item) => item.playerPayload.id)),
  relationshipIds: uniqueSorted(importedRelationships.map((item) => item.relationshipId)),
  heldCanonicalTradeIds,
  canonicalStoreSha256: sha256(tradeOut),
  playerStoreSha256: sha256(playerOut),
  teamStoreSha256: sha256(teamOut),
  repositoryDataWrites: 4,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};
const receiptOut = canonicalJson(receipt);

await atomicWrite(args["trades-json"], tradeOut, "phase5h-trades");
await atomicWrite(args["players-json"], playerOut, "phase5h-players");
await atomicWrite(args["teams-json"], teamOut, "phase5h-teams");
await atomicWrite(receiptPath, receiptOut, "phase5h-receipt");

console.log(JSON.stringify({
  result: receipt.result,
  phase: receipt.phase,
  mode: receipt.mode,
  readyPackages: receipt.readyPackages,
  heldPackages: receipt.heldPackages,
  canonicalTradesCreated: receipt.canonicalTradesCreated,
  perspectivesAppended: receipt.perspectivesAppended,
  playerShellsCreated: receipt.playerShellsCreated,
  relationshipReferencesAdded: receipt.relationshipReferencesAdded,
  relationshipBackedSyntheticAssetIdsAdded: receipt.relationshipBackedSyntheticAssetIdsAdded,
  fieldDerivedSyntheticAssetIdsAdded: receipt.fieldDerivedSyntheticAssetIdsAdded,
  postImportCanonicalTrades: receipt.postImportCanonicalTrades,
  postImportPlayers: receipt.postImportPlayers,
  postImportTeams: receipt.postImportTeams,
  teamRegistryEntriesAdded: receipt.teamRegistryEntriesAdded,
  registeredHistoricalTeamSlugs: receipt.registeredHistoricalTeamSlugs,
  repositoryDataWrites: receipt.repositoryDataWrites,
  canonicalStoreSha256: receipt.canonicalStoreSha256,
  playerStoreSha256: receipt.playerStoreSha256,
  teamStoreSha256: receipt.teamStoreSha256,
  receiptSha256: sha256(receiptOut),
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  automaticRoutes: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
