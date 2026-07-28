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
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
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
function slugify(value) {
  return normalize(value).replace(/\s+/gu, "-") || "unknown";
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
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
function seasonStartYear(date) {
  const year = Number(String(date).slice(0, 4));
  const month = Number(String(date).slice(5, 7));
  return month >= 6 ? year : year - 1;
}
function seasonLabel(date) {
  const start = seasonStartYear(date);
  return `${start}-${String(start + 1).slice(-2)}`;
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows
    .slice(1)
    .filter((values) => values.some((value) => value !== ""))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    );
}
async function atomicWrite(targetPath, bytes, label) {
  const absolute = path.resolve(targetPath);
  const directory = path.dirname(absolute);
  const temporary = path.join(
    directory,
    `.${path.basename(absolute)}.${label}.${process.pid}.tmp`,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, bytes);
  try {
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
function countTeamMemberships(trades) {
  return trades.reduce(
    (total, trade) => total + uniqueSorted(Array.isArray(trade.teams) ? trade.teams : []).length,
    0,
  );
}
function countRelationshipReferences(players) {
  return players.reduce(
    (total, player) => total + (Array.isArray(player.relationshipReferences) ? player.relationshipReferences.length : 0),
    0,
  );
}
function countSourceReferences(players) {
  return players.reduce(
    (total, player) => total + (Array.isArray(player.sourceReferences) ? player.sourceReferences.length : 0),
    0,
  );
}
function sourcePerspectiveCount(trade, team) {
  const perspectives = trade.perspectives;
  if (Array.isArray(perspectives)) {
    return perspectives.filter(
      (perspective) =>
        clean(
          perspective?.sourceTeam ??
            perspective?.teamId ??
            perspective?.team ??
            perspective?.perspectiveTeam,
        ) === team,
    ).length;
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
function splitAssets(value) {
  return clean(value)
    .replace(/\r/gu, "\n")
    .replace(/[\u2022\u25CF\u25AA]/gu, ";")
    .replace(/\n+/gu, ";")
    .split(";")
    .map(clean)
    .filter(Boolean);
}
function relationshipDependencyKey(row) {
  const explicit = clean(row["Dependency Key"]);
  if (explicit) return explicit;
  const edge = clean(row["Relationship Edge Key"]);
  const marker = edge.indexOf(":identity:");
  assert(marker > 0, `${edge}: unable to derive dependency key from relationship edge.`);
  return edge.slice(0, marker);
}
function relationRole(kind) {
  if (kind === "draft-outcome-player") return "pick-became-player";
  if (kind.includes("rights")) return kind.startsWith("free-agent") ? "free-agent-rights-player" : "draft-rights-player";
  return "traded-player";
}
function referenceType(kind) {
  if (kind === "draft-outcome-player") return "draft_outcome";
  if (kind.includes("rights")) return "draft_rights";
  return "direct_player";
}
function assetType(kind, rawAsset) {
  if (kind === "direct-player") return "player";
  if (kind === "draft-outcome-player") return "draft_pick";
  if (kind.includes("rights")) return "draft_rights";
  if (kind === "draft-pick-mechanism") return "draft_pick";
  if (kind === "pick-swap") return "pick_swap";
  if (kind === "cash-consideration") return "cash";
  if (kind === "trade-exception") return "trade_exception";
  if (kind === "future-consideration") return "future_consideration";
  if (kind === "unnamed-player-mechanism") return "conditional_asset";
  const normalized = normalize(rawAsset);
  if (/\bcash\b/u.test(normalized)) return "cash";
  if (/\btrade exception\b|\btpe\b/u.test(normalized)) return "trade_exception";
  if (/\bswap\b/u.test(normalized)) return "pick_swap";
  if (/\bdraft rights\b|\brights to\b/u.test(normalized)) return "draft_rights";
  if (/\bpick\b|\bselection\b|\bround\b/u.test(normalized)) return "draft_pick";
  if (/\bconsideration\b/u.test(normalized)) return "future_consideration";
  return "other";
}
function perspectiveGrades(record, partner) {
  const grades = {};
  const warriors = clean(record["Rockets Grade"]);
  const aggregate = clean(record["Partner Aggregate Grade"]);
  if (warriors) grades["houston-rockets"] = warriors;
  if (aggregate) {
    grades.partnerAggregate = aggregate;
    if (partner) grades[partner] = aggregate;
  }
  return grades;
}
function houstonPerspective(record, teams) {
  const partner = teams.find((team) => team !== "houston-rockets") ?? null;
  return {
    sourceTeam: "houston-rockets",
    sourceBatchId: "houston-rockets-phase-13h",
    sourceTradeId: clean(record["Trade ID"]),
    sourcePerspectiveKey: `houston-rockets:${clean(record["Trade ID"])}`,
    summary: clean(record["Final Trade Summary"]),
    analysis: clean(record["Final Trade Analysis"]),
    verdict: clean(record["Final Verdict"]),
    grades: perspectiveGrades(record, partner),
    aggregatePartnerGrade: clean(record["Partner Aggregate Grade"]) || null,
    confidence: clean(record["Confidence"]).toLowerCase(),
    reviewStatus: clean(record["Review Status"]) || "manual-review",
    contentClass: clean(record["Content Class"]),
    lowValueQa: clean(record["Low-Value QA"]),
    outcomeScore: clean(record["Outcome Score"]),
    winner: clean(record["Winner"]),
    gradeRationale: clean(record["Grade Rationale"]),
    reviewerNotes: clean(record["Reviewer Notes"]),
    primarySourceLabel: clean(record["Primary Source Label"]) || null,
    primarySourceUrl: clean(record["Primary Source URL"]) || null,
    secondarySourceLabel: clean(record["Secondary Source Label"]) || null,
    secondarySourceUrl: clean(record["Secondary Source URL"]) || null,
    privateOnly: true,
    publishStatus: "private",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  };
}
function appendHoustonPerspective(existingTrade, record, importedAt) {
  const protectedBefore = JSON.stringify(immutableTradeProjection(existingTrade));
  assert(
    sourcePerspectiveCount(existingTrade, "houston-rockets") === 0,
    `${record["Trade ID"]}: Houston perspective already exists.`,
  );
  const teams = uniqueSorted(existingTrade.teams ?? []);
  const perspective = houstonPerspective(record, teams);
  let perspectives;
  if (Array.isArray(existingTrade.perspectives)) {
    perspectives = [...existingTrade.perspectives, perspective];
  } else if (existingTrade.perspectives && typeof existingTrade.perspectives === "object") {
    perspectives = {
      ...existingTrade.perspectives,
      "houston-rockets": {
        sourceSubmissionId: `houston-rockets-phase-13h-${clean(record["Trade ID"])}`,
        sourceTradeId: clean(record["Trade ID"]),
        editorialStatus: "private-imported-golden-state-phase-13h",
        grade: clean(record["Rockets Grade"]),
        verdict: clean(record["Final Verdict"]),
        summary: clean(record["Final Trade Summary"]),
        analysis: clean(record["Final Trade Analysis"]),
        confidence: clean(record["Confidence"]),
        reviewStatus: clean(record["Review Status"]) || "manual-review",
        contentClass: clean(record["Content Class"]),
        lowValueQa: clean(record["Low-Value QA"]),
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
  const mergedGrades = { ...(existingTrade.grades ?? {}) };
  const warriorsGrade = clean(record["Rockets Grade"]);
  const partnerGrade = clean(record["Partner Aggregate Grade"]);
  if (warriorsGrade) mergedGrades["houston-rockets"] = warriorsGrade;
  if (partnerGrade && !mergedGrades.partnerAggregate) mergedGrades.partnerAggregate = partnerGrade;

  const updated = {
    ...existingTrade,
    sourceTeams: uniqueSorted([
      ...(Array.isArray(existingTrade.sourceTeams) ? existingTrade.sourceTeams : []),
      "houston-rockets",
    ]),
    perspectives,
    grades: mergedGrades,
    perspectiveReconciliations: [
      ...(Array.isArray(existingTrade.perspectiveReconciliations)
        ? existingTrade.perspectiveReconciliations
        : []),
      {
        sourceBatchId: "houston-rockets-phase-13h",
        sourceTradeId: clean(record["Trade ID"]),
        packageId: `houston-rockets-phase-13h-${clean(record["Trade ID"])}`,
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
  assert(
    JSON.stringify(immutableTradeProjection(updated)) === protectedBefore,
    `${record["Trade ID"]}: perspective append altered protected canonical fields.`,
  );
  assert(
    sourcePerspectiveCount(updated, "houston-rockets") === 1,
    `${record["Trade ID"]}: Houston perspective append count drifted.`,
  );
  return updated;
}
function canonicalIdForSource(sourceTradeId) {
  const match = clean(sourceTradeId).match(/^HOU-(\d{4})-(\d{4})$/u);
  assert(match, `Invalid Houston source Trade ID: ${sourceTradeId}`);
  return `nba-trade-hou-${match[1]}-${match[2]}`;
}
function makeAssetId(sourceTradeId, side, assetIndex, rawAsset, fromTeam, toTeam) {
  return `phase13h-asset-${sha256(
    [sourceTradeId, side, assetIndex, rawAsset, fromTeam, toTeam].join("|"),
  )
    .slice(0, 20)
    .toLowerCase()}`;
}
function buildNewTrade({ packageRecord, record, dependencyRows, relationshipRows, importedAt, playerMap }) {
  const sourceTradeId = clean(record["Trade ID"]);
  const partner = clean(record["Counterpart Slugs"]);
  assert(partner && !partner.includes(","), `${sourceTradeId}: ready package must have exactly one counterpart slug.`);
  const teams = uniqueSorted(["houston-rockets", partner]);
  assert(teams.length === 2, `${sourceTradeId}: ready package must contain exactly two teams.`);
  const relationshipsByDependency = new Map();
  for (const relationship of relationshipRows) {
    const key = relationshipDependencyKey(relationship);
    if (!relationshipsByDependency.has(key)) relationshipsByDependency.set(key, []);
    relationshipsByDependency.get(key).push(relationship);
  }
  const assets = dependencyRows
    .slice()
    .sort((left, right) => Number(left["Dependency Ordinal"]) - Number(right["Dependency Ordinal"]))
    .map((dependency) => {
      const side = clean(dependency.Side);
      const rawAsset = clean(dependency["Raw Asset"]);
      const fromTeam = side === "received" ? partner : "houston-rockets";
      const toTeam = side === "received" ? "houston-rockets" : partner;
      const linked = relationshipsByDependency.get(clean(dependency["Dependency Key"])) ?? [];
      const kind = clean(dependency["Dependency Kind"]);
      const asset = {
        assetId: makeAssetId(
          sourceTradeId,
          side,
          Number(dependency["Asset Index"]),
          rawAsset,
          fromTeam,
          toTeam,
        ),
        type: assetType(kind, rawAsset),
        displayText: rawAsset,
        asset: rawAsset,
        fromTeam,
        toTeam,
        direction: side,
        sourceTeam: "houston-rockets",
        edgeClass: "houston-source-route",
        routingStatus: "resolved",
        routingMethod: "two-team-direct",
        possibleFromTeams: [],
        possibleToTeams: [],
        privateOnly: true,
        previewOnly: false,
        auditStatus: "private-imported-golden-state-phase-13h",
      };
      if (linked.length > 0) {
        asset.playerRelationshipIds = linked.map((row) => clean(row["Relationship Edge Key"]));
        asset.playerIds = linked.map((row) => clean(row["Target Player Key"]));
        if (linked.length === 1) {
          const relationship = linked[0];
          const targetId = clean(relationship["Target Player Key"]);
          const player = playerMap.get(targetId);
          assert(player, `${sourceTradeId}: target player is missing while constructing asset ${rawAsset}.`);
          const displayName = clean(player.displayName ?? player.name ?? relationship["Player Name"]);
          const identityKind = clean(relationship["Identity Kind"]);
          if (identityKind === "draft-outcome-player") {
            asset.becamePlayerName = displayName;
            asset.becamePlayerId = targetId;
          } else {
            asset.playerName = displayName;
            asset.playerId = targetId;
            asset.playerRelationshipRole = relationRole(identityKind);
          }
        }
      }
      return asset;
    });
  const byReceived = Object.fromEntries(
    teams.map((team) => [team, assets.filter((asset) => asset.toTeam === team)]),
  );
  const bySent = Object.fromEntries(
    teams.map((team) => [team, assets.filter((asset) => asset.fromTeam === team)]),
  );
  const perspective = houstonPerspective(record, teams);
  const canonicalId = canonicalIdForSource(sourceTradeId);
  const tradeDate = clean(record["Trade Date"]);
  const sources = [
    clean(record["Primary Source URL"])
      ? {
          sourceType: "primary_url",
          label: clean(record["Primary Source Label"]) || null,
          url: clean(record["Primary Source URL"]),
          sourceTeam: "houston-rockets",
          privateOnly: true,
        }
      : null,
    clean(record["Secondary Source URL"])
      ? {
          sourceType: "secondary_url",
          label: clean(record["Secondary Source Label"]) || null,
          url: clean(record["Secondary Source URL"]),
          sourceTeam: "houston-rockets",
          privateOnly: true,
        }
      : null,
  ].filter(Boolean);
  if (sources.length === 0) {
    sources.push({
      sourceType: "reconciled_workbook",
      label: clean(record["Primary Source Label"]) || "Houston reconciled audit workbook",
      sourceTradeId,
      sourceTeam: "houston-rockets",
      privateOnly: true,
    });
  }
  return {
    id: canonicalId,
    tradeId: canonicalId,
    sourceTradeId,
    canonicalKey: canonicalId,
    slug: `houston-rockets-trade-${tradeDate}-${sourceTradeId.split("-").at(-1)}`,
    league: "nba",
    tradeDate,
    date: tradeDate,
    seasonLabel: seasonLabel(tradeDate),
    season: seasonStartYear(tradeDate),
    teams,
    sourceTeamLabels: uniqueSorted([
      clean(record["Franchise Label"]) || "Houston Warriors",
      clean(record["Partner Team(s)"]),
    ]),
    assetsReceived: byReceived,
    assetsSent: bySent,
    assetsSentByTeam: bySent,
    assetLedger: assets,
    sourceTeams: ["houston-rockets"],
    perspectives: { "houston-rockets": perspective },
    grades: perspective.grades,
    verdict: clean(record["Final Verdict"]),
    summary: clean(record["Final Trade Summary"]),
    analysis: clean(record["Final Trade Analysis"]),
    confidence: clean(record["Confidence"]).toLowerCase(),
    contentClass: clean(record["Content Class"]),
    canonicalAction: clean(packageRecord.canonicalAction),
    dateCollisionResolvedAsDistinctCreate: packageRecord.dateCollisionResolvedAsDistinctCreate === true,
    canonicalKeyVersion: 1,
    dateTeamsKey: `${tradeDate}|${teams.join("|")}`,
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-imported-golden-state-phase-13h",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    sources,
    perspectiveReconciliations: [
      {
        sourceBatchId: "houston-rockets-phase-13h",
        sourceTradeId,
        packageId: `houston-rockets-phase-13h-${sourceTradeId}`,
        method: packageRecord.dateCollisionResolvedAsDistinctCreate
          ? "frozen-same-date-distinct-canonical-create"
          : "frozen-new-canonical-create",
        importedAt,
        automaticMerge: false,
      },
    ],
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}
function createPlayerShell(shell, importedAt) {
  const id = clean(shell["Proposed Player ID"]);
  const displayName = clean(shell["Player Name"]);
  assert(id, "A frozen player shell has an empty ID.");
  assert(displayName, `${id}: frozen player shell has an empty name.`);
  const alternates = clean(shell["Alternate Display Names"])
    .split(";")
    .map(clean)
    .filter(Boolean);
  return {
    id,
    playerId: id,
    slug: slugify(displayName),
    displayName,
    name: displayName,
    fullName: displayName,
    playerName: displayName,
    normalizedName: clean(shell["Normalized Player Name"]) || normalize(displayName),
    league: "nba",
    aliases: uniqueSorted(alternates.filter((value) => normalize(value) !== normalize(displayName))),
    referenceTypes: [],
    tradeIds: [],
    tradeSlugs: [],
    relationshipReferences: [],
    sourceReferences: [],
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-shell-imported-golden-state-phase-13h",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}
function expectedReferenceTypesForAsset(asset) {
  const types = [];
  if (asset?.type === "player") types.push("direct_player");
  if (asset?.type === "draft_rights") types.push("draft_rights");
  if (clean(asset?.becamePlayerName)) types.push("draft_outcome");
  return types;
}
function assetMatchScore(asset, relationship, player) {
  const targetPlayerId = clean(relationship["Target Player Key"]);
  if ([asset.playerId, asset.becamePlayerId, asset.targetPlayerId].map(clean).includes(targetPlayerId)) {
    return 100;
  }
  const displayName = normalize(player?.displayName ?? player?.name ?? relationship["Player Name"]);
  for (const field of ["playerName", "becamePlayerName", "displayText", "asset", "auditSourceText"]) {
    const value = normalize(asset?.[field]);
    if (displayName && value.includes(displayName)) return 80;
  }
  const rawAsset = normalize(relationship["Raw Asset"]);
  const displayText = normalize(asset.displayText ?? asset.asset ?? asset.auditSourceText);
  if (rawAsset && displayText) {
    if (rawAsset === displayText) return 70;
    if (rawAsset.includes(displayText) || displayText.includes(rawAsset)) return 60;
  }
  return 0;
}
function assetMatchesHoustonSide(asset, side) {
  const possibleFrom = Array.isArray(asset.possibleFromTeams) ? asset.possibleFromTeams : [];
  const possibleTo = Array.isArray(asset.possibleToTeams) ? asset.possibleToTeams : [];
  if (side === "received") {
    return clean(asset.toTeam) === "houston-rockets" || possibleTo.includes("houston-rockets");
  }
  return clean(asset.fromTeam) === "houston-rockets" || possibleFrom.includes("houston-rockets");
}
function resolveRelationshipAssetReference(trade, relationship, player) {
  const assets = Array.isArray(trade.assetLedger) ? trade.assetLedger : [];
  const candidates = assets
    .map((asset) => ({
      asset,
      score: assetMatchScore(asset, relationship, player),
      sideMatch: assetMatchesHoustonSide(asset, clean(relationship.Side)),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        Number(right.sideMatch) - Number(left.sideMatch) ||
        right.score - left.score ||
        clean(left.asset.assetId).localeCompare(clean(right.asset.assetId), "en"),
    );
  if (candidates.length > 0 && clean(candidates[0].asset.assetId)) {
    return {
      assetId: clean(candidates[0].asset.assetId),
      sourceAssetId: clean(candidates[0].asset.assetId),
      synthetic: false,
    };
  }
  return {
    assetId: `phase13h-perspective-asset-${sha256(
      [
        relationship["Trade ID"],
        relationship.Side,
        relationship["Raw Asset"],
        relationship["Target Player Key"],
      ].join("|"),
    )
      .slice(0, 20)
      .toLowerCase()}`,
    sourceAssetId: null,
    synthetic: true,
  };
}
function appendRelationshipReference(player, reference, sourceReference) {
  const relationships = Array.isArray(player.relationshipReferences) ? player.relationshipReferences : [];
  assert(
    !relationships.some((item) => clean(item.relationshipId) === clean(reference.relationshipId)),
    `${reference.relationshipId}: relationship already exists before first import.`,
  );
  const sourceReferences = Array.isArray(player.sourceReferences) ? player.sourceReferences : [];
  const sourceKey = sourceReference
    ? `${sourceReference.canonicalTradeId}|${sourceReference.assetId}|${sourceReference.referenceType}`
    : null;
  const hasSource = sourceKey
    ? sourceReferences.some(
        (item) =>
          clean(item.canonicalTradeId) === clean(sourceReference.canonicalTradeId) ||
          `${clean(item.canonicalTradeId)}|${clean(item.assetId)}|${clean(item.referenceType)}` === sourceKey,
      )
    : false;
  return {
    ...player,
    aliases: Array.isArray(player.aliases) ? player.aliases : [],
    referenceTypes: uniqueSorted([
      ...(Array.isArray(player.referenceTypes) ? player.referenceTypes : []),
      clean(reference.referenceType),
    ]),
    tradeIds: uniqueSorted([
      ...(Array.isArray(player.tradeIds) ? player.tradeIds : []),
      clean(reference.tradeId),
    ]),
    tradeSlugs: uniqueSorted([
      ...(Array.isArray(player.tradeSlugs) ? player.tradeSlugs : []),
      clean(reference.tradeSlug),
    ]),
    relationshipReferences: [...relationships, reference],
    sourceReferences: sourceReference && !hasSource
      ? [...sourceReferences, sourceReference]
      : sourceReferences,
  };
}



const PHASE13H_EXISTING_PLAYER_TARGET_OVERRIDES = new Map([
  ["nba-player-d-j-augustin", "nba-player-dj-augustin-7b32f3fe01"],
  ["nba-player-dwight-jones", "nba-player-dwight-jones-elmo-8cc879edc8"],
]);
const PHASE13H_REDUNDANT_READY_SHELL_IDS = new Set([
  "nba-player-veteran-free-agent-lester-conner",
]);
const PHASE13H_REDUNDANT_READY_RELATIONSHIP_IDS = new Set([
  "houston-rockets:HOU-1987-0064:received:001:identity:01:player:nba-player-veteran-free-agent-lester-conner",
]);
function phase13HCorrectRelationship(row) {
  const relationshipId = clean(row["Relationship Edge Key"]);
  if (PHASE13H_REDUNDANT_READY_RELATIONSHIP_IDS.has(relationshipId)) return null;
  const target = clean(row["Target Player Key"]);
  const override = PHASE13H_EXISTING_PLAYER_TARGET_OVERRIDES.get(target);
  if (!override) return { ...row };
  return {
    ...row,
    "Target Player Key": override,
    "Existing Player ID": override,
    "Proposed Player ID": "",
    "Identity Status": "phase13h-explicit-existing-player-resolution",
  };
}

const args = parseArgs(process.argv);
for (const required of [
  "records-json",
  "partition-json",
  "ready-packages-csv",
  "held-packages-csv",
  "structural-exclusions-csv",
  "ready-player-shells-csv",
  "held-player-shells-csv",
  "ready-relationships-csv",
  "held-relationships-csv",
  "dependency-seeds-csv",
  "trades-json",
  "players-json",
  "teams-json",
  "receipt-json",
  "contract-md",
  "expected-records-sha256",
  "expected-partition-sha256",
  "expected-partition-internal-sha256",
  "expected-ready-packages-sha256",
  "expected-held-packages-sha256",
  "expected-structural-exclusions-sha256",
  "expected-ready-player-shells-sha256",
  "expected-held-player-shells-sha256",
  "expected-ready-relationships-sha256",
  "expected-held-relationships-sha256",
  "expected-dependency-seeds-sha256",
  "expected-contract-sha256",
  "expected-trade-store-sha256",
  "expected-player-store-sha256",
  "expected-team-store-sha256",
  "imported-at",
  "starting-head",
]) assert(args[required], `Missing --${required}`);

const [
  recordsBytes,
  partitionBytes,
  readyPackageBytes,
  heldPackageBytes,
  structuralBytes,
  readyShellBytes,
  heldShellBytes,
  readyRelationshipBytes,
  heldRelationshipBytes,
  dependencyBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  contractBytes,
] = await Promise.all([
  readFile(args["records-json"]),
  readFile(args["partition-json"]),
  readFile(args["ready-packages-csv"]),
  readFile(args["held-packages-csv"]),
  readFile(args["structural-exclusions-csv"]),
  readFile(args["ready-player-shells-csv"]),
  readFile(args["held-player-shells-csv"]),
  readFile(args["ready-relationships-csv"]),
  readFile(args["held-relationships-csv"]),
  readFile(args["dependency-seeds-csv"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["contract-md"]),
]);

const recordsDocument = JSON.parse(recordsBytes.toString("utf8"));
const partitionDocument = JSON.parse(partitionBytes.toString("utf8"));
const readyRows = parseCsv(readyPackageBytes.toString("utf8"));
const heldRows = parseCsv(heldPackageBytes.toString("utf8"));
const structuralRows = parseCsv(structuralBytes.toString("utf8"));
const readyShells = parseCsv(readyShellBytes.toString("utf8"));
const heldShells = parseCsv(heldShellBytes.toString("utf8"));
const readyRelationshipsInput = parseCsv(readyRelationshipBytes.toString("utf8"));
const heldRelationshipsInput = parseCsv(heldRelationshipBytes.toString("utf8"));
const frozenDependencies = parseCsv(dependencyBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const receiptPath = path.resolve(args["receipt-json"]);

for (const [actual, expected, label] of [
  [sha256(recordsBytes), args["expected-records-sha256"], "records"],
  [sha256(partitionBytes), args["expected-partition-sha256"], "partition"],
  [sha256(readyPackageBytes), args["expected-ready-packages-sha256"], "ready packages"],
  [sha256(heldPackageBytes), args["expected-held-packages-sha256"], "held packages"],
  [sha256(structuralBytes), args["expected-structural-exclusions-sha256"], "structural exclusions"],
  [sha256(readyShellBytes), args["expected-ready-player-shells-sha256"], "ready player shells"],
  [sha256(heldShellBytes), args["expected-held-player-shells-sha256"], "held player shells"],
  [sha256(readyRelationshipBytes), args["expected-ready-relationships-sha256"], "ready relationships"],
  [sha256(heldRelationshipBytes), args["expected-held-relationships-sha256"], "held relationships"],
  [sha256(dependencyBytes), args["expected-dependency-seeds-sha256"], "dependency seeds"],
  [sha256(contractBytes), args["expected-contract-sha256"], "contract"],
]) assert(actual === expected, `${label} hash drifted: ${actual} !== ${expected}.`);

assert(recordsDocument.result === "PASS" && recordsDocument.phase === "13B" && Array.isArray(recordsDocument.records), "Invalid Houston reconciled records document.");
assert(partitionDocument.result === "PASS" && partitionDocument.phase === "13F", "Invalid Phase 13F partition.");
assert(partitionDocument.hashes.semanticPartitionSha256 === args["expected-partition-internal-sha256"], "Phase 13F semantic partition hash drifted.");
assert(Array.isArray(trades) && Array.isArray(players) && Array.isArray(teams), "A repository store is invalid.");
assert(contractBytes.length > 0, "Phase 13H contract is empty.");

for (const [actual, expected, label] of [
  [partitionDocument.counts.sourceRows, 231, "source rows"],
  [partitionDocument.counts.importReadyPackages, 191, "ready packages"],
  [partitionDocument.counts.heldPackages, 26, "held packages"],
  [partitionDocument.counts.structuralEvidenceExclusions, 14, "structural/evidence exclusions"],
  [partitionDocument.counts.canonicalPerspectiveAppendPreviews, 59, "perspective appends"],
  [partitionDocument.counts.canonicalCreatePreviews, 132, "canonical creates"],
  [partitionDocument.counts.readyRequiredPlayerShells, 136, "ready player shells"],
  [partitionDocument.counts.heldOnlyPlayerShells, 22, "held-only player shells"],
  [partitionDocument.counts.readyRelationshipEdges, 546, "ready relationships"],
  [partitionDocument.counts.heldRelationshipEdges, 118, "held relationships"],
  [partitionDocument.counts.readyPublicCandidatePackages, 44, "ready public candidates"],
]) assert(actual === expected, `Partition ${label} drifted: ${actual} !== ${expected}.`);

assert(readyRows.length === 191, `Expected 191 ready rows, found ${readyRows.length}.`);
assert(heldRows.length === 26, `Expected 26 held rows, found ${heldRows.length}.`);
assert(structuralRows.length === 14, `Expected 14 structural rows, found ${structuralRows.length}.`);
assert(readyShells.length === 136, `Expected 136 ready player shells, found ${readyShells.length}.`);
assert(heldShells.length === 22, `Expected 22 held-only player shells, found ${heldShells.length}.`);
assert(readyRelationshipsInput.length === 546, `Expected 546 ready relationships, found ${readyRelationshipsInput.length}.`);
assert(heldRelationshipsInput.length === 118, `Expected 118 held relationships, found ${heldRelationshipsInput.length}.`);
assert(frozenDependencies.length === 819, `Expected 819 dependency seeds, found ${frozenDependencies.length}.`);

const readyPackages = readyRows.map((row) => ({
  tradeId: clean(row["Trade ID"]),
  canonicalId: clean(row["Canonical ID"]),
  canonicalAction: clean(row["Canonical Action"]),
  importAction: clean(row["Phase 13F Canonical Write"]) === "CANONICAL_CREATE_PREVIEW" ? "canonical-create" : "perspective-append",
  publicationClass: clean(row["Publication Class"]),
  dateCollisionResolvedAsDistinctCreate: false,
}));
const heldPackages = heldRows.map((row) => ({ tradeId: clean(row["Trade ID"]), canonicalAction: clean(row["Canonical Action"]), canonicalId: clean(row["Canonical ID"]) }));
const exclusions = structuralRows.map((row) => ({ tradeId: clean(row["Trade ID"]) }));
const partition = {
  ...partitionDocument,
  finalReadyPackages: readyPackages,
  remainingHeldPackages: heldPackages,
  linkedOrVoidedExclusions: exclusions,
};

assert(readyPackages.filter((item) => item.importAction === "canonical-create").length === 132, "Ready canonical-create count drifted.");
assert(readyPackages.filter((item) => item.importAction === "perspective-append").length === 59, "Ready perspective-append count drifted.");
assert(new Set(readyPackages.map((item) => item.tradeId)).size === 191, "Ready source IDs are not unique.");
assert(new Set(heldPackages.map((item) => item.tradeId)).size === 26, "Held source IDs are not unique.");
assert(new Set(exclusions.map((item) => item.tradeId)).size === 14, "Excluded source IDs are not unique.");
assert(JSON.stringify([...partitionDocument.readyTradeIds].sort()) === JSON.stringify(readyPackages.map((item) => item.tradeId).sort()), "Phase 13F ready IDs do not match ready-package CSV.");
assert(JSON.stringify([...partitionDocument.heldTradeIds].sort()) === JSON.stringify(heldPackages.map((item) => item.tradeId).sort()), "Phase 13F held IDs do not match held-package CSV.");
assert(JSON.stringify([...partitionDocument.structuralTradeIds].sort()) === JSON.stringify(exclusions.map((item) => item.tradeId).sort()), "Phase 13F structural IDs do not match structural CSV.");

let existingReceipt = null;
try {
  existingReceipt = JSON.parse((await readFile(receiptPath)).toString("utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (existingReceipt) {
  assert(existingReceipt.result === "PASS" && existingReceipt.phase === "13H", "Existing Phase 13H receipt is invalid.");
  assert(existingReceipt.canonicalStoreSha256 === sha256(tradeBytes), "Replay canonical hash differs from receipt.");
  assert(existingReceipt.playerStoreSha256 === sha256(playerBytes), "Replay player hash differs from receipt.");
  assert(existingReceipt.teamStoreSha256 === sha256(teamBytes), "Replay team hash differs from receipt.");
  assert(existingReceipt.readyPackages === 191, "Replay ready-package count drifted.");
  assert(existingReceipt.canonicalTradesCreated === 132, "Replay create count drifted.");
  assert(existingReceipt.perspectivesAppended === 59, "Replay append count drifted.");
  assert(existingReceipt.playerShellsCreated === 134, "Replay shell count drifted.");
  assert(existingReceipt.relationshipReferencesAdded === 545, "Replay relationship count drifted.");
  console.log(JSON.stringify({
    result: "PASS",
    phase: "13H",
    mode: "IDEMPOTENT_REPLAY",
    repositoryDataWrites: 0,
    canonicalStoreSha256: existingReceipt.canonicalStoreSha256,
    playerStoreSha256: existingReceipt.playerStoreSha256,
    teamStoreSha256: existingReceipt.teamStoreSha256,
    receiptSha256: sha256(canonicalJson(existingReceipt)),
  }, null, 2));
  process.exit(0);
}

assert(trades.length === 1716, `Expected 1,716 pre-import trades, found ${trades.length}.`);
assert(players.length === 2566, `Expected 2,566 pre-import players, found ${players.length}.`);
assert(teams.length === 52, `Expected 52 pre-import teams, found ${teams.length}.`);
assert(sha256(tradeBytes) === args["expected-trade-store-sha256"], "Pre-import trade-store hash drifted.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Pre-import player-store hash drifted.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Pre-import team-store hash drifted.");

const sourceRecords = new Map(recordsDocument.records.map((record) => [clean(record["Trade ID"]), record]));
const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const teamSet = new Set(teams.map(teamSlug).filter(Boolean));
assert(sourceRecords.size === 231, "Houston source Trade IDs are not unique.");
assert(tradeMap.size === trades.length, "Duplicate pre-import canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate pre-import player ID.");
assert(teamSet.size === teams.length, "Duplicate team slug.");

const readySourceIds = new Set(readyPackages.map((item) => item.tradeId));
const heldSourceIds = new Set(heldPackages.map((item) => item.tradeId));
const exclusionSourceIds = new Set(exclusions.map((item) => item.tradeId));
for (const sourceId of [...readySourceIds, ...heldSourceIds, ...exclusionSourceIds]) {
  assert(sourceRecords.has(sourceId), `Frozen source Trade ID is missing from reconciled records: ${sourceId}`);
}
for (const row of readyRows) {
  assert(clean(row["Phase 13F Partition"]) === "IMPORT_READY", `${row["Trade ID"]}: ready partition marker drifted.`);
  assert(clean(row["Routing Required"]) === "No", `${row["Trade ID"]}: routing-required package entered ready set.`);
  assert(clean(row["Recent Provisional"]) === "No", `${row["Trade ID"]}: recent provisional package entered ready set.`);
  assert(clean(row["Publication Authorized"]) === "No", `${row["Trade ID"]}: publication was authorized upstream.`);
}

const frozenShells = [...readyShells, ...heldShells];
const frozenRelationships = [...readyRelationshipsInput, ...heldRelationshipsInput];
assert(new Set(frozenShells.map((shell) => clean(shell["Proposed Player ID"]))).size === 158, "Frozen shell IDs are not unique.");
assert(new Set(frozenRelationships.map((row) => clean(row["Relationship Edge Key"]))).size === 664, "Frozen relationship IDs are not unique.");

const importedPlayerIds = [];
const resolvedReadyShellIds = [];
const redundantReadyShellIds = [];
for (const shell of readyShells) {
  const id = clean(shell["Proposed Player ID"]);
  if (id === "nba-player-d-j-augustin") {
    const resolvedId = PHASE13H_EXISTING_PLAYER_TARGET_OVERRIDES.get(id);
    assert(resolvedId && playerMap.has(resolvedId), `D.J. Augustin explicit existing-player target is missing: ${resolvedId}`);
    assert(!playerMap.has(id), `D.J. Augustin stale proposed shell unexpectedly exists: ${id}`);
    resolvedReadyShellIds.push(id);
    continue;
  }
  if (PHASE13H_REDUNDANT_READY_SHELL_IDS.has(id)) {
    assert(!playerMap.has(id), `Redundant phrase-derived shell unexpectedly exists: ${id}`);
    assert(playerMap.has("nba-player-lester-conner-bbd3d89a7d"), "Lester Conner existing identity is missing.");
    redundantReadyShellIds.push(id);
    continue;
  }
  assert(id && !playerMap.has(id), `Ready player-shell target already exists: ${id}`);
  playerMap.set(id, createPlayerShell(shell, args["imported-at"]));
  importedPlayerIds.push(id);
}
assert(importedPlayerIds.length === 134, `Expected 134 player-shell creates after two explicit identity corrections, found ${importedPlayerIds.length}.`);
assert(resolvedReadyShellIds.length === 1, "Expected one ready shell resolved to an existing player.");
assert(redundantReadyShellIds.length === 1, "Expected one redundant phrase-derived ready shell exclusion.");
for (const shell of heldShells) {
  const id = clean(shell["Proposed Player ID"]);
  assert(!playerMap.has(id), `Held-only player shell unexpectedly exists before import: ${id}`);
}

const readyRelationshipsFrozen = frozenRelationships.filter((row) => readySourceIds.has(clean(row["Trade ID"])));
assert(readyRelationshipsFrozen.length === 546, `Expected 546 frozen ready relationship previews, found ${readyRelationshipsFrozen.length}.`);
const readyRelationships = readyRelationshipsFrozen.map(phase13HCorrectRelationship).filter(Boolean);
assert(readyRelationships.length === 545, `Expected 545 writable ready relationships after one redundant identity-edge exclusion, found ${readyRelationships.length}.`);
const readyDependencies = frozenDependencies.filter((row) => readySourceIds.has(clean(row["Trade ID"])));
assert(readyDependencies.length === 656, `Expected 656 ready dependency seeds, found ${readyDependencies.length}.`);
const relationshipsByTradeId = new Map();
for (const relationship of readyRelationships) {
  const sourceId = clean(relationship["Trade ID"]);
  if (!relationshipsByTradeId.has(sourceId)) relationshipsByTradeId.set(sourceId, []);
  relationshipsByTradeId.get(sourceId).push(relationship);
}
const dependenciesByTradeId = new Map();
for (const dependency of readyDependencies) {
  const sourceId = clean(dependency["Trade ID"]);
  if (!dependenciesByTradeId.has(sourceId)) dependenciesByTradeId.set(sourceId, []);
  dependenciesByTradeId.get(sourceId).push(dependency);
}

const importedCanonicalIds = [];
const appendedPerspectiveIds = [];
const relationshipIds = [];
const protectedAppendProjectionHashes = {};
let matchedExistingAssetReferences = 0;
let syntheticPerspectiveAssetReferences = 0;
let sourceReferencesAdded = 0;

for (const packageRecord of readyPackages) {
  const sourceId = clean(packageRecord.tradeId);
  const record = sourceRecords.get(sourceId);
  assert(record, `${sourceId}: reconciled source record is missing.`);
  assert(clean(record["Routing Required"]) === "No", `${sourceId}: a routing-required package entered the ready partition.`);
  assert(clean(record["Recent Provisional"]) === "No", `${sourceId}: a recent-provisional package entered the ready partition.`);
  assert(clean(record["Counterpart Slugs"]) && !clean(record["Counterpart Slugs"]).includes(","), `${sourceId}: ready package is not a two-team transaction.`);
  const packageRelationships = relationshipsByTradeId.get(sourceId) ?? [];
  let trade;

  if (packageRecord.importAction === "canonical-create") {
    const canonicalId = canonicalIdForSource(sourceId);
    assert(!tradeMap.has(canonicalId), `${sourceId}: proposed canonical ID already exists: ${canonicalId}`);
    trade = buildNewTrade({
      packageRecord,
      record,
      dependencyRows: dependenciesByTradeId.get(sourceId) ?? [],
      relationshipRows: packageRelationships,
      importedAt: args["imported-at"],
      playerMap,
    });
    for (const team of trade.teams) assert(teamSet.has(team), `${sourceId}: unknown team slug ${team}.`);
    tradeMap.set(trade.id, trade);
    importedCanonicalIds.push(trade.id);
  } else {
    assert(packageRecord.importAction === "perspective-append", `${sourceId}: unsupported import action.`);
    const targetId = clean(packageRecord.canonicalId);
    const existing = tradeMap.get(targetId);
    assert(existing, `${sourceId}: perspective target is missing: ${targetId}`);
    assert(uniqueSorted(existing.teams ?? []).includes("houston-rockets"), `${sourceId}: perspective target does not include Houston.`);
    protectedAppendProjectionHashes[targetId] = sha256(canonicalJson(immutableTradeProjection(existing)));
    trade = appendHoustonPerspective(existing, record, args["imported-at"]);
    assert(sha256(canonicalJson(immutableTradeProjection(trade))) === protectedAppendProjectionHashes[targetId], `${sourceId}: protected append projection hash drifted.`);
    tradeMap.set(trade.id, trade);
    appendedPerspectiveIds.push(trade.id);
  }

  for (const relationship of packageRelationships) {
    const targetPlayerId = clean(relationship["Target Player Key"]);
    const player = playerMap.get(targetPlayerId);
    assert(player, `${relationship["Relationship Edge Key"]}: target player does not exist: ${targetPlayerId}`);
    let assetReference;
    if (packageRecord.importAction === "canonical-create") {
      const dependencyKey = relationshipDependencyKey(relationship);
      const dependency = (dependenciesByTradeId.get(sourceId) ?? []).find((row) => clean(row["Dependency Key"]) === dependencyKey);
      assert(dependency, `${relationship["Relationship Edge Key"]}: dependency seed is missing.`);
      const asset = trade.assetLedger.find((item) => item.direction === clean(relationship.Side) && clean(item.displayText) === clean(relationship["Raw Asset"]));
      assert(asset, `${relationship["Relationship Edge Key"]}: created canonical asset is missing.`);
      assetReference = { assetId: asset.assetId, sourceAssetId: asset.assetId, synthetic: false };
    } else {
      assetReference = resolveRelationshipAssetReference(trade, relationship, player);
    }
    if (assetReference.synthetic) syntheticPerspectiveAssetReferences += 1;
    else matchedExistingAssetReferences += 1;

    const kind = clean(relationship["Identity Kind"]);
    const refType = referenceType(kind);
    const reference = {
      relationshipId: clean(relationship["Relationship Edge Key"]),
      referenceType: refType,
      relationshipRole: relationRole(kind),
      tradeId: trade.id,
      canonicalTradeId: trade.id,
      tradeSlug: clean(trade.slug),
      assetId: assetReference.assetId,
      assetReference: assetReference.assetId,
      sourceAssetId: assetReference.sourceAssetId,
      sourceTradeId: sourceId,
      packageId: `houston-rockets-phase-13h-${sourceId}`,
      sourceTeam: "houston-rockets",
      perspectiveLocalAssetReference: assetReference.synthetic,
      privateOnly: true,
    };
    const matchedAsset = assetReference.synthetic ? null : trade.assetLedger?.find((item) => clean(item.assetId) === assetReference.assetId) ?? null;
    const sourceReference = matchedAsset && expectedReferenceTypesForAsset(matchedAsset).includes(refType)
      ? {
          referenceType: refType,
          canonicalTradeId: trade.id,
          sourceTradeId: clean(trade.sourceTradeId),
          assetId: assetReference.assetId,
          assetType: matchedAsset.type ?? null,
          tradeDate: clean(trade.tradeDate),
          displayText: clean(relationship["Raw Asset"]),
        }
      : null;
    const beforeSourceCount = Array.isArray(player.sourceReferences) ? player.sourceReferences.length : 0;
    const updatedPlayer = appendRelationshipReference(player, reference, sourceReference);
    const afterSourceCount = Array.isArray(updatedPlayer.sourceReferences) ? updatedPlayer.sourceReferences.length : 0;
    sourceReferencesAdded += afterSourceCount - beforeSourceCount;
    playerMap.set(targetPlayerId, updatedPlayer);
    relationshipIds.push(reference.relationshipId);
  }
}

assert(importedCanonicalIds.length === 132, "Canonical-create count drifted.");
assert(appendedPerspectiveIds.length === 59, "Perspective-append count drifted.");
assert(relationshipIds.length === 545, "Relationship count drifted.");
assert(tradeMap.size === 1848, `Expected 1,848 post-import trades, found ${tradeMap.size}.`);
assert(playerMap.size === 2700, `Expected 2,700 post-import players, found ${playerMap.size}.`);
assert(matchedExistingAssetReferences + syntheticPerspectiveAssetReferences === 545, "Relationship asset-reference accounting drifted.");

const finalTrades = [...tradeMap.values()];
const finalPlayers = [...playerMap.values()];
const finalTeams = teams;
function hasSourcePerspective(trade, sourceId) {
  if (Array.isArray(trade.perspectives)) return trade.perspectives.some((p) => clean(p?.sourceTradeId) === sourceId);
  return Object.values(trade.perspectives ?? {}).some((p) => clean(p?.sourceTradeId) === sourceId || clean(p?.sourceSubmissionId).endsWith(sourceId));
}
for (const sourceId of heldSourceIds) {
  assert(!finalTrades.some((trade) => clean(trade.sourceTradeId) === sourceId), `${sourceId}: held package was imported as a standalone trade.`);
  assert(!finalTrades.some((trade) => hasSourcePerspective(trade, sourceId)), `${sourceId}: held package was imported as a perspective.`);
}
for (const sourceId of exclusionSourceIds) {
  assert(!finalTrades.some((trade) => clean(trade.sourceTradeId) === sourceId), `${sourceId}: excluded package was imported as a standalone trade.`);
  assert(!finalTrades.some((trade) => hasSourcePerspective(trade, sourceId)), `${sourceId}: excluded package was imported as a perspective.`);
}
for (const packageRecord of readyPackages) {
  const sourceId = clean(packageRecord.tradeId);
  const targetId = packageRecord.importAction === "canonical-create" ? canonicalIdForSource(sourceId) : clean(packageRecord.canonicalId);
  const trade = tradeMap.get(targetId);
  assert(trade, `${sourceId}: target trade is missing after import.`);
  assert(sourcePerspectiveCount(trade, "houston-rockets") === 1, `${sourceId}: Houston perspective count is not exactly one.`);
  assert(trade.publishStatus === "private", `${sourceId}: publish status drifted.`);
  assert(trade.indexEligible === false && trade.adEligible === false && trade.publicationReady === false, `${sourceId}: exposure flags drifted.`);
}
for (const shell of heldShells) {
  assert(!playerMap.has(clean(shell["Proposed Player ID"])), `${shell["Proposed Player ID"]}: held-only player shell was imported.`);
}
assert(!playerMap.has("nba-player-d-j-augustin"), "Stale D.J. Augustin shell was created.");
assert(!playerMap.has("nba-player-veteran-free-agent-lester-conner"), "Redundant Lester Conner phrase shell was created.");
const relationshipOwner = new Map();
for (const player of finalPlayers) {
  for (const reference of player.relationshipReferences ?? []) {
    const id = clean(reference.relationshipId);
    if (!id) continue;
    assert(!relationshipOwner.has(id), `Relationship ID is owned by multiple players: ${id}`);
    relationshipOwner.set(id, player.id);
  }
}
for (const id of relationshipIds) assert(relationshipOwner.has(id), `Imported relationship is missing: ${id}`);
for (const row of heldRelationshipsInput) assert(!relationshipOwner.has(clean(row["Relationship Edge Key"])), `Held relationship was imported: ${row["Relationship Edge Key"]}`);

const tradeOut = canonicalJson(finalTrades);
const playerOut = canonicalJson(finalPlayers);
const teamOut = canonicalJson(finalTeams);
const preTeamMemberships = countTeamMemberships(trades);
const postTeamMemberships = countTeamMemberships(finalTrades);
const preRelationshipReferences = countRelationshipReferences(players);
const postRelationshipReferences = countRelationshipReferences(finalPlayers);
const preSourceReferences = countSourceReferences(players);
const postSourceReferences = countSourceReferences(finalPlayers);

const receipt = {
  result: "PASS",
  phase: "13H",
  mode: "FIRST_IMPORT",
  protocol: "Warp-Freeze Protocol",
  batchId: "houston-rockets-phase-13h",
  startingHead: args["starting-head"],
  importedAt: args["imported-at"],
  sourceHashes: {
    phase13BRecordsSha256: sha256(recordsBytes),
    phase13FPartitionSha256: sha256(partitionBytes),
    phase13FSemanticPartitionSha256: partitionDocument.hashes.semanticPartitionSha256,
    readyPackagesSha256: sha256(readyPackageBytes),
    heldPackagesSha256: sha256(heldPackageBytes),
    structuralExclusionsSha256: sha256(structuralBytes),
    readyPlayerShellsSha256: sha256(readyShellBytes),
    heldPlayerShellsSha256: sha256(heldShellBytes),
    readyRelationshipsSha256: sha256(readyRelationshipBytes),
    heldRelationshipsSha256: sha256(heldRelationshipBytes),
    dependencySeedsSha256: sha256(dependencyBytes),
    contractSha256: sha256(contractBytes),
    preImportCanonicalStoreSha256: sha256(tradeBytes),
    preImportPlayerStoreSha256: sha256(playerBytes),
    preImportTeamStoreSha256: sha256(teamBytes),
  },
  preImportCanonicalTrades: trades.length,
  preImportPlayers: players.length,
  preImportTeams: teams.length,
  preImportTeamTradeMemberships: preTeamMemberships,
  preImportRelationshipReferences: preRelationshipReferences,
  preImportSourceReferences: preSourceReferences,
  sourceRows: partitionDocument.counts.sourceRows,
  readyPackages: readyPackages.length,
  heldPackages: heldPackages.length,
  structuralEvidenceExclusions: exclusions.length,
  canonicalTradesCreated: importedCanonicalIds.length,
  perspectivesAppended: appendedPerspectiveIds.length,
  frozenPlayerShellProposals: frozenShells.length,
  playerShellsCreated: importedPlayerIds.length,
  readyShellsResolvedToExistingPlayers: resolvedReadyShellIds.length,
  redundantReadyShellsExcluded: redundantReadyShellIds.length,
  heldOnlyPlayerShellsDeferred: heldShells.length,
  frozenRelationshipEdges: frozenRelationships.length,
  relationshipReferencesAdded: relationshipIds.length,
  redundantReadyRelationshipEdgesExcluded: PHASE13H_REDUNDANT_READY_RELATIONSHIP_IDS.size,
  heldRelationshipEdgesDeferred: heldRelationshipsInput.length,
  matchedExistingAssetReferences,
  syntheticPerspectiveAssetReferences,
  sourceReferencesAdded,
  publicCandidatePackagesImportedPrivately: readyRows.filter((row) => clean(row["Publication Class"]) === "Public Candidate").length,
  postImportCanonicalTrades: finalTrades.length,
  postImportPlayers: finalPlayers.length,
  postImportTeams: finalTeams.length,
  postImportTeamTradeMemberships: postTeamMemberships,
  postImportRelationshipReferences: postRelationshipReferences,
  postImportSourceReferences: postSourceReferences,
  teamTradeMembershipsAdded: postTeamMemberships - preTeamMemberships,
  playerRelationshipReferencesAdded: postRelationshipReferences - preRelationshipReferences,
  playerSourceReferencesAdded: postSourceReferences - preSourceReferences,
  teamRegistryEntriesAdded: 0,
  importedCanonicalTradeIds: uniqueSorted(importedCanonicalIds),
  updatedPerspectiveCanonicalIds: uniqueSorted(appendedPerspectiveIds),
  importedPlayerIds: uniqueSorted(importedPlayerIds),
  readyShellsResolvedToExistingPlayerIds: ["nba-player-dj-augustin-7b32f3fe01"],
  redundantReadyShellIds: uniqueSorted(redundantReadyShellIds),
  explicitRelationshipTargetCorrections: Object.fromEntries(PHASE13H_EXISTING_PLAYER_TARGET_OVERRIDES),
  deferredPlayerIds: uniqueSorted(heldShells.map((shell) => clean(shell["Proposed Player ID"]))),
  relationshipIds: uniqueSorted(relationshipIds),
  deferredRelationshipIds: uniqueSorted(heldRelationshipsInput.map((row) => clean(row["Relationship Edge Key"]))),
  heldSourceTradeIds: uniqueSorted([...heldSourceIds]),
  structuralEvidenceExcludedSourceTradeIds: uniqueSorted([...exclusionSourceIds]),
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
await atomicWrite(args["trades-json"], tradeOut, "phase13h-trades");
await atomicWrite(args["players-json"], playerOut, "phase13h-players");
await atomicWrite(receiptPath, receiptOut, "phase13h-receipt");

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
  heldOnlyPlayerShellsDeferred: receipt.heldOnlyPlayerShellsDeferred,
  relationshipReferencesAdded: receipt.relationshipReferencesAdded,
  heldRelationshipEdgesDeferred: receipt.heldRelationshipEdgesDeferred,
  matchedExistingAssetReferences: receipt.matchedExistingAssetReferences,
  syntheticPerspectiveAssetReferences: receipt.syntheticPerspectiveAssetReferences,
  sourceReferencesAdded: receipt.sourceReferencesAdded,
  canonicalStoreSha256: receipt.canonicalStoreSha256,
  playerStoreSha256: receipt.playerStoreSha256,
  teamStoreSha256: receipt.teamStoreSha256,
  receiptSha256: sha256(receiptOut),
}, null, 2));
