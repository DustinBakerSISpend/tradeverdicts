const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "multi-team-asset-contamination-inspection.json");

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

function arr(x) {
  return Array.isArray(x) ? x : [];
}

function sortedUnique(xs) {
  return [...new Set(xs.filter(Boolean).map(String))].sort();
}

function assetKeys(t) {
  return t.assetsReceived && typeof t.assetsReceived === "object" && !Array.isArray(t.assetsReceived)
    ? Object.keys(t.assetsReceived)
    : [];
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

function teamDisplay(slug) {
  return String(slug || "")
    .split("-")
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : w)
    .join(" ");
}

function getAssets(t, team) {
  const rows = t.assetsReceived && t.assetsReceived[team];
  return Array.isArray(rows) ? rows : [];
}

function flattenAssets(t) {
  const rows = [];
  for (const team of assetKeys(t)) {
    for (const [index, item] of getAssets(t, team).entries()) {
      rows.push({
        slug: slugOf(t),
        date: t.date || null,
        team,
        index,
        type: item && item.type ? item.type : null,
        asset: item && item.asset ? item.asset : ""
      });
    }
  }
  return rows.filter(r => r.asset);
}

function extractOverallPickKeys(asset) {
  const text = String(asset || "");
  const keys = [];

  const re1 = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)?\s+round pick\s*\((\d+)(?:st|nd|rd|th)?\s+overall/gi;
  let m;
  while ((m = re1.exec(text))) {
    keys.push(`${m[1]}-${m[2]}-${m[3]}`);
  }

  const re2 = /\b((?:19|20)\d{2})\s+(\w+)\s+round pick\s*\(#(\d+)/gi;
  const wordToRound = {
    first: "1",
    second: "2",
    third: "3",
    fourth: "4",
    fifth: "5",
    sixth: "6",
    seventh: "7",
    eighth: "8",
    ninth: "9",
    tenth: "10",
    eleventh: "11",
    twelfth: "12"
  };

  while ((m = re2.exec(text))) {
    const round = wordToRound[String(m[2]).toLowerCase()] || m[2];
    keys.push(`${m[1]}-${round}-${m[3]}`);
  }

  return [...new Set(keys)];
}

function likelyContaminationShape(t) {
  const teams = sortedUnique(arr(t.teams));
  const keys = sortedUnique(assetKeys(t));
  const counts = Object.fromEntries(keys.map(k => [k, getAssets(t, k).length]));
  const allOneAsset = keys.length > 0 && keys.every(k => counts[k] === 1);
  const allPickOnly = flattenAssets(t).every(a => a.type === "pick");
  const evenTrade = String(t.verdict || "").toLowerCase().includes("even");

  if (teams.length > 2 && keys.length > 2 && allOneAsset && allPickOnly) {
    return "likely blended one-pick trade cluster";
  }

  if (teams.length > 2 && keys.length > 2) {
    return "multi-team asset cluster";
  }

  if (teams.length !== keys.length || teams.some(team => !keys.includes(team)) || keys.some(team => !teams.includes(team))) {
    return "teams/assetsReceived key mismatch";
  }

  if (evenTrade && teams.length > 2) {
    return "multi-team even-trade review";
  }

  return "review";
}

const allAssets = [];
for (const t of trades) {
  allAssets.push(...flattenAssets(t));
}

const exactAssetIndex = new Map();
const pickKeyIndex = new Map();

for (const asset of allAssets) {
  const norm = normalize(asset.asset);
  if (!exactAssetIndex.has(norm)) exactAssetIndex.set(norm, []);
  exactAssetIndex.get(norm).push(asset);

  for (const key of extractOverallPickKeys(asset.asset)) {
    if (!pickKeyIndex.has(key)) pickKeyIndex.set(key, []);
    pickKeyIndex.get(key).push(asset);
  }
}

const suspicious = [];
const teamKeyMismatch = [];

for (const t of trades) {
  const slug = slugOf(t);
  const teams = sortedUnique(arr(t.teams));
  const keys = sortedUnique(assetKeys(t));

  const missingAssetKeysFromTeams = keys.filter(k => !teams.includes(k));
  const teamsWithoutAssetKeys = teams.filter(k => !keys.includes(k));

  if (missingAssetKeysFromTeams.length || teamsWithoutAssetKeys.length) {
    teamKeyMismatch.push({
      slug,
      date: t.date || null,
      teams,
      assetKeys: keys,
      missingAssetKeysFromTeams,
      teamsWithoutAssetKeys,
      verdict: t.verdict || null,
      grades: t.grades || null,
      shape: likelyContaminationShape(t),
      assetsReceived: t.assetsReceived || null
    });
  }

  if (teams.length > 2 || keys.length > 2) {
    const rows = flattenAssets(t);

    const exactMatchesElsewhere = [];
    const pickMatchesElsewhere = [];

    for (const row of rows) {
      const norm = normalize(row.asset);

      for (const match of exactAssetIndex.get(norm) || []) {
        if (match.slug !== slug) {
          exactMatchesElsewhere.push({
            asset: row.asset,
            localTeam: row.team,
            matchSlug: match.slug,
            matchDate: match.date,
            matchTeam: match.team,
            matchIndex: match.index
          });
        }
      }

      for (const pickKey of extractOverallPickKeys(row.asset)) {
        for (const match of pickKeyIndex.get(pickKey) || []) {
          if (match.slug !== slug) {
            pickMatchesElsewhere.push({
              pickKey,
              asset: row.asset,
              localTeam: row.team,
              matchSlug: match.slug,
              matchDate: match.date,
              matchTeam: match.team,
              matchAsset: match.asset,
              matchIndex: match.index
            });
          }
        }
      }
    }

    suspicious.push({
      slug,
      date: t.date || null,
      teams,
      assetKeys: keys,
      teamCount: teams.length,
      assetKeyCount: keys.length,
      verdict: t.verdict || null,
      grades: t.grades || null,
      shape: likelyContaminationShape(t),
      assetCountsByTeam: Object.fromEntries(keys.map(k => [k, getAssets(t, k).length])),
      assetsReceived: t.assetsReceived || null,
      exactMatchesElsewhere,
      pickMatchesElsewhere
    });
  }
}

const knownNeedles = [
  "2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020",
  "jabrill-peppers-2019-1st-round-pick-17th-overall-dexter-lawrence-and-2019-3rd-ro",
  "dan-arnold-carolina-panthers-2021",
  "2014-6th-round-pick-182nd-overall-antone-exum-atlanta-falcons-2014"
];

const knownMatches = {};
for (const needle of knownNeedles) {
  knownMatches[needle] = trades
    .filter(t => slugOf(t).includes(needle) || JSON.stringify(t).toLowerCase().includes(needle.toLowerCase()))
    .map(t => ({
      slug: slugOf(t),
      date: t.date || null,
      teams: t.teams || null,
      assetKeys: assetKeys(t),
      verdict: t.verdict || null,
      grades: t.grades || null,
      assetsReceived: t.assetsReceived || null,
      shape: likelyContaminationShape(t)
    }));
}

const byShape = {};
for (const row of suspicious) {
  byShape[row.shape] = (byShape[row.shape] || 0) + 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  counts: {
    teamKeyMismatch: teamKeyMismatch.length,
    suspiciousMultiTeamRecords: suspicious.length,
    byShape
  },
  knownMatches,
  teamKeyMismatch,
  suspicious
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("MULTI-TEAM / TEAM-KEY ASSET CONTAMINATION INSPECTION");
console.log("=".repeat(80));
console.log(`Trades scanned: ${trades.length}`);
console.log(`Team-key mismatches: ${teamKeyMismatch.length}`);
console.log(`Suspicious multi-team records: ${suspicious.length}`);

console.log("");
console.log("Suspicious shape counts:");
for (const [shape, count] of Object.entries(byShape)) {
  console.log(`- ${shape}: ${count}`);
}

console.log("");
console.log("Known target inspection:");
for (const [needle, matches] of Object.entries(knownMatches)) {
  console.log(`- ${needle}: ${matches.length} match(es)`);
  for (const t of matches) {
    console.log(`  ${t.slug} | ${t.date} | shape=${t.shape}`);
    console.log(`  teams=${JSON.stringify(t.teams)}`);
    console.log(`  assetKeys=${JSON.stringify(t.assetKeys)}`);
    console.log(`  verdict=${JSON.stringify(t.verdict)}`);
    console.log("  assetsReceived:");
    console.dir(t.assetsReceived, { depth: null });
  }
}

console.log("");
console.log("TEAM-KEY MISMATCHES:");
for (const row of teamKeyMismatch) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.date} | ${row.shape}`);
  console.log(`teams:     ${JSON.stringify(row.teams)}`);
  console.log(`assetKeys: ${JSON.stringify(row.assetKeys)}`);
  console.log(`asset keys not in teams: ${JSON.stringify(row.missingAssetKeysFromTeams)}`);
  console.log(`teams without asset key: ${JSON.stringify(row.teamsWithoutAssetKeys)}`);
}

console.log("");
console.log("SUSPICIOUS MULTI-TEAM RECORDS:");
for (const row of suspicious) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.date} | ${row.shape}`);
  console.log(`teams (${row.teamCount}): ${row.teams.map(teamDisplay).join(" | ")}`);
  console.log(`asset keys (${row.assetKeyCount}): ${row.assetKeys.map(teamDisplay).join(" | ")}`);
  console.log(`asset counts: ${JSON.stringify(row.assetCountsByTeam)}`);
  console.log(`verdict: ${row.verdict}`);
  console.log(`exact asset matches elsewhere: ${row.exactMatchesElsewhere.length}`);
  console.log(`pick-key matches elsewhere: ${row.pickMatchesElsewhere.length}`);

  for (const team of row.assetKeys) {
    const assets = row.assetsReceived[team] || [];
    for (const asset of assets) {
      console.log(`  ${team}: ${asset.type || "?"} | ${asset.asset}`);
    }
  }

  if (row.pickMatchesElsewhere.length) {
    console.log("  Pick-key matches elsewhere, first 8:");
    for (const m of row.pickMatchesElsewhere.slice(0, 8)) {
      console.log(`    ${m.pickKey}: local ${m.localTeam} "${m.asset}" => ${m.matchSlug} | ${m.matchTeam} "${m.matchAsset}"`);
    }
  }
}

console.log("");
console.log(`Wrote full inspection: ${outPath}`);
