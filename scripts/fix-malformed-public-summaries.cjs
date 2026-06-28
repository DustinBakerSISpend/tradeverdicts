const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

if (!DRY_RUN && !APPLY) {
  console.error("Use --dry-run or --apply");
  process.exit(1);
}

const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const fixes = [
  {
    slug: "darren-anderson-tampa-bay-buccaneers-1994",
    replacements: [
      ["for 1995 7th r.", "for a 1995 seventh-round pick."]
    ]
  },
  {
    slug: "1995-1st-round-pick-19th-overall-kansas-city-chiefs-1995",
    replacements: [
      ["Kansas City acquired 1995 1st round pick (31st overall, Trezelle Jenkins), 19.", "Kansas City acquired 1995 1st round pick (31st overall, Trezelle Jenkins)."]
    ]
  },
  {
    slug: "1996-3rd-round-pick-68th-overall-new-england-boston-patriots-1995",
    replacements: [
      ["from N.", "from New England Patriots."]
    ]
  },
  {
    slug: "2008-7th-round-pick-239th-overall-new-york-giants-2007",
    replacements: [
      ["from N.", "from New York Giants."]
    ]
  },
  {
    slug: "trent-green-chiefs-2007",
    replacements: [
      ["for T.", "for Trent Green."]
    ]
  },
  {
    slug: "2008-1st-round-pick-15th-overall-detroit-lions-2008",
    replacements: [
      ["Detroit Lions received 2008 1st round pick (17th overall, Gosder Cherilus), 2. Partner-side value is graded against the same long-term outcome curve", "Detroit Lions received 2008 1st round pick (17th overall, Gosder Cherilus). Partner-side value is graded against the same long-term outcome curve"]
    ]
  },
  {
    slug: "2010-2nd-round-pick-62nd-overall-brandon-spikes-and-2010-5th-round-pick-150th-overall-zolt",
    replacements: [
      ["from N.", "from New England Patriots."]
    ]
  },
  {
    slug: "2015-2nd-round-pick-51st-overall-nate-orchard-2015-4th-round-pick-116th-overall",
    replacements: [
      ["Cleveland Browns received 2015 2nd round pick (51st overall, Nate Orchard), 2.", "Cleveland Browns received 2015 2nd round pick (51st overall, Nate Orchard)."]
    ]
  },
  {
    slug: "2017-5th-round-pick-183rd-overall-new-england-boston-patriots-2017",
    replacements: [
      ["from N.", "from New England Patriots."]
    ]
  },
  {
    slug: "2017-5th-round-pick-170th-overall-rodney-adams-kansas-city-chiefs-2017",
    replacements: [
      ["from M.", "from Minnesota Vikings."]
    ]
  },
  {
    slug: "2018-3rd-round-pick-75th-overall-baltimore-ravens-2018",
    replacements: [
      ["from B.", "from Baltimore Ravens."]
    ]
  },
  {
    slug: "2020-2nd-round-pick-63rd-overall-san-francisco-49ers-2019",
    replacements: [
      ["from San.", "from San Francisco 49ers."]
    ]
  },
  {
    slug: "2019-1st-round-pick-29th-overall-l-j-collier-kansas-city-chiefs-2019",
    replacements: [
      ["Seattle Seahawks received 2019 1st round pick (29th overall, L.J. Collier), 2. Partner-side value is graded against the same long-term outcome curve", "Seattle Seahawks received 2019 1st round pick (29th overall, L.J. Collier). Partner-side value is graded against the same long-term outcome curve"]
    ]
  },
  {
    slug: "2020-3rd-round-pick-91st-overall-subsequently-traded-houston-texans-2019",
    replacements: [
      ["for 2020 3rd r.", "for a 2020 third-round pick."]
    ]
  },
  {
    slug: "orlando-brown-jr-baltimore-ravens-2021",
    replacements: [
      ["Baltimore Ravens received 2021 1st round pick (31st overall, Odafe Oweh), 202. Partner-side value is graded against the same long-term outcome curve", "Baltimore Ravens received 2021 1st round pick (31st overall, Odafe Oweh). Partner-side value is graded against the same long-term outcome curve"]
    ]
  },
  {
    slug: "eagles-2022-04-28-houston-texans-0433",
    replacements: [
      ["Houston acquired 2022 1st round pick (15th overall, Kenyon Green), 2.", "Houston acquired 2022 1st round pick (15th overall, Kenyon Green)."]
    ]
  },
  {
    slug: "calvin-ridley-atlanta-falcons-2022",
    replacements: [
      ["ultimatelycost", "ultimately cost"]
    ]
  },
  {
    slug: "laremy-tunsil-and-2025-4th-round-pick-128th-overall-jaylin-lane-houston-texans-2025",
    replacements: [
      ["Houston acquired 2025 3rd round pick (79th overall, Jaylin Noel), 20.", "Houston acquired 2025 3rd round pick (79th overall, Jaylin Noel)."]
    ]
  },
  {
    slug: "2025-3rd-round-pick-85th-overall-new-england-boston-patriots-2025",
    replacements: [
      ["from N.", "from New England Patriots."]
    ]
  }
];

function publicFieldRefs(trade) {
  const refs = [
    ["summary", trade],
    ["description", trade],
    ["shortSummary", trade],
  ];

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((p, i) => {
      refs.push([`perspectives[${i}].primarySummary`, p]);
      refs.push([`perspectives[${i}].partnerSummary`, p]);
    });
  }

  return refs;
}

const changes = [];
const missing = [];

for (const fix of fixes) {
  const trade = trades.find((t) => t.slug === fix.slug);

  if (!trade) {
    missing.push(fix.slug);
    continue;
  }

  for (const [fieldPath, owner] of publicFieldRefs(trade)) {
    const field = fieldPath.split(".").at(-1);
    if (typeof owner[field] !== "string") continue;

    let text = owner[field];
    let changed = false;

    for (const [beforeNeedle, afterNeedle] of fix.replacements) {
      if (text.includes(beforeNeedle)) {
        text = text.split(beforeNeedle).join(afterNeedle);
        changed = true;
      }
    }

    if (changed && text !== owner[field]) {
      changes.push({
        slug: trade.slug,
        id: trade.id,
        field: fieldPath,
        before: owner[field],
        after: text,
      });

      if (APPLY) owner[field] = text;
    }
  }
}

const reportPath = path.join(
  "audit",
  "reports",
  `malformed-public-summary-fix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);

fs.writeFileSync(reportPath, JSON.stringify({
  mode: DRY_RUN ? "dry-run" : "apply",
  missing,
  changedFields: changes.length,
  changedTrades: new Set(changes.map((c) => c.slug)).size,
  sample: changes.slice(0, 30),
  changes,
}, null, 2));

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");
}

console.log(DRY_RUN ? "MALFORMED SUMMARY DRY RUN COMPLETE" : "MALFORMED SUMMARY APPLY COMPLETE");
console.log(JSON.stringify({
  missing,
  changedFields: changes.length,
  changedTrades: new Set(changes.map((c) => c.slug)).size,
  reportPath,
  firstTen: changes.slice(0, 10).map((c) => ({
    slug: c.slug,
    field: c.field,
    before: c.before,
    after: c.after,
  })),
}, null, 2));
