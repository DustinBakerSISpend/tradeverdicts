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

const IDENTITY_CORRECTIONS = new Map([
  [
    "nba-player-vsevolod-ishchenko-via-los-angeles-and-chicago-69c7c91a9c",
    {
      correctedPlayerId: "nba-player-vsevolod-ishchenko",
      correctedDisplayName: "Vsevolod Ishchenko",
      reason: "Removed multi-team routing text and resolved the draft-rights identity to the existing Chicago-created player.",
      resolvedToExisting: true,
    },
  ],
]);
function correctedPlayerId(value) {
  const id = clean(value);
  return IDENTITY_CORRECTIONS.get(id)?.correctedPlayerId ?? id;
}
function correctedShell(shell) {
  const correction = IDENTITY_CORRECTIONS.get(clean(shell.proposedPlayerId));
  if (!correction) return shell;
  return {
    ...shell,
    proposedPlayerId: correction.correctedPlayerId,
    displayName: correction.correctedDisplayName,
    normalizedIdentityKey: normalize(correction.correctedDisplayName),
    phase9GIdentityCorrection: true,
    phase9GIdentityCorrectionReason: correction.reason,
    phase9GResolvedToExisting: Boolean(correction.resolvedToExisting),
  };
}
function correctedRelationship(relationship) {
  const originalTargetPlayerId = clean(relationship.targetPlayerId);
  const correctedTargetPlayerId = correctedPlayerId(originalTargetPlayerId);
  if (correctedTargetPlayerId === originalTargetPlayerId) return relationship;
  return {
    ...relationship,
    targetPlayerId: correctedTargetPlayerId,
    proposedPlayerId: correctedTargetPlayerId,
    phase9GOriginalTargetPlayerId: originalTargetPlayerId,
    phase9GIdentityCorrection: true,
  };
}

const TEAM_NAME_TO_SLUG = new Map([
  ["Atlanta Hawks", "atlanta-hawks"],
  ["Boston Celtics", "boston-celtics"],
  ["Brooklyn Nets", "brooklyn-nets"],
  ["Charlotte Bobcats", "charlotte-hornets"],
  ["Charlotte Hornets", "charlotte-hornets"],
  ["Chicago Bulls", "chicago-bulls"],
  ["Cleveland Cavaliers", "cleveland-cavaliers"],
  ["Denver Nuggets", "denver-nuggets"],
  ["Detroit Pistons", "detroit-pistons"],
  ["Golden State Warriors", "golden-state-warriors"],
  ["Houston Rockets", "houston-rockets"],
  ["Indiana Pacers", "indiana-pacers"],
  ["Los Angeles Clippers", "los-angeles-clippers"],
  ["Los Angeles Lakers", "los-angeles-lakers"],
  ["Memphis Grizzlies", "memphis-grizzlies"],
  ["Miami Heat", "miami-heat"],
  ["Milwaukee Bucks", "milwaukee-bucks"],
  ["Minnesota Timberwolves", "minnesota-timberwolves"],
  ["New Orleans Hornets", "new-orleans-pelicans"],
  ["New Orleans Pelicans", "new-orleans-pelicans"],
  ["New York Knicks", "new-york-knicks"],
  ["Oklahoma City Thunder", "oklahoma-city-thunder"],
  ["Orlando Magic", "orlando-magic"],
  ["Philadelphia 76ers", "philadelphia-76ers"],
  ["Phoenix Suns", "phoenix-suns"],
  ["Portland Trail Blazers", "portland-trail-blazers"],
  ["Sacramento Kings", "sacramento-kings"],
  ["San Antonio Spurs", "san-antonio-spurs"],
  ["Seattle SuperSonics", "seattle-supersonics"],
  ["Toronto Raptors", "toronto-raptors"],
  ["Utah Jazz", "utah-jazz"],
  ["Washington Bullets", "washington-wizards"],
  ["Washington Wizards", "washington-wizards"],
]);

const INLINE_TEAM_LABELS = new Map([
  ["atlanta", "atlanta-hawks"],
  ["atlanta hawks", "atlanta-hawks"],
  ["boston", "boston-celtics"],
  ["boston celtics", "boston-celtics"],
  ["brooklyn", "brooklyn-nets"],
  ["brooklyn nets", "brooklyn-nets"],
  ["charlotte", "charlotte-hornets"],
  ["charlotte hornets", "charlotte-hornets"],
  ["chicago", "chicago-bulls"],
  ["chicago bulls", "chicago-bulls"],
  ["clippers", "los-angeles-clippers"],
  ["la clippers", "los-angeles-clippers"],
  ["los angeles clippers", "los-angeles-clippers"],
  ["lakers", "los-angeles-lakers"],
  ["la lakers", "los-angeles-lakers"],
  ["los angeles lakers", "los-angeles-lakers"],
  ["dallas", "dallas-mavericks"],
  ["dallas mavericks", "dallas-mavericks"],
  ["denver", "denver-nuggets"],
  ["denver nuggets", "denver-nuggets"],
  ["detroit", "detroit-pistons"],
  ["detroit pistons", "detroit-pistons"],
  ["golden state", "golden-state-warriors"],
  ["golden state warriors", "golden-state-warriors"],
  ["houston", "houston-rockets"],
  ["houston rockets", "houston-rockets"],
  ["memphis", "memphis-grizzlies"],
  ["memphis grizzlies", "memphis-grizzlies"],
  ["milwaukee", "milwaukee-bucks"],
  ["milwaukee bucks", "milwaukee-bucks"],
  ["minnesota", "minnesota-timberwolves"],
  ["minnesota timberwolves", "minnesota-timberwolves"],
  ["new york", "new-york-knicks"],
  ["new york knicks", "new-york-knicks"],
  ["oklahoma city", "oklahoma-city-thunder"],
  ["oklahoma city thunder", "oklahoma-city-thunder"],
  ["orlando", "orlando-magic"],
  ["orlando magic", "orlando-magic"],
  ["philadelphia", "philadelphia-76ers"],
  ["philadelphia 76ers", "philadelphia-76ers"],
  ["phoenix", "phoenix-suns"],
  ["phoenix suns", "phoenix-suns"],
  ["portland", "portland-trail-blazers"],
  ["portland trail blazers", "portland-trail-blazers"],
  ["san antonio", "san-antonio-spurs"],
  ["san antonio spurs", "san-antonio-spurs"],
  ["toronto", "toronto-raptors"],
  ["toronto raptors", "toronto-raptors"],
  ["utah", "utah-jazz"],
  ["utah jazz", "utah-jazz"],
  ["washington", "washington-wizards"],
  ["washington wizards", "washington-wizards"],
]);

function partnerTeams(sourceRecord) {
  const label = clean(sourceRecord["Trade Partner(s)"]);
  const names = label.startsWith("4-team trade wtih Clippers")
    ? ["Los Angeles Clippers", "Utah Jazz", "Houston Rockets"]
    : label.split(",").map(clean).filter(Boolean);
  const slugs = names.map((name) => {
    const mapped = TEAM_NAME_TO_SLUG.get(name);
    assert(mapped, `${sourceRecord["Trade ID"]}: unmapped partner team ${name}`);
    return mapped;
  });
  return uniqueSorted(slugs);
}
function inlineTeamSlug(value) {
  const key = normalize(value);
  return INLINE_TEAM_LABELS.get(key) ?? null;
}
function endpointFromPhrase(rawAsset, marker) {
  const expression = new RegExp(
    `\\b${marker}\\s+([A-Za-z. ]+?)(?=\\s*(?:\\(|;|$|\\band\\b))`,
    "iu",
  );
  const match = clean(rawAsset).match(expression);
  return match ? inlineTeamSlug(match[1]) : null;
}
function routeAsset(sourceRecord, side, rawAsset, partners) {
  const tradeIdValue = clean(sourceRecord["Trade ID"]);
  if (partners.length === 1) {
    return side === "received"
      ? {
          fromTeam: partners[0],
          toTeam: "dallas-mavericks",
          possibleFromTeams: [],
          possibleToTeams: [],
          routingStatus: "resolved",
        }
      : {
          fromTeam: "dallas-mavericks",
          toTeam: partners[0],
          possibleFromTeams: [],
          possibleToTeams: [],
          routingStatus: "resolved",
        };
  }

  const normalizedAsset = normalize(rawAsset);
  const specialRoutes = {
    "DAL-2001-0060": {
      received: {
        "tyrone bogues": "new-york-knicks",
        "3 2m trade exception": "new-york-knicks",
      },
      sent: {
        "howard eisley": "new-york-knicks",
        "draft rights to kyle hill": "houston-rockets",
        "future considerations added 08 17 details not identified in source": "houston-rockets",
      },
    },
    "DAL-2009-0089": {
      received: {
        "shawn marion": "toronto-raptors",
        "greg buckner": "memphis-grizzlies",
        "kris humphries": "toronto-raptors",
        "nathan jawai": "toronto-raptors",
        "cash": "toronto-raptors",
      },
      sent: {
        "jerry stackhouse": "memphis-grizzlies",
        "devean george": "toronto-raptors",
        "antoine wright": "toronto-raptors",
        "cash": "memphis-grizzlies",
      },
    },
    "DAL-2011-0097": {
      received: {
        "rudy fernandez": "portland-trail-blazers",
        "draft rights to petteri koponen": "portland-trail-blazers",
      },
      sent: {
        "draft rights to jordan hamilton": "denver-nuggets",
        "draft rights to tanguy ngombo": "portland-trail-blazers",
      },
    },
    "DAL-2011-0098": {
      received: {
        "andy rautins": "new-york-knicks",
        "2012 second round pick protected top 55 in 2012 from wizards not exercised": "washington-wizards",
        "11m trade exception": "new-york-knicks",
      },
      sent: {
        "tyson chandler": "new-york-knicks",
        "draft rights to ahmad nivins": "new-york-knicks",
        "draft rights to giorgos printezis": "new-york-knicks",
        "2012 second round pick 46 darius miller": "washington-wizards",
      },
    },
    "DAL-2012-0103": {
      received: {
        "draft rights to tadija dragicevic": "houston-rockets",
        "cash": "los-angeles-clippers",
        "8 9m trade exception": "los-angeles-clippers",
      },
      sent: {
        "lamar odom": "los-angeles-clippers",
        "draft rights to shan foster": "utah-jazz",
      },
    },
    "DAL-2018-0121": {
      received: {
        "doug mcdermott": "new-york-knicks",
        "2018 second round pick less favorable of blazers kings picks from nuggets 54 shake milton": "denver-nuggets",
      },
      sent: {
        "devin harris": "denver-nuggets",
      },
    },
    "DAL-2020-0133": {
      received: {
        "james johnson": "oklahoma-city-thunder",
      },
      sent: {
        "delon wright": "detroit-pistons",
        "justin jackson": "oklahoma-city-thunder",
        "2023 second round pick more favorable of heat mavericks picks 40 maxwell lewis": "oklahoma-city-thunder",
        "2026 second round pick pick not identified in source": "oklahoma-city-thunder",
      },
    },
    "DAL-2025-0149": {
      received: {
        "anthony davis": "los-angeles-lakers",
        "max christie": "los-angeles-lakers",
        "2029 los angeles lakers first round pick": "los-angeles-lakers",
        "55 000 cash from utah": "utah-jazz",
      },
      sent: {
        "luka doncic": "los-angeles-lakers",
        "maxi kleber": "los-angeles-lakers",
        "markieff morris": "los-angeles-lakers",
        "2025 dallas second round pick 43 jamir watkins to utah": "utah-jazz",
      },
    },
    "DAL-2026-0152": {
      received: {
        "draft rights to 25 sergio de larrea": "new-york-knicks",
      },
      sent: {
        "draft rights to 30 koa peat to phoenix": "phoenix-suns",
        "draft rights to melvin ajinca and two future second round picks to new york years not identified in official release": "new-york-knicks",
      },
    },
    "DAL-2026-0153": {
      received: {
        "draft rights to 56 vsevolod ishchenko via los angeles and chicago": "los-angeles-lakers",
      },
      sent: {
        "cash considerations to los angeles": "los-angeles-lakers",
      },
    },
    "DAL-2026-0155": {
      received: {
        "zaccharie risacher": "atlanta-hawks",
        "protected 2027 atlanta second round pick": "atlanta-hawks",
      },
      sent: {
        "ryan nembhard to atlanta": "atlanta-hawks",
        "2027 chicago second round pick to oklahoma city": "oklahoma-city-thunder",
      },
    },
  };

  const configured = specialRoutes[tradeIdValue]?.[side]?.[normalizedAsset];
  if (configured) {
    return side === "received"
      ? {
          fromTeam: configured,
          toTeam: "dallas-mavericks",
          possibleFromTeams: [],
          possibleToTeams: [],
          routingStatus: "resolved",
        }
      : {
          fromTeam: "dallas-mavericks",
          toTeam: configured,
          possibleFromTeams: [],
          possibleToTeams: [],
          routingStatus: "resolved",
        };
  }

  const inlineEndpoint =
    side === "received"
      ? endpointFromPhrase(rawAsset, "from") ?? endpointFromPhrase(rawAsset, "via")
      : endpointFromPhrase(rawAsset, "to");
  if (inlineEndpoint && partners.includes(inlineEndpoint)) {
    return side === "received"
      ? {
          fromTeam: inlineEndpoint,
          toTeam: "dallas-mavericks",
          possibleFromTeams: [],
          possibleToTeams: [],
          routingStatus: "resolved",
        }
      : {
          fromTeam: "dallas-mavericks",
          toTeam: inlineEndpoint,
          possibleFromTeams: [],
          possibleToTeams: [],
          routingStatus: "resolved",
        };
  }

  return side === "received"
    ? {
        fromTeam: null,
        toTeam: "dallas-mavericks",
        possibleFromTeams: partners,
        possibleToTeams: [],
        routingStatus: "unresolved-counterparty",
      }
    : {
        fromTeam: "dallas-mavericks",
        toTeam: null,
        possibleFromTeams: [],
        possibleToTeams: partners,
        routingStatus: "unresolved-counterparty",
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
    "dallas-mavericks": clean(sourceRecord["Mavericks Grade"]),
  };
  const partnerGrade = clean(sourceRecord["Partner Aggregate Grade"]);
  if (partnerGrade) {
    grades.partnerAggregate = partnerGrade;
    if (teams.length === 2) {
      const partner = teams.find((team) => team !== "dallas-mavericks");
      if (partner) grades[partner] = partnerGrade;
    }
  }
  return grades;
}
function dallasPerspective(sourceRecord, teams) {
  return {
    sourceTeam: "dallas-mavericks",
    sourceBatchId: "dallas-mavericks-phase-9g",
    sourceTradeId: clean(sourceRecord["Trade ID"]),
    sourcePerspectiveKey:
      `dallas-mavericks:${clean(sourceRecord["Trade ID"])}`,
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
function appendDallasPerspective(existingTrade, sourceRecord, importedAt) {
  const protectedBefore = JSON.stringify(immutableTradeProjection(existingTrade));
  assert(
    sourcePerspectiveCount(existingTrade, "dallas-mavericks") === 0,
    `${sourceRecord["Trade ID"]}: Dallas perspective already exists.`,
  );

  const teams = uniqueSorted(existingTrade.teams ?? []);
  const perspective = dallasPerspective(sourceRecord, teams);
  let perspectives;
  if (Array.isArray(existingTrade.perspectives)) {
    perspectives = [...existingTrade.perspectives, perspective];
  } else if (
    existingTrade.perspectives &&
    typeof existingTrade.perspectives === "object"
  ) {
    perspectives = {
      ...existingTrade.perspectives,
      "dallas-mavericks": {
        sourceSubmissionId:
          `dallas-mavericks-phase-9g-${clean(sourceRecord["Trade ID"])}`,
        editorialStatus: "private-imported-dallas-phase-9g",
        grade: clean(sourceRecord["Mavericks Grade"]),
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
    "dallas-mavericks": clean(sourceRecord["Mavericks Grade"]),
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
      "dallas-mavericks",
    ]),
    perspectives,
    grades: mergedGrades,
    perspectiveReconciliations: [
      ...(Array.isArray(existingTrade.perspectiveReconciliations)
        ? existingTrade.perspectiveReconciliations
        : []),
      {
        sourceBatchId: "dallas-mavericks-phase-9g",
        sourceTradeId: clean(sourceRecord["Trade ID"]),
        packageId: `dallas-mavericks-phase-9g-${clean(
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
    sourcePerspectiveCount(updated, "dallas-mavericks") === 1,
    `${sourceRecord["Trade ID"]}: Dallas perspective append count drifted.`,
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
  return `phase9g-asset-${sha256(
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
function buildNewTrade(packageRecord, relationshipRows, importedAt, playerMap) {
  const sourceRecord = packageRecord.sourceRecord;
  const partners = partnerTeams(sourceRecord);
  const teams = uniqueSorted(["dallas-mavericks", ...partners]);
  const relationshipByAsset = new Map();
  for (const relationship of relationshipRows) {
    const key = `${relationship.side}|${clean(relationship.rawAsset)}`;
    if (!relationshipByAsset.has(key)) relationshipByAsset.set(key, []);
    relationshipByAsset.get(key).push(relationship);
  }

  const assets = [];
  for (const [field, side] of [
    ["Mavericks Received", "received"],
    ["Mavericks Sent", "sent"],
  ]) {
    const rawAssets = clean(sourceRecord[field])
      .split(";")
      .map(clean)
      .filter(Boolean);
    rawAssets.forEach((rawAsset, index) => {
      const route = routeAsset(sourceRecord, side, rawAsset, partners);
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
        sourceTeam: "dallas-mavericks",
        edgeClass: "dallas-source-route",
        routingStatus: route.routingStatus,
        possibleFromTeams: route.possibleFromTeams,
        possibleToTeams: route.possibleToTeams,
        privateOnly: true,
        previewOnly: false,
        auditStatus: "private-imported-dallas-phase-9g",
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

  const perspective = dallasPerspective(sourceRecord, teams);
  return {
    id: clean(packageRecord.proposedCanonicalId),
    tradeId: clean(packageRecord.proposedCanonicalId),
    sourceTradeId: clean(sourceRecord["Trade ID"]),
    canonicalKey: clean(packageRecord.proposedCanonicalId),
    slug: `dallas-mavericks-trade-${clean(
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
    sourceTeams: ["dallas-mavericks"],
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
    importReviewStatus: "private-imported-dallas-phase-9g",
    privateOnly: true,
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    sources: [
      clean(sourceRecord["Primary Source URL"])
        ? {
            sourceType: "primary_url",
            url: clean(sourceRecord["Primary Source URL"]),
            sourceTeam: "dallas-mavericks",
            privateOnly: true,
          }
        : null,
      clean(sourceRecord["Secondary Source URL"])
        ? {
            sourceType: "secondary_url",
            url: clean(sourceRecord["Secondary Source URL"]),
            sourceTeam: "dallas-mavericks",
            privateOnly: true,
          }
        : null,
    ].filter(Boolean),
    perspectiveReconciliations: [
      {
        sourceBatchId: "dallas-mavericks-phase-9g",
        sourceTradeId: clean(sourceRecord["Trade ID"]),
        packageId: `dallas-mavericks-phase-9g-${clean(
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
    importReviewStatus: "private-shell-imported-dallas-phase-9g",
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
function assetMatchesDallasSide(asset, side) {
  const possibleFrom = Array.isArray(asset.possibleFromTeams)
    ? asset.possibleFromTeams
    : [];
  const possibleTo = Array.isArray(asset.possibleToTeams)
    ? asset.possibleToTeams
    : [];
  if (side === "received") {
    return (
      clean(asset.toTeam) === "dallas-mavericks" ||
      possibleTo.includes("dallas-mavericks")
    );
  }
  return (
    clean(asset.fromTeam) === "dallas-mavericks" ||
    possibleFrom.includes("dallas-mavericks")
  );
}
function resolveRelationshipAssetReference(trade, relationship, player) {
  const assets = Array.isArray(trade.assetLedger) ? trade.assetLedger : [];
  const candidates = assets
    .map((asset) => ({
      asset,
      score: assetMatchScore(asset, relationship, player),
      sideMatch: assetMatchesDallasSide(asset, relationship.side),
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
    assetId: `phase9g-perspective-asset-${sha256(
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
] = await Promise.all([
  readFile(args["partition-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["contract-md"]),
]);
const partition = JSON.parse(partitionBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const receiptPath = path.resolve(args["receipt-json"]);

assert(
  partition.result === "PASS" && partition.phase === "9F",
  "Invalid Phase 9F partition.",
);
assert(
  sha256(partitionBytes) === args["expected-partition-file-sha256"],
  "Phase 9F partition file hash drifted.",
);
assert(
  partition.hashes.finalImportPartitionSha256 ===
    args["expected-partition-internal-sha256"],
  "Phase 9F internal partition hash drifted.",
);
assert(Array.isArray(trades), "Canonical trade store is invalid.");
assert(Array.isArray(players), "Player store is invalid.");
assert(Array.isArray(teams), "Team store is invalid.");
assert(contractBytes.length > 0, "Phase 9G contract is empty.");

for (const [actual, expected, label] of [
  [partition.counts.finalReadyPackages, 151, "ready packages"],
  [partition.counts.remainingHeldPackages, 0, "held packages"],
  [partition.counts.canonicalCreatePackages, 115, "canonical creates"],
  [partition.counts.perspectiveAppendPackages, 36, "perspective appends"],
  [partition.counts.dateCollisionDistinctCreates, 4, "date-collision creates"],
  [partition.counts.parentLinkedExclusions, 4, "parent-linked exclusions"],
  [partition.counts.proposedPlayerShells, 183, "player shells"],
  [partition.counts.relationshipPreviews, 507, "relationship previews"],
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
    existingReceipt.result === "PASS" && existingReceipt.phase === "9G",
    "Existing Phase 9G receipt is invalid.",
  );
  assert(trades.length === 1197, "Replay trade count drifted.");
  assert(players.length === 1930, "Replay player count drifted.");
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
    existingReceipt.readyPackages === 151 &&
      existingReceipt.canonicalTradesCreated === 115 &&
      existingReceipt.perspectivesAppended === 36 &&
      existingReceipt.playerShellsCreated === 182 &&
      existingReceipt.relationshipReferencesAdded === 507,
    "Replay receipt counts drifted.",
  );
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        phase: "9G",
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

assert(trades.length === 1082, "Expected 1,082 pre-import trades.");
assert(players.length === 1748, "Expected 1,748 pre-import players.");
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
  if (shell.phase9GResolvedToExisting) {
    assert(playerMap.has(id), `Corrected existing player target is missing: ${id}`);
    resolvedExistingPlayerIds.push(id);
    continue;
  }
  assert(id && !playerMap.has(id), `Player-shell target already exists: ${id}`);
  playerMap.set(id, createPlayerShell(shell, args["imported-at"]));
  importedPlayerIds.push(id);
}
assert(importedPlayerIds.length === 182, `Expected 182 new player shells, found ${importedPlayerIds.length}.`);
assert(resolvedExistingPlayerIds.length === 1, `Expected one frozen shell resolved to an existing player.`);

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
    trade = appendDallasPerspective(
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
      packageId: `dallas-mavericks-phase-9g-${sourceTradeId}`,
      sourceTeam: "dallas-mavericks",
      perspectiveLocalAssetReference: assetReference.synthetic,
      privateOnly: true,
    };
    playerMap.set(playerId(player), appendRelationshipReference(player, reference));
    relationshipIds.push(reference.relationshipId);
  }
}

assert(importedCanonicalIds.length === 115, "Canonical-create count drifted.");
assert(appendedPerspectiveIds.length === 36, "Perspective-append count drifted.");
assert(relationshipIds.length === 507, "Relationship count drifted.");
assert(tradeMap.size === 1197, `Expected 1,197 post-import trades, found ${tradeMap.size}.`);
assert(playerMap.size === 1930, `Expected 1,930 post-import players, found ${playerMap.size}.`);
assert(matchedExistingAssetReferences + syntheticPerspectiveAssetReferences === 507, "Relationship asset-reference accounting drifted.");

const finalTrades = [...tradeMap.values()];
const finalPlayers = [...playerMap.values()];
const finalTeams = teams;

for (const exclusion of partition.parentLinkedExclusions) {
  const sourceId = clean(exclusion.sourceTradeId);
  assert(
    !finalTrades.some((trade) => clean(trade.sourceTradeId) === sourceId),
    `${sourceId}: parent-linked exclusion was imported as a standalone trade.`,
  );
}

for (const packageRecord of partition.finalReadyPackages) {
  const sourceId = clean(packageRecord.sourceTradeId);
  const targetId = clean(packageRecord.targetCanonicalId);
  const trade = tradeMap.get(targetId);
  assert(trade, `${sourceId}: target trade is missing after import.`);
  assert(
    sourcePerspectiveCount(trade, "dallas-mavericks") === 1,
    `${sourceId}: Dallas perspective count is not exactly one.`,
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
  phase: "9G",
  mode: "FIRST_IMPORT",
  protocol: "Warp-Freeze Protocol",
  batchId: "dallas-mavericks-phase-9g",
  startingHead: args["starting-head"],
  importedAt: args["imported-at"],
  sourceHashes: {
    phase9FFileSha256: sha256(partitionBytes),
    phase9FInternalPartitionSha256:
      partition.hashes.finalImportPartitionSha256,
    finalReadyPackagesSha256:
      partition.hashes.finalReadyPackagesSha256,
    remainingHeldPackagesSha256:
      partition.hashes.remainingHeldPackagesSha256,
    parentLinkedExclusionsSha256:
      partition.hashes.parentLinkedExclusionsSha256,
    proposedPlayerShellsSha256:
      partition.hashes.proposedPlayerShellsSha256,
    relationshipPreviewsSha256:
      partition.hashes.relationshipPreviewsSha256,
    contractSha256: sha256(contractBytes),
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
  parentLinkedExclusions: partition.parentLinkedExclusions.length,
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
  parentLinkedExcludedSourceTradeIds: uniqueSorted(
    partition.parentLinkedExclusions.map((item) => item.sourceTradeId),
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

await atomicWrite(args["trades-json"], tradeOut, "phase9g-trades");
await atomicWrite(args["players-json"], playerOut, "phase9g-players");
await atomicWrite(receiptPath, receiptOut, "phase9g-receipt");

console.log(
  JSON.stringify(
    {
      result: receipt.result,
      phase: receipt.phase,
      mode: receipt.mode,
      readyPackages: receipt.readyPackages,
      heldPackages: receipt.heldPackages,
      parentLinkedExclusions: receipt.parentLinkedExclusions,
      canonicalTradesCreated: receipt.canonicalTradesCreated,
      perspectivesAppended: receipt.perspectivesAppended,
      dateCollisionDistinctCreates: receipt.dateCollisionDistinctCreates,
      playerShellsCreated: receipt.playerShellsCreated,
      relationshipReferencesAdded: receipt.relationshipReferencesAdded,
      matchedExistingAssetReferences: receipt.matchedExistingAssetReferences,
      syntheticPerspectiveAssetReferences:
        receipt.syntheticPerspectiveAssetReferences,
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
