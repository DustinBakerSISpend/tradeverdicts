const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "final-2024-aggregate-resolution-dry-run.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const aggregateSlug = "reviewed-and-retained-for-public-data-completeness";
const newSlug = "2025-2nd-round-pick-48th-overall-aireontae-ersery-las-vegas-raiders-2025";

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function nextId(prefixYear) {
  const nums = trades
    .map(t => String(t.id || ""))
    .filter(id => id.startsWith(prefixYear + "-"))
    .map(id => Number(id.split("-").pop()))
    .filter(Number.isFinite);

  const n = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefixYear}-${String(n).padStart(4, "0")}`;
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

const aggregate = find(aggregateSlug);
const existingNew = find(newSlug);
const base = cloneBase();

const errors = [];
const planned = [];

if (!aggregate) errors.push(`Missing aggregate: ${aggregateSlug}`);
if (existingNew) errors.push(`New slug already exists: ${newSlug}`);
if (!base) errors.push("Could not find clone base row.");

const newTrade = base ? {
  ...JSON.parse(JSON.stringify(base)),
  id: nextId("HOU-2025"),
  slug: newSlug,
  tradeDate: "2025-04-25",
  date: undefined,
  teams: ["houston-texans", "las-vegas-raiders"],
  assetsReceived: {
    "houston-texans": [
      { type: "pick", asset: "2025 2nd round pick (48th overall, Aireontae Ersery)" }
    ],
    "las-vegas-raiders": [
      { type: "pick", asset: "2025 2nd round pick (58th overall, Jack Bech)" },
      { type: "pick", asset: "2025 3rd round pick (99th overall subsequently traded, Charles Grant)" }
    ]
  },
  publishStatus: "ready",
  suppressed: null,
  summary: "Houston acquired 2025 2nd round pick (48th overall, Aireontae Ersery) from Las Vegas Raiders for 2025 2nd round pick (58th overall, Jack Bech) and 2025 3rd round pick (99th overall subsequently traded, Charles Grant). Houston moved up ten spots to secure offensive tackle help, while Las Vegas added an extra third-round pick and still selected Jack Bech at No. 58. This profiles as a balanced draft-capital exchange pending long-term player outcomes.",
  verdict: "Even Trade",
  confidence: "Medium",
  qaNotes: "Created during final retained-aggregate cleanup to cover missing 2025-R2-P48 and 2025-R2-P58 signatures before suppressing aggregate row.",
  sourceNotes: "Confirmed by Houston Texans and Raiders draft trade reports: Texans sent picks 58 and 99 to Raiders for pick 48.",
  updatedAt: new Date().toISOString()
} : null;

if (newTrade) {
  delete newTrade.date;

  planned.push({
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
      summary: newTrade.summary,
      pickSigs: allPickSigs(newTrade)
    }
  });
}

if (aggregate) {
  planned.push({
    action: "suppress-aggregate",
    row: {
      id: aggregate.id || null,
      slug: slugOf(aggregate),
      tradeDate: dateOf(aggregate),
      teams: aggregate.teams || null,
      publishStatus: aggregate.publishStatus || null,
      suppressed: aggregate.suppressed ?? null,
      pickSigs: allPickSigs(aggregate),
      summary: aggregate.summary || null
    }
  });
}

fs.writeFileSync(outPath, JSON.stringify({
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  errorCount: errors.length,
  errors,
  plannedActionCount: planned.length,
  planned
}, null, 2));

console.log("");
console.log("FINAL 2024 AGGREGATE RESOLUTION DRY RUN");
console.log("=".repeat(80));
console.log(`errors: ${errors.length}`);
console.log(`planned actions: ${planned.length}`);
console.log(`Report: ${outPath}`);

for (const error of errors) console.log(`ERROR: ${error}`);

for (const item of planned) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`ACTION: ${item.action}`);
  console.log(`${item.row.slug} | ${item.row.id} | ${item.row.tradeDate}`);
  console.log(`teams=${JSON.stringify(item.row.teams)}`);
  console.log(`pickSigs=${JSON.stringify(item.row.pickSigs)}`);
  console.log(`status=${item.row.publishStatus} suppressed=${item.row.suppressed}`);
  console.log("assetsReceived:");
  console.dir(item.row.assetsReceived, { depth: null });
  console.log("summary:");
  console.log(item.row.summary || "(none)");
}

if (errors.length) process.exit(1);
