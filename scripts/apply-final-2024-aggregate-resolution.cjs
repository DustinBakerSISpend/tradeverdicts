const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "final-2024-aggregate-resolution-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "final-2024-aggregate-resolution-apply-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

const aggregateSlug = "reviewed-and-retained-for-public-data-completeness";

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function findId(id) {
  return trades.find(t => String(t.id || "") === String(id || ""));
}

function cloneBase() {
  return find("2025-1st-round-pick-25th-overall-jaxson-dart-houston-texans-2025")
    || find("2026-2nd-round-pick-las-vegas-raiders-2026")
    || trades.find(t => Array.isArray(t.teams) && t.teams.includes("houston-texans") && t.teams.includes("las-vegas-raiders"))
    || trades[0];
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAssetText(asset) {
  return String(asset || "")
    .replace(/\band\s+(?=\d{4}\s+\d)/gi, "|||")
    .replace(/,\s*(?=\d{4}\s+\d)/g, "|||")
    .replace(/;\s*(?=\d{4}\s+\d)/g, "|||")
    .split("|||")
    .map(s => s.trim())
    .filter(Boolean);
}

function pickSigsFromAsset(asset) {
  const chunks = splitAssetText(asset);
  const sigs = [];

  for (const chunk of chunks) {
    const text = norm(chunk);
    const y = text.match(/\b(19|20)\d{2}\b/);
    const round = text.match(/\b(1st|2nd|3rd|[4-9]th|10th|11th|12th)\s+round\b/);
    const overall = text.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/);

    if (y && round && overall) {
      sigs.push(`${y[0]}-R${Number(round[1].replace(/\D/g, ""))}-P${Number(overall[1])}`);
    }
  }

  return sigs;
}

function allPickSigs(t) {
  const sigs = [];

  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;

    for (const item of assets) {
      const asset = String(item.asset || "");
      if (item.type === "pick" || /round pick|overall/.test(asset.toLowerCase())) {
        for (const sig of pickSigsFromAsset(asset)) sigs.push(sig);
      }
    }
  }

  return [...new Set(sigs)].sort();
}

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan is not dry-run mode.");
if ((plan.errorCount || 0) !== 0) errors.push(`Plan has errors: ${plan.errorCount}`);
if ((plan.plannedActionCount || 0) !== 2) errors.push(`Expected 2 planned actions, found ${plan.plannedActionCount}`);

const createAction = (plan.planned || []).find(x => x.action === "create-direct-row");
const suppressAction = (plan.planned || []).find(x => x.action === "suppress-aggregate");

if (!createAction) errors.push("Missing create-direct-row action.");
if (!suppressAction) errors.push("Missing suppress-aggregate action.");

const aggregate = find(aggregateSlug);
if (!aggregate) errors.push(`Missing aggregate row: ${aggregateSlug}`);
if (aggregate && aggregate.suppressed === true) errors.push(`Aggregate already suppressed: ${aggregateSlug}`);

if (createAction?.row) {
  if (find(createAction.row.slug)) errors.push(`Create slug already exists: ${createAction.row.slug}`);
  if (findId(createAction.row.id)) errors.push(`Create ID already exists: ${createAction.row.id}`);

  const sigs = createAction.row.pickSigs || [];
  for (const required of ["2025-R2-P48", "2025-R2-P58", "2025-R3-P99"]) {
    if (!sigs.includes(required)) errors.push(`New row missing required pick signature in plan: ${required}`);
  }
}

if (suppressAction?.row) {
  if (suppressAction.row.slug !== aggregateSlug) {
    errors.push(`Suppress action points to wrong slug: ${suppressAction.row.slug}`);
  }
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("FINAL 2024 AGGREGATE RESOLUTION APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const e of errors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

const base = cloneBase();
const row = createAction.row;

const newTrade = {
  ...JSON.parse(JSON.stringify(base)),
  id: row.id,
  slug: row.slug,
  tradeDate: row.tradeDate,
  teams: row.teams,
  assetsReceived: row.assetsReceived,
  publishStatus: "ready",
  suppressed: null,
  summary: row.summary,
  verdict: row.verdict || "Even Trade",
  confidence: row.confidence || "Medium",
  qaNotes: "Created during final retained-aggregate cleanup to cover missing 2025-R2-P48 and 2025-R2-P58 signatures before suppressing aggregate row.",
  sourceNotes: "Confirmed by Houston Texans and Raiders draft-trade reports: Texans sent picks 58 and 99 to Raiders for pick 48.",
  updatedAt: new Date().toISOString()
};

delete newTrade.date;

trades.push(newTrade);

const aggregateBefore = {
  id: aggregate.id || null,
  slug: slugOf(aggregate),
  tradeDate: dateOf(aggregate),
  teams: aggregate.teams || null,
  publishStatus: aggregate.publishStatus || null,
  suppressed: aggregate.suppressed ?? null,
  assetsReceived: aggregate.assetsReceived || null,
  summary: aggregate.summary || null,
  qaNotes: aggregate.qaNotes || null,
  pickSigs: allPickSigs(aggregate)
};

aggregate.suppressed = true;
aggregate.qaNotes = aggregate.qaNotes
  ? `${aggregate.qaNotes} Suppressed final retained aggregate after creating direct Texans/Raiders row for missing 2025-R2-P48 and 2025-R2-P58 coverage.`
  : "Suppressed final retained aggregate after creating direct Texans/Raiders row for missing 2025-R2-P48 and 2025-R2-P58 coverage.";
aggregate.updatedAt = new Date().toISOString();

applied.push({
  action: "create-direct-row",
  row: {
    id: newTrade.id,
    slug: newTrade.slug,
    tradeDate: newTrade.tradeDate,
    teams: newTrade.teams,
    assetsReceived: newTrade.assetsReceived,
    publishStatus: newTrade.publishStatus,
    verdict: newTrade.verdict,
    confidence: newTrade.confidence,
    pickSigs: allPickSigs(newTrade),
    summary: newTrade.summary
  }
});

applied.push({
  action: "suppress-aggregate",
  before: aggregateBefore,
  after: {
    id: aggregate.id || null,
    slug: slugOf(aggregate),
    tradeDate: dateOf(aggregate),
    teams: aggregate.teams || null,
    publishStatus: aggregate.publishStatus || null,
    suppressed: aggregate.suppressed,
    qaNotes: aggregate.qaNotes || null,
    pickSigs: allPickSigs(aggregate)
  }
});

const postErrors = [];

const created = find(row.slug);
if (!created) {
  postErrors.push(`Created row not found: ${row.slug}`);
} else {
  const createdSigs = allPickSigs(created);
  for (const required of ["2025-R2-P48", "2025-R2-P58", "2025-R3-P99"]) {
    if (!createdSigs.includes(required)) postErrors.push(`Created row missing required signature: ${required}`);
  }
  if (created.suppressed === true) postErrors.push("Created row is suppressed.");
  if (created.publishStatus !== "ready") postErrors.push(`Created row not ready: ${created.publishStatus}`);
}

const aggAfter = find(aggregateSlug);
if (!aggAfter) {
  postErrors.push(`Aggregate not found after apply: ${aggregateSlug}`);
} else if (aggAfter.suppressed !== true) {
  postErrors.push("Aggregate not suppressed after apply.");
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  appliedActionCount: applied.length,
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
console.log("FINAL 2024 AGGREGATE RESOLUTION APPLY");
console.log("=".repeat(80));
console.log(`Applied actions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const item of applied) {
  console.log("-".repeat(80));
  console.log(`ACTION: ${item.action}`);
  const r = item.row || item.after;
  console.log(`${r.slug} | ${r.id} | ${r.tradeDate}`);
  console.log(`teams=${JSON.stringify(r.teams)}`);
  console.log(`status=${r.publishStatus} suppressed=${r.suppressed}`);
  console.log(`pickSigs=${JSON.stringify(r.pickSigs)}`);
}
