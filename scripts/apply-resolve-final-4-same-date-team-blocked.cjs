const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "resolve-final-4-same-date-team-blocked-apply-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function dateOf(t) {
  return t?.tradeDate || t?.date || "";
}

function sameTeamSet(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

const plans = [
  {
    label: "Bo Eason 1988 duplicate",
    keeperSlug: "bo-eason-houston-oilers-tennessee-titans-1988",
    suppressSlug: "1989-conditional-fifth-round-pick-if-eason-makes-roster-san-francisco",
    keeperStatus: "ready",
    reason: "Keeper is complete but was provisional; suppress target is thin duplicate with only Bo Eason and no pick-side detail."
  },
  {
    label: "Dick Chapura 1991 duplicate",
    keeperSlug: "eagles-1991-08-08-houston-oilers-tennessee-titans-0249",
    suppressSlug: "dick-chapura-philadelphia-eagles-1991",
    keeperStatus: "ready",
    reason: "Keeper is complete but was provisional; suppress target is thin duplicate with only the undisclosed pick side."
  },
  {
    label: "Warren Moon 1994 duplicate",
    keeperSlug: "warren-moon-houston-oilers-tennessee-titans-1994",
    suppressSlug: "1994-4th-round-pick-119th-overall-mike-davis-and-1995-3rd-round-pick-8",
    keeperStatus: "ready",
    reason: "Pick mismatch was parser noise from truncated slug; keeper contains 1994-R4-P119 and 1995-R3-P89, while suppress target is thin player-only duplicate."
  },
  {
    label: "Chris Chandler 1997 duplicate",
    keeperSlug: "chris-chandler-tennessee-titans-1997",
    suppressSlug: "1997-4th-round-pick-98th-overall-derrick-mason-and-1997-6th-round-pick",
    keeperStatus: "ready",
    reason: "Pick mismatch was parser noise from truncated slug; keeper contains 1997-R4-P98 and 1997-R6-P165, while suppress target is thin player-only duplicate."
  }
];

const errors = [];
const applied = [];

for (const p of plans) {
  const keeper = find(p.keeperSlug);
  const suppress = find(p.suppressSlug);

  if (!keeper) errors.push(`Missing keeper: ${p.keeperSlug}`);
  if (!suppress) errors.push(`Missing suppress target: ${p.suppressSlug}`);

  if (keeper && keeper.suppressed === true) errors.push(`Keeper already suppressed: ${p.keeperSlug}`);
  if (suppress && suppress.suppressed === true) errors.push(`Suppress target already suppressed: ${p.suppressSlug}`);

  if (keeper && suppress && dateOf(keeper) !== dateOf(suppress)) {
    errors.push(`Date mismatch: keeper=${p.keeperSlug} suppress=${p.suppressSlug}`);
  }

  if (keeper && suppress && !sameTeamSet(keeper.teams || [], suppress.teams || [])) {
    errors.push(`Team-set mismatch: keeper=${p.keeperSlug} suppress=${p.suppressSlug}`);
  }
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("RESOLVE FINAL 4 SAME-DATE/TEAM BLOCKED APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const e of errors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const p of plans) {
  const keeper = find(p.keeperSlug);
  const suppress = find(p.suppressSlug);

  const keeperBefore = {
    id: keeper.id || null,
    slug: slugOf(keeper),
    tradeDate: dateOf(keeper),
    publishStatus: keeper.publishStatus || null,
    suppressed: keeper.suppressed ?? null,
    assetsReceived: keeper.assetsReceived || null,
    summary: keeper.summary || null,
    qaNotes: keeper.qaNotes || null
  };

  const suppressBefore = {
    id: suppress.id || null,
    slug: slugOf(suppress),
    tradeDate: dateOf(suppress),
    publishStatus: suppress.publishStatus || null,
    suppressed: suppress.suppressed ?? null,
    assetsReceived: suppress.assetsReceived || null,
    summary: suppress.summary || null,
    qaNotes: suppress.qaNotes || null
  };

  keeper.publishStatus = p.keeperStatus;
  keeper.qaNotes = keeper.qaNotes
    ? `${keeper.qaNotes} Resolved final same-date/team duplicate blocker; retained as canonical keeper.`
    : "Resolved final same-date/team duplicate blocker; retained as canonical keeper.";
  keeper.updatedAt = new Date().toISOString();

  suppress.suppressed = true;
  suppress.qaNotes = suppress.qaNotes
    ? `${suppress.qaNotes} Suppressed as final same-date/team duplicate; canonical keeper is ${p.keeperSlug}. ${p.reason}`
    : `Suppressed as final same-date/team duplicate; canonical keeper is ${p.keeperSlug}. ${p.reason}`;
  suppress.updatedAt = new Date().toISOString();

  applied.push({
    label: p.label,
    reason: p.reason,
    keeper: {
      before: keeperBefore,
      after: {
        id: keeper.id || null,
        slug: slugOf(keeper),
        tradeDate: dateOf(keeper),
        publishStatus: keeper.publishStatus || null,
        suppressed: keeper.suppressed ?? null,
        qaNotes: keeper.qaNotes || null
      }
    },
    suppress: {
      before: suppressBefore,
      after: {
        id: suppress.id || null,
        slug: slugOf(suppress),
        tradeDate: dateOf(suppress),
        publishStatus: suppress.publishStatus || null,
        suppressed: suppress.suppressed,
        qaNotes: suppress.qaNotes || null
      }
    }
  });
}

const postErrors = [];

for (const a of applied) {
  const keeper = find(a.keeper.after.slug);
  const suppress = find(a.suppress.after.slug);

  if (!keeper) postErrors.push(`Keeper missing after apply: ${a.keeper.after.slug}`);
  if (!suppress) postErrors.push(`Suppress target missing after apply: ${a.suppress.after.slug}`);
  if (keeper && keeper.suppressed === true) postErrors.push(`Keeper suppressed after apply: ${a.keeper.after.slug}`);
  if (keeper && keeper.publishStatus !== "ready") postErrors.push(`Keeper not ready after apply: ${a.keeper.after.slug}`);
  if (suppress && suppress.suppressed !== true) postErrors.push(`Suppress target not suppressed after apply: ${a.suppress.after.slug}`);
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
console.log("RESOLVE FINAL 4 SAME-DATE/TEAM BLOCKED APPLY");
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
