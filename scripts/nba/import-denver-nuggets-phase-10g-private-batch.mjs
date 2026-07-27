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
    .replace(/[‘’'`"]/gu, "")
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
    (total, trade) =>
      total + uniqueSorted(Array.isArray(trade.teams) ? trade.teams : []).length,
    0,
  );
}
function countPlayerTradeReferences(players) {
  return players.reduce((total, player) => {
    const references = Array.isArray(player.relationshipReferences)
      ? player.relationshipReferences
      : [];
    return total + references.length;
  }, 0);
}

const IDENTITY_CORRECTIONS = new Map();
function correctedPlayerId(value) {
  return clean(value);
}
function correctedShell(shell) {
  return shell;
}
function correctedRelationship(relationship) {
  return relationship;
}

const TEAM_NAME_TO_SLUG = new Map([
  ["Anaheim Amigos (ABA)", "los-angeles-stars"],
  ["Atlanta Hawks", "atlanta-hawks"],
  ["Baltimore Claws (ABA)", "memphis-sounds"],
  ["Boston Celtics", "boston-celtics"],
  ["Brooklyn Nets", "brooklyn-nets"],
  ["Buffalo Braves", "los-angeles-clippers"],
  ["Carolina Cougars (ABA)", "spirits-of-st-louis"],
  ["Charlotte Bobcats", "charlotte-hornets"],
  ["Charlotte Hornets", "charlotte-hornets"],
  ["Chicago Bulls", "chicago-bulls"],
  ["Cleveland Cavaliers", "cleveland-cavaliers"],
  ["Dallas Chaparrals (ABA)", "san-antonio-spurs"],
  ["Dallas Mavericks", "dallas-mavericks"],
  ["Detroit Pistons", "detroit-pistons"],
  ["Golden State Warriors", "golden-state-warriors"],
  ["Houston Mavericks (ABA)", "spirits-of-st-louis"],
  ["Houston Rockets", "houston-rockets"],
  ["Indiana Pacers", "indiana-pacers"],
  ["Indiana Pacers (ABA)", "indiana-pacers"],
  ["Kentucky Colonels (ABA)", "kentucky-colonels"],
  ["Los Angeles Clippers", "los-angeles-clippers"],
  ["Los Angeles Lakers", "los-angeles-lakers"],
  ["Memphis Grizzlies", "memphis-grizzlies"],
  ["Memphis Sounds (ABA)", "memphis-sounds"],
  ["Miami Heat", "miami-heat"],
  ["Milwaukee Bucks", "milwaukee-bucks"],
  ["Minnesota Muskies (ABA)", "the-floridians"],
  ["Minnesota Timberwolves", "minnesota-timberwolves"],
  ["New Orleans Buccaneers (ABA)", "memphis-sounds"],
  ["New Orleans Hornets", "new-orleans-pelicans"],
  ["New Orleans Pelicans", "new-orleans-pelicans"],
  ["New York Knicks", "new-york-knicks"],
  ["New York Nets (ABA)", "brooklyn-nets"],
  ["Oklahoma City Thunder", "oklahoma-city-thunder"],
  ["Orlando Magic", "orlando-magic"],
  ["Philadelphia 76ers", "philadelphia-76ers"],
  ["Phoenix Suns", "phoenix-suns"],
  ["Pittsburgh Condors (ABA)", "pittsburgh-condors"],
  ["Portland Trail Blazers", "portland-trail-blazers"],
  ["Sacramento Kings", "sacramento-kings"],
  ["San Antonio Spurs", "san-antonio-spurs"],
  ["San Diego Conquistadors (ABA)", "san-diego-sails"],
  ["San Diego Sails (ABA)", "san-diego-sails"],
  ["Seattle SuperSonics", "seattle-supersonics"],
  ["Spirits of St. Louis (ABA)", "spirits-of-st-louis"],
  ["The Floridians (ABA)", "the-floridians"],
  ["Toronto Raptors", "toronto-raptors"],
  ["Utah Jazz", "utah-jazz"],
  ["Utah Stars (ABA)", "los-angeles-stars"],
  ["Virginia Squires (ABA)", "virginia-squires"],
  ["Washington Bullets", "washington-wizards"],
  ["Washington Wizards", "washington-wizards"],
]);

function partnerTeams(sourceRecord) {
  const names = clean(sourceRecord["Trade Partner(s)"])
    .split(",")
    .map(clean)
    .filter(Boolean);
  const slugs = names.map((name) => {
    const mapped = TEAM_NAME_TO_SLUG.get(name);
    assert(mapped, `${sourceRecord["Trade ID"]}: unmapped partner team ${name}`);
    return mapped;
  });
  return uniqueSorted(slugs);
}

function routeAsset(sourceRecord, side, rawAsset, partners, explicitRoutingMap) {
  if (partners.length === 1) {
    return side === "received"
      ? {
          fromTeam: partners[0],
          toTeam: "denver-nuggets",
          possibleFromTeams: [],
          possibleToTeams: [],
          routingStatus: "resolved",
          routingMethod: "two-team-direct",
        }
      : {
          fromTeam: "denver-nuggets",
          toTeam: partners[0],
          possibleFromTeams: [],
          possibleToTeams: [],
          routingStatus: "resolved",
          routingMethod: "two-team-direct",
        };
  }

  const tradeIdValue = clean(sourceRecord["Trade ID"]);
  const configured =
    explicitRoutingMap?.routes?.[tradeIdValue]?.[side]?.[clean(rawAsset)] ?? null;

  assert(
    configured,
    `${tradeIdValue}: missing explicit ${side} route for asset "${clean(rawAsset)}".`,
  );
  assert(
    partners.includes(configured),
    `${tradeIdValue}: explicit ${side} route ${configured} is not in the frozen team set.`,
  );

  return side === "received"
    ? {
        fromTeam: configured,
        toTeam: "denver-nuggets",
        possibleFromTeams: [],
        possibleToTeams: [],
        routingStatus: "resolved",
        routingMethod: "phase10g-explicit-routing-map",
      }
    : {
        fromTeam: "denver-nuggets",
        toTeam: configured,
        possibleFromTeams: [],
        possibleToTeams: [],
        routingStatus: "resolved",
        routingMethod: "phase10g-explicit-routing-map",
      };
}
function inferAssetType(value) {
  const text = normalize(value);
  if (/\bcash\b|\bfinancial\b/u.test(text)) return "cash";
  if (/\b(?:trade exception|traded player exception|tpe)\b/u.test(text)) {
    return "trade_exception";
  }
  if (/\b(?:swap|option to swap)\b/u.test(text)) return "draft_swap";
  if (/\b(?:draft rights|rights to)\b/u.test(text)) return "draft_rights";
  if (/\b(?:first round|second round|third round|draft pick|pick)\b/u.test(text)) {
    return "draft_pick";
  }
  if (/\b(?:future considerations|conditional consideration)\b/u.test(text)) {
    return "consideration";
  }
  return "player";
}
function relationshipRole(identityKind) {
  if (identityKind === "draft_pick_player") return "pick-became-player";
  if (identityKind === "draft_rights_player") return "draft-rights-player";
  if (identityKind === "expansion_selection_player") {
    return "expansion-selection-player";
  }
  if (identityKind === "free_agent_rights_player") {
    return "free-agent-rights-player";
  }
  return "traded-player";
}
function referenceType(identityKind) {
  if (identityKind === "draft_pick_player") return "draft_outcome";
  if (identityKind === "draft_rights_player") return "draft_rights";
  if (identityKind === "expansion_selection_player") return "expansion_selection";
  if (identityKind === "free_agent_rights_player") return "free_agent_rights";
  return "direct_player";
}
function perspectiveGrades(sourceRecord, teams) {
  const grades = {
    "denver-nuggets": clean(sourceRecord["Nuggets Grade"]),
  };
  const partnerGrade = clean(sourceRecord["Partner Aggregate Grade"]);
  if (partnerGrade) {
    grades.partnerAggregate = partnerGrade;
    if (teams.length === 2) {
      const partner = teams.find((team) => team !== "denver-nuggets");
      if (partner) grades[partner] = partnerGrade;
    }
  }
  return grades;
}
function denverPerspective(sourceRecord, teams) {
  return {
    sourceTeam: "denver-nuggets",
    sourceBatchId: "denver-nuggets-phase-10g",
    sourceTradeId: clean(sourceRecord["Trade ID"]),
    sourcePerspectiveKey:
      `denver-nuggets:${clean(sourceRecord["Trade ID"])}`,
    summary: clean(sourceRecord["Final Trade Summary"]),
    analysis: clean(sourceRecord["Final Trade Analysis"]),
    verdict: clean(sourceRecord["Final Verdict"]),
    grades: perspectiveGrades(sourceRecord, teams),
    aggregatePartnerGrade: clean(sourceRecord["Partner Aggregate Grade"]) || null,
    confidence: clean(sourceRecord["Confidence"]).toLowerCase(),
    reviewStatus: clean(sourceRecord["Review Status"]),
    contentClass: clean(sourceRecord["Content Class"]),
    lowValueRisk: clean(sourceRecord["Low-Value Risk"]),
    tradeTier: clean(sourceRecord["Trade Tier"]).toLowerCase(),
    primarySourceUrl: clean(sourceRecord["Primary Source URL"]) || null,
    secondarySourceUrl: clean(sourceRecord["Secondary Source URL"]) || null,
    privateOnly: true,
    publishStatus: "private",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
  };
}
function sourcePerspectiveCount(trade, team) {
  const perspectives = trade.perspectives;
  if (Array.isArray(perspectives)) {
    return perspectives.filter(
      (perspective) =>
        clean(
          perspective.sourceTeam ??
            perspective.teamId ??
            perspective.team ??
            perspective.perspectiveTeam,
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
    createdAt: trade.createdAt,
  };
}
function appendDenverPerspective(existingTrade, sourceRecord, importedAt) {
  const protectedBefore = JSON.stringify(immutableTradeProjection(existingTrade));
  assert(
    sourcePerspectiveCount(existingTrade, "denver-nuggets") === 0,
    `${sourceRecord["Trade ID"]}: Denver perspective already exists.`,
  );

  const teams = uniqueSorted(existingTrade.teams ?? []);
  const perspective = denverPerspective(sourceRecord, teams);
  let perspectives;
  if (Array.isArray(existingTrade.perspectives)) {
    perspectives = [...existingTrade.perspectives, perspective];
  } else if (
    existingTrade.perspectives &&
    typeof existingTrade.perspectives === "object"
  ) {
    perspectives = {
      ...existingTrade.perspectives,
      "denver-nuggets": {
        sourceSubmissionId:
          `denver-nuggets-phase-10g-${clean(sourceRecord["Trade ID"])}`,
        editorialStatus: "private-imported-denver-phase-10g",
        grade: clean(sourceRecord["Nuggets Grade"]),
        verdict: clean(sourceRecord["Final Verdict"]),
        summary: clean(sourceRecord["Final Trade Summary"]),
        analysis: clean(sourceRecord["Final Trade Analysis"]),
        confidence: clean(sourceRecord["Confidence"]),
        reviewStatus: clean(sourceRecord["Review Status"]),
        tradeTier: clean(sourceRecord["Trade Tier"]),
        contentClass: clean(sourceRecord["Content Class"]),
        lowValueRisk: clean(sourceRecord["Low-Value Risk"]),
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

  const mergedGrades = {
    ...(existingTrade.grades ?? {}),
    "denver-nuggets": clean(sourceRecord["Nuggets Grade"]),
  };
  const partnerGrade = clean(sourceRecord["Partner Aggregate Grade"]);
  if (partnerGrade && !mergedGrades.partnerAggregate) {
    mergedGrades.partnerAggregate = partnerGrade;
  }

  const updated = {
    ...existingTrade,
    sourceTeams: uniqueSorted([
      ...(Array.isArray(existingTrade.sourceTeams)
        ? existingTrade.sourceTeams
        : []),
      "denver-nuggets",
    ]),
    perspectives,
    grades: mergedGrades,
    perspectiveReconciliations: [
      ...(Array.isArray(existingTrade.perspectiveReconciliations)
        ? existingTrade.perspectiveReconciliations
        : []),
      {
        sourceBatchId: "denver-nuggets-phase-10g",
        sourceTradeId: clean(sourceRecord["Trade ID"]),
        packageId: `denver-nuggets-phase-10g-${clean(
          sourceRecord["Trade ID"],
        )}`,
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
    `${sourceRecord["Trade ID"]}: perspective append altered protected canonical fields.`,
  );
  assert(
    sourcePerspectiveCount(updated, "denver-nuggets") === 1,
    `${sourceRecord["Trade ID"]}: Denver perspective append count drifted.`,
  );
  return updated;
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
function makeAssetId(sourceTradeId, side, assetIndex, rawAsset, route) {
  return `phase10g-asset-${sha256(
    [
      sourceTradeId,
      side,
      assetIndex,
      rawAsset,
      route.fromTeam,
      route.toTeam,
      (route.possibleFromTeams ?? []).join(","),
      (route.possibleToTeams ?? []).join(","),
    ].join("|"),
  )
    .slice(0, 20)
    .toLowerCase()}`;
}
function buildNewTrade(packageRecord, relationshipRows, importedAt, playerMap, explicitRoutingMap, routingStats) {
  const sourceRecord = packageRecord.sourceRecord;
  const partners = partnerTeams(sourceRecord);
  const teams = uniqueSorted(["denver-nuggets", ...partners]);
  const relationshipByAsset = new Map();
  for (const relationship of relationshipRows) {
    const key = `${relationship.side}|${clean(relationship.rawAsset)}`;
    if (!relationshipByAsset.has(key)) relationshipByAsset.set(key, []);
    relationshipByAsset.get(key).push(relationship);
  }

  const assets = [];
  for (const [field, side] of [
    ["Nuggets Received", "received"],
    ["Nuggets Sent", "sent"],
  ]) {
    const rawAssets = clean(sourceRecord[field])
      .split(";")
      .map(clean)
      .filter(Boolean);
    rawAssets.forEach((rawAsset, index) => {
      const route = routeAsset(sourceRecord, side, rawAsset, partners, explicitRoutingMap);
      if (route.routingMethod === "phase10g-explicit-routing-map") {
        routingStats.explicitRoutingAssetsApplied += 1;
      }
      const relationships =
        relationshipByAsset.get(`${side}|${rawAsset}`) ?? [];
      const asset = {
        assetId: makeAssetId(
          clean(sourceRecord["Trade ID"]),
          side,
          index + 1,
          rawAsset,
          route,
        ),
        type: inferAssetType(rawAsset),
        displayText: rawAsset,
        asset: rawAsset,
        fromTeam: route.fromTeam,
        toTeam: route.toTeam,
        direction: side,
        sourceTeam: "denver-nuggets",
        edgeClass: "denver-source-route",
        routingStatus: route.routingStatus,
        routingMethod: route.routingMethod,
        possibleFromTeams: route.possibleFromTeams,
        possibleToTeams: route.possibleToTeams,
        privateOnly: true,
        previewOnly: false,
        auditStatus: "private-imported-denver-phase-10g",
      };
      if (relationships.length > 0) {
        asset.playerRelationshipIds = relationships.map(
          (relationship) => relationship.relationshipEdgeKey,
        );
        asset.playerIds = relationships.map(
          (relationship) => relationship.targetPlayerId,
        );
        if (relationships.length === 1) {
          const relationship = relationships[0];
          const player = playerMap.get(relationship.targetPlayerId);
          const displayName = clean(
            player?.displayName ?? player?.name ?? relationship.targetPlayerId,
          );
          if (asset.type === "draft_pick") {
            asset.becamePlayerName = displayName;
            asset.becamePlayerId = relationship.targetPlayerId;
          } else {
            asset.playerName = displayName;
            asset.playerId = relationship.targetPlayerId;
            asset.playerRelationshipRole = relationshipRole(
              relationship.identityKind,
            );
          }
        }
      }
      assets.push(asset);
    });
  }

  const perspective = denverPerspective(sourceRecord, teams);
  return {
    id: clean(packageRecord.proposedCanonicalId),
    tradeId: clean(packageRecord.proposedCanonicalId),
    sourceTradeId: clean(sourceRecord["Trade ID"]),
    canonicalKey: clean(packageRecord.proposedCanonicalId),
    slug: `denver-nuggets-trade-${clean(
      sourceRecord["Trade Date"],
    )}-${clean(sourceRecord["Trade ID"]).split("-").at(-1)}`,
    league: "nba",
    tradeDate: clean(sourceRecord["Trade Date"]),
    date: clean(sourceRecord["Trade Date"]),
    seasonLabel: seasonLabel(clean(sourceRecord["Trade Date"])),
    season: seasonStartYear(clean(sourceRecord["Trade Date"])),
    teams,
    assetsReceived: assetsByTeam(teams, assets, "received"),
    assetsSent: assetsByTeam(teams, assets, "sent"),
    assetLedger: assets,
    sourceTeams: ["denver-nuggets"],
    perspectives: [perspective],
    grades: perspective.grades,
    verdict: clean(sourceRecord["Final Verdict"]),
    summary: clean(sourceRecord["Final Trade Summary"]),
    analysis: clean(sourceRecord["Final Trade Analysis"]),
    confidence: clean(sourceRecord["Confidence"]).toLowerCase(),
    tier: clean(sourceRecord["Trade Tier"]).toLowerCase(),
    contentClass: clean(sourceRecord["Content Class"]),
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-imported-denver-phase-10g",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    sources: [
      clean(sourceRecord["Primary Source URL"])
        ? {
            sourceType: "primary_url",
            url: clean(sourceRecord["Primary Source URL"]),
            sourceTeam: "denver-nuggets",
            privateOnly: true,
          }
        : null,
      clean(sourceRecord["Secondary Source URL"])
        ? {
            sourceType: "secondary_url",
            url: clean(sourceRecord["Secondary Source URL"]),
            sourceTeam: "denver-nuggets",
            privateOnly: true,
          }
        : null,
    ].filter(Boolean),
    perspectiveReconciliations: [
      {
        sourceBatchId: "denver-nuggets-phase-10g",
        sourceTradeId: clean(sourceRecord["Trade ID"]),
        packageId: `denver-nuggets-phase-10g-${clean(
          sourceRecord["Trade ID"],
        )}`,
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
  const id = clean(shell.proposedPlayerId);
  const displayName = clean(shell.displayName);
  assert(id, `${shell.proposedPlayerKey}: proposed player ID is empty.`);
  assert(displayName, `${shell.proposedPlayerKey}: display name is empty.`);
  return {
    id,
    playerId: id,
    slug: slugify(displayName),
    displayName,
    name: displayName,
    fullName: displayName,
    playerName: displayName,
    league: "nba",
    aliases: [],
    referenceTypes: [],
    tradeIds: [],
    tradeSlugs: [],
    relationshipReferences: [],
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-shell-imported-denver-phase-10g",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}
function assetMatchScore(asset, relationship, player) {
  const targetPlayerId = clean(relationship.targetPlayerId);
  if (
    [
      asset.playerId,
      asset.becamePlayerId,
      asset.targetPlayerId,
    ].map(clean).includes(targetPlayerId)
  ) {
    return 100;
  }
  const displayName = normalize(player?.displayName ?? player?.name);
  for (const field of [
    "playerName",
    "becamePlayerName",
    "displayText",
    "asset",
    "auditSourceText",
  ]) {
    const value = normalize(asset[field]);
    if (displayName && value.includes(displayName)) return 80;
  }
  const rawAsset = normalize(relationship.rawAsset);
  const displayText = normalize(
    asset.displayText ?? asset.asset ?? asset.auditSourceText,
  );
  if (rawAsset && displayText) {
    if (rawAsset === displayText) return 70;
    if (rawAsset.includes(displayText) || displayText.includes(rawAsset)) {
      return 60;
    }
  }
  return 0;
}
function assetMatchesDenverSide(asset, side) {
  const possibleFrom = Array.isArray(asset.possibleFromTeams)
    ? asset.possibleFromTeams
    : [];
  const possibleTo = Array.isArray(asset.possibleToTeams)
    ? asset.possibleToTeams
    : [];
  if (side === "received") {
    return (
      clean(asset.toTeam) === "denver-nuggets" ||
      possibleTo.includes("denver-nuggets")
    );
  }
  return (
    clean(asset.fromTeam) === "denver-nuggets" ||
    possibleFrom.includes("denver-nuggets")
  );
}
function resolveRelationshipAssetReference(trade, relationship, player) {
  const assets = Array.isArray(trade.assetLedger) ? trade.assetLedger : [];
  const candidates = assets
    .map((asset) => ({
      asset,
      score: assetMatchScore(asset, relationship, player),
      sideMatch: assetMatchesDenverSide(asset, relationship.side),
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
    assetId: `phase10g-perspective-asset-${sha256(
      [
        relationship.sourceTradeId,
        relationship.side,
        relationship.rawAsset,
        relationship.targetPlayerId,
      ].join("|"),
    )
      .slice(0, 20)
      .toLowerCase()}`,
    sourceAssetId: null,
    synthetic: true,
  };
}
function appendRelationshipReference(player, reference) {
  const existing = Array.isArray(player.relationshipReferences)
    ? player.relationshipReferences
    : [];
  assert(
    !existing.some(
      (item) => clean(item.relationshipId) === clean(reference.relationshipId),
    ),
    `${reference.relationshipId}: relationship already exists before first import.`,
  );
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
    relationshipReferences: [...existing, reference],
    updatedAt: player.updatedAt,
  };
}

const args = parseArgs(process.argv);
for (const required of [
  "partition-json",
  "trades-json",
  "players-json",
  "teams-json",
  "receipt-json",
  "contract-md",
  "routing-map-json",
  "expected-partition-file-sha256",
  "expected-partition-internal-sha256",
  "expected-trade-store-sha256",
  "expected-player-store-sha256",
  "expected-team-store-sha256",
  "imported-at",
  "starting-head",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  partitionBytes,
  tradeBytes,
  playerBytes,
  teamBytes,
  contractBytes,
  routingMapBytes,
] = await Promise.all([
  readFile(args["partition-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["contract-md"]),
  readFile(args["routing-map-json"]),
]);
const partition = JSON.parse(partitionBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const explicitRoutingMap = JSON.parse(routingMapBytes.toString("utf8"));
const receiptPath = path.resolve(args["receipt-json"]);

assert(
  partition.result === "PASS" && partition.phase === "10F",
  "Invalid Phase 10F partition.",
);
assert(
  sha256(partitionBytes) === args["expected-partition-file-sha256"],
  "Phase 10F partition file hash drifted.",
);
assert(
  partition.hashes.finalImportPartitionSha256 ===
    args["expected-partition-internal-sha256"],
  "Phase 10F internal partition hash drifted.",
);
assert(Array.isArray(trades), "Canonical trade store is invalid.");
assert(Array.isArray(players), "Player store is invalid.");
assert(Array.isArray(teams), "Team store is invalid.");
assert(contractBytes.length > 0, "Phase 10G contract is empty.");
assert(
  explicitRoutingMap.version === 1 &&
    explicitRoutingMap.routes &&
    typeof explicitRoutingMap.routes === "object",
  "Phase 10G explicit routing map is invalid.",
);

for (const [actual, expected, label] of [
  [partition.counts.finalReadyPackages, 225, "ready packages"],
  [partition.counts.remainingHeldPackages, 0, "held packages"],
  [partition.counts.canonicalCreatePackages, 180, "canonical creates"],
  [partition.counts.perspectiveAppendPackages, 45, "perspective appends"],
  [partition.counts.dateCollisionDistinctCreates, 8, "date-collision creates"],
  [partition.counts.linkedOrVoidedExclusions, 6, "linked/voided exclusions"],
  [partition.counts.proposedPlayerShells, 234, "player shells"],
  [partition.counts.relationshipPreviews, 632, "relationship previews"],
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
  assert(
    existingReceipt.result === "PASS" && existingReceipt.phase === "10G",
    "Existing Phase 10G receipt is invalid.",
  );
  assert(trades.length === 1377, "Replay trade count drifted.");
  assert(players.length === 2164, "Replay player count drifted.");
  assert(teams.length === 52, "Replay team count drifted.");
  assert(
    existingReceipt.canonicalStoreSha256 === sha256(tradeBytes),
    "Replay canonical hash differs from receipt.",
  );
  assert(
    existingReceipt.playerStoreSha256 === sha256(playerBytes),
    "Replay player hash differs from receipt.",
  );
  assert(
    existingReceipt.teamStoreSha256 === sha256(teamBytes),
    "Replay team hash differs from receipt.",
  );
  assert(
    existingReceipt.readyPackages === 225 &&
      existingReceipt.canonicalTradesCreated === 180 &&
      existingReceipt.perspectivesAppended === 45 &&
      existingReceipt.playerShellsCreated === 234 &&
      existingReceipt.relationshipReferencesAdded === 632,
    "Replay receipt counts drifted.",
  );
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        phase: "10G",
        mode: "IDEMPOTENT_REPLAY",
        repositoryDataWrites: 0,
        canonicalStoreSha256: existingReceipt.canonicalStoreSha256,
        playerStoreSha256: existingReceipt.playerStoreSha256,
        teamStoreSha256: existingReceipt.teamStoreSha256,
        receiptSha256: sha256(canonicalJson(existingReceipt)),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

assert(trades.length === 1197, "Expected 1,197 pre-import trades.");
assert(players.length === 1930, "Expected 1,930 pre-import players.");
assert(teams.length === 52, "Expected 52 pre-import teams.");
assert(
  sha256(tradeBytes) === args["expected-trade-store-sha256"],
  "Pre-import trade-store hash drifted.",
);
assert(
  sha256(playerBytes) === args["expected-player-store-sha256"],
  "Pre-import player-store hash drifted.",
);
assert(
  sha256(teamBytes) === args["expected-team-store-sha256"],
  "Pre-import team-store hash drifted.",
);

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
const teamSet = new Set(teams.map(teamSlug).filter(Boolean));
assert(tradeMap.size === trades.length, "Duplicate pre-import trade ID.");
assert(playerMap.size === players.length, "Duplicate pre-import player ID.");
assert(teamSet.size === teams.length, "Duplicate pre-import team slug.");

const importedPlayerIds = [];
const resolvedExistingPlayerIds = [];
for (const frozenShell of partition.proposedPlayerShells) {
  const shell = correctedShell(frozenShell);
  const id = clean(shell.proposedPlayerId);
  if (shell.phase10GResolvedToExisting) {
    assert(playerMap.has(id), `Corrected existing player target is missing: ${id}`);
    resolvedExistingPlayerIds.push(id);
    continue;
  }
  assert(id && !playerMap.has(id), `Player-shell target already exists: ${id}`);
  playerMap.set(id, createPlayerShell(shell, args["imported-at"]));
  importedPlayerIds.push(id);
}
assert(importedPlayerIds.length === 234, `Expected 234 new player shells, found ${importedPlayerIds.length}.`);
assert(resolvedExistingPlayerIds.length === 0, `Expected zero frozen shells resolved to existing players.`);

const relationshipsByTradeId = new Map();
for (const frozenRelationship of partition.relationshipPreviews) {
  const relationship = correctedRelationship(frozenRelationship);
  if (!relationshipsByTradeId.has(relationship.sourceTradeId)) {
    relationshipsByTradeId.set(relationship.sourceTradeId, []);
  }
  relationshipsByTradeId.get(relationship.sourceTradeId).push(relationship);
}

const importedCanonicalIds = [];
const appendedPerspectiveIds = [];
const relationshipIds = [];
let matchedExistingAssetReferences = 0;
let syntheticPerspectiveAssetReferences = 0;
const routingStats = { explicitRoutingAssetsApplied: 0 };

for (const packageRecord of partition.finalReadyPackages) {
  const sourceTradeId = clean(packageRecord.sourceTradeId);
  const packageRelationships =
    relationshipsByTradeId.get(sourceTradeId) ?? [];
  let trade;

  if (packageRecord.importAction === "canonical-create") {
    assert(
      !tradeMap.has(packageRecord.proposedCanonicalId),
      `${sourceTradeId}: proposed canonical target already exists.`,
    );
    trade = buildNewTrade(
      packageRecord,
      packageRelationships,
      args["imported-at"],
      playerMap,
      explicitRoutingMap,
      routingStats,
    );
    for (const team of trade.teams) {
      assert(teamSet.has(team), `${sourceTradeId}: unknown team slug ${team}.`);
    }
    tradeMap.set(trade.id, trade);
    importedCanonicalIds.push(trade.id);
  } else {
    assert(
      packageRecord.importAction === "perspective-append",
      `${sourceTradeId}: unsupported import action.`,
    );
    const existing = tradeMap.get(packageRecord.matchedCanonicalId);
    assert(existing, `${sourceTradeId}: perspective target is missing.`);
    trade = appendDenverPerspective(
      existing,
      packageRecord.sourceRecord,
      args["imported-at"],
    );
    tradeMap.set(trade.id, trade);
    appendedPerspectiveIds.push(trade.id);
  }

  for (const relationship of packageRelationships) {
    const player = playerMap.get(clean(relationship.targetPlayerId));
    assert(
      player,
      `${relationship.relationshipEdgeKey}: target player does not exist.`,
    );

    let assetReference;
    if (packageRecord.importAction === "canonical-create") {
      const asset = trade.assetLedger.find(
        (item) =>
          item.direction === relationship.side &&
          clean(item.displayText) === clean(relationship.rawAsset),
      );
      assert(
        asset,
        `${relationship.relationshipEdgeKey}: imported trade asset is missing.`,
      );
      assetReference = {
        assetId: asset.assetId,
        sourceAssetId: asset.assetId,
        synthetic: false,
      };
      matchedExistingAssetReferences += 1;
    } else {
      assetReference = resolveRelationshipAssetReference(
        trade,
        relationship,
        player,
      );
      if (assetReference.synthetic) {
        syntheticPerspectiveAssetReferences += 1;
      } else {
        matchedExistingAssetReferences += 1;
      }
    }

    const reference = {
      relationshipId: clean(relationship.relationshipEdgeKey),
      referenceType: referenceType(relationship.identityKind),
      relationshipRole: relationshipRole(relationship.identityKind),
      tradeId: trade.id,
      canonicalTradeId: trade.id,
      tradeSlug: clean(trade.slug),
      assetId: assetReference.assetId,
      assetReference: assetReference.assetId,
      sourceAssetId: assetReference.sourceAssetId,
      sourceTradeId,
      packageId: `denver-nuggets-phase-10g-${sourceTradeId}`,
      sourceTeam: "denver-nuggets",
      perspectiveLocalAssetReference: assetReference.synthetic,
      privateOnly: true,
    };
    playerMap.set(playerId(player), appendRelationshipReference(player, reference));
    relationshipIds.push(reference.relationshipId);
  }
}

assert(importedCanonicalIds.length === 180, "Canonical-create count drifted.");
assert(appendedPerspectiveIds.length === 45, "Perspective-append count drifted.");
assert(relationshipIds.length === 632, "Relationship count drifted.");
assert(tradeMap.size === 1377, `Expected 1,377 post-import trades, found ${tradeMap.size}.`);
assert(playerMap.size === 2164, `Expected 2,164 post-import players, found ${playerMap.size}.`);
assert(matchedExistingAssetReferences + syntheticPerspectiveAssetReferences === 632, "Relationship asset-reference accounting drifted.");
assert(routingStats.explicitRoutingAssetsApplied === 82, `Expected 82 explicit multi-team canonical-create asset routes, found ${routingStats.explicitRoutingAssetsApplied}.`);

const finalTrades = [...tradeMap.values()];
const finalPlayers = [...playerMap.values()];
const finalTeams = teams;

for (const exclusion of partition.linkedOrVoidedExclusions) {
  const sourceId = clean(exclusion.sourceTradeId);
  assert(
    !finalTrades.some((trade) => clean(trade.sourceTradeId) === sourceId),
    `${sourceId}: linked/voided exclusion was imported as a standalone trade.`,
  );
}

for (const packageRecord of partition.finalReadyPackages) {
  const sourceId = clean(packageRecord.sourceTradeId);
  const targetId = clean(packageRecord.targetCanonicalId);
  const trade = tradeMap.get(targetId);
  assert(trade, `${sourceId}: target trade is missing after import.`);
  assert(
    sourcePerspectiveCount(trade, "denver-nuggets") === 1,
    `${sourceId}: Denver perspective count is not exactly one.`,
  );
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
const prePlayerReferences = countPlayerTradeReferences(players);
const postPlayerReferences = countPlayerTradeReferences(finalPlayers);

const receipt = {
  result: "PASS",
  phase: "10G",
  mode: "FIRST_IMPORT",
  protocol: "Warp-Freeze Protocol",
  batchId: "denver-nuggets-phase-10g",
  startingHead: args["starting-head"],
  importedAt: args["imported-at"],
  sourceHashes: {
    phase10FFileSha256: sha256(partitionBytes),
    phase10FInternalPartitionSha256:
      partition.hashes.finalImportPartitionSha256,
    finalReadyPackagesSha256:
      partition.hashes.finalReadyPackagesSha256,
    remainingHeldPackagesSha256:
      partition.hashes.remainingHeldPackagesSha256,
    linkedOrVoidedExclusionsSha256:
      partition.hashes.linkedOrVoidedExclusionsSha256,
    proposedPlayerShellsSha256:
      partition.hashes.proposedPlayerShellsSha256,
    relationshipPreviewsSha256:
      partition.hashes.relationshipPreviewsSha256,
    contractSha256: sha256(contractBytes),
    explicitRoutingMapSha256: sha256(routingMapBytes),
    preImportCanonicalStoreSha256: sha256(tradeBytes),
    preImportPlayerStoreSha256: sha256(playerBytes),
    preImportTeamStoreSha256: sha256(teamBytes),
  },
  preImportCanonicalTrades: trades.length,
  preImportPlayers: players.length,
  preImportTeams: teams.length,
  preImportTeamTradeMemberships: preTeamMemberships,
  preImportPlayerTradeReferences: prePlayerReferences,
  readyPackages: partition.finalReadyPackages.length,
  heldPackages: partition.remainingHeldPackages.length,
  linkedOrVoidedExclusions: partition.linkedOrVoidedExclusions.length,
  canonicalTradesCreated: importedCanonicalIds.length,
  perspectivesAppended: appendedPerspectiveIds.length,
  dateCollisionDistinctCreates:
    partition.counts.dateCollisionDistinctCreates,
  playerShellsCreated: importedPlayerIds.length,
  frozenPlayerShellProposals: partition.proposedPlayerShells.length,
  frozenShellsResolvedToExistingPlayers: resolvedExistingPlayerIds.length,
  relationshipReferencesAdded: relationshipIds.length,
  matchedExistingAssetReferences,
  syntheticPerspectiveAssetReferences,
  explicitRoutingAssetsApplied: routingStats.explicitRoutingAssetsApplied,
  postImportCanonicalTrades: finalTrades.length,
  postImportPlayers: finalPlayers.length,
  postImportTeams: finalTeams.length,
  postImportTeamTradeMemberships: postTeamMemberships,
  postImportPlayerTradeReferences: postPlayerReferences,
  teamTradeMembershipsAdded: postTeamMemberships - preTeamMemberships,
  playerTradeReferencesAdded: postPlayerReferences - prePlayerReferences,
  teamRegistryEntriesAdded: 0,
  importedCanonicalTradeIds: uniqueSorted(importedCanonicalIds),
  updatedPerspectiveCanonicalIds: uniqueSorted(appendedPerspectiveIds),
  importedPlayerIds: uniqueSorted(importedPlayerIds),
  resolvedExistingPlayerIds: uniqueSorted(resolvedExistingPlayerIds),
  identityCorrections: [...IDENTITY_CORRECTIONS.entries()].map(
    ([originalPlayerId, correction]) => ({
      originalPlayerId,
      correctedPlayerId: correction.correctedPlayerId,
      correctedDisplayName: correction.correctedDisplayName,
      reason: correction.reason,
    }),
  ),
  relationshipIds: uniqueSorted(relationshipIds),
  linkedOrVoidedExcludedSourceTradeIds: uniqueSorted(
    partition.linkedOrVoidedExclusions.map((item) => item.sourceTradeId),
  ),
  canonicalStoreSha256: sha256(tradeOut),
  playerStoreSha256: sha256(playerOut),
  teamStoreSha256: sha256(teamOut),
  repositoryDataWrites: 3,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  automaticPlayerCreates: 0,
  automaticRoutes: 0,
  heldPackageImports: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};
const receiptOut = canonicalJson(receipt);

await atomicWrite(args["trades-json"], tradeOut, "phase10g-trades");
await atomicWrite(args["players-json"], playerOut, "phase10g-players");
await atomicWrite(receiptPath, receiptOut, "phase10g-receipt");

console.log(
  JSON.stringify(
    {
      result: receipt.result,
      phase: receipt.phase,
      mode: receipt.mode,
      readyPackages: receipt.readyPackages,
      heldPackages: receipt.heldPackages,
      linkedOrVoidedExclusions: receipt.linkedOrVoidedExclusions,
      canonicalTradesCreated: receipt.canonicalTradesCreated,
      perspectivesAppended: receipt.perspectivesAppended,
      dateCollisionDistinctCreates: receipt.dateCollisionDistinctCreates,
      playerShellsCreated: receipt.playerShellsCreated,
      relationshipReferencesAdded: receipt.relationshipReferencesAdded,
      matchedExistingAssetReferences: receipt.matchedExistingAssetReferences,
      syntheticPerspectiveAssetReferences:
        receipt.syntheticPerspectiveAssetReferences,
      explicitRoutingAssetsApplied: receipt.explicitRoutingAssetsApplied,
      postImportCanonicalTrades: receipt.postImportCanonicalTrades,
      postImportPlayers: receipt.postImportPlayers,
      postImportTeams: receipt.postImportTeams,
      teamTradeMembershipsAdded: receipt.teamTradeMembershipsAdded,
      playerTradeReferencesAdded: receipt.playerTradeReferencesAdded,
      canonicalStoreSha256: receipt.canonicalStoreSha256,
      playerStoreSha256: receipt.playerStoreSha256,
      teamStoreSha256: receipt.teamStoreSha256,
      receiptSha256: sha256(receiptOut),
      repositoryDataWrites: receipt.repositoryDataWrites,
      automaticIdentityMerges: 0,
      automaticCanonicalMerges: 0,
      automaticPlayerCreates: 0,
      automaticRoutes: 0,
      publicationAuthorized: false,
      pushPerformed: false,
      deployPerformed: false,
    },
    null,
    2,
  ),
);
