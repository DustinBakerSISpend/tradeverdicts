#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function lfNormalizedUtf8Bytes(bytes, label) {
  assert(
    !(bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
    `${label} contains an unexpected UTF-8 BOM.`,
  );
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
  return Buffer.from(text.replace(/\r\n?/gu, "\n"), "utf8");
}
function normalize(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/['’`"]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}
function slugify(value) {
  return normalize(value).replace(/\s+/gu, "-") || "unknown";
}
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
function uniqueSorted(values) {
  return unique(values).sort((left, right) =>
    String(left).localeCompare(String(right), "en"),
  );
}
function tradeId(trade) {
  return clean(trade.id ?? trade.tradeId);
}
function playerId(player) {
  return clean(player.id ?? player.playerId ?? player.slug ?? player.identity?.id);
}
function teamSlug(team) {
  return clean(team.slug ?? team.id ?? team.teamId);
}
function perspectiveTeam(perspective) {
  return clean(
    perspective.sourceTeam ??
      perspective.teamId ??
      perspective.team ??
      perspective.perspectiveTeam,
  );
}
function titleCaseSlug(slug) {
  return clean(slug)
    .split("-")
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 && /^[a-z]+$/u.test(word)
        ? word.toUpperCase()
        : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");
}
function lineageRules(lineage) {
  if (Array.isArray(lineage)) return lineage;
  for (const key of ["rules", "lineages", "entries", "historicalTeams"]) {
    if (Array.isArray(lineage?.[key])) return lineage[key];
  }
  return Object.values(lineage ?? {}).flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
}
function lineageRuleForSlug(slug, rules) {
  return (
    rules.find((rule) => clean(rule.id) === slug) ??
    rules.find((rule) => clean(rule.team) === slug) ??
    null
  );
}
function deriveCeasedOperations(rule) {
  const validTo = clean(rule?.validTo);
  return /^\d{4}-\d{2}-\d{2}$/u.test(validTo)
    ? Number(validTo.slice(0, 4))
    : null;
}
function abbreviationForSlug(slug, used) {
  const words = slug.split("-").filter(Boolean);
  let base = words.map((word) => word[0]?.toUpperCase()).join("").slice(0, 4);
  if (base.length < 2) {
    base = slug.replace(/[^a-z0-9]/giu, "").slice(0, 3).toUpperCase();
  }
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
function collectTradeTeamSlugs(trades) {
  const slugs = new Set();
  for (const trade of trades) {
    for (const value of Array.isArray(trade.teams) ? trade.teams : []) {
      if (clean(value)) slugs.add(clean(value));
    }
    for (const value of Array.isArray(trade.sourceTeams) ? trade.sourceTeams : []) {
      if (clean(value)) slugs.add(clean(value));
    }
    for (const value of Object.keys(trade.assetsReceived ?? {})) {
      if (clean(value)) slugs.add(clean(value));
    }
    for (const value of Object.keys(trade.assetsSent ?? {})) {
      if (clean(value)) slugs.add(clean(value));
    }
    for (const asset of Array.isArray(trade.assetLedger) ? trade.assetLedger : []) {
      if (clean(asset.fromTeam)) slugs.add(clean(asset.fromTeam));
      if (clean(asset.toTeam)) slugs.add(clean(asset.toTeam));
    }
  }
  return [...slugs].sort((left, right) => left.localeCompare(right, "en"));
}
function registerMissingHistoricalTeams(finalTrades, teams, lineage, importedAt) {
  const existingSlugs = new Set(teams.map(teamSlug).filter(Boolean));
  const missingSlugs = collectTradeTeamSlugs(finalTrades).filter(
    (slug) => !existingSlugs.has(slug),
  );
  const rules = lineageRules(lineage);
  const usedAbbreviations = new Set(
    teams.map((team) => clean(team.abbreviation)).filter(Boolean),
  );

  const registrations = missingSlugs.map((slug) => {
    assert(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug),
      `Invalid historical team slug: ${slug}`,
    );
    const rule = lineageRuleForSlug(slug, rules);
    const label = clean(rule?.label) || titleCaseSlug(slug);
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
      registrySource: "chicago-bulls-phase-7h",
      registryEvidenceStatus: rule
        ? "historical-lineage-rule"
        : "frozen-ready-package-team",
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
  assert(
    new Set(finalSlugs).size === finalSlugs.length,
    "Duplicate team registry slug.",
  );
  const finalSet = new Set(finalSlugs);
  assert(
    collectTradeTeamSlugs(finalTrades).every((slug) => finalSet.has(slug)),
    "A post-import trade team is absent from the team registry.",
  );

  return { teams: finalTeams, registrations, missingSlugs };
}
function inferAssetType(value) {
  const text = normalize(value);
  if (/\bcash\b/u.test(text)) return "cash";
  if (/\b(?:trade exception|traded player exception|tpe)\b/u.test(text)) {
    return "trade_exception";
  }
  if (/\b(?:swap|option to swap)\b/u.test(text)) return "draft_swap";
  if (/\b(?:draft rights|rights to)\b/u.test(text)) return "draft_rights";
  if (/\b(?:first round|second round|third round|fourth round|draft pick|pick)\b/u.test(text)) {
    return "draft_pick";
  }
  if (/\b(?:future considerations|conditional consideration)\b/u.test(text)) {
    return "consideration";
  }
  return "player";
}
function canonicalTradeId(sourceTradeId) {
  return `nba-trade-${clean(sourceTradeId).toLowerCase()}`;
}
function seasonStartYear(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= 6 ? year : year - 1;
}
function seasonLabel(date) {
  const start = seasonStartYear(date);
  return `${start}-${String(start + 1).slice(-2)}`;
}
function assetId(sourceTradeId, edge, ordinal) {
  return `phase7h-asset-${sha256([
    sourceTradeId,
    ordinal,
    clean(edge.assetType ?? edge.type),
    clean(edge.asset ?? edge.displayText),
    clean(edge.fromTeam),
    clean(edge.toTeam),
  ].join("|")).slice(0, 20).toLowerCase()}`;
}
function assetsByTeam(teams, assets, direction) {
  return Object.fromEntries(
    teams.map((team) => [
      team,
      assets.filter((asset) =>
        direction === "received"
          ? clean(asset.toTeam) === team
          : clean(asset.fromTeam) === team,
      ),
    ]),
  );
}
function reviewedPerspective(record, teams) {
  const grades = { ...(record.grades ?? {}) };
  for (const team of teams.filter((team) => team !== "chicago-bulls")) {
    if (!clean(grades[team]) && clean(grades.partnerAggregate)) {
      grades[team] = clean(grades.partnerAggregate);
    }
  }
  return {
    sourceTeam: "chicago-bulls",
    sourceBatchId: "chicago-bulls-phase-7a",
    sourceTradeId: record.sourceTradeId,
    sourcePerspectiveKey: `chicago-bulls:${record.sourceTradeId}`,
    summary: record.summary,
    analysis: record.analysis,
    verdict: record.verdict,
    grades,
    aggregatePartnerGrade: clean(grades.partnerAggregate) || null,
    confidence: clean(record.confidence).toLowerCase(),
    reviewStatus: record.reviewStatus,
    contentClass: record.contentClass,
    lowValueRisk: record.lowValueRisk,
    privateOnly: true,
    publishStatus: "private",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  };
}

const ROUTING_ENDPOINT_OVERRIDES = new Map([
  ["CHI-1992-0117:multi-team-package", "dallas-mavericks"],
  ["CHI-2026-0219:four-team-package", "minnesota-timberwolves"],
]);
function resolveRoutingEndpoint(sourceTradeId, endpoint, participants) {
  const value = clean(endpoint);
  if (participants.includes(value)) return value;
  const replacement = ROUTING_ENDPOINT_OVERRIDES.get(`${sourceTradeId}:${value}`);
  assert(
    replacement && participants.includes(replacement),
    `${sourceTradeId}: unresolved routing endpoint ${value}.`,
  );
  return replacement;
}

function routeAssets(record, routingTransaction) {
  if (routingTransaction) {
    assert(routingTransaction.routingComplete === true, `${record.sourceTradeId}: routing is incomplete.`);
    assert(
      JSON.stringify(routingTransaction.sourceAssetsReceived) === JSON.stringify(record.assetsReceived),
      `${record.sourceTradeId}: routed incoming assets differ from reviewed source.`,
    );
    assert(
      JSON.stringify(routingTransaction.sourceAssetsSent) === JSON.stringify(record.assetsSent),
      `${record.sourceTradeId}: routed outgoing assets differ from reviewed source.`,
    );
    const participants = uniqueSorted(routingTransaction.teams);
    return routingTransaction.bullsFacingRouteEdges.map((edge, index) => {
      const fromTeam = resolveRoutingEndpoint(
        record.sourceTradeId,
        edge.fromTeam,
        participants,
      );
      const toTeam = resolveRoutingEndpoint(
        record.sourceTradeId,
        edge.toTeam,
        participants,
      );
      const overrideApplied =
        fromTeam !== clean(edge.fromTeam) ||
        toTeam !== clean(edge.toTeam);
      return {
        assetId: assetId(
          record.sourceTradeId,
          { ...edge, fromTeam, toTeam },
          index + 1,
        ),
        type: inferAssetType(edge.asset),
        displayText: clean(edge.asset),
        asset: clean(edge.asset),
        fromTeam,
        toTeam,
        direction: clean(edge.direction),
        edgeClass: overrideApplied
          ? "reviewed-bulls-facing-route-with-frozen-endpoint-override"
          : "reviewed-bulls-facing-route",
        routingStatus: "resolved",
        originalFromTeam: overrideApplied ? clean(edge.fromTeam) : null,
        originalToTeam: overrideApplied ? clean(edge.toTeam) : null,
        possibleFromTeams: [],
        possibleToTeams: [],
        privateOnly: true,
      };
    });
  }

  assert(record.partnerTeams.length === 1, `${record.sourceTradeId}: two-team trade must have one partner.`);
  const partner = record.partnerTeams[0];
  const edges = [
    ...record.assetsReceived.map((asset) => ({
      asset,
      fromTeam: partner,
      toTeam: "chicago-bulls",
      direction: "incoming-to-chicago",
    })),
    ...record.assetsSent.map((asset) => ({
      asset,
      fromTeam: "chicago-bulls",
      toTeam: partner,
      direction: "outgoing-from-chicago",
    })),
  ];
  return edges.map((edge, index) => ({
    assetId: assetId(record.sourceTradeId, edge, index + 1),
    type: inferAssetType(edge.asset),
    displayText: clean(edge.asset),
    asset: clean(edge.asset),
    fromTeam: clean(edge.fromTeam),
    toTeam: clean(edge.toTeam),
    direction: edge.direction,
    edgeClass: "two-team-route",
    routingStatus: "resolved",
    possibleFromTeams: [],
    possibleToTeams: [],
    privateOnly: true,
  }));
}
function parseDependencyOrdinal(dependencySeedKey) {
  const match = clean(dependencySeedKey).match(/:(incoming|outgoing):(\d{2,3}):/u);
  return match ? { direction: match[1], ordinal: Number(match[2]) } : null;
}
function relationshipAsset(assets, relationship) {
  const expectedDirection =
    relationship.direction === "incoming"
      ? "incoming-to-chicago"
      : "outgoing-from-chicago";
  const directionAssets = assets.filter(
    (asset) => asset.direction === expectedDirection,
  );
  assert(directionAssets.length > 0, `${relationship.relationshipEdgeKey}: no assets exist for ${relationship.direction}.`);

  const rawNeedle = normalize(relationship.assetText);
  const exact = directionAssets.filter(
    (asset) => normalize(asset.displayText) === rawNeedle,
  );
  if (exact.length === 1) return exact[0];

  const fuzzyContained = directionAssets.filter((asset) => {
    const display = normalize(asset.displayText);
    return display.includes(rawNeedle) || rawNeedle.includes(display);
  });
  if (fuzzyContained.length === 1) return fuzzyContained[0];

  const parsed = parseDependencyOrdinal(relationship.dependencySeedKey);
  if (
    parsed &&
    parsed.direction === relationship.direction &&
    parsed.ordinal >= 1 &&
    parsed.ordinal <= directionAssets.length
  ) {
    return directionAssets[parsed.ordinal - 1];
  }

  throw new Error(`${relationship.relationshipEdgeKey}: could not select one canonical asset.`);
}
function relationshipRole(asset) {
  const text = normalize(`${asset.type} ${asset.displayText}`);
  if (asset.type === "draft_rights" || /\bright(s)?\b/u.test(text)) {
    return "draft-rights-player";
  }
  if (
    asset.type === "draft_pick" &&
    (/#\d+/u.test(asset.displayText) ||
      /\b(?:became|used on|later used on)\b/u.test(text))
  ) {
    return "pick-became-player";
  }
  return "traded-player";
}
function relationshipReferenceType(role) {
  if (role === "traded-player") return "direct_player";
  if (role === "draft-rights-player") return "draft_rights";
  if (role === "pick-became-player") return "draft_outcome";
  return "player_reference";
}
function createPlayerShell(shell, slug, importedAt) {
  return {
    id: shell.proposedPlayerId,
    playerId: shell.proposedPlayerId,
    slug,
    displayName: shell.displayName,
    name: shell.displayName,
    fullName: shell.displayName,
    playerName: shell.displayName,
    league: "nba",
    aliases: [],
    referenceTypes: [],
    tradeIds: [],
    tradeSlugs: [],
    relationshipReferences: [],
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-shell-imported-chicago-phase-7h",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}
function appendRelationshipReference(player, reference) {
  const references = [
    ...(Array.isArray(player.relationshipReferences)
      ? player.relationshipReferences
      : []),
  ];
  if (!references.some((item) => clean(item.relationshipId) === reference.relationshipId)) {
    references.push(reference);
  }
  return {
    ...player,
    aliases: Array.isArray(player.aliases) ? player.aliases : [],
    referenceTypes: uniqueSorted([
      ...(Array.isArray(player.referenceTypes) ? player.referenceTypes : []),
      reference.referenceType,
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
function countTeamMemberships(trades) {
  return trades.reduce(
    (sum, trade) => sum + (Array.isArray(trade.teams) ? trade.teams.length : 0),
    0,
  );
}
function countPlayerTradeReferences(players) {
  return players.reduce(
    (sum, player) => sum + (Array.isArray(player.tradeIds) ? player.tradeIds.length : 0),
    0,
  );
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

const args = parseArgs(process.argv);
for (const required of [
  "phase7g-resolution",
  "reviewed-json",
  "routing-json",
  "trades-json",
  "players-json",
  "teams-json",
  "lineage-json",
  "receipt-json",
  "contract-md",
  "expected-trade-store-sha256",
  "expected-player-store-sha256",
  "expected-team-store-sha256",
  "expected-final-package-sha256",
  "expected-resolution-records-sha256",
  "expected-proposed-shells-sha256",
  "expected-relationship-previews-sha256",
  "expected-import-partition-sha256",
  "starting-head",
  "imported-at",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  resolutionBytes,
  reviewedBytes,
  routingBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  lineageBytes,
  contractBytes,
] = await Promise.all([
  readFile(args["phase7g-resolution"]),
  readFile(args["reviewed-json"]),
  readFile(args["routing-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["lineage-json"]),
  readFile(args["contract-md"]),
]);

const resolution = JSON.parse(resolutionBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const receiptPath = path.resolve(args["receipt-json"]);

assert(resolution.result === "PASS" && resolution.phase === "7G", "Invalid Phase 7G source.");
assert(reviewed.result === "PASS" && reviewed.phase === "7A", "Invalid reviewed batch.");
assert(routing.result === "PASS" && routing.phase === "7D", "Invalid routing source.");
assert(Array.isArray(trades), "Canonical trade store is invalid.");
assert(Array.isArray(players), "Player store is invalid.");
assert(Array.isArray(teams) && teams.length >= 50, "Team store is invalid.");
assert(lineage && typeof lineage === "object", "Historical lineage is invalid.");

for (const [field, expected] of [
  ["finalPackageRecordsSha256", args["expected-final-package-sha256"]],
  ["resolutionRecordsSha256", args["expected-resolution-records-sha256"]],
  ["proposedPlayerShellsSha256", args["expected-proposed-shells-sha256"]],
  ["relationshipPreviewsSha256", args["expected-relationship-previews-sha256"]],
  ["importPartitionSha256", args["expected-import-partition-sha256"]],
]) {
  assert(resolution[field] === expected, `${field} differs from the frozen checkpoint.`);
}
assert(resolution.counts.finalReadyPackages === 173, "Ready-package count drifted.");
assert(resolution.counts.remainingHeldPackages === 14, "Identity-held count drifted.");
assert(resolution.counts.existingHeldRecords === 25, "Prior hold count drifted.");
assert(resolution.counts.excludedRecords === 7, "Excluded count drifted.");
assert(resolution.proposedPlayerShells.length === 218, "Proposed-shell count drifted.");
assert(resolution.relationshipPreviews.length === 349, "Relationship-preview count drifted.");

let existingReceipt = null;
try {
  existingReceipt = JSON.parse((await readFile(receiptPath)).toString("utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (existingReceipt) {
  const tradeHash = sha256(tradeBytes);
  const playerHash = sha256(playerBytes);
  const teamHash = sha256(teamBytes);
  assert(existingReceipt.result === "PASS" && existingReceipt.phase === "7H", "Existing receipt is invalid.");
  assert(existingReceipt.canonicalStoreSha256 === tradeHash, "Replay canonical hash differs from receipt.");
  assert(existingReceipt.playerStoreSha256 === playerHash, "Replay player hash differs from receipt.");
  assert(existingReceipt.teamStoreSha256 === teamHash, "Replay team hash differs from receipt.");
  console.log(JSON.stringify({
    result: "PASS",
    phase: "7H",
    mode: "IDEMPOTENT_REPLAY",
    readyPackages: existingReceipt.readyPackages,
    identityHeldPackages: existingReceipt.identityHeldPackages,
    priorHeldRecords: existingReceipt.priorHeldRecords,
    excludedRecords: existingReceipt.excludedRecords,
    canonicalTradesCreated: existingReceipt.canonicalTradesCreated,
    playerShellsCreated: existingReceipt.playerShellsCreated,
    relationshipReferencesAdded: existingReceipt.relationshipReferencesAdded,
    postImportCanonicalTrades: existingReceipt.postImportCanonicalTrades,
    postImportPlayers: existingReceipt.postImportPlayers,
    postImportTeams: existingReceipt.postImportTeams,
    teamRegistryEntriesAdded: existingReceipt.teamRegistryEntriesAdded,
    repositoryDataWrites: 0,
    canonicalStoreSha256: tradeHash,
    playerStoreSha256: playerHash,
    teamStoreSha256: teamHash,
    receiptSha256: sha256(canonicalJson(existingReceipt)),
  }, null, 2));
  process.exit(0);
}

assert(trades.length === 759, `Expected 759 pre-import trades, found ${trades.length}.`);
assert(players.length === 1292, `Expected 1,292 pre-import players, found ${players.length}.`);

const normalizedTradePreimage = lfNormalizedUtf8Bytes(tradeBytes, "Canonical store");
const normalizedPlayerPreimage = lfNormalizedUtf8Bytes(playerBytes, "Player store");
const normalizedTeamPreimage = lfNormalizedUtf8Bytes(teamBytes, "Team store");

assert(sha256(normalizedTradePreimage) === args["expected-trade-store-sha256"], "Canonical store LF-normalized preimage hash mismatch.");
assert(sha256(normalizedPlayerPreimage) === args["expected-player-store-sha256"], "Player store LF-normalized preimage hash mismatch.");
assert(sha256(normalizedTeamPreimage) === args["expected-team-store-sha256"], "Team store LF-normalized preimage hash mismatch.");

const readyPackageRecords = resolution.finalPackageRecords.filter(
  (record) => record.finalReady === true,
);
const identityHeldRecords = resolution.finalPackageRecords.filter(
  (record) => record.finalHeld === true,
);
assert(readyPackageRecords.length === 173, "Ready package partition mismatch.");
assert(identityHeldRecords.length === 14, "Identity-held partition mismatch.");

const reviewedById = new Map(
  reviewed.records.map((record) => [record.sourceTradeId, record]),
);
const routingById = new Map(
  routing.transactions.map((record) => [record.sourceTradeId, record]),
);
assert(reviewedById.size === 219, "Duplicate reviewed trade IDs.");
assert(routingById.size === 15, "Duplicate routing transaction IDs.");

const eligibleSourceIds = new Set(
  resolution.finalPackageRecords.map((record) => record.sourceTradeId),
);
const excludedSourceIds = reviewed.records
  .filter((record) => record.mergeExclude)
  .map((record) => record.sourceTradeId)
  .sort();
const priorHeldSourceIds = reviewed.records
  .filter(
    (record) =>
      !record.mergeExclude &&
      !eligibleSourceIds.has(record.sourceTradeId),
  )
  .map((record) => record.sourceTradeId)
  .sort();
assert(excludedSourceIds.length === 7, "Reviewed excluded count drifted.");
assert(priorHeldSourceIds.length === 25, "Reviewed prior-held count drifted.");

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
assert(tradeMap.size === trades.length, "Duplicate canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");

const existingSlugs = new Set(players.map((player) => clean(player.slug)).filter(Boolean));
const shellById = new Map();
const shellNameById = new Map();
const createdPlayerIds = [];

for (const shell of resolution.proposedPlayerShells) {
  const id = clean(shell.proposedPlayerId);
  assert(id, `${shell.proposedPlayerKey}: proposed player ID is missing.`);
  assert(!playerMap.has(id), `Player shell target already exists: ${id}`);
  let slug = id.startsWith("nba-player-")
    ? id.slice("nba-player-".length)
    : slugify(shell.displayName);
  if (existingSlugs.has(slug)) {
    slug = `${slug}-${sha256(shell.proposedPlayerKey).slice(0, 8).toLowerCase()}`;
  }
  assert(!existingSlugs.has(slug), `Player shell slug already exists: ${slug}`);
  existingSlugs.add(slug);
  shellById.set(id, shell);
  shellNameById.set(id, shell.displayName);
  playerMap.set(id, createPlayerShell(shell, slug, args["imported-at"]));
  createdPlayerIds.push(id);
}
assert(createdPlayerIds.length === 218, "Created player-shell count drifted.");

const relationshipsByTrade = new Map();
for (const relationship of resolution.relationshipPreviews) {
  if (!relationshipsByTrade.has(relationship.sourceTradeId)) {
    relationshipsByTrade.set(relationship.sourceTradeId, []);
  }
  relationshipsByTrade.get(relationship.sourceTradeId).push(relationship);
}

const importedTradeIds = [];
const importedRelationshipIds = [];
const importedSourceTradeIds = [];
const relationshipOwners = new Set();

for (const packageRecord of readyPackageRecords) {
  const source = reviewedById.get(packageRecord.sourceTradeId);
  assert(source, `Reviewed record missing: ${packageRecord.sourceTradeId}`);
  assert(source.mergeExclude === false, `${packageRecord.sourceTradeId}: linked follow-up cannot be imported.`);
  assert(source.databaseImportAuthorized === true, `${packageRecord.sourceTradeId}: database import is not authorized.`);
  assert(source.researchBeforePublic === false, `${packageRecord.sourceTradeId}: research status reopened.`);
  assert(source.reviewStatus !== "Needs Research", `${packageRecord.sourceTradeId}: research status reopened.`);

  const routingTransaction = routingById.get(packageRecord.sourceTradeId) ?? null;
  const teamsForTrade = routingTransaction
    ? uniqueSorted(routingTransaction.teams)
    : uniqueSorted(["chicago-bulls", ...source.partnerTeams]);
  assert(teamsForTrade.length === Number(source.declaredTeamCount), `${packageRecord.sourceTradeId}: team-count mismatch.`);
  assert(teamsForTrade.includes("chicago-bulls"), `${packageRecord.sourceTradeId}: Chicago team is missing.`);

  const assets = routeAssets(source, routingTransaction);
  assert(assets.length > 0, `${packageRecord.sourceTradeId}: no canonical assets.`);
  assert(
    assets.every(
      (asset) =>
        teamsForTrade.includes(asset.fromTeam) &&
        teamsForTrade.includes(asset.toTeam),
    ),
    `${packageRecord.sourceTradeId}: asset route references a non-participant.`,
  );
  assert(
    new Set(assets.map((asset) => asset.assetId)).size === assets.length,
    `${packageRecord.sourceTradeId}: duplicate asset IDs.`,
  );

  const canonicalId = canonicalTradeId(packageRecord.sourceTradeId);
  assert(!tradeMap.has(canonicalId), `${packageRecord.sourceTradeId}: canonical target exists.`);

  const packageRelationships =
    relationshipsByTrade.get(packageRecord.sourceTradeId) ?? [];
  for (const relationship of packageRelationships) {
    const asset = relationshipAsset(assets, relationship);
    const targetPlayerId = clean(relationship.targetPlayerKey);
    assert(targetPlayerId, `${relationship.relationshipEdgeKey}: player reference is unavailable.`);
    const player = playerMap.get(targetPlayerId);
    assert(player, `${relationship.relationshipEdgeKey}: target player does not exist: ${targetPlayerId}`);

    const role = relationshipRole(asset);
    const playerName =
      clean(shellNameById.get(targetPlayerId)) ||
      clean(player.displayName ?? player.fullName ?? player.name ?? targetPlayerId);

    if (role === "pick-became-player") {
      asset.becamePlayerName = playerName;
      asset.becamePlayerId = targetPlayerId;
    } else {
      asset.playerName = playerName;
      asset.playerId = targetPlayerId;
    }
    asset.playerRelationshipRole = role;

    const relationshipId = clean(relationship.relationshipEdgeKey);
    assert(!relationshipOwners.has(relationshipId), `Duplicate relationship reference: ${relationshipId}`);
    relationshipOwners.add(relationshipId);

    const reference = {
      relationshipId,
      referenceType: relationshipReferenceType(role),
      relationshipRole: role,
      tradeId: canonicalId,
      canonicalTradeId: canonicalId,
      tradeSlug: source.slug,
      assetId: asset.assetId,
      assetReference: asset.assetId,
      sourceAssetId: clean(relationship.dependencySeedKey) || null,
      sourceTradeId: packageRecord.sourceTradeId,
      packageId: `chicago-bulls-phase-7h-${packageRecord.sourceTradeId}`,
      sourceTeam: "chicago-bulls",
      privateOnly: true,
    };
    playerMap.set(targetPlayerId, appendRelationshipReference(player, reference));
    importedRelationshipIds.push(relationshipId);
  }

  const perspective = reviewedPerspective(source, teamsForTrade);
  const importedTrade = {
    id: canonicalId,
    tradeId: canonicalId,
    sourceTradeId: packageRecord.sourceTradeId,
    canonicalKey: canonicalId,
    slug: source.slug,
    league: "nba",
    tradeDate: source.tradeDate,
    date: source.tradeDate,
    datePrecision: source.datePrecision,
    seasonLabel: seasonLabel(source.tradeDate),
    season: seasonStartYear(source.tradeDate),
    teams: teamsForTrade,
    assetsReceived: assetsByTeam(teamsForTrade, assets, "received"),
    assetsSent: assetsByTeam(teamsForTrade, assets, "sent"),
    assetLedger: assets,
    sourceTeams: ["chicago-bulls"],
    perspectives: [perspective],
    grades: perspective.grades,
    verdict: perspective.verdict,
    summary: perspective.summary,
    analysis: perspective.analysis,
    confidence: perspective.confidence || "medium",
    tier: clean(source.tier) || "standard",
    tradeType: source.tradeType,
    routingRequired: source.routingRequired,
    routingNotes: source.canonicalRoutingNotes,
    partnerOnlyRoutingNotes:
      routingTransaction?.partnerOnlyLegs ?? [],
    sources: [
      {
        sourceType: "reviewed_private_batch",
        sourceTeam: "chicago-bulls",
        sourceBatchId: "chicago-bulls-phase-7a",
        sourceTradeId: packageRecord.sourceTradeId,
        privateOnly: true,
      },
      ...(clean(source.primaryOfficialSourceUrl)
        ? [{
            sourceType: "primary_transaction_source",
            url: clean(source.primaryOfficialSourceUrl),
            privateOnly: true,
          }]
        : []),
      ...(clean(source.secondaryAuthoritativeSourceUrl)
        ? [{
            sourceType: "secondary_authoritative_source",
            url: clean(source.secondaryAuthoritativeSourceUrl),
            privateOnly: true,
          }]
        : []),
    ],
    perspectiveReconciliations: [{
      sourceBatchId: "chicago-bulls-phase-7g",
      packageId: `chicago-bulls-phase-7h-${packageRecord.sourceTradeId}`,
      method: "frozen-ready-canonical-create",
      importedAt: args["imported-at"],
      automaticMerge: false,
    }],
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-imported-chicago-phase-7h",
    contentClass: source.contentClass,
    lowValueRisk: source.lowValueRisk,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    createdAt: args["imported-at"],
    updatedAt: args["imported-at"],
  };

  tradeMap.set(canonicalId, importedTrade);
  importedTradeIds.push(canonicalId);
  importedSourceTradeIds.push(packageRecord.sourceTradeId);
}

assert(importedTradeIds.length === 173, "Imported trade count drifted.");
assert(importedRelationshipIds.length === 349, "Imported relationship count drifted.");
assert(playerMap.size === 1510, `Expected 1,510 post-import players, found ${playerMap.size}.`);
assert(tradeMap.size === 932, `Expected 932 post-import trades, found ${tradeMap.size}.`);

const allHeldSourceIds = uniqueSorted([
  ...identityHeldRecords.map((record) => record.sourceTradeId),
  ...priorHeldSourceIds,
  ...excludedSourceIds,
]);
assert(allHeldSourceIds.length === 46, "Total untouched source-row count drifted.");
for (const sourceTradeId of allHeldSourceIds) {
  assert(
    !importedSourceTradeIds.includes(sourceTradeId),
    `Held or excluded source row was imported: ${sourceTradeId}`,
  );
}

const finalTrades = [...tradeMap.values()];
const finalPlayers = [...playerMap.values()];
const registration = registerMissingHistoricalTeams(
  finalTrades,
  teams,
  lineage,
  args["imported-at"],
);
const finalTeams = registration.teams;

const preTeamMemberships = countTeamMemberships(trades);
const postTeamMemberships = countTeamMemberships(finalTrades);
const prePlayerTradeReferences = countPlayerTradeReferences(players);
const postPlayerTradeReferences = countPlayerTradeReferences(finalPlayers);

const tradeOut = canonicalJson(finalTrades);
const playerOut = canonicalJson(finalPlayers);
const teamOut = canonicalJson(finalTeams);

const receipt = {
  result: "PASS",
  phase: "7H",
  mode: "FIRST_IMPORT",
  batchId: "chicago-bulls-phase-7h",
  startingHead: args["starting-head"],
  importedAt: args["imported-at"],
  sourceHashes: {
    phase7GFileSha256: sha256(resolutionBytes),
    reviewedBatchSha256: sha256(reviewedBytes),
    routingSpecSha256: sha256(routingBytes),
    finalPackageRecordsSha256: resolution.finalPackageRecordsSha256,
    resolutionRecordsSha256: resolution.resolutionRecordsSha256,
    proposedPlayerShellsSha256: resolution.proposedPlayerShellsSha256,
    relationshipPreviewsSha256: resolution.relationshipPreviewsSha256,
    importPartitionSha256: resolution.importPartitionSha256,
    preImportCanonicalStoreSha256: sha256(normalizedTradePreimage),
    preImportCanonicalStoreRawSha256: sha256(tradeBytes),
    preImportPlayerStoreSha256: sha256(normalizedPlayerPreimage),
    preImportPlayerStoreRawSha256: sha256(playerBytes),
    preImportTeamStoreSha256: sha256(normalizedTeamPreimage),
    preImportTeamStoreRawSha256: sha256(teamBytes),
    historicalLineageSha256: sha256(lineageBytes),
    contractSha256: sha256(contractBytes),
  },
  preImportCanonicalTrades: trades.length,
  preImportPlayers: players.length,
  preImportTeams: teams.length,
  readyPackages: readyPackageRecords.length,
  identityHeldPackages: identityHeldRecords.length,
  priorHeldRecords: priorHeldSourceIds.length,
  excludedRecords: excludedSourceIds.length,
  totalUntouchedSourceRows: allHeldSourceIds.length,
  canonicalTradesCreated: importedTradeIds.length,
  perspectivesAppended: 0,
  playerShellsCreated: createdPlayerIds.length,
  relationshipReferencesAdded: importedRelationshipIds.length,
  postImportCanonicalTrades: finalTrades.length,
  postImportPlayers: finalPlayers.length,
  postImportTeams: finalTeams.length,
  teamRegistryEntriesAdded: registration.registrations.length,
  registeredHistoricalTeamSlugs: registration.missingSlugs,
  teamRegistryRegistrations: registration.registrations,
  preImportTeamTradeMemberships: preTeamMemberships,
  postImportTeamTradeMemberships: postTeamMemberships,
  teamTradeMembershipsAdded: postTeamMemberships - preTeamMemberships,
  preImportPlayerTradeReferences: prePlayerTradeReferences,
  postImportPlayerTradeReferences: postPlayerTradeReferences,
  playerTradeReferencesAdded:
    postPlayerTradeReferences - prePlayerTradeReferences,
  readySourceTradeIds: readyPackageRecords.map((record) => record.sourceTradeId).sort(),
  identityHeldSourceTradeIds: identityHeldRecords.map((record) => record.sourceTradeId).sort(),
  priorHeldSourceTradeIds: priorHeldSourceIds,
  excludedSourceTradeIds: excludedSourceIds,
  untouchedSourceTradeIds: allHeldSourceIds,
  importedCanonicalTradeIds: importedTradeIds.sort(),
  importedPlayerIds: createdPlayerIds.sort(),
  relationshipIds: importedRelationshipIds.sort(),
  canonicalStoreSha256: sha256(tradeOut),
  playerStoreSha256: sha256(playerOut),
  teamStoreSha256: sha256(teamOut),
  repositoryDataWrites: 4,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  automaticRoutes: 0,
  heldPackageImports: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};
const receiptOut = canonicalJson(receipt);

await atomicWrite(args["trades-json"], tradeOut, "phase7h-trades");
await atomicWrite(args["players-json"], playerOut, "phase7h-players");
await atomicWrite(args["teams-json"], teamOut, "phase7h-teams");
await atomicWrite(receiptPath, receiptOut, "phase7h-receipt");

console.log(JSON.stringify({
  result: receipt.result,
  phase: receipt.phase,
  mode: receipt.mode,
  readyPackages: receipt.readyPackages,
  identityHeldPackages: receipt.identityHeldPackages,
  priorHeldRecords: receipt.priorHeldRecords,
  excludedRecords: receipt.excludedRecords,
  totalUntouchedSourceRows: receipt.totalUntouchedSourceRows,
  canonicalTradesCreated: receipt.canonicalTradesCreated,
  perspectivesAppended: receipt.perspectivesAppended,
  playerShellsCreated: receipt.playerShellsCreated,
  relationshipReferencesAdded: receipt.relationshipReferencesAdded,
  postImportCanonicalTrades: receipt.postImportCanonicalTrades,
  postImportPlayers: receipt.postImportPlayers,
  postImportTeams: receipt.postImportTeams,
  teamRegistryEntriesAdded: receipt.teamRegistryEntriesAdded,
  registeredHistoricalTeamSlugs: receipt.registeredHistoricalTeamSlugs,
  teamTradeMembershipsAdded: receipt.teamTradeMembershipsAdded,
  playerTradeReferencesAdded: receipt.playerTradeReferencesAdded,
  repositoryDataWrites: receipt.repositoryDataWrites,
  canonicalStoreSha256: receipt.canonicalStoreSha256,
  playerStoreSha256: receipt.playerStoreSha256,
  teamStoreSha256: receipt.teamStoreSha256,
  receiptSha256: sha256(receiptOut),
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  automaticRoutes: 0,
  heldPackageImports: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
