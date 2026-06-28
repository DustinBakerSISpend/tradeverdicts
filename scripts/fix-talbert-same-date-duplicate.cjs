const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const reportPath = path.join("audit", "reports", `talbert-same-date-fix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

if (!DRY_RUN && !APPLY) {
  console.error("Use --dry-run or --apply");
  process.exit(1);
}

const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const suppressSlug = "draft-pick-washington-redskins-commanders-1968";
const keeperSlug = "rights-to-danny-talbert-don-talbert-san-francisco-49ers-1968";

const suppressRow = trades.find((t) => t.slug === suppressSlug);
const keeperRow = trades.find((t) => t.slug === keeperSlug);

if (!suppressRow) throw new Error(`Suppress target not found: ${suppressSlug}`);
if (!keeperRow) throw new Error(`Keeper target not found: ${keeperSlug}`);

const before = {
  suppressTarget: JSON.parse(JSON.stringify(suppressRow)),
  keeper: JSON.parse(JSON.stringify(keeperRow)),
};

const actions = [];

actions.push({
  type: "suppress-duplicate",
  slug: suppressSlug,
  id: suppressRow.id,
  reason: "Duplicate same-date/team Talbert rights trade. Canonical ready page is WAS-1968-0126.",
});

suppressRow.suppressed = true;
suppressRow.suppressionReason = "Duplicate same-date/team Talbert rights trade; canonical page is rights-to-danny-talbert-don-talbert-san-francisco-49ers-1968.";

if (Array.isArray(suppressRow.perspectives)) {
  for (const p of suppressRow.perspectives) {
    p.publishStatus = "suppressed";
    p.qaNotes = `${p.qaNotes || ""} Suppressed in same-date/team QA: duplicate of canonical Talbert rights trade WAS-1968-0126.`.trim();
  }
}

const cleanSummary =
  "Washington acquired rights to Danny Talbert (listed in some source data as Don Talbert) from San Francisco 49ers for an undisclosed draft pick. The available record does not show enough durable separation to force a win/loss label, leaving both sides near even with Medium confidence.";

const cleanPartnerSummary =
  "San Francisco 49ers received an undisclosed draft pick for rights to Danny Talbert (listed in some source data as Don Talbert). The outcome remained close enough to grade as even for the partner side with Medium confidence.";

actions.push({
  type: "clean-keeper-text",
  slug: keeperSlug,
  id: keeperRow.id,
  beforeSummary: keeperRow.summary,
  afterSummary: cleanSummary,
});

keeperRow.summary = cleanSummary;

if (Array.isArray(keeperRow.perspectives)) {
  for (const p of keeperRow.perspectives) {
    if (typeof p.primarySummary === "string") p.primarySummary = cleanSummary;
    if (typeof p.partnerSummary === "string") p.partnerSummary = cleanPartnerSummary;
    p.qaNotes = "Final public-data QA complete. Same-date duplicate suppressed; Talbert listing cleaned for public display.";
  }
}

const after = {
  suppressTarget: suppressRow,
  keeper: keeperRow,
};

const report = {
  mode: DRY_RUN ? "dry-run" : "apply",
  generatedAt: new Date().toISOString(),
  actions,
  before,
  after,
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(DRY_RUN ? "DRY RUN COMPLETE" : "APPLY COMPLETE");
console.log(JSON.stringify({
  suppressSlug,
  keeperSlug,
  suppressedNow: suppressRow.suppressed === true,
  keeperSummary: keeperRow.summary,
  reportPath,
}, null, 2));

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");
}
