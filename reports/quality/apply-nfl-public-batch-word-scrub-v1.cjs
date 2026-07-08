const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");
const sampleArg = process.argv.find((x) => x.startsWith("--sample="));
const sample = sampleArg ? Number(sampleArg.split("=")[1]) : 400;

const dataPath = path.join("src", "data", "nfl", "trades.json");
const auditPath = path.join("reports", "quality", "nfl-public-batch-word-audit-v1.json");
const outTxt = path.join("reports", "quality", "nfl-public-batch-word-scrub-apply-v1.txt");
const outJson = path.join("reports", "quality", "nfl-public-batch-word-scrub-apply-v1.json");
const outCsv = path.join("reports", "quality", "nfl-public-batch-word-scrub-apply-v1.csv");

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

function hasBatchCleanupArtifact(text) {
  const s = String(text || "");
  return /\b(?:final\s+)?Batch\s+\d+\b/i.test(s) ||
    /\b(?:bottom|oldest[-\s]+first|top|qa|cleanup|review)\s+batch\b/i.test(s) ||
    /\bbatch\s+(?:review|cleanup)\b/i.test(s) ||
    /\b(?:this|the|from|in)\s+batch\b/i.test(s);
}

function normalizeWhitespaceAndPunctuation(s) {
  return String(s || "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\bThe review review\b/gi, "The review")
    .replace(/\breview review\b/gi, "review")
    .replace(/\bfinal review review\b/gi, "final review")
    .replace(/\bQA review review\b/g, "QA review")
    .replace(/\bthe QA review\b/gi, "the review")
    .trim();
}

function scrubBatchArtifacts(input) {
  let s = String(input || "");
  const before = s;

  // Most common exact artifact: "The final Batch 019 review..."
  s = s.replace(/\bThe\s+final\s+Batch\s+\d+\s+review\b/g, "The final review");
  s = s.replace(/\bthe\s+final\s+Batch\s+\d+\s+review\b/g, "the final review");
  s = s.replace(/\bFinal\s+Batch\s+\d+\s+review\b/g, "Final review");
  s = s.replace(/\bfinal\s+Batch\s+\d+\s+review\b/g, "final review");

  // Other numbered batch-review forms.
  s = s.replace(/\bThe\s+(?:bottom|oldest[-\s]+first|top|QA|cleanup|review)\s+Batch\s+\d+\s+review\b/gi, "The review");
  s = s.replace(/\b(?:bottom|oldest[-\s]+first|top|QA|cleanup|review)\s+Batch\s+\d+\s+review\b/gi, "review");
  s = s.replace(/\bThe\s+Batch\s+\d+\s+review\b/g, "The review");
  s = s.replace(/\bthe\s+Batch\s+\d+\s+review\b/g, "the review");
  s = s.replace(/\bBatch\s+\d+\s+review\b/g, "review");
  s = s.replace(/\bbatch\s+\d+\s+review\b/g, "review");

  // Numbered batch without "review."
  s = s.replace(/\bThe\s+final\s+Batch\s+\d+\b/g, "The final review");
  s = s.replace(/\bthe\s+final\s+Batch\s+\d+\b/g, "the final review");
  s = s.replace(/\bfinal\s+Batch\s+\d+\b/gi, "final review");
  s = s.replace(/\bThe\s+(?:bottom|oldest[-\s]+first|top|QA|cleanup|review)\s+Batch\s+\d+\b/gi, "The review");
  s = s.replace(/\b(?:bottom|oldest[-\s]+first|top|QA|cleanup|review)\s+Batch\s+\d+\b/gi, "review");
  s = s.replace(/\bBatch\s+\d+\b/g, "review");
  s = s.replace(/\bbatch\s+\d+\b/g, "review");

  // Unnumbered cleanup phrases.
  s = s.replace(/\bthe\s+bottom\s+batch\s+review\b/gi, "the review");
  s = s.replace(/\bbottom\s+batch\s+review\b/gi, "review");
  s = s.replace(/\bthe\s+oldest[-\s]+first\s+batch\s+review\b/gi, "the review");
  s = s.replace(/\boldest[-\s]+first\s+batch\s+review\b/gi, "review");
  s = s.replace(/\bthe\s+QA\s+batch\s+review\b/g, "the review");
  s = s.replace(/\bQA\s+batch\s+review\b/g, "review");
  s = s.replace(/\bthe\s+cleanup\s+batch\s+review\b/gi, "the review");
  s = s.replace(/\bcleanup\s+batch\s+review\b/gi, "review");
  s = s.replace(/\bthis\s+batch\s+review\b/gi, "this review");
  s = s.replace(/\bthe\s+batch\s+review\b/gi, "the review");
  s = s.replace(/\bbatch\s+review\b/gi, "review");

  // Sentences like "In this batch, ..." / "From this batch, ..."
  s = s.replace(/\bIn\s+this\s+batch,\s*/g, "");
  s = s.replace(/\bin\s+this\s+batch,\s*/g, "");
  s = s.replace(/\bFrom\s+this\s+batch,\s*/g, "");
  s = s.replace(/\bfrom\s+this\s+batch,\s*/g, "");
  s = s.replace(/\bThis\s+batch\s+/g, "This review ");
  s = s.replace(/\bthis\s+batch\s+/g, "this review ");
  s = s.replace(/\bThe\s+batch\s+/g, "The review ");
  s = s.replace(/\bthe\s+batch\s+/g, "the review ");

  s = normalizeWhitespaceAndPunctuation(s);

  return {
    before,
    after: s,
    changed: s !== before
  };
}

function unresolvedArtifact(text) {
  const s = String(text || "");
  const protectedOnly = protectedNamePatterns.some((re) => re.test(s)) && !hasBatchCleanupArtifact(s);
  if (protectedOnly) return false;
  return hasBatchCleanupArtifact(s);
}

function getAtPath(obj, pathParts) {
  let cur = obj;
  for (const part of pathParts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setAtPath(obj, pathParts, value) {
  let cur = obj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    cur = cur[pathParts[i]];
  }
  cur[pathParts[pathParts.length - 1]] = value;
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

const raw = readJson(dataPath);
const trades = getTrades(raw);
const audit = fs.existsSync(auditPath) ? readJson(auditPath) : null;

const result = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "APPLY" : "DRY-RUN",
  tradesScanned: trades.length,
  auditCounts: audit ? audit.counts : null,
  stringFieldsWithBatchArtifact: 0,
  stringFieldsChanged: 0,
  stringFieldsUnchangedProtectedOnly: 0,
  mixedProtectedContextFieldsChanged: 0,
  unresolvedArtifactFieldsAfterScrub: 0,
  tradesTouched: 0,
  changedByFieldPath: {},
  remainingByFieldPath: {},
  applied: false,
  errors: [],
  warnings: [],
  changes: [],
  unresolved: [],
  protectedOnly: []
};

const touchedTradeIds = new Set();

for (const trade of trades) {
  walkStrings(trade, [], (pathParts, value) => {
    if (!/\bbatch\b|batchelor/i.test(value)) return;

    const protectedContext = hasProtectedName(value);
    const artifactContext = hasBatchCleanupArtifact(value);

    if (!artifactContext) {
      if (protectedContext) {
        result.stringFieldsUnchangedProtectedOnly++;
        result.protectedOnly.push({
          id: trade.id || "",
          slug: trade.slug || "",
          fieldPath: pathParts.join("."),
          value
        });
      }
      return;
    }

    result.stringFieldsWithBatchArtifact++;

    const scrub = scrubBatchArtifacts(value);
    const fieldPath = pathParts.join(".");

    if (!scrub.changed) {
      result.errors.push(`${trade.id || ""}/${fieldPath}: artifact detected but scrub made no change`);
      result.unresolved.push({
        id: trade.id || "",
        slug: trade.slug || "",
        fieldPath,
        before: value,
        after: scrub.after,
        reason: "artifact_detected_but_no_change"
      });
      return;
    }

    if (protectedContext) result.mixedProtectedContextFieldsChanged++;

    if (unresolvedArtifact(scrub.after)) {
      result.unresolvedArtifactFieldsAfterScrub++;
      result.errors.push(`${trade.id || ""}/${fieldPath}: unresolved batch artifact after scrub`);
      result.unresolved.push({
        id: trade.id || "",
        slug: trade.slug || "",
        fieldPath,
        before: value,
        after: scrub.after,
        reason: "unresolved_artifact_after_scrub"
      });
      return;
    }

    result.stringFieldsChanged++;
    result.changedByFieldPath[fieldPath] = (result.changedByFieldPath[fieldPath] || 0) + 1;
    touchedTradeIds.add(trade.id || "");

    result.changes.push({
      id: trade.id || "",
      slug: trade.slug || "",
      title: trade.title || "",
      fieldPath,
      protectedContext,
      before: value,
      after: scrub.after
    });

    if (apply) {
      setAtPath(trade, pathParts, scrub.after);
    }
  });
}

result.tradesTouched = touchedTradeIds.size;

if (result.errors.length === 0 && apply) {
  const backupPath = dataPath + `.public-batch-word-scrub-backup-${Date.now()}.bak`;
  fs.copyFileSync(dataPath, backupPath);
  writeJson(dataPath, setTrades(raw, trades));
  result.backupPath = backupPath;
  result.applied = true;
}

const lines = [];
lines.push("# NFL Public Batch Word Scrub Apply v1");
lines.push(`Generated: ${result.generatedAt}`);
lines.push(`Mode: ${result.mode}`);
lines.push("");
lines.push("## Summary");
lines.push(`- tradesScanned: ${result.tradesScanned}`);
if (result.auditCounts) {
  lines.push(`- auditTotalBatchHits: ${result.auditCounts.totalBatchHits}`);
  lines.push(`- auditPublicArtifactCandidateHits: ${result.auditCounts.publicArtifactCandidateHits}`);
  lines.push(`- auditUniqueTradesWithPublicArtifactCandidateHit: ${result.auditCounts.uniqueTradesWithPublicArtifactCandidateHit}`);
}
lines.push(`- stringFieldsWithBatchArtifact: ${result.stringFieldsWithBatchArtifact}`);
lines.push(`- stringFieldsChanged: ${result.stringFieldsChanged}`);
lines.push(`- stringFieldsUnchangedProtectedOnly: ${result.stringFieldsUnchangedProtectedOnly}`);
lines.push(`- mixedProtectedContextFieldsChanged: ${result.mixedProtectedContextFieldsChanged}`);
lines.push(`- unresolvedArtifactFieldsAfterScrub: ${result.unresolvedArtifactFieldsAfterScrub}`);
lines.push(`- tradesTouched: ${result.tradesTouched}`);
lines.push(`- applied: ${result.applied}`);
lines.push(`- errors: ${result.errors.length}`);
lines.push(`- warnings: ${result.warnings.length}`);
if (result.backupPath) lines.push(`- backupPath: ${result.backupPath}`);
lines.push("");
lines.push("## Changed Field Counts");
for (const [field, count] of Object.entries(result.changedByFieldPath).sort((a, b) => b[1] - a[1])) {
  lines.push(`- ${field}: ${count}`);
}
if (Object.keys(result.changedByFieldPath).length === 0) lines.push("- none");
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
  lines.push(`- protectedContext: ${change.protectedContext}`);
  lines.push(`- BEFORE: ${change.before}`);
  lines.push(`- AFTER: ${change.after}`);
}
lines.push("");
lines.push("## Protected-Only Samples Left Untouched");
for (const protectedHit of result.protectedOnly.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${protectedHit.id} / ${protectedHit.fieldPath}`);
  lines.push(`- slug: ${protectedHit.slug}`);
  lines.push(`- value: ${protectedHit.value}`);
}
lines.push("");
lines.push("## Unresolved Samples");
for (const unresolved of result.unresolved.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${unresolved.id} / ${unresolved.fieldPath}`);
  lines.push(`- slug: ${unresolved.slug}`);
  lines.push(`- reason: ${unresolved.reason}`);
  lines.push(`- before: ${unresolved.before}`);
  lines.push(`- after: ${unresolved.after}`);
}

const csvRows = [];
csvRows.push([
  "id",
  "slug",
  "fieldPath",
  "protectedContext",
  "before",
  "after"
].map(csvEscape).join(","));

for (const change of result.changes) {
  csvRows.push([
    change.id,
    change.slug,
    change.fieldPath,
    change.protectedContext,
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
