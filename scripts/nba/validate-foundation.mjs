import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  createNbaTeamRegistry,
  loadNbaTeams,
} from "../../src/lib/nba/team-registry.mjs";

const root = process.cwd();

const requiredFiles = [
  "src/data/nba/schema.md",
  "src/data/nba/teams.json",
  "src/data/nba/trades.json",
  "src/data/nba/players.json",
  "src/data/nba/raw/README.md",
  "src/data/nba/normalized/README.md",
  "src/data/nba/review/README.md",
  "src/lib/nba/team-registry.mjs",
  "src/lib/nba/validate-canonical-trade.mjs",
  "src/lib/nba/normalize-team-intake.mjs",
  "scripts/nba/validate-foundation.mjs",
  "scripts/nba/preview-team-intake.mjs",
];

async function readJson(relativePath) {
  const text = (await readFile(path.join(root, relativePath), "utf8"))
    .replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

for (const relativePath of requiredFiles) {
  await access(path.join(root, relativePath));
  const info = await stat(path.join(root, relativePath));

  if (!info.isFile()) {
    throw new Error(`Required foundation path is not a file: ${relativePath}`);
  }
}

const trades = await readJson("src/data/nba/trades.json");
const players = await readJson("src/data/nba/players.json");

if (!Array.isArray(trades) || trades.length !== 0) {
  throw new Error("Phase 2A trades.json must be an empty array.");
}

if (!Array.isArray(players) || players.length !== 0) {
  throw new Error("Phase 2A players.json must be an empty array.");
}

const teams = await loadNbaTeams();
const registry = createNbaTeamRegistry(teams);

if (registry.teams.length !== 30) {
  throw new Error(
    `NBA team registry must contain 30 active teams; found ${registry.teams.length}.`,
  );
}

for (const team of registry.teams) {
  if (team.active !== true) {
    throw new Error(`Phase 2A registry contains inactive team: ${team.slug}`);
  }

  if (!["Eastern", "Western"].includes(team.conference)) {
    throw new Error(`Invalid conference for ${team.slug}: ${team.conference}`);
  }

  if (!Array.isArray(team.historicalAliases)) {
    throw new Error(`historicalAliases must be an array for ${team.slug}.`);
  }
}

try {
  await access(path.join(root, "src/pages/nba"));
  throw new Error("Phase 2A must not create src/pages/nba.");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "2A",
  teams: registry.teams.length,
  trades: trades.length,
  players: players.length,
  routesCreated: false,
  defaultIndexEligible: false,
  defaultAdEligible: false,
}, null, 2));
