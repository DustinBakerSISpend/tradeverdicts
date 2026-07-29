#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const TEAM = "milwaukee-bucks";
const BATCH = "milwaukee-bucks-phase-19h";
const EXACT_EXISTING_PLAYER_OVERRIDES = new Map([
  ["nba-player-d-j-augustin-62f0387e0b", "nba-player-dj-augustin-7b32f3fe01"],
  ["nba-player-o-g-anunoby-2b0d93df9f", "nba-player-og-anunoby"],
  ["nba-player-r-j-hampton-0a2d6dcc68", "nba-player-rj-hampton-62cbde2ae5"],
]);
function effectivePlayerId(value) {
  const id = clean(value);
  return EXACT_EXISTING_PLAYER_OVERRIDES.get(id) ?? id;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function clean(value) { return String(value ?? "").trim(); }
function normalize(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[\u2018\u2019'`"]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}
function slugify(value) { return normalize(value).replace(/\s+/gu, "-") || "unknown"; }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function uniqueSorted(values) { return unique(values).sort((a,b) => String(a).localeCompare(String(b), "en")); }
function seasonStartYear(date) {
  const year = Number(String(date).slice(0, 4));
  const month = Number(String(date).slice(5, 7));
  return month >= 6 ? year : year - 1;
}
function seasonLabel(date) {
  const start = seasonStartYear(date);
  return `${start}-${String(start + 1).slice(-2)}`;
}
function playerId(player) { return clean(player?.id ?? player?.playerId ?? player?.slug ?? player?.identity?.id); }
function teamSlug(team) { return clean(team?.slug ?? team?.id ?? team?.teamId); }
function tradeId(trade) { return clean(trade?.id ?? trade?.tradeId); }
function asArrayDocument(raw, property) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw[property])) return raw[property];
  if (raw && Array.isArray(raw.records)) return raw.records;
  throw new Error(`JSON input does not contain ${property} array.`);
}
async function fileExists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}
async function readJson(filePath) { return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/u, "")); }
async function sha256File(filePath) { return sha256(await readFile(filePath)); }
async function atomicWrite(targetPath, bytes, label) {
  const absolute = path.resolve(targetPath);
  const directory = path.dirname(absolute);
  const temporary = path.join(directory, `.${path.basename(absolute)}.${label}.${process.pid}.tmp`);
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, bytes);
  try { await rename(temporary, absolute); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/u, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/u, "")); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(clean);
  return rows.slice(1)
    .filter((values) => values.some((v) => clean(v)))
    .map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));
}
async function readCsv(filePath) { return parseCsv(await readFile(filePath, "utf8")); }
function sourcePerspectiveCount(trade, team) {
  const perspectives = trade?.perspectives;
  if (Array.isArray(perspectives)) {
    return perspectives.filter((p) => clean(p?.sourceTeam ?? p?.teamId ?? p?.team ?? p?.perspectiveTeam) === team).length;
  }
  if (perspectives && typeof perspectives === "object") {
    return Object.prototype.hasOwnProperty.call(perspectives, team) ? 1 : 0;
  }
  return 0;
}
function immutableTradeProjection(trade) {
  return {
    id: trade.id,
    tradeId: trade.tradeId,
    sourceTradeId: trade.sourceTradeId,
    canonicalKey: trade.canonicalKey,
    slug: trade.slug,
    league: trade.league,
    tradeDate: trade.tradeDate,
    date: trade.date,
    seasonLabel: trade.seasonLabel,
    season: trade.season,
    teams: trade.teams,
    assetLedger: trade.assetLedger,
    assetsReceived: trade.assetsReceived,
    assetsSent: trade.assetsSent,
    assetsSentByTeam: trade.assetsSentByTeam,
    createdAt: trade.createdAt,
  };
}
function relationRole(kind) {
  if (kind === "draft-outcome-player") return "pick-became-player";
  if (kind.includes("rights")) return "draft-rights-player";
  return "traded-player";
}
function referenceType(kind) {
  if (kind === "draft-outcome-player") return "draft_outcome";
  if (kind.includes("rights")) return "draft_rights";
  return "direct_player";
}
function assetType(kind, rawAsset, identityKinds) {
  const kinds = new Set(identityKinds);
  if (kinds.has("draft-outcome-player")) return "draft_pick";
  if ([...kinds].some((v) => v.includes("rights"))) return "draft_rights";
  if (kinds.has("direct-player") && kind === "player-bearing-asset") return "player";
  if (kind === "draft-pick-mechanism") return "draft_pick";
  if (kind === "pick-swap") return "pick_swap";
  if (kind === "cash-consideration") return "cash";
  if (kind === "trade-exception") return "trade_exception";
  if (kind === "future-consideration") return "future_consideration";
  if (kind === "unnamed-player-mechanism") return "conditional_asset";
  const value = normalize(rawAsset);
  if (/\bcash\b/u.test(value)) return "cash";
  if (/\btrade exception\b|\btpe\b/u.test(value)) return "trade_exception";
  if (/\bswap\b/u.test(value)) return "pick_swap";
  if (/\bdraft rights\b|\brights to\b/u.test(value)) return "draft_rights";
  if (/\bpick\b|\bselection\b|\bround\b/u.test(value)) return "draft_pick";
  if (/\bconsideration\b/u.test(value)) return "future_consideration";
  return kinds.has("direct-player") ? "player" : "other";
}
function expectedReferenceTypesForAsset(asset) {
  const types = [];
  if (asset?.type === "player") types.push("direct_player");
  if (asset?.type === "draft_rights") types.push("draft_rights");
  if (clean(asset?.becamePlayerName)) types.push("draft_outcome");
  return types;
}
function winnerFromVerdict(verdict) {
  const value = clean(verdict).toLowerCase();
  if (value.includes("bucks win") || value.includes("bucks edge")) return "Milwaukee Bucks";
  if (value.includes("partner win") || value.includes("partner edge")) return "Partner";
  if (value.includes("even")) return "Even";
  return "Incomplete Evidence";
}
function perspectiveGrades(record, partner) {
  const grades = {};
  if (clean(record.bucksGrade)) grades[TEAM] = clean(record.bucksGrade);
  if (clean(record.partnerGrade)) {
    grades.partnerAggregate = clean(record.partnerGrade);
    if (partner) grades[partner] = clean(record.partnerGrade);
  }
  return grades;
}
function bucksPerspective(record, teams) {
  const partner = teams.find((team) => team !== TEAM) ?? null;
  return {
    sourceTeam: TEAM,
    sourceBatchId: BATCH,
    sourceTradeId: clean(record.tradeId),
    sourcePerspectiveKey: `${TEAM}:${clean(record.tradeId)}`,
    summary: clean(record.summary),
    analysis: clean(record.analysis),
    verdict: clean(record.finalVerdict),
    grades: perspectiveGrades(record, partner),
    aggregatePartnerGrade: clean(record.partnerGrade) || null,
    confidence: clean(record.confidence).toLowerCase(),
    reviewStatus: "manual-review",
    contentClass: clean(record.publicationClass),
    lowValueQa: clean(record.lowValueGate),
    outcomeScore: record.hindsightScore ?? null,
    winner: winnerFromVerdict(record.finalVerdict),
    gradeRationale: clean(record.materialCorrectionNote),
    reviewerNotes: clean(record.researchFlags),
    primarySourceUrl: clean(record.primarySourceUrl) || null,
    secondarySourceUrl: clean(record.secondarySourceUrl) || null,
    privateOnly: true,
    publishStatus: "private",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  };
}
function appendBucksPerspective(existingTrade, record, importedAt) {
  const protectedBefore = JSON.stringify(immutableTradeProjection(existingTrade));
  assert(sourcePerspectiveCount(existingTrade, TEAM) === 0, `${record.tradeId}: Milwaukee perspective already exists.`);
  const teams = uniqueSorted(existingTrade.teams ?? []);
  assert(teams.includes(TEAM), `${record.tradeId}: target canonical trade does not include Milwaukee.`);
  const perspective = bucksPerspective(record, teams);
  let perspectives;
  if (Array.isArray(existingTrade.perspectives)) {
    perspectives = [...existingTrade.perspectives, perspective];
  } else if (existingTrade.perspectives && typeof existingTrade.perspectives === "object") {
    perspectives = {
      ...existingTrade.perspectives,
      [TEAM]: {
        sourceSubmissionId: `${BATCH}-${clean(record.tradeId)}`,
        sourceTradeId: clean(record.tradeId),
        editorialStatus: `private-imported-${BATCH}`,
        grade: clean(record.bucksGrade),
        verdict: clean(record.finalVerdict),
        summary: clean(record.summary),
        analysis: clean(record.analysis),
        confidence: clean(record.confidence),
        reviewStatus: "manual-review",
        contentClass: clean(record.publicationClass),
        lowValueQa: clean(record.lowValueGate),
        privateOnly: true,
        publishStatus: "private",
        indexEligible: false,
        adEligible: false,
        publicationReady: false,
      },
    };
  } else {
    perspectives = [perspective];
  }
  const grades = { ...(existingTrade.grades ?? {}) };
  if (clean(record.bucksGrade)) grades[TEAM] = clean(record.bucksGrade);
  const updated = {
    ...existingTrade,
    sourceTeams: uniqueSorted([...(Array.isArray(existingTrade.sourceTeams) ? existingTrade.sourceTeams : []), TEAM]),
    perspectives,
    grades,
    perspectiveReconciliations: [
      ...(Array.isArray(existingTrade.perspectiveReconciliations) ? existingTrade.perspectiveReconciliations : []),
      {
        sourceBatchId: BATCH,
        sourceTradeId: clean(record.tradeId),
        packageId: `${BATCH}-${clean(record.tradeId)}`,
        method: "frozen-exact-existing-canonical-match",
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
  assert(JSON.stringify(immutableTradeProjection(updated)) === protectedBefore, `${record.tradeId}: perspective append altered protected canonical fields.`);
  assert(sourcePerspectiveCount(updated, TEAM) === 1, `${record.tradeId}: Milwaukee perspective append count drifted.`);
  return updated;
}
function canonicalIdForSource(sourceTradeId) {
  const match = clean(sourceTradeId).match(/^MIL-(\d{4})-(\d{4})$/u);
  assert(match, `Invalid Milwaukee source Trade ID: ${sourceTradeId}`);
  return `nba-trade-mil-${match[1]}-${match[2]}`;
}
function makeAssetId(sourceTradeId, side, assetIndex, rawAsset, fromTeam, toTeam) {
  return `phase19h-asset-${sha256([sourceTradeId, side, assetIndex, rawAsset, fromTeam, toTeam].join("|")).slice(0,20).toLowerCase()}`;
}
function identityKey(row) {
  return [clean(row["Dependency Key"]), effectivePlayerId(row["Target Player ID"]), normalize(row["Identity Display"])].join("|");
}
function createPlayerShell(shell, aliases, importedAt) {
  const id = clean(shell["Proposed Player ID"]);
  const displayName = clean(shell["Display Name"]);
  assert(id, "Frozen player shell has empty ID.");
  assert(displayName, `${id}: frozen player shell has empty display name.`);
  return {
    id,
    playerId: id,
    slug: slugify(displayName),
    displayName,
    name: displayName,
    fullName: displayName,
    playerName: displayName,
    normalizedName: clean(shell["Normalized Name"]) || normalize(displayName),
    league: "nba",
    aliases: uniqueSorted(aliases.filter((v) => normalize(v) !== normalize(displayName))),
    referenceTypes: [],
    tradeIds: [],
    tradeSlugs: [],
    relationshipReferences: [],
    sourceReferences: [],
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: `private-shell-imported-${BATCH}`,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}
function buildNewTrade({ packageRecord, record, dependencyRows, identityRows, relationshipRows, teamRows, importedAt, playerMap }) {
  const sourceTradeId = clean(record.tradeId);
  assert(teamRows.length === 2, `${sourceTradeId}: ready package must have exactly two team dependencies.`);
  assert(teamRows.every((row) => ["existing-team-exact","existing-team-historical-alias"].includes(clean(row["Team Status"]))), `${sourceTradeId}: unresolved team dependency entered ready set.`);
  const teams = uniqueSorted(teamRows.map((row) => clean(row["Resolved Team Slug"])));
  assert(teams.length === 2 && teams.includes(TEAM), `${sourceTradeId}: ready team set must contain Milwaukee plus one partner.`);
  const partner = teams.find((team) => team !== TEAM);
  assert(partner, `${sourceTradeId}: partner team missing.`);
  const sourceTeamSlugs = uniqueSorted(teamRows.map((row) => clean(row["Requested Team Slug"])));

  const identitiesByDependency = new Map();
  for (const identity of identityRows) {
    const key = clean(identity["Dependency Key"]);
    if (!identitiesByDependency.has(key)) identitiesByDependency.set(key, []);
    identitiesByDependency.get(key).push(identity);
  }
  const relationshipsByDependency = new Map();
  for (const relationship of relationshipRows) {
    const key = clean(relationship["Dependency Key"]);
    if (!relationshipsByDependency.has(key)) relationshipsByDependency.set(key, []);
    relationshipsByDependency.get(key).push(relationship);
  }

  const assets = dependencyRows.slice()
    .sort((a,b) => Number(a["Dependency Ordinal"]) - Number(b["Dependency Ordinal"]))
    .map((dependency) => {
      const side = clean(dependency.Side);
      assert(["received","sent"].includes(side), `${sourceTradeId}: invalid dependency side ${side}.`);
      const rawAsset = clean(dependency["Raw Asset"]);
      const fromTeam = side === "received" ? partner : TEAM;
      const toTeam = side === "received" ? TEAM : partner;
      const linkedIdentities = identitiesByDependency.get(clean(dependency["Dependency Key"])) ?? [];
      const linkedRelationships = relationshipsByDependency.get(clean(dependency["Dependency Key"])) ?? [];
      const kinds = uniqueSorted(linkedIdentities.map((row) => clean(row["Identity Kind"])));
      const asset = {
        assetId: makeAssetId(sourceTradeId, side, Number(dependency["Asset Index"]), rawAsset, fromTeam, toTeam),
        dependencyKey: clean(dependency["Dependency Key"]),
        type: assetType(clean(dependency["Dependency Kind"]), rawAsset, kinds),
        displayText: rawAsset,
        asset: rawAsset,
        fromTeam,
        toTeam,
        direction: side,
        sourceTeam: TEAM,
        edgeClass: "milwaukee-source-route",
        routingStatus: "resolved",
        routingMethod: "two-team-direct",
        possibleFromTeams: [],
        possibleToTeams: [],
        privateOnly: true,
        previewOnly: false,
        auditStatus: `private-imported-${BATCH}`,
      };
      if (linkedRelationships.length) {
        asset.playerRelationshipIds = linkedRelationships.map((row) => clean(row["Relationship ID"]));
        asset.playerIds = uniqueSorted(linkedRelationships.map((row) => effectivePlayerId(row["Target Player ID"])));
      }
      if (linkedIdentities.length === 1) {
        const identity = linkedIdentities[0];
        const targetId = effectivePlayerId(identity["Target Player ID"]);
        const player = playerMap.get(targetId);
        assert(player, `${sourceTradeId}: player ${targetId} missing while building ${rawAsset}.`);
        const displayName = clean(player.displayName ?? player.name ?? identity["Identity Display"]);
        const kind = clean(identity["Identity Kind"]);
        if (kind === "draft-outcome-player") {
          asset.becamePlayerId = targetId;
          asset.becamePlayerName = displayName;
        } else {
          asset.playerId = targetId;
          asset.playerName = displayName;
          asset.playerRelationshipRole = relationRole(kind);
        }
      }
      return asset;
    });

  const byReceived = Object.fromEntries(teams.map((team) => [team, assets.filter((asset) => asset.toTeam === team)]));
  const bySent = Object.fromEntries(teams.map((team) => [team, assets.filter((asset) => asset.fromTeam === team)]));
  const perspective = bucksPerspective(record, teams);
  const canonicalId = canonicalIdForSource(sourceTradeId);
  const tradeDate = clean(record.tradeDate);
  const sources = [
    clean(record.primarySourceUrl) ? { sourceType:"primary_url", url:clean(record.primarySourceUrl), sourceTeam:TEAM, privateOnly:true } : null,
    clean(record.secondarySourceUrl) ? { sourceType:"secondary_url", url:clean(record.secondarySourceUrl), sourceTeam:TEAM, privateOnly:true } : null,
  ].filter(Boolean);
  if (!sources.length) {
    sources.push({ sourceType:"reconciled_workbook", label:"Milwaukee Bucks reconciled audit workbook", sourceTradeId, sourceTeam:TEAM, privateOnly:true });
  }
  return {
    id: canonicalId,
    tradeId: canonicalId,
    sourceTradeId,
    canonicalKey: canonicalId,
    slug: `milwaukee-bucks-trade-${tradeDate}-${sourceTradeId.split("-").at(-1)}`,
    league: "nba",
    tradeDate,
    date: tradeDate,
    seasonLabel: seasonLabel(tradeDate),
    season: seasonStartYear(tradeDate),
    teams,
    sourceTeamLabels: uniqueSorted(["Milwaukee Bucks", clean(record.partnerTeams)]),
    sourceTeamSlugs,
    assetsReceived: byReceived,
    assetsSent: bySent,
    assetsSentByTeam: bySent,
    assetLedger: assets,
    sourceTeams: [TEAM],
    perspectives: { [TEAM]: perspective },
    grades: perspective.grades,
    verdict: clean(record.finalVerdict),
    summary: clean(record.summary),
    analysis: clean(record.analysis),
    confidence: clean(record.confidence).toLowerCase(),
    contentClass: clean(record.publicationClass),
    canonicalAction: clean(packageRecord["Canonical Action"]),
    dateCollisionResolvedAsDistinctCreate: false,
    canonicalKeyVersion: 1,
    dateTeamsKey: `${tradeDate}|${teams.join("|")}`,
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: `private-imported-${BATCH}`,
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    sources,
    perspectiveReconciliations: [{
      sourceBatchId: BATCH,
      sourceTradeId,
      packageId: `${BATCH}-${sourceTradeId}`,
      method: "frozen-new-canonical-create",
      importedAt,
      automaticMerge: false,
    }],
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}
function assetMatchesBucksSide(asset, side) {
  const possibleFrom = Array.isArray(asset?.possibleFromTeams) ? asset.possibleFromTeams : [];
  const possibleTo = Array.isArray(asset?.possibleToTeams) ? asset.possibleToTeams : [];
  if (side === "received") return clean(asset?.toTeam) === TEAM || possibleTo.includes(TEAM);
  return clean(asset?.fromTeam) === TEAM || possibleFrom.includes(TEAM);
}
function assetMatchScore(asset, relationship, identity, player) {
  const target = effectivePlayerId(relationship["Target Player ID"]);
  if ([asset?.playerId, asset?.becamePlayerId, asset?.targetPlayerId].map(clean).includes(target)) return 100;
  const display = normalize(player?.displayName ?? player?.name ?? relationship["Identity Display"]);
  for (const field of ["playerName","becamePlayerName","displayText","asset","auditSourceText"]) {
    const value = normalize(asset?.[field]);
    if (display && value.includes(display)) return 80;
  }
  const raw = normalize(identity?.["Raw Asset"]);
  const text = normalize(asset?.displayText ?? asset?.asset ?? asset?.auditSourceText);
  if (raw && text) {
    if (raw === text) return 70;
    if (raw.includes(text) || text.includes(raw)) return 60;
  }
  return 0;
}
function syntheticAssetReference(relationship, identity) {
  return {
    assetId: `phase19h-perspective-asset-${sha256([
      relationship["Trade ID"],
      relationship.Side,
      identity?.["Raw Asset"] ?? "",
      relationship["Target Player ID"],
      relationship["Relationship ID"],
    ].join("|")).slice(0,20).toLowerCase()}`,
    sourceAssetId: null,
    synthetic: true,
  };
}
function resolveRelationshipAssetReference(trade, relationship, identity, player) {
  const assets = Array.isArray(trade.assetLedger) ? trade.assetLedger : [];
  const candidates = assets.map((asset) => ({
    asset,
    score: assetMatchScore(asset, relationship, identity, player),
    sideMatch: assetMatchesBucksSide(asset, clean(relationship.Side)),
  }))
  .filter((candidate) => candidate.score > 0)
  .sort((a,b) =>
    Number(b.sideMatch) - Number(a.sideMatch) ||
    b.score - a.score ||
    clean(a.asset.assetId).localeCompare(clean(b.asset.assetId), "en")
  );
  if (candidates.length && clean(candidates[0].asset.assetId)) {
    return { assetId: clean(candidates[0].asset.assetId), sourceAssetId: clean(candidates[0].asset.assetId), synthetic:false };
  }
  return syntheticAssetReference(relationship, identity);
}
function canonicalSourceReferenceKey(canonicalTradeId, assetId, refType) {
  return [clean(canonicalTradeId), clean(assetId), clean(refType)].join("|");
}
function appendRelationshipReference(player, reference, sourceReference, importedAt) {
  const relationships = Array.isArray(player.relationshipReferences) ? player.relationshipReferences : [];
  assert(!relationships.some((item) => clean(item.relationshipId) === clean(reference.relationshipId)), `${reference.relationshipId}: relationship already exists.`);
  const sourceReferences = Array.isArray(player.sourceReferences) ? player.sourceReferences : [];
  const sourceKey = sourceReference
    ? canonicalSourceReferenceKey(sourceReference.canonicalTradeId, sourceReference.assetId, sourceReference.referenceType)
    : null;
  const sourceAlreadyPresent = sourceKey
    ? sourceReferences.some((item) => canonicalSourceReferenceKey(item.canonicalTradeId ?? item.tradeId, item.assetId ?? item.assetReference, item.referenceType) === sourceKey)
    : false;
  return {
    ...player,
    relationshipReferences: [...relationships, reference],
    sourceReferences: sourceReference && !sourceAlreadyPresent ? [...sourceReferences, sourceReference] : sourceReferences,
    referenceTypes: uniqueSorted([...(Array.isArray(player.referenceTypes) ? player.referenceTypes : []), reference.referenceType]),
    tradeIds: uniqueSorted([...(Array.isArray(player.tradeIds) ? player.tradeIds : []), reference.tradeId]),
    tradeSlugs: uniqueSorted([...(Array.isArray(player.tradeSlugs) ? player.tradeSlugs : []), reference.tradeSlug]),
    publishStatus: "private",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    updatedAt: importedAt,
  };
}

const args = parseArgs(process.argv);
const required = [
  "records-json","partition-json","ready-packages-csv","held-packages-csv","structural-csv",
  "ready-player-shells-csv","held-player-shells-csv",
  "ready-relationships-csv","held-relationships-csv",
  "ready-team-dependencies-csv","held-team-dependencies-csv",
  "ready-dependency-seeds-csv","held-dependency-seeds-csv",
  "ready-identities-csv","held-identities-csv",
  "expected-records-sha256","expected-partition-sha256","expected-partition-internal-sha256",
  "expected-ready-packages-sha256","expected-held-packages-sha256","expected-structural-exclusions-sha256",
  "expected-ready-player-shells-sha256","expected-held-player-shells-sha256",
  "expected-ready-relationships-sha256","expected-held-relationships-sha256",
  "expected-ready-team-dependencies-sha256","expected-held-team-dependencies-sha256",
  "expected-ready-dependency-seeds-sha256","expected-held-dependency-seeds-sha256",
  "expected-ready-identities-sha256","expected-held-identities-sha256",
  "expected-contract-sha256","expected-trade-store-sha256","expected-player-store-sha256","expected-team-store-sha256",
  "imported-at","starting-head","trades-json","players-json","teams-json","receipt-json","contract-md"
];
for (const key of required) assert(args[key], `Missing --${key}`);

const inputPaths = {
  records: args["records-json"],
  partition: args["partition-json"],
  readyPackages: args["ready-packages-csv"],
  heldPackages: args["held-packages-csv"],
  structural: args["structural-csv"],
  readyShells: args["ready-player-shells-csv"],
  heldShells: args["held-player-shells-csv"],
  readyRelationships: args["ready-relationships-csv"],
  heldRelationships: args["held-relationships-csv"],
  readyTeams: args["ready-team-dependencies-csv"],
  heldTeams: args["held-team-dependencies-csv"],
  readyDependencies: args["ready-dependency-seeds-csv"],
  heldDependencies: args["held-dependency-seeds-csv"],
  readyIdentities: args["ready-identities-csv"],
  heldIdentities: args["held-identities-csv"],
};
const expectedInputHashes = {
  records: args["expected-records-sha256"],
  partition: args["expected-partition-sha256"],
  readyPackages: args["expected-ready-packages-sha256"],
  heldPackages: args["expected-held-packages-sha256"],
  structural: args["expected-structural-exclusions-sha256"],
  readyShells: args["expected-ready-player-shells-sha256"],
  heldShells: args["expected-held-player-shells-sha256"],
  readyRelationships: args["expected-ready-relationships-sha256"],
  heldRelationships: args["expected-held-relationships-sha256"],
  readyTeams: args["expected-ready-team-dependencies-sha256"],
  heldTeams: args["expected-held-team-dependencies-sha256"],
  readyDependencies: args["expected-ready-dependency-seeds-sha256"],
  heldDependencies: args["expected-held-dependency-seeds-sha256"],
  readyIdentities: args["expected-ready-identities-sha256"],
  heldIdentities: args["expected-held-identities-sha256"],
};
for (const [key, filePath] of Object.entries(inputPaths)) {
  const actual = await sha256File(filePath);
  assert(actual === expectedInputHashes[key], `${key} input hash mismatch: ${actual}`);
}
assert(await sha256File(args["contract-md"]) === args["expected-contract-sha256"], "Contract hash mismatch.");

const partition = await readJson(inputPaths.partition);
assert(partition.result === "PASS" && partition.phase === "19F" && partition.team === TEAM, "Partition metadata invalid.");
assert(clean(partition.hashes?.semanticPartitionSha256) === args["expected-partition-internal-sha256"], "Partition semantic hash mismatch.");
assert(partition.counts.importReadyPackages === 163 && partition.counts.heldPackages === 31 && partition.counts.structuralEvidenceExclusions === 7, "Partition package counts drifted.");
assert(partition.counts.canonicalPerspectiveAppendPreviews === 92 && partition.counts.canonicalCreatePreviews === 71, "Partition action counts drifted.");
assert(partition.counts.readyRequiredPlayerShells === 69 && partition.counts.heldOnlyPlayerShells === 20, "Partition player shell counts drifted.");
assert(partition.counts.readyRelationshipEdges === 428 && partition.counts.heldRelationshipEdges === 130, "Partition relationship counts drifted.");
assert(partition.counts.readyTeamDependencyOccurrences === 326 && partition.counts.heldTeamDependencyOccurrences === 89, "Partition team counts drifted.");
assert(partition.counts.readyAmbiguousIdentityOccurrences === 0 && partition.counts.heldAmbiguousIdentityOccurrences === 2, "Ambiguous identity partition drifted.");
assert(partition.counts.existingPerspectiveReviewHolds === 0, "Existing perspective holds are not zero.");

const recordsDocument = await readJson(inputPaths.records);
const records = asArrayDocument(recordsDocument, "records");
const readyPackages = await readCsv(inputPaths.readyPackages);
const heldPackages = await readCsv(inputPaths.heldPackages);
const structuralRows = await readCsv(inputPaths.structural);
const readyShells = await readCsv(inputPaths.readyShells);
const heldShells = await readCsv(inputPaths.heldShells);
const readyRelationships = await readCsv(inputPaths.readyRelationships);
const heldRelationships = await readCsv(inputPaths.heldRelationships);
const readyTeams = await readCsv(inputPaths.readyTeams);
const heldTeams = await readCsv(inputPaths.heldTeams);
const readyDependencies = await readCsv(inputPaths.readyDependencies);
const heldDependencies = await readCsv(inputPaths.heldDependencies);
const readyIdentities = await readCsv(inputPaths.readyIdentities);
const heldIdentities = await readCsv(inputPaths.heldIdentities);

assert(records.length === 201, `Expected 201 records; received ${records.length}.`);
assert(readyPackages.length === 163 && heldPackages.length === 31 && structuralRows.length === 7, "CSV package partition drifted.");
assert(readyShells.length === 69 && heldShells.length === 20, "CSV shell partition drifted.");
assert(readyRelationships.length === 428 && heldRelationships.length === 130, "CSV relationship partition drifted.");
assert(readyTeams.length === 326 && heldTeams.length === 89, "CSV team partition drifted.");
assert(readyIdentities.length === 428 && heldIdentities.length === 130, "CSV identity partition drifted.");
assert(readyPackages.every((row) => clean(row["Phase 19F Partition"]) === "IMPORT_READY"), "Non-ready package entered ready CSV.");
assert(readyPackages.every((row) => ["CURRENT_CANONICAL_MATCH","NEW_CANONICAL_CANDIDATE"].includes(clean(row["Canonical Action"]))), "Unsupported ready canonical action.");
assert(readyIdentities.every((row) => clean(row["Identity Status"]) !== "ambiguous-existing-player"), "Ambiguous identity entered ready set.");
assert(heldIdentities.filter((row) => clean(row["Identity Status"]) === "ambiguous-existing-player").length === 2, "Held ambiguous identity count drifted.");
assert(readyTeams.every((row) => ["existing-team-exact","existing-team-historical-alias"].includes(clean(row["Team Status"]))), "Missing team dependency entered ready set.");

const inputHashObject = Object.fromEntries(Object.entries(expectedInputHashes).sort(([a],[b]) => a.localeCompare(b, "en")));

const tradeBytesBefore = await readFile(args["trades-json"]);
const playerBytesBefore = await readFile(args["players-json"]);
const teamBytes = await readFile(args["teams-json"]);
const currentTradeHash = sha256(tradeBytesBefore);
const currentPlayerHash = sha256(playerBytesBefore);
const currentTeamHash = sha256(teamBytes);

if (await fileExists(args["receipt-json"])) {
  const priorReceiptBytes = await readFile(args["receipt-json"]);
  const priorReceipt = JSON.parse(priorReceiptBytes.toString("utf8"));
  const sameInputs = JSON.stringify(priorReceipt.inputHashes ?? {}) === JSON.stringify(inputHashObject);
  if (
    priorReceipt.result === "PASS" &&
    priorReceipt.phase === "19H" &&
    priorReceipt.team === TEAM &&
    priorReceipt.startingHead === args["starting-head"] &&
    sameInputs &&
    priorReceipt.canonicalStoreSha256 === currentTradeHash &&
    priorReceipt.playerStoreSha256 === currentPlayerHash &&
    priorReceipt.teamStoreSha256 === currentTeamHash
  ) {
    console.log(JSON.stringify({
      result:"PASS",
      phase:"19H",
      mode:"IDEMPOTENT_REPLAY",
      canonicalStoreSha256:currentTradeHash,
      playerStoreSha256:currentPlayerHash,
      teamStoreSha256:currentTeamHash,
      receiptSha256:sha256(priorReceiptBytes),
    }, null, 2));
    process.exit(0);
  }
}

assert(currentTradeHash === args["expected-trade-store-sha256"], `Preimport canonical store hash mismatch: ${currentTradeHash}`);
assert(currentPlayerHash === args["expected-player-store-sha256"], `Preimport player store hash mismatch: ${currentPlayerHash}`);
assert(currentTeamHash === args["expected-team-store-sha256"], `Team store hash mismatch: ${currentTeamHash}`);

const trades = JSON.parse(tradeBytesBefore.toString("utf8"));
const players = JSON.parse(playerBytesBefore.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
assert(Array.isArray(trades) && trades.length === 2178, "Expected 2178 baseline canonical trades.");
assert(Array.isArray(players) && players.length === 3027, "Expected 3027 baseline players.");
assert(Array.isArray(teams) && teams.length === 52, "Expected 52 baseline teams.");

const teamSet = new Set(teams.map(teamSlug).filter(Boolean));
assert(teamSet.has(TEAM), "Milwaukee Bucks missing from team registry.");

const recordsById = new Map(records.map((row) => [clean(row.tradeId), row]));
assert(recordsById.size === 201, "Duplicate source Trade IDs.");

const readyIdSet = new Set(readyPackages.map((row) => clean(row["Trade ID"])));
const heldIdSet = new Set(heldPackages.map((row) => clean(row["Trade ID"])));
const excludedIdSet = new Set(structuralRows.map((row) => clean(row["Trade ID"])));
assert(new Set([...readyIdSet,...heldIdSet,...excludedIdSet]).size === 201, "Ready/held/excluded ID coverage drifted.");

const groupByTrade = (rows) => {
  const map = new Map();
  for (const row of rows) {
    const id = clean(row["Trade ID"]);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
};
const dependenciesByTrade = groupByTrade(readyDependencies);
const identitiesByTrade = groupByTrade(readyIdentities);
const relationshipsByTrade = groupByTrade(readyRelationships);
const teamsByTrade = groupByTrade(readyTeams);

const identityLookup = new Map();
for (const row of readyIdentities) {
  const key = identityKey(row);
  if (!identityLookup.has(key)) identityLookup.set(key, []);
  identityLookup.get(key).push(row);
}
function identityForRelationship(row) {
  const key = [clean(row["Dependency Key"]), effectivePlayerId(row["Target Player ID"]), normalize(row["Identity Display"])].join("|");
  const matches = identityLookup.get(key) ?? [];
  assert(matches.length >= 1, `${row["Relationship ID"]}: no matching ready identity occurrence.`);
  const kinds = uniqueSorted(matches.map((item) => clean(item["Identity Kind"])));
  assert(kinds.length === 1, `${row["Relationship ID"]}: matching identity kinds disagree.`);
  return matches.slice().sort((a,b) => Number(a["Identity Ordinal"]) - Number(b["Identity Ordinal"]))[0];
}

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
assert(tradeMap.size === trades.length, "Duplicate canonical trade IDs.");
const playerMap = new Map(players.map((player) => [playerId(player), player]));
assert(playerMap.size === players.length, "Duplicate player IDs.");

const baselinePlayerIds = new Set(playerMap.keys());
const baselineRelationshipOwners = new Map();
const preimportCanonicalSourceReferenceOwners = new Map();
for (const player of players) {
  const pid = playerId(player);
  for (const reference of Array.isArray(player.relationshipReferences) ? player.relationshipReferences : []) {
    const rid = clean(reference?.relationshipId);
    if (!rid) continue;
    assert(!baselineRelationshipOwners.has(rid), `Baseline relationship ID is multiply owned: ${rid}`);
    baselineRelationshipOwners.set(rid, pid);
  }
  for (const sourceReference of Array.isArray(player.sourceReferences) ? player.sourceReferences : []) {
    const key = canonicalSourceReferenceKey(
      sourceReference?.canonicalTradeId ?? sourceReference?.tradeId,
      sourceReference?.assetId ?? sourceReference?.assetReference,
      sourceReference?.referenceType,
    );
    if (key === "||") continue;
    const owner = preimportCanonicalSourceReferenceOwners.get(key);
    assert(!owner || owner === pid, `Baseline canonical source-reference key is multiply owned: ${key}`);
    preimportCanonicalSourceReferenceOwners.set(key, pid);
  }
}
for (const relationship of readyRelationships) {
  assert(!baselineRelationshipOwners.has(clean(relationship["Relationship ID"])), `${relationship["Relationship ID"]}: ready relationship already exists in baseline.`);
}

const aliasesByProposedId = new Map();
for (const identity of readyIdentities) {
  const proposed = clean(identity["Proposed Player ID"]);
  if (!proposed) continue;
  if (!aliasesByProposedId.has(proposed)) aliasesByProposedId.set(proposed, new Set());
  for (const alias of clean(identity["Identity Aliases"]).split(";").map(clean).filter(Boolean)) aliasesByProposedId.get(proposed).add(alias);
}

const createdPlayerIds = [];
const resolvedExistingPlayerOverrides = [];
for (const shell of readyShells) {
  const id = clean(shell["Proposed Player ID"]);
  assert(id, "Ready shell missing Proposed Player ID.");
  const override = EXACT_EXISTING_PLAYER_OVERRIDES.get(id) ?? null;
  if (override) {
    assert(!playerMap.has(id), `${id}: proposed override shell unexpectedly already exists in baseline.`);
    assert(playerMap.has(override), `${id}: exact-identity override target missing from baseline: ${override}`);
    resolvedExistingPlayerOverrides.push({ proposedPlayerId:id, existingPlayerId:override });
    continue;
  }
  assert(!playerMap.has(id), `${id}: ready proposed player ID already exists in baseline; explicit identity review required.`);
  const player = createPlayerShell(shell, [...(aliasesByProposedId.get(id) ?? new Set())], args["imported-at"]);
  playerMap.set(id, player);
  createdPlayerIds.push(id);
}
assert(createdPlayerIds.length === 66, `Expected 66 player shells created; received ${createdPlayerIds.length}.`);
assert(resolvedExistingPlayerOverrides.length === 3, `Expected 3 exact existing-player overrides; received ${resolvedExistingPlayerOverrides.length}.`);

for (const identity of readyIdentities) {
  const originalTarget = clean(identity["Target Player ID"]);
  const target = effectivePlayerId(originalTarget);
  assert(target && playerMap.has(target), `${identity["Trade ID"]}: ready identity target missing after shell resolution: ${originalTarget} -> ${target}`);
}
for (const shell of heldShells) {
  const id = clean(shell["Proposed Player ID"]);
  assert(!baselinePlayerIds.has(id), `${id}: held-only proposed shell unexpectedly existed in baseline.`);
  assert(!playerMap.has(id), `${id}: held-only proposed shell was created.`);
}

const importedCanonicalTradeIds = [];
const updatedPerspectiveCanonicalIds = [];
const protectedAppendProjectionHashes = {};
const packageByTrade = new Map(readyPackages.map((row) => [clean(row["Trade ID"]), row]));

for (const packageRecord of readyPackages.slice().sort((a,b) => Number(a["Source Row"]) - Number(b["Source Row"]))) {
  const sourceId = clean(packageRecord["Trade ID"]);
  const record = recordsById.get(sourceId);
  assert(record, `${sourceId}: source record missing.`);
  const action = clean(packageRecord["Canonical Action"]);
  let trade;
  if (action === "NEW_CANONICAL_CANDIDATE") {
    trade = buildNewTrade({
      packageRecord,
      record,
      dependencyRows: dependenciesByTrade.get(sourceId) ?? [],
      identityRows: identitiesByTrade.get(sourceId) ?? [],
      relationshipRows: relationshipsByTrade.get(sourceId) ?? [],
      teamRows: teamsByTrade.get(sourceId) ?? [],
      importedAt: args["imported-at"],
      playerMap,
    });
    assert(!tradeMap.has(trade.id), `${sourceId}: deterministic canonical ID already exists: ${trade.id}`);
    for (const team of trade.teams) assert(teamSet.has(team), `${sourceId}: unknown team slug ${team}.`);
    tradeMap.set(trade.id, trade);
    importedCanonicalTradeIds.push(trade.id);
  } else {
    assert(action === "CURRENT_CANONICAL_MATCH", `${sourceId}: unsupported import action ${action}.`);
    const targetId = clean(packageRecord["Canonical ID"]);
    assert(targetId, `${sourceId}: canonical-match package has no Canonical ID.`);
    const existing = tradeMap.get(targetId);
    assert(existing, `${sourceId}: perspective target missing: ${targetId}`);
    assert(sourcePerspectiveCount(existing, TEAM) === 0, `${sourceId}: perspective target already has Milwaukee perspective.`);
    protectedAppendProjectionHashes[targetId] = sha256(canonicalJson(immutableTradeProjection(existing)));
    trade = appendBucksPerspective(existing, record, args["imported-at"]);
    assert(sha256(canonicalJson(immutableTradeProjection(trade))) === protectedAppendProjectionHashes[targetId], `${sourceId}: protected append projection drifted.`);
    tradeMap.set(targetId, trade);
    updatedPerspectiveCanonicalIds.push(targetId);
  }
}
assert(importedCanonicalTradeIds.length === 71, `Expected 71 canonical creates; received ${importedCanonicalTradeIds.length}.`);
assert(updatedPerspectiveCanonicalIds.length === 92, `Expected 92 perspective appends; received ${updatedPerspectiveCanonicalIds.length}.`);

let matchedExistingAssetReferences = 0;
let syntheticPerspectiveAssetReferences = 0;
let sourceReferencesAdded = 0;
const ownershipConflictSyntheticRelationshipIds = [];
const ownershipConflictSyntheticDetails = [];
const syntheticRelationshipIds = [];
const relationshipIds = [];

for (const relationship of readyRelationships.slice().sort((a,b) => Number(a["Relationship Ordinal"]) - Number(b["Relationship Ordinal"]))) {
  const sourceId = clean(relationship["Trade ID"]);
  const packageRecord = packageByTrade.get(sourceId);
  assert(packageRecord, `${relationship["Relationship ID"]}: package missing.`);
  const identity = identityForRelationship(relationship);
  const targetPlayerId = effectivePlayerId(relationship["Target Player ID"]);
  let player = playerMap.get(targetPlayerId);
  assert(player, `${relationship["Relationship ID"]}: target player missing: ${targetPlayerId}`);

  const trade = clean(packageRecord["Canonical Action"]) === "NEW_CANONICAL_CANDIDATE"
    ? tradeMap.get(canonicalIdForSource(sourceId))
    : tradeMap.get(clean(packageRecord["Canonical ID"]));
  assert(trade, `${relationship["Relationship ID"]}: canonical trade missing.`);

  const kind = clean(identity["Identity Kind"]);
  const refType = referenceType(kind);
  let assetReference;

  if (clean(packageRecord["Canonical Action"]) === "NEW_CANONICAL_CANDIDATE") {
    const dependencyKey = clean(relationship["Dependency Key"]);
    const asset = (trade.assetLedger ?? []).find((item) => clean(item.dependencyKey) === dependencyKey);
    assert(asset && clean(asset.assetId), `${relationship["Relationship ID"]}: created canonical asset is missing for dependency ${dependencyKey}.`);
    assetReference = { assetId: clean(asset.assetId), sourceAssetId: clean(asset.assetId), synthetic:false };
  } else {
    assetReference = resolveRelationshipAssetReference(trade, relationship, identity, player);
    if (!assetReference.synthetic) {
      const sourceKey = canonicalSourceReferenceKey(trade.id, assetReference.assetId, refType);
      const owner = preimportCanonicalSourceReferenceOwners.get(sourceKey) ?? null;
      if (owner && owner !== targetPlayerId) {
        ownershipConflictSyntheticRelationshipIds.push(clean(relationship["Relationship ID"]));
        ownershipConflictSyntheticDetails.push({
          relationshipId: clean(relationship["Relationship ID"]),
          sourceTradeId: sourceId,
          canonicalTradeId: trade.id,
          matchedCanonicalAssetId: assetReference.assetId,
          referenceType: refType,
          existingOwnerPlayerId: owner,
          frozenTargetPlayerId: targetPlayerId,
          reason: "matched canonical source-reference key already owned by different pre-import player",
        });
        assetReference = syntheticAssetReference(relationship, identity);
      }
    }
  }

  if (assetReference.synthetic) {
    syntheticPerspectiveAssetReferences += 1;
    syntheticRelationshipIds.push(clean(relationship["Relationship ID"]));
  } else {
    matchedExistingAssetReferences += 1;
  }

  const reference = {
    relationshipId: clean(relationship["Relationship ID"]),
    referenceType: refType,
    relationshipRole: relationRole(kind),
    tradeId: trade.id,
    canonicalTradeId: trade.id,
    tradeSlug: clean(trade.slug),
    assetId: assetReference.assetId,
    assetReference: assetReference.assetId,
    sourceAssetId: assetReference.sourceAssetId,
    sourceTradeId: sourceId,
    packageId: `${BATCH}-${sourceId}`,
    sourceTeam: TEAM,
    perspectiveLocalAssetReference: assetReference.synthetic,
    privateOnly: true,
  };

  const matchedAsset = assetReference.synthetic ? null : (trade.assetLedger ?? []).find((item) => clean(item.assetId) === assetReference.assetId) ?? null;
  const sourceReference = matchedAsset && expectedReferenceTypesForAsset(matchedAsset).includes(refType)
    ? {
        referenceType: refType,
        canonicalTradeId: trade.id,
        sourceTradeId: clean(trade.sourceTradeId),
        assetId: assetReference.assetId,
        assetType: matchedAsset.type ?? null,
        sourceTeam: TEAM,
        privateOnly: true,
      }
    : null;

  const sourceCountBefore = Array.isArray(player.sourceReferences) ? player.sourceReferences.length : 0;
  player = appendRelationshipReference(player, reference, sourceReference, args["imported-at"]);
  const sourceCountAfter = Array.isArray(player.sourceReferences) ? player.sourceReferences.length : 0;
  sourceReferencesAdded += sourceCountAfter - sourceCountBefore;
  playerMap.set(targetPlayerId, player);
  relationshipIds.push(clean(relationship["Relationship ID"]));
}
assert(relationshipIds.length === 428, `Expected 428 relationship references written; received ${relationshipIds.length}.`);
assert(matchedExistingAssetReferences + syntheticPerspectiveAssetReferences === 428, "Asset reference partition does not equal 428.");

const finalTrades = [...tradeMap.values()];
const finalPlayers = [...playerMap.values()];
assert(finalTrades.length === 2249, `Expected 2249 canonical trades; received ${finalTrades.length}.`);
assert(finalPlayers.length === 3093, `Expected 3093 players; received ${finalPlayers.length}.`);

for (const sourceId of [...heldIdSet, ...excludedIdSet]) {
  for (const trade of finalTrades) {
    assert(clean(trade.sourceTradeId) !== sourceId, `${sourceId}: held/excluded source was created canonically.`);
    const perspectives = trade.perspectives;
    if (Array.isArray(perspectives)) {
      assert(!perspectives.some((p) => clean(p?.sourceTeam) === TEAM && clean(p?.sourceTradeId) === sourceId), `${sourceId}: held/excluded perspective was written.`);
    } else if (perspectives && typeof perspectives === "object" && perspectives[TEAM]) {
      assert(clean(perspectives[TEAM]?.sourceTradeId) !== sourceId, `${sourceId}: held/excluded object perspective was written.`);
    }
  }
}
const allRelationshipIds = new Set(finalPlayers.flatMap((player) => (Array.isArray(player.relationshipReferences) ? player.relationshipReferences : []).map((r) => clean(r.relationshipId)).filter(Boolean)));
for (const held of heldRelationships) assert(!allRelationshipIds.has(clean(held["Relationship ID"])), `${held["Relationship ID"]}: held relationship was written.`);
for (const shell of heldShells) assert(!playerMap.has(clean(shell["Proposed Player ID"])), `${shell["Proposed Player ID"]}: held-only shell was written.`);

const tradeOut = canonicalJson(finalTrades);
const playerOut = canonicalJson(finalPlayers);
const teamOut = canonicalJson(teams);

const receipt = {
  result: "PASS",
  phase: "19H",
  mode: "GUARDED_PRIVATE_IMPORT",
  team: TEAM,
  startingHead: args["starting-head"],
  importedAt: args["imported-at"],
  inputHashes: inputHashObject,
  expectedContractSha256: args["expected-contract-sha256"],
  preImportCanonicalTrades: 2178,
  preImportPlayers: 3027,
  preImportTeams: 52,
  readyPackages: 163,
  heldPackages: 31,
  structuralEvidenceExclusions: 7,
  canonicalTradesCreated: 71,
  perspectivesAppended: 92,
  playerShellsCreated: 66,
  readyShellsResolvedToExistingPlayers: 3,
  heldOnlyPlayerShellsDeferred: 20,
  relationshipReferencesAdded: 428,
  heldRelationshipEdgesDeferred: 130,
  readyTeamDependencies: 326,
  effectiveReadyTeamDependencies: 326,
  heldTeamDependencies: 89,
  existingPerspectiveReviewHolds: 0,
  ambiguousIdentityOccurrencesDeferred: 2,
  matchedExistingAssetReferences,
  syntheticPerspectiveAssetReferences,
  ownershipConflictSyntheticRelationshipIds: uniqueSorted(ownershipConflictSyntheticRelationshipIds),
  ownershipConflictSyntheticDetails,
  syntheticRelationshipIds: uniqueSorted(syntheticRelationshipIds),
  sourceReferencesAdded,
  postImportCanonicalTrades: finalTrades.length,
  postImportPlayers: finalPlayers.length,
  postImportTeams: teams.length,
  exactExistingPlayerOverrides: resolvedExistingPlayerOverrides,
  importedCanonicalTradeIds: uniqueSorted(importedCanonicalTradeIds),
  updatedPerspectiveCanonicalIds: uniqueSorted(updatedPerspectiveCanonicalIds),
  createdPlayerIds: uniqueSorted(createdPlayerIds),
  relationshipIds: uniqueSorted(relationshipIds),
  deferredRelationshipIds: uniqueSorted(heldRelationships.map((row) => clean(row["Relationship ID"]))),
  heldSourceTradeIds: uniqueSorted([...heldIdSet]),
  structuralEvidenceExcludedSourceTradeIds: uniqueSorted([...excludedIdSet]),
  protectedAppendProjectionHashes,
  canonicalStoreSha256: sha256(tradeOut),
  playerStoreSha256: sha256(playerOut),
  teamStoreSha256: sha256(teamOut),
  repositoryDataWrites: 3,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  automaticPlayerCreates: 0,
  automaticRoutes: 0,
  automaticTeamRegistrations: 0,
  heldPackageImports: 0,
  heldPlayerShellImports: 0,
  heldRelationshipWrites: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};
const receiptOut = canonicalJson(receipt);

await atomicWrite(args["trades-json"], tradeOut, "phase19h-trades");
await atomicWrite(args["players-json"], playerOut, "phase19h-players");
await atomicWrite(args["receipt-json"], receiptOut, "phase19h-receipt");

console.log(JSON.stringify({
  result: receipt.result,
  phase: receipt.phase,
  mode: receipt.mode,
  readyPackages: receipt.readyPackages,
  heldPackages: receipt.heldPackages,
  structuralEvidenceExclusions: receipt.structuralEvidenceExclusions,
  canonicalTradesCreated: receipt.canonicalTradesCreated,
  perspectivesAppended: receipt.perspectivesAppended,
  playerShellsCreated: receipt.playerShellsCreated,
  readyShellsResolvedToExistingPlayers: receipt.readyShellsResolvedToExistingPlayers,
  heldOnlyPlayerShellsDeferred: receipt.heldOnlyPlayerShellsDeferred,
  relationshipReferencesAdded: receipt.relationshipReferencesAdded,
  heldRelationshipEdgesDeferred: receipt.heldRelationshipEdgesDeferred,
  readyTeamDependencies: receipt.readyTeamDependencies,
  heldTeamDependencies: receipt.heldTeamDependencies,
  existingPerspectiveReviewHolds: receipt.existingPerspectiveReviewHolds,
  ambiguousIdentityOccurrencesDeferred: receipt.ambiguousIdentityOccurrencesDeferred,
  matchedExistingAssetReferences: receipt.matchedExistingAssetReferences,
  syntheticPerspectiveAssetReferences: receipt.syntheticPerspectiveAssetReferences,
  ownershipConflictSyntheticReferences: receipt.ownershipConflictSyntheticRelationshipIds.length,
  sourceReferencesAdded: receipt.sourceReferencesAdded,
  canonicalStoreSha256: receipt.canonicalStoreSha256,
  playerStoreSha256: receipt.playerStoreSha256,
  teamStoreSha256: receipt.teamStoreSha256,
  receiptSha256: sha256(receiptOut),
}, null, 2));
