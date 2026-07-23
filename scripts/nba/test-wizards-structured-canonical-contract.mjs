#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseAuditedNbaAssetText } from "../../src/lib/nba/parse-audited-asset-text.mjs";

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
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += char;
  }

  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }

  const nonEmpty = rows.filter((entry) => entry.some((cell) => cell !== ""));
  const headers = nonEmpty[0].map((header) => header.replace(/^\uFEFF/, ""));
  return nonEmpty.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
  );
}

function splitAssets(value) {
  return String(value ?? "").split(";").map((item) => item.trim()).filter(Boolean);
}

const auditUrl = new URL("../../src/data/nba/audit/wizards-pilot-001-meta-grok-resolved.csv", import.meta.url);
const editorialUrl = new URL("../../src/data/nba/audit/wizards-pilot-001-editorial.json", import.meta.url);
const [auditBytes, editorialText] = await Promise.all([
  readFile(auditUrl),
  readFile(editorialUrl, "utf8"),
]);

const auditRows = parseCsv(auditBytes.toString("utf8"));
const editorial = JSON.parse(editorialText);
const editorialById = new Map(editorial.records.map((record) => [record.tradeId, record]));

if (auditRows.length !== 27 || editorial.records.length !== 27) {
  throw new Error("Phase 2I requires 27 audited rows and 27 editorial records.");
}
if (new Set(auditRows.map((row) => row["Trade ID"])).size !== 27) {
  throw new Error("Audited Trade IDs must be unique.");
}
if (new Set(auditRows.map((row) => row.Slug)).size !== 27) {
  throw new Error("Audited slugs must be unique.");
}
if (auditRows.some((row) => row["Publish Status"] !== "Hold")) {
  throw new Error("Every audited row must remain on Hold.");
}

const parsedAssets = [];
for (const row of auditRows) {
  if (!editorialById.has(row["Trade ID"])) {
    throw new Error(`Missing editorial record for ${row["Trade ID"]}.`);
  }
  for (const [direction, field] of [
    ["received", "Wizards Received"],
    ["sent", "Wizards Sent"],
  ]) {
    for (const displayText of splitAssets(row[field])) {
      parsedAssets.push({
        tradeId: row["Trade ID"],
        direction,
        asset: parseAuditedNbaAssetText(displayText, { legacyMode: true }),
      });
    }
  }
}

const unclassified = parsedAssets.filter(
  ({ asset }) => asset.type === "other" || asset.status === "unclassified"
);
if (unclassified.length) {
  throw new Error(`Unclassified audited assets:\n${JSON.stringify(unclassified, null, 2)}`);
}

const verdictCounts = Object.fromEntries(
  [...editorial.records.reduce((counts, record) => {
    counts.set(record.verdict, (counts.get(record.verdict) ?? 0) + 1);
    return counts;
  }, new Map()).entries()].sort()
);

const expectedVerdicts = {
  "Even Trade": 5,
  "Partner Win": 6,
  "Slight Partner Edge": 1,
  "Slight Wizards Edge": 5,
  "Wizards Win": 10,
};
if (JSON.stringify(verdictCounts) !== JSON.stringify(expectedVerdicts)) {
  throw new Error(`Verdict count mismatch: ${JSON.stringify(verdictCounts)}`);
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "2I",
  auditedRows: auditRows.length,
  editorialRecords: editorial.records.length,
  auditedAssets: parsedAssets.length,
  unclassifiedAssets: unclassified.length,
  verdictsPresent: editorial.records.filter((record) => record.verdict).length,
  verdictCounts,
  publishHoldPreserved: true,
  auditCsvSha256: createHash("sha256").update(auditBytes).digest("hex"),
  canonicalImports: 0,
  repositoryWrites: false,
}, null, 2));
