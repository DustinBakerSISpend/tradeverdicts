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
import { normalizeNbaSubmission } from "../../src/lib/nba/normalize-submission.mjs";

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

assert.equal(resolver.resolve("Lakers"), "los-angeles-lakers");
assert.equal(resolver.resolve("Pistons"), "detroit-pistons");
assert.equal(resolver.resolve("Trail Blazers"), "portland-trail-blazers");

const batch = parseLegacyNbaTeamTable(rawText, {
  batchId: "lakers-pilot-001",
  sourceLabel: "Synthetic invocation over real user-provided raw pilot text",
  teams,
  aliasConfig: aliases,
});

assert.equal(batch.submissionCount, 24);
assert.equal(batch.submissions[0].sourceTeam, "los-angeles-lakers");
assert.deepEqual(batch.submissions[0].partnerTeams, ["detroit-pistons"]);
assert.equal(batch.submissions[0].assetsReceivedText.length, 1);
assert.equal(batch.submissions[0].assetsSentText.length, 2);

const davis = batch.submissions[3];
assert.equal(davis.tradeDate, "2019-07-06");
assert.equal(davis.declaredTeamCount, 3);
assert.deepEqual(davis.partnerTeams, [
  "new-orleans-pelicans",
  "washington-wizards",
]);

const fiveTeam = batch.submissions[6];
assert.equal(fiveTeam.declaredTeamCount, 5);
assert.equal(fiveTeam.partnerTeams.length, 4);

const fused = batch.submissions[21];
assert.equal(fused.assetsSentText.length, 2);
assert.ok(fused.warnings.some((warning) => warning.includes("fused bullet")));

const final = batch.submissions[23];
assert.equal(final.tradeDate, "2026-07-08");
assert.deepEqual(final.partnerTeams, ["utah-jazz"]);

const normalizedFirst = normalizeNbaSubmission(batch.submissions[0], registry);
assert.equal(normalizedFirst.assetsReceived[0].type, "player");
assert.equal(normalizedFirst.assetsReceived[0].playerName, "Reggie Bullock");
assert.equal(normalizedFirst.assetsSent[0].type, "player");
assert.equal(normalizedFirst.assetsSent[0].playerName, "Sviatoslav Mykhailiuk");
assert.deepEqual(normalizedFirst.assetsSent[0].playerAliases, ["Svi Mykhailiuk"]);
assert.equal(normalizedFirst.assetsSent[1].type, "draft_pick");
assert.equal(normalizedFirst.assetsSent[1].draftYear, 2021);
assert.equal(normalizedFirst.assetsSent[1].round, 2);
assert.equal(normalizedFirst.assetsSent[1].overall, 52);
assert.equal(normalizedFirst.assetsSent[1].becamePlayerName, "Luka Garza");

const rights = normalizeNbaSubmission(batch.submissions[2], registry);
assert.equal(rights.assetsReceived[0].type, "draft_rights");
assert.equal(rights.assetsSent[1].type, "cash");

const davisNormalized = normalizeNbaSubmission(davis, registry);
assert.equal(davisNormalized.assetsReceived[1].type, "pick_swap");
assert.equal(davisNormalized.assetsReceived[1].exercised, false);
assert.equal(davisNormalized.assetsReceived[0].fromTeam, null);

const thunder = normalizeNbaSubmission(batch.submissions[4], registry);
assert.equal(thunder.assetsSent[2].type, "trade_exception");

const aliasRecord = normalizeNbaSubmission(batch.submissions[13], registry);
assert.equal(aliasRecord.assetsReceived[0].playerName, "Mohamed Bamba");
assert.deepEqual(aliasRecord.assetsReceived[0].playerAliases, ["Mo Bamba"]);

for (const submission of batch.submissions) {
  const normalized = normalizeNbaSubmission(submission, registry);
  assert.equal(normalized.indexEligible, false);
  assert.equal(normalized.adEligible, false);
  assert.equal(normalized.publishStatus, "private");
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "2D",
  legacyRowsParsed: batch.submissionCount,
  sourceTeamResolved: true,
  relationshipNotesResolved: true,
  fusedBulletDetectedAndSplit: true,
  slashAliasesPreserved: true,
  legacyPlayersInferred: true,
  structuredAssetsParsed: true,
  automaticMerge: false,
  repositoryWrites: false,
}, null, 2));
