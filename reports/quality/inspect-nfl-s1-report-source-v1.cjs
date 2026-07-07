const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 80);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const splitTxtPath = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.txt");
const splitJsonPath = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.json");
const outTxt = path.join("reports", "quality", "nfl-s1-report-source-inspection-v1.txt");
const outJson = path.join("reports", "quality", "nfl-s1-report-source-inspection-v1.json");

const S1 = "S1_clean_multi_pick_split_plus_dedupe_candidate";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getTrades(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trades)) return raw.trades;
  throw new Error("Could not find trades array.");
}

function textOf(asset) {
  if (asset == null) return "";
  if (typeof asset === "string") return asset;
  if (typeof asset !== "object") return String(asset);
  return asset.asset || asset.name || asset.label || asset.description || asset.value || asset.title || "";
}

function typeOf(asset) {
  if (asset && typeof asset === "object" && asset.type) return String(asset.type);
  return "";
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[â€“â€”]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function safeStringify(value, max = 900) {
  let s;
  try {
    s = JSON.stringify(value, null, 2);
  } catch {
    s = String(value);
  }
  if (s.length > max) return s.slice(0, max) + "...";
  return s;
}

function extractReportS1CountFromText() {
  if (!fs.existsSync(splitTxtPath)) return null;
  const text = fs.readFileSync(splitTxtPath, "utf8");
  const m = text.match(/S1_clean_multi_pick_split_plus_dedupe_candidate:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function collectObjectsByKey(obj, keyName, pathParts = [], out = []) {
  if (!obj || typeof obj !== "object") return out;

  if (Array.isArray(obj)) {
    obj.forEach((v, i) => collectObjectsByKey(v, keyName, pathParts.concat(String(i)), out));
    return out;
  }

  for (const [k, v] of Object.entries(obj)) {
    const nextPath = pathParts.concat(k);
    if (k === keyName) {
      if (Array.isArray(v)) {
        v.forEach((item, index) => out.push({ sourcePath: nextPath.join("."), index, item }));
      } else {
        out.push({ sourcePath: nextPath.join("."), index: null, item: v });
      }
    }
    collectObjectsByKey(v, keyName, nextPath, out);
  }

  return out;
}

function objectContainsNeedle(obj, needle) {
  try {
    return JSON.stringify(obj).includes(needle);
  } catch {
    return false;
  }
}

function collectObjectsContainingNeedle(obj, needle, pathParts = [], out = []) {
  if (!obj || typeof obj !== "object") return out;

  if (Array.isArray(obj)) {
    obj.forEach((v, i) => collectObjectsContainingNeedle(v, needle, pathParts.concat(String(i)), out));
    return out;
  }

  // Candidate object heuristic: an object with id/slug/team/before/assetText-ish fields and the S1 label somewhere.
  const keys = Object.keys(obj);
  const candidateish =
    keys.some((k) => ["id", "tradeId", "slug", "team", "assetIndex", "assetText", "before", "lane", "category", "classification", "bucket"].includes(k)) &&
    objectContainsNeedle(obj, needle);

  if (candidateish) {
    out.push({ sourcePath: pathParts.join("."), item: obj });
    return out;
  }

  for (const [k, v] of Object.entries(obj)) {
    collectObjectsContainingNeedle(v, needle, pathParts.concat(k), out);
  }

  return out;
}

function findTopLevelShapes(obj) {
  const lines = [];
  if (!obj || typeof obj !== "object") return lines;

  lines.push(`rootType: ${Array.isArray(obj) ? "array" : typeof obj}`);

  if (Array.isArray(obj)) {
    lines.push(`rootLength: ${obj.length}`);
    if (obj[0] && typeof obj[0] === "object") lines.push(`firstItemKeys: ${Object.keys(obj[0]).join(", ")}`);
    return lines;
  }

  const keys = Object.keys(obj);
  lines.push(`topLevelKeys: ${keys.join(", ")}`);

  for (const key of keys.slice(0, 40)) {
    const val = obj[key];
    if (Array.isArray(val)) {
      lines.push(`${key}: array length ${val.length}${val[0] && typeof val[0] === "object" ? " firstKeys=" + Object.keys(val[0]).join(", ") : ""}`);
    } else if (val && typeof val === "object") {
      const childKeys = Object.keys(val);
      lines.push(`${key}: object keys=${childKeys.slice(0, 30).join(", ")}${childKeys.length > 30 ? "..." : ""}`);
    } else {
      lines.push(`${key}: ${typeof val} ${String(val).slice(0, 120)}`);
    }
  }

  return lines;
}

function grepLinesAroundS1(file, maxBlocks = 12) {
  if (!fs.existsSync(file)) return [`missing: ${file}`];

  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(S1)) {
      const start = Math.max(0, i - 4);
      const end = Math.min(lines.length - 1, i + 12);
      hits.push({ line: i + 1, block: lines.slice(start, end + 1) });
      if (hits.length >= maxBlocks) break;
    }
  }

  if (hits.length === 0) return [`no ${S1} hits in ${file}`];

  const out = [];
  for (const hit of hits) {
    out.push(`--- hit around line ${hit.line} in ${file} ---`);
    out.push(...hit.block);
  }
  return out;
}

function getCandidateText(item) {
  return item.assetText || item.before || item.text || item.asset || item.value || item.description || "";
}

function getCandidateId(item) {
  return item.id || item.tradeId || item.tradeID || item.recordId || "";
}

function getCandidateTeam(item) {
  return item.team || item.teamKey || item.sourceBucket || item.bucket || "";
}

function getCandidateSlug(item) {
  return item.slug || "";
}

function getCandidateAssetIndex(item) {
  const v = item.assetIndex ?? item.index ?? item.assetIdx;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

const reportCount = extractReportS1CountFromText();
const splitJson = fs.existsSync(splitJsonPath) ? readJson(splitJsonPath) : null;
const splitJsonShape = findTopLevelShapes(splitJson);

let byKey = splitJson ? collectObjectsByKey(splitJson, S1) : [];
let containing = splitJson ? collectObjectsContainingNeedle(splitJson, S1) : [];

let extracted = [];

for (const entry of byKey) {
  if (Array.isArray(entry.item)) {
    entry.item.forEach((item, idx) => extracted.push({ extractionMethod: "key-array-nested", sourcePath: entry.sourcePath, index: idx, item }));
  } else if (entry.item && typeof entry.item === "object" && Array.isArray(entry.item.items)) {
    entry.item.items.forEach((item, idx) => extracted.push({ extractionMethod: "key-object-items", sourcePath: entry.sourcePath, index: idx, item }));
  } else if (entry.item && typeof entry.item === "object") {
    extracted.push({ extractionMethod: "key-object", sourcePath: entry.sourcePath, index: entry.index, item: entry.item });
  }
}

for (const entry of containing) {
  extracted.push({ extractionMethod: "needle-object", sourcePath: entry.sourcePath, index: null, item: entry.item });
}

// Deduplicate extracted records by id/team/index/text/raw path fallback.
const seen = new Set();
const unique = [];

for (const x of extracted) {
  const item = x.item || {};
  const key = [
    getCandidateId(item),
    getCandidateTeam(item),
    getCandidateSlug(item),
    getCandidateAssetIndex(item),
    getCandidateText(item),
    x.sourcePath
  ].join("|||");

  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(x);
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const hydrated = unique.map((entry, idx) => {
  const item = entry.item || {};
  const id = getCandidateId(item);
  const team = getCandidateTeam(item);
  const slug = getCandidateSlug(item);
  const assetIndex = getCandidateAssetIndex(item);
  const reportText = getCandidateText(item);

  const out = {
    ordinal: idx + 1,
    extractionMethod: entry.extractionMethod,
    sourcePath: entry.sourcePath,
    id,
    team,
    slug,
    assetIndex,
    reportText,
    itemKeys: Object.keys(item),
    currentFound: false,
    currentText: "",
    currentType: "",
    currentMatch: false,
    rawItemPreview: safeStringify(item, 1000)
  };

  const trade = id ? byId.get(id) : null;

  if (trade && team && Array.isArray(trade.assetsReceived && trade.assetsReceived[team]) && assetIndex !== null && assetIndex >= 0 && assetIndex < trade.assetsReceived[team].length) {
    const asset = trade.assetsReceived[team][assetIndex];
    out.currentFound = true;
    out.currentText = textOf(asset);
    out.currentType = typeOf(asset);
    out.currentMatch = norm(out.currentText) === norm(reportText);
  } else if (trade && team && Array.isArray(trade.assetsReceived && trade.assetsReceived[team]) && reportText) {
    const bucket = trade.assetsReceived[team];
    const foundIndex = bucket.findIndex((asset) => norm(textOf(asset)) === norm(reportText));
    if (foundIndex >= 0) {
      const asset = bucket[foundIndex];
      out.currentFound = true;
      out.currentText = textOf(asset);
      out.currentType = typeOf(asset);
      out.currentMatch = true;
      out.assetIndex = foundIndex;
      out.assetIndexResolvedByText = true;
    }
  }

  return out;
});

const counts = {
  reportS1CountFromTxt: reportCount,
  extractedByExactKeyCount: byKey.length,
  extractedContainingNeedleCount: containing.length,
  uniqueExtractedCandidateObjects: unique.length,
  hydratedRecords: hydrated.length,
  currentFoundCount: hydrated.filter((x) => x.currentFound).length,
  currentMatchCount: hydrated.filter((x) => x.currentMatch).length,
  currentMissingOrMismatchCount: hydrated.filter((x) => !x.currentMatch).length,
  errors: 0
};

const extractionMethodCounts = {};
const sourcePathCounts = {};
const keyShapeCounts = {};

for (const item of hydrated) {
  extractionMethodCounts[item.extractionMethod] = (extractionMethodCounts[item.extractionMethod] || 0) + 1;
  sourcePathCounts[item.sourcePath] = (sourcePathCounts[item.sourcePath] || 0) + 1;
  const keyShape = item.itemKeys.sort().join(",");
  keyShapeCounts[keyShape] = (keyShapeCounts[keyShape] || 0) + 1;
}

const txtS1Context = grepLinesAroundS1(splitTxtPath, 10);
const jsonS1Context = grepLinesAroundS1(splitJsonPath, 10);

const lines = [];
lines.push("# NFL S1 Report Source Inspection v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY INSPECTION");
lines.push("");
lines.push("Purpose:");
lines.push("- Inspect where S1_clean_multi_pick_split_plus_dedupe_candidate is coming from.");
lines.push("- Explain why the direct current trades.json S1 derivation found 0 items while the report says 308.");
lines.push("- Does not modify trades.json.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Split Candidate JSON Shape");
for (const line of splitJsonShape) lines.push(`- ${line}`);
lines.push("");
lines.push("## Extraction Method Counts");
if (Object.keys(extractionMethodCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(extractionMethodCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Source Path Counts");
if (Object.keys(sourcePathCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(sourcePathCounts).sort((a, b) => b[1] - a[1]).slice(0, 80)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Key Shape Counts");
if (Object.keys(keyShapeCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(keyShapeCounts).sort((a, b) => b[1] - a[1]).slice(0, 30)) lines.push(`- ${v}x keys: ${k}`);
lines.push("");
lines.push("## Hydrated S1 Object Samples");
for (const item of hydrated.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. method=${item.extractionMethod} path=${item.sourcePath}`);
  lines.push(`- id: ${item.id || "(missing)"}`);
  lines.push(`- team: ${item.team || "(missing)"}`);
  lines.push(`- slug: ${item.slug || "(missing)"}`);
  lines.push(`- assetIndex: ${item.assetIndex === null ? "(missing)" : item.assetIndex}`);
  lines.push(`- currentFound: ${item.currentFound}`);
  lines.push(`- currentMatch: ${item.currentMatch}`);
  lines.push(`- reportText: ${item.reportText || "(missing)"}`);
  lines.push(`- currentType: ${item.currentType || "(missing)"}`);
  lines.push(`- currentText: ${item.currentText || "(missing)"}`);
  lines.push(`- itemKeys: ${item.itemKeys.join(", ")}`);
  lines.push(`- rawItemPreview: ${item.rawItemPreview.replace(/\n/g, " ")}`);
}
lines.push("");
lines.push("## Text Report S1 Context");
for (const line of txtS1Context.slice(0, 240)) lines.push(line);
lines.push("");
lines.push("## JSON Report S1 Context");
for (const line of jsonS1Context.slice(0, 240)) lines.push(line);
lines.push("");
lines.push("## Interpretation Hints");
lines.push("- If uniqueExtractedCandidateObjects is 0 but reportS1CountFromTxt is 308, the S1 count is summary-only in the JSON/text, not an itemized actionable lane.");
lines.push("- If currentMatchCount is 0, any S1 report objects are stale or not shaped with id/team/assetIndex/text.");
lines.push("- If currentMatchCount is high, next step is a stricter itemized review using the exact report objects.");
lines.push("- Do not apply anything from S1 until this source inspection explains the mismatch.");

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, splitJsonShape, extractionMethodCounts, sourcePathCounts, keyShapeCounts, hydrated, txtS1Context, jsonS1Context }, null, 2) + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
