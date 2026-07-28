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
  if (kind === "player-rights") return "draft-rights-player";
  return "traded-player";
}
function referenceType(kind) {
  if (kind === "draft-outcome-player") return "draft_outcome";
  if (kind === "player-rights") return "draft_rights";
  return "direct_player";
}
function assetType(kind, rawAsset) {
  if (kind === "direct-player") return "player";
  if (kind === "draft-outcome-player") return "draft_pick";
  if (kind === "player-rights") return "draft_rights";
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
  const warriors = clean(record["Warriors Grade"]);
  const aggregate = clean(record["Partner Aggregate Grade"]);
  if (warriors) grades["golden-state-warriors"] = warriors;
  if (aggregate) {
    grades.partnerAggregate = aggregate;
    if (partner) grades[partner] = aggregate;
  }
  return grades;
}
function goldenStatePerspective(record, teams) {
  const partner = teams.find((team) => team !== "golden-state-warriors") ?? null;
  return {
    sourceTeam: "golden-state-warriors",
    sourceBatchId: "golden-state-warriors-phase-12g",
    sourceTradeId: clean(record["Trade ID"]),
    sourcePerspectiveKey: `golden-state-warriors:${clean(record["Trade ID"])}`,
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
function appendGoldenStatePerspective(existingTrade, record, importedAt) {
  const protectedBefore = JSON.stringify(immutableTradeProjection(existingTrade));
  assert(
    sourcePerspectiveCount(existingTrade, "golden-state-warriors") === 0,
    `${record["Trade ID"]}: Golden State perspective already exists.`,
  );
  const teams = uniqueSorted(existingTrade.teams ?? []);
  const perspective = goldenStatePerspective(record, teams);
  let perspectives;
  if (Array.isArray(existingTrade.perspectives)) {
    perspectives = [...existingTrade.perspectives, perspective];
  } else if (existingTrade.perspectives && typeof existingTrade.perspectives === "object") {
    perspectives = {
      ...existingTrade.perspectives,
      "golden-state-warriors": {
        sourceSubmissionId: `golden-state-warriors-phase-12g-${clean(record["Trade ID"])}`,
        sourceTradeId: clean(record["Trade ID"]),
        editorialStatus: "private-imported-golden-state-phase-12g",
        grade: clean(record["Warriors Grade"]),
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
  const warriorsGrade = clean(record["Warriors Grade"]);
  const partnerGrade = clean(record["Partner Aggregate Grade"]);
  if (warriorsGrade) mergedGrades["golden-state-warriors"] = warriorsGrade;
  if (partnerGrade && !mergedGrades.partnerAggregate) mergedGrades.partnerAggregate = partnerGrade;

  const updated = {
    ...existingTrade,
    sourceTeams: uniqueSorted([
      ...(Array.isArray(existingTrade.sourceTeams) ? existingTrade.sourceTeams : []),
      "golden-state-warriors",
    ]),
    perspectives,
    grades: mergedGrades,
    perspectiveReconciliations: [
      ...(Array.isArray(existingTrade.perspectiveReconciliations)
        ? existingTrade.perspectiveReconciliations
        : []),
      {
        sourceBatchId: "golden-state-warriors-phase-12g",
        sourceTradeId: clean(record["Trade ID"]),
        packageId: `golden-state-warriors-phase-12g-${clean(record["Trade ID"])}`,
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
    sourcePerspectiveCount(updated, "golden-state-warriors") === 1,
    `${record["Trade ID"]}: Golden State perspective append count drifted.`,
  );
  return updated;
}
function canonicalIdForSource(sourceTradeId) {
  const match = clean(sourceTradeId).match(/^GSW-(\d{4})-(\d{4})$/u);
  assert(match, `Invalid Golden State source Trade ID: ${sourceTradeId}`);
  return `nba-trade-gsw-${match[1]}-${match[2]}`;
}
function makeAssetId(sourceTradeId, side, assetIndex, rawAsset, fromTeam, toTeam) {
  return `phase12g-asset-${sha256(
    [sourceTradeId, side, assetIndex, rawAsset, fromTeam, toTeam].join("|"),
  )
    .slice(0, 20)
    .toLowerCase()}`;
}
function buildNewTrade({ packageRecord, record, dependencyRows, relationshipRows, importedAt, playerMap }) {
  const sourceTradeId = clean(record["Trade ID"]);
  const partner = clean(record["Counterpart Slugs"]);
  assert(partner && !partner.includes(","), `${sourceTradeId}: ready package must have exactly one counterpart slug.`);
  const teams = uniqueSorted(["golden-state-warriors", partner]);
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
      const fromTeam = side === "received" ? partner : "golden-state-warriors";
      const toTeam = side === "received" ? "golden-state-warriors" : partner;
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
        sourceTeam: "golden-state-warriors",
        edgeClass: "golden-state-source-route",
        routingStatus: "resolved",
        routingMethod: "two-team-direct",
        possibleFromTeams: [],
        possibleToTeams: [],
        privateOnly: true,
        previewOnly: false,
        auditStatus: "private-imported-golden-state-phase-12g",
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
  const perspective = goldenStatePerspective(record, teams);
  const canonicalId = canonicalIdForSource(sourceTradeId);
  const tradeDate = clean(record["Trade Date"]);
  const sources = [
    clean(record["Primary Source URL"])
      ? {
          sourceType: "primary_url",
          label: clean(record["Primary Source Label"]) || null,
          url: clean(record["Primary Source URL"]),
          sourceTeam: "golden-state-warriors",
          privateOnly: true,
        }
      : null,
    clean(record["Secondary Source URL"])
      ? {
          sourceType: "secondary_url",
          label: clean(record["Secondary Source Label"]) || null,
          url: clean(record["Secondary Source URL"]),
          sourceTeam: "golden-state-warriors",
          privateOnly: true,
        }
      : null,
  ].filter(Boolean);
  if (sources.length === 0) {
    sources.push({
      sourceType: "reconciled_workbook",
      label: clean(record["Primary Source Label"]) || "Golden State reconciled audit workbook",
      sourceTradeId,
      sourceTeam: "golden-state-warriors",
      privateOnly: true,
    });
  }
  return {
    id: canonicalId,
    tradeId: canonicalId,
    sourceTradeId,
    canonicalKey: canonicalId,
    slug: `golden-state-warriors-trade-${tradeDate}-${sourceTradeId.split("-").at(-1)}`,
    league: "nba",
    tradeDate,
    date: tradeDate,
    seasonLabel: seasonLabel(tradeDate),
    season: seasonStartYear(tradeDate),
    teams,
    sourceTeamLabels: uniqueSorted([
      clean(record["Franchise Label"]) || "Golden State Warriors",
      clean(record["Partner Team(s)"]),
    ]),
    assetsReceived: byReceived,
    assetsSent: bySent,
    assetsSentByTeam: bySent,
    assetLedger: assets,
    sourceTeams: ["golden-state-warriors"],
    perspectives: { "golden-state-warriors": perspective },
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
    importReviewStatus: "private-imported-golden-state-phase-12g",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    sources,
    perspectiveReconciliations: [
      {
        sourceBatchId: "golden-state-warriors-phase-12g",
        sourceTradeId,
        packageId: `golden-state-warriors-phase-12g-${sourceTradeId}`,
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
    importReviewStatus: "private-shell-imported-golden-state-phase-12g",
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
function assetMatchesGoldenStateSide(asset, side) {
  const possibleFrom = Array.isArray(asset.possibleFromTeams) ? asset.possibleFromTeams : [];
  const possibleTo = Array.isArray(asset.possibleToTeams) ? asset.possibleToTeams : [];
  if (side === "received") {
    return clean(asset.toTeam) === "golden-state-warriors" || possibleTo.includes("golden-state-warriors");
  }
  return clean(asset.fromTeam) === "golden-state-warriors" || possibleFrom.includes("golden-state-warriors");
}
function resolveRelationshipAssetReference(trade, relationship, player) {
  const assets = Array.isArray(trade.assetLedger) ? trade.assetLedger : [];
  const candidates = assets
    .map((asset) => ({
      asset,
      score: assetMatchScore(asset, relationship, player),
      sideMatch: assetMatchesGoldenStateSide(asset, clean(relationship.Side)),
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
    assetId: `phase12g-perspective-asset-${sha256(
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

const args = parseArgs(process.argv);
for (const required of [
  "records-json",
  "partition-json",
  "player-shells-csv",
  "relationships-csv",
  "dependency-seeds-csv",
  "trades-json",
  "players-json",
  "teams-json",
  "receipt-json",
  "contract-md",
  "expected-records-sha256",
  "expected-partition-sha256",
  "expected-partition-internal-sha256",
  "expected-player-shells-sha256",
  "expected-relationships-sha256",
  "expected-dependency-seeds-sha256",
  "expected-trade-store-sha256",
  "expected-player-store-sha256",
  "expected-team-store-sha256",
  "imported-at",
  "starting-head",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  recordsBytes,
  partitionBytes,
  playerShellBytes,
  relationshipBytes,
  dependencyBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  contractBytes,
] = await Promise.all([
  readFile(args["records-json"]),
  readFile(args["partition-json"]),
  readFile(args["player-shells-csv"]),
  readFile(args["relationships-csv"]),
  readFile(args["dependency-seeds-csv"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["contract-md"]),
]);
const recordsDocument = JSON.parse(recordsBytes.toString("utf8"));
const partition = JSON.parse(partitionBytes.toString("utf8"));
const frozenShells = parseCsv(playerShellBytes.toString("utf8"));
const frozenRelationships = parseCsv(relationshipBytes.toString("utf8"));
const frozenDependencies = parseCsv(dependencyBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const receiptPath = path.resolve(args["receipt-json"]);

assert(recordsDocument.result === "PASS" && Array.isArray(recordsDocument.records), "Invalid reconciled records document.");
assert(partition.result === "PASS" && partition.phase === "12F", "Invalid Phase 12F partition.");
assert(sha256(recordsBytes) === args["expected-records-sha256"], "Reconciled records hash drifted.");
assert(sha256(partitionBytes) === args["expected-partition-sha256"], "Phase 12F partition file hash drifted.");
assert(
  partition.hashes.finalImportPartitionSha256 === args["expected-partition-internal-sha256"],
  "Phase 12F internal partition hash drifted.",
);
assert(sha256(playerShellBytes) === args["expected-player-shells-sha256"], "Frozen player-shell hash drifted.");
assert(sha256(relationshipBytes) === args["expected-relationships-sha256"], "Frozen relationship hash drifted.");
assert(sha256(dependencyBytes) === args["expected-dependency-seeds-sha256"], "Frozen dependency-seed hash drifted.");
assert(Array.isArray(trades) && Array.isArray(players) && Array.isArray(teams), "A repository store is invalid.");
assert(contractBytes.length > 0, "Phase 12G contract is empty.");
for (const [actual, expected, label] of [
  [partition.counts.finalReadyPackages, 199, "ready packages"],
  [partition.counts.remainingHeldPackages, 16, "held packages"],
  [partition.counts.canonicalCreatePackages, 149, "canonical creates"],
  [partition.counts.perspectiveAppendPackages, 50, "perspective appends"],
  [partition.counts.dateCollisionDistinctCreates, 20, "date-collision creates"],
  [partition.counts.linkedOrVoidedExclusions, 6, "linked/voided exclusions"],
  [partition.counts.proposedPlayerShells, 177, "frozen shell proposals"],
  [partition.counts.relationshipPreviews, 534, "frozen relationship previews"],
]) {
  assert(actual === expected, `Partition ${label} drifted: ${actual} !== ${expected}.`);
}

let existingReceipt = null;
try {
  existingReceipt = JSON.parse((await readFile(receiptPath)).toString("utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (existingReceipt) {
  assert(existingReceipt.result === "PASS" && existingReceipt.phase === "12G", "Existing Phase 12G receipt is invalid.");
  assert(existingReceipt.canonicalStoreSha256 === sha256(tradeBytes), "Replay canonical hash differs from receipt.");
  assert(existingReceipt.playerStoreSha256 === sha256(playerBytes), "Replay player hash differs from receipt.");
  assert(existingReceipt.teamStoreSha256 === sha256(teamBytes), "Replay team hash differs from receipt.");
  assert(existingReceipt.readyPackages === 199, "Replay ready-package count drifted.");
  assert(existingReceipt.canonicalTradesCreated === 149, "Replay create count drifted.");
  assert(existingReceipt.perspectivesAppended === 50, "Replay append count drifted.");
  assert(existingReceipt.playerShellsCreated === 164, "Replay shell count drifted.");
  assert(existingReceipt.relationshipReferencesAdded === 479, "Replay relationship count drifted.");
  console.log(JSON.stringify({
    result: "PASS",
    phase: "12G",
    mode: "IDEMPOTENT_REPLAY",
    repositoryDataWrites: 0,
    canonicalStoreSha256: existingReceipt.canonicalStoreSha256,
    playerStoreSha256: existingReceipt.playerStoreSha256,
    teamStoreSha256: existingReceipt.teamStoreSha256,
    receiptSha256: sha256(canonicalJson(existingReceipt)),
  }, null, 2));
  process.exit(0);
}

assert(trades.length === 1567, `Expected 1,567 pre-import trades, found ${trades.length}.`);
assert(players.length === 2402, `Expected 2,402 pre-import players, found ${players.length}.`);
assert(teams.length === 52, `Expected 52 pre-import teams, found ${teams.length}.`);
assert(sha256(tradeBytes) === args["expected-trade-store-sha256"], "Pre-import trade-store hash drifted.");
assert(sha256(playerBytes) === args["expected-player-store-sha256"], "Pre-import player-store hash drifted.");
assert(sha256(teamBytes) === args["expected-team-store-sha256"], "Pre-import team-store hash drifted.");

const sourceRecords = new Map(recordsDocument.records.map((record) => [clean(record["Trade ID"]), record]));
const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const teamSet = new Set(teams.map(teamSlug).filter(Boolean));
assert(sourceRecords.size === 221, "Reconciled source Trade IDs are not unique.");
assert(tradeMap.size === trades.length, "Duplicate pre-import canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate pre-import player ID.");
assert(teamSet.size === teams.length, "Duplicate team slug.");

const readySourceIds = new Set(partition.finalReadyPackages.map((item) => clean(item.tradeId)));
const heldSourceIds = new Set(partition.remainingHeldPackages.map((item) => clean(item.tradeId)));
const exclusionSourceIds = new Set(partition.linkedOrVoidedExclusions.map((item) => clean(item.tradeId)));
assert(readySourceIds.size === 199, "Ready source IDs are not unique.");
assert(heldSourceIds.size === 16, "Held source IDs are not unique.");
assert(exclusionSourceIds.size === 6, "Excluded source IDs are not unique.");
for (const sourceId of [...readySourceIds, ...heldSourceIds, ...exclusionSourceIds]) {
  assert(sourceRecords.has(sourceId), `Frozen source Trade ID is missing from reconciled records: ${sourceId}`);
}

const relevantShells = frozenShells.filter((shell) => {
  const ids = clean(shell["Source Trade IDs"]).split(";").map(clean).filter(Boolean);
  return ids.some((id) => readySourceIds.has(id));
});
const deferredShells = frozenShells.filter((shell) => !relevantShells.includes(shell));
assert(relevantShells.length === 164, `Expected 164 ready-dependent player shells, found ${relevantShells.length}.`);
assert(deferredShells.length === 13, `Expected 13 held-only player shells, found ${deferredShells.length}.`);

const importedPlayerIds = [];
for (const shell of relevantShells) {
  const id = clean(shell["Proposed Player ID"]);
  assert(id && !playerMap.has(id), `Ready player-shell target already exists: ${id}`);
  playerMap.set(id, createPlayerShell(shell, args["imported-at"]));
  importedPlayerIds.push(id);
}
for (const shell of deferredShells) {
  const id = clean(shell["Proposed Player ID"]);
  assert(!playerMap.has(id), `Held-only player shell unexpectedly exists before import: ${id}`);
}

const readyRelationships = frozenRelationships.filter((row) => readySourceIds.has(clean(row["Trade ID"])));
const readyDependencies = frozenDependencies.filter((row) => readySourceIds.has(clean(row["Trade ID"])));
assert(readyRelationships.length === 479, `Expected 479 ready relationship previews, found ${readyRelationships.length}.`);
assert(readyDependencies.length > 0, "No ready dependency seeds were found.");
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

for (const packageRecord of partition.finalReadyPackages) {
  const sourceId = clean(packageRecord.tradeId);
  const record = sourceRecords.get(sourceId);
  assert(record, `${sourceId}: reconciled source record is missing.`);
  assert(clean(record["Routing Required"]) === "No", `${sourceId}: a routing-required package entered the ready partition.`);
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
    for (const team of trade.teams) {
      assert(teamSet.has(team), `${sourceId}: unknown team slug ${team}.`);
    }
    tradeMap.set(trade.id, trade);
    importedCanonicalIds.push(trade.id);
  } else {
    assert(packageRecord.importAction === "perspective-append", `${sourceId}: unsupported import action.`);
    const targetId = clean(packageRecord.canonicalId);
    const existing = tradeMap.get(targetId);
    assert(existing, `${sourceId}: perspective target is missing: ${targetId}`);
    protectedAppendProjectionHashes[targetId] = sha256(canonicalJson(immutableTradeProjection(existing)));
    trade = appendGoldenStatePerspective(existing, record, args["imported-at"]);
    assert(
      sha256(canonicalJson(immutableTradeProjection(trade))) === protectedAppendProjectionHashes[targetId],
      `${sourceId}: protected append projection hash drifted.`,
    );
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
      const dependency = (dependenciesByTradeId.get(sourceId) ?? []).find(
        (row) => clean(row["Dependency Key"]) === dependencyKey,
      );
      assert(dependency, `${relationship["Relationship Edge Key"]}: dependency seed is missing.`);
      const asset = trade.assetLedger.find(
        (item) =>
          item.direction === clean(relationship.Side) &&
          clean(item.displayText) === clean(relationship["Raw Asset"]),
      );
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
      packageId: `golden-state-warriors-phase-12g-${sourceId}`,
      sourceTeam: "golden-state-warriors",
      perspectiveLocalAssetReference: assetReference.synthetic,
      privateOnly: true,
    };
    const matchedAsset = assetReference.synthetic
      ? null
      : trade.assetLedger?.find((item) => clean(item.assetId) === assetReference.assetId) ?? null;
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

assert(importedCanonicalIds.length === 149, "Canonical-create count drifted.");
assert(appendedPerspectiveIds.length === 50, "Perspective-append count drifted.");
assert(relationshipIds.length === 479, "Relationship count drifted.");
assert(tradeMap.size === 1716, `Expected 1,716 post-import trades, found ${tradeMap.size}.`);
assert(playerMap.size === 2566, `Expected 2,566 post-import players, found ${playerMap.size}.`);
assert(matchedExistingAssetReferences + syntheticPerspectiveAssetReferences === 479, "Relationship asset-reference accounting drifted.");

const finalTrades = [...tradeMap.values()];
const finalPlayers = [...playerMap.values()];
const finalTeams = teams;
for (const sourceId of heldSourceIds) {
  assert(!finalTrades.some((trade) => clean(trade.sourceTradeId) === sourceId), `${sourceId}: held package was imported as a standalone trade.`);
  assert(!finalTrades.some((trade) => {
    if (Array.isArray(trade.perspectives)) {
      return trade.perspectives.some((perspective) => clean(perspective?.sourceTradeId) === sourceId);
    }
    return Object.values(trade.perspectives ?? {}).some((perspective) => clean(perspective?.sourceTradeId) === sourceId || clean(perspective?.sourceSubmissionId).endsWith(sourceId));
  }), `${sourceId}: held package was imported as a perspective.`);
}
for (const sourceId of exclusionSourceIds) {
  assert(!finalTrades.some((trade) => clean(trade.sourceTradeId) === sourceId), `${sourceId}: excluded package was imported as a standalone trade.`);
}
for (const packageRecord of partition.finalReadyPackages) {
  const sourceId = clean(packageRecord.tradeId);
  const targetId = packageRecord.importAction === "canonical-create"
    ? canonicalIdForSource(sourceId)
    : clean(packageRecord.canonicalId);
  const trade = tradeMap.get(targetId);
  assert(trade, `${sourceId}: target trade is missing after import.`);
  assert(sourcePerspectiveCount(trade, "golden-state-warriors") === 1, `${sourceId}: Golden State perspective count is not exactly one.`);
  assert(trade.publishStatus === "private", `${sourceId}: publish status drifted.`);
  assert(trade.indexEligible === false, `${sourceId}: index eligibility drifted.`);
  assert(trade.adEligible === false, `${sourceId}: ad eligibility drifted.`);
  assert(trade.publicationReady === false, `${sourceId}: publication readiness drifted.`);
}

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
  phase: "12G",
  mode: "FIRST_IMPORT",
  protocol: "Warp-Freeze Protocol",
  batchId: "golden-state-warriors-phase-12g",
  startingHead: args["starting-head"],
  importedAt: args["imported-at"],
  sourceHashes: {
    phase12DRecordsSha256: sha256(recordsBytes),
    phase12FFileSha256: sha256(partitionBytes),
    phase12FInternalPartitionSha256: partition.hashes.finalImportPartitionSha256,
    finalReadyPackagesSha256: partition.hashes.finalReadyPackagesSha256,
    remainingHeldPackagesSha256: partition.hashes.remainingHeldPackagesSha256,
    linkedOrVoidedExclusionsSha256: partition.hashes.linkedOrVoidedExclusionsSha256,
    proposedPlayerShellsSha256: sha256(playerShellBytes),
    relationshipPreviewsSha256: sha256(relationshipBytes),
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
  readyPackages: partition.finalReadyPackages.length,
  heldPackages: partition.remainingHeldPackages.length,
  linkedOrVoidedExclusions: partition.linkedOrVoidedExclusions.length,
  canonicalTradesCreated: importedCanonicalIds.length,
  perspectivesAppended: appendedPerspectiveIds.length,
  dateCollisionDistinctCreates: partition.counts.dateCollisionDistinctCreates,
  frozenPlayerShellProposals: frozenShells.length,
  playerShellsCreated: importedPlayerIds.length,
  heldOnlyPlayerShellsDeferred: deferredShells.length,
  relationshipReferencesAdded: relationshipIds.length,
  matchedExistingAssetReferences,
  syntheticPerspectiveAssetReferences,
  sourceReferencesAdded,
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
  deferredPlayerIds: uniqueSorted(deferredShells.map((shell) => clean(shell["Proposed Player ID"]))),
  relationshipIds: uniqueSorted(relationshipIds),
  heldSourceTradeIds: uniqueSorted([...heldSourceIds]),
  linkedOrVoidedExcludedSourceTradeIds: uniqueSorted([...exclusionSourceIds]),
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
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};
const receiptOut = canonicalJson(receipt);
await atomicWrite(args["trades-json"], tradeOut, "phase12g-trades");
await atomicWrite(args["players-json"], playerOut, "phase12g-players");
await atomicWrite(receiptPath, receiptOut, "phase12g-receipt");

console.log(JSON.stringify({
  result: receipt.result,
  phase: receipt.phase,
  mode: receipt.mode,
  readyPackages: receipt.readyPackages,
  heldPackages: receipt.heldPackages,
  canonicalTradesCreated: receipt.canonicalTradesCreated,
  perspectivesAppended: receipt.perspectivesAppended,
  playerShellsCreated: receipt.playerShellsCreated,
  heldOnlyPlayerShellsDeferred: receipt.heldOnlyPlayerShellsDeferred,
  relationshipReferencesAdded: receipt.relationshipReferencesAdded,
  matchedExistingAssetReferences: receipt.matchedExistingAssetReferences,
  syntheticPerspectiveAssetReferences: receipt.syntheticPerspectiveAssetReferences,
  sourceReferencesAdded: receipt.sourceReferencesAdded,
  canonicalStoreSha256: receipt.canonicalStoreSha256,
  playerStoreSha256: receipt.playerStoreSha256,
  teamStoreSha256: receipt.teamStoreSha256,
  receiptSha256: sha256(receiptOut),
}, null, 2));
