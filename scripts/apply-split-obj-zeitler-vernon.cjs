const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const dryRunPath = path.join(process.cwd(), "audits", "obj-zeitler-vernon-split-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "obj-zeitler-vernon-split-apply-report.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(dryRunPath)) {
  console.error(`Missing dry-run report: ${dryRunPath}`);
  console.error("Run scripts\\dry-run-split-obj-zeitler-vernon.cjs first.");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : null;
const dryRun = JSON.parse(fs.readFileSync(dryRunPath, "utf8"));

if (!Array.isArray(trades)) {
  console.error("Could not find trades array.");
  console.error("Top-level keys:", Object.keys(raw || {}));
  process.exit(1);
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assetListContains(trade, team, assetNeedle) {
  const rows = trade.assetsReceived && Array.isArray(trade.assetsReceived[team])
    ? trade.assetsReceived[team]
    : [];

  const needle = norm(assetNeedle);
  return rows.some(row => norm(row.asset).includes(needle));
}

function perspectiveIds(trade) {
  return Array.isArray(trade.perspectives)
    ? trade.perspectives.map(p => p.sourceTradeId).filter(Boolean).sort()
    : [];
}

const objSlug = "jabrill-peppers-2019-1st-round-pick-17th-overall-dexter-lawrence-and-2019-3rd-ro";
const zeitlerSlug = "kevin-zeitler-olivier-vernon-new-york-giants-2019";

const errors = [];
const warnings = [];

if (dryRun.mode !== "dry-run" || dryRun.errors.length || dryRun.plannedCount !== 2) {
  errors.push("Dry-run report is not clean. Expected mode=dry-run, plannedCount=2, errors=0.");
}

const updatePlan = (dryRun.planned || []).find(p => p.action === "update existing OBJ trade to OBJ-only");
const createPlan = (dryRun.planned || []).find(p => p.action === "create standalone Zeitler/Vernon trade");

if (!updatePlan || !createPlan) {
  errors.push("Dry-run report does not contain both required planned actions.");
}

const objIndex = trades.findIndex(t => slugOf(t) === objSlug);
if (objIndex === -1) {
  errors.push(`Missing OBJ blended trade: ${objSlug}`);
}

if (trades.some(t => slugOf(t) === zeitlerSlug)) {
  errors.push(`Zeitler/Vernon slug already exists: ${zeitlerSlug}`);
}

if (trades.some(t => t.id === "NYG-2019-0286")) {
  errors.push("Zeitler/Vernon id already exists: NYG-2019-0286");
}

if (!errors.length) {
  const currentObj = trades[objIndex];

  const expectedBeforeChecks = [
    ["new-york-giants", "Jabrill Peppers"],
    ["new-york-giants", "Dexter Lawrence"],
    ["new-york-giants", "Oshane Ximines"],
    ["new-york-giants", "Kevin Zeitler"],
    ["cleveland-browns", "Odell Beckham"],
    ["cleveland-browns", "Olivier Vernon"]
  ];

  for (const [team, assetNeedle] of expectedBeforeChecks) {
    if (!assetListContains(currentObj, team, assetNeedle)) {
      errors.push(`Before-state guard failed. Missing asset in current OBJ record: ${team} -> ${assetNeedle}`);
    }
  }

  const ids = perspectiveIds(currentObj);
  const requiredIds = ["CLE-2019-0426", "CLE-2019-0427", "NYG-2019-0285", "NYG-2019-0286"];
  for (const id of requiredIds) {
    if (!ids.includes(id)) errors.push(`Before-state guard failed. Missing perspective ${id}`);
  }
}

if (errors.length) {
  const blocked = {
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors,
    warnings
  };
  fs.writeFileSync(outPath, JSON.stringify(blocked, null, 2));
  console.error("");
  console.error("OBJ / ZEITLER-VERNON SPLIT BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

const beforeCount = trades.length;
const beforeObj = clone(trades[objIndex]);

trades[objIndex] = clone(updatePlan.after);

// Insert the new standalone trade immediately after the OBJ trade.
trades.splice(objIndex + 1, 0, clone(createPlan.after));

const afterCount = trades.length;

const afterObj = trades.find(t => slugOf(t) === objSlug);
const afterZeitler = trades.find(t => slugOf(t) === zeitlerSlug);

const postErrors = [];

if (afterCount !== beforeCount + 1) {
  postErrors.push(`Expected trade count to increase by 1. Before=${beforeCount}, after=${afterCount}`);
}

if (!afterObj) {
  postErrors.push("OBJ trade missing after apply.");
}

if (!afterZeitler) {
  postErrors.push("Zeitler/Vernon trade missing after apply.");
}

if (afterObj) {
  if (assetListContains(afterObj, "new-york-giants", "Kevin Zeitler")) {
    postErrors.push("OBJ record still contains Kevin Zeitler.");
  }
  if (assetListContains(afterObj, "cleveland-browns", "Olivier Vernon")) {
    postErrors.push("OBJ record still contains Olivier Vernon.");
  }
  if (!assetListContains(afterObj, "cleveland-browns", "Odell Beckham")) {
    postErrors.push("OBJ record no longer contains Odell Beckham Jr.");
  }
  if (JSON.stringify(perspectiveIds(afterObj)) !== JSON.stringify(["CLE-2019-0426", "NYG-2019-0285"])) {
    postErrors.push(`OBJ perspectives incorrect after apply: ${JSON.stringify(perspectiveIds(afterObj))}`);
  }
}

if (afterZeitler) {
  if (!assetListContains(afterZeitler, "new-york-giants", "Kevin Zeitler")) {
    postErrors.push("Zeitler/Vernon record missing Kevin Zeitler.");
  }
  if (!assetListContains(afterZeitler, "cleveland-browns", "Olivier Vernon")) {
    postErrors.push("Zeitler/Vernon record missing Olivier Vernon.");
  }
  if (JSON.stringify(perspectiveIds(afterZeitler)) !== JSON.stringify(["CLE-2019-0427", "NYG-2019-0286"])) {
    postErrors.push(`Zeitler/Vernon perspectives incorrect after apply: ${JSON.stringify(perspectiveIds(afterZeitler))}`);
  }
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  dataPath,
  beforeCount,
  afterCount,
  insertedSlug: zeitlerSlug,
  updatedSlug: objSlug,
  errors: postErrors,
  warnings,
  beforeObj,
  afterObj,
  afterZeitler
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (postErrors.length) {
  console.error("");
  console.error("POST-APPLY VALIDATION FAILED. Data was not written.");
  for (const error of postErrors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

const outputText = Array.isArray(raw)
  ? JSON.stringify(trades, null, 2) + "\n"
  : JSON.stringify(raw, null, 2) + "\n";

fs.writeFileSync(dataPath, outputText);

console.log("");
console.log("OBJ / ZEITLER-VERNON SPLIT APPLY");
console.log("=".repeat(80));
console.log(`Before trade count: ${beforeCount}`);
console.log(`After trade count: ${afterCount}`);
console.log(`Updated OBJ slug: ${objSlug}`);
console.log(`Created Zeitler/Vernon slug: ${zeitlerSlug}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Warnings: ${warnings.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("OBJ after:");
console.log(`assetsReceived=${JSON.stringify(afterObj.assetsReceived)}`);
console.log(`grades=${JSON.stringify(afterObj.grades)}`);
console.log(`verdict=${JSON.stringify(afterObj.verdict)}`);
console.log(`perspectives=${JSON.stringify(perspectiveIds(afterObj))}`);

console.log("");
console.log("Zeitler/Vernon after:");
console.log(`assetsReceived=${JSON.stringify(afterZeitler.assetsReceived)}`);
console.log(`grades=${JSON.stringify(afterZeitler.grades)}`);
console.log(`verdict=${JSON.stringify(afterZeitler.verdict)}`);
console.log(`perspectives=${JSON.stringify(perspectiveIds(afterZeitler))}`);
