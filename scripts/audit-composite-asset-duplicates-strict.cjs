const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "composite-asset-duplicates-strict-dry-run.json");

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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingPosition(s) {
  return String(s || "")
    .replace(/^\s*(QB|RB|FB|WR|TE|OL|OT|OG|C|DL|DE|DT|EDGE|LB|ILB|OLB|CB|DB|S|FS|SS|K|P|LS)\s+/i, "")
    .trim();
}

function normalizeNoPosition(s) {
  return normalize(stripLeadingPosition(s));
}

function parenBalance(s) {
  const text = String(s || "");
  let balance = 0;
  for (const ch of text) {
    if (ch === "(") balance++;
    if (ch === ")") balance--;
    if (balance < 0) return balance;
  }
  return balance;
}

function isMalformed(s) {
  const text = String(s || "").trim();

  if (!text) return true;
  if (parenBalance(text) !== 0) return true;
  if (/\.\.\.$/.test(text)) return true;
  if (/\b(overal|ove|ov)$/i.test(text)) return true;
  if (/\(\s*$/.test(text)) return true;
  if (/\bround pick\s*\([^)]*$/i.test(text)) return true;

  return false;
}

function riskyLanguage(s) {
  return /\b(future considerations|undisclosed|cash|possibly|probably|conditional|not conveyed|rights to|conflicting sources|unknown|\?)\b/i.test(String(s || ""));
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

function isAtomicAsset(asset) {
  if (isMalformed(asset)) return false;
  if (riskyLanguage(asset)) return false;
  return splitTopLevelAssetParts(asset).length === 1;
}

function matchPartToAtomicIndividual(part, individualAssets, usedIndexes) {
  if (isMalformed(part) || riskyLanguage(part)) return null;

  const partNorm = normalize(part);
  const partNoPos = normalizeNoPosition(part);

  for (const ind of individualAssets) {
    if (usedIndexes.has(ind.index)) continue;
    if (!isAtomicAsset(ind.asset)) continue;

    const indNorm = normalize(ind.asset);
    const indNoPos = normalizeNoPosition(ind.asset);

    if (partNorm && partNorm === indNorm) {
      return {
        matchType: "exact",
        individual: ind
      };
    }

    if (partNoPos && partNoPos === indNoPos) {
      return {
        matchType: "exactIgnoringLeadingPosition",
        individual: ind
      };
    }
  }

  return null;
}

const strictSafe = [];
const rejected = [];

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

      const base = {
        slug,
        date: trade.date || null,
        team,
        compositeCandidate: candidate,
        parts,
        before: entries
      };

      if (isMalformed(candidate.asset)) {
        rejected.push({ ...base, reason: "malformed composite candidate" });
        continue;
      }

      if (riskyLanguage(candidate.asset)) {
        rejected.push({ ...base, reason: "risky language in composite candidate" });
        continue;
      }

      const others = entries.filter(e => e.index !== candidate.index);
      const usedIndexes = new Set();
      const matchedParts = [];
      const unmatchedParts = [];

      for (const part of parts) {
        const match = matchPartToAtomicIndividual(part, others, usedIndexes);

        if (match) {
          usedIndexes.add(match.individual.index);
          matchedParts.push({
            part,
            matchType: match.matchType,
            matchedIndividual: match.individual
          });
        } else {
          unmatchedParts.push(part);
        }
      }

      if (matchedParts.length === parts.length && unmatchedParts.length === 0 && usedIndexes.size === parts.length) {
        strictSafe.push({
          ...base,
          action: "remove composite candidate; keep unique atomic individual asset lines",
          reason: "Every composite part exactly matches one unique atomic individual asset line",
          matchedParts,
          after: entries.filter(e => e.index !== candidate.index)
        });
      } else if (matchedParts.length >= 2) {
        rejected.push({
          ...base,
          reason: "matched multiple parts but failed strict unique atomic coverage",
          matchedParts,
          unmatchedParts
        });
      }
    }
  }
}

function captureKnown(rows, needle) {
  return rows.filter(r => String(r.slug || "").includes(needle));
}

knownBad.antoneExum = [
  ...captureKnown(strictSafe, "2014-6th-round-pick-182nd-overall-antone-exum-atlanta-falcons-2014"),
  ...captureKnown(rejected, "2014-6th-round-pick-182nd-overall-antone-exum-atlanta-falcons-2014")
];

knownBad.danArnold = [
  ...captureKnown(strictSafe, "dan-arnold-carolina-panthers-2021"),
  ...captureKnown(rejected, "dan-arnold-carolina-panthers-2021")
];

knownBad.stephenSullivan = [
  ...captureKnown(strictSafe, "2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020"),
  ...captureKnown(rejected, "2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020")
];

knownBad.jabrillPeppersObj = [
  ...captureKnown(strictSafe, "jabrill-peppers-2019-1st-round-pick-17th-overall-dexter-lawrence-and-2019-3rd-ro"),
  ...captureKnown(rejected, "jabrill-peppers-2019-1st-round-pick-17th-overall-dexter-lawrence-and-2019-3rd-ro")
];

const rejectReasonCounts = {};
for (const row of rejected) {
  rejectReasonCounts[row.reason] = (rejectReasonCounts[row.reason] || 0) + 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  counts: {
    strictSafe: strictSafe.length,
    rejected: rejected.length,
    rejectReasonCounts
  },
  knownBad,
  strictSafe,
  rejected
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("STRICT COMPOSITE ASSET DUPLICATE DRY RUN");
console.log("=".repeat(70));
console.log(`Trades scanned: ${trades.length}`);
console.log(`Strict safe auto-remove candidates: ${strictSafe.length}`);
console.log(`Rejected/review-only candidates: ${rejected.length}`);

console.log("");
console.log("Reject reason counts:");
for (const [reason, count] of Object.entries(rejectReasonCounts)) {
  console.log(`- ${reason}: ${count}`);
}

console.log("");
console.log("Known bad impact:");
for (const [key, rows] of Object.entries(knownBad)) {
  console.log(`- ${key}: ${rows.length}`);
  for (const row of rows) {
    const bucket = strictSafe.includes(row) ? "STRICT SAFE" : "REJECTED/REVIEW";
    console.log(`  ${bucket} | ${row.slug} | ${row.team}`);
    console.log(`  COMPOSITE: ${row.compositeCandidate.asset}`);
    console.log(`  REASON: ${row.reason}`);
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
console.log("First 40 strict safe candidates:");
for (const row of strictSafe.slice(0, 40)) {
  console.log(`- ${row.slug} | ${row.team}`);
  console.log(`  DROP COMPOSITE: [${row.compositeCandidate.index}] ${row.compositeCandidate.asset}`);
  for (const part of row.matchedParts) {
    console.log(`  KEEP ATOMIC: [${part.matchedIndividual.index}] ${part.matchedIndividual.asset}`);
  }
}

console.log("");
console.log(`Wrote report: ${outPath}`);
