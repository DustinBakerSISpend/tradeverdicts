#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assembleCanonicalTrades } from "../../src/lib/nba/assemble-canonical-trade.mjs";
import { createNbaTeamRegistry, loadNbaTeams } from "../../src/lib/nba/team-registry.mjs";
import { validateCanonicalNbaTrade } from "../../src/lib/nba/validate-canonical-trade.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }

  const nonEmpty = rows.filter((entry) => entry.some((cell) => cell !== ""));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((header) => header.replace(/^\uFEFF/, ""));
  return nonEmpty.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
  );
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const args = parseArgs(process.argv);
for (const required of [
  "candidate-json",
  "audit-csv",
  "editorial-json",
  "wizards-preview",
  "lakers-preview",
  "output-json",
  "output-csv",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [
  candidateText,
  auditBytes,
  editorialText,
  wizardsText,
  lakersText,
] = await Promise.all([
  readFile(args["candidate-json"], "utf8"),
  readFile(args["audit-csv"]),
  readFile(args["editorial-json"], "utf8"),
  readFile(args["wizards-preview"], "utf8"),
  readFile(args["lakers-preview"], "utf8"),
]);

const candidateDoc = JSON.parse(candidateText);
const auditRows = parseCsv(auditBytes.toString("utf8"));
const editorialDoc = JSON.parse(editorialText);
const wizardsPreview = JSON.parse(wizardsText);
const lakersPreview = JSON.parse(lakersText);

if (candidateDoc.counts?.candidates !== 27) throw new Error("Expected 27 candidates.");
if (auditRows.length !== 27) throw new Error("Expected 27 audited rows.");
if (editorialDoc.records?.length !== 27) throw new Error("Expected 27 editorial records.");

const { records, issues } = assembleCanonicalTrades({
  candidates: candidateDoc.candidates,
  auditRows,
  editorialRecords: editorialDoc.records,
  wizardsPreview,
  lakersPreview,
  auditCsvSha256: sha256(auditBytes),
});

if (issues.length) {
  throw new Error(`Structured assembly issues:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
}

const registry = createNbaTeamRegistry(await loadNbaTeams());
const validation = records.map((record) => ({
  id: record.id,
  sourceTradeId: record.sourceTradeId,
  ...validateCanonicalNbaTrade(record, registry),
}));
const invalid = validation.filter((result) => !result.valid);
if (invalid.length) {
  throw new Error(`Canonical validation failed:\n${JSON.stringify(invalid, null, 2)}`);
}

const ids = new Set(records.map((record) => record.id));
const slugs = new Set(records.map((record) => record.slug));
const keys = new Set(records.map((record) => record.canonicalKey));
if (ids.size !== records.length) throw new Error("Duplicate canonical IDs.");
if (slugs.size !== records.length) throw new Error("Duplicate canonical slugs.");
if (keys.size !== records.length) throw new Error("Duplicate canonical keys.");

const counts = {
  canonicalRecords: records.length,
  schemaValidRecords: validation.filter((result) => result.valid).length,
  newCanonicalRecords: records.filter(
    (record) => record.candidateAction === "create-new-canonical-candidate"
  ).length,
  sharedPerspectiveRecords: records.filter(
    (record) => record.candidateAction === "create-shared-canonical-candidate"
  ).length,
  sourcePerspectives: records.reduce(
    (sum, record) => sum + Object.keys(record.perspectives).length,
    0
  ),
  fullyRoutedTwoTeamRecords: records.filter(
    (record) => record.routingCompleteness === "complete"
  ).length,
  partialMultiTeamRecords: records.filter(
    (record) => record.routingCompleteness === "partial-source-perspective"
  ).length,
  auditedAssetLedgerEntries: records.reduce(
    (sum, record) => sum + record.assetLedger.length,
    0
  ),
  unresolvedAssetRoutingEntries: records.reduce(
    (sum, record) => sum + record.unresolvedAssetRouting.length,
    0
  ),
  verdictsPresent: records.filter((record) => record.verdict).length,
  privateRecords: records.filter((record) => record.publishStatus === "private").length,
  noindexRecords: records.filter((record) => record.indexEligible === false).length,
  adFreeRecords: records.filter((record) => record.adEligible === false).length,
};

const output = {
  mode: "DRY_RUN_STRUCTURED_CANONICAL_PREVIEW_ONLY",
  batchId: candidateDoc.batchId,
  auditStatus: candidateDoc.auditStatus,
  counts,
  validation,
  records,
  canonicalImports: 0,
  repositoryWrites: false,
  automaticMerges: false,
  routesCreated: false,
  buildPerformed: false,
  pushPerformed: false,
  deployPerformed: false,
};

await mkdir(path.dirname(args["output-json"]), { recursive: true });
await mkdir(path.dirname(args["output-csv"]), { recursive: true });
await writeFile(args["output-json"], `${JSON.stringify(output, null, 2)}\n`, "utf8");

const headers = [
  "Canonical ID",
  "Source Trade ID",
  "Canonical Date",
  "Season",
  "Teams",
  "Slug",
  "Verdict",
  "Wizards Grade",
  "Partner Grade",
  "Routing Completeness",
  "Asset Ledger Entries",
  "Unresolved Routing Entries",
  "Perspective Count",
  "Candidate Action",
  "Review Status",
  "Publish Status",
  "Index Eligible",
  "Ad Eligible",
  "Schema Valid",
];
const rows = records.map((record) => [
  record.id,
  record.sourceTradeId,
  record.tradeDate,
  record.seasonLabel,
  record.teams.join("; "),
  record.slug,
  record.verdict,
  record.grades["washington-wizards"],
  record.aggregatePartnerGrade ?? Object.entries(record.grades).find(
    ([team]) => team !== "washington-wizards"
  )?.[1] ?? "",
  record.routingCompleteness,
  record.assetLedger.length,
  record.unresolvedAssetRouting.length,
  Object.keys(record.perspectives).length,
  record.candidateAction,
  record.reviewStatus,
  record.publishStatus,
  record.indexEligible,
  record.adEligible,
  true,
]);
await writeFile(
  args["output-csv"],
  `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
  "utf8"
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2I",
  ...counts,
  canonicalImports: 0,
  repositoryWrites: false,
  automaticMerges: false,
  publicationReady: false,
}, null, 2));
