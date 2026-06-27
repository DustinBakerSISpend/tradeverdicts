const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "ellipsis-asset-recovery-dry-run.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];

if (!Array.isArray(trades) || trades.length === 0) {
  console.error("Could not find trades array.");
  process.exit(1);
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || t.transactionDate || null;
}

function keysOf(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
}

function assetKeys(t) {
  return keysOf(t.assetsReceived).sort();
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function prefixBeforeEllipsis(s) {
  return String(s || "").split("...")[0].trim();
}

function meaningfulPrefixScore(prefix) {
  const n = normalize(prefix);
  const words = n.split(" ").filter(Boolean);
  return {
    normalized: n,
    charLength: n.length,
    wordCount: words.length,
    hasYear: /\b(19|20)\d{2}\b/.test(n),
    hasOverall: /\boverall\b/.test(n),
    hasRoundPick: /\bround pick\b/.test(n),
    hasPlayerishName: words.some(w => w.length >= 5 && !["round","overall","subsequently","traded","pick"].includes(w))
  };
}

function isPrefixStrong(prefix) {
  const score = meaningfulPrefixScore(prefix);

  if (score.charLength >= 55 && score.wordCount >= 7) return true;
  if (score.charLength >= 40 && score.hasYear && score.hasRoundPick) return true;
  if (score.charLength >= 35 && score.hasPlayerishName && score.hasYear) return true;

  return false;
}

function flattenAssets() {
  const rows = [];

  for (const [tradeIndex, t] of trades.entries()) {
    for (const team of assetKeys(t)) {
      const assets = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];

      for (const [assetIndex, item] of assets.entries()) {
        rows.push({
          tradeIndex,
          slug: slugOf(t),
          id: t.id || null,
          date: dateOf(t),
          publishStatus: t.publishStatus || null,
          suppressed: t.suppressed ?? null,
          teams: t.teams || [],
          team,
          assetIndex,
          type: item && item.type ? item.type : null,
          asset: item && item.asset ? item.asset : ""
        });
      }
    }
  }

  return rows;
}

const allAssets = flattenAssets();
const nonEllipsisAssets = allAssets.filter(row => row.asset && !String(row.asset).includes("..."));
const ellipsisAssets = allAssets.filter(row => row.asset && String(row.asset).includes("...") && row.suppressed !== true);

const planned = [];
const ambiguous = [];
const noCandidate = [];
const weakPrefix = [];

for (const row of ellipsisAssets) {
  const prefix = prefixBeforeEllipsis(row.asset);
  const normalizedPrefix = normalize(prefix);
  const prefixScore = meaningfulPrefixScore(prefix);

  if (!isPrefixStrong(prefix)) {
    weakPrefix.push({
      ...row,
      prefix,
      prefixScore,
      reason: "Prefix too weak for safe automatic recovery"
    });
    continue;
  }

  const candidatesRaw = nonEllipsisAssets.filter(candidate => {
    if (!candidate.asset) return false;
    if (candidate.slug === row.slug && candidate.team === row.team && candidate.assetIndex === row.assetIndex) return false;

    const normalizedAsset = normalize(candidate.asset);
    return normalizedAsset.startsWith(normalizedPrefix);
  });

  const candidateByAsset = new Map();

  for (const candidate of candidatesRaw) {
    const key = candidate.asset;
    if (!candidateByAsset.has(key)) {
      candidateByAsset.set(key, {
        asset: candidate.asset,
        examples: []
      });
    }

    candidateByAsset.get(key).examples.push({
      slug: candidate.slug,
      id: candidate.id,
      date: candidate.date,
      team: candidate.team,
      assetIndex: candidate.assetIndex,
      publishStatus: candidate.publishStatus,
      suppressed: candidate.suppressed
    });
  }

  const candidates = [...candidateByAsset.values()];

  if (candidates.length === 1) {
    planned.push({
      slug: row.slug,
      id: row.id,
      date: row.date,
      publishStatus: row.publishStatus,
      team: row.team,
      assetIndex: row.assetIndex,
      type: row.type,
      before: row.asset,
      after: candidates[0].asset,
      prefix,
      prefixScore,
      sourceExamples: candidates[0].examples.slice(0, 8)
    });
  } else if (candidates.length > 1) {
    ambiguous.push({
      ...row,
      prefix,
      prefixScore,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 10)
    });
  } else {
    noCandidate.push({
      ...row,
      prefix,
      prefixScore,
      reason: "No non-truncated asset starts with this prefix"
    });
  }
}

const plannedTradeSlugs = [...new Set(planned.map(p => p.slug))].sort();

const byStatus = {};
for (const row of ellipsisAssets) {
  byStatus[row.publishStatus || "(missing)"] = (byStatus[row.publishStatus || "(missing)"] || 0) + 1;
}

const report = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  dataPath,
  totalActiveEllipsisAssetRows: ellipsisAssets.length,
  plannedReplacementCount: planned.length,
  plannedTradeCount: plannedTradeSlugs.length,
  ambiguousCount: ambiguous.length,
  noCandidateCount: noCandidate.length,
  weakPrefixCount: weakPrefix.length,
  byStatus,
  planned,
  ambiguous,
  noCandidate,
  weakPrefix
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("ELLIPSIS ASSET RECOVERY DRY RUN");
console.log("=".repeat(80));
console.log(`active ellipsis asset rows: ${ellipsisAssets.length}`);
console.log(`planned safe replacements: ${planned.length}`);
console.log(`trades touched if applied: ${plannedTradeSlugs.length}`);
console.log(`ambiguous: ${ambiguous.length}`);
console.log(`no candidate: ${noCandidate.length}`);
console.log(`weak prefix: ${weakPrefix.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("By publishStatus:");
for (const [status, count] of Object.entries(byStatus).sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`- ${status}: ${count}`);
}

console.log("");
console.log("First 15 planned replacements:");
for (const row of planned.slice(0, 15)) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.date} | ${row.team}[${row.assetIndex}]`);
  console.log(`BEFORE: ${row.before}`);
  console.log(`AFTER : ${row.after}`);
  console.log(`source: ${row.sourceExamples[0] ? row.sourceExamples[0].slug : "none"}`);
}

console.log("");
console.log("First 10 unresolved examples:");
for (const row of [...ambiguous, ...noCandidate, ...weakPrefix].slice(0, 10)) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.date} | ${row.team}[${row.assetIndex}]`);
  console.log(`asset: ${row.asset}`);
  console.log(`reason: ${row.reason || (row.candidateCount ? `${row.candidateCount} candidates` : "unresolved")}`);
}
