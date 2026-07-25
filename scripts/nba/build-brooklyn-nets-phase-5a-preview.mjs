#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function toCsv(rows) {
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((key) => csv(row[key])).join(","))].join("\r\n") + "\r\n";
}
function teamKey(date, teams) {
  return `${date}|${[...new Set(teams)].sort().join("|")}`;
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
    if (tradeDate >= "1968-07-01" && tradeDate < "1969-07-01") return "minnesota-pipers";
    return "pittsburgh-condors";
  }
  if (label === "Stars (ABA)") {
    return tradeDate < "1970-06-01" ? "los-angeles-stars" : "utah-stars";
  }
  return exact[label] ?? "";
}

const args = parseArgs(process.argv);
for (const required of [
  "reviewed-json",
  "teams-json",
  "lineage-json",
  "trades-json",
  "atlanta-reviewed-json",
  "boston-reviewed-json",
  "output-dir",
]) assert(args[required], `Missing --${required}`);

const [reviewedBytes, teamsBytes, lineageBytes, tradesBytes, atlantaBytes, bostonBytes] =
  await Promise.all([
    readFile(args["reviewed-json"]),
    readFile(args["teams-json"]),
    readFile(args["lineage-json"]),
    readFile(args["trades-json"]),
    readFile(args["atlanta-reviewed-json"]),
    readFile(args["boston-reviewed-json"]),
  ]);

const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const teams = JSON.parse(teamsBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));
const boston = JSON.parse(bostonBytes.toString("utf8"));
const resolver = createHistoricalNbaTeamResolver({ teams, lineage });
const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

function resolveLabel(label, tradeDate) {
  let result = null;
  try {
    result = resolver.resolve(label, tradeDate);
  } catch {
    result = null;
  }
  if (result?.team?.slug) {
    return {
      slug: result.team.slug,
      teamName: result.team.name,
      active: result.team.active,
      status: result.status,
      ruleId: result.rule?.id ?? "",
      lineageKind: result.rule?.lineageKind ?? "registry",
      usedFallback: false,
    };
  }
  const fallback = normalizeFallback(label, tradeDate);
  assert(fallback, `Unresolved partner label ${label} on ${tradeDate}.`);
  return {
    slug: fallback,
    teamName: label,
    active: "",
    status: "phase-5a-fallback",
    ruleId: "",
    lineageKind: "phase-5a-fallback",
    usedFallback: true,
  };
}
function dateFor(item) {
  return item.tradeDate ?? item.date ?? "";
}
function sourceTeamFor(item, fallback) {
  return item.sourceTeam ?? item.primaryTeam ?? fallback;
}
function labelsFor(item) {
  if (Array.isArray(item.partnerLabels)) return item.partnerLabels;
  if (Array.isArray(item.partnerTeams)) return item.partnerTeams;
  if (typeof item.partnerTeam === "string") return [item.partnerTeam];
  return [];
}
function resolvedTeamsFor(item, fallbackSourceTeam) {
  const tradeDate = dateFor(item);
  const source = sourceTeamFor(item, fallbackSourceTeam);
  const partners = labelsFor(item).map((label) => {
    if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(label)) return label;
    return resolveLabel(label, tradeDate).slug;
  });
  return [source, ...partners];
}

const currentByKey = new Map();
for (const trade of trades) {
  const date = dateFor(trade);
  const teamsForTrade = Array.isArray(trade.teams) ? trade.teams : [];
  if (!date || teamsForTrade.length < 2) continue;
  const key = teamKey(date, teamsForTrade);
  if (!currentByKey.has(key)) currentByKey.set(key, []);
  currentByKey.get(key).push(trade);
}

const priorByKey = new Map();
for (const [batchName, batch, fallbackSourceTeam] of [
  ["atlanta", atlanta, "atlanta-hawks"],
  ["boston", boston, "boston-celtics"],
]) {
  for (const record of batch.records ?? []) {
    const date = dateFor(record);
    if (!date) continue;
    const key = teamKey(date, resolvedTeamsFor(record, fallbackSourceTeam));
    if (!priorByKey.has(key)) priorByKey.set(key, []);
    priorByKey.get(key).push({
      batchName,
      tradeId: record.tradeId ?? record.id ?? "",
      disposition: record.canonicalDisposition ?? "",
    });
  }
}

const queue = [];
const matchRows = [];
const teamRows = [];
const routingRows = [];
let resolverReferences = 0;
let fallbackReferences = 0;
let potentialCurrentCanonicalMatchRows = 0;
let ambiguousCurrentMatchRows = 0;
let exactAtlantaReviewedMatchRows = 0;
let exactBostonReviewedMatchRows = 0;
let crossTeamRequiredRows = 0;
let unmatchedCrossTeamRequiredRows = 0;

const administrative = new Set(["merge-followup", "exclude-duplicate", "retain-void-history"]);
for (const record of reviewed.records) {
  const resolutions = record.partnerLabels.map((label) => {
    const resolved = resolveLabel(label, record.tradeDate);
    if (resolved.usedFallback) fallbackReferences += 1;
    else resolverReferences += 1;
    teamRows.push({
      tradeId: record.tradeId,
      tradeDate: record.tradeDate,
      sourceLabel: label,
      resolvedTeam: resolved.slug,
      teamName: resolved.teamName,
      active: resolved.active,
      resolutionStatus: resolved.status,
      lineageKind: resolved.lineageKind,
      ruleId: resolved.ruleId,
      phase5aFallback: resolved.usedFallback,
    });
    return resolved;
  });

  const resolvedTeamSlugs = ["brooklyn-nets", ...resolutions.map((item) => item.slug)];
  const key = teamKey(record.tradeDate, resolvedTeamSlugs);
  const currentMatches = currentByKey.get(key) ?? [];
  const priorMatches = priorByKey.get(key) ?? [];
  const atlantaMatches = priorMatches.filter((item) => item.batchName === "atlanta");
  const bostonMatches = priorMatches.filter((item) => item.batchName === "boston");

  if (currentMatches.length > 0) potentialCurrentCanonicalMatchRows += 1;
  if (currentMatches.length > 1) ambiguousCurrentMatchRows += 1;
  if (atlantaMatches.length > 0) exactAtlantaReviewedMatchRows += 1;
  if (bostonMatches.length > 0) exactBostonReviewedMatchRows += 1;

  const requiresCrossTeamMatch =
    record.canonicalDisposition.includes("overlap-candidate") || Boolean(record.sharedLineage);
  if (requiresCrossTeamMatch) {
    crossTeamRequiredRows += 1;
    if (currentMatches.length === 0 && priorMatches.length === 0) unmatchedCrossTeamRequiredRows += 1;
  }

  let previewAction = "new-canonical-preview";
  if (administrative.has(record.canonicalDisposition)) previewAction = record.canonicalDisposition;
  else if (record.canonicalDisposition === "hold-research") previewAction = "hold-research";
  else if (currentMatches.length > 0) previewAction = "potential-existing-canonical";
  else if (priorMatches.length > 0) previewAction = "shared-reviewed-hold";
  else if (requiresCrossTeamMatch) previewAction = "cross-team-match-unresolved";

  queue.push({
    tradeId: record.tradeId,
    tradeDate: record.tradeDate,
    partnerTeams: resolutions.map((item) => item.slug).join(" | "),
    teamCount: record.declaredTeamCount,
    sourceDisposition: record.canonicalDisposition,
    previewAction,
    currentCanonicalCandidates: currentMatches.map((trade) => trade.id).join(" | "),
    atlantaReviewedCandidates: atlantaMatches.map((item) => item.tradeId).join(" | "),
    bostonReviewedCandidates: bostonMatches.map((item) => item.tradeId).join(" | "),
    sourceTeamGrade: record.sourceTeamGrade,
    partnerAggregateGrade: record.partnerAggregateGrade,
    verdict: record.verdict,
    confidence: record.confidence,
    reviewStatus: record.reviewStatus,
    publishStatus: record.publishStatus,
    dataQualityFlags: record.dataQualityFlags.join(" | "),
  });

  if (currentMatches.length > 0 || priorMatches.length > 0 || requiresCrossTeamMatch) {
    matchRows.push({
      tradeId: record.tradeId,
      tradeDate: record.tradeDate,
      teams: resolvedTeamSlugs.join(" | "),
      sourceDisposition: record.canonicalDisposition,
      sharedLineage: record.sharedLineage,
      currentCanonicalCandidates: currentMatches.map((trade) => trade.id).join(" | "),
      currentCandidateCount: currentMatches.length,
      atlantaReviewedCandidates: atlantaMatches.map((item) => item.tradeId).join(" | "),
      atlantaCandidateCount: atlantaMatches.length,
      bostonReviewedCandidates: bostonMatches.map((item) => item.tradeId).join(" | "),
      bostonCandidateCount: bostonMatches.length,
      automaticMergeAuthorized: false,
    });
  }

  if (record.routingRequired) {
    routingRows.push({
      tradeId: record.tradeId,
      tradeDate: record.tradeDate,
      partnerTeams: resolutions.map((item) => item.slug).join(" | "),
      declaredTeamCount: record.declaredTeamCount,
      relationshipSourceNote: record.relationshipSourceNote,
      counterpartGradeNote: record.counterpartGradeNote,
      routingStatus: "hold-for-explicit-team-perspective-routing",
      automaticRoutingAuthorized: false,
    });
  }
}

assert(queue.length === 251, "Nets queue row count drifted.");
assert(teamRows.length === 278, "Nets team-resolution row count drifted.");
assert(routingRows.length === 17, "Nets routing queue count drifted.");

const candidatePath = path.join(outputDir, "brooklyn-nets-phase-5a-candidate-queue.csv");
const matchPath = path.join(outputDir, "brooklyn-nets-phase-5a-cross-team-match-preview.csv");
const teamPath = path.join(outputDir, "brooklyn-nets-phase-5a-team-resolution.csv");
const routingPath = path.join(outputDir, "brooklyn-nets-phase-5a-routing-queue.csv");
const previewPath = path.join(outputDir, "brooklyn-nets-phase-5a-preview.json");

await writeFile(candidatePath, toCsv(queue), "utf8");
await writeFile(matchPath, toCsv(matchRows.length ? matchRows : [{
  tradeId: "", tradeDate: "", teams: "", sourceDisposition: "", sharedLineage: "",
  currentCanonicalCandidates: "", currentCandidateCount: 0,
  atlantaReviewedCandidates: "", atlantaCandidateCount: 0,
  bostonReviewedCandidates: "", bostonCandidateCount: 0,
  automaticMergeAuthorized: false,
}]), "utf8");
await writeFile(teamPath, toCsv(teamRows), "utf8");
await writeFile(routingPath, toCsv(routingRows), "utf8");

const preview = {
  result: "PASS",
  phase: "5A",
  mode: "REVIEWED_INTAKE_AND_CROSS_TEAM_PREVIEW",
  batchId: reviewed.batchId,
  reviewedRows: reviewed.records.length,
  twoTeamRows: reviewed.counts.twoTeamRows,
  multiTeamRows: reviewed.counts.multiTeamRows,
  partnerReferences: teamRows.length,
  resolverReferences,
  fallbackReferences,
  newCanonicalCandidateFlags: reviewed.counts.newCanonicalCandidateFlags,
  atlantaOverlapCandidates: reviewed.counts.atlantaOverlapCandidates,
  bostonOverlapCandidates: reviewed.counts.bostonOverlapCandidates,
  atlantaBostonOverlapCandidates: reviewed.counts.atlantaBostonOverlapCandidates,
  mergeOrExclude: reviewed.counts.administrativeRows,
  insufficientEvidence: reviewed.counts.insufficientEvidence,
  routingRequiredRows: routingRows.length,
  crossTeamRequiredRows,
  unmatchedCrossTeamRequiredRows,
  potentialCurrentCanonicalMatchRows,
  ambiguousCurrentMatchRows,
  exactAtlantaReviewedMatchRows,
  exactBostonReviewedMatchRows,
  registeredTeams: teams.length,
  currentCanonicalTrades: trades.length,
  candidatePath,
  matchPath,
  teamPath,
  routingPath,
  previewPath,
  hashes: {
    reviewedBatchSha256: sha256(reviewedBytes),
    teamRegistrySha256: sha256(teamsBytes),
    lineageRulesSha256: sha256(lineageBytes),
    canonicalStoreSha256: sha256(tradesBytes),
  },
  automaticMerges: 0,
  automaticRoutes: 0,
  canonicalStoreWrites: 0,
  playerStoreWrites: 0,
  teamRegistryWrites: 0,
  routeWrites: 0,
  pushPerformed: false,
  deployPerformed: false,
};
await writeFile(previewPath, JSON.stringify(preview, null, 2) + "\n", "utf8");
console.log(JSON.stringify(preview, null, 2));
