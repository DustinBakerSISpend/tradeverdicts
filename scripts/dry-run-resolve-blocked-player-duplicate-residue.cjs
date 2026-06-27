const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "resolve-blocked-player-duplicate-residue-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const plans = [
  {
    label: "1976 Giants/Oilers Dawkins-Simonson duplicate",
    keeperSlug: "undisclosed-consideration-houston-oilers-tennessee-titans-1976",
    suppressSlug: "joe-dawkins-new-york-giants-1976",
    keeperPatch: {
      publishStatus: "ready",
      assetsReceived: {
        "new-york-giants": [
          { type: "pick", asset: "1977 seventh round pick (#178-Al Dixon)" },
          { type: "pick", asset: "undisclosed pick (possibly 1978 #188-Rich Martini)" }
        ],
        "tennessee-titans": [
          { type: "player", asset: "Joe Dawkins" },
          { type: "player", asset: "Dave Simonson" }
        ]
      },
      summary: "New York acquired 1977 seventh round pick (#178-Al Dixon) and an undisclosed pick (possibly 1978 #188-Rich Martini) from Houston Oilers/Tennessee Titans for Joe Dawkins and Dave Simonson. This resolves the duplicate player-slug row while preserving the fuller documented asset path."
    }
  },
  {
    label: "1988 Eagles/Oilers Cooper-Foules duplicate",
    keeperSlug: "eagles-1988-07-23-houston-oilers-tennessee-titans-0237",
    suppressSlug: "evan-cooper-philadelphia-eagles-1988",
    keeperPatch: {
      publishStatus: "ready",
      assetsReceived: {
        "philadelphia-eagles": [
          { type: "pick", asset: "1989 conditional pick (?-?)" }
        ],
        "tennessee-titans": [
          { type: "player", asset: "Evan Cooper" },
          { type: "player", asset: "Elbert Foules" }
        ]
      },
      summary: "Philadelphia acquired a 1989 conditional pick from Houston Oilers/Tennessee Titans for Evan Cooper and Elbert Foules. The keeper row preserves both outgoing players and the conditional-pick return, while the thinner player-slug duplicate can be suppressed."
    }
  },
  {
    label: "1974 Chargers/Washington Deacon Jones duplicate",
    keeperSlug: "david-jones-deacon-jones-los-angeles-san-diego-chargers-1974",
    suppressSlug: "unspecified-consideration-washington-redskinscommanders-1974-lac-1974-0107",
    keeperPatch: {
      publishStatus: "ready",
      assetsReceived: {
        "washington-commanders": [
          { type: "player", asset: "David Jones / Deacon Jones" },
          { type: "pick", asset: "draft pick (undisclosed)" }
        ],
        "los-angeles-chargers": [
          { type: "pick", asset: "draft pick (undisclosed)" }
        ]
      },
      summary: "Washington acquired David Jones / Deacon Jones and an undisclosed draft pick from Los Angeles/San Diego Chargers for an undisclosed draft pick. The keeper row preserves the cleaner public asset path, while the hold-conflict duplicate can be suppressed."
    }
  },
  {
    label: "1981 Chargers/Washington McCrary-Floyd duplicate",
    keeperSlug: "gregg-mccrary-los-angeles-san-diego-chargers-1981",
    suppressSlug: "unspecified-consideration-washington-redskinscommanders-1981-lac-1981-0197",
    keeperPatch: {
      publishStatus: "ready",
      assetsReceived: {
        "washington-commanders": [
          { type: "player", asset: "Gregg McCrary" },
          { type: "player", asset: "John Floyd" }
        ],
        "los-angeles-chargers": [
          { type: "pick", asset: "1983 eleventh round pick (#307-Tim Spencer)" },
          { type: "pick", asset: "undisclosed draft pick (undisclosed)" }
        ]
      },
      summary: "Washington acquired Gregg McCrary and John Floyd from Los Angeles/San Diego Chargers for 1983 eleventh round pick (#307-Tim Spencer) and an undisclosed draft pick. The keeper row preserves the full player-for-picks exchange, while the hold-conflict duplicate can be suppressed."
    }
  }
];

const errors = [];
const planned = [];

for (const p of plans) {
  const keeper = find(p.keeperSlug);
  const suppress = find(p.suppressSlug);

  if (!keeper) errors.push(`Missing keeper: ${p.keeperSlug}`);
  if (!suppress) errors.push(`Missing suppress target: ${p.suppressSlug}`);
  if (keeper && keeper.suppressed === true) errors.push(`Keeper already suppressed: ${p.keeperSlug}`);
  if (suppress && suppress.suppressed === true) errors.push(`Suppress target already suppressed: ${p.suppressSlug}`);

  planned.push({
    label: p.label,
    keeper: keeper ? {
      slug: slugOf(keeper),
      id: keeper.id || null,
      tradeDate: keeper.tradeDate || keeper.date || null,
      before: {
        publishStatus: keeper.publishStatus || null,
        teams: keeper.teams || null,
        assetsReceived: keeper.assetsReceived || null,
        summary: keeper.summary || null,
        qaNotes: keeper.qaNotes || null
      },
      after: {
        publishStatus: p.keeperPatch.publishStatus,
        teams: keeper.teams || null,
        assetsReceived: p.keeperPatch.assetsReceived,
        summary: p.keeperPatch.summary
      }
    } : null,
    suppress: suppress ? {
      slug: slugOf(suppress),
      id: suppress.id || null,
      tradeDate: suppress.tradeDate || suppress.date || null,
      before: {
        publishStatus: suppress.publishStatus || null,
        teams: suppress.teams || null,
        assetsReceived: suppress.assetsReceived || null,
        summary: suppress.summary || null,
        qaNotes: suppress.qaNotes || null,
        suppressed: suppress.suppressed ?? null
      },
      after: {
        suppressed: true
      }
    } : null
  });
}

fs.writeFileSync(outPath, JSON.stringify({
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  plannedResolutionCount: planned.length,
  errorCount: errors.length,
  errors,
  planned
}, null, 2));

console.log("");
console.log("RESOLVE BLOCKED PLAYER-DUPLICATE RESIDUE DRY RUN");
console.log("=".repeat(80));
console.log(`planned resolutions: ${planned.length}`);
console.log(`errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

for (const e of errors) console.log(`ERROR: ${e}`);

for (const p of planned) {
  console.log("");
  console.log("-".repeat(80));
  console.log(p.label);

  console.log("");
  console.log("KEEPER:");
  console.log(`${p.keeper?.slug} | ${p.keeper?.id} | ${p.keeper?.tradeDate}`);
  console.log(`status: ${p.keeper?.before.publishStatus} -> ${p.keeper?.after.publishStatus}`);
  console.log("BEFORE assets:");
  console.dir(p.keeper?.before.assetsReceived, { depth: null });
  console.log("AFTER assets:");
  console.dir(p.keeper?.after.assetsReceived, { depth: null });
  console.log("AFTER summary:");
  console.log(p.keeper?.after.summary);

  console.log("");
  console.log("SUPPRESS:");
  console.log(`${p.suppress?.slug} | ${p.suppress?.id} | ${p.suppress?.tradeDate}`);
  console.log(`status=${p.suppress?.before.publishStatus} suppressed=${p.suppress?.before.suppressed} -> true`);
  console.log("assets:");
  console.dir(p.suppress?.before.assetsReceived, { depth: null });
}

if (errors.length) process.exit(1);
