const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "composite-asset-duplicates-dry-run.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];

if (!Array.isArray(trades) || trades.length === 0) {
  console.error("Could not find trades array.");
  console.error("Top-level keys:", Object.keys(raw || {}));
  process.exit(1);
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function normalize(s) {
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

function tokens(s) {
  return normalize(s).split(" ").filter(Boolean);
}

function tokenSet(s) {
  return new Set(tokens(s));
}

function isMostlyContained(smaller, larger) {
  const smallTokens = tokens(smaller).filter(t => !["de", "dt", "dl", "ol", "ot", "og", "c", "qb", "rb", "wr", "te", "lb", "cb", "db", "s", "k", "p"].includes(t));
  const largeSet = tokenSet(larger);

  if (smallTokens.length === 0) return false;

  const hits = smallTokens.filter(t => largeSet.has(t)).length;
  return hits === smallTokens.length;
}

function riskyCompositeLanguage(s) {
  return /\b(future considerations|undisclosed|cash|possibly|probably|conditional|not conveyed|rights to|later|on \d{4}|unknown|\?)\b/i.test(String(s || ""));
}

function looksLikePick(s) {
  return /\b(19|20)\d{2}\s+\d+(st|nd|rd|th)?\s+round pick\b/i.test(String(s || "")) ||
    /\b\d+(st|nd|rd|th)?\s+round pick\b/i.test(String(s || ""));
}

function partHasExactOrStrongIndividualMatch(part, individualAssets) {
  const partNorm = normalize(part);

  for (const ind of individualAssets) {
    const indNorm = normalize(ind.asset);

    if (!indNorm) continue;

    if (partNorm === indNorm) {
      return {
        matchType: "exact",
        individual: ind
      };
    }

    if (partNorm.includes(indNorm) || indNorm.includes(partNorm)) {
      if (
        looksLikePick(part) ||
        looksLikePick(ind.asset) ||
        isMostlyContained(part, ind.asset) ||
        isMostlyContained(ind.asset, part)
      ) {
        return {
          matchType: "strong-contained",
          individual: ind
        };
      }
    }
  }

  return null;
}

const safeAutoRemove = [];
const reviewOnly = [];
const knownBad = {
  antoneExum: [],
  danArnold: [],
  stephenSullivan: [],
  jabrillPeppersObj: []
};

for (const trade of trades) {
  if (!trade.assetsReceived || typeof trade.assetsReceived !== "object" || Array.isArray(trade.assetsReceived)) continue;

  const slug = slugOf(trade);

  for (const team of Object.keys(trade.assetsReceived)) {
    const assets = Array.isArray(trade.assetsReceived[team]) ? trade.assetsReceived[team] : [];
    if (assets.length < 3) continue;

    const entries = assets
      .map((item, index) => ({
        index,
        type: item && item.type ? String(item.type) : null,
        asset: item && item.asset ? String(item.asset) : ""
      }))
      .filter(e => e.asset);

    for (const candidate of entries) {
      const parts = splitTopLevelAssetParts(candidate.asset);
      if (parts.length < 2) continue;

      const others = entries.filter(e => e.index !== candidate.index);
      const matchedParts = [];
      const unmatchedParts = [];

      for (const part of parts) {
        const match = partHasExactOrStrongIndividualMatch(part, others);
        if (match) {
          matchedParts.push({
            part,
            matchType: match.matchType,
            matchedIndividual: match.individual
          });
        } else {
          unmatchedParts.push(part);
        }
      }

      const matchedIndividualIndexes = [...new Set(matchedParts.map(p => p.matchedIndividual.index))];

      if (matchedParts.length >= 2 && unmatchedParts.length === 0 && matchedIndividualIndexes.length >= 2) {
        const item = {
          slug,
          date: trade.date || null,
          team,
          action: "remove composite candidate; keep individual asset lines",
          reason: "Composite asset fully represented by two or more individual asset lines",
          compositeCandidate: candidate,
          parts,
          matchedParts,
          before: entries,
          after: entries.filter(e => e.index !== candidate.index)
        };

        if (riskyCompositeLanguage(candidate.asset)) {
          reviewOnly.push({
            ...item,
            reviewReason: "Composite contains risky language that may carry extra information"
          });
        } else {
          safeAutoRemove.push(item);
        }
      } else if (matchedParts.length >= 2) {
        reviewOnly.push({
          slug,
          date: trade.date || null,
          team,
          action: "review only",
          reason: "Composite partially overlaps with multiple individual asset lines, but not all parts are safely represented",
          compositeCandidate: candidate,
          parts,
          matchedParts,
          unmatchedParts,
          before: entries
        });
      }
    }
  }

  if (slug.includes("2014-6th-round-pick-182nd-overall-antone-exum-atlanta-falcons-2014")) {
    knownBad.antoneExum = safeAutoRemove.concat(reviewOnly).filter(x => x.slug === slug);
  }
  if (slug.includes("dan-arnold-carolina-panthers-2021")) {
    knownBad.danArnold = safeAutoRemove.concat(reviewOnly).filter(x => x.slug === slug);
  }
  if (slug.includes("2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020")) {
    knownBad.stephenSullivan = safeAutoRemove.concat(reviewOnly).filter(x => x.slug === slug);
  }
  if (slug.includes("jabrill-peppers-2019-1st-round-pick-17th-overall-dexter-lawrence-and-2019-3rd-ro")) {
    knownBad.jabrillPeppersObj = safeAutoRemove.concat(reviewOnly).filter(x => x.slug === slug);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  counts: {
    safeAutoRemove: safeAutoRemove.length,
    reviewOnly: reviewOnly.length
  },
  knownBad,
  safeAutoRemove,
  reviewOnly
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("COMPOSITE ASSET DUPLICATE DRY RUN");
console.log("=".repeat(70));
console.log(`Trades scanned: ${trades.length}`);
console.log(`Safe auto-remove candidates: ${safeAutoRemove.length}`);
console.log(`Review-only candidates: ${reviewOnly.length}`);

console.log("");
console.log("Known bad impact:");
for (const [key, rows] of Object.entries(knownBad)) {
  console.log(`- ${key}: ${rows.length}`);
  for (const row of rows) {
    console.log(`  ${row.slug} | ${row.team} | ${row.action}`);
    console.log(`  COMPOSITE: ${row.compositeCandidate.asset}`);
    for (const part of row.matchedParts || []) {
      console.log(`    PART: ${part.part}`);
      console.log(`    MATCH: [${part.matchedIndividual.index}] ${part.matchedIndividual.asset}`);
    }
    if (row.unmatchedParts && row.unmatchedParts.length) {
      console.log(`    UNMATCHED: ${row.unmatchedParts.join(" | ")}`);
    }
  }
}

console.log("");
console.log("First 25 safe auto-remove candidates:");
for (const row of safeAutoRemove.slice(0, 25)) {
  console.log(`- ${row.slug} | ${row.team}`);
  console.log(`  DROP COMPOSITE: [${row.compositeCandidate.index}] ${row.compositeCandidate.asset}`);
  for (const part of row.matchedParts) {
    console.log(`  KEEP INDIVIDUAL: [${part.matchedIndividual.index}] ${part.matchedIndividual.asset}`);
  }
}

console.log("");
console.log("First 25 review-only candidates:");
for (const row of reviewOnly.slice(0, 25)) {
  console.log(`- ${row.slug} | ${row.team}`);
  console.log(`  REVIEW COMPOSITE: [${row.compositeCandidate.index}] ${row.compositeCandidate.asset}`);
  console.log(`  REASON: ${row.reviewReason || row.reason}`);
}

console.log("");
console.log(`Wrote report: ${outPath}`);
