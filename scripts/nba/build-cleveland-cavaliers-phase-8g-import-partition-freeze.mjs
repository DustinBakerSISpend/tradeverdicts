#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error(`Invalid argument near ${key}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function sha256Json(value) {
  return sha256Bytes(JSON.stringify(value));
}

function collectArrays(value, output = [], keyPath = "$", depth = 0) {
  if (depth > 12 || value == null) return output;
  if (Array.isArray(value)) {
    output.push({ keyPath, value });
    for (let index = 0; index < value.length; index += 1) {
      collectArrays(value[index], output, `${keyPath}[${index}]`, depth + 1);
    }
    return output;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectArrays(child, output, `${keyPath}.${key}`, depth + 1);
    }
  }
  return output;
}

function arrayByHash(arrays, expectedHash, label) {
  const matches = arrays.filter(
    (entry) => sha256Json(entry.value) === expectedHash.toUpperCase(),
  );
  assert(matches.length === 1, `${label} array hash matched ${matches.length} arrays.`);
  return matches[0].value;
}

function parseCsv(bytes, label) {
  let text = bytes.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const finishField = () => {
    row.push(field);
    field = "";
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\n") {
      finishRow();
    } else if (character === "\r") {
      if (text[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      field += character;
    }
  }

  assert(!quoted, `${label} CSV ended inside a quoted field.`);
  if (field.length > 0 || row.length > 0) finishRow();
  while (rows.length > 0 && rows.at(-1).every((value) => value === "")) rows.pop();

  assert(rows.length >= 1, `${label} CSV is empty.`);
  const headers = rows[0].map((value) => value.trim());
  assert(headers.length > 0 && headers.every(Boolean), `${label} CSV has a blank header.`);
  assert(new Set(headers).size === headers.length, `${label} CSV has duplicate headers.`);

  return rows.slice(1).map((values, rowIndex) => {
    assert(
      values.length === headers.length,
      `${label} CSV row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}.`,
    );
    return Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex]]));
  });
}

function scalar(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvEscape(value) {
  const text = scalar(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const normalized = rows.map((row) =>
    row && typeof row === "object" && !Array.isArray(row) ? row : { value: row },
  );
  const headers = [...new Set(normalized.flatMap((row) => Object.keys(row)))].sort(
    (left, right) => left.localeCompare(right, "en"),
  );
  if (headers.length === 0) return "";
  return [
    headers.join(","),
    ...normalized.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

const args = parseArgs(process.argv);
for (const required of [
  "phase8f-freeze-json",
  "contract-md",
  "expected-package-readiness-sha",
  "expected-identity-occurrences-sha",
  "expected-proposed-shells-sha",
  "expected-relationship-previews-sha",
  "output-dir",
]) {
  assert(args[required], `Missing --${required}.`);
}

const phase8FDirectory = path.dirname(args["phase8f-freeze-json"]);
const heldCsvPath = path.join(
  phase8FDirectory,
  "cleveland-cavaliers-phase-8f-input-held-records.csv",
);
const excludedCsvPath = path.join(
  phase8FDirectory,
  "cleveland-cavaliers-phase-8f-excluded-followups.csv",
);

const [freezeBytes, contractBytes, heldCsvBytes, excludedCsvBytes] = await Promise.all([
  readFile(args["phase8f-freeze-json"]),
  readFile(args["contract-md"]),
  readFile(heldCsvPath),
  readFile(excludedCsvPath),
]);
const phase8F = JSON.parse(freezeBytes.toString("utf8"));
const arrays = collectArrays(phase8F);
const priorHeldRecords = parseCsv(heldCsvBytes, "Phase 8F input-held records");
const excludedRecords = parseCsv(excludedCsvBytes, "Phase 8F excluded followups");

assert(phase8F.result === "PASS" && phase8F.phase === "8F", "Invalid Phase 8F freeze.");
assert(phase8F.counts?.sourceRows === 204, "Phase 8F source-row count drifted.");
assert(phase8F.counts?.eligibleInputPackages === 150, "Eligible package count drifted.");
assert(phase8F.counts?.inputHeldRecords === 44, "Input-held count drifted.");
assert(phase8F.counts?.excludedRecords === 10, "Excluded count drifted.");
assert(phase8F.counts?.readyPackages === 150, "Ready package count drifted.");
assert(phase8F.counts?.heldIdentityPackages === 0, "Identity holds must be zero.");
assert(phase8F.counts?.proposedPlayerShells === 238, "Proposed shell count drifted.");
assert(phase8F.counts?.relationshipPreviewEdges === 446, "Relationship count drifted.");
assert(phase8F.counts?.ambiguousIdentityOccurrences === 0, "Ambiguous identities remain.");
assert(phase8F.counts?.unsafeIdentityOccurrences === 0, "Unsafe identities remain.");
assert(priorHeldRecords.length === 44, "Phase 8F input-held CSV must contain 44 records.");
assert(excludedRecords.length === 10, "Phase 8F excluded-followups CSV must contain 10 records.");

const expected = {
  packageReadinessSha256: args["expected-package-readiness-sha"].toUpperCase(),
  identityOccurrencesSha256: args["expected-identity-occurrences-sha"].toUpperCase(),
  proposedPlayerShellsSha256: args["expected-proposed-shells-sha"].toUpperCase(),
  relationshipPreviewsSha256: args["expected-relationship-previews-sha"].toUpperCase(),
};
for (const [field, hash] of Object.entries(expected)) {
  assert(
    String(phase8F.hashes?.[field] ?? "").toUpperCase() === hash,
    `Phase 8F ${field} drifted.`,
  );
}

const packageReadiness = arrayByHash(
  arrays,
  expected.packageReadinessSha256,
  "Package readiness",
);
const identityOccurrences = arrayByHash(
  arrays,
  expected.identityOccurrencesSha256,
  "Identity occurrences",
);
const proposedPlayerShells = arrayByHash(
  arrays,
  expected.proposedPlayerShellsSha256,
  "Proposed player shells",
);
const relationshipPreviews = arrayByHash(
  arrays,
  expected.relationshipPreviewsSha256,
  "Relationship previews",
);

assert(packageReadiness.length === 150, "Package-readiness array must contain 150 rows.");
assert(identityOccurrences.length === 446, "Identity-occurrence array must contain 446 rows.");
assert(proposedPlayerShells.length === 238, "Proposed-shell array must contain 238 rows.");
assert(relationshipPreviews.length === 446, "Relationship array must contain 446 rows.");

const remainingHeldPackages = [];
const counts = {
  sourceRows: 204,
  phase8FEligiblePackages: 150,
  finalReadyPackages: 150,
  remainingHeldPackages: 0,
  priorHeldRecords: 44,
  excludedRecords: 10,
  proposedPlayerShells: 238,
  relationshipPreviews: 446,
  ambiguousIdentityOccurrences: 0,
  unsafeIdentityOccurrences: 0,
  archiveReadyPackages: Number(phase8F.counts?.archiveReadyPackages ?? 5),
};

const finalPackageRecordsSha256 = sha256Json(packageReadiness);
const priorHeldRecordsSha256 = sha256Json(priorHeldRecords);
const excludedRecordsSha256 = sha256Json(excludedRecords);
const finalProposedPlayerShellsSha256 = sha256Json(proposedPlayerShells);
const finalRelationshipPreviewsSha256 = sha256Json(relationshipPreviews);
const importPartitionPayload = {
  finalReadyPackages: packageReadiness,
  remainingHeldPackages,
  priorHeldRecords,
  excludedRecords,
  proposedPlayerShells,
  relationshipPreviews,
};
const importPartitionSha256 = sha256Json(importPartitionPayload);

const hashes = {
  finalPackageRecordsSha256,
  priorHeldRecordsSha256,
  excludedRecordsSha256,
  finalProposedPlayerShellsSha256,
  finalRelationshipPreviewsSha256,
  importPartitionSha256,
  contractSha256: sha256Bytes(contractBytes),
};

assert(
  finalPackageRecordsSha256 === expected.packageReadinessSha256,
  "Final package hash must equal the frozen Phase 8F readiness hash.",
);
assert(
  finalProposedPlayerShellsSha256 === expected.proposedPlayerShellsSha256,
  "Final shell hash must equal the frozen Phase 8F shell hash.",
);
assert(
  finalRelationshipPreviewsSha256 === expected.relationshipPreviewsSha256,
  "Final relationship hash must equal the frozen Phase 8F relationship hash.",
);

const manifest = {
  result: "PASS",
  phase: "8G",
  mode: "zero-blocker-final-import-partition-freeze",
  sourceHashes: {
    phase8FFileSha256: sha256Bytes(freezeBytes),
    phase8FInputHeldCsvSha256: sha256Bytes(heldCsvBytes),
    phase8FExcludedFollowupsCsvSha256: sha256Bytes(excludedCsvBytes),
    ...expected,
  },
  counts,
  finalReadyPackages: packageReadiness,
  remainingHeldPackages,
  priorHeldRecords,
  excludedRecords,
  proposedPlayerShells,
  relationshipPreviews,
  hashes,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
};

const summary = {
  result: manifest.result,
  phase: manifest.phase,
  mode: manifest.mode,
  sourceHashes: manifest.sourceHashes,
  counts,
  hashes,
  safety: {
    canonicalImports: 0,
    playerImports: 0,
    teamRegistryWrites: 0,
    perspectiveWrites: 0,
    relationshipWrites: 0,
    routeDataWrites: 0,
    automaticIdentityMerges: 0,
    automaticCanonicalMerges: 0,
    publicationAuthorized: false,
    pushPerformed: false,
    deployPerformed: false,
  },
};

const outputDir = args["output-dir"];
await mkdir(outputDir, { recursive: true });
const writes = [
  ["cleveland-cavaliers-phase-8g-final-import-partition.json", JSON.stringify(manifest, null, 2) + "\n"],
  ["cleveland-cavaliers-phase-8g-final-ready-packages.csv", toCsv(packageReadiness)],
  ["cleveland-cavaliers-phase-8g-remaining-held-packages.csv", toCsv(remainingHeldPackages)],
  ["cleveland-cavaliers-phase-8g-prior-held-records.csv", heldCsvBytes],
  ["cleveland-cavaliers-phase-8g-excluded-records.csv", excludedCsvBytes],
  ["cleveland-cavaliers-phase-8g-final-proposed-player-shells.csv", toCsv(proposedPlayerShells)],
  ["cleveland-cavaliers-phase-8g-final-relationship-previews.csv", toCsv(relationshipPreviews)],
  ["cleveland-cavaliers-phase-8g-summary.json", JSON.stringify(summary, null, 2) + "\n"],
];
await Promise.all(
  writes.map(([name, content]) => writeFile(path.join(outputDir, name), content)),
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "8G",
  mode: manifest.mode,
  counts,
  hashes,
  sourceHashes: manifest.sourceHashes,
  canonicalImports: 0,
  playerImports: 0,
  teamRegistryWrites: 0,
  perspectiveWrites: 0,
  relationshipWrites: 0,
  routeDataWrites: 0,
  automaticIdentityMerges: 0,
  automaticCanonicalMerges: 0,
  publicationAuthorized: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
