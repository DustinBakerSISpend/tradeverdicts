const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const inspectPath = path.join(process.cwd(), "audits", "inspect-generic-rights-player-duplicate-plan.json");
const outPath = path.join(process.cwd(), "audits", "suppress-safe-generic-rights-player-duplicates-apply-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;
const inspect = JSON.parse(fs.readFileSync(inspectPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const protectedSlugs = new Set([
  "bill-mathis-houston-oilers-tennessee-titans-1960",
  "future-draft-rights-rights-to-undisclosed-player-new-york-titans-jets"
]);

const errors = [];
const applied = [];

if ((inspect.inspectedCount || 0) !== 10) errors.push(`Expected 10 inspected rows, found ${inspect.inspectedCount}`);
if ((inspect.safeCount || 0) !== 10) errors.push(`Expected 10 safe rows, found ${inspect.safeCount}`);
if ((inspect.blockedCount || 0) !== 0) errors.push(`Expected 0 blocked rows, found ${inspect.blockedCount}`);

for (const r of inspect.safe || []) {
  const keeperSlug = r.keeper?.slug;
  const suppressSlug = r.suppress?.slug;

  const keeper = find(keeperSlug);
  const suppress = find(suppressSlug);

  if (!keeper) errors.push(`Missing keeper: ${keeperSlug}`);
  if (!suppress) errors.push(`Missing suppress target: ${suppressSlug}`);

  if (protectedSlugs.has(keeperSlug) || protectedSlugs.has(suppressSlug)) {
    errors.push(`Protected Bill Mathis-related slug appeared in apply lane: keeper=${keeperSlug} suppress=${suppressSlug}`);
  }

  if (keeper && keeper.suppressed === true) errors.push(`Keeper already suppressed: ${keeperSlug}`);
  if (suppress && suppress.suppressed === true) errors.push(`Suppress target already suppressed: ${suppressSlug}`);

  if (!["ready", "publish"].includes(keeper?.publishStatus)) {
    errors.push(`Keeper is not ready/publish: ${keeperSlug} status=${keeper?.publishStatus}`);
  }

  if ((r.uniquePlayers || []).length > 0) {
    errors.push(`Suppress target has unique player data not covered by keeper: ${suppressSlug}`);
  }

  if ((r.uniquePicks || []).length > 0) {
    errors.push(`Suppress target has unique pick data not covered by keeper: ${suppressSlug}`);
  }
}

const suppressSlugs = (inspect.safe || []).map(r => r.suppress?.slug).filter(Boolean);
const dupSuppressSlugs = suppressSlugs.filter((slug, idx) => suppressSlugs.indexOf(slug) !== idx);
if (dupSuppressSlugs.length) errors.push(`Duplicate suppress targets: ${[...new Set(dupSuppressSlugs)].join(", ")}`);

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("SUPPRESS SAFE GENERIC-RIGHTS PLAYER DUPLICATES APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const e of errors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const r of inspect.safe || []) {
  const keeper = find(r.keeper.slug);
  const suppress = find(r.suppress.slug);

  const before = {
    id: suppress.id || null,
    slug: slugOf(suppress),
    tradeDate: suppress.tradeDate || suppress.date || null,
    teams: suppress.teams || null,
    publishStatus: suppress.publishStatus || null,
    suppressed: suppress.suppressed ?? null,
    assetsReceived: suppress.assetsReceived || null,
    summary: suppress.summary || null,
    qaNotes: suppress.qaNotes || null
  };

  suppress.suppressed = true;
  suppress.qaNotes = suppress.qaNotes
    ? `${suppress.qaNotes} Suppressed as safe generic-rights/undisclosed-consideration duplicate; canonical keeper is ${slugOf(keeper)} (${keeper.id || "no-id"}).`
    : `Suppressed as safe generic-rights/undisclosed-consideration duplicate; canonical keeper is ${slugOf(keeper)} (${keeper.id || "no-id"}).`;
  suppress.updatedAt = new Date().toISOString();

  keeper.qaNotes = keeper.qaNotes
    ? `${keeper.qaNotes} Retained as canonical keeper for suppressed generic-rights/undisclosed-consideration duplicate ${slugOf(suppress)}.`
    : `Retained as canonical keeper for suppressed generic-rights/undisclosed-consideration duplicate ${slugOf(suppress)}.`;
  keeper.updatedAt = new Date().toISOString();

  applied.push({
    keeper: {
      id: keeper.id || null,
      slug: slugOf(keeper),
      tradeDate: keeper.tradeDate || keeper.date || null,
      publishStatus: keeper.publishStatus || null,
      suppressed: keeper.suppressed ?? null
    },
    suppress: {
      before,
      after: {
        id: suppress.id || null,
        slug: slugOf(suppress),
        tradeDate: suppress.tradeDate || suppress.date || null,
        publishStatus: suppress.publishStatus || null,
        suppressed: suppress.suppressed,
        qaNotes: suppress.qaNotes || null
      }
    },
    suppressPlayers: r.suppressPlayers || [],
    suppressPicks: r.suppressPicks || []
  });
}

const postErrors = [];

for (const a of applied) {
  const keeper = find(a.keeper.slug);
  const suppress = find(a.suppress.after.slug);

  if (!keeper) postErrors.push(`Keeper missing after apply: ${a.keeper.slug}`);
  if (!suppress) postErrors.push(`Suppress target missing after apply: ${a.suppress.after.slug}`);

  if (keeper && keeper.suppressed === true) postErrors.push(`Keeper was suppressed: ${a.keeper.slug}`);
  if (suppress && suppress.suppressed !== true) postErrors.push(`Suppress target not suppressed: ${a.suppress.after.slug}`);
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  appliedSuppressionCount: applied.length,
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
console.log("SUPPRESS SAFE GENERIC-RIGHTS PLAYER DUPLICATES APPLY");
console.log("=".repeat(80));
console.log(`Applied suppressions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const a of applied) {
  console.log("-".repeat(80));
  console.log(`SUPPRESSED: ${a.suppress.after.slug} | ${a.suppress.after.id} | ${a.suppress.after.tradeDate}`);
  console.log(`KEEPER:     ${a.keeper.slug} | ${a.keeper.id}`);
}
