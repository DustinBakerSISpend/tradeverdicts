const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "zatkoff-repair-cardinals-inspection-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const zatkoffSlug = "roger-zatkoff-rams-mutually-cancelled-by-browns-rams-after-zatkoff-refused-to-re";
const cardinalsSlug = "cardinals-1956-09-19-cardinals-tom-dahms-1957-sixth-round-pick-70-john-nisby-jack-nisby";

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function textOf(t) {
  return JSON.stringify(t).toLowerCase();
}

const zatkoff = trades.find(t => slugOf(t) === zatkoffSlug);
const cardinals = trades.find(t => slugOf(t) === cardinalsSlug);

const exactTerms = ["tom dahms", "john nisby", "jack nisby", "nisby", "dahms"];

const exactNameHits = trades
  .filter(t => exactTerms.some(term => textOf(t).includes(term)))
  .map(t => ({
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    teams: t.teams || null,
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null
  }));

const sameDateHits = trades
  .filter(t => dateOf(t) === "1956-09-19")
  .map(t => ({
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    teams: t.teams || null,
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null
  }));

const report = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  zatkoff: zatkoff ? {
    id: zatkoff.id || null,
    slug: slugOf(zatkoff),
    tradeDate: dateOf(zatkoff),
    publishStatus: zatkoff.publishStatus || null,
    suppressed: zatkoff.suppressed ?? null,
    before: {
      teams: zatkoff.teams,
      assetsReceived: zatkoff.assetsReceived,
      summary: zatkoff.summary,
      qaNotes: zatkoff.qaNotes
    },
    plannedAfter: {
      teams: ["cleveland-browns", "los-angeles-rams"],
      assetsReceived: {
        "cleveland-browns": [
          { type: "player", asset: "Rudy Bukich" }
        ],
        "los-angeles-rams": [
          { type: "player", asset: "Roger Zatkoff" }
        ]
      },
      summary: "The Cleveland Browns and Los Angeles Rams agreed to a Roger Zatkoff-for-Rudy Bukich trade, but the transaction was mutually cancelled after Zatkoff refused to report to the Rams. Administrative reversal/voided transaction retained for public archive rather than hidden."
    }
  } : null,
  cardinals: cardinals ? {
    id: cardinals.id || null,
    slug: slugOf(cardinals),
    tradeDate: dateOf(cardinals),
    publishStatus: cardinals.publishStatus || null,
    suppressed: cardinals.suppressed ?? null,
    teams: cardinals.teams || null,
    assetsReceived: cardinals.assetsReceived || null,
    summary: cardinals.summary || null,
    qaNotes: cardinals.qaNotes || null
  } : null,
  exactNameHits,
  sameDateHits
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("ZATKOFF + CARDINALS INSPECTION DRY RUN");
console.log("=".repeat(80));
console.log(`Report: ${outPath}`);

console.log("");
console.log("ZATKOFF TARGET");
console.log("-".repeat(80));
if (!report.zatkoff) {
  console.log("not found");
} else {
  console.log(`${report.zatkoff.slug} | ${report.zatkoff.id} | ${report.zatkoff.tradeDate} | status=${report.zatkoff.publishStatus}`);
  console.log("");
  console.log("BEFORE teams:");
  console.log(JSON.stringify(report.zatkoff.before.teams));
  console.log("");
  console.log("AFTER teams:");
  console.log(JSON.stringify(report.zatkoff.plannedAfter.teams));
  console.log("");
  console.log("BEFORE assetsReceived:");
  console.dir(report.zatkoff.before.assetsReceived, { depth: null });
  console.log("");
  console.log("AFTER assetsReceived:");
  console.dir(report.zatkoff.plannedAfter.assetsReceived, { depth: null });
  console.log("");
  console.log("AFTER summary:");
  console.log(report.zatkoff.plannedAfter.summary);
}

console.log("");
console.log("CARDINALS TARGET");
console.log("-".repeat(80));
if (!report.cardinals) {
  console.log("not found");
} else {
  console.log(`${report.cardinals.slug} | ${report.cardinals.id} | ${report.cardinals.tradeDate} | status=${report.cardinals.publishStatus}`);
  console.log("teams:");
  console.log(JSON.stringify(report.cardinals.teams));
  console.log("assetsReceived:");
  console.dir(report.cardinals.assetsReceived, { depth: null });
  console.log("summary:");
  console.log(report.cardinals.summary || "(none)");
}

console.log("");
console.log("EXACT NAME HITS");
console.log("-".repeat(80));
console.log(`count=${exactNameHits.length}`);
for (const hit of exactNameHits) {
  console.log("");
  console.log(`${hit.slug} | ${hit.id} | ${hit.tradeDate} | status=${hit.publishStatus} | suppressed=${hit.suppressed}`);
  console.log(`teams=${JSON.stringify(hit.teams)}`);
  console.dir(hit.assetsReceived, { depth: null });
  console.log(`summary=${hit.summary || "(none)"}`);
}

console.log("");
console.log("SAME-DATE HITS");
console.log("-".repeat(80));
console.log(`count=${sameDateHits.length}`);
for (const hit of sameDateHits) {
  console.log(`${hit.slug} | ${hit.id} | ${hit.tradeDate} | status=${hit.publishStatus} | suppressed=${hit.suppressed}`);
  console.log(`teams=${JSON.stringify(hit.teams)}`);
}
