const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "suppress-final-safe-player-duplicate-pages-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "suppress-final-safe-player-duplicate-pages-apply-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function badStatus(status) {
  return status === "hold-conflict";
}

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan is not dry-run mode.");
if ((plan.plannedSuppressionCount || 0) !== 34) errors.push(`Expected 34 planned suppressions, found ${plan.plannedSuppressionCount}`);
if ((plan.errorCount || 0) !== 0) errors.push(`Plan has errors: ${plan.errorCount}`);

for (const p of plan.plannedSuppressions || []) {
  const keeper = find(p.keeper?.slug);
  const suppress = find(p.suppress?.slug);

  if (!keeper) errors.push(`Missing keeper: ${p.keeper?.slug}`);
  if (!suppress) errors.push(`Missing suppress target: ${p.suppress?.slug}`);

  if (keeper && keeper.suppressed === true) errors.push(`Keeper already suppressed: ${p.keeper?.slug}`);
  if (suppress && suppress.suppressed === true) errors.push(`Suppress target already suppressed: ${p.suppress?.slug}`);

  if (badStatus(keeper?.publishStatus)) errors.push(`Keeper is hold-conflict: ${p.keeper?.slug}`);
  if (badStatus(suppress?.publishStatus)) errors.push(`Suppress target is hold-conflict: ${p.suppress?.slug}`);

  if ((p.suppress?.pickSigs || []).length > 0) {
    errors.push(`Suppress target has pick signatures: ${p.suppress?.slug}`);
  }
}

const suppressSlugs = (plan.plannedSuppressions || []).map(p => p.suppress?.slug).filter(Boolean);
const dupSuppressSlugs = suppressSlugs.filter((slug, idx) => suppressSlugs.indexOf(slug) !== idx);
if (dupSuppressSlugs.length) errors.push(`Duplicate suppress targets in plan: ${[...new Set(dupSuppressSlugs)].join(", ")}`);

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("SUPPRESS FINAL SAFE PLAYER DUPLICATE PAGES APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const e of errors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const p of plan.plannedSuppressions || []) {
  const keeper = find(p.keeper.slug);
  const suppress = find(p.suppress.slug);

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

  const note = `Suppressed as strict player-duplicate page. Kept canonical page ${slugOf(keeper)} (${keeper.id || "no-id"}). Reason: ${p.reason}`;

  suppress.qaNotes = suppress.qaNotes ? `${suppress.qaNotes} ${note}` : note;
  suppress.updatedAt = new Date().toISOString();

  applied.push({
    suppress: {
      id: suppress.id || null,
      slug: slugOf(suppress),
      tradeDate: suppress.tradeDate || suppress.date || null,
      publishStatus: suppress.publishStatus || null,
      suppressed: suppress.suppressed,
      before
    },
    keeper: {
      id: keeper.id || null,
      slug: slugOf(keeper),
      tradeDate: keeper.tradeDate || keeper.date || null,
      publishStatus: keeper.publishStatus || null,
      suppressed: keeper.suppressed ?? null
    },
    playerOverlap: p.playerOverlap || [],
    teamSet: p.teamSet || [],
    reason: p.reason
  });
}

const postErrors = [];

for (const a of applied) {
  const keeper = find(a.keeper.slug);
  const suppress = find(a.suppress.slug);

  if (!keeper) postErrors.push(`Keeper missing after apply: ${a.keeper.slug}`);
  if (!suppress) postErrors.push(`Suppress target missing after apply: ${a.suppress.slug}`);

  if (keeper && keeper.suppressed === true) postErrors.push(`Keeper was suppressed: ${a.keeper.slug}`);
  if (suppress && suppress.suppressed !== true) postErrors.push(`Suppress target not suppressed: ${a.suppress.slug}`);
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
console.log("SUPPRESS FINAL SAFE PLAYER DUPLICATE PAGES APPLY");
console.log("=".repeat(80));
console.log(`Applied suppressions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const a of applied) {
  console.log("-".repeat(80));
  console.log(`SUPPRESSED: ${a.suppress.slug} | ${a.suppress.id} | ${a.suppress.tradeDate}`);
  console.log(`KEEPER:     ${a.keeper.slug} | ${a.keeper.id}`);
}
