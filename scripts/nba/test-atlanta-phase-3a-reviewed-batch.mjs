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

function assert(value, message) {
  if (!value) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

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
  "reviewed-json",
  "teams-json",
  "lineage-json",
  "trades-json",
  "raw-source",
  "workbook",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [reviewedBytes, teamBytes, lineageBytes, tradeBytes, rawBytes, workbookBytes] =
  await Promise.all([
    readFile(args["reviewed-json"]),
    readFile(args["teams-json"]),
    readFile(args["lineage-json"]),
    readFile(args["trades-json"]),
    readFile(args["raw-source"]),
    readFile(args.workbook),
  ]);

const reviewed = JSON.parse(reviewedBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const lineage = JSON.parse(lineageBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));
const resolver = createHistoricalNbaTeamResolver({ teams, lineage });

assert(reviewed.schemaVersion === 1, "Unexpected reviewed-batch schema version.");
assert(reviewed.batchId === "atlanta-hawks-phase-3a", "Unexpected batch ID.");
assert(reviewed.sourceTeam === "atlanta-hawks", "Unexpected source team.");
assert(reviewed.review.importAuthorized === false, "Import must remain unauthorized.");
assert(reviewed.review.publicationAuthorized === false, "Publication must remain unauthorized.");
assert(sha256(workbookBytes) === reviewed.sourceWorkbook.sha256, "Workbook hash mismatch.");
assert(sha256(rawBytes) === reviewed.rawSource.sha256, "Raw-source hash mismatch.");

const records = reviewed.records;
assert(Array.isArray(records) && records.length === 308, "Expected 308 reviewed records.");
assert(new Set(records.map((record) => record.tradeId)).size === 308, "Trade IDs are not unique.");
assert(teams.length === 36, "Expected 36 registered teams after historical expansion.");
assert(teams.filter((team) => team.active === true).length === 30, "Expected 30 active teams.");
assert(teams.filter((team) => team.active === false).length === 6, "Expected six defunct teams.");
assert(trades.length === 27, "Canonical store must remain at 27 trades.");

const expectedCounts = {
  rows: 308,
  twoTeamRows: 287,
  multiTeamRows: 21,
  newCanonicalCandidates: 298,
  existingPerspectiveMatches: 1,
  mergeFollowups: 4,
  duplicateVariants: 4,
  dataConflicts: 1,
  insufficientEvidence: 13,
  selfCounterpartyConflicts: 1,
  publicCandidates: 89,
  researchBeforePublic: 159,
  privateNoindexArchive: 51,
  mergeOrExclude: 9,
};
for (const [key, expected] of Object.entries(expectedCounts)) {
  assert(reviewed.counts[key] === expected, `${key}: expected ${expected}, found ${reviewed.counts[key]}`);
}

const expectedVerdicts = {
  "Hawks Win": 61,
  "Slight Hawks Edge": 51,
  "Even Trade": 78,
  "Slight Partner Edge": 38,
  "Partner Win": 58,
  "Insufficient Evidence": 13,
  "Follow-up Resolution": 4,
  "Duplicate Source Variant": 4,
  "Data Conflict": 1,
};
const actualVerdicts = countBy(records, "verdict");
for (const [verdict, expected] of Object.entries(expectedVerdicts)) {
  assert(actualVerdicts[verdict] === expected, `${verdict}: expected ${expected}, found ${actualVerdicts[verdict] ?? 0}.`);
}
assert(Object.keys(actualVerdicts).length === Object.keys(expectedVerdicts).length, "Unexpected verdict category detected.");

let resolvedPartnerLabels = 0;
let defunctPartnerLabels = 0;
let selfCounterpartyConflicts = 0;
for (const record of records) {
  assert(/^ATL-\d{4}-\d{4}$/u.test(record.tradeId), `${record.tradeId}: invalid reviewed ID.`);
  assert(/^\d{4}-\d{2}-\d{2}$/u.test(record.tradeDate), `${record.tradeId}: invalid trade date.`);
  assert(record.sourceTeam === "atlanta-hawks", `${record.tradeId}: source team changed.`);
  assert(
    record.partnerLabels.length === record.partnerTeams.length,
    `${record.tradeId}: partner label/team count mismatch.`,
  );
  assert(
    record.declaredTeamCount === record.partnerLabels.length + 1,
    `${record.tradeId}: declared team count mismatch.`,
  );
  assert(String(record.publishStatus).startsWith("Hold"), `${record.tradeId}: publish hold missing.`);

  for (let index = 0; index < record.partnerLabels.length; index += 1) {
    const result = resolver.resolve(record.partnerLabels[index], record.tradeDate);
    assert(
      result.status === "resolved" || result.status === "resolved-fallback",
      `${record.tradeId}: unresolved partner ${record.partnerLabels[index]} (${result.status}).`,
    );
    assert(
      result.team.slug === record.partnerTeams[index],
      `${record.tradeId}: partner resolution changed for ${record.partnerLabels[index]}.`,
    );
    resolvedPartnerLabels += 1;
    if (result.team.active === false) defunctPartnerLabels += 1;
  }

  if (record.partnerTeams.includes("atlanta-hawks")) {
    selfCounterpartyConflicts += 1;
    assert(record.verdict === "Data Conflict", `${record.tradeId}: self-counterparty row must be a data conflict.`);
  }

  if (record.verdict === "Insufficient Evidence") {
    assert(
      record.sourceTeamGrade === "N/A" && record.partnerAggregateGrade === "N/A",
      `${record.tradeId}: insufficient-evidence grades must be N/A.`,
    );
  }
}

assert(selfCounterpartyConflicts === 1, "Expected one self-counterparty conflict.");
assert(resolvedPartnerLabels === 338, `Expected 338 resolved partner labels, found ${resolvedPartnerLabels}.`);
assert(defunctPartnerLabels === 10, `Expected 10 defunct-franchise partner references, found ${defunctPartnerLabels}.`);

const anderson = resolver.resolve("Packers", "1949-12-30");
const chicagoPackers = resolver.resolve("Packers", "1961-11-21");
const oldBullets = resolver.resolve("Bullets", "1952-11-24");
const modernBullets = resolver.resolve("Bullets", "1968-01-21");
assert(anderson.team?.slug === "anderson-packers", "Anderson Packers date rule failed.");
assert(chicagoPackers.team?.slug === "washington-wizards", "Chicago Packers lineage rule failed.");
assert(oldBullets.team?.slug === "baltimore-bullets-original", "Original Bullets date rule failed.");
assert(modernBullets.team?.slug === "washington-wizards", "Modern Bullets lineage rule failed.");

const perspective = records.find((record) => record.canonicalDisposition === "existing-perspective");
assert(perspective?.tradeId === "ATL-2026-0300", "Unexpected existing perspective record.");
assert(
  perspective.existingCanonicalMatch === "nba-trade-20260109-e1724a128785",
  "Existing canonical match changed.",
);
const matchedTrade = trades.find((trade) => trade.id === perspective.existingCanonicalMatch);
assert(matchedTrade, "Matched canonical trade is missing.");
assert(matchedTrade.tradeDate === perspective.tradeDate, "Matched canonical date differs.");
assert(
  matchedTrade.teams.includes("atlanta-hawks") && matchedTrade.teams.includes("washington-wizards"),
  "Matched canonical teams differ.",
);
assert(!matchedTrade.sourceTeams.includes("atlanta-hawks"), "Atlanta perspective was already imported unexpectedly.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "3A",
  reviewedRows: records.length,
  registeredTeams: teams.length,
  activeTeams: 30,
  defunctTeams: 6,
  resolvedPartnerLabels,
  defunctPartnerLabels,
  newCanonicalCandidates: reviewed.counts.newCanonicalCandidates,
  existingPerspectiveMatches: reviewed.counts.existingPerspectiveMatches,
  nonStandaloneRows: reviewed.counts.mergeOrExclude,
  insufficientEvidence: reviewed.counts.insufficientEvidence,
  canonicalStoreWrites: 0,
  playerStoreWrites: 0,
  publicationAuthorized: false,
}, null, 2));
