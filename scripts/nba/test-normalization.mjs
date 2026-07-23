import assert from "node:assert/strict";
import {
  parseNbaTeamIntake,
  validateParsedIntake,
} from "../../src/lib/nba/normalize-team-intake.mjs";
import {
  createNbaTeamRegistry,
  loadNbaTeams,
} from "../../src/lib/nba/team-registry.mjs";
import { normalizeNbaSubmission } from "../../src/lib/nba/normalize-submission.mjs";
import { findNbaCanonicalCandidates } from "../../src/lib/nba/match-candidates.mjs";

const registry = createNbaTeamRegistry(await loadNbaTeams());

const fixture = `SUBMISSION_ID: test-lal-001
SOURCE_TEAM: los-angeles-lakers
SOURCE_ROW_ID: 1
TRADE_DATE: 2008-02-01
PARTNER_TEAMS: memphis-grizzlies
ASSETS_RECEIVED:
- Player: Synthetic Veteran
ASSETS_SENT:
- Player: Synthetic Prospect
- Draft pick: 2010 first-round pick, top-10 protected
SOURCE_TEAM_GRADE: A
SOURCE_TEAM_VERDICT: Los Angeles Lakers Win
NEUTRAL_SUMMARY: Los Angeles acquired Synthetic Veteran from Memphis for Synthetic Prospect and a future first-round pick.
SOURCE_REFERENCE: Synthetic test
UNCERTAINTY_NOTES: None
RELATED_KNOWN_TRADE_ID:

SUBMISSION_ID: test-por-002
SOURCE_TEAM: portland-trail-blazers
SOURCE_ROW_ID: 2
TRADE_DATE: 2015-06-25
PARTNER_TEAMS: chicago-bulls
- cleveland-cavaliers
ASSETS_RECEIVED:
- Player: Synthetic Guard
ASSETS_SENT:
- Future considerations
SOURCE_TEAM_GRADE: B
SOURCE_TEAM_VERDICT: Portland Trail Blazers Even
NEUTRAL_SUMMARY: Portland completed a synthetic three-team transaction.
SOURCE_REFERENCE: Synthetic test
UNCERTAINTY_NOTES: Multi-team directions unknown
RELATED_KNOWN_TRADE_ID:`;

const parsed = parseNbaTeamIntake(fixture);
const validation = validateParsedIntake(parsed, registry);
assert.equal(validation.valid, true);
assert.equal(parsed.length, 2);

const first = normalizeNbaSubmission(parsed[0], registry);
assert.equal(first.assetsReceived[0].type, "player");
assert.equal(first.assetsReceived[0].playerName, "Synthetic Veteran");
assert.equal(first.assetsSent[1].type, "draft_pick");
assert.equal(first.assetsSent[1].draftYear, 2010);
assert.equal(first.assetsSent[1].round, 1);
assert.equal(first.assetsSent[1].protectionText, "top-10 protected");
assert.equal(first.assetsSent[1].fromTeam, "los-angeles-lakers");
assert.equal(first.assetsSent[1].toTeam, "memphis-grizzlies");
assert.equal(first.indexEligible, false);
assert.equal(first.adEligible, false);

const second = normalizeNbaSubmission(parsed[1], registry);
assert.equal(second.partnerTeams.length, 2);
assert.equal(second.assetsReceived[0].fromTeam, null);
assert.equal(second.assetsSent[0].toTeam, null);
assert.ok(second.warnings.some((warning) => warning.includes("Multi-team")));

const canonical = [{
  id: "nba-test-001",
  league: "nba",
  slug: "synthetic-veteran-los-angeles-lakers-2008",
  tradeDate: "2008-02-01",
  teams: ["los-angeles-lakers", "memphis-grizzlies"],
  summary: "Los Angeles acquired Synthetic Veteran from Memphis for Synthetic Prospect and a first-round pick.",
  assetsReceived: {
    "los-angeles-lakers": [{
      type: "player",
      playerName: "Synthetic Veteran",
      displayText: "Synthetic Veteran",
    }],
    "memphis-grizzlies": [{
      type: "player",
      playerName: "Synthetic Prospect",
      displayText: "Synthetic Prospect",
    }],
  },
}];

const match = findNbaCanonicalCandidates(first, canonical);
assert.equal(match.automaticMerge, false);
assert.equal(match.status, "exact-match-candidate");
assert.equal(match.candidates[0].tradeId, "nba-test-001");
assert.ok(match.candidates[0].score >= 85);

const noMatch = findNbaCanonicalCandidates(second, canonical);
assert.equal(noMatch.automaticMerge, false);
assert.equal(noMatch.status, "new-transaction-candidate");
assert.equal(noMatch.candidates.length, 0);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2C",
  parsedSubmissions: parsed.length,
  twoTeamNormalization: true,
  multiTeamAmbiguityPreserved: true,
  structuredAssetParsing: true,
  candidateMatching: true,
  automaticMerge: false,
  repositoryWrites: false,
}, null, 2));
