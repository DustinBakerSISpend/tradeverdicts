const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "repair-legacy-specific-pick-chain-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const repairs = [
  {
    slug: "1991-second-round-pick-51-doug-thomas-savoy-las-vegas-raiders-1991",
    id: "SEA-1991-04-21-0081",
    reason: "Direct trade summary describes Seattle/Raiders only; 49ers and Bengals assets are downstream pick-chain contamination.",
    teams: ["seattle-seahawks", "las-vegas-raiders"],
    assetsReceived: {
      "seattle-seahawks": [
        { type: "pick", asset: "1991 second round pick (#51-Doug Thomas (Savoy))" },
        { type: "pick", asset: "1991 fourth round pick (#98-John Kasay)" }
      ],
      "las-vegas-raiders": [
        { type: "pick", asset: "1991 second round pick (#43-Nick Bell)" }
      ]
    },
    summary: "Seattle acquired 1991 second round pick (#51-Doug Thomas (Savoy)) and 1991 fourth round pick (#98-John Kasay) from Las Vegas Raiders for 1991 second round pick (#43-Nick Bell). This was a modest draft-capital exchange, with Seattle moving down from No. 43 to add No. 98 while Las Vegas moved up in the second round. The grade stays near neutral because the value swing was limited and the long-term outcome was not franchise-shaping."
  },
  {
    slug: "1993-first-round-pick-11-dan-williams-ii-cleveland-browns-1993",
    id: "DEN-1993-04-25-0235",
    reason: "Direct trade summary describes Denver/Browns only; 49ers, Saints, Eagles, and Oilers/Titans assets are downstream pick-chain contamination.",
    teams: ["denver-broncos", "cleveland-browns"],
    assetsReceived: {
      "denver-broncos": [
        { type: "pick", asset: "1993 first round pick (#11-Dan Williams II)" }
      ],
      "cleveland-browns": [
        { type: "pick", asset: "1993 first round pick (#14-Steve Everitt)" },
        { type: "pick", asset: "1993 third round pick (#83-Mike Caldwell)" }
      ]
    },
    summary: "Denver acquired 1993 first round pick (#11-Dan Williams II) from Cleveland Browns for 1993 first round pick (#14-Steve Everitt) and 1993 third round pick (#83-Mike Caldwell). This was primarily a draft-position exchange, with Denver paying extra capital to move up three spots. The grades stay conservative because the value depends on the selected players' realized careers rather than the pick movement alone."
  }
];

const planned = [];
const errors = [];

for (const r of repairs) {
  const t = find(r.slug);

  if (!t) {
    errors.push(`Missing trade: ${r.slug}`);
    continue;
  }

  if (t.id !== r.id) {
    errors.push(`ID mismatch for ${r.slug}: expected ${r.id}, found ${t.id}`);
  }

  if (t.suppressed === true) {
    errors.push(`Trade already suppressed: ${r.slug}`);
  }

  planned.push({
    slug: r.slug,
    id: t.id || null,
    tradeDate: t.tradeDate || t.date || null,
    reason: r.reason,
    before: {
      teams: t.teams || null,
      assetsReceived: t.assetsReceived || null,
      summary: t.summary || null,
      qaNotes: t.qaNotes || null
    },
    after: {
      teams: r.teams,
      assetsReceived: r.assetsReceived,
      summary: r.summary
    }
  });
}

fs.writeFileSync(outPath, JSON.stringify({
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  plannedRepairCount: planned.length,
  errorCount: errors.length,
  planned,
  errors
}, null, 2));

console.log("");
console.log("REPAIR LEGACY SPECIFIC PICK-CHAIN DRY RUN");
console.log("=".repeat(80));
console.log(`planned repairs: ${planned.length}`);
console.log(`errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

for (const row of planned) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate}`);
  console.log(`reason=${row.reason}`);
  console.log("");
  console.log("BEFORE teams:");
  console.log(JSON.stringify(row.before.teams));
  console.log("AFTER teams:");
  console.log(JSON.stringify(row.after.teams));
  console.log("");
  console.log("BEFORE assets:");
  console.dir(row.before.assetsReceived, { depth: null });
  console.log("");
  console.log("AFTER assets:");
  console.dir(row.after.assetsReceived, { depth: null });
  console.log("");
  console.log("AFTER summary:");
  console.log(row.after.summary);
}

if (errors.length) {
  console.log("");
  console.log("Errors:");
  for (const e of errors) console.log(`- ${e}`);
}
