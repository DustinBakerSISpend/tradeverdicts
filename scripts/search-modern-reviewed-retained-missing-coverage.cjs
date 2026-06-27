const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "modern-reviewed-retained-missing-coverage-search.json");

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

function flattenAssets(t) {
  const rows = [];

  for (const team of assetKeys(t)) {
    const assets = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];
    for (const [index, item] of assets.entries()) {
      rows.push({
        slug: slugOf(t),
        id: t.id || null,
        date: dateOf(t),
        team,
        index,
        type: item && item.type ? item.type : null,
        asset: item && item.asset ? item.asset : ""
      });
    }
  }

  return rows.filter(r => r.asset);
}

function compactTrade(t) {
  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    season: t.season || null,
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    teams: t.teams || null,
    assetKeys: assetKeys(t),
    verdict: t.verdict || null,
    grades: t.grades || null,
    tier: t.tier || null,
    confidence: t.confidence || null,
    qaNotes: t.qaNotes || null,
    summary: t.summary || null,
    partnerSummary: t.partnerSummary || null,
    assetsReceived: t.assetsReceived || null,
    matchingAssets: []
  };
}

const targetSlug = "reviewed-and-retained-for-public-data-completeness";

const searchGroups = [
  {
    name: "Aireontae Ersery / 2025 pick 48",
    terms: [
      "Aireontae Ersery",
      "2025 2nd round pick (48th overall",
      "2025 2nd round pick (48",
      "2nd round pick (48th overall"
    ]
  },
  {
    name: "Jack Bech / 2025 pick 58",
    terms: [
      "Jack Bech",
      "2025 2nd round pick (58th overall",
      "2025 2nd round pick (58",
      "2nd round pick (58th overall"
    ]
  },
  {
    name: "2025 pick 99 / possible companion",
    terms: [
      "2025 3rd round pick (99th overall",
      "2025 3rd round pick (99",
      "3rd round pick (99th overall",
      "Charles Grant",
      "2025 3rd round pick (99th"
    ]
  },
  {
    name: "Houston 2025 Giants package",
    terms: [
      "Jaxson Dart",
      "Jayden Higgins",
      "Charles Grant",
      "Sam Roush",
      "2026 3rd round pick (69th overall"
    ]
  },
  {
    name: "Houston/Rams Skowronek package",
    terms: [
      "Ben Skowronek",
      "Jam Miller",
      "Micah Morris",
      "2026 7th round pick (245th overall",
      "2026 6th round pick (207th overall"
    ]
  }
];

const allAssetRows = trades.flatMap(t => flattenAssets(t));

const results = [];

for (const group of searchGroups) {
  const normalizedTerms = group.terms.map(normalize);

  const assetMatches = allAssetRows.filter(row => {
    const hay = normalize(row.asset);
    return normalizedTerms.some(term => hay.includes(term));
  });

  const tradeMatchesBySlug = new Map();

  for (const row of assetMatches) {
    const trade = trades.find(t => slugOf(t) === row.slug);
    if (!trade) continue;

    if (!tradeMatchesBySlug.has(row.slug)) {
      tradeMatchesBySlug.set(row.slug, compactTrade(trade));
    }

    tradeMatchesBySlug.get(row.slug).matchingAssets.push(row);
  }

  const fullTradeTextMatches = trades.filter(t => {
    const hay = normalize(JSON.stringify(t));
    return normalizedTerms.some(term => hay.includes(term));
  });

  for (const trade of fullTradeTextMatches) {
    const slug = slugOf(trade);
    if (!tradeMatchesBySlug.has(slug)) {
      tradeMatchesBySlug.set(slug, compactTrade(trade));
    }
  }

  results.push({
    group: group.name,
    terms: group.terms,
    tradeMatchCount: tradeMatchesBySlug.size,
    assetMatchCount: assetMatches.length,
    matches: [...tradeMatchesBySlug.values()].sort((a, b) => {
      const aTarget = a.slug === targetSlug ? 1 : 0;
      const bTarget = b.slug === targetSlug ? 1 : 0;
      return aTarget - bTarget || String(a.tradeDate).localeCompare(String(b.tradeDate)) || a.slug.localeCompare(b.slug);
    })
  });
}

const target = trades.find(t => slugOf(t) === targetSlug);

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  targetSlug,
  target: target ? compactTrade(target) : null,
  results
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("MODERN REVIEWED/RETAINED MISSING COVERAGE SEARCH");
console.log("=".repeat(80));
console.log(`Target slug: ${targetSlug}`);
console.log(`Target found: ${target ? "yes" : "no"}`);
console.log(`Report: ${outPath}`);

if (target) {
  console.log("");
  console.log("Target current state:");
  console.log(`id=${target.id}`);
  console.log(`publishStatus=${JSON.stringify(target.publishStatus)} suppressed=${JSON.stringify(target.suppressed ?? null)}`);
  console.log(`teams=${JSON.stringify(target.teams)}`);
  console.log("assetsReceived:");
  console.dir(target.assetsReceived, { depth: null });
}

for (const group of results) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`SEARCH GROUP: ${group.group}`);
  console.log(`terms=${JSON.stringify(group.terms)}`);
  console.log(`tradeMatchCount=${group.tradeMatchCount}`);
  console.log(`assetMatchCount=${group.assetMatchCount}`);

  for (const match of group.matches.slice(0, 20)) {
    console.log("");
    console.log(`  ${match.slug} | id=${match.id} | date=${match.tradeDate}`);
    console.log(`  publishStatus=${JSON.stringify(match.publishStatus)} suppressed=${JSON.stringify(match.suppressed)}`);
    console.log(`  teams=${JSON.stringify(match.teams)}`);
    console.log(`  verdict=${JSON.stringify(match.verdict)} grades=${JSON.stringify(match.grades)}`);

    if (match.matchingAssets.length) {
      console.log("  matchingAssets:");
      for (const asset of match.matchingAssets) {
        console.log(`    ${asset.team}: [${asset.type || "?"}] ${asset.asset}`);
      }
    } else {
      console.log("  matchingAssets: none from asset rows; match came from full trade text");
    }
  }
}
