const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "asset-line-duplicates-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];

if (!Array.isArray(trades) || trades.length === 0) {
  console.error("Could not find trades array.");
  console.error("Top-level keys:", Object.keys(raw || {}));
  process.exit(1);
}

const knownBadQueries = [
  "dan-arnold-carolina-panthers-2021",
  "2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020",
  "jabrill-peppers",
  "2014-6th-round-pick-182nd-overall-antone-exum-atlanta-falcons-2014"
];

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function arr(x) {
  return Array.isArray(x) ? x : [];
}

function sortedUnique(xs) {
  return [...new Set(xs.filter(Boolean).map(String))].sort();
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

    if (
      depth === 0 &&
      /\s/i.test(ch) &&
      text.slice(i).match(/^\s+and\s+/i)
    ) {
      if (buf.trim()) parts.push(buf.trim());
      const m = text.slice(i).match(/^\s+and\s+/i);
      i += m[0].length - 1;
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

function getAssetEntries(trade, team) {
  return arr((trade.assetsReceived || {})[team]).map((a, index) => ({
    index,
    type: a && a.type ? String(a.type) : null,
    asset: a && a.asset ? String(a.asset) : "",
    raw: a
  })).filter(a => a.asset);
}

function hasAssetReceived(trade) {
  return trade.assetsReceived && typeof trade.assetsReceived === "object" && !Array.isArray(trade.assetsReceived);
}

const exactDuplicateNormalizedAssetGroups = [];
const equivalentCompositeSignatureGroups = [];
const compositeContainsExistingParts = [];
const teamKeyMismatch = [];
const suspiciousMultiTeamRecords = [];
const knownBadMatches = {};

for (const q of knownBadQueries) knownBadMatches[q] = [];

for (const trade of trades) {
  const slug = slugOf(trade);
  const teams = sortedUnique(arr(trade.teams));
  const assetKeys = hasAssetReceived(trade) ? sortedUnique(Object.keys(trade.assetsReceived)) : [];

  for (const q of knownBadQueries) {
    const qLower = q.toLowerCase();
    const body = JSON.stringify(trade).toLowerCase();
    if (
      slug.toLowerCase() === qLower ||
      slug.toLowerCase().includes(qLower) ||
      body.includes(qLower)
    ) {
      knownBadMatches[q].push(slug);
    }
  }

  if (hasAssetReceived(trade)) {
    const missingAssetKeysFromTeams = assetKeys.filter(k => !teams.includes(k));
    const teamsWithoutAssetKeys = teams.filter(k => !assetKeys.includes(k));

    if (missingAssetKeysFromTeams.length || teamsWithoutAssetKeys.length) {
      teamKeyMismatch.push({
        slug,
        date: trade.date || null,
        teams,
        assetKeys,
        missingAssetKeysFromTeams,
        teamsWithoutAssetKeys
      });
    }

    if (teams.length > 2 || assetKeys.length > 2) {
      suspiciousMultiTeamRecords.push({
        slug,
        date: trade.date || null,
        teams,
        assetKeys,
        teamCount: teams.length,
        assetKeyCount: assetKeys.length,
        assetsReceived: trade.assetsReceived
      });
    }

    for (const team of assetKeys) {
      const entries = getAssetEntries(trade, team);

      const byExactNorm = new Map();
      const byComponentSignature = new Map();

      for (const entry of entries) {
        const exactNorm = normalizeAssetText(entry.asset);
        if (!byExactNorm.has(exactNorm)) byExactNorm.set(exactNorm, []);
        byExactNorm.get(exactNorm).push(entry);

        const sig = componentSignature(entry.asset);
        if (sig.partCount >= 2 && sig.signature) {
          if (!byComponentSignature.has(sig.signature)) byComponentSignature.set(sig.signature, []);
          byComponentSignature.get(sig.signature).push({
            ...entry,
            componentParts: sig.parts,
            componentPartCount: sig.partCount
          });
        }
      }

      for (const [normalizedAsset, group] of byExactNorm.entries()) {
        if (group.length > 1) {
          exactDuplicateNormalizedAssetGroups.push({
            slug,
            date: trade.date || null,
            team,
            normalizedAsset,
            count: group.length,
            assets: group.map(g => ({
              index: g.index,
              type: g.type,
              asset: g.asset
            }))
          });
        }
      }

      for (const [signature, group] of byComponentSignature.entries()) {
        if (group.length > 1) {
          equivalentCompositeSignatureGroups.push({
            slug,
            date: trade.date || null,
            team,
            signature,
            count: group.length,
            assets: group.map(g => ({
              index: g.index,
              type: g.type,
              asset: g.asset,
              componentParts: g.componentParts
            }))
          });
        }
      }

      for (const candidate of entries) {
        const candidateNorm = normalizeAssetText(candidate.asset);
        if (!candidateNorm) continue;

        const contained = entries
          .filter(other => other.index !== candidate.index)
          .map(other => ({
            index: other.index,
            type: other.type,
            asset: other.asset,
            normalizedAsset: normalizeAssetText(other.asset)
          }))
          .filter(other => other.normalizedAsset && candidateNorm.includes(other.normalizedAsset));

        if (contained.length >= 2) {
          compositeContainsExistingParts.push({
            slug,
            date: trade.date || null,
            team,
            compositeCandidate: {
              index: candidate.index,
              type: candidate.type,
              asset: candidate.asset
            },
            containedExistingAssets: contained.map(c => ({
              index: c.index,
              type: c.type,
              asset: c.asset
            }))
          });
        }
      }
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  counts: {
    exactDuplicateNormalizedAssetGroups: exactDuplicateNormalizedAssetGroups.length,
    equivalentCompositeSignatureGroups: equivalentCompositeSignatureGroups.length,
    compositeContainsExistingParts: compositeContainsExistingParts.length,
    teamKeyMismatch: teamKeyMismatch.length,
    suspiciousMultiTeamRecords: suspiciousMultiTeamRecords.length
  },
  knownBadMatches,
  exactDuplicateNormalizedAssetGroups,
  equivalentCompositeSignatureGroups,
  compositeContainsExistingParts,
  teamKeyMismatch,
  suspiciousMultiTeamRecords
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("ASSET LINE DUPLICATE / CONTAMINATION AUDIT");
console.log("=".repeat(70));
console.log(`Trades scanned: ${trades.length}`);
console.log("");
console.log("Counts:");
for (const [k, v] of Object.entries(report.counts)) {
  console.log(`- ${k}: ${v}`);
}

console.log("");
console.log("Known bad slug/query matches:");
for (const [q, matches] of Object.entries(knownBadMatches)) {
  console.log(`- ${q}: ${matches.length ? matches.join(", ") : "NO MATCH"}`);
}

console.log("");
console.log("Top exact duplicate normalized asset groups:");
for (const item of exactDuplicateNormalizedAssetGroups.slice(0, 10)) {
  console.log(`- ${item.slug} | ${item.team} | ${item.count} duplicate lines`);
}

console.log("");
console.log("Top equivalent composite signature groups:");
for (const item of equivalentCompositeSignatureGroups.slice(0, 10)) {
  console.log(`- ${item.slug} | ${item.team} | ${item.count} equivalent bundle lines`);
  for (const a of item.assets) console.log(`  [${a.index}] ${a.asset}`);
}

console.log("");
console.log("Top composite assets containing existing individual assets:");
for (const item of compositeContainsExistingParts.slice(0, 10)) {
  console.log(`- ${item.slug} | ${item.team}`);
  console.log(`  composite: [${item.compositeCandidate.index}] ${item.compositeCandidate.asset}`);
  for (const a of item.containedExistingAssets) console.log(`  contains:  [${a.index}] ${a.asset}`);
}

console.log("");
console.log(`Wrote full report: ${outPath}`);
