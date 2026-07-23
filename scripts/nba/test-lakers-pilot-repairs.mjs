import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createNbaTeamRegistry,
  loadNbaTeams,
} from "../../src/lib/nba/team-registry.mjs";
import {
  createLegacyTeamResolver,
  parseLegacyNbaTeamTable,
} from "../../src/lib/nba/parse-legacy-team-table.mjs";
import { applyNbaIntakeDecisions } from "../../src/lib/nba/apply-intake-decisions.mjs";
import { normalizeNbaSubmission } from "../../src/lib/nba/normalize-submission.mjs";
import {
  buildNbaPickSwapContracts,
  enrichNbaPickSwapAsset,
} from "../../src/lib/nba/normalize-pick-swaps.mjs";

async function readJson(url) {
  return JSON.parse((await readFile(url, "utf8")).replace(/^\uFEFF/, ""));
}

const teams = await loadNbaTeams();
const registry = createNbaTeamRegistry(teams);
const aliases = await readJson(
  new URL("../../src/data/nba/team-input-aliases.json", import.meta.url),
);
const resolver = createLegacyTeamResolver(teams, aliases);
const rawText = await readFile(
  new URL("../../src/data/nba/raw/lakers-pilot-001.txt", import.meta.url),
  "utf8",
);
const decisions = await readJson(
  new URL(
    "../../src/data/nba/review/lakers-pilot-001-decisions.json",
    import.meta.url,
  ),
);

assert.ok(rawText.includes("• Reggie Bullock"));
assert.ok(rawText.includes("Dennis Schröder"));
assert.equal(rawText.includes("ΓÇó"), false);
assert.equal(rawText.includes("Schr├╢der"), false);

const parsed = parseLegacyNbaTeamTable(rawText, {
  batchId: "lakers-pilot-001",
  sourceLabel: "Phase 2E regression test",
  teams,
  aliasConfig: aliases,
});

const decided = applyNbaIntakeDecisions(parsed.submissions, decisions);
assert.equal(decided.length, 24);

const magic2022 = decided[9];
assert.equal(
  magic2022.reviewDecision.status,
  "confirmed-source-wording",
);
assert.ok(
  magic2022.reviewDecision.acceptedWarningCodes.includes(
    "unmatched-parentheses",
  ),
);

const deadline2023 = decided[12];
assert.equal(deadline2023.assetsSentText.length, 5);
assert.equal(
  deadline2023.assetsSentText[3],
  "2024 second round pick less favorable of Grizzlies, Wizards picks (#37-Bobi Klintman)",
);
assert.equal(
  deadline2023.reviewDecision.status,
  "provisional-user-approved-awaiting-external-audit",
);

const mavericks2026 = decided[21];
assert.equal(
  mavericks2026.reviewDecision.status,
  "held-awaiting-external-audit",
);
assert.deepEqual(mavericks2026.assetsReceivedText, ["cash"]);
assert.deepEqual(mavericks2026.assetsSentText, [
  "rights to Vsevolod Ishchenko",
  "cash",
]);

const normalized = decided.map((submission) =>
  normalizeNbaSubmission(submission, registry),
);

const davis = normalized[3];
const danielsPick = davis.assetsSent[7];
assert.equal(danielsPick.type, "draft_pick");
assert.equal(danielsPick.draftYear, 2022);
assert.equal(danielsPick.declaredDraftYear, null);
assert.deepEqual(danielsPick.possibleDraftYears, [2021, 2022]);
assert.equal(danielsPick.conveyedYear, 2022);
assert.equal(danielsPick.overall, 8);
assert.equal(danielsPick.becamePlayerName, "Dyson Daniels");

const powellPick = davis.assetsSent[8];
assert.equal(powellPick.draftYear, 2025);
assert.deepEqual(powellPick.possibleDraftYears, [2024, 2025]);
assert.equal(powellPick.conveyedYear, 2025);
assert.equal(powellPick.overall, 22);
assert.equal(powellPick.becamePlayerName, "Drake Powell");
assert.equal(powellPick.conditional, true);

const conditional2027 = normalized[12].assetsSent[4];
assert.equal(conditional2027.type, "draft_pick");
assert.equal(conditional2027.conditional, true);
assert.equal(conditional2027.round, null);
assert.deepEqual(conditional2027.possibleRounds, [1, 2]);

const nets2024 = normalized[15].assetsSent[2];
assert.equal(nets2024.type, "draft_pick");
assert.equal(nets2024.round, 2);
assert.equal(nets2024.declaredRound, 2);
assert.deepEqual(nets2024.possibleRounds, [2]);
assert.equal(nets2024.conditional, true);

function enrichRecord(record) {
  return {
    ...record,
    assetsReceived: record.assetsReceived.map((asset) =>
      enrichNbaPickSwapAsset(asset, resolver),
    ),
    assetsSent: record.assetsSent.map((asset) =>
      enrichNbaPickSwapAsset(asset, resolver),
    ),
  };
}

const davisWithSwaps = enrichRecord(davis);
const davisContracts = buildNbaPickSwapContracts(davisWithSwaps);
assert.equal(davisContracts.length, 1);
assert.equal(davisContracts[0].holderTeam, "new-orleans-pelicans");
assert.equal(davisContracts[0].subjectTeam, "los-angeles-lakers");
assert.equal(davisContracts[0].draftYear, 2023);
assert.equal(davisContracts[0].sourceRepresentationCount, 2);
assert.equal(davisContracts[0].duplicateSourceRepresentation, true);
assert.equal(davisContracts[0].exerciseStatus, "not_exercised");

const kessler = enrichRecord(normalized[23]);
const kesslerContracts = buildNbaPickSwapContracts(kessler);
assert.equal(kesslerContracts.length, 2);
assert.deepEqual(
  kesslerContracts.map((contract) => contract.draftYear),
  [2028, 2030],
);
for (const contract of kesslerContracts) {
  assert.equal(contract.holderTeam, "utah-jazz");
  assert.equal(contract.subjectTeam, "los-angeles-lakers");
  assert.equal(contract.sourceRepresentationCount, 2);
  assert.equal(contract.duplicateSourceRepresentation, true);
}

for (const record of normalized) {
  assert.equal(record.normalizationVersion, 2);
  assert.equal(record.indexEligible, false);
  assert.equal(record.adEligible, false);
  assert.equal(record.publishStatus, "private");
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "2E",
  rawUtf8Preserved: true,
  sourceDecisionsApplied: 3,
  provisionalJoinedPick: true,
  leadingRoundPrecedence: true,
  conditionalAlternativesPreserved: true,
  conveyedYearsPreserved: true,
  swapContractsConsolidated: 3,
  canonicalImports: 0,
  automaticMerge: false,
  repositoryWrites: false,
}, null, 2));
