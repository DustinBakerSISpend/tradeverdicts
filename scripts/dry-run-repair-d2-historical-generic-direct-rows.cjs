const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "repair-d2-historical-generic-direct-rows-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const repairs = [
  {
    slug: "cash-atlanta-falcons-1968",
    id: "MIN-1968-09-03-0069",
    reason: "Summary describes Minnesota/Atlanta only; other teams/assets are blended historical import contamination.",
    teams: ["minnesota-vikings", "atlanta-falcons"],
    assetsReceived: {
      "minnesota-vikings": [{ type: "other", asset: "cash" }],
      "atlanta-falcons": [{ type: "player", asset: "Mike Donohoe" }]
    },
    summary: "Minnesota acquired cash from Atlanta Falcons for Mike Donohoe. This was a low-scale historical transaction built around cash consideration, so the public verdict should remain conservative rather than overstating the long-term football impact."
  },
  {
    slug: "undisclosed-draft-pick-arizona-st-louis-cardinals-1973",
    id: "CIN-1973-0042",
    reason: "Summary describes Cincinnati/Cardinals only; Rams asset is blended historical import contamination.",
    teams: ["cincinnati-bengals", "arizona-cardinals"],
    assetsReceived: {
      "cincinnati-bengals": [{ type: "pick", asset: "undisclosed draft pick (?-?)" }],
      "arizona-cardinals": [{ type: "player", asset: "Willie Jones / Willie Lee Jones" }]
    },
    summary: "Cincinnati acquired an undisclosed draft pick from Arizona/St. Louis Cardinals for Willie Jones / Willie Lee Jones. Because the exact pick path is unresolved, the trade should remain graded conservatively as a low-confidence historical transaction."
  },
  {
    slug: "1-cash-chicago-bears-1973",
    id: "DEN-1973-08-02-0110",
    reason: "Summary describes Denver/Chicago only; 49ers asset is blended historical import contamination.",
    teams: ["denver-broncos", "chicago-bears"],
    assetsReceived: {
      "denver-broncos": [{ type: "other", asset: "$1 cash" }],
      "chicago-bears": [{ type: "player", asset: "Ike Hill (a)" }]
    },
    summary: "Denver acquired $1 cash from Chicago Bears for Ike Hill (a). This was an administrative cash transaction, so the public verdict should stay near neutral with conservative historical confidence."
  },
  {
    slug: "cash-new-england-patriots-1974",
    id: "DEN-1974-09-04-0124",
    reason: "Summary describes Denver/New England only; Bengals asset is blended historical import contamination.",
    teams: ["denver-broncos", "new-england-patriots"],
    assetsReceived: {
      "denver-broncos": [{ type: "other", asset: "cash" }],
      "new-england-patriots": [{ type: "player", asset: "Larry Cameron" }]
    },
    summary: "Denver acquired cash from New England Patriots for Larry Cameron. This was a low-scale cash transaction with limited documented long-term impact, so the grade should remain conservative."
  },
  {
    slug: "undisclosed-draft-pick-cleveland-browns-1992",
    id: "ATL-1992-0198",
    reason: "Summary describes Atlanta/Cleveland only; Cowboys asset is blended historical import contamination.",
    teams: ["atlanta-falcons", "cleveland-browns"],
    assetsReceived: {
      "atlanta-falcons": [{ type: "pick", asset: "undisclosed draft pick (?-?)" }],
      "cleveland-browns": [{ type: "player", asset: "Shawn Collins" }]
    },
    summary: "Atlanta acquired an undisclosed draft pick from Cleveland Browns for Shawn Collins. Because the exact pick path is unresolved, the trade should remain graded conservatively as a low-confidence historical transaction."
  },
  {
    slug: "past-considerations-san-francisco-49ers-1998",
    id: "DEN-1998-08-25-0253",
    reason: "Summary describes Denver/San Francisco only; Steelers asset is blended historical import contamination.",
    teams: ["denver-broncos", "san-francisco-49ers"],
    assetsReceived: {
      "denver-broncos": [{ type: "other", asset: "(past considerations)" }],
      "san-francisco-49ers": [
        { type: "player", asset: "Steve Gordon" },
        { type: "player", asset: "David Richie" }
      ]
    },
    summary: "Denver acquired past considerations from San Francisco 49ers for Steve Gordon and David Richie. This was a low-scale historical transaction built around prior or administrative consideration, so the verdict should remain conservative."
  },
  {
    slug: "past-considerations-green-bay-packers-1998",
    id: "DEN-1998-08-30-0255",
    reason: "Summary describes Denver/Green Bay only; Jets asset is blended historical import contamination.",
    teams: ["denver-broncos", "green-bay-packers"],
    assetsReceived: {
      "denver-broncos": [{ type: "other", asset: "(past considerations)" }],
      "green-bay-packers": [{ type: "player", asset: "Seth Joyner" }]
    },
    summary: "Denver acquired past considerations from Green Bay Packers for Seth Joyner. This was an administrative or prior-consideration transaction, so the public verdict should remain conservative rather than overstating the football impact."
  },
  {
    slug: "past-considerations-cleveland-browns-1999",
    id: "BUF-1999-0251",
    reason: "Summary describes Buffalo/Cleveland only; 49ers and Patriots assets are blended historical import contamination.",
    teams: ["buffalo-bills", "cleveland-browns"],
    assetsReceived: {
      "buffalo-bills": [{ type: "other", asset: "(past considerations)" }],
      "cleveland-browns": [{ type: "player", asset: "Chris Spielman" }]
    },
    summary: "Buffalo acquired past considerations from Cleveland Browns for Chris Spielman. The consideration was administrative or not fully documented, so the trade belongs in the archive with a conservative, low-impact verdict."
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

  if (t.id !== r.id) errors.push(`ID mismatch for ${r.slug}: expected ${r.id}, found ${t.id}`);
  if (t.suppressed === true) errors.push(`Trade already suppressed: ${r.slug}`);

  planned.push({
    slug: r.slug,
    id: t.id || null,
    tradeDate: t.tradeDate || t.date || null,
    reason: r.reason,
    before: {
      teams: t.teams || null,
      assetsReceived: t.assetsReceived || null,
      summary: t.summary || null,
      publishStatus: t.publishStatus || null
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
console.log("REPAIR D2 HISTORICAL GENERIC DIRECT ROWS DRY RUN");
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
