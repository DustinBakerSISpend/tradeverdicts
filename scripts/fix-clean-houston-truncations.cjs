const fs = require("fs");

const tradesPath = "src/data/nfl/trades.json";
const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const fixes = {
  "HOU-2015-0043": {
    summary: "Houston acquired 2016 6th round pick (195th overall subsequently traded, Wes Schweitzer) from New York Jets for Ryan Fitzpatrick.",
    analysis: "Houston acquired 2016 6th round pick (195th overall subsequently traded, Wes Schweitzer) from New York Jets for Ryan Fitzpatrick. New York Jets received Ryan Fitzpatrick and sent 2016 6th round pick (195th overall subsequently traded, Wes Schweitzer). The verdict remains New York Jets Win based on the recorded pick/player value and downstream draft outcomes."
  },
  "HOU-2020-0064": {
    summary: "Houston acquired 2021 6th round pick (212th overall subsequently traded, Damar Hamlin) from New Orleans Saints for 2020 7th round pick (240th overall, Tommy Stevens).",
    analysis: "Houston acquired 2021 6th round pick (212th overall subsequently traded, Damar Hamlin) from New Orleans Saints for 2020 7th round pick (240th overall, Tommy Stevens). New Orleans Saints received 2020 7th round pick (240th overall, Tommy Stevens) and sent 2021 6th round pick (212th overall subsequently traded, Damar Hamlin). The verdict remains Houston Texans Win based on the recorded pick/player value and downstream draft outcomes."
  },
  "HOU-2021-0078": {
    summary: "Houston acquired 2022 6th round pick (207th overall subsequently traded, Doug Kramer) from New York Jets for Shaq Lawson.",
    analysis: "Houston acquired 2022 6th round pick (207th overall subsequently traded, Doug Kramer) from New York Jets for Shaq Lawson. New York Jets received Shaq Lawson and sent 2022 6th round pick (207th overall subsequently traded, Doug Kramer). The verdict remains New York Jets Win based on the recorded pick/player value and downstream draft outcomes."
  }
};

const report = [];

for (const trade of trades) {
  const fix = fixes[trade.id];
  if (!fix) continue;

  report.push({
    id: trade.id,
    slug: trade.slug,
    beforeSummary: trade.summary,
    afterSummary: fix.summary,
    beforeAnalysis: trade.analysis,
    afterAnalysis: fix.analysis
  });

  trade.summary = fix.summary;
  trade.analysis = fix.analysis;
}

fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");

fs.writeFileSync(
  "src/data/nfl/houston-clean-truncation-fix-report.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), records: report }, null, 2)
);

console.log("Fixed clean Houston truncations:", report.length);
