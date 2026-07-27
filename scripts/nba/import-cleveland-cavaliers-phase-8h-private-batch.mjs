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
    .replace(/[‘’'`"]/gu, "")
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
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug), `Invalid historical team slug: ${slug}`);
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
      registrySource: "cleveland-cavaliers-phase-8h",
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
  assert(new Set(finalSlugs).size === finalSlugs.length, "Duplicate team registry slug.");
  const finalSet = new Set(finalSlugs);
  assert(
    collectTradeTeamSlugs(finalTrades).every((slug) => finalSet.has(slug)),
    "A post-import trade team is absent from the team registry.",
  );
  return { teams: finalTeams, registrations, missingSlugs };
}
function inferAssetType(value) {
  const text = normalize(value);
  if (/\bcash\b|\bfinancial relief\b/u.test(text)) return "cash";
  if (/\b(?:trade exception|traded player exception|tpe)\b/u.test(text)) return "trade_exception";
  if (/\b(?:swap|option to swap)\b/u.test(text)) return "draft_swap";
  if (/\b(?:draft rights|rights to)\b/u.test(text)) return "draft_rights";
  if (/\b(?:first round|second round|third round|fourth round|draft pick|pick)\b/u.test(text)) return "draft_pick";
  if (/\b(?:future considerations|conditional consideration)\b/u.test(text)) return "consideration";
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
  return `phase8h-asset-${sha256([
    sourceTradeId,
    ordinal,
    clean(edge.asset),
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

const TEAM_ALIASES = new Map([
  ["thunder", "oklahoma-city-thunder"],
  ["wizards", "washington-wizards"],
]);
function normalizeTeam(value) {
  const slug = clean(value);
  return TEAM_ALIASES.get(slug) ?? slug;
}

const FROZEN_MULTI_TEAM_ROUTES = {
  "CLE-1980-0040": {
    received: [["Bill Robinzine", "sacramento-kings"]],
    sent: [["Campy Russell", "new-york-knicks"]],
  },
  "CLE-1984-0064": {
    received: [["rights to Mel Turpin", "washington-wizards"]],
    sent: [
      ["Cliff Robinson", "washington-wizards"],
      ["rights to Tim McCormick", "washington-wizards"],
    ],
  },
  "CLE-1997-0097": {
    received: [
      ["Shawn Kemp", "oklahoma-city-thunder"],
      ["Sherman Douglas", "milwaukee-bucks"],
    ],
    sent: [
      ["Tyrone Hill", "milwaukee-bucks"],
      ["Terrell Brandon", "milwaukee-bucks"],
      ["1998 first round pick (protected top 10) (#19-Pat Garrity)", "milwaukee-bucks"],
    ],
  },
  "CLE-1997-0098": {
    received: [
      ["Wesley Person", "phoenix-suns"],
      ["Tony Dumas", "phoenix-suns"],
    ],
    sent: [["2000 or later first round pick (originally lottery protected, removed in a subsequent trade) (2005 #13-Sean May)", "phoenix-suns"]],
  },
  "CLE-2000-0102": {
    received: [
      ["J.R. Reid", "milwaukee-bucks"],
      ["Robert 'Tractor' Traylor", "milwaukee-bucks"],
    ],
    sent: [["Bob Sura", "golden-state-warriors"]],
  },
  "CLE-2000-0105": {
    received: [
      ["Clarence Weatherspoon", "miami-heat"],
      ["Chris Gatling", "miami-heat"],
      ["Gary Grant", "portland-trail-blazers"],
      ["2001 conditional first round pick (from Heat) (#20-Brendan Haywood)", "miami-heat"],
      ["cash", "miami-heat"],
    ],
    sent: [["Shawn Kemp", "portland-trail-blazers"]],
  },
  "CLE-2001-0109": {
    received: [
      ["Ricky Davis", "miami-heat"],
      ["Brian Skinner", "toronto-raptors"],
    ],
    sent: [["Chris Gatling", "miami-heat"]],
  },
  "CLE-2008-0134": {
    received: [["Mo Williams", "milwaukee-bucks"]],
    sent: [
      ["Damon Jones", "milwaukee-bucks"],
      ["Joe Smith", "oklahoma-city-thunder"],
    ],
  },
  "CLE-2010-0137": {
    received: [
      ["Antawn Jamison", "washington-wizards"],
      ["Sebastian Telfair", "los-angeles-clippers"],
    ],
    sent: [
      ["Zydrunas Ilgauskas", "washington-wizards"],
      ["rights to Emir Preldžic", "washington-wizards"],
      ["2010 first round pick (#30-Lazar Hayward)", "washington-wizards"],
    ],
  },
  "CLE-2014-0155": {
    received: [["Kevin Love", "minnesota-timberwolves"]],
    sent: [
      ["Andrew Wiggins", "minnesota-timberwolves"],
      ["Anthony Bennett", "minnesota-timberwolves"],
      ["protected 2015 first-round pick via Miami (conveyed in 2016 as #24-Timothé Luwawu-Cabarrot)", "philadelphia-76ers"],
    ],
  },
  "CLE-2015-0158": {
    received: [
      ["J.R. Smith", "new-york-knicks"],
      ["Iman Shumpert", "new-york-knicks"],
      ["first round pick (from Thunder) (protected top 18 in 2015, top 15 in 2016-17, else 2018 second round pick and 2019 second round pick) (2016 #26-Furkan Korkmaz)", "oklahoma-city-thunder"],
    ],
    sent: [
      ["Dion Waiters", "oklahoma-city-thunder"],
      ["Lou Amundson", "new-york-knicks"],
      ["Alex Kirk", "new-york-knicks"],
      ["2019 second round pick (#33-Carsen Edwards)", "new-york-knicks"],
    ],
  },
  "CLE-2016-0164": {
    received: [["Channing Frye", "orlando-magic"]],
    sent: [
      ["Anderson Varejao", "portland-trail-blazers"],
      ["Jared Cunningham", "orlando-magic"],
      ["first round pick (at least 2 years after Cavaliers have conveyed first round pick to Celtics) (protected top 10 in 2018-19) (2018 #25-Moe Wagner)", "portland-trail-blazers"],
    ],
  },
  "CLE-2018-0176": {
    received: [
      ["George Hill", "sacramento-kings"],
      ["Rodney Hood", "utah-jazz"],
      ["rights to Arturas Gudaitis", "sacramento-kings"],
      ["Jazz option to swap 2024 second round picks with Cavaliers (outcome pending)", "utah-jazz"],
    ],
    sent: [
      ["Derrick Rose", "utah-jazz"],
      ["Jae Crowder", "utah-jazz"],
      ["Iman Shumpert", "sacramento-kings"],
      ["rights to Dimitrios Agravanis", "sacramento-kings"],
      ["2020 second round pick (#50-Skylar Mays)", "sacramento-kings"],
      ["Jazz option to swap 2024 second round picks with Cavaliers (outcome pending)", "utah-jazz"],
      ["$2.1M cash", "sacramento-kings"],
    ],
  },
  "CLE-2018-0179": {
    received: [
      ["Matthew Dellavedova", "milwaukee-bucks"],
      ["John Henson", "milwaukee-bucks"],
      ["draft pick(s) (from Bucks) (first round originally protected top 14 in 2021 if Bucks send first round pick to Suns in 2019, top 10 in 2022 if Bucks send first round pick to Suns in 2020, top 10 in 2023, top 8 in 2024, else 2024 second round pick, 2025 second round pick; protections removed in subsequent trade)) (2022 #24-MarJon Beauchamp)", "milwaukee-bucks"],
      ["2021 second round pick (from Bucks) (#54-Sandro Mamukelashvili)", "milwaukee-bucks"],
      ["2022 second round pick (from Wizards) (#40-Bryce McGowens)", "washington-wizards"],
    ],
    sent: [
      ["George Hill", "milwaukee-bucks"],
      ["Sam Dekker", "washington-wizards"],
      ["2021 second round pick (#43-Greg Brown III)", "washington-wizards"],
    ],
  },
  "CLE-2019-0181": {
    received: [
      ["Brandon Knight", "houston-rockets"],
      ["Marquese Chriss", "houston-rockets"],
      ["2019 first round pick (from Rockets) (#26-Dylan Windler)", "houston-rockets"],
      ["2022 second round pick (from Rockets) (#31-Andrew Nembhard)", "houston-rockets"],
    ],
    sent: [
      ["Alec Burks", "sacramento-kings"],
      ["Nik Stauskas", "houston-rockets"],
      ["Wade Baldwin IV", "houston-rockets"],
      ["2021 second round pick (#54-Sandro Mamukelashvili)", "houston-rockets"],
    ],
  },
  "CLE-2022-0193": {
    received: [["Rajon Rondo", "los-angeles-lakers"]],
    sent: [["Denzel Valentine", "new-york-knicks"]],
  },
  "CLE-2023-0197": {
    received: [["Max Strus", "miami-heat"]],
    sent: [
      ["Cedi Osman", "san-antonio-spurs"],
      ["Lamar Stevens", "san-antonio-spurs"],
      ["2026 second round pick (Lakers pick) (outcome pending)", "san-antonio-spurs"],
      ["2030 second round pick (outcome pending)", "san-antonio-spurs"],
    ],
  },
};

function routeAssets(record) {
  const sourceTradeId = clean(record.sourceTradeId);
  const partnerTeams = uniqueSorted(record.partnerTeams.map(normalizeTeam));
  const participants = uniqueSorted(["cleveland-cavaliers", ...partnerTeams]);
  let edges = [];
  if (record.routingRequired === true) {
    const frozen = FROZEN_MULTI_TEAM_ROUTES[sourceTradeId];
    assert(frozen, `${sourceTradeId}: frozen multi-team route is missing.`);
    assert(record.explicitEdgeReview === "Complete", `${sourceTradeId}: explicit edge review is incomplete.`);
    assert(participants.length === Number(record.declaredTeamCount), `${sourceTradeId}: normalized team count drifted.`);
    const frozenReceived = frozen.received.map(([asset, fromTeam]) => ({
      asset,
      fromTeam: normalizeTeam(fromTeam),
      toTeam: "cleveland-cavaliers",
      direction: "received",
      edgeClass: "reviewed-cleveland-facing-route",
    }));
    const frozenSent = frozen.sent.map(([asset, toTeam]) => ({
      asset,
      fromTeam: "cleveland-cavaliers",
      toTeam: normalizeTeam(toTeam),
      direction: "sent",
      edgeClass: "reviewed-cleveland-facing-route",
    }));
    assert(
      JSON.stringify(frozenReceived.map((edge) => edge.asset)) === JSON.stringify(record.assetsReceived),
      `${sourceTradeId}: frozen received route differs from reviewed assets.`,
    );
    assert(
      JSON.stringify(frozenSent.map((edge) => edge.asset)) === JSON.stringify(record.assetsSent),
      `${sourceTradeId}: frozen sent route differs from reviewed assets.`,
    );
    edges = [...frozenReceived, ...frozenSent];
  } else {
    assert(partnerTeams.length === 1, `${sourceTradeId}: two-team trade must have one partner.`);
    const partner = partnerTeams[0];
    edges = [
      ...record.assetsReceived.map((asset) => ({
        asset,
        fromTeam: partner,
        toTeam: "cleveland-cavaliers",
        direction: "received",
        edgeClass: "two-team-route",
      })),
      ...record.assetsSent.map((asset) => ({
        asset,
        fromTeam: "cleveland-cavaliers",
        toTeam: partner,
        direction: "sent",
        edgeClass: "two-team-route",
      })),
    ];
  }
  assert(edges.length > 0, `${sourceTradeId}: no canonical assets.`);
  assert(
    edges.every((edge) => participants.includes(edge.fromTeam) && participants.includes(edge.toTeam)),
    `${sourceTradeId}: frozen route references a non-participant.`,
  );
  return edges.map((edge, index) => ({
    assetId: assetId(sourceTradeId, edge, index + 1),
    type: inferAssetType(edge.asset),
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
function parseRelationshipOrdinal(relationshipEdgeKey) {
  const match = clean(relationshipEdgeKey).match(/:(received|sent):(\d+):identity:/u);
  return match ? { side: match[1], ordinal: Number(match[2]) } : null;
}
function relationshipAsset(assets, relationship) {
  const directionAssets = assets.filter((asset) => asset.direction === relationship.side);
  assert(directionAssets.length > 0, `${relationship.relationshipEdgeKey}: no assets exist for ${relationship.side}.`);
  const rawNeedle = normalize(relationship.rawAsset);
  const exact = directionAssets.filter((asset) => normalize(asset.displayText) === rawNeedle);
  if (exact.length === 1) return exact[0];
  const parsed = parseRelationshipOrdinal(relationship.relationshipEdgeKey);
  if (parsed && parsed.side === relationship.side && parsed.ordinal >= 1 && parsed.ordinal <= directionAssets.length) {
    const selected = directionAssets[parsed.ordinal - 1];
    assert(
      normalize(selected.displayText) === rawNeedle,
      `${relationship.relationshipEdgeKey}: ordinal-selected asset differs from frozen raw asset.`,
    );
    return selected;
  }
  throw new Error(`${relationship.relationshipEdgeKey}: could not select one canonical asset.`);
}
function relationshipRole(identityKind) {
  if (identityKind === "player-rights") return "draft-rights-player";
  if (identityKind === "draft-outcome-player") return "pick-became-player";
  if (identityKind === "direct-player") return "traded-player";
  throw new Error(`Unsupported identity kind: ${identityKind}`);
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
    importReviewStatus: "private-shell-imported-cleveland-phase-8h",
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
    ...(Array.isArray(player.relationshipReferences) ? player.relationshipReferences : []),
  ];
  assert(
    !references.some((item) => clean(item.relationshipId) === reference.relationshipId),
    `Relationship already exists on player ${playerId(player)}: ${reference.relationshipId}`,
  );
  references.push(reference);
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
function reviewedPerspective(record, teams) {
  const grades = { ...(record.grades ?? {}) };
  for (const team of teams.filter((team) => team !== "cleveland-cavaliers")) {
    if (!clean(grades[team]) && clean(grades.partnerAggregate)) {
      grades[team] = clean(grades.partnerAggregate);
    }
  }
  return {
    sourceTeam: "cleveland-cavaliers",
    sourceBatchId: "cleveland-cavaliers-phase-8a",
    sourceTradeId: record.sourceTradeId,
    sourcePerspectiveKey: `cleveland-cavaliers:${record.sourceTradeId}`,
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
function countTeamMemberships(trades) {
  return trades.reduce((sum, trade) => sum + (Array.isArray(trade.teams) ? trade.teams.length : 0), 0);
}
function countPlayerTradeReferences(players) {
  return players.reduce((sum, player) => sum + (Array.isArray(player.tradeIds) ? player.tradeIds.length : 0), 0);
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
  "phase8g-partition",
  "reviewed-json",
  "trades-json",
  "players-json",
  "teams-json",
  "lineage-json",
  "receipt-json",
  "contract-md",
  "expected-partition-file-sha256",
  "expected-reviewed-file-sha256",
  "expected-lineage-file-sha256",
  "expected-contract-sha256",
  "expected-trade-store-sha256",
  "expected-player-store-sha256",
  "expected-team-store-sha256",
  "expected-final-package-sha256",
  "expected-prior-held-sha256",
  "expected-excluded-sha256",
  "expected-proposed-shells-sha256",
  "expected-relationship-previews-sha256",
  "expected-import-partition-sha256",
  "starting-head",
  "imported-at",
]) {
  assert(args[required], `Missing --${required}`);
}

const [partitionBytes, reviewedBytes, tradeBytes, playerBytes, teamBytes, lineageBytes, contractBytes] = await Promise.all([
  readFile(args["phase8g-partition"]),
  readFile(args["reviewed-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
  readFile(args["lineage-json"]),
  readFile(args["contract-md"]),
]);
const partition = JSON.parse(partitionBytes.toString("utf8"));
const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const receiptPath = path.resolve(args["receipt-json"]);

assert(partition.result === "PASS" && partition.phase === "8G", "Invalid Phase 8G partition.");
assert(reviewed.result === "PASS" && reviewed.phase === "8A", "Invalid reviewed batch.");
assert(Array.isArray(trades), "Canonical trade store is invalid.");
assert(Array.isArray(players), "Player store is invalid.");
assert(Array.isArray(teams), "Team store is invalid.");
assert(lineage && typeof lineage === "object", "Historical lineage is invalid.");
assert(sha256(partitionBytes) === args["expected-partition-file-sha256"], "Phase 8G partition file hash mismatch.");
assert(sha256(reviewedBytes) === args["expected-reviewed-file-sha256"], "Reviewed batch file hash mismatch.");
assert(sha256(lineageBytes) === args["expected-lineage-file-sha256"], "Historical lineage file hash mismatch.");
assert(sha256(contractBytes) === args["expected-contract-sha256"], "Phase 8H contract hash mismatch.");

for (const [actual, expected, label] of [
  [partition.hashes.finalPackageRecordsSha256, args["expected-final-package-sha256"], "final package records"],
  [partition.hashes.priorHeldRecordsSha256, args["expected-prior-held-sha256"], "prior held records"],
  [partition.hashes.excludedRecordsSha256, args["expected-excluded-sha256"], "excluded records"],
  [partition.hashes.finalProposedPlayerShellsSha256, args["expected-proposed-shells-sha256"], "proposed player shells"],
  [partition.hashes.finalRelationshipPreviewsSha256, args["expected-relationship-previews-sha256"], "relationship previews"],
  [partition.hashes.importPartitionSha256, args["expected-import-partition-sha256"], "import partition"],
]) {
  assert(actual === expected, `Frozen ${label} hash differs from checkpoint.`);
}
assert(partition.counts.sourceRows === 204, "Source-row count drifted.");
assert(partition.counts.finalReadyPackages === 150, "Ready-package count drifted.");
assert(partition.counts.remainingHeldPackages === 0, "Remaining identity-held count drifted.");
assert(partition.counts.priorHeldRecords === 44, "Prior-held count drifted.");
assert(partition.counts.excludedRecords === 10, "Excluded count drifted.");
assert(partition.counts.proposedPlayerShells === 238, "Proposed-shell count drifted.");
assert(partition.counts.relationshipPreviews === 446, "Relationship-preview count drifted.");
assert(partition.counts.ambiguousIdentityOccurrences === 0, "Ambiguous identity occurrence exists.");
assert(partition.counts.unsafeIdentityOccurrences === 0, "Unsafe identity occurrence exists.");
assert(partition.finalReadyPackages.length === 150, "Ready-package array drifted.");
assert(partition.remainingHeldPackages.length === 0, "Held-package array is not empty.");
assert(partition.priorHeldRecords.length === 44, "Prior-held array drifted.");
assert(partition.excludedRecords.length === 10, "Excluded array drifted.");
assert(partition.proposedPlayerShells.length === 238, "Proposed-shell array drifted.");
assert(partition.relationshipPreviews.length === 446, "Relationship array drifted.");

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
  assert(existingReceipt.result === "PASS" && existingReceipt.phase === "8H", "Existing Phase 8H receipt is invalid.");
  assert(existingReceipt.canonicalStoreSha256 === tradeHash, "Replay canonical hash differs from receipt.");
  assert(existingReceipt.playerStoreSha256 === playerHash, "Replay player hash differs from receipt.");
  assert(existingReceipt.teamStoreSha256 === teamHash, "Replay team hash differs from receipt.");
  console.log(JSON.stringify({
    result: "PASS",
    phase: "8H",
    mode: "IDEMPOTENT_REPLAY",
    readyPackages: existingReceipt.readyPackages,
    priorHeldRecords: existingReceipt.priorHeldRecords,
    excludedRecords: existingReceipt.excludedRecords,
    canonicalTradesCreated: existingReceipt.canonicalTradesCreated,
    playerShellsCreated: existingReceipt.playerShellsCreated,
    relationshipReferencesAdded: existingReceipt.relationshipReferencesAdded,
    postImportCanonicalTrades: existingReceipt.postImportCanonicalTrades,
    postImportPlayers: existingReceipt.postImportPlayers,
    postImportTeams: existingReceipt.postImportTeams,
    repositoryDataWrites: 0,
    canonicalStoreSha256: tradeHash,
    playerStoreSha256: playerHash,
    teamStoreSha256: teamHash,
    receiptSha256: sha256(canonicalJson(existingReceipt)),
  }, null, 2));
  process.exit(0);
}

assert(trades.length === 932, "Expected 932 pre-import canonical trades.");
assert(players.length === 1510, "Expected 1,510 pre-import players.");
assert(teams.length === 52, "Expected 52 pre-import teams.");

const normalizedTradePreimage = lfNormalizedUtf8Bytes(tradeBytes, "Canonical store");
const normalizedPlayerPreimage = lfNormalizedUtf8Bytes(playerBytes, "Player store");
const normalizedTeamPreimage = lfNormalizedUtf8Bytes(teamBytes, "Team store");
assert(sha256(normalizedTradePreimage) === args["expected-trade-store-sha256"], "Canonical store LF-normalized preimage hash mismatch.");
assert(sha256(normalizedPlayerPreimage) === args["expected-player-store-sha256"], "Player store LF-normalized preimage hash mismatch.");
assert(sha256(normalizedTeamPreimage) === args["expected-team-store-sha256"], "Team store LF-normalized preimage hash mismatch.");

const reviewedById = new Map(reviewed.records.map((record) => [record.sourceTradeId, record]));
assert(reviewedById.size === 204, "Duplicate reviewed source-trade ID.");
const readySourceIds = new Set(partition.finalReadyPackages.map((record) => record.sourceTradeId));
const priorHeldSourceIds = uniqueSorted(partition.priorHeldRecords.map((record) => record.sourceTradeId));
const excludedSourceIds = uniqueSorted(partition.excludedRecords.map((record) => record.sourceTradeId));
assert(readySourceIds.size === 150, "Duplicate ready source-trade ID.");
assert(priorHeldSourceIds.length === 44, "Duplicate prior-held source-trade ID.");
assert(excludedSourceIds.length === 10, "Duplicate excluded source-trade ID.");
const allDispositionIds = uniqueSorted([...readySourceIds, ...priorHeldSourceIds, ...excludedSourceIds]);
assert(allDispositionIds.length === 204, "Source dispositions do not close to 204 rows.");

const tradeMap = new Map(trades.map((trade) => [tradeId(trade), trade]));
const playerMap = new Map(players.map((player) => [playerId(player), player]));
assert(tradeMap.size === trades.length, "Duplicate canonical trade ID.");
assert(playerMap.size === players.length, "Duplicate player ID.");

const existingSlugs = new Set(players.map((player) => clean(player.slug)).filter(Boolean));
const createdPlayerIds = [];
for (const shell of partition.proposedPlayerShells) {
  const id = clean(shell.proposedPlayerId);
  assert(id, `${shell.proposedPlayerKey}: proposed player ID is missing.`);
  assert(shell.privateOnly === true && shell.indexEligible === false && shell.adEligible === false, `${shell.proposedPlayerKey}: shell privacy drifted.`);
  assert(shell.automaticPlayerCreate === false && shell.playerImport === false, `${shell.proposedPlayerKey}: shell authorization drifted.`);
  assert(!playerMap.has(id), `Player shell target already exists: ${id}`);
  let slug = id.startsWith("nba-player-") ? id.slice("nba-player-".length) : slugify(shell.displayName);
  if (existingSlugs.has(slug)) {
    slug = `${slug}-${sha256(shell.proposedPlayerKey).slice(0, 8).toLowerCase()}`;
  }
  assert(!existingSlugs.has(slug), `Player shell slug already exists: ${slug}`);
  existingSlugs.add(slug);
  playerMap.set(id, createPlayerShell(shell, slug, args["imported-at"]));
  createdPlayerIds.push(id);
}
assert(createdPlayerIds.length === 238, "Created player-shell count drifted.");

const relationshipsByTrade = new Map();
for (const relationship of partition.relationshipPreviews) {
  assert(relationship.privateOnly === true && relationship.indexEligible === false && relationship.adEligible === false, `${relationship.relationshipEdgeKey}: relationship privacy drifted.`);
  assert(relationship.relationshipWrite === false && relationship.playerImport === false && relationship.canonicalImport === false, `${relationship.relationshipEdgeKey}: relationship authorization drifted.`);
  if (!relationshipsByTrade.has(relationship.sourceTradeId)) relationshipsByTrade.set(relationship.sourceTradeId, []);
  relationshipsByTrade.get(relationship.sourceTradeId).push(relationship);
}

const importedTradeIds = [];
const importedRelationshipIds = [];
const importedSourceTradeIds = [];
const relationshipOwners = new Set();
for (const packageRecord of partition.finalReadyPackages) {
  assert(packageRecord.packageReady === true && packageRecord.packageHeld === false, `${packageRecord.sourceTradeId}: package readiness drifted.`);
  assert(packageRecord.ambiguousOccurrenceCount === 0 && packageRecord.unsafeOccurrenceCount === 0, `${packageRecord.sourceTradeId}: unsafe identity package advanced.`);
  const source = reviewedById.get(packageRecord.sourceTradeId);
  assert(source, `Reviewed record missing: ${packageRecord.sourceTradeId}`);
  assert(source.mergeExclude === false, `${packageRecord.sourceTradeId}: linked follow-up cannot be imported.`);
  assert(source.databaseImportAuthorized === true, `${packageRecord.sourceTradeId}: database import is not authorized.`);
  assert(source.researchBeforePublic === false, `${packageRecord.sourceTradeId}: research status reopened.`);
  assert(source.reviewStatus !== "Needs Research", `${packageRecord.sourceTradeId}: research status reopened.`);
  assert(source.priorReviewedMatch === false, `${packageRecord.sourceTradeId}: prior canonical match cannot be created automatically.`);
  assert(source.automaticMergeAuthorized === false && source.automaticRouteAuthorized === false, `${packageRecord.sourceTradeId}: automatic operation authorization drifted.`);

  const teamsForTrade = uniqueSorted(["cleveland-cavaliers", ...source.partnerTeams.map(normalizeTeam)]);
  assert(teamsForTrade.length === Number(source.declaredTeamCount), `${packageRecord.sourceTradeId}: team-count mismatch.`);
  assert(teamsForTrade.includes("cleveland-cavaliers"), `${packageRecord.sourceTradeId}: Cleveland team is missing.`);
  assert(source.routingRequired === packageRecord.routingRequired, `${packageRecord.sourceTradeId}: routing flag drifted.`);
  assert(packageRecord.routeFrozen === source.routingRequired, `${packageRecord.sourceTradeId}: route-freeze flag drifted.`);

  const assets = routeAssets(source);
  assert(new Set(assets.map((asset) => asset.assetId)).size === assets.length, `${packageRecord.sourceTradeId}: duplicate asset IDs.`);
  const canonicalId = canonicalTradeId(packageRecord.sourceTradeId);
  assert(!tradeMap.has(canonicalId), `Canonical trade target already exists: ${canonicalId}`);

  const tradeRelationships = relationshipsByTrade.get(packageRecord.sourceTradeId) ?? [];
  assert(tradeRelationships.length === Number(packageRecord.identityOccurrenceCount), `${packageRecord.sourceTradeId}: relationship count differs from package identity count.`);
  for (const relationship of tradeRelationships) {
    const targetPlayerId = clean(relationship.existingPlayerId ?? relationship.proposedPlayerId ?? relationship.targetPlayerKey);
    assert(targetPlayerId, `${relationship.relationshipEdgeKey}: target player is missing.`);
    const player = playerMap.get(targetPlayerId);
    assert(player, `${relationship.relationshipEdgeKey}: target player does not exist: ${targetPlayerId}`);
    if (relationship.identityStatus === "existing-player-exact") {
      assert(clean(relationship.existingPlayerId) === targetPlayerId && !relationship.proposedPlayerId, `${relationship.relationshipEdgeKey}: exact-player target drifted.`);
    } else if (relationship.identityStatus === "proposed-player-shell") {
      assert(clean(relationship.proposedPlayerId) === targetPlayerId && !relationship.existingPlayerId, `${relationship.relationshipEdgeKey}: shell-player target drifted.`);
      assert(createdPlayerIds.includes(targetPlayerId), `${relationship.relationshipEdgeKey}: shell target was not created in this phase.`);
    } else {
      throw new Error(`${relationship.relationshipEdgeKey}: unsupported identity status ${relationship.identityStatus}`);
    }
    const asset = relationshipAsset(assets, relationship);
    const role = relationshipRole(relationship.identityKind);
    assert(!clean(asset.playerId), `${relationship.relationshipEdgeKey}: canonical asset already owns a player.`);
    asset.playerId = targetPlayerId;
    asset.playerIds = [targetPlayerId];
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
      sourceAssetId: null,
      sourceTradeId: packageRecord.sourceTradeId,
      packageId: `cleveland-cavaliers-phase-8h-${packageRecord.sourceTradeId}`,
      sourceTeam: "cleveland-cavaliers",
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
    sourceTeams: ["cleveland-cavaliers"],
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
    partnerOnlyRoutingNotes: [],
    sources: [
      {
        sourceType: "reviewed_private_batch",
        sourceTeam: "cleveland-cavaliers",
        sourceBatchId: "cleveland-cavaliers-phase-8a",
        sourceTradeId: packageRecord.sourceTradeId,
        privateOnly: true,
      },
      ...(clean(source.primaryOfficialSourceUrl) ? [{ sourceType: "primary_transaction_source", url: clean(source.primaryOfficialSourceUrl), privateOnly: true }] : []),
      ...(clean(source.secondaryAuthoritativeSourceUrl) ? [{ sourceType: "secondary_authoritative_source", url: clean(source.secondaryAuthoritativeSourceUrl), privateOnly: true }] : []),
    ],
    perspectiveReconciliations: [{
      sourceBatchId: "cleveland-cavaliers-phase-8g",
      packageId: `cleveland-cavaliers-phase-8h-${packageRecord.sourceTradeId}`,
      method: "frozen-ready-canonical-create",
      importedAt: args["imported-at"],
      automaticMerge: false,
    }],
    publishStatus: "private",
    reviewStatus: "manual-review",
    importReviewStatus: "private-imported-cleveland-phase-8h",
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

assert(importedTradeIds.length === 150, "Imported trade count drifted.");
assert(importedRelationshipIds.length === 446, "Imported relationship count drifted.");
assert(playerMap.size === 1748, `Expected 1,748 post-import players, found ${playerMap.size}.`);
assert(tradeMap.size === 1082, `Expected 1,082 post-import trades, found ${tradeMap.size}.`);
const untouchedSourceIds = uniqueSorted([...priorHeldSourceIds, ...excludedSourceIds]);
assert(untouchedSourceIds.length === 54, "Untouched source-row count drifted.");
for (const sourceTradeId of untouchedSourceIds) {
  assert(!importedSourceTradeIds.includes(sourceTradeId), `Held or excluded source row was imported: ${sourceTradeId}`);
}

const finalTrades = [...tradeMap.values()];
const finalPlayers = [...playerMap.values()];
const registration = registerMissingHistoricalTeams(finalTrades, teams, lineage, args["imported-at"]);
const finalTeams = registration.teams;
assert(registration.registrations.length === 0, `Unexpected team registrations: ${registration.missingSlugs.join(", ")}`);

const preTeamMemberships = countTeamMemberships(trades);
const postTeamMemberships = countTeamMemberships(finalTrades);
const prePlayerTradeReferences = countPlayerTradeReferences(players);
const postPlayerTradeReferences = countPlayerTradeReferences(finalPlayers);
const tradeOut = canonicalJson(finalTrades);
const playerOut = canonicalJson(finalPlayers);
const teamOut = canonicalJson(finalTeams);
const receipt = {
  result: "PASS",
  phase: "8H",
  mode: "FIRST_IMPORT",
  batchId: "cleveland-cavaliers-phase-8h",
  startingHead: args["starting-head"],
  importedAt: args["imported-at"],
  sourceHashes: {
    phase8GFileSha256: sha256(partitionBytes),
    reviewedBatchSha256: sha256(reviewedBytes),
    finalPackageRecordsSha256: partition.hashes.finalPackageRecordsSha256,
    priorHeldRecordsSha256: partition.hashes.priorHeldRecordsSha256,
    excludedRecordsSha256: partition.hashes.excludedRecordsSha256,
    proposedPlayerShellsSha256: partition.hashes.finalProposedPlayerShellsSha256,
    relationshipPreviewsSha256: partition.hashes.finalRelationshipPreviewsSha256,
    importPartitionSha256: partition.hashes.importPartitionSha256,
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
  readyPackages: partition.finalReadyPackages.length,
  identityHeldPackages: partition.remainingHeldPackages.length,
  priorHeldRecords: priorHeldSourceIds.length,
  excludedRecords: excludedSourceIds.length,
  totalUntouchedSourceRows: untouchedSourceIds.length,
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
  playerTradeReferencesAdded: postPlayerTradeReferences - prePlayerTradeReferences,
  readySourceTradeIds: [...readySourceIds].sort(),
  identityHeldSourceTradeIds: [],
  priorHeldSourceTradeIds: priorHeldSourceIds,
  excludedSourceTradeIds: excludedSourceIds,
  untouchedSourceTradeIds: untouchedSourceIds,
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
await atomicWrite(args["trades-json"], tradeOut, "phase8h-trades");
await atomicWrite(args["players-json"], playerOut, "phase8h-players");
await atomicWrite(args["teams-json"], teamOut, "phase8h-teams");
await atomicWrite(receiptPath, receiptOut, "phase8h-receipt");
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
