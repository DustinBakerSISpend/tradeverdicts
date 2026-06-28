const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

if (!DRY_RUN && !APPLY) {
  console.error("Use --dry-run or --apply");
  process.exit(1);
}

const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const targetSlugs = new Set([
  "cardinals-1934-07-02-cincinnati-reds-unknown-not-disclosed-john-lyons",
  "1947-fifth-round-pick-32-lloyd-merriman-arizona-st-louis-cardinals-194",
  "undisclosed-consideration-arizona-st-louis-cardinals-1947",
  "1948-sixth-round-pick-45-phil-o-reilly-arizona-st-louis-cardinals-1948",
  "arizona-st-louis-cardinals-1948-12-01",
  "undisclosed-consideration-arizona-st-louis-cardinals-1949",
  "cardinals-1950-01-01-new-york-bulldogs-1950-third-round-pick-29-bill-svoboda-unknown-not-disclo",
  "undisclosed-compensation-arizona-st-louis-cardinals-1950",
  "cardinals-1951-07-31-los-angeles-st-louis-rams-ralph-pasquariello-unknown-not-disclosed",
  "1952-third-round-pick-27-gene-shannon-arizona-st-louis-cardinals-1952",
  "eagles-1953-01-01-arizona-st-louis-cardinals-0025",
  "undisclosed-consideration-arizona-st-louis-cardinals-1954",
  "unknown-undisclosed-consideration-arizona-cardinals-1968",
  "cardinals-1968-07-26-unknown-partner-unknown-not-disclosed-jerry-hillebrand",
  "unknown-undisclosed-consideration-arizona-cardinals-1970"
]);

function publicFieldRefs(trade) {
  const refs = [
    ["summary", trade],
    ["description", trade],
    ["shortSummary", trade],
  ];

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((p, i) => {
      refs.push([`perspectives[${i}].primarySummary`, p]);
      refs.push([`perspectives[${i}].partnerSummary`, p]);
    });
  }

  return refs;
}

function cleanText(text) {
  if (typeof text !== "string") return text;

  return text
    .replace(/Unknown\/not disclosed/g, "undisclosed compensation")
    .replace(/unknown\/not disclosed/g, "undisclosed compensation")
    .replace(/Unknown not disclosed/g, "undisclosed compensation")
    .replace(/unknown not disclosed/g, "undisclosed compensation")
    .replace(/Unknown Partner/g, "an undisclosed partner")
    .replace(/Unknown\/undisclosed partner/g, "an undisclosed partner")
    .replace(/unknown\/undisclosed partner/g, "an undisclosed partner")

    // Clean literal unknown compensation placeholders without creating "for?" / "received?"
    .replace(/\bfor\s+\?\./g, "for undisclosed compensation.")
    .replace(/\bfor\s+\?/g, "for undisclosed compensation")
    .replace(/\breceived\s+\?\s+and\b/g, "received undisclosed compensation and")
    .replace(/\breceived\s+\?\./g, "received undisclosed compensation.")
    .replace(/\bgave up\s+\?\./g, "gave up undisclosed compensation.")
    .replace(/\bgave up\s+\?\s+and\b/g, "gave up undisclosed compensation and")

    // Small public-copy cleanup seen in this bucket
    .replace(/Partner Partner Win/g, "Partner Win")
    .replace(/Partner Partner Loss/g, "Partner Loss")
    .replace(/clearervalue/g, "clearer value")
    .replace(/long-term talent, with undisclosed compensation failing/g, "long-term talent; undisclosed compensation failed")
    .replace(/outweighed undisclosed compensation in production/g, "outweighed the undisclosed compensation in production")

    // Safe whitespace only; do not collapse " ?" into "?"
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!])/g, "$1")
    .trim();
}

const changes = [];
const missing = [];

for (const slug of targetSlugs) {
  const trade = trades.find((t) => t.slug === slug);

  if (!trade) {
    missing.push(slug);
    continue;
  }

  for (const [fieldPath, owner] of publicFieldRefs(trade)) {
    const field = fieldPath.split(".").at(-1);
    const before = owner[field];
    const after = cleanText(before);

    if (after !== before) {
      changes.push({
        slug: trade.slug,
        id: trade.id,
        field: fieldPath,
        before,
        after,
      });

      if (APPLY) owner[field] = after;
    }
  }
}

const reportPath = path.join(
  "audit",
  "reports",
  `cardinals-unknown-disclosed-wording-cleanup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);

fs.writeFileSync(reportPath, JSON.stringify({
  mode: DRY_RUN ? "dry-run" : "apply",
  targetTrades: targetSlugs.size,
  missing,
  changedFields: changes.length,
  changedTrades: new Set(changes.map((change) => change.slug)).size,
  sample: changes.slice(0, 40),
  changes,
}, null, 2));

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");
}

console.log(DRY_RUN ? "CARDINALS WORDING DRY RUN COMPLETE" : "CARDINALS WORDING APPLY COMPLETE");
console.log(JSON.stringify({
  targetTrades: targetSlugs.size,
  missing,
  changedFields: changes.length,
  changedTrades: new Set(changes.map((change) => change.slug)).size,
  reportPath,
  firstTwelve: changes.slice(0, 12).map((change) => ({
    slug: change.slug,
    field: change.field,
    before: change.before,
    after: change.after,
  })),
}, null, 2));
