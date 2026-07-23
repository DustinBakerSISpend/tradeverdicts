import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(
          new Error(
            `Generic runner test subprocess failed with exit code ${exitCode}.\n${stderr || stdout}`,
          ),
        );
        return;
      }
      resolve(stdout.trim());
    });
  });
}

const repoRoot = process.cwd();
const sourcePath = path.join(
  repoRoot,
  "src/data/nba/raw/lakers-pilot-001.txt",
);
const decisionsPath = path.join(
  repoRoot,
  "src/data/nba/review/lakers-pilot-001-decisions.json",
);
const tempParent = await mkdtemp(path.join(os.tmpdir(), "tv-nba-2f-"));
const outputDir = path.join(tempParent, "output");

try {
  const sourceBytes = await readFile(sourcePath);
  const stdout = await runNode(
    [
      "scripts/nba/run-team-batch-preview.mjs",
      "--input",
      sourcePath,
      "--batch-id",
      "lakers-pilot-001",
      "--output-dir",
      outputDir,
      "--decisions",
      decisionsPath,
      "--source-label",
      "Phase 2F generic-runner regression fixture",
    ],
    repoRoot,
  );

  const summary = JSON.parse(stdout);
  const preview = JSON.parse(
    await readFile(summary.previewPath, "utf8"),
  );
  const rawSnapshot = await readFile(summary.rawSnapshotPath);
  const manifest = JSON.parse(
    await readFile(summary.manifestPath, "utf8"),
  );

  for (const artifactPath of [
    summary.previewPath,
    summary.reviewQueuePath,
    summary.reportPath,
    summary.manifestPath,
  ]) {
    const info = await stat(artifactPath);
    if (!info.isFile() || info.size === 0) {
      throw new Error(`Expected non-empty Phase 2F artifact: ${artifactPath}`);
    }
  }

  if (
    summary.result !== "PASS" ||
    summary.phase !== "2F" ||
    summary.sourceTeam !== "los-angeles-lakers" ||
    summary.submissionCount !== 24 ||
    summary.totalAssetCount !== 118 ||
    summary.parserIssueCount !== 0 ||
    summary.repositoryWrites !== false ||
    summary.canonicalImports !== 0 ||
    summary.automaticMerges !== false
  ) {
    throw new Error("Generic runner summary did not match the Lakers baseline.");
  }

  if (
    preview.normalizationVersion !== 2 ||
    preview.unclassifiedAssetCount !== 0 ||
    preview.parserReviewIssueCount !== 0 ||
    preview.canonicalTradeCount !== 0 ||
    preview.importsPerformed !== false ||
    preview.writesPerformed !== false
  ) {
    throw new Error("Generic runner preview failed safety or quality checks.");
  }

  if (sha256(sourceBytes) !== sha256(rawSnapshot)) {
    throw new Error("External raw-source snapshot was not byte-identical.");
  }

  if (
    manifest.result !== "PASS" ||
    manifest.phase !== "2F" ||
    manifest.repositoryWrites !== false ||
    manifest.canonicalImports !== 0
  ) {
    throw new Error("Phase 2F manifest failed validation.");
  }

  const trades = JSON.parse(
    (await readFile("src/data/nba/trades.json", "utf8")).replace(/^\uFEFF/, ""),
  );
  const players = JSON.parse(
    (await readFile("src/data/nba/players.json", "utf8")).replace(/^\uFEFF/, ""),
  );

  if (trades.length !== 0 || players.length !== 0) {
    throw new Error("Generic preview unexpectedly populated canonical stores.");
  }

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        phase: "2F",
        genericRunner: true,
        sourceTeamResolved: true,
        submissions: summary.submissionCount,
        assets: summary.totalAssetCount,
        byteIdenticalRawSnapshot: true,
        externalArtifactsCreated: 5,
        parserIssues: summary.parserIssueCount,
        repositoryWrites: false,
        canonicalImports: 0,
        automaticMerge: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempParent, { recursive: true, force: true });
}
