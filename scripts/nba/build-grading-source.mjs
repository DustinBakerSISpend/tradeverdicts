import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (!value.startsWith("--") || !next || next.startsWith("--")) {
      throw new Error(`Invalid argument near ${value ?? "(end)"}`);
    }
    if (value === "--preview") options.preview = next;
    else if (value === "--matches") options.matches = next;
    else if (value === "--output") options.output = next;
    else throw new Error(`Unknown option: ${value}`);
    index += 1;
  }
  return options;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function assetList(assets) {
  return (assets ?? []).map((asset) => asset.displayText).join("; ");
}

const args = parseArguments(process.argv.slice(2));
if (!args.preview || !args.matches || !args.output) {
  console.error(
    "Usage: node scripts/nba/build-grading-source.mjs --preview preview.json --matches matches.json --output grading-source.csv",
  );
  process.exit(1);
}

const preview = JSON.parse(
  (await readFile(path.resolve(process.cwd(), args.preview), "utf8")).replace(/^\uFEFF/, ""),
);
const matches = JSON.parse(
  (await readFile(path.resolve(process.cwd(), args.matches), "utf8")).replace(/^\uFEFF/, ""),
);
const matchBySubmission = new Map(
  matches.results.map((record) => [record.submissionId, record]),
);

const headers = [
  "Trade ID",
  "Date",
  "League",
  "Primary Team",
  "Trade Partner",
  "Wizards Received",
  "Wizards Sent",
  "Partner Received",
  "Partner Sent",
  "Source Raw Text",
  "Cross-Team Match Status",
  "Matched Lakers Submission",
  "Parser Issues",
  "Source Formatting Issues",
  "Data Uncertainty Issues",
  "Direction Review Issues",
  "Editorial Status",
];

const rows = preview.normalized.map((record, index) => {
  const match = matchBySubmission.get(record.submissionId);
  const top = match?.candidates?.[0];
  const received = assetList(record.assetsReceived);
  const sent = assetList(record.assetsSent);
  return [
    `WAS-${record.tradeDate.slice(0, 4)}-${String(index + 1).padStart(4, "0")}`,
    record.tradeDate,
    "NBA",
    "Washington Wizards",
    record.partnerTeamLabels.join(", "),
    received,
    sent,
    sent,
    received,
    record.rawText,
    match?.status ?? "new-transaction-candidate",
    top?.submissionId ?? "",
    record.parserIssues.join(" | "),
    record.sourceFormattingIssues.join(" | "),
    record.dataUncertaintyIssues.join(" | "),
    record.directionReviewIssues.join(" | "),
    "Pending ChatGPT grading and analysis",
  ];
});

const csv = `${[
  headers.map(csvCell).join(","),
  ...rows.map((row) => row.map(csvCell).join(",")),
].join("\n")}\n`;

await writeFile(path.resolve(process.cwd(), args.output), csv, "utf8");
console.log(
  JSON.stringify(
    {
      result: "PASS",
      phase: "2G",
      rows: rows.length,
      editorialStatus: "Pending ChatGPT grading and analysis",
      output: path.resolve(process.cwd(), args.output),
    },
    null,
    2,
  ),
);
