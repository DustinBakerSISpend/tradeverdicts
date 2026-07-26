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
function splitTeams(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value)
    .split("|")
    .map(clean)
    .filter(Boolean);
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
      registrySource: "charlotte-hornets-phase-6h",
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
  if (/\b(?:swap|option to swap)\b/u.test(text)) return "draft_swap";
  if (/\b(?:draft rights|rights to)\b/u.test(text)) return "draft_rights";
  if (/\b(?:first round|second round|draft pick|pick)\b/u.test(text)) {
    return "draft_pick";
  }
  return "player";
}
function canonicalTradeId(sourceTradeId) {
  return `nba-trade-${clean(sourceTradeId).toLowerCase()}`;
}
function canonicalTradeSlug(record) {
  return unique([
    clean(record.tradeId).toLowerCase(),
    clean(record.slug).toLowerCase(),
  ]).join("-").replace(/[^a-z0-9-]+/gu, "-").replace(/-+/gu, "-");
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
  return `phase6h-asset-${sha256([
    sourceTradeId,
    ordinal,
    clean(edge.assetType ?? edge.type),
    clean(edge.asset ?? edge.displayText),
    clean(edge.fromTeam),
    clean(edge.toTeam),
  ].join("|")).slice(0, 20).toLowerCase()}`;
}
function assetDisplay(asset) {
  return clean(
    asset.displayText ??
      asset.asset ??
      asset.playerName ??
      asset.name ??
      asset.label ??
      asset.description,
  );
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
  const grades = {
    "charlotte-hornets": clean(record.sourceTeamGrade),
    partnerAggregate: clean(record.partnerAggregateGrade),
  };
  for (const team of teams.filter((team) => team !== "charlotte-hornets")) {
    if (clean(record.partnerAggregateGrade)) {
      grades[team] = clean(record.partnerAggregateGrade);
    }
  }
  return {
    sourceTeam: "charlotte-hornets",
    sourceBatchId: "charlotte-hornets-phase-6a",
    sourceTradeId: record.tradeId,
    sourcePerspectiveKey: `charlotte-hornets:${record.tradeId}`,
    summary: record.summary,
    analysis: record.analysis,
    verdict: record.verdict,
    grades,
    aggregatePartnerGrade: clean(record.partnerAggregateGrade) || null,
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
function routeAssets(record, decision, routingTransaction) {
  if (routingTransaction) {
    const edges = [
      ...routingTransaction.sourceEdges.map((edge) => ({
        ...edge,
        edgeClass: "charlotte-source-route",
      })),
      ...(routingTransaction.supplementalEdges ?? []).map((edge) => ({
        ...edge,
        edgeClass: "supplemental-partner-route",
      })),
    ];
    return edges.map((edge, index) => ({
      assetId: assetId(record.tradeId, edge, index + 1),
      type: clean(edge.assetType) || inferAssetType(edge.asset),
      displayText: clean(edge.asset),
      asset: clean(edge.asset),
      fromTeam: clean(edge.fromTeam),
      toTeam: clean(edge.toTeam),
      direction:
        edge.toTeam === "charlotte-hornets"
          ? "incoming-to-charlotte"
          : edge.fromTeam === "charlotte-hornets"
            ? "outgoing-from-charlotte"
            : "supplemental-partner-route",
      edgeClass: edge.edgeClass,
      routingStatus: "resolved",
      possibleFromTeams: [],
      possibleToTeams: [],
      privateOnly: true,
    }));
  }

  const partners = splitTeams(decision.partnerTeams);
  assert(
    partners.length === 1,
    `${record.tradeId}: non-routing trade must have exactly one partner.`,
  );
  const partner = partners[0];
  const edges = [
    ...record.sourceTeamAssets.map((asset) => ({
      asset,
      assetType: inferAssetType(asset),
      fromTeam: partner,
      toTeam: "charlotte-hornets",
      direction: "incoming-to-charlotte",
      edgeClass: "two-team-route",
    })),
    ...record.partnerAggregateAssets.map((asset) => ({
      asset,
      assetType: inferAssetType(asset),
      fromTeam: "charlotte-hornets",
      toTeam: partner,
      direction: "outgoing-from-charlotte",
      edgeClass: "two-team-route",
    })),
  ];
  return edges.map((edge, index) => ({
    assetId: assetId(record.tradeId, edge, index + 1),
    type: edge.assetType,
    displayText: clean(edge.asset),
    asset: clean(edge.asset),
    fromTeam: clean(edge.fromTeam),
    toTeam: clean(edge.toTeam),
    direction: edge.direction,
    edgeClass: edge.edgeClass,
    routingStatus: "resolved",
    possibleFromTeams: [],
    possibleToTeams: [],
    privateOnly: true,
  }));
}
function relationshipRole(asset, relationship) {
  const text = normalize(`${asset.type} ${asset.displayText} ${relationship.rawAsset}`);
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
function relationshipAsset(assets, relationship) {
  const directionAssets = assets.filter(
    (asset) => asset.direction === relationship.direction,
  );
  assert(
    directionAssets.length > 0,
    `${relationship.relationshipKey}: no assets exist for ${relationship.direction}.`,
  );

  const playerNeedle = normalize(relationship.playerName);
  if (playerNeedle) {
    const byPlayer = directionAssets.filter((asset) =>
      normalize(asset.displayText).includes(playerNeedle),
    );
    if (byPlayer.length === 1) return byPlayer[0];
  }

  const rawNeedle = normalize(relationship.rawAsset);
  if (rawNeedle) {
    const byRaw = directionAssets.filter((asset) => {
      const display = normalize(asset.displayText);
      return display === rawNeedle ||
        display.includes(rawNeedle) ||
        rawNeedle.includes(display);
    });
    if (byRaw.length === 1) return byRaw[0];
  }

  const ordinal = Number(relationship.ordinal);
  if (
    Number.isInteger(ordinal) &&
    ordinal >= 1 &&
    ordinal <= directionAssets.length
  ) {
    return directionAssets[ordinal - 1];
  }

  throw new Error(
    `${relationship.relationshipKey}: could not select one canonical asset.`,
  );
}
function createShellId(shell) {
  return `nba-player-${slugify(shell.proposedName)}-${sha256(shell.proposedPlayerKey).slice(0, 10).toLowerCase()}`;
}
function createPlayerShell(shell, id, slug, importedAt) {
  return {
    id,
    playerId: id,
    slug,
    displayName: shell.proposedName,
    name: shell.proposedName,
    fullName: shell.proposedName,
    playerName: shell.proposedName,
    league: "nba",
    aliases: [],
    referenceTypes: [],
    tradeIds: [],
    tradeSlugs: [],
    relationshipReferences: [],
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-shell-imported-charlotte-phase-6h",
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
  "phase6g-resolution",
  "phase6c-decision",
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
  "expected-ready-shell-sha256",
  "expected-ready-relationship-sha256",
  "expected-import-partition-sha256",
  "starting-head",
  "imported-at",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  resolutionBytes,
  decisionBytes,
  reviewedBytes,
  routingBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  lineageBytes,
  contractBytes,
] = await Promise.all([
  readFile(args["phase6g-resolution"]),
  readFile(args["phase6c-decision"]),
  readFile(args["reviewed-json"]),
  readFile(args["routing-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["lineage-json"]),
  readFile(args["contract-md"]),
]);

const resolution = JSON.parse(resolutionBytes.toString("utf8"));
const decision = JSON.parse(decisionBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const routing = JSON.parse(routingBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const receiptPath = path.resolve(args["receipt-json"]);

assert(resolution.result === "PASS" && resolution.phase === "6G", "Invalid Phase 6G source.");
assert(decision.result === "PASS" && decision.phase === "6C", "Invalid Phase 6C source.");
assert(reviewed.batchId === "charlotte-hornets-phase-6a", "Invalid reviewed batch.");
assert(routing.phase === "6D" && routing.routingTransactions.length === 10, "Invalid routing spec.");
assert(Array.isArray(trades) && trades.length >= 657, "Canonical store is invalid.");
assert(Array.isArray(players) && players.length >= 1179, "Player store is invalid.");
assert(Array.isArray(teams) && teams.length >= 50, "Team store is invalid.");
assert(lineage && typeof lineage === "object", "Historical lineage is invalid.");

assert(
  resolution.finalPackageRecordsSha256 === args["expected-final-package-sha256"],
  "Frozen final-package hash drifted.",
);
assert(
  resolution.readyPlayerShellRecordsSha256 === args["expected-ready-shell-sha256"],
  "Frozen ready-shell hash drifted.",
);
assert(
  resolution.readyRelationshipRecordsSha256 === args["expected-ready-relationship-sha256"],
  "Frozen ready-relationship hash drifted.",
);
assert(
  resolution.importPartitionSha256 === args["expected-import-partition-sha256"],
  "Frozen import-partition hash drifted.",
);
assert(resolution.readyPackages === 102, "Ready-package count drifted.");
assert(resolution.heldPackages === 1, "Held-package count drifted.");
assert(resolution.readyCanonicalCreatePackages === 102, "Canonical-create count drifted.");
assert(resolution.readyPerspectiveAppendPackages === 0, "Unexpected perspective append.");
assert(resolution.readyPlayerShellPackages === 113, "Ready-shell count drifted.");
assert(resolution.readyRelationshipPreviews === 199, "Ready-relationship count drifted.");

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
  assert(existingReceipt.result === "PASS" && existingReceipt.phase === "6H", "Existing receipt is invalid.");
  assert(existingReceipt.canonicalStoreSha256 === tradeHash, "Replay canonical hash differs from receipt.");
  assert(existingReceipt.playerStoreSha256 === playerHash, "Replay player hash differs from receipt.");
  assert(existingReceipt.teamStoreSha256 === teamHash, "Replay team hash differs from receipt.");
  console.log(JSON.stringify({
    result: "PASS",
    phase: "6H",
    mode: "IDEMPOTENT_REPLAY",
    readyPackages: existingReceipt.readyPackages,
    heldPackages: existingReceipt.heldPackages,
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

const normalizedTradePreimage = lfNormalizedUtf8Bytes(tradeBytes, "Canonical store");
const normalizedPlayerPreimage = lfNormalizedUtf8Bytes(playerBytes, "Player store");
const normalizedTeamPreimage = lfNormalizedUtf8Bytes(teamBytes, "Team store");

assert(
  sha256(normalizedTradePreimage) === args["expected-trade-store-sha256"],
  "Canonical store LF-normalized preimage hash mismatch.",
);
assert(
  sha256(normalizedPlayerPreimage) === args["expected-player-store-sha256"],
  "Player store LF-normalized preimage hash mismatch.",
);
assert(
  sha256(normalizedTeamPreimage) === args["expected-team-store-sha256"],
  "Team store LF-normalized preimage hash mismatch.",
);
assert(trades.length === 657, `Expected 657 pre-import trades, found ${trades.length}.`);
assert(players.length === 1179, `Expected 1179 pre-import players, found ${players.length}.`);
assert(teams.length === 50, `Expected 50 pre-import teams, found ${teams.length}.`);

const readyPackageRecords = resolution.finalPackageRecords.filter(
  (record) => record.importReady === true,
);
const heldPackageRecords = resolution.finalPackageRecords.filter(
  (record) => record.importReady !== true,
);
assert(readyPackageRecords.length === 102, "Ready package partition mismatch.");
assert(heldPackageRecords.length === 1, "Held package partition mismatch.");

const readyShells = resolution.readyPlayerShellRecords;
const readyRelationships = resolution.readyRelationshipRecords;
assert(Array.isArray(readyShells) && readyShells.length === 113, "Ready shells unavailable.");
assert(Array.isArray(readyRelationships) && readyRelationships.length === 199, "Ready relationships unavailable.");

const reviewedById = new Map(reviewed.records.map((record) => [record.tradeId, record]));
const decisionById = new Map(decision.records.map((record) => [record.tradeId, record]));
const routingById = new Map(
  routing.routingTransactions.map((record) => [record.tradeId, record]),
);
assert(reviewedById.size === 125, "Duplicate reviewed trade IDs.");
assert(decisionById.size === 125, "Duplicate decision trade IDs.");

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
assert(tradeMap.size === trades.length, "Duplicate canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");

const existingSlugs = new Set(players.map((player) => clean(player.slug)).filter(Boolean));
const shellIdByKey = new Map();
const createdPlayerIds = [];
for (const shell of readyShells) {
  const id = createShellId(shell);
  let slug = clean(shell.proposedSlug) || slugify(shell.proposedName);
  if (existingSlugs.has(slug)) {
    slug = `${slug}-${sha256(shell.proposedPlayerKey).slice(0, 8).toLowerCase()}`;
  }
  assert(!playerMap.has(id), `Player shell target already exists: ${id}`);
  assert(!existingSlugs.has(slug), `Player shell slug already exists: ${slug}`);
  existingSlugs.add(slug);
  shellIdByKey.set(shell.proposedPlayerKey, id);
  playerMap.set(id, createPlayerShell(shell, id, slug, args["imported-at"]));
  createdPlayerIds.push(id);
}
assert(createdPlayerIds.length === 113, "Created player-shell count drifted.");

const relationshipsByTrade = new Map();
for (const relationship of readyRelationships) {
  if (!relationshipsByTrade.has(relationship.tradeId)) {
    relationshipsByTrade.set(relationship.tradeId, []);
  }
  relationshipsByTrade.get(relationship.tradeId).push(relationship);
}

const importedTradeIds = [];
const importedRelationshipIds = [];
const heldTradeIds = heldPackageRecords.map((record) => record.tradeId).sort();

for (const packageRecord of readyPackageRecords) {
  const source = reviewedById.get(packageRecord.tradeId);
  const decisionRecord = decisionById.get(packageRecord.tradeId);
  assert(source, `Reviewed record missing: ${packageRecord.tradeId}`);
  assert(decisionRecord, `Decision record missing: ${packageRecord.tradeId}`);

  const routingTransaction = routingById.get(packageRecord.tradeId) ?? null;
  const teamsForTrade = routingTransaction
    ? uniqueSorted(routingTransaction.participants)
    : uniqueSorted([
        "charlotte-hornets",
        ...splitTeams(decisionRecord.partnerTeams),
      ]);
  assert(
    teamsForTrade.length === Number(decisionRecord.teamCount),
    `${packageRecord.tradeId}: team-count mismatch.`,
  );
  assert(
    teamsForTrade.includes("charlotte-hornets"),
    `${packageRecord.tradeId}: Charlotte team is missing.`,
  );

  const assets = routeAssets(source, decisionRecord, routingTransaction);
  assert(assets.length > 0, `${packageRecord.tradeId}: no canonical assets.`);
  assert(
    assets.every(
      (asset) =>
        teamsForTrade.includes(asset.fromTeam) &&
        teamsForTrade.includes(asset.toTeam),
    ),
    `${packageRecord.tradeId}: asset route references a non-participant.`,
  );
  assert(
    new Set(assets.map((asset) => asset.assetId)).size === assets.length,
    `${packageRecord.tradeId}: duplicate asset IDs.`,
  );

  const packageRelationships = relationshipsByTrade.get(packageRecord.tradeId) ?? [];
  for (const relationship of packageRelationships) {
    const asset = relationshipAsset(assets, relationship);
    const role = relationshipRole(asset, relationship);
    const targetPlayerId =
      relationship.playerReferenceType === "proposed-player-shell"
        ? shellIdByKey.get(relationship.playerReference)
        : clean(relationship.playerReference);
    assert(
      targetPlayerId,
      `${relationship.relationshipKey}: player reference is unavailable.`,
    );
    const player = playerMap.get(targetPlayerId);
    assert(
      player,
      `${relationship.relationshipKey}: target player does not exist: ${targetPlayerId}`,
    );

    if (role === "pick-became-player") {
      asset.becamePlayerName = relationship.playerName;
      asset.becamePlayerId = targetPlayerId;
    } else {
      asset.playerName = relationship.playerName;
      asset.playerId = targetPlayerId;
    }
    asset.playerRelationshipRole = role;

    const relationshipId = relationship.relationshipKey;
    const reference = {
      relationshipId,
      referenceType: relationshipReferenceType(role),
      relationshipRole: role,
      tradeId: canonicalTradeId(packageRecord.tradeId),
      canonicalTradeId: canonicalTradeId(packageRecord.tradeId),
      tradeSlug: canonicalTradeSlug(source),
      assetId: asset.assetId,
      assetReference: asset.assetId,
      sourceAssetId: null,
      sourceTradeId: packageRecord.tradeId,
      packageId: `charlotte-hornets-phase-6h-${packageRecord.tradeId}`,
      sourceTeam: "charlotte-hornets",
      privateOnly: true,
    };
    playerMap.set(
      targetPlayerId,
      appendRelationshipReference(player, reference),
    );
    importedRelationshipIds.push(relationshipId);
  }

  const canonicalId = canonicalTradeId(packageRecord.tradeId);
  assert(!tradeMap.has(canonicalId), `${packageRecord.tradeId}: canonical target exists.`);
  const perspective = reviewedPerspective(source, teamsForTrade);
  const importedTrade = {
    id: canonicalId,
    tradeId: canonicalId,
    sourceTradeId: packageRecord.tradeId,
    canonicalKey: canonicalId,
    slug: canonicalTradeSlug(source),
    league: "nba",
    tradeDate: source.tradeDate,
    date: source.tradeDate,
    seasonLabel: seasonLabel(source.tradeDate),
    season: seasonStartYear(source.tradeDate),
    teams: teamsForTrade,
    assetsReceived: assetsByTeam(teamsForTrade, assets, "received"),
    assetsSent: assetsByTeam(teamsForTrade, assets, "sent"),
    assetLedger: assets,
    sourceTeams: ["charlotte-hornets"],
    perspectives: [perspective],
    grades: perspective.grades,
    verdict: perspective.verdict,
    summary: perspective.summary,
    analysis: perspective.analysis,
    confidence: perspective.confidence || "high",
    tier: clean(source.tier) || "standard",
    sources: [
      {
        sourceType: "reviewed_private_batch",
        sourceTeam: "charlotte-hornets",
        sourceBatchId: "charlotte-hornets-phase-6a",
        sourceTradeId: packageRecord.tradeId,
        privateOnly: true,
      },
      ...(clean(source.primaryOfficialSourceUrl)
        ? [{
            sourceType: "official_transaction_source",
            url: clean(source.primaryOfficialSourceUrl),
            privateOnly: true,
          }]
        : []),
    ],
    perspectiveReconciliations: [{
      sourceBatchId: "charlotte-hornets-phase-6g",
      packageId: `charlotte-hornets-phase-6h-${packageRecord.tradeId}`,
      method: "frozen-ready-canonical-create",
      importedAt: args["imported-at"],
      automaticMerge: false,
    }],
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-imported-charlotte-phase-6h",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    createdAt: args["imported-at"],
    updatedAt: args["imported-at"],
  };
  tradeMap.set(canonicalId, importedTrade);
  importedTradeIds.push(canonicalId);
}

assert(importedTradeIds.length === 102, "Imported trade count drifted.");
assert(importedRelationshipIds.length === 199, "Imported relationship count drifted.");
assert(playerMap.size === 1292, `Expected 1292 post-import players, found ${playerMap.size}.`);
assert(tradeMap.size === 759, `Expected 759 post-import trades, found ${tradeMap.size}.`);

const finalTrades = [...tradeMap.values()];
const finalPlayers = [...playerMap.values()];
const registration = registerMissingHistoricalTeams(
  finalTrades,
  teams,
  lineage,
  args["imported-at"],
);
const finalTeams = registration.teams;

const tradeOut = canonicalJson(finalTrades);
const playerOut = canonicalJson(finalPlayers);
const teamOut = canonicalJson(finalTeams);

const receipt = {
  result: "PASS",
  phase: "6H",
  mode: "FIRST_IMPORT",
  batchId: "charlotte-hornets-phase-6h",
  startingHead: args["starting-head"],
  importedAt: args["imported-at"],
  sourceHashes: {
    phase6GFileSha256: sha256(resolutionBytes),
    phase6CFileSha256: sha256(decisionBytes),
    reviewedBatchSha256: sha256(reviewedBytes),
    routingSpecSha256: sha256(routingBytes),
    finalPackageRecordsSha256: resolution.finalPackageRecordsSha256,
    readyPlayerShellRecordsSha256: resolution.readyPlayerShellRecordsSha256,
    readyRelationshipRecordsSha256: resolution.readyRelationshipRecordsSha256,
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
  heldPackages: heldPackageRecords.length,
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
  readySourceTradeIds: readyPackageRecords.map((record) => record.tradeId).sort(),
  heldSourceTradeIds: heldTradeIds,
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

await atomicWrite(args["trades-json"], tradeOut, "phase6h-trades");
await atomicWrite(args["players-json"], playerOut, "phase6h-players");
await atomicWrite(args["teams-json"], teamOut, "phase6h-teams");
await atomicWrite(receiptPath, receiptOut, "phase6h-receipt");

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
  heldPackageImports: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
