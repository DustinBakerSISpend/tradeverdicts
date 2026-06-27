const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const inspectPath = path.join(process.cwd(), "audits", "inspect-same-date-team-trade-duplicate-plan-v2.json");
const outPath = path.join(process.cwd(), "audits", "suppress-safe-same-date-team-trade-duplicates-v2-apply-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;
const inspect = JSON.parse(fs.readFileSync(inspectPath, "utf8"));

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

const requiredButchSuppress = "1985-third-round-pick-82-mike-kelley-c-denver-broncos-1984";
const requiredButchKeeper = "butch-johnson-houston-oilers-tennessee-titans-1984";

const errors = [];
const applied = [];

if ((inspect.conflictCount || 0) !== 0) errors.push(`Expected 0 conflicts, found ${inspect.conflictCount}`);
if ((inspect.safeCount || 0) !== 42) errors.push(`Expected 42 safe rows, found ${inspect.safeCount}`);
if ((inspect.blockedCount || 0) !== 4) errors.push(`Expected 4 blocked rows, found ${inspect.blockedCount}`);

const safeRows = inspect.safe || [];
const suppressSlugs = safeRows.map(r => r.suppress?.slug).filter(Boolean);
const dupSuppressSlugs = suppressSlugs.filter((slug, idx) => suppressSlugs.indexOf(slug) !== idx);

if (dupSuppressSlugs.length) {
  errors.push(`Duplicate suppress targets in safe lane: ${[...new Set(dupSuppressSlugs)].join(", ")}`);
}

const butchSafe = safeRows.find(r =>
  r.keeper?.slug === requiredButchKeeper &&
  r.suppress?.slug === requiredButchSuppress
);

if (!butchSafe) {
  errors.push(`Butch Johnson target was not in safe lane: keeper=${requiredButchKeeper} suppress=${requiredButchSuppress}`);
}

for (const r of safeRows) {
  const keeperSlug = r.keeper?.slug;
  const suppressSlug = r.suppress?.slug;

  const keeper = find(keeperSlug);
  const suppress = find(suppressSlug);

  if (!keeper) errors.push(`Missing keeper: ${keeperSlug}`);
  if (!suppress) errors.push(`Missing suppress target: ${suppressSlug}`);

  if (keeper && keeper.suppressed === true) errors.push(`Keeper already suppressed: ${keeperSlug}`);
  if (suppress && suppress.suppressed === true) errors.push(`Suppress target already suppressed: ${suppressSlug}`);

  if (!["ready", "publish"].includes(keeper?.publishStatus)) {
    errors.push(`Keeper is not ready/publish: ${keeperSlug} status=${keeper?.publishStatus}`);
  }

  if (keeper && suppress && dateOf(keeper) !== dateOf(suppress)) {
    errors.push(`Date mismatch: keeper=${keeperSlug} suppress=${suppressSlug}`);
  }

  if (keeper && suppress && !sameTeamSet(keeper.teams || [], suppress.teams || [])) {
    errors.push(`Team-set mismatch: keeper=${keeperSlug} suppress=${suppressSlug}`);
  }

  if ((r.flags || []).length) {
    errors.push(`Safe row unexpectedly has flags: ${suppressSlug} => ${(r.flags || []).join(" | ")}`);
  }

  if ((r.uniquePlayers || []).length) {
    errors.push(`Suppress has unique player data: ${suppressSlug}`);
  }

  if ((r.uniquePicks || []).length) {
    errors.push(`Suppress has unique pick data: ${suppressSlug}`);
  }
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("SUPPRESS SAFE SAME-DATE/TEAM TRADE DUPLICATES V2 APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const e of errors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const r of safeRows) {
  const keeper = find(r.keeper.slug);
  const suppress = find(r.suppress.slug);

  const before = {
    id: suppress.id || null,
    slug: slugOf(suppress),
    tradeDate: dateOf(suppress),
    teams: suppress.teams || null,
    publishStatus: suppress.publishStatus || null,
    suppressed: suppress.suppressed ?? null,
    assetsReceived: suppress.assetsReceived || null,
    summary: suppress.summary || null,
    qaNotes: suppress.qaNotes || null
  };

  suppress.suppressed = true;
  suppress.qaNotes = suppress.qaNotes
    ? `${suppress.qaNotes} Suppressed as safe same-date/team duplicate after v2 pick coverage validation; canonical keeper is ${slugOf(keeper)} (${keeper.id || "no-id"}).`
    : `Suppressed as safe same-date/team duplicate after v2 pick coverage validation; canonical keeper is ${slugOf(keeper)} (${keeper.id || "no-id"}).`;
  suppress.updatedAt = new Date().toISOString();

  keeper.qaNotes = keeper.qaNotes
    ? `${keeper.qaNotes} Retained as canonical keeper for suppressed same-date/team duplicate ${slugOf(suppress)}.`
    : `Retained as canonical keeper for suppressed same-date/team duplicate ${slugOf(suppress)}.`;
  keeper.updatedAt = new Date().toISOString();

  applied.push({
    classification: r.classification,
    confidence: r.confidence,
    keeper: {
      id: keeper.id || null,
      slug: slugOf(keeper),
      tradeDate: dateOf(keeper),
      publishStatus: keeper.publishStatus || null,
      suppressed: keeper.suppressed ?? null
    },
    suppress: {
      before,
      after: {
        id: suppress.id || null,
        slug: slugOf(suppress),
        tradeDate: dateOf(suppress),
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
console.log("SUPPRESS SAFE SAME-DATE/TEAM TRADE DUPLICATES V2 APPLY");
console.log("=".repeat(80));
console.log(`Applied suppressions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const a of applied) {
  console.log("-".repeat(80));
  console.log(`${a.classification} | confidence=${a.confidence}`);
  console.log(`SUPPRESSED: ${a.suppress.after.slug} | ${a.suppress.after.id} | ${a.suppress.after.tradeDate}`);
  console.log(`KEEPER:     ${a.keeper.slug} | ${a.keeper.id}`);
}
