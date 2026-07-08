const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 300);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const outTxt = path.join("reports", "quality", "nfl-public-batch-word-audit-v1.txt");
const outJson = path.join("reports", "quality", "nfl-public-batch-word-audit-v1.json");
const outCsv = path.join("reports", "quality", "nfl-public-batch-word-audit-v1.csv");

const protectedNamePatterns = [
  /\bBaron\s+Batch\b/i,
  /\bCharlie\s+Batch\b/i,
  /\bDon\s+Batchelor\b/i
];

const cleanupArtifactPatterns = [
  /\bfinal\s+Batch\s+\d+\b/i,
  /\bBatch\s+\d+\b/i,
  /\bbottom\s+batch\b/i,
  /\boldest[-\s]+first\s+batch\b/i,
  /\btop\s+batch\b/i,
  /\bQA\s+batch\b/i,
  /\bcleanup\s+batch\b/i,
  /\breview\s+batch\b/i,
  /\bbatch\s+review\b/i,
  /\bbatch\s+cleanup\b/i,
  /\bthis\s+batch\b/i,
  /\bthe\s+batch\b/i,
  /\bfrom\s+batch\b/i,
  /\bin\s+batch\b/i,
  /\bBatch\b/i
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getTrades(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trades)) return raw.trades;
  throw new Error("Could not find trades array.");
}

function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function isProtectedNameContext(text) {
  const s = String(text || "");
  return protectedNamePatterns.some((re) => re.test(s));
}

function hasBatchWordOrSubstring(text) {
  const s = String(text || "");
  return /\bbatch\b/i.test(s) || /batchelor/i.test(s);
}

function hasBatchWord(text) {
  return /\bbatch\b/i.test(String(text || ""));
}

function classify(text, fieldPath) {
  const s = String(text || "");
  const pathLower = String(fieldPath || "").toLowerCase();

  if (!hasBatchWordOrSubstring(s)) return "no_match";

  if (isProtectedNameContext(s) && !hasBatchWord(s)) {
    return "protected_batchelor_only";
  }

  if (isProtectedNameContext(s)) {
    // If the same field has a protected player name and separate cleanup artifact text,
    // keep it reviewable rather than auto-safe.
    const artifactHit = cleanupArtifactPatterns.some((re) => re.test(s));
    return artifactHit ? "mixed_protected_name_plus_possible_artifact" : "protected_player_name";
  }

  if (cleanupArtifactPatterns.some((re) => re.test(s))) {
    return "cleanup_artifact_candidate";
  }

  if (pathLower.includes("summary") || pathLower.includes("analysis") || pathLower.includes("notes") || pathLower.includes("verdict")) {
    return "public_text_batch_candidate";
  }

  return "unknown_batch_context";
}

function snippetAround(text, index, radius = 140) {
  const s = String(text || "");
  const start = Math.max(0, index - radius);
  const end = Math.min(s.length, index + radius);
  return s.slice(start, end).replace(/\s+/g, " ").trim();
}

function findBatchMatches(text) {
  const s = String(text || "");
  const matches = [];

  for (const re of [/\bbatch\b/gi, /batchelor/gi]) {
    let m;
    while ((m = re.exec(s)) !== null) {
      matches.push({
        match: m[0],
        index: m.index,
        snippet: snippetAround(s, m.index)
      });
    }
  }

  return matches.sort((a, b) => a.index - b.index);
}

function walk(value, pathParts, hits, trade) {
  if (value == null) return;

  if (typeof value === "string") {
    if (hasBatchWordOrSubstring(value)) {
      const fieldPath = pathParts.join(".");
      const matches = findBatchMatches(value);
      hits.push({
        id: trade.id || "",
        slug: trade.slug || "",
        title: trade.title || "",
        fieldPath,
        classification: classify(value, fieldPath),
        protectedContext: isProtectedNameContext(value),
        value,
        matches
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, pathParts.concat(`[${index}]`), hits, trade));
    return;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walk(child, pathParts.concat(key), hits, trade);
    }
  }
}

const raw = readJson(dataPath);
const trades = getTrades(raw);

const hits = [];

for (const trade of trades) {
  walk(trade, [], hits, trade);
}

const byClass = {};
const byField = {};
const byTrade = {};
const publicArtifactHits = hits.filter((h) =>
  h.classification === "cleanup_artifact_candidate" ||
  h.classification === "public_text_batch_candidate" ||
  h.classification === "mixed_protected_name_plus_possible_artifact" ||
  h.classification === "unknown_batch_context"
);

for (const hit of hits) {
  byClass[hit.classification] = (byClass[hit.classification] || 0) + 1;
  byField[hit.fieldPath] = (byField[hit.fieldPath] || 0) + 1;
  byTrade[hit.id] = (byTrade[hit.id] || 0) + 1;
}

const counts = {
  tradesScanned: trades.length,
  totalBatchHits: hits.length,
  publicArtifactCandidateHits: publicArtifactHits.length,
  protectedPlayerNameHits: hits.filter((h) => h.classification === "protected_player_name").length,
  protectedBatchelorOnlyHits: hits.filter((h) => h.classification === "protected_batchelor_only").length,
  mixedProtectedPlusArtifactHits: hits.filter((h) => h.classification === "mixed_protected_name_plus_possible_artifact").length,
  cleanupArtifactCandidateHits: hits.filter((h) => h.classification === "cleanup_artifact_candidate").length,
  publicTextBatchCandidateHits: hits.filter((h) => h.classification === "public_text_batch_candidate").length,
  unknownBatchContextHits: hits.filter((h) => h.classification === "unknown_batch_context").length,
  uniqueTradesWithAnyHit: Object.keys(byTrade).length,
  uniqueTradesWithPublicArtifactCandidateHit: new Set(publicArtifactHits.map((h) => h.id)).size,
  errors: 0
};

const lines = [];
lines.push("# NFL Public Batch Word Audit v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY AUDIT");
lines.push("");
lines.push("Purpose:");
lines.push("- Find public-facing cleanup artifact wording using the word batch.");
lines.push("- Protect real player-name contexts: Baron Batch, Charlie Batch, Don Batchelor.");
lines.push("- Does not modify trades.json.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Classification Counts");
for (const [k, v] of Object.entries(byClass).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Top Field Counts");
for (const [k, v] of Object.entries(byField).sort((a, b) => b[1] - a[1]).slice(0, 60)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Recommendation");
if (publicArtifactHits.length > 0) {
  lines.push("- Build an apply script only after inspecting these audit samples.");
  lines.push("- Apply should target cleanup_artifact_candidate and public_text_batch_candidate patterns.");
  lines.push("- Apply must skip protected player-name contexts and any mixed protected/player-artifact field unless separately reviewed.");
} else {
  lines.push("- No public artifact batch candidates found.");
}
lines.push("");
lines.push("## Public Artifact Candidate Samples");
for (const hit of publicArtifactHits.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${hit.id} / ${hit.fieldPath}`);
  lines.push(`- classification: ${hit.classification}`);
  lines.push(`- slug: ${hit.slug}`);
  if (hit.title) lines.push(`- title: ${hit.title}`);
  for (const m of hit.matches) {
    lines.push(`- match: ${m.match}`);
    lines.push(`- snippet: ${m.snippet}`);
  }
}
lines.push("");
lines.push("## Protected Name Samples");
for (const hit of hits.filter((h) => h.classification === "protected_player_name" || h.classification === "protected_batchelor_only").slice(0, sample)) {
  lines.push("");
  lines.push(`### ${hit.id} / ${hit.fieldPath}`);
  lines.push(`- classification: ${hit.classification}`);
  lines.push(`- slug: ${hit.slug}`);
  for (const m of hit.matches) lines.push(`- snippet: ${m.snippet}`);
}
lines.push("");
lines.push("## All Hits Brief");
for (const hit of hits.slice(0, sample)) {
  lines.push(`- ${hit.classification} | ${hit.id} | ${hit.slug} | ${hit.fieldPath} | ${hit.matches.map((m) => m.match).join(", ")}`);
}

const csvRows = [];
csvRows.push([
  "classification",
  "id",
  "slug",
  "title",
  "fieldPath",
  "protectedContext",
  "matches",
  "snippets",
  "value"
].map(csvEscape).join(","));

for (const hit of hits) {
  csvRows.push([
    hit.classification,
    hit.id,
    hit.slug,
    hit.title,
    hit.fieldPath,
    hit.protectedContext,
    hit.matches.map((m) => m.match).join(" | "),
    hit.matches.map((m) => m.snippet).join(" || "),
    hit.value
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, byClass, byField, hits, publicArtifactHits }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
