const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const dryRunPath = path.join(outDir, "asset-line-duplicates-dry-run.json");
const applyReportPath = path.join(outDir, "asset-line-duplicates-apply-report.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const rawText = fs.readFileSync(dataPath, "utf8");
const raw = JSON.parse(rawText);
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : null;

if (!Array.isArray(trades)) {
  console.error("Could not find trades array.");
  console.error("Top-level keys:", Object.keys(raw || {}));
  process.exit(1);
}

function normalizeAssetText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/\bsubsequently traded\b/g, "subsequently traded")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTopLevelAssetParts(s) {
  const text = String(s || "");
  const parts = [];
  let buf = "";
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);

    if (depth === 0 && ch === ",") {
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
      continue;
    }

    const rest = text.slice(i);
    const andMatch = rest.match(/^\s+and\s+/i);
    if (depth === 0 && andMatch) {
      if (buf.trim()) parts.push(buf.trim());
      i += andMatch[0].length - 1;
      buf = "";
      continue;
    }

    buf += ch;
  }

  if (buf.trim()) parts.push(buf.trim());

  return parts
    .map(p => p.replace(/^\s*and\s+/i, "").replace(/\s+and\s*$/i, "").trim())
    .filter(Boolean);
}

function componentSignature(asset) {
  const parts = splitTopLevelAssetParts(asset)
    .map(normalizeAssetText)
    .filter(Boolean)
    .sort();

  return {
    partCount: parts.length,
    signature: parts.join(" || "),
    parts
  };
}

function scoreKeepCandidate(entry, groupType) {
  const asset = String(entry.asset || "");
  const sig = componentSignature(asset);

  let score = 0;

  // Prefer clearer bundle prose for equivalent comma-vs-and duplicates.
  if (groupType === "equivalentCompositeSignature") {
    if (/\sand\s/i.test(asset)) score += 50;
    if (sig.partCount >= 3 && /,\s*[^,]+\s+and\s+/i.test(asset)) score += 25;
  }

  // Prefer preserving more explicit, more informative strings.
  score += Math.min(asset.length, 500) / 1000;

  // Prefer original first item only as final tie-breaker.
  score -= entry.index / 100000;

  return score;
}

function chooseKeeper(entries, groupType) {
  return [...entries].sort((a, b) => {
    const delta = scoreKeepCandidate(b, groupType) - scoreKeepCandidate(a, groupType);
    if (delta !== 0) return delta;
    return a.index - b.index;
  })[0];
}

function slugOf(trade) {
  return String(trade.slug || trade.id || trade.urlSlug || "").trim();
}

function getAssetsForTeam(trade, team) {
  const assets = trade.assetsReceived && trade.assetsReceived[team];
  return Array.isArray(assets) ? assets : [];
}

function cloneEntry(entry) {
  return {
    index: entry.index,
    type: entry.item && entry.item.type ? entry.item.type : null,
    asset: entry.item && entry.item.asset ? entry.item.asset : null
  };
}

const changes = [];
let totalLinesRemoved = 0;
let tradesTouched = 0;

for (const trade of trades) {
  if (!trade.assetsReceived || typeof trade.assetsReceived !== "object" || Array.isArray(trade.assetsReceived)) continue;

  const slug = slugOf(trade);
  let tradeTouched = false;

  for (const team of Object.keys(trade.assetsReceived)) {
    const originalAssets = getAssetsForTeam(trade, team);
    if (originalAssets.length < 2) continue;

    const entries = originalAssets.map((item, index) => ({
      index,
      item,
      asset: item && item.asset ? String(item.asset) : ""
    })).filter(e => e.asset);

    const removeIndexes = new Set();
    const teamChangeGroups = [];

    // Pass 1: exact normalized duplicate asset text.
    const byExactNorm = new Map();
    for (const entry of entries) {
      const key = normalizeAssetText(entry.asset);
      if (!key) continue;
      if (!byExactNorm.has(key)) byExactNorm.set(key, []);
      byExactNorm.get(key).push(entry);
    }

    for (const [normalizedAsset, group] of byExactNorm.entries()) {
      if (group.length < 2) continue;

      const keeper = chooseKeeper(group, "exactNormalizedDuplicate");
      const removed = group.filter(e => e.index !== keeper.index);

      for (const r of removed) removeIndexes.add(r.index);

      teamChangeGroups.push({
        groupType: "exactNormalizedDuplicate",
        normalizedAsset,
        kept: cloneEntry(keeper),
        removed: removed.map(cloneEntry)
      });
    }

    // Pass 2: equivalent composite signatures, after ignoring already-removed exact dupes.
    const byCompositeSig = new Map();
    for (const entry of entries) {
      if (removeIndexes.has(entry.index)) continue;

      const sig = componentSignature(entry.asset);
      if (sig.partCount < 2 || !sig.signature) continue;

      if (!byCompositeSig.has(sig.signature)) byCompositeSig.set(sig.signature, []);
      byCompositeSig.get(sig.signature).push({ ...entry, componentParts: sig.parts });
    }

    for (const [signature, group] of byCompositeSig.entries()) {
      if (group.length < 2) continue;

      const keeper = chooseKeeper(group, "equivalentCompositeSignature");
      const removed = group.filter(e => e.index !== keeper.index);

      for (const r of removed) removeIndexes.add(r.index);

      teamChangeGroups.push({
        groupType: "equivalentCompositeSignature",
        signature,
        componentParts: keeper.componentParts,
        kept: cloneEntry(keeper),
        removed: removed.map(cloneEntry)
      });
    }

    if (removeIndexes.size > 0) {
      const before = originalAssets.map((a, index) => ({
        index,
        type: a && a.type ? a.type : null,
        asset: a && a.asset ? a.asset : null
      }));

      const afterAssets = originalAssets.filter((_, index) => !removeIndexes.has(index));

      const after = afterAssets.map((a, index) => ({
        index,
        type: a && a.type ? a.type : null,
        asset: a && a.asset ? a.asset : null
      }));

      changes.push({
        slug,
        date: trade.date || null,
        team,
        removedCount: removeIndexes.size,
        groups: teamChangeGroups,
        before,
        after
      });

      totalLinesRemoved += removeIndexes.size;
      tradeTouched = true;

      if (APPLY) {
        trade.assetsReceived[team] = afterAssets;
      }
    }
  }

  if (tradeTouched) tradesTouched++;
}

const report = {
  mode: DRY_RUN ? "dry-run" : "apply",
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  tradesTouched,
  totalLinesRemoved,
  changeCount: changes.length,
  changes
};

const outPath = DRY_RUN ? dryRunPath : applyReportPath;
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (APPLY) {
  const outputText = Array.isArray(raw)
    ? JSON.stringify(trades, null, 2) + "\n"
    : JSON.stringify(raw, null, 2) + "\n";

  fs.writeFileSync(dataPath, outputText);
}

console.log("");
console.log(DRY_RUN ? "ASSET LINE SAFE DEDUPE DRY RUN" : "ASSET LINE SAFE DEDUPE APPLY");
console.log("=".repeat(70));
console.log(`Trades scanned: ${trades.length}`);
console.log(`Trades touched: ${tradesTouched}`);
console.log(`Team asset arrays changed: ${changes.length}`);
console.log(`Asset lines that would be removed: ${totalLinesRemoved}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("First 20 planned changes:");
for (const change of changes.slice(0, 20)) {
  console.log(`- ${change.slug} | ${change.team} | remove ${change.removedCount}`);
  for (const group of change.groups) {
    console.log(`  ${group.groupType}`);
    console.log(`  KEEP: ${group.kept.asset}`);
    for (const removed of group.removed) {
      console.log(`  DROP: ${removed.asset}`);
    }
  }
}
