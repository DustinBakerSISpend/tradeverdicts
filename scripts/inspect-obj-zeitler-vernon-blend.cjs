const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "obj-zeitler-vernon-blend-inspection.json");

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

function dateOf(t) {
  return t.date || t.tradeDate || t.transactionDate || null;
}

function assetKeys(t) {
  return t.assetsReceived && typeof t.assetsReceived === "object" && !Array.isArray(t.assetsReceived)
    ? Object.keys(t.assetsReceived)
    : [];
}

function compact(t) {
  return {
    slug: slugOf(t),
    date: dateOf(t),
    teams: t.teams || null,
    assetKeys: assetKeys(t),
    assetsReceived: t.assetsReceived || null,
    grades: t.grades || t.teamGrades || null,
    verdict: t.verdict || null,
    perspectives: t.perspectives || null,
    suppressed: t.suppressed || t.hidden || false
  };
}

const terms = [
  "jabrill peppers",
  "odell beckham",
  "odell beckham jr",
  "dexter lawrence",
  "oshane ximines",
  "kevin zeitler",
  "olivier vernon",
  "new-york-giants",
  "cleveland-browns"
];

const focusedTerms = [
  "jabrill peppers",
  "odell beckham",
  "dexter lawrence",
  "oshane ximines",
  "kevin zeitler",
  "olivier vernon"
];

const matchesByTerm = {};
for (const term of terms) matchesByTerm[term] = [];

for (const trade of trades) {
  const haystack = JSON.stringify(trade).toLowerCase();

  for (const term of terms) {
    if (haystack.includes(term.toLowerCase())) {
      matchesByTerm[term].push(compact(trade));
    }
  }
}

const focusedMatches = trades
  .filter(t => {
    const haystack = JSON.stringify(t).toLowerCase();
    return focusedTerms.some(term => haystack.includes(term.toLowerCase()));
  })
  .map(compact);

const sameDateGiantsBrowns = trades
  .filter(t => {
    const teams = Array.isArray(t.teams) ? t.teams : [];
    const date = dateOf(t);
    return (
      date === "2019-03-13" &&
      teams.includes("cleveland-browns") &&
      teams.includes("new-york-giants")
    );
  })
  .map(compact);

const exactKnownSlug = trades
  .filter(t => slugOf(t).includes("jabrill-peppers-2019-1st-round-pick-17th-overall-dexter-lawrence-and-2019-3rd-ro"))
  .map(compact);

const possibleZeitlerVernonSeparate = trades
  .filter(t => {
    const haystack = JSON.stringify(t).toLowerCase();
    return haystack.includes("kevin zeitler") || haystack.includes("olivier vernon");
  })
  .map(compact);

const possibleObjSeparate = trades
  .filter(t => {
    const haystack = JSON.stringify(t).toLowerCase();
    return haystack.includes("odell beckham");
  })
  .map(compact);

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  counts: {
    focusedMatches: focusedMatches.length,
    sameDateGiantsBrowns: sameDateGiantsBrowns.length,
    exactKnownSlug: exactKnownSlug.length,
    possibleZeitlerVernonSeparate: possibleZeitlerVernonSeparate.length,
    possibleObjSeparate: possibleObjSeparate.length
  },
  matchesByTerm,
  focusedMatches,
  sameDateGiantsBrowns,
  exactKnownSlug,
  possibleZeitlerVernonSeparate,
  possibleObjSeparate
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("OBJ / ZEITLER-VERNON BLEND INSPECTION");
console.log("=".repeat(80));
console.log(`Trades scanned: ${trades.length}`);
console.log("");

console.log("Counts:");
for (const [k, v] of Object.entries(report.counts)) {
  console.log(`- ${k}: ${v}`);
}

console.log("");
console.log("Term match counts:");
for (const [term, rows] of Object.entries(matchesByTerm)) {
  console.log(`- ${term}: ${rows.length}`);
}

console.log("");
console.log("Same-date Giants/Browns trades on 2019-03-13:");
for (const t of sameDateGiantsBrowns) {
  console.log("-".repeat(80));
  console.log(`${t.slug} | date=${t.date}`);
  console.log(`teams=${JSON.stringify(t.teams)}`);
  console.log(`assetKeys=${JSON.stringify(t.assetKeys)}`);
  console.log(`verdict=${JSON.stringify(t.verdict)}`);
  console.log(`grades=${JSON.stringify(t.grades)}`);
  console.log("assetsReceived:");
  console.dir(t.assetsReceived, { depth: null });
}

console.log("");
console.log("Focused name matches:");
for (const t of focusedMatches) {
  console.log("-".repeat(80));
  console.log(`${t.slug} | date=${t.date}`);
  console.log(`teams=${JSON.stringify(t.teams)}`);
  console.log(`assetKeys=${JSON.stringify(t.assetKeys)}`);
  console.log(`verdict=${JSON.stringify(t.verdict)}`);
  console.log(`grades=${JSON.stringify(t.grades)}`);
  console.log("assetsReceived:");
  console.dir(t.assetsReceived, { depth: null });
}

console.log("");
console.log(`Wrote report: ${outPath}`);
