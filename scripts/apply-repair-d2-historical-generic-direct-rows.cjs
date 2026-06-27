const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "repair-d2-historical-generic-direct-rows-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "repair-d2-historical-generic-direct-rows-apply-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function cleanSummary(s) {
  return String(s || "")
    .replace(/\bremaingraded\b/g, "remain graded")
    .replace(/\bthegrade\b/g, "the grade")
    .replace(/\s+/g, " ")
    .trim();
}

function flattenAssets(assetsReceived) {
  const out = [];
  for (const [team, assets] of Object.entries(assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;
    for (const item of assets) {
      out.push(`${team}: ${item.type || "unknown"}:${item.asset || ""}`);
    }
  }
  return out;
}

const errors = [];
const applied = [];

if (plan.mode !== "dry-run") errors.push("Plan is not dry-run mode.");
if ((plan.plannedRepairCount || 0) !== 8) errors.push(`Expected 8 planned repairs, found ${plan.plannedRepairCount}`);
if ((plan.errorCount || 0) !== 0) errors.push(`Plan has errors: ${plan.errorCount}`);

for (const row of plan.planned || []) {
  const trade = find(row.slug);

  if (!trade) {
    errors.push(`Missing trade: ${row.slug}`);
    continue;
  }

  if (trade.id !== row.id) {
    errors.push(`ID mismatch for ${row.slug}: expected ${row.id}, found ${trade.id}`);
  }

  if (trade.suppressed === true) {
    errors.push(`Trade already suppressed: ${row.slug}`);
  }

  if (!Array.isArray(row.after?.teams) || row.after.teams.length !== 2) {
    errors.push(`After teams not exactly two-team repair: ${row.slug}`);
  }

  const afterAssetTeams = Object.keys(row.after?.assetsReceived || {}).sort();
  const afterTeams = [...row.after.teams].sort();

  if (JSON.stringify(afterAssetTeams) !== JSON.stringify(afterTeams)) {
    errors.push(`After assets/team mismatch: ${row.slug}`);
  }
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("REPAIR D2 HISTORICAL GENERIC DIRECT ROWS APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const row of plan.planned || []) {
  const trade = find(row.slug);

  const before = {
    teams: trade.teams || null,
    assetsReceived: trade.assetsReceived || null,
    summary: trade.summary || null,
    qaNotes: trade.qaNotes || null,
    publishStatus: trade.publishStatus || null
  };

  const beforeFlat = flattenAssets(before.assetsReceived);
  const afterFlat = flattenAssets(row.after.assetsReceived);
  const removedAssets = beforeFlat.filter(x => !afterFlat.includes(x));

  trade.teams = row.after.teams;
  trade.assetsReceived = row.after.assetsReceived;
  trade.summary = cleanSummary(row.after.summary);

  const note = `Repaired D2 historical blended generic row; retained direct two-team trade described by summary and removed unrelated blended teams/assets. Removed assets archived in apply report. Reason: ${row.reason}`;

  trade.qaNotes = trade.qaNotes ? `${trade.qaNotes} ${note}` : note;

  applied.push({
    slug: row.slug,
    id: trade.id || null,
    tradeDate: dateOf(trade),
    reason: row.reason,
    removedAssets,
    before,
    after: {
      teams: trade.teams,
      assetsReceived: trade.assetsReceived,
      summary: trade.summary,
      qaNotes: trade.qaNotes,
      publishStatus: trade.publishStatus || null
    }
  });
}

const postErrors = [];

for (const row of applied) {
  const trade = find(row.slug);

  if (!trade) {
    postErrors.push(`Missing after apply: ${row.slug}`);
    continue;
  }

  if (!Array.isArray(trade.teams) || trade.teams.length !== 2) {
    postErrors.push(`Still not two-team after apply: ${row.slug}`);
  }

  const assetTeams = Object.keys(trade.assetsReceived || {}).sort();
  const teams = [...trade.teams].sort();

  if (JSON.stringify(assetTeams) !== JSON.stringify(teams)) {
    postErrors.push(`Post-apply assets/team mismatch: ${row.slug}`);
  }

  if (String(trade.summary || "").includes("remaingraded")) {
    postErrors.push(`Typo still present in summary: ${row.slug}`);
  }
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  appliedRepairCount: applied.length,
  errors: postErrors,
  applied
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (postErrors.length) {
  console.error("");
  console.error("POST-APPLY VALIDATION FAILED. Data was not written.");
  for (const error of postErrors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

fs.writeFileSync(dataPath, JSON.stringify(Array.isArray(raw) ? trades : raw, null, 2) + "\n");

console.log("");
console.log("REPAIR D2 HISTORICAL GENERIC DIRECT ROWS APPLY");
console.log("=".repeat(80));
console.log(`Applied repairs: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const row of applied) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate}`);
  console.log(`beforeTeams=${JSON.stringify(row.before.teams)}`);
  console.log(`afterTeams=${JSON.stringify(row.after.teams)}`);
  console.log(`removedAssets=${row.removedAssets.length}`);
}
