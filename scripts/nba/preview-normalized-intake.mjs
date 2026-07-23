import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
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

const inputPath = process.argv[2];
if (!inputPath) {
  console.error(
    "Usage: node scripts/nba/preview-normalized-intake.mjs <intake-file.txt>",
  );
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), inputPath);
const inputText = await readFile(absolutePath, "utf8");
const submissions = parseNbaTeamIntake(inputText);
const registry = createNbaTeamRegistry(await loadNbaTeams());
const intakeValidation = validateParsedIntake(submissions, registry);

if (!intakeValidation.valid) {
  console.log(JSON.stringify({
    mode: "DRY_RUN_NORMALIZATION_ONLY",
    valid: false,
    errors: intakeValidation.errors,
    writesPerformed: false,
    importsPerformed: false,
  }, null, 2));
  process.exit(2);
}

const tradesText = (await readFile(
  new URL("../../src/data/nba/trades.json", import.meta.url),
  "utf8",
)).replace(/^\uFEFF/, "");
const canonicalTrades = JSON.parse(tradesText);

const normalized = submissions.map((submission) => {
  const record = normalizeNbaSubmission(submission, registry);
  return {
    ...record,
    matchReview: findNbaCanonicalCandidates(record, canonicalTrades),
  };
});

console.log(JSON.stringify({
  mode: "DRY_RUN_NORMALIZATION_ONLY",
  valid: true,
  inputPath: absolutePath,
  submissionCount: normalized.length,
  canonicalTradeCount: canonicalTrades.length,
  normalized,
  writesPerformed: false,
  importsPerformed: false,
  automaticMergesPerformed: false,
}, null, 2));
