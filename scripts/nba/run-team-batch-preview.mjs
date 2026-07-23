import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (!value.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${value}`);
    }

    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${value}`);
    }

    if (value === "--input") options.inputPath = next;
    else if (value === "--batch-id") options.batchId = next;
    else if (value === "--output-dir") options.outputDir = next;
    else if (value === "--decisions") options.decisionsPath = next;
    else if (value === "--source-label") options.sourceLabel = next;
    else throw new Error(`Unknown option: ${value}`);

    index += 1;
  }

  return {
    inputPath: options.inputPath ?? null,
    batchId: options.batchId ?? null,
    outputDir: options.outputDir ?? null,
    decisionsPath: options.decisionsPath ?? null,
    sourceLabel:
      options.sourceLabel ?? "User-provided NBA legacy team-table batch",
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(records) {
  const headers = [
    "SubmissionId",
    "TradeDate",
    "SourceTeam",
    "PartnerTeams",
    "Relationship",
    "ReceivedAssets",
    "SentAssets",
    "ParserIssues",
    "SourceFormattingIssues",
    "DataUncertaintyIssues",
    "DirectionReviewIssues",
    "SourceDecisionIssues",
    "EditorialEnrichmentIssues",
    "SwapContracts",
    "ReviewIssues",
  ];

  const rows = records.map((record) => [
    record.submissionId,
    record.tradeDate,
    record.sourceTeam,
    record.partnerTeams.join(", "),
    record.relationshipText,
    record.assetsReceived.length,
    record.assetsSent.length,
    record.parserIssues.length,
    record.sourceFormattingIssues.length,
    record.dataUncertaintyIssues.length,
    record.directionReviewIssues.length,
    record.sourceDecisionIssues.length,
    record.editorialEnrichmentIssues.length,
    record.pickSwapContracts.length,
    record.reviewIssues.join(" | "),
  ]);

  return `${[
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\n")}\n`;
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
            `Preview subprocess failed with exit code ${exitCode}.\n${stderr || stdout}`,
          ),
        );
        return;
      }

      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function assertEmptyOrMissing(directoryPath) {
  try {
    const info = await stat(directoryPath);
    if (!info.isDirectory()) {
      throw new Error(`Output path exists and is not a directory: ${directoryPath}`);
    }

    const entries = await readdir(directoryPath);
    if (entries.length > 0) {
      throw new Error(`Output directory must be empty: ${directoryPath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const args = parseArguments(process.argv.slice(2));

if (!args.inputPath || !args.batchId || !args.outputDir) {
  console.error(
    "Usage: node scripts/nba/run-team-batch-preview.mjs --input team.txt --batch-id team-batch-001 --output-dir C:\\external\\preview [--decisions decisions.json] [--source-label label]",
  );
  process.exit(1);
}

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.batchId)) {
  throw new Error(
    `batchId must use lowercase letters, numbers, and hyphens: ${args.batchId}`,
  );
}

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const inputPath = path.resolve(process.cwd(), args.inputPath);
const outputDir = path.resolve(process.cwd(), args.outputDir);
const decisionsPath = args.decisionsPath
  ? path.resolve(process.cwd(), args.decisionsPath)
  : null;

await access(path.join(repoRoot, "src/data/nba/teams.json"));
await access(path.join(repoRoot, "src/data/nba/trades.json"));
await access(inputPath);

if (isInside(repoRoot, outputDir)) {
  throw new Error(
    `Output directory must be outside the repository: ${outputDir}`,
  );
}

if (decisionsPath) await access(decisionsPath);
await assertEmptyOrMissing(outputDir);
await mkdir(outputDir, { recursive: true });

const rawBytes = await readFile(inputPath);
const rawHash = sha256(rawBytes);
const rawSnapshotPath = path.join(
  outputDir,
  `${args.batchId}-raw-source.txt`,
);
const previewPath = path.join(
  outputDir,
  `${args.batchId}-normalized-preview.json`,
);
const reviewQueuePath = path.join(
  outputDir,
  `${args.batchId}-review-queue.csv`,
);
const reportPath = path.join(outputDir, `${args.batchId}-preview-report.txt`);
const manifestPath = path.join(outputDir, `${args.batchId}-manifest.json`);

await copyFile(inputPath, rawSnapshotPath);

const previewArguments = [
  "scripts/nba/preview-legacy-team-batch.mjs",
  inputPath,
  "--output",
  previewPath,
  "--batch-id",
  args.batchId,
  "--source-label",
  args.sourceLabel,
];

if (decisionsPath) {
  previewArguments.push("--decisions", decisionsPath);
}

const subprocess = await runNode(previewArguments, repoRoot);
const subprocessSummary = JSON.parse(subprocess.stdout);
const previewText = await readFile(previewPath, "utf8");
const preview = JSON.parse(previewText.replace(/^\uFEFF/, ""));

if (
  subprocessSummary.result !== "PASS" ||
  preview.valid !== true ||
  preview.batchId !== args.batchId ||
  preview.submissionCount < 1
) {
  throw new Error("Generic team-batch preview did not pass validation.");
}

const sourceTeams = new Set(
  preview.normalized.map((record) => record.sourceTeam).filter(Boolean),
);

if (sourceTeams.size !== 1) {
  throw new Error(
    `A team batch must resolve to exactly one source team; found ${[
      ...sourceTeams,
    ].join(", ") || "none"}.`,
  );
}

if (
  preview.automaticMergesPerformed !== false ||
  preview.writesPerformed !== false ||
  preview.importsPerformed !== false
) {
  throw new Error("Safety guard failed: preview reported a write, import, or merge.");
}

await writeFile(reviewQueuePath, toCsv(preview.normalized), "utf8");

const sourceTeam = [...sourceTeams][0];
const report = `TRADEVERDICTS NBA GENERIC TEAM-BATCH PREVIEW\nResult: PASS\n\nBATCH\nBatch ID: ${args.batchId}\nSource team: ${sourceTeam}\nInput: ${inputPath}\nRaw snapshot: ${rawSnapshotPath}\nRaw SHA256: ${rawHash}\nDecision document: ${decisionsPath ?? "(none)"}\n\nNORMALIZATION\nRows: ${preview.submissionCount}\nTwo-team rows: ${preview.twoTeamCount}\nMulti-team rows: ${preview.multiTeamCount}\nAssets received: ${preview.receivedAssetCount}\nAssets sent: ${preview.sentAssetCount}\nTotal assets: ${preview.totalAssetCount}\nUnclassified assets: ${preview.unclassifiedAssetCount}\nParser issues: ${preview.parserReviewIssueCount}\nSource-formatting issues: ${preview.sourceFormattingIssueCount}\nData-uncertainty issues: ${preview.dataUncertaintyIssueCount}\nDirection-review issues: ${preview.directionReviewIssueCount}\nSource-decision issues: ${preview.sourceDecisionIssueCount}\nEditorial-enrichment items: ${preview.editorialEnrichmentIssueCount}\nPick-swap contracts: ${preview.canonicalSwapContractCount}\n\nSAFETY\nCanonical trades currently in store: ${preview.canonicalTradeCount}\nAutomatic merges performed: NO\nCanonical imports performed: NO\nRepository writes performed: NO\nBuild performed: NO\nRoute creation performed: NO\nPush performed: NO\nDeployment performed: NO\n`;

await writeFile(reportPath, report, "utf8");

const artifactPaths = [
  rawSnapshotPath,
  previewPath,
  reviewQueuePath,
  reportPath,
];
const artifacts = [];

for (const artifactPath of artifactPaths) {
  const bytes = await readFile(artifactPath);
  artifacts.push({
    path: artifactPath,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}

const manifest = {
  result: "PASS",
  phase: "2F",
  batchId: args.batchId,
  sourceTeam,
  createdAt: new Date().toISOString(),
  inputPath,
  inputSha256: rawHash,
  outputDir,
  repositoryWrites: false,
  canonicalImports: 0,
  automaticMerges: false,
  artifacts,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const manifestBytes = await readFile(manifestPath);

process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      phase: "2F",
      batchId: args.batchId,
      sourceTeam,
      submissionCount: preview.submissionCount,
      totalAssetCount: preview.totalAssetCount,
      parserIssueCount: preview.parserReviewIssueCount,
      outputDir,
      rawSnapshotPath,
      previewPath,
      reviewQueuePath,
      reportPath,
      manifestPath,
      manifestSha256: sha256(manifestBytes),
      repositoryWrites: false,
      canonicalImports: 0,
      automaticMerges: false,
    },
    null,
    2,
  )}\n`,
);
