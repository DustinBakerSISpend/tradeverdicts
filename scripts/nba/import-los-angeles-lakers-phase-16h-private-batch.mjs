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

function canonicalTeamSlug(value) {
  return clean(value);
}

function perspectiveGrades(record, partner) {
  const grades = {};
  const lakers = clean(record["Lakers Grade"]);
  const aggregate = clean(record["Partner Aggregate Grade"]);
  if (lakers) grades["los-angeles-lakers"] = lakers;
  if (aggregate) {
    grades.partnerAggregate = aggregate;
    if (partner) grades[partner] = aggregate;
  }
  return grades;
}
function lakersPerspective(record, teams) {
  const partner = teams.find((team) => team !== "los-angeles-lakers") ?? null;
  return {
    sourceTeam: "los-angeles-lakers",
    sourceBatchId: "los-angeles-lakers-phase-16h",
    sourceTradeId: clean(record["Trade ID"]),
    sourcePerspectiveKey: `los-angeles-lakers:${clean(record["Trade ID"])}`,
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
function appendLakersPerspective(existingTrade, record, importedAt) {
  const protectedBefore = JSON.stringify(immutableTradeProjection(existingTrade));
  assert(
    sourcePerspectiveCount(existingTrade, "los-angeles-lakers") === 0,
    `${record["Trade ID"]}: Lakers perspective already exists.`,
  );
  const teams = uniqueSorted(existingTrade.teams ?? []);
  const perspective = lakersPerspective(record, teams);
  let perspectives;
  if (Array.isArray(existingTrade.perspectives)) {
    perspectives = [...existingTrade.perspectives, perspective];
  } else if (existingTrade.perspectives && typeof existingTrade.perspectives === "object") {
    perspectives = {
      ...existingTrade.perspectives,
      "los-angeles-lakers": {
        sourceSubmissionId: `los-angeles-lakers-phase-16h-${clean(record["Trade ID"])}`,
        sourceTradeId: clean(record["Trade ID"]),
        editorialStatus: "private-imported-los-angeles-lakers-phase-16h",
        grade: clean(record["Lakers Grade"]),
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
  const lakersGrade = clean(record["Lakers Grade"]);
  const partnerGrade = clean(record["Partner Aggregate Grade"]);
  if (lakersGrade) mergedGrades["los-angeles-lakers"] = lakersGrade;
  if (partnerGrade && !mergedGrades.partnerAggregate) mergedGrades.partnerAggregate = partnerGrade;

  const updated = {
    ...existingTrade,
    sourceTeams: uniqueSorted([
      ...(Array.isArray(existingTrade.sourceTeams) ? existingTrade.sourceTeams : []),
      "los-angeles-lakers",
    ]),
    perspectives,
    grades: mergedGrades,
    perspectiveReconciliations: [
      ...(Array.isArray(existingTrade.perspectiveReconciliations)
        ? existingTrade.perspectiveReconciliations
        : []),
      {
        sourceBatchId: "los-angeles-lakers-phase-16h",
        sourceTradeId: clean(record["Trade ID"]),
        packageId: `los-angeles-lakers-phase-16h-${clean(record["Trade ID"])}`,
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
    sourcePerspectiveCount(updated, "los-angeles-lakers") === 1,
    `${record["Trade ID"]}: Lakers perspective append count drifted.`,
  );
  return updated;
}
function canonicalIdForSource(sourceTradeId) {
  const match = clean(sourceTradeId).match(/^LAL-(\d{4})-(\d{4})$/u);
  assert(match, `Invalid Lakers source Trade ID: ${sourceTradeId}`);
  return `nba-trade-lal-${match[1]}-${match[2]}`;
}
function makeAssetId(sourceTradeId, side, assetIndex, rawAsset, fromTeam, toTeam) {
  return `phase16h-asset-${sha256(
    [sourceTradeId, side, assetIndex, rawAsset, fromTeam, toTeam].join("|"),
  )
    .slice(0, 20)
    .toLowerCase()}`;
}
function buildNewTrade({ packageRecord, record, dependencyRows, relationshipRows, teamRows, importedAt, playerMap }) {
  const sourceTradeId = clean(record["Trade ID"]);
  assert(teamRows.length === 2, `${sourceTradeId}: ready package must have exactly two resolved team dependencies.`);
  const teams = uniqueSorted(teamRows.map((row) => clean(row["Team Slug"])));
  assert(teams.length === 2 && teams.includes("los-angeles-lakers"), `${sourceTradeId}: resolved team set must contain Lakers plus one partner.`);
  const partner = teams.find((team) => team !== "los-angeles-lakers");
  assert(partner, `${sourceTradeId}: resolved partner team is missing.`);
  const sourceTeamSlugs = uniqueSorted(teamRows.map((row) => clean(row["Source Team Slug"])));
  assert(teamRows.every((row) => ["existing-team-exact", "existing-team-historical-alias"].includes(clean(row["Team Status"]))), `${sourceTradeId}: a non-resolved team dependency entered the ready set.`);
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
      const fromTeam = side === "received" ? partner : "los-angeles-lakers";
      const toTeam = side === "received" ? "los-angeles-lakers" : partner;
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
        sourceTeam: "los-angeles-lakers",
        edgeClass: "lakers-source-route",
        routingStatus: "resolved",
        routingMethod: "two-team-direct",
        possibleFromTeams: [],
        possibleToTeams: [],
        privateOnly: true,
        previewOnly: false,
        auditStatus: "private-imported-los-angeles-lakers-phase-16h",
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
  const perspective = lakersPerspective(record, teams);
  const canonicalId = canonicalIdForSource(sourceTradeId);
  const tradeDate = clean(record["Trade Date"]);
  const sources = [
    clean(record["Primary Source URL"])
      ? {
          sourceType: "primary_url",
          label: clean(record["Primary Source Label"]) || null,
          url: clean(record["Primary Source URL"]),
          sourceTeam: "los-angeles-lakers",
          privateOnly: true,
        }
      : null,
    clean(record["Secondary Source URL"])
      ? {
          sourceType: "secondary_url",
          label: clean(record["Secondary Source Label"]) || null,
          url: clean(record["Secondary Source URL"]),
          sourceTeam: "los-angeles-lakers",
          privateOnly: true,
        }
      : null,
  ].filter(Boolean);
  if (sources.length === 0) {
    sources.push({
      sourceType: "reconciled_workbook",
      label: clean(record["Primary Source Label"]) || "Lakers reconciled audit workbook",
      sourceTradeId,
      sourceTeam: "los-angeles-lakers",
      privateOnly: true,
    });
  }
  return {
    id: canonicalId,
    tradeId: canonicalId,
    sourceTradeId,
    canonicalKey: canonicalId,
    slug: `los-angeles-lakers-trade-${tradeDate}-${sourceTradeId.split("-").at(-1)}`,
    league: "nba",
    tradeDate,
    date: tradeDate,
    seasonLabel: seasonLabel(tradeDate),
    season: seasonStartYear(tradeDate),
    teams,
    sourceTeamLabels: uniqueSorted([
      clean(record["Franchise Label"]) || "Los Angeles Lakers",
      clean(record["Partner Team(s)"]),
    ]),
    sourceTeamSlugs,
    assetsReceived: byReceived,
    assetsSent: bySent,
    assetsSentByTeam: bySent,
    assetLedger: assets,
    sourceTeams: ["los-angeles-lakers"],
    perspectives: { "los-angeles-lakers": perspective },
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
    importReviewStatus: "private-imported-los-angeles-lakers-phase-16h",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    sources,
    perspectiveReconciliations: [
      {
        sourceBatchId: "los-angeles-lakers-phase-16h",
        sourceTradeId,
        packageId: `los-angeles-lakers-phase-16h-${sourceTradeId}`,
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
  const alternates = clean(shell["Alias Candidates"])
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
    importReviewStatus: "private-shell-imported-los-angeles-lakers-phase-16h",
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
function assetMatchesLakersSide(asset, side) {
  const possibleFrom = Array.isArray(asset.possibleFromTeams) ? asset.possibleFromTeams : [];
  const possibleTo = Array.isArray(asset.possibleToTeams) ? asset.possibleToTeams : [];
  if (side === "received") {
    return clean(asset.toTeam) === "los-angeles-lakers" || possibleTo.includes("los-angeles-lakers");
  }
  return clean(asset.fromTeam) === "los-angeles-lakers" || possibleFrom.includes("los-angeles-lakers");
}
function resolveRelationshipAssetReference(trade, relationship, player) {
  const relationshipId = clean(relationship["Relationship Edge Key"]);
  if (PHASE16H_FORCE_SYNTHETIC_RELATIONSHIP_IDS.has(relationshipId)) {
    return {
      assetId: `phase16h-perspective-asset-${sha256(
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
  const assets = Array.isArray(trade.assetLedger) ? trade.assetLedger : [];
  const candidates = assets
    .map((asset) => ({
      asset,
      score: assetMatchScore(asset, relationship, player),
      sideMatch: assetMatchesLakersSide(asset, clean(relationship.Side)),
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
    assetId: `phase16h-perspective-asset-${sha256(
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



const PHASE16H_EXISTING_PLAYER_TARGET_OVERRIDES = new Map([
  ["nba-player-a-c-green", "nba-player-ac-green-262dde3792"],
]);
const PHASE16H_EXPLICIT_RELATIONSHIP_TARGET_OVERRIDES = new Map();
const PHASE16H_FORCE_SYNTHETIC_RELATIONSHIP_IDS = new Set([
  "los-angeles-lakers:LAL-2004-0151:received:003:identity:01:player:nba-player-jumaine-jones-c13305971d",
]);
const PHASE16H_REDUNDANT_READY_SHELL_IDS = new Set();
const PHASE16H_REDUNDANT_READY_RELATIONSHIP_IDS = new Set();
function phase16HCorrectRelationship(row) {
  const relationshipId = clean(row["Relationship Edge Key"]);
  if (PHASE16H_REDUNDANT_READY_RELATIONSHIP_IDS.has(relationshipId)) return null;
  const frozenTarget = clean(row["Target Player Key"]);
  const correctedTarget =
    PHASE16H_EXPLICIT_RELATIONSHIP_TARGET_OVERRIDES.get(relationshipId) ??
    PHASE16H_EXISTING_PLAYER_TARGET_OVERRIDES.get(frozenTarget) ??
    frozenTarget;
  if (correctedTarget === frozenTarget) return { ...row };
  return {
    ...row,
    "Target Player Key": correctedTarget,
    "Existing Player ID": correctedTarget,
    "Proposed Player ID": "",
    "Identity Status": "phase16h-explicit-existing-player-resolution",
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
  "ready-team-dependencies-csv",
  "held-team-dependencies-csv",
  "ready-dependency-seeds-csv",
  "held-dependency-seeds-csv",
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
  "expected-ready-team-dependencies-sha256",
  "expected-held-team-dependencies-sha256",
  "expected-ready-dependency-seeds-sha256",
  "expected-held-dependency-seeds-sha256",
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
  readyTeamBytes,
  heldTeamBytes,
  readyDependencyBytes,
  heldDependencyBytes,
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
  readFile(args["ready-team-dependencies-csv"]),
  readFile(args["held-team-dependencies-csv"]),
  readFile(args["ready-dependency-seeds-csv"]),
  readFile(args["held-dependency-seeds-csv"]),
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
const readyTeamDependencies = parseCsv(readyTeamBytes.toString("utf8"));
const heldTeamDependencies = parseCsv(heldTeamBytes.toString("utf8"));
const readyDependencies = parseCsv(readyDependencyBytes.toString("utf8"));
const heldDependencies = parseCsv(heldDependencyBytes.toString("utf8"));
const frozenDependencies = [...readyDependencies, ...heldDependencies];
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
  [sha256(readyTeamBytes), args["expected-ready-team-dependencies-sha256"], "ready team dependencies"],
  [sha256(heldTeamBytes), args["expected-held-team-dependencies-sha256"], "held team dependencies"],
  [sha256(readyDependencyBytes), args["expected-ready-dependency-seeds-sha256"], "ready dependency seeds"],
  [sha256(heldDependencyBytes), args["expected-held-dependency-seeds-sha256"], "held dependency seeds"],
  [sha256(contractBytes), args["expected-contract-sha256"], "contract"],
]) assert(actual === expected, `${label} hash drifted: ${actual} !== ${expected}.`);

assert(recordsDocument.result === "PASS" && recordsDocument.phase === "16B" && Array.isArray(recordsDocument.records), "Invalid Lakers reconciled records document.");
assert(partitionDocument.result === "PASS" && partitionDocument.phase === "16F", "Invalid Phase 16F partition.");
assert(partitionDocument.hashes.semanticPartitionSha256 === args["expected-partition-internal-sha256"], "Phase 16F semantic partition hash drifted.");
assert(Array.isArray(trades) && Array.isArray(players) && Array.isArray(teams), "A repository store is invalid.");
assert(contractBytes.length > 0, "Phase 16H contract is empty.");

for (const [actual, expected, label] of [
  [partitionDocument.counts.sourceRows, 206, "source rows"],
  [partitionDocument.counts.importReadyPackages, 146, "ready packages"],
  [partitionDocument.counts.heldPackages, 21, "held packages"],
  [partitionDocument.counts.structuralEvidenceExclusions, 39, "structural/evidence exclusions"],
  [partitionDocument.counts.canonicalPerspectiveAppendPreviews, 72, "perspective appends"],
  [partitionDocument.counts.canonicalCreatePreviews, 74, "canonical creates"],
  [partitionDocument.counts.readyRequiredPlayerShells, 77, "ready player shells"],
  [partitionDocument.counts.heldOnlyPlayerShells, 23, "held-only player shells"],
  [partitionDocument.counts.readyRelationshipEdges, 355, "ready relationships"],
  [partitionDocument.counts.heldRelationshipEdges, 100, "held relationships"],
  [partitionDocument.counts.readyTeamDependencyOccurrences, 292, "ready team dependencies"],
  [partitionDocument.counts.heldTeamDependencyOccurrences, 60, "held team dependencies"],
  [partitionDocument.counts.readyPublicCandidatePackages, 34, "ready public candidates"],
]) assert(actual === expected, `Partition ${label} drifted: ${actual} !== ${expected}.`);

assert(readyRows.length === 146, `Expected 146 ready rows, found ${readyRows.length}.`);
assert(heldRows.length === 21, `Expected 21 held rows, found ${heldRows.length}.`);
assert(structuralRows.length === 39, `Expected 39 structural rows, found ${structuralRows.length}.`);
assert(readyShells.length === 77, `Expected 77 ready player shells, found ${readyShells.length}.`);
assert(heldShells.length === 23, `Expected 23 held-only player shells, found ${heldShells.length}.`);
assert(readyRelationshipsInput.length === 355, `Expected 355 ready relationships, found ${readyRelationshipsInput.length}.`);
assert(heldRelationshipsInput.length === 100, `Expected 100 held relationships, found ${heldRelationshipsInput.length}.`);
assert(readyTeamDependencies.length === 292, `Expected 292 ready team dependencies, found ${readyTeamDependencies.length}.`);
assert(heldTeamDependencies.length === 60, `Expected 60 held team dependencies, found ${heldTeamDependencies.length}.`);
assert(readyDependencies.length === 432, `Expected 432 ready dependency seeds, found ${readyDependencies.length}.`);
assert(heldDependencies.length === 123, `Expected 123 held dependency seeds, found ${heldDependencies.length}.`);
assert(frozenDependencies.length === 555, `Expected 555 dependency seeds, found ${frozenDependencies.length}.`);

const readyPackages = readyRows.map((row) => ({
  tradeId: clean(row["Trade ID"]),
  canonicalId: clean(row["Canonical ID"]),
  canonicalAction: clean(row["Canonical Action"]),
  importAction: clean(row["Phase 16F Canonical Write"]) === "CANONICAL_CREATE_PREVIEW" ? "canonical-create" : "perspective-append",
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

assert(readyPackages.filter((item) => item.importAction === "canonical-create").length === 74, "Ready canonical-create count drifted.");
assert(readyPackages.filter((item) => item.importAction === "perspective-append").length === 72, "Ready perspective-append count drifted.");
assert(new Set(readyPackages.map((item) => item.tradeId)).size === 146, "Ready source IDs are not unique.");
assert(new Set(heldPackages.map((item) => item.tradeId)).size === 21, "Held source IDs are not unique.");
assert(new Set(exclusions.map((item) => item.tradeId)).size === 39, "Excluded source IDs are not unique.");
assert(JSON.stringify([...partitionDocument.readyTradeIds].sort()) === JSON.stringify(readyPackages.map((item) => item.tradeId).sort()), "Phase 16F ready IDs do not match ready-package CSV.");
assert(JSON.stringify([...partitionDocument.heldTradeIds].sort()) === JSON.stringify(heldPackages.map((item) => item.tradeId).sort()), "Phase 16F held IDs do not match held-package CSV.");
assert(JSON.stringify([...partitionDocument.structuralTradeIds].sort()) === JSON.stringify(exclusions.map((item) => item.tradeId).sort()), "Phase 16F structural IDs do not match structural CSV.");
assert(new Set(readyPackages.filter((item) => item.importAction === "perspective-append").map((item) => item.canonicalId)).size === 72, "Ready perspective targets are not unique.");

let existingReceipt = null;
try {
  existingReceipt = JSON.parse((await readFile(receiptPath)).toString("utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (existingReceipt) {
  assert(existingReceipt.result === "PASS" && existingReceipt.phase === "16H", "Existing Phase 16H receipt is invalid.");
  assert(existingReceipt.canonicalStoreSha256 === sha256(tradeBytes), "Replay canonical hash differs from receipt.");
  assert(existingReceipt.playerStoreSha256 === sha256(playerBytes), "Replay player hash differs from receipt.");
  assert(existingReceipt.teamStoreSha256 === sha256(teamBytes), "Replay team hash differs from receipt.");
  assert(existingReceipt.readyPackages === 146, "Replay ready-package count drifted.");
  assert(existingReceipt.canonicalTradesCreated === 74, "Replay create count drifted.");
  assert(existingReceipt.perspectivesAppended === 72, "Replay append count drifted.");
  assert(existingReceipt.playerShellsCreated === 76, "Replay shell count drifted.");
  assert(existingReceipt.readyShellsResolvedToExistingPlayers === 1, "Replay resolved-shell count drifted.");
  assert(existingReceipt.relationshipReferencesAdded === 355, "Replay relationship count drifted.");
  console.log(JSON.stringify({
    result: "PASS",
    phase: "16H",
    mode: "IDEMPOTENT_REPLAY",
    repositoryDataWrites: 0,
    canonicalStoreSha256: existingReceipt.canonicalStoreSha256,
    playerStoreSha256: existingReceipt.playerStoreSha256,
    teamStoreSha256: existingReceipt.teamStoreSha256,
    receiptSha256: sha256(canonicalJson(existingReceipt)),
  }, null, 2));
  process.exit(0);
}

assert(trades.length === 2014, `Expected 2,014 pre-import trades, found ${trades.length}.`);
assert(players.length === 2865, `Expected 2,865 pre-import players, found ${players.length}.`);
assert(teams.length === 52, `Expected 52 pre-import teams, found ${teams.length}.`);
assert(sha256(tradeBytes) === args["expected-trade-store-sha256"], "Pre-import trade-store hash drifted.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Pre-import player-store hash drifted.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Pre-import team-store hash drifted.");

const sourceRecords = new Map(recordsDocument.records.map((record) => [clean(record["Trade ID"]), record]));
const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const teamSet = new Set(teams.map(teamSlug).filter(Boolean));
assert(sourceRecords.size === 206, "Lakers source Trade IDs are not unique.");
assert(tradeMap.size === trades.length, "Duplicate pre-import canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate pre-import player ID.");
assert(teamSet.size === teams.length, "Duplicate team slug.");

const readySourceIds = new Set(readyPackages.map((item) => item.tradeId));
const heldSourceIds = new Set(heldPackages.map((item) => item.tradeId));
const exclusionSourceIds = new Set(exclusions.map((item) => item.tradeId));
const heldCanonicalSnapshots = new Map();
for (const packageRecord of heldPackages) {
  const targetId = clean(packageRecord.canonicalId);
  if (!targetId) continue;
  const trade = tradeMap.get(targetId);
  assert(trade, `${packageRecord.tradeId}: held canonical target is missing: ${targetId}`);
  heldCanonicalSnapshots.set(targetId, sha256(canonicalJson(trade)));
}
for (const sourceId of [...readySourceIds, ...heldSourceIds, ...exclusionSourceIds]) {
  assert(sourceRecords.has(sourceId), `Frozen source Trade ID is missing from reconciled records: ${sourceId}`);
}
for (const row of readyRows) {
  assert(clean(row["Phase 16F Partition"]) === "IMPORT_READY", `${row["Trade ID"]}: ready partition marker drifted.`);
  assert(clean(row["Routing Required"]) === "No", `${row["Trade ID"]}: routing-required package entered ready set.`);
  assert(clean(row["Recent Provisional"]) === "No", `${row["Trade ID"]}: recent provisional package entered ready set.`);
  assert(clean(row["Publication Authorized"]) === "No", `${row["Trade ID"]}: publication was authorized upstream.`);
}

const frozenShells = [...readyShells, ...heldShells];
const frozenRelationships = [...readyRelationshipsInput, ...heldRelationshipsInput];
assert(new Set(frozenShells.map((shell) => clean(shell["Proposed Player ID"]))).size === 100, "Frozen shell IDs are not unique.");
assert(new Set(frozenRelationships.map((row) => clean(row["Relationship Edge Key"]))).size === 455, "Frozen relationship IDs are not unique.");
assert(new Set([...readyTeamDependencies, ...heldTeamDependencies].map((row) => `${clean(row["Package Key"])}|${clean(row["Team Slug"])}`)).size === 352, "Frozen team dependency keys are not unique.");

const importedPlayerIds = [];
const resolvedReadyShellIds = [];
const redundantReadyShellIds = [];
for (const shell of readyShells) {
  const id = clean(shell["Proposed Player ID"]);
  const resolvedId = PHASE16H_EXISTING_PLAYER_TARGET_OVERRIDES.get(id);
  if (resolvedId) {
    assert(playerMap.has(resolvedId), `${id}: explicit existing-player target is missing: ${resolvedId}`);
    assert(!playerMap.has(id), `${id}: stale proposed shell unexpectedly exists.`);
    resolvedReadyShellIds.push(id);
    continue;
  }
  if (PHASE16H_REDUNDANT_READY_SHELL_IDS.has(id)) {
    assert(!playerMap.has(id), `Redundant ready shell unexpectedly exists: ${id}`);
    redundantReadyShellIds.push(id);
    continue;
  }
  assert(id && !playerMap.has(id), `Ready player-shell target already exists: ${id}`);
  playerMap.set(id, createPlayerShell(shell, args["imported-at"]));
  importedPlayerIds.push(id);
}
assert(importedPlayerIds.length === 76, `Expected 76 player-shell creates, found ${importedPlayerIds.length}.`);
assert(resolvedReadyShellIds.length === 1, `Expected one ready shell resolved to an existing player, found ${resolvedReadyShellIds.length}.`);
assert(redundantReadyShellIds.length === 0, "Unexpected redundant ready shell exclusion.");
for (const shell of heldShells) {
  const id = clean(shell["Proposed Player ID"]);
  assert(!playerMap.has(id), `Held-only player shell unexpectedly exists before import: ${id}`);
}

const readyRelationshipsFrozen = frozenRelationships.filter((row) => readySourceIds.has(clean(row["Trade ID"])));
assert(readyRelationshipsFrozen.length === 355, `Expected 355 frozen ready relationship previews, found ${readyRelationshipsFrozen.length}.`);
const readyRelationshipsWritable = readyRelationshipsFrozen.map(phase16HCorrectRelationship).filter(Boolean);
assert(readyRelationshipsWritable.length === 355, `Expected 355 writable ready relationships, found ${readyRelationshipsWritable.length}.`);
assert(readyDependencies.length === 432, `Expected 432 ready dependency seeds, found ${readyDependencies.length}.`);
const relationshipsByTradeId = new Map();
for (const relationship of readyRelationshipsWritable) {
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
const teamsByTradeId = new Map();
for (const teamDependency of readyTeamDependencies) {
  const sourceId = clean(teamDependency["Trade ID"]);
  if (!teamsByTradeId.has(sourceId)) teamsByTradeId.set(sourceId, []);
  teamsByTradeId.get(sourceId).push(teamDependency);
}
for (const sourceId of readySourceIds) {
  const rows = teamsByTradeId.get(sourceId) ?? [];
  assert(rows.length === 2, `${sourceId}: expected exactly two ready team dependencies, found ${rows.length}.`);
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
  const packageTeams = teamsByTradeId.get(sourceId) ?? [];
  const resolvedTeamSlugs = uniqueSorted(packageTeams.map((row) => clean(row["Team Slug"])));
  assert(resolvedTeamSlugs.length === 2 && resolvedTeamSlugs.includes("los-angeles-lakers"), `${sourceId}: ready package team dependency set drifted.`);
  let trade;

  if (packageRecord.importAction === "canonical-create") {
    const canonicalId = canonicalIdForSource(sourceId);
    assert(!tradeMap.has(canonicalId), `${sourceId}: proposed canonical ID already exists: ${canonicalId}`);
    trade = buildNewTrade({
      packageRecord,
      record,
      dependencyRows: dependenciesByTradeId.get(sourceId) ?? [],
      relationshipRows: packageRelationships,
      teamRows: packageTeams,
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
    assert(uniqueSorted(existing.teams ?? []).includes("los-angeles-lakers"), `${sourceId}: perspective target does not include Lakers.`);
    assert(JSON.stringify(uniqueSorted(existing.teams ?? [])) === JSON.stringify(resolvedTeamSlugs), `${sourceId}: perspective target team set differs from frozen team dependencies.`);
    protectedAppendProjectionHashes[targetId] = sha256(canonicalJson(immutableTradeProjection(existing)));
    trade = appendLakersPerspective(existing, record, args["imported-at"]);
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
      packageId: `los-angeles-lakers-phase-16h-${sourceId}`,
      sourceTeam: "los-angeles-lakers",
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

assert(importedCanonicalIds.length === 74, "Canonical-create count drifted.");
assert(appendedPerspectiveIds.length === 72, "Perspective-append count drifted.");
assert(relationshipIds.length === 355, "Relationship count drifted.");
assert(tradeMap.size === 2088, `Expected 2,088 post-import trades, found ${tradeMap.size}.`);
assert(playerMap.size === 2941, `Expected 2,941 post-import players, found ${playerMap.size}.`);
assert(matchedExistingAssetReferences + syntheticPerspectiveAssetReferences === 355, "Relationship asset-reference accounting drifted.");

const finalTrades = [...tradeMap.values()];
const finalPlayers = [...playerMap.values()];
const finalTeams = teams;
function hasSourcePerspective(trade, sourceId) {
  if (Array.isArray(trade.perspectives)) return trade.perspectives.some((p) => clean(p?.sourceTradeId) === sourceId);
  return Object.values(trade.perspectives ?? {}).some((p) => clean(p?.sourceTradeId) === sourceId || clean(p?.sourceSubmissionId).endsWith(sourceId));
}
for (const packageRecord of heldPackages) {
  const sourceId = clean(packageRecord.tradeId);
  const targetId = clean(packageRecord.canonicalId);
  assert(!importedCanonicalIds.includes(canonicalIdForSource(sourceId)), `${sourceId}: held package was imported as a new canonical trade.`);
  assert(!appendedPerspectiveIds.includes(targetId), `${sourceId}: held package received a Lakers perspective append.`);
  if (targetId) {
    const finalTrade = tradeMap.get(targetId);
    assert(finalTrade, `${sourceId}: held target disappeared after import.`);
    assert(sha256(canonicalJson(finalTrade)) === heldCanonicalSnapshots.get(targetId), `${sourceId}: held canonical target changed during import.`);
  }
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
  assert(sourcePerspectiveCount(trade, "los-angeles-lakers") === 1, `${sourceId}: Lakers perspective count is not exactly one.`);
  assert(trade.publishStatus === "private", `${sourceId}: publish status drifted.`);
  assert(trade.indexEligible === false && trade.adEligible === false && trade.publicationReady === false, `${sourceId}: exposure flags drifted.`);
}
for (const shell of heldShells) {
  assert(!playerMap.has(clean(shell["Proposed Player ID"])), `${shell["Proposed Player ID"]}: held-only player shell was imported.`);
}
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
  phase: "16H",
  mode: "FIRST_IMPORT",
  protocol: "Warp-Freeze Protocol",
  batchId: "los-angeles-lakers-phase-16h",
  startingHead: args["starting-head"],
  importedAt: args["imported-at"],
  sourceHashes: {
    phase16BRecordsSha256: sha256(recordsBytes),
    phase16FPartitionSha256: sha256(partitionBytes),
    phase16FSemanticPartitionSha256: partitionDocument.hashes.semanticPartitionSha256,
    readyPackagesSha256: sha256(readyPackageBytes),
    heldPackagesSha256: sha256(heldPackageBytes),
    structuralExclusionsSha256: sha256(structuralBytes),
    readyPlayerShellsSha256: sha256(readyShellBytes),
    heldPlayerShellsSha256: sha256(heldShellBytes),
    readyRelationshipsSha256: sha256(readyRelationshipBytes),
    heldRelationshipsSha256: sha256(heldRelationshipBytes),
    readyTeamDependenciesSha256: sha256(readyTeamBytes),
    heldTeamDependenciesSha256: sha256(heldTeamBytes),
    readyDependencySeedsSha256: sha256(readyDependencyBytes),
    heldDependencySeedsSha256: sha256(heldDependencyBytes),
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
  redundantReadyRelationshipEdgesExcluded: PHASE16H_REDUNDANT_READY_RELATIONSHIP_IDS.size,
  heldRelationshipEdgesDeferred: heldRelationshipsInput.length,
  readyTeamDependencies: readyTeamDependencies.length,
  heldTeamDependencies: heldTeamDependencies.length,
  existingPerspectiveReviewHolds: heldRows.filter((row) => clean(row["Existing Lakers Perspective"]) === "Yes").length,
  ambiguousIdentityOccurrencesDeferred: heldRelationshipsInput.filter((row) => clean(row["Identity Status"]) === "ambiguous-identity").length,
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
  readyShellsResolvedToExistingPlayerIds: uniqueSorted(resolvedReadyShellIds.map((id) => PHASE16H_EXISTING_PLAYER_TARGET_OVERRIDES.get(id))),
  redundantReadyShellIds: uniqueSorted(redundantReadyShellIds),
  explicitPlayerTargetCorrections: Object.fromEntries(PHASE16H_EXISTING_PLAYER_TARGET_OVERRIDES),
  explicitRelationshipTargetCorrections: Object.fromEntries(PHASE16H_EXPLICIT_RELATIONSHIP_TARGET_OVERRIDES),
  forcedSyntheticRelationshipIds: uniqueSorted([...PHASE16H_FORCE_SYNTHETIC_RELATIONSHIP_IDS]),
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
await atomicWrite(args["trades-json"], tradeOut, "phase16h-trades");
await atomicWrite(args["players-json"], playerOut, "phase16h-players");
await atomicWrite(receiptPath, receiptOut, "phase16h-receipt");

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
  readyTeamDependencies: receipt.readyTeamDependencies,
  heldTeamDependencies: receipt.heldTeamDependencies,
  existingPerspectiveReviewHolds: receipt.existingPerspectiveReviewHolds,
  ambiguousIdentityOccurrencesDeferred: receipt.ambiguousIdentityOccurrencesDeferred,
  matchedExistingAssetReferences: receipt.matchedExistingAssetReferences,
  syntheticPerspectiveAssetReferences: receipt.syntheticPerspectiveAssetReferences,
  sourceReferencesAdded: receipt.sourceReferencesAdded,
  canonicalStoreSha256: receipt.canonicalStoreSha256,
  playerStoreSha256: receipt.playerStoreSha256,
  teamStoreSha256: receipt.teamStoreSha256,
  receiptSha256: sha256(receiptOut),
}, null, 2));
