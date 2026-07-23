import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { matchNbaTeamPerspectives } from "../../src/lib/nba/match-team-perspectives.mjs";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (!value.startsWith("--") || !next || next.startsWith("--")) {
      throw new Error(`Invalid argument near ${value ?? "(end)"}`);
    }
    if (value === "--left") options.left = next;
    else if (value === "--right") options.right = next;
    else if (value === "--output-json") options.outputJson = next;
    else if (value === "--output-csv") options.outputCsv = next;
    else throw new Error(`Unknown option: ${value}`);
    index += 1;
  }
  return options;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function toCsv(report) {
  const headers = [
    "SubmissionId",
    "TradeDate",
    "SourceTeam",
    "Teams",
    "MatchStatus",
    "TopCandidateSubmissionId",
    "TopCandidateSourceTeam",
    "TopCandidateScore",
    "ReciprocalAssetMatches",
    "ReceivedCoverage",
    "SentCoverage",
    "Reasons",
    "AutomaticMerge",
  ];

  const rows = report.results.map((result) => {
    const top = result.candidates[0] ?? {};
    return [
      result.submissionId,
      result.tradeDate,
      result.sourceTeam,
      result.teams.join(", "),
      result.status,
      top.submissionId ?? "",
      top.sourceTeam ?? "",
      top.score ?? "",
      top.reciprocalMatches ?? "",
      top.receivedCoverage ?? "",
      top.sentCoverage ?? "",
      (top.reasons ?? []).join(" | "),
      "false",
    ];
  });

  return `${[
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\n")}\n`;
}

const args = parseArguments(process.argv.slice(2));
if (!args.left || !args.right || !args.outputJson || !args.outputCsv) {
  console.error(
    "Usage: node scripts/nba/compare-team-previews.mjs --left left.json --right right.json --output-json matches.json --output-csv matches.csv",
  );
  process.exit(1);
}

const leftPath = path.resolve(process.cwd(), args.left);
const rightPath = path.resolve(process.cwd(), args.right);
const outputJson = path.resolve(process.cwd(), args.outputJson);
const outputCsv = path.resolve(process.cwd(), args.outputCsv);
const left = JSON.parse((await readFile(leftPath, "utf8")).replace(/^\uFEFF/, ""));
const right = JSON.parse((await readFile(rightPath, "utf8")).replace(/^\uFEFF/, ""));
const report = matchNbaTeamPerspectives(left.normalized, right.normalized);

const output = {
  mode: "DRY_RUN_CROSS_TEAM_PERSPECTIVE_MATCHING",
  leftBatchId: left.batchId,
  rightBatchId: right.batchId,
  ...report,
  canonicalMergesPerformed: 0,
  writesPerformed: false,
};

await writeFile(outputJson, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await writeFile(outputCsv, toCsv(output), "utf8");

console.log(
  JSON.stringify(
    {
      result: "PASS",
      phase: "2G",
      leftBatchId: left.batchId,
      rightBatchId: right.batchId,
      ...report.counts,
      canonicalMergesPerformed: 0,
      automaticMerge: false,
      outputJson,
      outputCsv,
    },
    null,
    2,
  ),
);
