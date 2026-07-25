#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createHistoricalNbaTeamResolver } from "../../src/lib/nba/resolve-historical-team.mjs";

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
function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}
function countBy(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return output;
}
function stable(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}
function normalizeFallback(label) {
  const exact = {
    "Atlanta Hawks": "atlanta-hawks",
    "Boston Celtics": "boston-celtics",
    "Brooklyn Nets": "brooklyn-nets",
    "Chicago Bulls": "chicago-bulls",
    "Cleveland Cavaliers": "cleveland-cavaliers",
    "Dallas Mavericks": "dallas-mavericks",
    "Denver Nuggets": "denver-nuggets",
    "Detroit Pistons": "detroit-pistons",
    "Golden State Warriors": "golden-state-warriors",
    "Houston Rockets": "houston-rockets",
    "Indiana Pacers": "indiana-pacers",
    "Los Angeles Clippers": "los-angeles-clippers",
    "Los Angeles Lakers": "los-angeles-lakers",
    "Memphis Grizzlies": "memphis-grizzlies",
    "Miami Heat": "miami-heat",
    "Milwaukee Bucks": "milwaukee-bucks",
    "Minnesota Timberwolves": "minnesota-timberwolves",
    "New Jersey Nets": "brooklyn-nets",
    "New Orleans Hornets": "new-orleans-pelicans",
    "New Orleans Pelicans": "new-orleans-pelicans",
    "New York Knicks": "new-york-knicks",
    "Oklahoma City Thunder": "oklahoma-city-thunder",
    "Orlando Magic": "orlando-magic",
    "Philadelphia 76ers": "philadelphia-76ers",
    "Phoenix Suns": "phoenix-suns",
    "Portland Trail Blazers": "portland-trail-blazers",
    "Sacramento Kings": "sacramento-kings",
    "San Antonio Spurs": "san-antonio-spurs",
    "Seattle SuperSonics": "oklahoma-city-thunder",
    "Utah Jazz": "utah-jazz",
    "Washington Bullets": "washington-wizards",
    "Washington Wizards": "washington-wizards",
  };
  return exact[label] ?? "";
}

const args = parseArgs(process.argv);
for (const required of [
  "reviewed-json",
  "teams-json",
  "lineage-json",
  "trades-json",
  "players-json",
  "atlanta-reviewed-json",
  "boston-reviewed-json",
  "brooklyn-reviewed-json",
  "raw-source",
  "workbook",
]) {
  assert(args[required], `Missing --${required}`);
}

const [
  reviewedBytes,
  teamsBytes,
  lineageBytes,
  tradesBytes,
  playersBytes,
  atlantaBytes,
  bostonBytes,
  brooklynBytes,
  rawBytes,
  workbookBytes,
] = await Promise.all([
  readFile(args["reviewed-json"]),
  readFile(args["teams-json"]),
  readFile(args["lineage-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["atlanta-reviewed-json"]),
  readFile(args["boston-reviewed-json"]),
  readFile(args["brooklyn-reviewed-json"]),
  readFile(args["raw-source"]),
  readFile(args.workbook),
]);

const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const teams = JSON.parse(teamsBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const trades = JSON.parse(tradesBytes.toString("utf8"));
const players = JSON.parse(playersBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));
const boston = JSON.parse(bostonBytes.toString("utf8"));
const brooklyn = JSON.parse(brooklynBytes.toString("utf8"));
const resolver = createHistoricalNbaTeamResolver({ teams, lineage });

assert(reviewed.schemaVersion === 1, "Unexpected Charlotte reviewed schema version.");
assert(reviewed.batchId === "charlotte-hornets-phase-6a", "Unexpected Charlotte batch ID.");
assert(reviewed.sourceTeam === "charlotte-hornets", "Unexpected Charlotte source-team slug.");
assert(reviewed.phase === "6A", "Unexpected Charlotte reviewed phase.");
assert(Array.isArray(reviewed.records), "Reviewed Charlotte records are not an array.");
assert(Array.isArray(teams), "Team registry is not an array.");
assert(Array.isArray(trades), "Canonical trade store is not an array.");
assert(Array.isArray(players), "Player store is not an array.");
assert(Array.isArray(atlanta.records), "Atlanta reviewed batch is unavailable.");
assert(Array.isArray(boston.records), "Boston reviewed batch is unavailable.");
assert(Array.isArray(brooklyn.records), "Brooklyn reviewed batch is unavailable.");
assert(sha256(workbookBytes) === reviewed.sourceWorkbook.sha256, "Charlotte workbook hash mismatch.");
assert(sha256(rawBytes) === reviewed.rawSource.sha256, "Charlotte raw-source hash mismatch.");

const records = reviewed.records;
assert(records.length === 125, `Expected 125 Charlotte rows, found ${records.length}.`);
assert(new Set(records.map((record) => record.tradeId)).size === records.length, "Duplicate Charlotte trade IDs found.");
assert(records.every((record) => record.sourceTeam === "charlotte-hornets"), "Source-team drift found.");
assert(records.every((record) => record.tradeDate && /^\d{4}-\d{2}-\d{2}$/u.test(record.tradeDate)), "Invalid trade date found.");
assert(records.every((record) => record.summary && record.analysis), "Blank public summary or analysis found.");
assert(records.every((record) => record.publishStatus.startsWith("Hold - ")), "A Charlotte row escaped the hold gate.");
assert(records.every((record) => record.slug), "Blank slug found.");
assert(records.every((record) => Array.isArray(record.partnerLabels) && record.partnerLabels.length > 0), "Blank partner labels found.");
assert(records.every((record) => record.declaredTeamCount === record.partnerLabels.length + 1), "Declared team count mismatch.");
assert(records.every((record) => Array.isArray(record.dataQualityFlags)), "Data-quality flags are not normalized arrays.");
assert(records.every((record) => record.distinctivePublicAngle), "Blank public-angle field found.");
assert(records.every((record) => record.researchNeeded), "Blank research-needed field found.");

const dates = records.map((record) => record.tradeDate);
assert(stable(dates) === stable([...dates].sort()), "Charlotte rows are not chronological.");

const forbiddenPublicText = /User-supplied|Preliminary\s*-\s*Ready|Meta\/Grok Audit|unresolved asset detail|Confirm source wording|outcome pending|\(\?-\?\)/iu;
for (const record of records) {
  assert(!forbiddenPublicText.test(record.summary), `${record.tradeId}: internal phrase remains in summary.`);
  assert(!forbiddenPublicText.test(record.analysis), `${record.tradeId}: internal phrase remains in analysis.`);
  assert(record.summary.length >= 60, `${record.tradeId}: summary is too thin.`);
  assert(record.analysis.length >= 100, `${record.tradeId}: analysis is too thin.`);
}
assert(new Set(records.map((record) => record.summary)).size === records.length, "Duplicate public summaries found.");
assert(new Set(records.map((record) => record.analysis)).size === records.length, "Duplicate public analyses found.");

const expectedVerdicts = {
  "Charlotte Win": 19,
  "Slight Charlotte Edge": 27,
  "Even Trade": 27,
  "Slight Partner Edge": 20,
  "Partner Win": 21,
  "Insufficient Evidence": 9,
  "Follow-up Resolution": 2,
};
assert(stable(countBy(records.map((record) => record.verdict))) === stable(expectedVerdicts), "Final Charlotte verdict accounting drifted.");

const expectedDispositions = {
  "new-candidate": 110,
  "atlanta-overlap-candidate": 3,
  "boston-overlap-candidate": 4,
  "brooklyn-overlap-candidate": 6,
  "merge-followup": 2,
};
assert(
  stable(countBy(records.map((record) => record.canonicalDisposition))) === stable(expectedDispositions),
  "Canonical disposition accounting drifted.",
);

const expectedContent = {
  "Public Candidate": 45,
  "Research Before Public": 36,
  "Private / Noindex Archive": 42,
  "Merge / Exclude": 2,
};
assert(
  stable(countBy(records.map((record) => record.contentClass))) === stable(expectedContent),
  "Content-class accounting drifted.",
);
assert(records.filter((record) => record.contentClass === "Public Candidate").every((record) => record.lowValueRisk === "Low"), "Public-candidate low-value risk drifted.");
assert(records.filter((record) => record.contentClass === "Research Before Public").every((record) => record.lowValueRisk === "Medium"), "Research-before-public risk drifted.");
assert(records.filter((record) => record.contentClass === "Private / Noindex Archive").every((record) => record.lowValueRisk === "High"), "Private-archive risk drifted.");

assert(records.filter((record) => record.declaredTeamCount === 2).length === 115, "Two-team row count drifted.");
assert(records.filter((record) => record.declaredTeamCount > 2).length === 10, "Multi-team row count drifted.");
assert(records.reduce((sum, record) => sum + record.partnerLabels.length, 0) === 140, "Partner-reference count drifted.");
assert(records.filter((record) => record.routingRequired).length === 10, "Routing-required count drifted.");
assert(records.filter((record) => record.sharedLineage).length === 13, "Shared-lineage count drifted.");
assert(records.filter((record) => record.verdict === "Insufficient Evidence").length === 9, "Insufficient-evidence count drifted.");
assert(records.filter((record) => record.verdict === "Follow-up Resolution").length === 2, "Administrative count drifted.");
assert(records.filter((record) => record.routingRequired).every((record) =>
  record.counterpartGradeNote.startsWith("Aggregate counterpart grade pending individual team perspectives.")
), "A multi-team row lacks the aggregate counterpart disclaimer.");

let resolverReferences = 0;
let fallbackReferences = 0;
const unresolvedLabels = [];
for (const record of records) {
  for (const label of record.partnerLabels) {
    let result = null;
    try {
      result = resolver.resolve(label, record.tradeDate);
    } catch {
      result = null;
    }
    if (result?.team?.slug) {
      resolverReferences += 1;
      continue;
    }
    const fallback = normalizeFallback(label);
    if (fallback) {
      fallbackReferences += 1;
      continue;
    }
    unresolvedLabels.push({ tradeId: record.tradeId, tradeDate: record.tradeDate, label });
  }
}
assert(unresolvedLabels.length === 0, `Unresolved Charlotte partner labels: ${JSON.stringify(unresolvedLabels.slice(0, 20))}.`);
assert(resolverReferences + fallbackReferences === 140, "Resolved/fallback partner accounting drifted.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "6A",
  mode: "REVIEWED_INTAKE_VALIDATION",
  reviewedRows: records.length,
  twoTeamRows: 115,
  multiTeamRows: 10,
  partnerReferences: 140,
  resolverReferences,
  fallbackReferences,
  registeredTeams: teams.length,
  newCanonicalCandidateFlags: 110,
  atlantaOverlapCandidates: 3,
  bostonOverlapCandidates: 4,
  brooklynOverlapCandidates: 6,
  mergeOrExclude: 2,
  insufficientEvidence: 9,
  routingRequiredRows: 10,
  publicCandidateRows: 45,
  researchBeforePublicRows: 36,
  privateArchiveRows: 42,
  highImpactCallsPreserved: 16,
  currentCanonicalTrades: trades.length,
  currentPlayers: players.length,
  repositoryWrites: false,
  canonicalImports: 0,
  playerImports: 0,
  automaticMerges: 0,
}, null, 2));
