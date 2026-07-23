import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { matchNbaTeamPerspectives } from "../../src/lib/nba/match-team-perspectives.mjs";

function runNode(argumentsList, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argumentsList, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || stdout || `Node exited ${code}`));
      else resolve(stdout.trim());
    });
  });
}

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tv-nba-2g-"));

try {
  const lakersPath = path.join(tempRoot, "lakers.json");
  const wizardsPath = path.join(tempRoot, "wizards.json");

  await runNode(
    [
      "scripts/nba/preview-legacy-team-batch.mjs",
      "src/data/nba/raw/lakers-pilot-001.txt",
      "--output",
      lakersPath,
      "--batch-id",
      "lakers-pilot-001",
      "--decisions",
      "src/data/nba/review/lakers-pilot-001-decisions.json",
      "--source-label",
      "Lakers regression batch",
    ],
    repoRoot,
  );

  await runNode(
    [
      "scripts/nba/preview-legacy-team-batch.mjs",
      "src/data/nba/raw/wizards-pilot-001.txt",
      "--output",
      wizardsPath,
      "--batch-id",
      "wizards-pilot-001",
      "--source-label",
      "Wizards second-team pilot",
    ],
    repoRoot,
  );

  const lakers = JSON.parse(await readFile(lakersPath, "utf8"));
  const wizards = JSON.parse(await readFile(wizardsPath, "utf8"));
  const matches = matchNbaTeamPerspectives(lakers.normalized, wizards.normalized);

  const exactPairs = matches.results
    .filter((record) => record.status === "exact-perspective-match")
    .map((record) => `${record.submissionId}->${record.candidates[0]?.submissionId}`)
    .sort();

  const expectedPairs = [
    "wizards-pilot-001-016->lakers-pilot-001-012",
    "wizards-pilot-001-026->lakers-pilot-001-023",
  ];

  const trades = JSON.parse(await readFile(path.join(repoRoot, "src/data/nba/trades.json"), "utf8"));
  const players = JSON.parse(await readFile(path.join(repoRoot, "src/data/nba/players.json"), "utf8"));

  const assertions = {
    wizardsRows: wizards.submissionCount === 27,
    wizardsAssets: wizards.totalAssetCount === 150,
    wizardsPlayers: wizards.assetTypeCounts.player === 70,
    unclassifiedAssets: wizards.unclassifiedAssetCount === 0,
    parserIssues: wizards.parserReviewIssueCount === 0,
    swapContracts: wizards.canonicalSwapContractCount === 6,
    exactMatches: matches.counts.exact === 2,
    likelyMatches: matches.counts.likely === 0,
    ambiguousMatches: matches.counts.ambiguous === 0,
    newTransactions: matches.counts.newTransaction === 25,
    expectedPairs: JSON.stringify(exactPairs) === JSON.stringify(expectedPairs),
    canonicalImports: trades.length === 0 && players.length === 0,
    automaticMerge: matches.automaticMerge === false,
  };

  const failed = Object.entries(assertions).filter(([, value]) => !value);
  if (failed.length > 0) {
    throw new Error(`Phase 2G assertions failed: ${failed.map(([key]) => key).join(", ")}`);
  }

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        phase: "2G",
        wizardsRows: wizards.submissionCount,
        wizardsAssets: wizards.totalAssetCount,
        wizardsPlayers: wizards.assetTypeCounts.player,
        unclassifiedAssets: wizards.unclassifiedAssetCount,
        parserIssues: wizards.parserReviewIssueCount,
        swapContracts: wizards.canonicalSwapContractCount,
        exactPerspectiveMatches: matches.counts.exact,
        likelyPerspectiveMatches: matches.counts.likely,
        ambiguousPerspectiveMatches: matches.counts.ambiguous,
        newTransactionCandidates: matches.counts.newTransaction,
        exactPairs,
        canonicalImports: 0,
        automaticMerge: false,
        repositoryWrites: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
