const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "obj-zeitler-vernon-split-dry-run.json");

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

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAsset(trade, team, assetNeedle) {
  const rows = trade.assetsReceived && Array.isArray(trade.assetsReceived[team])
    ? trade.assetsReceived[team]
    : [];

  const needle = norm(assetNeedle);
  return rows.some(row => norm(row.asset).includes(needle));
}

function perspectiveById(trade, sourceTradeId) {
  const rows = Array.isArray(trade.perspectives) ? trade.perspectives : [];
  return rows.find(p => p.sourceTradeId === sourceTradeId) || null;
}

const objSlug = "jabrill-peppers-2019-1st-round-pick-17th-overall-dexter-lawrence-and-2019-3rd-ro";
const zeitlerSlug = "kevin-zeitler-olivier-vernon-new-york-giants-2019";

const errors = [];
const warnings = [];
const planned = [];

const objMatches = trades.filter(t => slugOf(t) === objSlug);
if (objMatches.length !== 1) {
  errors.push(`Expected exactly one OBJ blended trade. Found ${objMatches.length}.`);
}

const existingZeitlerSlug = trades.filter(t => slugOf(t) === zeitlerSlug);
if (existingZeitlerSlug.length > 0) {
  errors.push(`Proposed Zeitler/Vernon slug already exists: ${zeitlerSlug}`);
}

const existingZeitlerId = trades.filter(t => t.id === "NYG-2019-0286");
if (existingZeitlerId.length > 0) {
  errors.push("Proposed Zeitler/Vernon id already exists: NYG-2019-0286");
}

if (!errors.length) {
  const objTrade = objMatches[0];

  const requiredAssets = [
    ["new-york-giants", "Jabrill Peppers"],
    ["new-york-giants", "Dexter Lawrence"],
    ["new-york-giants", "Oshane Ximines"],
    ["new-york-giants", "Kevin Zeitler"],
    ["cleveland-browns", "Odell Beckham"],
    ["cleveland-browns", "Olivier Vernon"]
  ];

  for (const [team, asset] of requiredAssets) {
    if (!hasAsset(objTrade, team, asset)) {
      errors.push(`Missing expected asset before split: ${team} -> ${asset}`);
    }
  }

  const objPerspectives = [
    perspectiveById(objTrade, "NYG-2019-0285"),
    perspectiveById(objTrade, "CLE-2019-0426")
  ].filter(Boolean);

  const zeitlerPerspectives = [
    perspectiveById(objTrade, "NYG-2019-0286"),
    perspectiveById(objTrade, "CLE-2019-0427")
  ].filter(Boolean);

  if (objPerspectives.length !== 2) {
    errors.push(`Expected 2 OBJ perspectives, found ${objPerspectives.length}.`);
  }

  if (zeitlerPerspectives.length !== 2) {
    errors.push(`Expected 2 Zeitler/Vernon perspectives, found ${zeitlerPerspectives.length}.`);
  }

  if (!errors.length) {
    const beforeObj = clone(objTrade);

    const afterObj = clone(objTrade);
    afterObj.assetsReceived = {
      "new-york-giants": [
        {
          type: "pick",
          asset: "Jabrill Peppers, 2019 1st round pick (17th overall, Dexter Lawrence) and 2019 3rd round pick (95th overall, Oshane Ximines)"
        }
      ],
      "cleveland-browns": [
        {
          type: "player",
          asset: "Odell Beckham Jr"
        }
      ]
    };
    afterObj.grades = {
      "new-york-giants": "A-",
      "cleveland-browns": "D"
    };
    afterObj.verdict = "New York Giants Win";
    afterObj.tier = "major";
    afterObj.publishStatus = "ready";
    afterObj.confidence = "high";
    afterObj.summary = "New York acquired Jabrill Peppers, 2019 1st round pick (17th overall, Dexter Lawrence) and 2019 3rd round pick (95th overall, Oshane Ximines) from Cleveland for Odell Beckham Jr. The Giants landed Dexter Lawrence and premium draft value while Beckham never delivered comparable long-term Cleveland value.";
    afterObj.partnerSummary = "Cleveland acquired Odell Beckham Jr. from New York for Jabrill Peppers, 2019 1st round pick (17th overall, Dexter Lawrence) and 2019 3rd round pick (95th overall, Oshane Ximines). Strict hindsight favors New York because the Giants turned the return into stronger long-term value.";
    afterObj.analysis = `${afterObj.summary} ${afterObj.partnerSummary}`;
    afterObj.qaNotes = "OBJ trade separated from the Kevin Zeitler/Olivier Vernon player-for-player trade. Asset list, grades, summaries, and perspectives now describe only Beckham for Jabrill Peppers plus 2019 first- and third-round picks.";
    afterObj.perspectives = objPerspectives;

    const zeitlerTrade = {
      id: "NYG-2019-0286",
      canonicalKey: "2019-03-13|cleveland-browns|new-york-giants|kevin zeitler|olivier vernon",
      dateTeamsKey: "2019-03-13|cleveland-browns|new-york-giants",
      slug: zeitlerSlug,
      league: "NFL",
      tradeDate: "2019-03-13",
      season: 2019,
      teams: ["cleveland-browns", "new-york-giants"],
      assetsReceived: {
        "new-york-giants": [
          {
            type: "player",
            asset: "Kevin Zeitler"
          }
        ],
        "cleveland-browns": [
          {
            type: "player",
            asset: "Olivier Vernon"
          }
        ]
      },
      tier: "standard",
      publishStatus: "ready",
      verdict: "New York Giants Win",
      grades: {
        "new-york-giants": "B",
        "cleveland-browns": "C-"
      },
      confidence: "high",
      summary: "New York acquired Kevin Zeitler from Cleveland for Olivier Vernon. In hindsight, Zeitler was the more durable and valuable long-term starter, giving the Giants the better side of the player-for-player trade.",
      partnerSummary: "Cleveland acquired Olivier Vernon from New York for Kevin Zeitler. Vernon had short-term value, but Zeitler delivered the steadier long-term return, so strict hindsight favors the Giants.",
      analysis: "New York acquired Kevin Zeitler from Cleveland for Olivier Vernon. In hindsight, Zeitler was the more durable and valuable long-term starter, giving the Giants the better side of the player-for-player trade. Cleveland acquired Olivier Vernon from New York for Kevin Zeitler. Vernon had short-term value, but Zeitler delivered the steadier long-term return, so strict hindsight favors the Giants.",
      qaNotes: "Split out from blended OBJ/Jabrill Peppers record. Existing source perspectives NYG-2019-0286 and CLE-2019-0427 were preserved on this standalone Zeitler/Vernon trade.",
      sourceTeams: ["new-york-giants", "cleveland-browns"],
      perspectives: zeitlerPerspectives
    };

    planned.push({
      action: "update existing OBJ trade to OBJ-only",
      slug: objSlug,
      before: beforeObj,
      after: afterObj,
      removedFromObjRecord: {
        "new-york-giants": ["Kevin Zeitler"],
        "cleveland-browns": ["Olivier Vernon"],
        perspectivesMovedToNewRecord: zeitlerPerspectives.map(p => p.sourceTradeId)
      }
    });

    planned.push({
      action: "create standalone Zeitler/Vernon trade",
      slug: zeitlerSlug,
      after: zeitlerTrade
    });
  }
}

const report = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  dataPath,
  plannedCount: planned.length,
  errors,
  warnings,
  planned
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("OBJ / ZEITLER-VERNON SPLIT DRY RUN");
console.log("=".repeat(80));
console.log(`Planned actions: ${planned.length}`);
console.log(`Errors: ${errors.length}`);
console.log(`Warnings: ${warnings.length}`);
console.log(`Report: ${outPath}`);

if (errors.length) {
  console.log("");
  console.log("ERRORS:");
  for (const error of errors) console.log(`- ${error}`);
  process.exit(1);
}

for (const item of planned) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`ACTION: ${item.action}`);
  console.log(`SLUG: ${item.slug}`);

  if (item.before) {
    console.log("");
    console.log("BEFORE:");
    console.log(`assetsReceived=${JSON.stringify(item.before.assetsReceived)}`);
    console.log(`grades=${JSON.stringify(item.before.grades)}`);
    console.log(`verdict=${JSON.stringify(item.before.verdict)}`);
    console.log(`perspectives=${JSON.stringify((item.before.perspectives || []).map(p => p.sourceTradeId))}`);
  }

  console.log("");
  console.log("AFTER:");
  console.log(`id=${item.after.id}`);
  console.log(`teams=${JSON.stringify(item.after.teams)}`);
  console.log(`assetsReceived=${JSON.stringify(item.after.assetsReceived)}`);
  console.log(`grades=${JSON.stringify(item.after.grades)}`);
  console.log(`verdict=${JSON.stringify(item.after.verdict)}`);
  console.log(`tier=${JSON.stringify(item.after.tier)}`);
  console.log(`perspectives=${JSON.stringify((item.after.perspectives || []).map(p => p.sourceTradeId))}`);

  if (item.removedFromObjRecord) {
    console.log("");
    console.log("MOVED/REMOVED FROM OBJ RECORD:");
    console.dir(item.removedFromObjRecord, { depth: null });
  }
}
