const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "composite-asset-duplicates-strict-dry-run.json");
const outPath = path.join(
  process.cwd(),
  "audits",
  APPLY ? "composite-asset-duplicates-strict-apply-report.json" : "composite-asset-duplicates-strict-apply-dry-run.json"
);

if (!fs.existsSync(dataPath)) {
  console.error(`Missing data file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(planPath)) {
  console.error(`Missing strict dry-run plan: ${planPath}`);
  console.error("Run: node scripts\\audit-composite-asset-duplicates-strict.cjs");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : null;
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const strictSafe = Array.isArray(plan.strictSafe) ? plan.strictSafe : [];

if (!Array.isArray(trades)) {
  console.error("Could not find trades array.");
  console.error("Top-level keys:", Object.keys(raw || {}));
  process.exit(1);
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function normalize(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

const plannedBySlugTeam = new Map();

for (const row of strictSafe) {
  const slug = String(row.slug || "").trim();
  const team = String(row.team || "").trim();
  const index = row.compositeCandidate && Number.isInteger(row.compositeCandidate.index)
    ? row.compositeCandidate.index
    : null;
  const asset = row.compositeCandidate && row.compositeCandidate.asset
    ? String(row.compositeCandidate.asset)
    : "";

  if (!slug || !team || index === null || !asset) {
    console.error("Bad strictSafe row in plan:");
    console.dir(row, { depth: null });
    process.exit(1);
  }

  const key = `${slug}|||${team}`;
  if (!plannedBySlugTeam.has(key)) plannedBySlugTeam.set(key, []);

  plannedBySlugTeam.get(key).push({
    slug,
    team,
    index,
    asset,
    reason: row.reason,
    matchedParts: row.matchedParts || []
  });
}

const applied = [];
const skipped = [];
const errors = [];

for (const trade of trades) {
  const slug = slugOf(trade);
  if (!trade.assetsReceived || typeof trade.assetsReceived !== "object" || Array.isArray(trade.assetsReceived)) continue;

  for (const team of Object.keys(trade.assetsReceived)) {
    const key = `${slug}|||${team}`;
    const planned = plannedBySlugTeam.get(key);
    if (!planned || planned.length === 0) continue;

    const assets = Array.isArray(trade.assetsReceived[team]) ? trade.assetsReceived[team] : [];

    // Remove from highest index to lowest so earlier indexes stay valid.
    const sortedPlanned = [...planned].sort((a, b) => b.index - a.index);
    const removeIndexes = new Set();

    for (const item of sortedPlanned) {
      const current = assets[item.index];

      if (!current || normalize(current.asset) !== normalize(item.asset)) {
        skipped.push({
          slug,
          team,
          plannedIndex: item.index,
          plannedAsset: item.asset,
          actualAssetAtIndex: current && current.asset ? current.asset : null,
          reason: "Asset at planned index did not exactly match current data"
        });
        continue;
      }

      removeIndexes.add(item.index);

      applied.push({
        slug,
        team,
        removedIndex: item.index,
        removedAsset: item.asset,
        reason: item.reason,
        matchedParts: item.matchedParts.map(p => ({
          part: p.part,
          matchedIndex: p.matchedIndividual ? p.matchedIndividual.index : null,
          matchedAsset: p.matchedIndividual ? p.matchedIndividual.asset : null
        }))
      });
    }

    if (APPLY && removeIndexes.size > 0) {
      trade.assetsReceived[team] = assets.filter((_, index) => !removeIndexes.has(index));
    }
  }
}

const plannedCount = strictSafe.length;
const appliedCount = applied.length;
const skippedCount = skipped.length;

if (appliedCount + skippedCount !== plannedCount) {
  errors.push({
    reason: "Applied + skipped count does not equal planned count",
    plannedCount,
    appliedCount,
    skippedCount
  });
}

const report = {
  mode: APPLY ? "apply" : "dry-run",
  generatedAt: new Date().toISOString(),
  dataPath,
  planPath,
  plannedCount,
  appliedCount,
  skippedCount,
  errors,
  applied,
  skipped
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (errors.length) {
  console.error("");
  console.error("ERRORS DETECTED. No data was written unless --apply was used before this check.");
  console.dir(errors, { depth: null });
  process.exit(1);
}

if (APPLY) {
  const outputText = Array.isArray(raw)
    ? JSON.stringify(trades, null, 2) + "\n"
    : JSON.stringify(raw, null, 2) + "\n";

  fs.writeFileSync(dataPath, outputText);
}

console.log("");
console.log(APPLY ? "STRICT COMPOSITE ASSET DEDUPE APPLY" : "STRICT COMPOSITE ASSET DEDUPE DRY RUN");
console.log("=".repeat(70));
console.log(`Planned removals: ${plannedCount}`);
console.log(`Validated removals: ${appliedCount}`);
console.log(`Skipped removals: ${skippedCount}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Known target checks:");
for (const needle of [
  "2014-6th-round-pick-182nd-overall-antone-exum-atlanta-falcons-2014",
  "dan-arnold-carolina-panthers-2021",
  "2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020",
  "jabrill-peppers-2019-1st-round-pick-17th-overall-dexter-lawrence-and-2019-3rd-ro"
]) {
  const rows = applied.filter(x => x.slug.includes(needle));
  console.log(`- ${needle}: ${rows.length} removal(s)`);
  for (const row of rows) {
    console.log(`  ${row.team}: removed "${row.removedAsset}"`);
  }
}

console.log("");
console.log("First 25 validated removals:");
for (const row of applied.slice(0, 25)) {
  console.log(`- ${row.slug} | ${row.team}`);
  console.log(`  DROP: ${row.removedAsset}`);
}
