const fs = require("fs");

const trades = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));

const targetIds = new Set([
  "HOU-2013-0035",
  "HOU-2015-0043",
  "HOU-2020-0064",
  "HOU-2021-0071",
  "HOU-2021-0078",
  "HOU-2023-0095"
]);

function assetsFor(trade, team) {
  return (trade.assetsReceived?.[team] || [])
    .map(a => a.asset || a.name || a.description || "")
    .filter(Boolean)
    .join("; ");
}

function teamName(slug) {
  return String(slug)
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const report = [];

for (const trade of trades) {
  if (!targetIds.has(trade.id)) continue;

  const teams = trade.teams || [];
  const houston = "houston-texans";
  const partner = teams.find(t => t !== houston);

  const houstonAssets = assetsFor(trade, houston);
  const partnerAssets = assetsFor(trade, partner);

  const partnerLabel = teamName(partner);

  const newSummary = `Houston acquired ${houstonAssets} from ${partnerLabel} for ${partnerAssets}.`;

  const newAnalysis =
    `${newSummary} ${partnerLabel} received ${partnerAssets} and sent ${houstonAssets}. ` +
    `The verdict remains ${trade.verdict || "Even Trade"} based on the recorded pick/player value and downstream draft outcomes.`;

  report.push({
    id: trade.id,
    slug: trade.slug,
    beforeSummary: trade.summary,
    afterSummary: newSummary,
    beforeAnalysis: trade.analysis,
    afterAnalysis: newAnalysis
  });
}

fs.writeFileSync(
  "src/data/nfl/houston-truncation-fix-dry-run.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), records: report }, null, 2)
);

console.log("Dry-run records:", report.length);
console.log("Wrote src/data/nfl/houston-truncation-fix-dry-run.json");
