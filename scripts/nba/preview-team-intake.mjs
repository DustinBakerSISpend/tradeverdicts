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

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const inputPath = process.argv[2];

if (!inputPath) {
  fail("Usage: node scripts/nba/preview-team-intake.mjs <intake-file.txt>");
} else {
  const absolutePath = path.resolve(process.cwd(), inputPath);
  const text = await readFile(absolutePath, "utf8");
  const submissions = parseNbaTeamIntake(text);
  const registry = createNbaTeamRegistry(await loadNbaTeams());
  const validation = validateParsedIntake(submissions, registry);

  const preview = {
    mode: "DRY_RUN_PREVIEW_ONLY",
    inputPath: absolutePath,
    submissionCount: submissions.length,
    valid: validation.valid,
    errors: validation.errors,
    submissions,
    writesPerformed: false,
    importsPerformed: false,
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!validation.valid) {
    process.exitCode = 2;
  }
}
