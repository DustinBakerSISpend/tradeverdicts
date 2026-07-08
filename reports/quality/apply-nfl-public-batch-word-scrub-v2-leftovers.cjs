const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");
const sampleArg = process.argv.find((x) => x.startsWith("--sample="));
const sample = sampleArg ? Number(sampleArg.split("=")[1]) : 120;

const dataPath = path.join("src", "data", "nfl", "trades.json");
const outTxt = path.join("reports", "quality", "nfl-public-batch-word-scrub-v2-leftovers-apply.txt");
const outJson = path.join("reports", "quality", "nfl-public-batch-word-scrub-v2-leftovers-apply.json");
const outCsv = path.join("reports", "quality", "nfl-public-batch-word-scrub-v2-leftovers-apply.csv");

const protectedNamePatterns = [
  /\bBaron\s+Batch\b/i,
  /\bCharlie\s+Batch\b/i,
  /\bDon\s+Batchelor\b/i
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

function getTrades(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trades)) return raw.trades;
  throw new Error("Could not find trades array.");
}

function setTrades(raw, trades) {
  if (Array.isArray(raw)) return trades;
  raw.trades = trades;
  return raw;
}

function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function hasProtectedName(text) {
  const s = String(text || "");
  return protectedNamePatterns.some((re) => re.test(s));
}

function scrubLeftoverBatchArtifacts(input) {
  const before = String(input || "");
  let after = before;

  // Exact leftover shapes found after v1.
  after = after.replace(/\bPost-batch\s+Vilma-only\s+re-audit\s+cleanup\b/g, "Vilma-only re-audit cleanup");
  after = after.replace(/\bpost-batch\s+Vilma-only\s+re-audit\s+cleanup\b/g, "Vilma-only re-audit cleanup");
  after = after.replace(/\bPost-batch\s+/g, "");
  after = after.replace(/\bpost-batch\s+/g, "");

  after = after.replace(/\bLandmark\s+running\s+back\s+batch\s+top-off\b/g, "Landmark running back top-off");
  after = after.replace(/\blandmark\s+running\s+back\s+batch\s+top-off\b/g, "landmark running back top-off");
  after = after.replace(/\brunning\s+back\s+batch\s+top-off\b/g, "running back top-off");
  after = after.replace(/\bbatch\s+top-off\b/g, "top-off");

  after = after
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    before,
    after,
    changed: before !== after
  };
}

function hasLeftoverArtifact(text) {
  const s = String(text || "");
  return /\bPost-batch\b/i.test(s) ||
    /\bbatch\s+top-off\b/i.test(s) ||
    /\brunning\s+back\s+batch\s+top-off\b/i.test(s) ||
    /\bLandmark\s+running\s+back\s+batch\b/i.test(s);
}

function hasAnyBatchNotProtectedOnly(text) {
  const s = String(text || "");
  if (!/\bbatch\b/i.test(s)) return false;

  // Remove protected names, then see if batch remains.
  const withoutProtected = s
    .replace(/\bBaron\s+Batch\b/gi, "")
    .replace(/\bCharlie\s+Batch\b/gi, "")
    .replace(/\bDon\s+Batchelor\b/gi, "");

  return /\bbatch\b/i.test(withoutProtected);
}

function walkStrings(value, pathParts, visitor) {
  if (value == null) return;
  if (typeof value === "string") {
    visitor(pathParts, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, pathParts.concat(index), visitor));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walkStrings(child, pathParts.concat(key), visitor);
    }
  }
}

function setAtPath(obj, pathParts, value) {
  let cur = obj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    cur = cur[pathParts[i]];
  }
  cur[pathParts[pathParts.length - 1]] = value;
}

const raw = readJson(dataPath);
const trades = getTrades(raw);

const result = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "APPLY" : "DRY-RUN",
  tradesScanned: trades.length,
  leftoverArtifactFieldsFound: 0,
  fieldsChanged: 0,
  tradesTouched: 0,
  protectedNameFieldsObserved: 0,
  remainingBatchNonProtectedFieldsAfterScrub: 0,
  applied: false,
  errors: [],
  warnings: [],
  changes: [],
  remainingNonProtectedBatchFields: [],
  protectedSamples: []
};

const touchedTradeIds = new Set();

for (const trade of trades) {
  walkStrings(trade, [], (pathParts, value) => {
    if (hasProtectedName(value)) {
      result.protectedNameFieldsObserved++;
      if (result.protectedSamples.length < sample) {
        result.protectedSamples.push({
          id: trade.id || "",
          slug: trade.slug || "",
          fieldPath: pathParts.join("."),
          value
        });
      }
    }

    if (!hasLeftoverArtifact(value)) return;

    result.leftoverArtifactFieldsFound++;

    const scrub = scrubLeftoverBatchArtifacts(value);
    const fieldPath = pathParts.join(".");

    if (!scrub.changed) {
      result.errors.push(`${trade.id || ""}/${fieldPath}: leftover artifact detected but scrub made no change`);
      return;
    }

    if (hasLeftoverArtifact(scrub.after)) {
      result.errors.push(`${trade.id || ""}/${fieldPath}: leftover artifact remains after scrub`);
      result.remainingNonProtectedBatchFields.push({
        id: trade.id || "",
        slug: trade.slug || "",
        fieldPath,
        before: value,
        after: scrub.after
      });
      return;
    }

    result.fieldsChanged++;
    touchedTradeIds.add(trade.id || "");

    result.changes.push({
      id: trade.id || "",
      slug: trade.slug || "",
      title: trade.title || "",
      fieldPath,
      before: value,
      after: scrub.after
    });

    if (apply) {
      setAtPath(trade, pathParts, scrub.after);
    }
  });
}

result.tradesTouched = touchedTradeIds.size;

// Verify non-protected batch leftovers after virtual/apply state.
for (const trade of trades) {
  walkStrings(trade, [], (pathParts, value) => {
    if (hasAnyBatchNotProtectedOnly(value)) {
      const s = String(value || "");
      if (hasLeftoverArtifact(s) || /\bbatch\s+top-off\b/i.test(s) || /\bpost-batch\b/i.test(s)) {
        result.remainingBatchNonProtectedFieldsAfterScrub++;
        if (result.remainingNonProtectedBatchFields.length < sample) {
          result.remainingNonProtectedBatchFields.push({
            id: trade.id || "",
            slug: trade.slug || "",
            fieldPath: pathParts.join("."),
            value
          });
        }
      }
    }
  });
}

if (result.errors.length === 0 && apply) {
  const backupPath = dataPath + `.public-batch-word-scrub-v2-leftovers-backup-${Date.now()}.bak`;
  fs.copyFileSync(dataPath, backupPath);
  writeJson(dataPath, setTrades(raw, trades));
  result.backupPath = backupPath;
  result.applied = true;
}

const lines = [];
lines.push("# NFL Public Batch Word Scrub v2 Leftovers Apply");
lines.push(`Generated: ${result.generatedAt}`);
lines.push(`Mode: ${result.mode}`);
lines.push("");
lines.push("## Summary");
lines.push(`- tradesScanned: ${result.tradesScanned}`);
lines.push(`- leftoverArtifactFieldsFound: ${result.leftoverArtifactFieldsFound}`);
lines.push(`- fieldsChanged: ${result.fieldsChanged}`);
lines.push(`- tradesTouched: ${result.tradesTouched}`);
lines.push(`- protectedNameFieldsObserved: ${result.protectedNameFieldsObserved}`);
lines.push(`- remainingBatchNonProtectedFieldsAfterScrub: ${result.remainingBatchNonProtectedFieldsAfterScrub}`);
lines.push(`- applied: ${result.applied}`);
lines.push(`- errors: ${result.errors.length}`);
lines.push(`- warnings: ${result.warnings.length}`);
if (result.backupPath) lines.push(`- backupPath: ${result.backupPath}`);
lines.push("");
lines.push("## Errors");
if (result.errors.length === 0) lines.push("- none");
for (const error of result.errors.slice(0, sample)) lines.push(`- ${error}`);
lines.push("");
lines.push("## Change Samples");
for (const change of result.changes.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${change.id} / ${change.fieldPath}`);
  lines.push(`- slug: ${change.slug}`);
  lines.push(`- BEFORE: ${change.before}`);
  lines.push(`- AFTER: ${change.after}`);
}
lines.push("");
lines.push("## Remaining Non-Protected Batch Samples");
if (result.remainingNonProtectedBatchFields.length === 0) lines.push("- none");
for (const hit of result.remainingNonProtectedBatchFields.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${hit.id} / ${hit.fieldPath}`);
  lines.push(`- slug: ${hit.slug}`);
  if (hit.before) lines.push(`- before: ${hit.before}`);
  if (hit.after) lines.push(`- after: ${hit.after}`);
  if (hit.value) lines.push(`- value: ${hit.value}`);
}
lines.push("");
lines.push("## Protected Name Samples");
for (const hit of result.protectedSamples.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${hit.id} / ${hit.fieldPath}`);
  lines.push(`- slug: ${hit.slug}`);
  lines.push(`- value: ${hit.value}`);
}

const csvRows = [];
csvRows.push(["id", "slug", "fieldPath", "before", "after"].map(csvEscape).join(","));
for (const change of result.changes) {
  csvRows.push([
    change.id,
    change.slug,
    change.fieldPath,
    change.before,
    change.after
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify(result, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));

if (result.errors.length > 0) {
  console.error("\nSTOP: Errors found. No data was written.");
  process.exit(1);
}
