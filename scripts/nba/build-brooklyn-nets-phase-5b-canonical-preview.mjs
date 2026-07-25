#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expandAuditedNbaAssetText } from "../../src/lib/nba/parse-audited-asset-text.mjs";
import { createHistoricalNbaTeamResolver } from "../../src/lib/nba/resolve-historical-team.mjs";

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
function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
function clean(value) {
  return String(value ?? "").trim();
}
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function toCsv(rows, fallbackHeaders = []) {
  const headers = rows.length ? Object.keys(rows[0]) : fallbackHeaders;
  if (!headers.length) return "";
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}
function countBy(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)));
}
function seasonLabel(tradeDate) {
  const [yearText, monthText] = String(tradeDate).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}
function teamKey(tradeDate, teams) {
  return `${tradeDate}|${sortedUnique(teams).join("|")}`;
}
function normalizeAssetText(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[’‘]/gu, "'")
    .replace(/&/gu, " and ")
    .replace(/\bapproximately\b/gu, "")
    .replace(/\babout\b/gu, "")
    .replace(/\bright(s)?\s+to\b/gu, "rights ")
    .replace(/\bdraft\s+rights\b/gu, "rights")
    .replace(/\bfirst[- ]round\b/gu, "1st round")
    .replace(/\bsecond[- ]round\b/gu, "2nd round")
    .replace(/\bthird[- ]round\b/gu, "3rd round")
    .replace(/\bfourth[- ]round\b/gu, "4th round")
    .replace(/\bfifth[- ]round\b/gu, "5th round")
    .replace(/\bsixth[- ]round\b/gu, "6th round")
    .replace(/\bseventh[- ]round\b/gu, "7th round")
    .replace(/\bno\.\s*/gu, "#")
    .replace(/[^a-z0-9#'+-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
function assetDisplay(asset) {
  if (typeof asset === "string") return clean(asset);
  if (!asset || typeof asset !== "object") return "";
  return clean(
    asset.displayText ??
    asset.asset ??
    asset.playerName ??
    asset.name ??
    asset.label ??
    asset.description ??
    asset.pick ??
    asset.value ??
    asset.text
  );
}
function tokensFromTexts(values) {
  return sortedUnique((values ?? []).map((value) => normalizeAssetText(assetDisplay(value))).filter(Boolean));
}
function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function normalizeFallback(label, tradeDate) {
  const exact = {
    "76ers": "philadelphia-76ers",
    "Rockets": "houston-rockets",
    "Lakers": "los-angeles-lakers",
    "Hawks": "atlanta-hawks",
    "Warriors": "golden-state-warriors",
    "Pacers": "indiana-pacers",
    "Nuggets": "denver-nuggets",
    "Bucks": "milwaukee-bucks",
    "Blazers": "portland-trail-blazers",
    "Kings": "sacramento-kings",
    "Hornets": "charlotte-hornets",
    "Pistons": "detroit-pistons",
    "Suns": "phoenix-suns",
    "Celtics": "boston-celtics",
    "Clippers": "los-angeles-clippers",
    "Jazz": "utah-jazz",
    "Mavericks": "dallas-mavericks",
    "Timberwolves": "minnesota-timberwolves",
    "Raptors": "toronto-raptors",
    "Bulls": "chicago-bulls",
    "Sonics": "seattle-supersonics",
    "Cavaliers": "cleveland-cavaliers",
    "Knicks": "new-york-knicks",
    "Magic": "orlando-magic",
    "Bullets": "washington-wizards",
    "Wizards": "washington-wizards",
    "Spurs": "san-antonio-spurs",
    "Grizzlies": "memphis-grizzlies",
    "Braves": "los-angeles-clippers",
    "Heat": "miami-heat",
    "Pelicans": "new-orleans-pelicans",
    "Bobcats": "charlotte-hornets",
    "Thunder": "oklahoma-city-thunder",
    "Chaparrals": "san-antonio-spurs",
    "Chaparrals (ABA)": "san-antonio-spurs",
    "Pacers (ABA)": "indiana-pacers",
    "Spurs (ABA)": "san-antonio-spurs",
    "Rockets (ABA)": "denver-nuggets",
    "Nuggets (ABA)": "denver-nuggets",
    "Colonels (ABA)": "kentucky-colonels",
    "Floridians (ABA)": "the-floridians",
    "Squires (ABA)": "virginia-squires",
    "Oaks (ABA)": "virginia-squires",
    "Caps (ABA)": "virginia-squires",
    "Cougars (ABA)": "spirits-of-st-louis",
    "Mavericks (ABA)": "spirits-of-st-louis",
    "Buccaneers (ABA)": "memphis-sounds",
    "Conquistadors (ABA)": "san-diego-sails",
    "Sails (ABA)": "san-diego-sails",
  };
  if (label === "Pipers (ABA)") {
    return tradeDate >= "1968-07-01" && tradeDate < "1969-07-01"
      ? "minnesota-pipers"
      : "pittsburgh-condors";
  }
  if (label === "Stars (ABA)") {
    return tradeDate < "1970-06-01" ? "los-angeles-stars" : "utah-stars";
  }
  return exact[label] ?? "";
}
function looksLikeSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(clean(value));
}
function recordDate(record) {
  return clean(record.tradeDate ?? record.date);
}
function recordId(record) {
  return clean(record.tradeId ?? record.id ?? record.sourceTradeId);
}
function recordSourceTeam(record, fallback) {
  return clean(record.sourceTeam ?? record.primaryTeam ?? fallback);
}
function recordPartnerValues(record) {
  if (Array.isArray(record.partnerTeams)) return record.partnerTeams;
  if (Array.isArray(record.partnerLabels)) return record.partnerLabels;
  if (typeof record.partnerTeam === "string") return [record.partnerTeam];
  return [];
}
function receivedText(record) {
  if (Array.isArray(record.assetsReceivedText)) return record.assetsReceivedText;
  if (Array.isArray(record.sourceTeamAssets)) return record.sourceTeamAssets;
  if (typeof record.assetsReceivedText === "string") return [record.assetsReceivedText];
  if (typeof record.sourceTeamAssetsText === "string") {
    return record.sourceTeamAssetsText.split(";").map(clean).filter(Boolean);
  }
  return [];
}
function sentText(record) {
  if (Array.isArray(record.assetsSentText)) return record.assetsSentText;
  if (Array.isArray(record.partnerAggregateAssets)) return record.partnerAggregateAssets;
  if (typeof record.assetsSentText === "string") return [record.assetsSentText];
  if (typeof record.partnerAggregateAssetsText === "string") {
    return record.partnerAggregateAssetsText.split(";").map(clean).filter(Boolean);
  }
  return [];
}
function canonicalAssetsForTeam(trade, team) {
  const bucket = trade?.assetsReceived?.[team];
  return Array.isArray(bucket) ? bucket : [];
}
function canonicalAllOtherAssets(trade, sourceTeam) {
  const output = [];
  for (const team of trade.teams ?? []) {
    if (team === sourceTeam) continue;
    output.push(...canonicalAssetsForTeam(trade, team));
  }
  return output;
}
function sourceComparable(record, teams) {
  const received = receivedText(record);
  const sent = sentText(record);
  const receivedTokens = tokensFromTexts(received);
  const sentTokens = tokensFromTexts(sent);
  const directionlessTokens = sortedUnique([...receivedTokens, ...sentTokens]);
  const dateTeamsKey = teamKey(record.tradeDate, teams);
  const perspectiveHash = sha256(stable({
    sourceTeam: record.sourceTeam,
    dateTeamsKey,
    receivedTokens,
    sentTokens,
  })).slice(0, 24);
  const transactionHash = sha256(stable({
    dateTeamsKey,
    directionlessTokens,
  })).slice(0, 24);
  return {
    received,
    sent,
    receivedTokens,
    sentTokens,
    directionlessTokens,
    dateTeamsKey,
    sourcePerspectiveKey: `${record.sourceTeam}|${dateTeamsKey}|${perspectiveHash}`,
    transactionFingerprint: `${dateTeamsKey}|${transactionHash}`,
    provisionalCanonicalKey: `${dateTeamsKey}|${transactionHash.slice(0, 20)}`,
    provisionalCanonicalId: `nba-trade-${record.tradeDate.replaceAll("-", "")}-${sha256(`${dateTeamsKey}|${transactionHash}`).slice(0, 12)}`,
  };
}
function compareToCanonical(record, comparable, trade) {
  const canonicalSourceTokens = tokensFromTexts(canonicalAssetsForTeam(trade, record.sourceTeam));
  const canonicalPartnerTokens = tokensFromTexts(canonicalAllOtherAssets(trade, record.sourceTeam));
  const sourceSimilarity = jaccard(comparable.receivedTokens, canonicalSourceTokens);
  const partnerSimilarity = jaccard(comparable.sentTokens, canonicalPartnerTokens);
  const similarity = (sourceSimilarity + partnerSimilarity) / 2;
  const exactSourceAssets = stable(comparable.receivedTokens) === stable(canonicalSourceTokens);
  const exactPartnerAssets = stable(comparable.sentTokens) === stable(canonicalPartnerTokens);
  const classification =
    exactSourceAssets && exactPartnerAssets
      ? "semantic-existing-match"
      : similarity >= 0.75
        ? "probable-existing-match"
        : "same-day-team-collision";
  return {
    canonicalId: clean(trade.id),
    classification,
    exactDate: record.tradeDate === recordDate(trade),
    exactTeams: comparable.dateTeamsKey === teamKey(recordDate(trade), trade.teams ?? []),
    exactSourceAssets,
    exactPartnerAssets,
    sourceSimilarity: Number(sourceSimilarity.toFixed(6)),
    partnerSimilarity: Number(partnerSimilarity.toFixed(6)),
    similarity: Number(similarity.toFixed(6)),
  };
}
function priorComparable(record, fallbackSourceTeam, resolvePartner) {
  const tradeDate = recordDate(record);
  const sourceTeam = recordSourceTeam(record, fallbackSourceTeam);
  let teams = Array.isArray(record.teams) ? record.teams.map(clean).filter(Boolean) : [];
  if (!teams.length) {
    const partners = recordPartnerValues(record).map((value) => resolvePartner(clean(value), tradeDate));
    teams = [sourceTeam, ...partners];
  }
  return {
    id: recordId(record),
    sourceTeam,
    tradeDate,
    teams: sortedUnique(teams),
    dateTeamsKey: teamKey(tradeDate, teams),
    receivedTokens: tokensFromTexts(receivedText(record)),
    sentTokens: tokensFromTexts(sentText(record)),
    directionlessTokens: sortedUnique([
      ...tokensFromTexts(receivedText(record)),
      ...tokensFromTexts(sentText(record)),
    ]),
    canonicalDisposition: clean(record.canonicalDisposition),
  };
}
function compareToPrior(record, comparable, prior, batchName) {
  const directionlessSimilarity = jaccard(comparable.directionlessTokens, prior.directionlessTokens);
  return {
    batch: batchName,
    sourceTradeId: prior.id,
    sourceTeam: prior.sourceTeam,
    canonicalDisposition: prior.canonicalDisposition,
    classification: directionlessSimilarity === 1 ? "semantic-reviewed-match" : "date-team-reviewed-collision",
    exactDate: record.tradeDate === prior.tradeDate,
    exactTeams: comparable.dateTeamsKey === prior.dateTeamsKey,
    similarity: Number(directionlessSimilarity.toFixed(6)),
  };
}
function parseAssets(record, direction) {
  const texts = direction === "received" ? receivedText(record) : sentText(record);
  const isTwoTeam = record.partnerTeams.length === 1;
  const directPartner = isTwoTeam ? record.partnerTeams[0] : null;
  const fromTeam = direction === "received" ? directPartner : record.sourceTeam;
  const toTeam = direction === "received" ? record.sourceTeam : directPartner;
  const possibleFromTeams = direction === "received" && !isTwoTeam ? record.partnerTeams : [];
  const possibleToTeams = direction === "sent" && !isTwoTeam ? record.partnerTeams : [];
  const results = [];
  let index = 0;

  for (const text of texts) {
    let expanded;
    try {
      expanded = expandAuditedNbaAssetText(text, {
        legacyMode: true,
        tradeDate: record.tradeDate,
        draftYear: Number(record.tradeDate.slice(0, 4)),
        fromTeam,
        toTeam,
        swapContracts: [],
      });
    } catch (error) {
      expanded = [{
        type: "other",
        displayText: text,
        status: "unclassified",
        notes: [`Parser error: ${error.message}`],
      }];
    }

    for (const asset of expanded) {
      index += 1;
      results.push({
        assetId: `${record.tradeId}-${direction}-${String(index).padStart(2, "0")}`,
        ...asset,
        displayText: clean(asset.displayText || text),
        direction,
        sourceTeam: record.sourceTeam,
        fromTeam,
        toTeam,
        possibleFromTeams,
        possibleToTeams,
        routingStatus: isTwoTeam
          ? "resolved"
          : direction === "received"
            ? "partially-resolved"
            : "unresolved-counterparty",
        previewOnly: true,
      });
    }
  }
  return results;
}

const args = parseArgs(process.argv);
for (const required of [
  "reviewed-json",
  "trades-json",
  "teams-json",
  "lineage-json",
  "atlanta-reviewed-json",
  "boston-reviewed-json",
  "output-dir",
]) assert(args[required], `Missing --${required}`);

const [
  reviewedBytes,
  tradesBytes,
  teamsBytes,
  lineageBytes,
  atlantaBytes,
  bostonBytes,
] = await Promise.all([
  readFile(args["reviewed-json"]),
  readFile(args["trades-json"]),
  readFile(args["teams-json"]),
  readFile(args["lineage-json"]),
  readFile(args["atlanta-reviewed-json"]),
  readFile(args["boston-reviewed-json"]),
]);

const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const teams = JSON.parse(teamsBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));
const boston = JSON.parse(bostonBytes.toString("utf8"));
const resolver = createHistoricalNbaTeamResolver({ teams, lineage });
const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

assert(reviewed.batchId === "brooklyn-nets-phase-5a", "Unexpected Nets source batch.");
assert(Array.isArray(reviewed.records) && reviewed.records.length === 251, "Expected 251 Nets records.");
assert(Array.isArray(trades), "Canonical store root is not an array.");
assert(Array.isArray(teams), "Team registry root is not an array.");
assert(Array.isArray(atlanta.records), "Atlanta reviewed records unavailable.");
assert(Array.isArray(boston.records), "Boston reviewed records unavailable.");

let resolverReferences = 0;
let fallbackReferences = 0;
function resolvePartner(value, tradeDate, countReference = true) {
  if (looksLikeSlug(value)) return value;
  let result = null;
  try {
    result = resolver.resolve(value, tradeDate);
  } catch {
    result = null;
  }
  if (result?.team?.slug) {
    if (countReference) resolverReferences += 1;
    return result.team.slug;
  }
  const fallback = normalizeFallback(value, tradeDate);
  assert(fallback, `Unresolved partner ${value} on ${tradeDate}.`);
  if (countReference) fallbackReferences += 1;
  return fallback;
}

const currentByKey = new Map();
for (const trade of trades) {
  const tradeDate = recordDate(trade);
  if (!tradeDate || !Array.isArray(trade.teams) || trade.teams.length < 2) continue;
  const key = teamKey(tradeDate, trade.teams);
  if (!currentByKey.has(key)) currentByKey.set(key, []);
  currentByKey.get(key).push(trade);
}

const atlantaPrior = atlanta.records.map((record) =>
  priorComparable(record, "atlanta-hawks", (value, tradeDate) =>
    resolvePartner(value, tradeDate, false)
  )
);
const bostonPrior = boston.records.map((record) =>
  priorComparable(record, "boston-celtics", (value, tradeDate) =>
    resolvePartner(value, tradeDate, false)
  )
);
const atlantaByKey = new Map();
const bostonByKey = new Map();
for (const record of atlantaPrior) {
  if (!atlantaByKey.has(record.dateTeamsKey)) atlantaByKey.set(record.dateTeamsKey, []);
  atlantaByKey.get(record.dateTeamsKey).push(record);
}
for (const record of bostonPrior) {
  if (!bostonByKey.has(record.dateTeamsKey)) bostonByKey.set(record.dateTeamsKey, []);
  bostonByKey.get(record.dateTeamsKey).push(record);
}

const normalizedRecords = reviewed.records.map((record) => {
  const partnerTeams = record.partnerLabels.map((label) => resolvePartner(label, record.tradeDate));
  const teamsForRecord = sortedUnique([record.sourceTeam, ...partnerTeams]);
  const adapted = {
    ...record,
    partnerTeams,
    teams: teamsForRecord,
    assetsReceivedText: receivedText(record),
    assetsSentText: sentText(record),
  };
  const comparable = sourceComparable(adapted, teamsForRecord);
  return { adapted, comparable };
});

const withinRows = [];
const bySourceKey = new Map();
for (const item of normalizedRecords) {
  const key = item.comparable.dateTeamsKey;
  if (!bySourceKey.has(key)) bySourceKey.set(key, []);
  bySourceKey.get(key).push(item);
}
for (const [dateTeamsKey, items] of bySourceKey) {
  if (items.length < 2) continue;
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const left = items[leftIndex];
      const right = items[rightIndex];
      const similarity = jaccard(left.comparable.directionlessTokens, right.comparable.directionlessTokens);
      withinRows.push({
        dateTeamsKey,
        leftTradeId: left.adapted.tradeId,
        rightTradeId: right.adapted.tradeId,
        similarity: Number(similarity.toFixed(6)),
        exactAssetSet: similarity === 1,
        leftDisposition: left.adapted.canonicalDisposition,
        rightDisposition: right.adapted.canonicalDisposition,
        automaticMergeAuthorized: false,
      });
    }
  }
}

const nonStandalone = new Set(["merge-followup", "exclude-duplicate", "retain-void-history"]);
const records = [];
const currentRows = [];
const atlantaRows = [];
const bostonRows = [];
const blockerRows = [];
const typedAssetCounts = {};
const currentTargetRecommendations = [];

for (const { adapted: record, comparable } of normalizedRecords) {
  const assetsReceived = parseAssets(record, "received");
  const assetsSent = parseAssets(record, "sent");
  const assetLedger = [...assetsReceived, ...assetsSent];
  for (const asset of assetLedger) {
    const key = clean(asset.type || "other");
    typedAssetCounts[key] = (typedAssetCounts[key] ?? 0) + 1;
  }
  const unclassifiedAssetCount = assetLedger.filter(
    (asset) => asset.status === "unclassified" || asset.type === "other" && /parser error/iu.test((asset.notes ?? []).join(" "))
  ).length;

  const currentMatches = currentByKey.get(comparable.dateTeamsKey) ?? [];
  const currentComparisons = currentMatches.map((trade) => compareToCanonical(record, comparable, trade));
  for (const comparison of currentComparisons) {
    currentRows.push({
      sourceTradeId: record.tradeId,
      tradeDate: record.tradeDate,
      dateTeamsKey: comparable.dateTeamsKey,
      canonicalId: comparison.canonicalId,
      classification: comparison.classification,
      exactSourceAssets: comparison.exactSourceAssets,
      exactPartnerAssets: comparison.exactPartnerAssets,
      sourceSimilarity: comparison.sourceSimilarity,
      partnerSimilarity: comparison.partnerSimilarity,
      similarity: comparison.similarity,
      automaticMergeAuthorized: false,
    });
  }

  const atlantaMatches = atlantaByKey.get(comparable.dateTeamsKey) ?? [];
  const bostonMatches = bostonByKey.get(comparable.dateTeamsKey) ?? [];
  const atlantaComparisons = atlantaMatches.map((prior) => compareToPrior(record, comparable, prior, "atlanta"));
  const bostonComparisons = bostonMatches.map((prior) => compareToPrior(record, comparable, prior, "boston"));
  for (const comparison of atlantaComparisons) {
    atlantaRows.push({
      sourceTradeId: record.tradeId,
      tradeDate: record.tradeDate,
      dateTeamsKey: comparable.dateTeamsKey,
      reviewedTradeId: comparison.sourceTradeId,
      classification: comparison.classification,
      similarity: comparison.similarity,
      canonicalDisposition: comparison.canonicalDisposition,
      automaticMergeAuthorized: false,
    });
  }
  for (const comparison of bostonComparisons) {
    bostonRows.push({
      sourceTradeId: record.tradeId,
      tradeDate: record.tradeDate,
      dateTeamsKey: comparable.dateTeamsKey,
      reviewedTradeId: comparison.sourceTradeId,
      classification: comparison.classification,
      similarity: comparison.similarity,
      canonicalDisposition: comparison.canonicalDisposition,
      automaticMergeAuthorized: false,
    });
  }

  const blockers = [];
  let candidateAction;
  let duplicateGuardStatus;
  let canonicalInstruction;
  let existingCanonicalMatch = null;

  const recentOrProvisional =
    record.tradeDate >= "2025-01-01" ||
    record.confidence === "low" ||
    /provisional/iu.test(record.reviewStatus) ||
    /insufficient/iu.test(record.verdict);

  if (nonStandalone.has(record.canonicalDisposition)) {
    candidateAction = "exclude-from-standalone-canonical-preview";
    duplicateGuardStatus = record.canonicalDisposition;
    canonicalInstruction = "Preserve administrative row without standalone canonical creation";
    blockers.push(record.canonicalDisposition);
  } else if (record.canonicalDisposition === "hold-research" || record.verdict === "Insufficient Evidence") {
    candidateAction = "hold-new-canonical-evidence";
    duplicateGuardStatus = "evidence-hold";
    canonicalInstruction = "Research source facts before any canonical decision";
    blockers.push("insufficient-evidence");
  } else if (unclassifiedAssetCount > 0) {
    candidateAction = "hold-new-canonical-parser";
    duplicateGuardStatus = "unclassified-asset-hold";
    canonicalInstruction = "Resolve asset parser classification before canonical packaging";
    blockers.push("unclassified-assets");
  } else if (record.routingRequired || record.declaredTeamCount > 2) {
    candidateAction = "hold-new-canonical-routing";
    duplicateGuardStatus = "multi-team-routing-hold";
    canonicalInstruction = "Resolve explicit team-by-team asset routing before canonical packaging";
    blockers.push("multi-team-routing");
  } else if (currentComparisons.length === 1 && currentComparisons[0].classification === "semantic-existing-match") {
    existingCanonicalMatch = currentComparisons[0].canonicalId;
    if (recentOrProvisional) {
      candidateAction = "hold-existing-canonical-provisional";
      duplicateGuardStatus = "recent-existing-perspective-hold";
      canonicalInstruction = "Hold the Nets perspective until the recent/provisional outcome gate is cleared";
      blockers.push("recent-or-provisional");
    } else {
      candidateAction = "add-nets-perspective-to-existing-canonical-preview";
      duplicateGuardStatus = "unique-existing-canonical-semantic-match";
      canonicalInstruction = "Add a private Brooklyn Nets perspective to the existing canonical trade";
      currentTargetRecommendations.push(existingCanonicalMatch);
    }
  } else if (currentComparisons.length > 0) {
    candidateAction = "hold-for-existing-same-day-collision-review";
    duplicateGuardStatus = currentComparisons.length > 1
      ? "ambiguous-existing-date-team-collision"
      : "existing-date-team-collision";
    canonicalInstruction = "Manually reconcile the same-date/team canonical collision";
    blockers.push("existing-canonical-collision");
  } else if (atlantaComparisons.length > 0 || bostonComparisons.length > 0) {
    const allPrior = [...atlantaComparisons, ...bostonComparisons];
    const semanticMatches = allPrior.filter((item) => item.classification === "semantic-reviewed-match");
    if (semanticMatches.length === 1) {
      candidateAction = "hold-for-shared-reviewed-source-reconciliation";
      duplicateGuardStatus = "shared-reviewed-semantic-match";
      canonicalInstruction = "Reconcile the unimported cross-team reviewed source before creating a canonical identity";
      blockers.push("shared-reviewed-source");
    } else {
      candidateAction = "hold-for-cross-team-source-reconciliation";
      duplicateGuardStatus = "cross-team-reviewed-date-team-collision";
      canonicalInstruction = "Resolve conflicting or duplicate Atlanta/Boston source perspectives before canonical creation";
      blockers.push("cross-team-source-collision");
    }
  } else if (recentOrProvisional) {
    candidateAction = "hold-new-canonical-provisional";
    duplicateGuardStatus = "recent-outcome-provisional-hold";
    canonicalInstruction = "Keep the recent or low-confidence transaction private and provisional";
    blockers.push("recent-or-provisional");
  } else {
    candidateAction = "create-new-canonical-preview";
    duplicateGuardStatus = "clear-new-candidate";
    canonicalInstruction = "New private canonical candidate";
  }

  const withinComparisons = withinRows.filter(
    (item) => item.leftTradeId === record.tradeId || item.rightTradeId === record.tradeId
  );

  const gradeMap = { [record.sourceTeam]: record.sourceTeamGrade };
  const aggregatePartnerGrade =
    record.partnerTeams.length === 1 ? null : record.partnerAggregateGrade;
  if (record.partnerTeams.length === 1) gradeMap[record.partnerTeams[0]] = record.partnerAggregateGrade;

  const outputRecord = {
    sourceTradeId: record.tradeId,
    sourceBatchId: reviewed.batchId,
    sourceTeam: record.sourceTeam,
    tradeDate: record.tradeDate,
    seasonLabel: seasonLabel(record.tradeDate),
    teams: record.teams,
    partnerTeams: record.partnerTeams,
    declaredTeamCount: record.declaredTeamCount,
    dateTeamsKey: comparable.dateTeamsKey,
    sourcePerspectiveKey: comparable.sourcePerspectiveKey,
    transactionFingerprint: comparable.transactionFingerprint,
    provisionalCanonicalKey: comparable.provisionalCanonicalKey,
    provisionalCanonicalId: comparable.provisionalCanonicalId,
    candidateAction,
    duplicateGuardStatus,
    existingCanonicalMatch,
    atlantaSourceMatches: atlantaComparisons.map((item) => item.sourceTradeId),
    bostonSourceMatches: bostonComparisons.map((item) => item.sourceTradeId),
    canonicalDisposition: record.canonicalDisposition,
    canonicalInstruction,
    assetsReceived,
    assetsSent,
    assetLedger,
    unclassifiedAssetCount,
    summary: record.summary,
    analysis: record.analysis,
    verdict: record.verdict,
    grades: gradeMap,
    aggregatePartnerGrade,
    confidence: record.confidence,
    tier: record.tier,
    reviewStatus: record.reviewStatus,
    publishStatus: "private",
    indexEligible: false,
    adEligible: false,
    publicationReady: false,
    canonicalCreateReady: candidateAction === "create-new-canonical-preview",
    perspectiveReconciliationReady: candidateAction === "add-nets-perspective-to-existing-canonical-preview",
    automaticMerge: false,
    blockers,
    dataQualityFlags: record.dataQualityFlags,
    currentCanonicalComparisons: currentComparisons,
    atlantaReviewedComparisons: atlantaComparisons,
    bostonReviewedComparisons: bostonComparisons,
    withinNetsComparisons: withinComparisons,
  };
  records.push(outputRecord);

  if (blockers.length) {
    blockerRows.push({
      sourceTradeId: record.tradeId,
      tradeDate: record.tradeDate,
      candidateAction,
      duplicateGuardStatus,
      blockers: blockers.join(" | "),
      currentCanonicalCandidates: currentComparisons.map((item) => item.canonicalId).join(" | "),
      atlantaReviewedCandidates: atlantaComparisons.map((item) => item.sourceTradeId).join(" | "),
      bostonReviewedCandidates: bostonComparisons.map((item) => item.sourceTradeId).join(" | "),
      routingRequired: record.routingRequired,
      confidence: record.confidence,
      verdict: record.verdict,
    });
  }
}

const crossTeamRequired = records.filter(
  (record) => record.canonicalDisposition.includes("overlap-candidate") ||
    clean(reviewed.records.find((item) => item.tradeId === record.sourceTradeId)?.sharedLineage)
);
const unmatchedCrossTeamRequired = crossTeamRequired.filter(
  (record) => record.atlantaSourceMatches.length === 0 && record.bostonSourceMatches.length === 0
);

const actionCounts = countBy(records.map((record) => record.candidateAction));
const duplicateGuardCounts = countBy(records.map((record) => record.duplicateGuardStatus));
const counts = {
  sourceRows: records.length,
  standalonePreviewRows: records.filter((record) => !nonStandalone.has(record.canonicalDisposition)).length,
  nonStandaloneRows: records.filter((record) => nonStandalone.has(record.canonicalDisposition)).length,
  clearNewCanonicalPreviews: actionCounts["create-new-canonical-preview"] ?? 0,
  existingCanonicalPerspectiveRecommendations:
    actionCounts["add-nets-perspective-to-existing-canonical-preview"] ?? 0,
  currentCanonicalProvisionalHolds: actionCounts["hold-existing-canonical-provisional"] ?? 0,
  sharedReviewedHolds:
    (actionCounts["hold-for-shared-reviewed-source-reconciliation"] ?? 0) +
    (actionCounts["hold-for-cross-team-source-reconciliation"] ?? 0),
  canonicalCreateReady: records.filter((record) => record.canonicalCreateReady).length,
  perspectiveReconciliationReady: records.filter((record) => record.perspectiveReconciliationReady).length,
  canonicalDataBlocked: records.filter(
    (record) => !record.canonicalCreateReady && !record.perspectiveReconciliationReady &&
      !nonStandalone.has(record.canonicalDisposition)
  ).length,
  typedAssetTotal: records.reduce((sum, record) => sum + record.assetLedger.length, 0),
  unclassifiedAssetCount: records.reduce((sum, record) => sum + record.unclassifiedAssetCount, 0),
  partnerReferences: records.reduce((sum, record) => sum + record.partnerTeams.length, 0),
  resolverReferences,
  fallbackReferences,
  currentComparisonRows: currentRows.length,
  currentMatchedSourceRows: records.filter((record) => record.currentCanonicalComparisons.length > 0).length,
  ambiguousCurrentMatchRows: records.filter((record) => record.currentCanonicalComparisons.length > 1).length,
  atlantaComparisonRows: atlantaRows.length,
  atlantaMatchedSourceRows: records.filter((record) => record.atlantaReviewedComparisons.length > 0).length,
  bostonComparisonRows: bostonRows.length,
  bostonMatchedSourceRows: records.filter((record) => record.bostonReviewedComparisons.length > 0).length,
  crossTeamRequiredRows: crossTeamRequired.length,
  unmatchedCrossTeamRequiredRows: unmatchedCrossTeamRequired.length,
  withinNetsComparisonPairs: withinRows.length,
  blockerRows: blockerRows.length,
  routingRequiredRows: records.filter((record) => record.declaredTeamCount > 2).length,
};

assert(counts.sourceRows === 251, "Source-row count drifted.");
assert(counts.standalonePreviewRows === 243, "Standalone-row count drifted.");
assert(counts.nonStandaloneRows === 8, "Non-standalone row count drifted.");
assert(counts.partnerReferences === 278, "Partner-reference count drifted.");
assert(counts.resolverReferences === 218, "Resolver-backed Nets reference count drifted.");
assert(counts.fallbackReferences === 60, "Fallback Nets reference count drifted.");
assert(counts.currentMatchedSourceRows === 12, "Current canonical source-match count drifted.");
assert(counts.ambiguousCurrentMatchRows === 0, "Unexpected ambiguous current canonical match.");
assert(counts.atlantaMatchedSourceRows === 11, "Atlanta reviewed source-match count drifted.");
assert(counts.bostonMatchedSourceRows === 7, "Boston reviewed source-match count drifted.");
assert(counts.crossTeamRequiredRows === 17, "Cross-team required count drifted.");
assert(counts.unmatchedCrossTeamRequiredRows === 0, "A required cross-team row is unmatched.");
assert(counts.routingRequiredRows === 17, "Routing-required count drifted.");
assert(new Set(records.map((record) => record.sourceTradeId)).size === 251, "Duplicate source trade IDs.");
assert(new Set(currentTargetRecommendations).size === currentTargetRecommendations.length, "Duplicate perspective target recommended.");

const previewRecordsSha256 = sha256(stable(records));
const result = {
  result: "PASS",
  phase: "5B",
  mode: "DUPLICATE_SAFE_BROOKLYN_NETS_CANONICAL_AND_CROSS_TEAM_PREVIEW",
  batchId: reviewed.batchId,
  counts,
  actionCounts,
  duplicateGuardCounts,
  typedAssetCounts: Object.fromEntries(Object.entries(typedAssetCounts).sort(([left], [right]) => left.localeCompare(right))),
  unmatchedCrossTeamTradeIds: unmatchedCrossTeamRequired.map((record) => record.sourceTradeId),
  duplicatePerspectiveTargets: currentTargetRecommendations.filter(
    (value, index, values) => values.indexOf(value) !== index
  ),
  hashes: {
    reviewedBatchSha256: sha256(reviewedBytes),
    canonicalStoreSha256: sha256(tradesBytes),
    teamRegistrySha256: sha256(teamsBytes),
    lineageRulesSha256: sha256(lineageBytes),
    atlantaReviewedBatchSha256: sha256(atlantaBytes),
    bostonReviewedBatchSha256: sha256(bostonBytes),
    previewRecordsSha256,
  },
  automaticMerges: 0,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  teamRegistryWrites: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
  records,
};

const candidateRows = records.map((record) => ({
  sourceTradeId: record.sourceTradeId,
  tradeDate: record.tradeDate,
  teams: record.teams.join(" | "),
  candidateAction: record.candidateAction,
  duplicateGuardStatus: record.duplicateGuardStatus,
  existingCanonicalMatch: record.existingCanonicalMatch ?? "",
  atlantaSourceMatches: record.atlantaSourceMatches.join(" | "),
  bostonSourceMatches: record.bostonSourceMatches.join(" | "),
  canonicalCreateReady: record.canonicalCreateReady,
  perspectiveReconciliationReady: record.perspectiveReconciliationReady,
  unclassifiedAssetCount: record.unclassifiedAssetCount,
  blockers: record.blockers.join(" | "),
  confidence: record.confidence,
  verdict: record.verdict,
}));

const previewPath = path.join(outputDir, "brooklyn-nets-phase-5b-canonical-preview.json");
await Promise.all([
  writeFile(previewPath, JSON.stringify(result, null, 2) + "\n", "utf8"),
  writeFile(
    path.join(outputDir, "brooklyn-nets-phase-5b-candidate-preview.csv"),
    toCsv(candidateRows),
    "utf8"
  ),
  writeFile(
    path.join(outputDir, "brooklyn-nets-phase-5b-current-canonical-matches.csv"),
    toCsv(currentRows, [
      "sourceTradeId", "tradeDate", "dateTeamsKey", "canonicalId", "classification",
      "exactSourceAssets", "exactPartnerAssets", "sourceSimilarity", "partnerSimilarity",
      "similarity", "automaticMergeAuthorized",
    ]),
    "utf8"
  ),
  writeFile(
    path.join(outputDir, "brooklyn-nets-phase-5b-atlanta-overlap-matches.csv"),
    toCsv(atlantaRows, [
      "sourceTradeId", "tradeDate", "dateTeamsKey", "reviewedTradeId", "classification",
      "similarity", "canonicalDisposition", "automaticMergeAuthorized",
    ]),
    "utf8"
  ),
  writeFile(
    path.join(outputDir, "brooklyn-nets-phase-5b-boston-overlap-matches.csv"),
    toCsv(bostonRows, [
      "sourceTradeId", "tradeDate", "dateTeamsKey", "reviewedTradeId", "classification",
      "similarity", "canonicalDisposition", "automaticMergeAuthorized",
    ]),
    "utf8"
  ),
  writeFile(
    path.join(outputDir, "brooklyn-nets-phase-5b-within-nets-duplicate-audit.csv"),
    toCsv(withinRows, [
      "dateTeamsKey", "leftTradeId", "rightTradeId", "similarity", "exactAssetSet",
      "leftDisposition", "rightDisposition", "automaticMergeAuthorized",
    ]),
    "utf8"
  ),
  writeFile(
    path.join(outputDir, "brooklyn-nets-phase-5b-blockers.csv"),
    toCsv(blockerRows, [
      "sourceTradeId", "tradeDate", "candidateAction", "duplicateGuardStatus", "blockers",
      "currentCanonicalCandidates", "atlantaReviewedCandidates", "bostonReviewedCandidates",
      "routingRequired", "confidence", "verdict",
    ]),
    "utf8"
  ),
]);

console.log(JSON.stringify({
  result: result.result,
  phase: result.phase,
  mode: result.mode,
  counts: result.counts,
  actionCounts: result.actionCounts,
  duplicateGuardCounts: result.duplicateGuardCounts,
  typedAssetCounts: result.typedAssetCounts,
  unmatchedCrossTeamTradeIds: result.unmatchedCrossTeamTradeIds,
  hashes: result.hashes,
  automaticMerges: 0,
  canonicalImports: 0,
  playerImports: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  teamRegistryWrites: 0,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
