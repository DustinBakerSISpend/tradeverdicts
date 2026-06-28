const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

if (!DRY_RUN && !APPLY) {
  console.error("Use --dry-run or --apply");
  process.exit(1);
}

const reports = fs.readdirSync(path.join("audit", "reports"))
  .filter((name) => /^public-qa-rebaseline-.*\.json$/.test(name))
  .map((name) => path.join("audit", "reports", name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

if (!reports.length) throw new Error("No public QA rebaseline JSON report found.");

const reportPath = reports[0];
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const targetSlugs = new Set(
  report.activeTextResidue
    .filter((row) => (row.hits || []).includes("public-outcome-template"))
    .map((row) => row.slug)
);

function cleanSpacing(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.!?])([A-Z])/g, "$1 $2")
    .trim();
}

function cleanTargetBoilerplate(value) {
  if (typeof value !== "string") return value;

  const before = value;
  let text = value;

  const sentencePatterns = [
    /(?:^|(?<=[.!?])\s+)[^.?!]*public outcome review confirms[^.?!]*(?:[.!?]|$)/gi,
    /(?:^|(?<=[.!?])\s+)[^.?!]*listed grade and verdict based on available trade data[^.?!]*(?:[.!?]|$)/gi,
  ];

  for (const pattern of sentencePatterns) {
    text = text.replace(pattern, " ");
  }

  text = cleanSpacing(text);

  return text === cleanSpacing(before) ? value : text;
}

const changes = [];

for (const trade of trades) {
  if (!targetSlugs.has(trade.slug)) continue;

  for (const field of ["summary", "description", "shortSummary"]) {
    const before = trade[field];
    const after = cleanTargetBoilerplate(before);

    if (after !== before) {
      changes.push({ slug: trade.slug, id: trade.id, field, before, after });
      if (APPLY) trade[field] = after;
    }
  }

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((perspective, index) => {
      for (const field of ["primarySummary", "partnerSummary"]) {
        const before = perspective[field];
        const after = cleanTargetBoilerplate(before);

        if (after !== before) {
          changes.push({
            slug: trade.slug,
            id: trade.id,
            field: `perspectives[${index}].${field}`,
            before,
            after,
          });

          if (APPLY) perspective[field] = after;
        }
      }
    });
  }
}

const outPath = path.join(
  "audit",
  "reports",
  `public-outcome-template-targeted-cleanup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);

fs.writeFileSync(outPath, JSON.stringify({
  mode: DRY_RUN ? "dry-run" : "apply",
  sourceRebaseline: reportPath,
  targetRows: targetSlugs.size,
  changedFields: changes.length,
  changedTrades: new Set(changes.map((change) => change.slug)).size,
  sample: changes.slice(0, 25),
  changes,
}, null, 2));

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");
}

console.log(DRY_RUN ? "TARGETED DRY RUN COMPLETE" : "TARGETED APPLY COMPLETE");
console.log(JSON.stringify({
  sourceRebaseline: reportPath,
  targetRows: targetSlugs.size,
  changedFields: changes.length,
  changedTrades: new Set(changes.map((change) => change.slug)).size,
  reportPath: outPath,
  firstFive: changes.slice(0, 5).map((change) => ({
    slug: change.slug,
    field: change.field,
    before: change.before,
    after: change.after,
  })),
}, null, 2));
