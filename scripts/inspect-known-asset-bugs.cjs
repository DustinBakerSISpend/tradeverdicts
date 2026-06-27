const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "known-asset-bug-inspection.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];

if (!Array.isArray(trades) || trades.length === 0) {
  console.error("Could not find trades array. Top-level keys:", Object.keys(raw || {}));
  process.exit(1);
}

const queries = [
  "dan-arnold-carolina-panthers-2021",
  "2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020",
  "jabrill-peppers",
  "2014-6th-round-pick-182nd-overall-antone-exum-atlanta-falcons-2014"
];

function getSlug(t) {
  return String(t.slug || t.id || t.urlSlug || "").toLowerCase();
}

function compactTrade(t) {
  return {
    slug: t.slug || t.id || t.urlSlug || null,
    title: t.title || t.tradeTitle || null,
    date: t.date || t.tradeDate || null,
    teams: t.teams || null,
    assetsReceivedKeys: t.assetsReceived ? Object.keys(t.assetsReceived) : [],
    assetsReceived: t.assetsReceived || null,
    grades: t.grades || t.teamGrades || null,
    verdict: t.verdict || t.winner || null,
    perspectives: t.perspectives || null,
    suppressed: t.suppressed || t.hidden || false
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  queryResults: {}
};

for (const q of queries) {
  const qLower = q.toLowerCase();

  const matches = trades.filter(t => {
    const slug = getSlug(t);
    const title = String(t.title || t.tradeTitle || "").toLowerCase();
    const body = JSON.stringify(t).toLowerCase();

    return (
      slug === qLower ||
      slug.includes(qLower) ||
      title.includes(qLower) ||
      body.includes(qLower)
    );
  });

  report.queryResults[q] = matches.map(compactTrade);

  console.log("");
  console.log("=".repeat(100));
  console.log(`QUERY: ${q}`);
  console.log(`MATCHES: ${matches.length}`);

  for (const t of matches) {
    const c = compactTrade(t);
    console.log("-".repeat(100));
    console.log(`SLUG: ${c.slug}`);
    console.log(`TITLE: ${c.title}`);
    console.log(`DATE: ${c.date}`);
    console.log(`TEAMS: ${JSON.stringify(c.teams)}`);
    console.log(`ASSET KEYS: ${JSON.stringify(c.assetsReceivedKeys)}`);
    console.log("ASSETS RECEIVED:");
    console.dir(c.assetsReceived, { depth: null });
    console.log("GRADES:");
    console.dir(c.grades, { depth: null });
    console.log("VERDICT:");
    console.dir(c.verdict, { depth: null });
  }
}

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log("");
console.log(`Wrote inspection report: ${outPath}`);
