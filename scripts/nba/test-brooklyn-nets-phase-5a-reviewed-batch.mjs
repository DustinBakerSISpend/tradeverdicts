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
  "players-json",
  "atlanta-reviewed-json",
  "boston-reviewed-json",
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
const resolver = createHistoricalNbaTeamResolver({ teams, lineage });

assert(reviewed.schemaVersion === 1, "Unexpected Nets reviewed schema version.");
assert(reviewed.batchId === "brooklyn-nets-phase-5a", "Unexpected Nets batch ID.");
assert(reviewed.sourceTeam === "brooklyn-nets", "Unexpected Nets source-team slug.");
assert(reviewed.phase === "5A", "Unexpected Nets reviewed phase.");
assert(Array.isArray(reviewed.records), "Reviewed Nets records are not an array.");
assert(Array.isArray(teams), "Team registry is not an array.");
assert(Array.isArray(trades), "Canonical trade store is not an array.");
assert(Array.isArray(players), "Player store is not an array.");
assert(Array.isArray(atlanta.records), "Atlanta reviewed batch is unavailable.");
assert(Array.isArray(boston.records), "Boston reviewed batch is unavailable.");
assert(sha256(workbookBytes) === reviewed.sourceWorkbook.sha256, "Nets workbook hash mismatch.");
assert(sha256(rawBytes) === reviewed.rawSource.sha256, "Nets raw-source hash mismatch.");

const records = reviewed.records;
assert(records.length === 251, `Expected 251 Nets rows, found ${records.length}.`);
assert(new Set(records.map((record) => record.tradeId)).size === records.length, "Duplicate Nets trade IDs found.");
assert(records.every((record) => record.sourceTeam === "brooklyn-nets"), "Source-team drift found.");
assert(records.every((record) => record.tradeDate && /^\d{4}-\d{2}-\d{2}$/u.test(record.tradeDate)), "Invalid trade date found.");
assert(records.every((record) => record.summary && record.analysis), "Blank public summary or analysis found.");
assert(records.every((record) => record.publishStatus.startsWith("Hold - ")), "A Nets row escaped the hold gate.");
assert(records.every((record) => record.slug), "Blank slug found.");
assert(records.every((record) => Array.isArray(record.partnerLabels) && record.partnerLabels.length > 0), "Blank partner labels found.");
assert(records.every((record) => record.declaredTeamCount === record.partnerLabels.length + 1), "Declared team count mismatch.");
assert(records.every((record) => Array.isArray(record.dataQualityFlags)), "Data-quality flags are not normalized arrays.");

const dates = records.map((record) => record.tradeDate);
assert(stable(dates) === stable([...dates].sort()), "Nets rows are not chronological.");

const forbiddenPublicText = /User-supplied|Preliminary\s*-\s*Ready|Meta\/Grok Audit|unresolved asset detail|Confirm source wording|\(\?-\?\)/iu;
for (const record of records) {
  assert(!forbiddenPublicText.test(record.summary), `${record.tradeId}: internal phrase remains in summary.`);
  assert(!forbiddenPublicText.test(record.analysis), `${record.tradeId}: internal phrase remains in analysis.`);
}

const expectedVerdicts = {
  "Nets Win": 44,
  "Slight Nets Edge": 45,
  "Even Trade": 46,
  "Slight Partner Edge": 45,
  "Partner Win": 42,
  "Insufficient Evidence": 21,
  "Follow-up Resolution": 5,
  "Duplicate Source Variant": 2,
  "Voided / Rescinded": 1,
};
assert(stable(countBy(records.map((record) => record.verdict))) === stable(expectedVerdicts), "Final Nets verdict accounting drifted.");

const expectedDispositions = {
  "new-candidate": 226,
  "atlanta-overlap-candidate": 9,
  "boston-overlap-candidate": 6,
  "atlanta-boston-overlap-candidate": 1,
  "merge-followup": 5,
  "exclude-duplicate": 2,
  "hold-research": 1,
  "retain-void-history": 1,
};
assert(
  stable(countBy(records.map((record) => record.canonicalDisposition))) === stable(expectedDispositions),
  "Canonical disposition accounting drifted.",
);

assert(records.filter((record) => record.declaredTeamCount === 2).length === 234, "Two-team row count drifted.");
assert(records.filter((record) => record.declaredTeamCount > 2).length === 17, "Multi-team row count drifted.");
assert(records.reduce((sum, record) => sum + record.partnerLabels.length, 0) === 278, "Partner-reference count drifted.");
assert(records.filter((record) => record.routingRequired).length === 17, "Routing-required count drifted.");
assert(records.filter((record) => record.sharedLineage).length === 17, "Shared-lineage flag count drifted.");
assert(records.filter((record) => record.verdict === "Insufficient Evidence").length === 21, "Insufficient-evidence count drifted.");

const adminDispositions = new Set(["merge-followup", "exclude-duplicate", "retain-void-history"]);
assert(records.filter((record) => adminDispositions.has(record.canonicalDisposition)).length === 8, "Administrative row count drifted.");

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
    const fallback = normalizeFallback(label, record.tradeDate);
    if (fallback) {
      fallbackReferences += 1;
      continue;
    }
    unresolvedLabels.push({ tradeId: record.tradeId, tradeDate: record.tradeDate, label });
  }
}
assert(unresolvedLabels.length === 0, `Unresolved Nets partner labels: ${JSON.stringify(unresolvedLabels.slice(0, 20))}.`);
assert(resolverReferences + fallbackReferences === 278, "Resolved/fallback partner accounting drifted.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "5A",
  mode: "REVIEWED_INTAKE_VALIDATION",
  reviewedRows: records.length,
  twoTeamRows: 234,
  multiTeamRows: 17,
  partnerReferences: 278,
  resolverReferences,
  fallbackReferences,
  registeredTeams: teams.length,
  defunctTeams: teams.filter((team) => team.active === false).length,
  newCanonicalCandidateFlags: 226,
  atlantaOverlapCandidates: 9,
  bostonOverlapCandidates: 6,
  atlantaBostonOverlapCandidates: 1,
  mergeOrExclude: 8,
  insufficientEvidence: 21,
  routingRequiredRows: 17,
  currentCanonicalTrades: trades.length,
  currentPlayers: players.length,
  repositoryWrites: false,
  canonicalImports: 0,
  playerImports: 0,
  automaticMerges: 0,
}, null, 2));
