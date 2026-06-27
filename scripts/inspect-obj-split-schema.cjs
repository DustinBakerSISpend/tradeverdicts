const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "obj-split-schema-inspection.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function dateOf(t) {
  return t.date || t.tradeDate || t.transactionDate || null;
}

const objSlug = "jabrill-peppers-2019-1st-round-pick-17th-overall-dexter-lawrence-and-2019-3rd-ro";

const objTrade = trades.find(t => slugOf(t) === objSlug);

if (!objTrade) {
  console.error(`Could not find OBJ blended trade: ${objSlug}`);
  process.exit(1);
}

const sameEraTwoTeamExamples = trades
  .filter(t => {
    const date = String(dateOf(t) || "");
    const teams = Array.isArray(t.teams) ? t.teams : [];
    return (
      date >= "2018-01-01" &&
      date <= "2020-12-31" &&
      teams.length === 2 &&
      t.assetsReceived &&
      typeof t.assetsReceived === "object" &&
      !Array.isArray(t.assetsReceived)
    );
  })
  .slice(0, 12);

const giantsBrownsExamples = trades
  .filter(t => {
    const teams = Array.isArray(t.teams) ? t.teams : [];
    return teams.includes("cleveland-browns") || teams.includes("new-york-giants");
  })
  .filter(t => {
    const date = String(dateOf(t) || "");
    return date >= "2018-01-01" && date <= "2020-12-31";
  })
  .slice(0, 20);

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  objTradeKeys: Object.keys(objTrade),
  objTrade,
  sameEraTwoTeamExampleKeys: sameEraTwoTeamExamples.map(t => ({
    slug: slugOf(t),
    date: dateOf(t),
    keys: Object.keys(t),
    trade: t
  })),
  giantsBrownsExamples: giantsBrownsExamples.map(t => ({
    slug: slugOf(t),
    date: dateOf(t),
    keys: Object.keys(t),
    trade: t
  }))
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("OBJ SPLIT SCHEMA INSPECTION");
console.log("=".repeat(80));
console.log(`Trades scanned: ${trades.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("OBJ blended trade keys:");
console.log(Object.keys(objTrade));

console.log("");
console.log("OBJ blended trade full object:");
console.dir(objTrade, { depth: null });

console.log("");
console.log("Same-era two-team example summaries:");
for (const row of sameEraTwoTeamExamples) {
  console.log("-".repeat(80));
  console.log(`${slugOf(row)} | ${dateOf(row)}`);
  console.log(`keys=${JSON.stringify(Object.keys(row))}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`assetKeys=${JSON.stringify(Object.keys(row.assetsReceived || {}))}`);
  console.log(`verdict=${JSON.stringify(row.verdict)}`);
  console.log(`grades=${JSON.stringify(row.grades || row.teamGrades || null)}`);
}

console.log("");
console.log("Giants/Browns 2018-2020 example summaries:");
for (const row of giantsBrownsExamples) {
  console.log("-".repeat(80));
  console.log(`${slugOf(row)} | ${dateOf(row)}`);
  console.log(`keys=${JSON.stringify(Object.keys(row))}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`assetKeys=${JSON.stringify(Object.keys(row.assetsReceived || {}))}`);
  console.log(`verdict=${JSON.stringify(row.verdict)}`);
  console.log(`grades=${JSON.stringify(row.grades || row.teamGrades || null)}`);
}
