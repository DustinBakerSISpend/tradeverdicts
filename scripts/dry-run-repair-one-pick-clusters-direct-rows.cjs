const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "repair-one-pick-clusters-direct-rows-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const repairs = [
  {
    slug: "draft-pick-atlanta-falcons-1968",
    id: "WAS-1968-0128",
    reason: "Summary describes Washington/Atlanta only; Vikings and 49ers are blended one-pick cluster contamination.",
    teams: ["washington-commanders", "atlanta-falcons"],
    assetsReceived: {
      "washington-commanders": [{ type: "pick", asset: "undisclosed draft pick (?-?)" }],
      "atlanta-falcons": [{ type: "player", asset: "Heath Wingate" }]
    },
    summary: "Washington acquired an undisclosed draft pick from Atlanta Falcons for Heath Wingate. Because the exact pick path is unresolved, the trade should remain graded conservatively as a low-confidence historical transaction."
  },
  {
    slug: "1998-7th-round-pick-200th-overall-trey-teague-philadelphia-eagles-1998",
    id: "DEN-1998-04-19-0251",
    reason: "Summary describes Denver/Philadelphia only; Falcons and 49ers assets are downstream pick-chain contamination.",
    teams: ["denver-broncos", "philadelphia-eagles"],
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "1998 7th round pick (200th overall, Trey Teague)" }],
      "philadelphia-eagles": [{ type: "pick", asset: "1999 6th round pick (201st overall, Troy Smith)" }]
    },
    summary: "Denver acquired 1998 7th round pick (200th overall, Trey Teague) from Philadelphia Eagles for 1999 6th round pick (201st overall, Troy Smith). This was primarily a late-round draft-position exchange, so the grade stays conservative."
  },
  {
    slug: "panthers-san-francisco-49ers-trade-2004-0025",
    id: "CAR-2004-0025",
    reason: "Direct trade is Carolina/San Francisco; Vikings, Dolphins, Bengals, and Rams assets are broader draft-chain contamination.",
    teams: ["carolina-panthers", "san-francisco-49ers"],
    assetsReceived: {
      "carolina-panthers": [{ type: "pick", asset: "2004 1st round pick (28th overall, Chris Gamble)" }],
      "san-francisco-49ers": [
        { type: "pick", asset: "2004 1st round pick (31st overall, Rashaun Woods)" },
        { type: "pick", asset: "2004 4th round pick (127th overall, Richard Seigler)" }
      ]
    },
    summary: "Carolina acquired 2004 1st round pick (28th overall, Chris Gamble) from San Francisco 49ers for 2004 1st round pick (31st overall, Rashaun Woods) and 2004 4th round pick (127th overall, Richard Seigler). Gamble became the best long-term player in the exchange, giving Carolina the clearer historical edge."
  },
  {
    slug: "2008-4th-round-pick-100th-overall-dallas-cowboys-2008",
    id: "RAI-2008-0331",
    reason: "Direct trade is Raiders/Cowboys; Dolphins and Bears assets are downstream pick-chain contamination.",
    teams: ["las-vegas-raiders", "dallas-cowboys"],
    assetsReceived: {
      "las-vegas-raiders": [{ type: "pick", asset: "2008 4th round pick (100th overall, Tyvon Branch)" }],
      "dallas-cowboys": [
        { type: "pick", asset: "2008 4th round pick (104th overall subsequently traded, Beau Bell)" },
        { type: "pick", asset: "2008 7th round pick (213th overall subsequently traded, Chauncey Washington)" }
      ]
    },
    summary: "Oakland Raiders acquired 2008 4th round pick (100th overall, Tyvon Branch) from Dallas Cowboys for 2008 4th round pick (104th overall subsequently traded, Beau Bell) and 2008 7th round pick (213th overall subsequently traded, Chauncey Washington). Branch became the most useful player tied to the exchange, giving the Raiders the stronger outcome."
  },
  {
    slug: "panthers-new-york-jets-trade-2010-0043",
    id: "CAR-2010-0043",
    reason: "Direct trade is Carolina/New York Jets; Cardinals and Saints assets are downstream pick-chain contamination.",
    teams: ["carolina-panthers", "new-york-jets"],
    assetsReceived: {
      "carolina-panthers": [
        { type: "pick", asset: "2010 4th round pick (124th overall, Eric Norwood)" },
        { type: "pick", asset: "2010 6th round pick (198th overall, David Gettis)" }
      ],
      "new-york-jets": [{ type: "pick", asset: "2010 4th round pick (112th overall, Joe McKnight)" }]
    },
    summary: "Carolina acquired 2010 4th round pick (124th overall, Eric Norwood) and 2010 6th round pick (198th overall, David Gettis) from New York Jets for 2010 4th round pick (112th overall, Joe McKnight). This was a close mid-round exchange, with the outcome staying near neutral because neither side created a major long-term swing."
  },
  {
    slug: "2012-4th-round-pick-117th-overall-joe-looney-detroit-lions-2012",
    id: "SF-2012-0355",
    reason: "Direct trade is San Francisco/Detroit; Steelers and Washington assets are downstream pick-chain contamination.",
    teams: ["san-francisco-49ers", "detroit-lions"],
    assetsReceived: {
      "san-francisco-49ers": [{ type: "pick", asset: "2012 4th round pick (117th overall, Joe Looney)" }],
      "detroit-lions": [
        { type: "pick", asset: "2012 4th round pick (125th overall, Ronnell Lewis)" },
        { type: "pick", asset: "2012 6th round pick (196th overall, Jonte Green)" }
      ]
    },
    summary: "San Francisco acquired 2012 4th round pick (117th overall, Joe Looney) from Detroit Lions for 2012 4th round pick (125th overall, Ronnell Lewis) and 2012 6th round pick (196th overall, Jonte Green). Looney became the more durable NFL contributor, giving San Francisco the modest historical edge."
  },
  {
    slug: "eagles-2014-05-09-cleveland-browns-0372",
    id: "PHI-2014-0372",
    reason: "Direct trade is Philadelphia/Cleveland; Cardinals and Saints assets are downstream pick-chain contamination.",
    teams: ["philadelphia-eagles", "cleveland-browns"],
    assetsReceived: {
      "philadelphia-eagles": [
        { type: "pick", asset: "2014 1st round pick (26th overall, Marcus Smith)" },
        { type: "pick", asset: "2014 3rd round pick (83rd overall subsequently traded, Louis Nix)" }
      ],
      "cleveland-browns": [{ type: "pick", asset: "2014 1st round pick (22nd overall, Johnny Manziel)" }]
    },
    summary: "Philadelphia acquired 2014 1st round pick (26th overall, Marcus Smith) and 2014 3rd round pick (83rd overall subsequently traded, Louis Nix) from Cleveland Browns for 2014 1st round pick (22nd overall, Johnny Manziel). The trade remains a difficult outcome for both sides, with neither first-round path producing the expected value."
  },
  {
    slug: "2026-5th-round-pick-152nd-overall-justin-joly-cleveland-browns-2026",
    id: "DEN-2026-04-25-0401",
    reason: "Direct trade is Denver/Cleveland; Bills and Lions assets are downstream pick-chain contamination.",
    teams: ["denver-broncos", "cleveland-browns"],
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2026 5th round pick (152nd overall, Justin Joly)" }],
      "cleveland-browns": [
        { type: "pick", asset: "2026 5th round pick (170th overall, Joe Royer)" },
        { type: "pick", asset: "2026 6th round pick (182nd overall, Taylen Green)" }
      ]
    },
    summary: "Denver acquired 2026 5th round pick (152nd overall, Justin Joly) from Cleveland Browns for 2026 5th round pick (170th overall, Joe Royer) and 2026 6th round pick (182nd overall, Taylen Green). This was a modest Day 3 move-up, with the grade held near neutral until the players' NFL roles become clearer."
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
console.log("REPAIR ONE-PICK CLUSTERS DIRECT ROWS DRY RUN");
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
