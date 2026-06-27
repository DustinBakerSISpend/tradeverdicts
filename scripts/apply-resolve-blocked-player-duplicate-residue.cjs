const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "resolve-blocked-player-duplicate-residue-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "resolve-blocked-player-duplicate-residue-apply-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const expectedSuppressions = [
  "joe-dawkins-new-york-giants-1976",
  "evan-cooper-philadelphia-eagles-1988",
  "unspecified-consideration-washington-redskinscommanders-1974-lac-1974-0107",
  "unspecified-consideration-washington-redskinscommanders-1981-lac-1981-0197"
];

const patches = {
  "undisclosed-consideration-houston-oilers-tennessee-titans-1976": {
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
  },

  "eagles-1988-07-23-houston-oilers-tennessee-titans-0237": {
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
  },

  "david-jones-deacon-jones-los-angeles-san-diego-chargers-1974": {
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
  },

  "gregg-mccrary-los-angeles-san-diego-chargers-1981": {
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
};

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan is not dry-run mode.");
if ((plan.errorCount || 0) !== 0) errors.push(`Plan has errors: ${plan.errorCount}`);
if ((plan.plannedResolutionCount || 0) !== 4) errors.push(`Expected 4 planned resolutions, found ${plan.plannedResolutionCount}`);

const plannedSuppressions = (plan.planned || []).map(p => p.suppress?.slug).filter(Boolean);
for (const slug of expectedSuppressions) {
  if (!plannedSuppressions.includes(slug)) errors.push(`Expected suppress target missing from plan: ${slug}`);
}

for (const p of plan.planned || []) {
  const keeperSlug = p.keeper?.slug;
  const suppressSlug = p.suppress?.slug;

  const keeper = find(keeperSlug);
  const suppress = find(suppressSlug);

  if (!keeper) errors.push(`Missing keeper: ${keeperSlug}`);
  if (!suppress) errors.push(`Missing suppress target: ${suppressSlug}`);

  if (keeper && keeper.suppressed === true) errors.push(`Keeper already suppressed: ${keeperSlug}`);
  if (suppress && suppress.suppressed === true) errors.push(`Suppress target already suppressed: ${suppressSlug}`);

  if (!patches[keeperSlug]) errors.push(`No patch defined for keeper: ${keeperSlug}`);
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("RESOLVE BLOCKED PLAYER-DUPLICATE RESIDUE APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const e of errors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const p of plan.planned || []) {
  const keeperSlug = p.keeper.slug;
  const suppressSlug = p.suppress.slug;

  const keeper = find(keeperSlug);
  const suppress = find(suppressSlug);
  const patch = patches[keeperSlug];

  const keeperBefore = {
    id: keeper.id || null,
    slug: slugOf(keeper),
    tradeDate: keeper.tradeDate || keeper.date || null,
    publishStatus: keeper.publishStatus || null,
    suppressed: keeper.suppressed ?? null,
    assetsReceived: keeper.assetsReceived || null,
    summary: keeper.summary || null,
    qaNotes: keeper.qaNotes || null
  };

  const suppressBefore = {
    id: suppress.id || null,
    slug: slugOf(suppress),
    tradeDate: suppress.tradeDate || suppress.date || null,
    publishStatus: suppress.publishStatus || null,
    suppressed: suppress.suppressed ?? null,
    assetsReceived: suppress.assetsReceived || null,
    summary: suppress.summary || null,
    qaNotes: suppress.qaNotes || null
  };

  keeper.publishStatus = patch.publishStatus;
  keeper.assetsReceived = patch.assetsReceived;
  keeper.summary = patch.summary;
  keeper.qaNotes = keeper.qaNotes
    ? `${keeper.qaNotes} Resolved blocked player-duplicate residue; keeper normalized and duplicate page suppressed.`
    : "Resolved blocked player-duplicate residue; keeper normalized and duplicate page suppressed.";
  keeper.updatedAt = new Date().toISOString();

  suppress.suppressed = true;
  suppress.qaNotes = suppress.qaNotes
    ? `${suppress.qaNotes} Suppressed as blocked-residue player duplicate; canonical keeper is ${keeperSlug}.`
    : `Suppressed as blocked-residue player duplicate; canonical keeper is ${keeperSlug}.`;
  suppress.updatedAt = new Date().toISOString();

  applied.push({
    label: p.label,
    keeper: {
      before: keeperBefore,
      after: {
        id: keeper.id || null,
        slug: slugOf(keeper),
        tradeDate: keeper.tradeDate || keeper.date || null,
        publishStatus: keeper.publishStatus || null,
        suppressed: keeper.suppressed ?? null,
        assetsReceived: keeper.assetsReceived || null,
        summary: keeper.summary || null,
        qaNotes: keeper.qaNotes || null
      }
    },
    suppress: {
      before: suppressBefore,
      after: {
        id: suppress.id || null,
        slug: slugOf(suppress),
        tradeDate: suppress.tradeDate || suppress.date || null,
        publishStatus: suppress.publishStatus || null,
        suppressed: suppress.suppressed,
        qaNotes: suppress.qaNotes || null
      }
    }
  });
}

const postErrors = [];

for (const p of plan.planned || []) {
  const keeper = find(p.keeper.slug);
  const suppress = find(p.suppress.slug);

  if (!keeper) postErrors.push(`Keeper missing after apply: ${p.keeper.slug}`);
  if (!suppress) postErrors.push(`Suppress target missing after apply: ${p.suppress.slug}`);

  if (keeper && keeper.suppressed === true) postErrors.push(`Keeper suppressed after apply: ${p.keeper.slug}`);
  if (keeper && keeper.publishStatus !== "ready") postErrors.push(`Keeper not ready after apply: ${p.keeper.slug} status=${keeper.publishStatus}`);
  if (suppress && suppress.suppressed !== true) postErrors.push(`Suppress target not suppressed after apply: ${p.suppress.slug}`);
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  appliedResolutionCount: applied.length,
  errors: postErrors,
  applied
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (postErrors.length) {
  console.error("");
  console.error("POST-APPLY VALIDATION FAILED. Data was not written.");
  for (const e of postErrors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

fs.writeFileSync(dataPath, JSON.stringify(Array.isArray(raw) ? trades : raw, null, 2) + "\n");

console.log("");
console.log("RESOLVE BLOCKED PLAYER-DUPLICATE RESIDUE APPLY");
console.log("=".repeat(80));
console.log(`Applied resolutions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const a of applied) {
  console.log("-".repeat(80));
  console.log(a.label);
  console.log(`KEEPER:   ${a.keeper.after.slug} | ${a.keeper.after.id} | status ${a.keeper.before.publishStatus} -> ${a.keeper.after.publishStatus}`);
  console.log(`SUPPRESS: ${a.suppress.after.slug} | ${a.suppress.after.id} | suppressed ${a.suppress.before.suppressed} -> ${a.suppress.after.suppressed}`);
}
