const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "ellipsis-truncation-audit.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];

if (!Array.isArray(trades) || trades.length === 0) {
  console.error("Could not find trades array.");
  process.exit(1);
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || t.transactionDate || null;
}

function keysOf(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
}

function assetKeys(t) {
  return keysOf(t.assetsReceived).sort();
}

function flattenAssets(t) {
  const rows = [];

  for (const team of assetKeys(t)) {
    const assets = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];
    for (const [index, item] of assets.entries()) {
      rows.push({
        team,
        index,
        type: item && item.type ? item.type : null,
        asset: item && item.asset ? item.asset : ""
      });
    }
  }

  return rows;
}

function hasEllipsis(value) {
  return typeof value === "string" && value.includes("...");
}

function collectEllipsisFields(t) {
  const rows = [];

  const topFields = [
    "slug",
    "summary",
    "partnerSummary",
    "analysis",
    "qaNotes",
    "verdict",
    "title"
  ];

  for (const field of topFields) {
    if (hasEllipsis(t[field])) {
      rows.push({
        field,
        value: t[field]
      });
    }
  }

  for (const [team, assets] of Object.entries(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;

    assets.forEach((item, index) => {
      if (hasEllipsis(item && item.asset)) {
        rows.push({
          field: `assetsReceived.${team}.${index}.asset`,
          value: item.asset
        });
      }

      if (hasEllipsis(item && item.type)) {
        rows.push({
          field: `assetsReceived.${team}.${index}.type`,
          value: item.type
        });
      }
    });
  }

  for (const [team, grade] of Object.entries(t.grades || {})) {
    if (hasEllipsis(grade)) {
      rows.push({
        field: `grades.${team}`,
        value: grade
      });
    }
  }

  if (Array.isArray(t.perspectives)) {
    t.perspectives.forEach((p, index) => {
      for (const [k, v] of Object.entries(p || {})) {
        if (hasEllipsis(v)) {
          rows.push({
            field: `perspectives.${index}.${k}`,
            value: v
          });
        }
      }
    });
  }

  return rows;
}

const rows = [];

for (const t of trades) {
  const ellipsisFields = collectEllipsisFields(t);
  if (!ellipsisFields.length) continue;

  rows.push({
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    season: t.season || null,
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    teams: t.teams || null,
    assetKeys: assetKeys(t),
    verdict: t.verdict || null,
    grades: t.grades || null,
    tier: t.tier || null,
    confidence: t.confidence || null,
    ellipsisFieldCount: ellipsisFields.length,
    ellipsisFields,
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    partnerSummary: t.partnerSummary || null,
    qaNotes: t.qaNotes || null
  });
}

const counts = {
  totalTradesWithEllipsis: rows.length,
  activeUnsuppressed: rows.filter(r => r.suppressed !== true).length,
  suppressed: rows.filter(r => r.suppressed === true).length,
  byPublishStatus: {},
  byField: {}
};

for (const row of rows) {
  const status = row.publishStatus || "(missing)";
  counts.byPublishStatus[status] = (counts.byPublishStatus[status] || 0) + 1;

  for (const f of row.ellipsisFields) {
    counts.byField[f.field] = (counts.byField[f.field] || 0) + 1;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  tradeCount: trades.length,
  counts,
  rows
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("ELLIPSIS / TRUNCATION AUDIT");
console.log("=".repeat(80));
console.log(`Trades scanned: ${trades.length}`);
console.log(`Trades with literal ellipsis: ${counts.totalTradesWithEllipsis}`);
console.log(`Active unsuppressed with ellipsis: ${counts.activeUnsuppressed}`);
console.log(`Suppressed with ellipsis: ${counts.suppressed}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("By publishStatus:");
for (const [status, count] of Object.entries(counts.byPublishStatus).sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`- ${status}: ${count}`);
}

console.log("");
console.log("By field:");
for (const [field, count] of Object.entries(counts.byField).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`- ${field}: ${count}`);
}

console.log("");
console.log("Active unsuppressed records with ellipsis:");
for (const row of rows.filter(r => r.suppressed !== true)) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | id=${row.id} | date=${row.tradeDate}`);
  console.log(`publishStatus=${JSON.stringify(row.publishStatus)} suppressed=${JSON.stringify(row.suppressed)}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`assetKeys=${JSON.stringify(row.assetKeys)}`);
  console.log(`verdict=${JSON.stringify(row.verdict)} grades=${JSON.stringify(row.grades)}`);
  console.log(`ellipsis fields=${row.ellipsisFieldCount}`);

  for (const field of row.ellipsisFields) {
    console.log(`  ${field.field}: ${field.value}`);
  }

  console.log("assetsReceived:");
  console.dir(row.assetsReceived, { depth: null });
}
