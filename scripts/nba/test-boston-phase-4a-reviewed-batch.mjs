#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createHistoricalNbaTeamResolver } from "../../src/lib/nba/resolve-historical-team.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument near ${key}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(value, message) { if (!value) throw new Error(message); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function countBy(values, key) {
  const result = {};
  for (const value of values) {
    const current = String(value[key] ?? "");
    result[current] = (result[current] ?? 0) + 1;
  }
  return result;
}

const args = parseArgs(process.argv);
for (const required of [
  "reviewed-json", "teams-json", "lineage-json", "trades-json", "players-json",
  "atlanta-reviewed-json", "raw-source", "workbook",
]) assert(args[required], `Missing --${required}`);

const [
  reviewedBytes, teamBytes, lineageBytes, tradeBytes, playerBytes,
  atlantaBytes, rawBytes, workbookBytes,
] = await Promise.all([
  readFile(args["reviewed-json"]),
  readFile(args["teams-json"]),
  readFile(args["lineage-json"]),
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["atlanta-reviewed-json"]),
  readFile(args["raw-source"]),
  readFile(args.workbook),
]);

const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const atlanta = JSON.parse(atlantaBytes.toString("utf8"));
const resolver = createHistoricalNbaTeamResolver({ teams, lineage });

assert(reviewed.schemaVersion === 1, "Unexpected reviewed-batch schema version.");
assert(reviewed.batchId === "boston-celtics-phase-4a", "Unexpected batch ID.");
assert(reviewed.sourceTeam === "boston-celtics", "Unexpected source team.");
assert(reviewed.review.importAuthorized === false, "Import must remain unauthorized.");
assert(reviewed.review.publicationAuthorized === false, "Publication must remain unauthorized.");
assert(sha256(workbookBytes) === reviewed.sourceWorkbook.sha256, "Workbook hash mismatch.");
assert(sha256(rawBytes) === reviewed.rawSource.sha256, "Raw-source hash mismatch.");
const rawText = rawBytes.toString("utf8");
assert(rawText.endsWith("\n"), "Raw-source snapshot must end with one newline.");
assert(!rawText.endsWith("\n\n"), "Raw-source snapshot has a blank line at EOF.");
assert(!/[ \t]+$/mu.test(rawText), "Raw-source snapshot contains trailing line whitespace.");

const records = reviewed.records;
assert(Array.isArray(records) && records.length === 223, "Expected 223 reviewed records.");
assert(new Set(records.map((record) => record.tradeId)).size === 223, "Trade IDs are not unique.");
assert(reviewed.dateEncoding === "ISO-8601 calendar date", "Reviewed date encoding contract is missing.");
assert(reviewed.teamResolutionRecomputedAfterDateNormalization === true, "Team resolution was not recomputed after date normalization.");
assert(records[0].tradeDate === "1946-12-12", `Unexpected first trade date: ${records[0].tradeDate}`);
assert(records.at(-1).tradeDate === "2026-07-06", `Unexpected final trade date: ${records.at(-1).tradeDate}`);
assert(teams.length === 41, "Expected 41 registered teams.");
assert(teams.filter((team) => team.active === true).length === 30, "Expected 30 active teams.");
assert(teams.filter((team) => team.active === false).length === 11, "Expected 11 defunct teams.");
assert(trades.length === 256, "Canonical store must remain at 256 trades.");
assert(players.length === 509, "Player store must remain at 509 records.");
assert(!trades.some((trade) => trade.sourceTeams?.includes("boston-celtics")), "Boston was already imported unexpectedly.");
assert(atlanta.batchId === "atlanta-hawks-phase-3a", "Atlanta reviewed batch is missing.");

const expectedCounts = {
  rows: 223,
  twoTeamRows: 205,
  multiTeamRows: 18,
  partnerReferences: 244,
  newCanonicalCandidateFlags: 197,
  atlantaOverlapCandidates: 14,
  mergeFollowups: 7,
  voidOrReversalRows: 3,
  duplicateVariants: 1,
  dataConflicts: 1,
  insufficientEvidence: 3,
  publicCandidates: 75,
  researchBeforePublic: 90,
  privateNoindexArchive: 46,
  mergeOrExclude: 12,
};
for (const [key, expected] of Object.entries(expectedCounts)) {
  assert(reviewed.counts[key] === expected, `${key}: expected ${expected}, found ${reviewed.counts[key]}`);
}

const expectedVerdicts = {
  "Celtics Win": 51,
  "Slight Celtics Edge": 53,
  "Even Trade": 52,
  "Slight Partner Edge": 22,
  "Partner Win": 30,
  "Insufficient Evidence": 3,
  "Follow-up Resolution": 7,
  "Voided / Rescinded": 3,
  "Duplicate Source Variant": 1,
  "Data Conflict": 1,
};
const actualVerdicts = countBy(records, "verdict");
for (const [verdict, expected] of Object.entries(expectedVerdicts)) {
  assert(actualVerdicts[verdict] === expected, `${verdict}: expected ${expected}, found ${actualVerdicts[verdict] ?? 0}.`);
}
assert(Object.keys(actualVerdicts).length === Object.keys(expectedVerdicts).length, "Unexpected verdict category.");

const expectedDispositions = {
  "new-candidate": 170,
  "new-candidate-routing-hold": 15,
  "new-candidate-provisional": 9,
  "new-candidate-evidence-hold": 3,
  "atlanta-overlap-candidate": 14,
  "merge-followup": 7,
  "retain-void-history": 3,
  "exclude-duplicate": 1,
  "hold-conflict": 1,
};
const actualDispositions = countBy(records, "canonicalDisposition");
for (const [key, expected] of Object.entries(expectedDispositions)) {
  assert(actualDispositions[key] === expected, `${key}: expected ${expected}, found ${actualDispositions[key] ?? 0}.`);
}

let resolvedPartnerLabels = 0;
let defunctPartnerLabels = 0;
for (const record of records) {
  assert(/^BOS-\d{4}-\d{4}$/u.test(record.tradeId), `${record.tradeId}: invalid reviewed ID.`);
  assert(/^\d{4}-\d{2}-\d{2}$/u.test(record.tradeDate), `${record.tradeId}: invalid trade date.`);
  assert(record.sourceTeam === "boston-celtics", `${record.tradeId}: source team changed.`);
  assert(record.partnerLabels.length === record.partnerTeams.length, `${record.tradeId}: partner label/team mismatch.`);
  assert(record.declaredTeamCount === record.partnerLabels.length + 1, `${record.tradeId}: declared team count mismatch.`);
  assert(String(record.publishStatus).startsWith("Hold"), `${record.tradeId}: publish hold missing.`);
  assert(!String(record.summary).includes("(?-?)") && !String(record.analysis).includes("(?-?)"), `${record.tradeId}: visible placeholder remains.`);

  if (record.declaredTeamCount > 2) {
    assert(
      record.dataQualityFlags.includes("Aggregate counterpart grade pending individual team perspectives"),
      `${record.tradeId}: aggregate counterpart note missing.`,
    );
  }

  for (let index = 0; index < record.partnerLabels.length; index += 1) {
    const result = resolver.resolve(record.partnerLabels[index], record.tradeDate);
    assert(
      result.status === "resolved" || result.status === "resolved-fallback",
      `${record.tradeId}: unresolved partner ${record.partnerLabels[index]} (${result.status}).`,
    );
    assert(result.team.slug === record.partnerTeams[index], `${record.tradeId}: partner resolution drift.`);
    resolvedPartnerLabels += 1;
    if (result.team.active === false) defunctPartnerLabels += 1;
  }

  if (record.verdict === "Insufficient Evidence") {
    assert(
      ["", "N/A"].includes(record.sourceTeamGrade) &&
      ["", "N/A"].includes(record.partnerAggregateGrade),
      `${record.tradeId}: insufficient-evidence row is graded.`,
    );
  }
}

assert(resolvedPartnerLabels === 244, `Expected 244 resolved partner labels, found ${resolvedPartnerLabels}.`);
assert(defunctPartnerLabels === 19, `Expected 19 defunct references, found ${defunctPartnerLabels}.`);

const resolutionChecks = [
  ["Ironmen (BAA)", "1946-12-12", "pittsburgh-ironmen"],
  ["Huskies (BAA)", "1947-01-02", "toronto-huskies"],
  ["Steamrollers (BAA)", "1949-01-16", "providence-steamrollers"],
  ["Olympians", "1951-02-12", "indianapolis-olympians"],
  ["Bullets (BAA)", "1948-11-20", "baltimore-bullets-original"],
  ["Bullets", "1965-10-10", "washington-wizards"],
  ["Nuggets", "1950-06-22", "denver-nuggets-original"],
  ["Nuggets", "1976-10-20", "denver-nuggets"],
  ["Hornets", "2005-09-30", "new-orleans-pelicans"],
  ["Hornets", "2019-07-06", "charlotte-hornets"],
];
for (const [label, date, expectedTeam] of resolutionChecks) {
  const result = resolver.resolve(label, date);
  assert(result.team?.slug === expectedTeam, `${label} ${date}: expected ${expectedTeam}, found ${result.team?.slug ?? result.status}.`);
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "4A",
  reviewedRows: records.length,
  registeredTeams: teams.length,
  activeTeams: 30,
  defunctTeams: 11,
  resolvedPartnerLabels,
  defunctPartnerLabels,
  newCanonicalCandidateFlags: reviewed.counts.newCanonicalCandidateFlags,
  atlantaOverlapCandidates: reviewed.counts.atlantaOverlapCandidates,
  nonStandaloneRows: reviewed.counts.mergeOrExclude,
  insufficientEvidence: reviewed.counts.insufficientEvidence,
  canonicalStoreWrites: 0,
  playerStoreWrites: 0,
  publicationAuthorized: false,
}, null, 2));
