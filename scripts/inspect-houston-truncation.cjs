const fs = require("fs");

const ids = [
  "HOU-2013-0035",
  "HOU-2015-0043",
  "HOU-2020-0064",
  "HOU-2021-0071",
  "HOU-2021-0078",
  "HOU-2023-0095"
];

const trades = JSON.parse(
  fs.readFileSync("src/data/nfl/trades.json", "utf8")
);

for (const trade of trades) {
  if (!ids.includes(trade.id)) continue;

  console.log("\n=================================================");
  console.log(trade.id);
  console.log(trade.slug);
  console.log("-------------------------------------------------");
  console.log("PLAYERS:", trade.players);
  console.log("TEAMS:", trade.teams);
  console.log("VERDICT:", trade.verdict);
  console.log("SUMMARY:");
  console.log(trade.summary);
  console.log("\nANALYSIS:");
  console.log(trade.analysis);
  console.log("\nASSETS:");
  console.log(JSON.stringify(trade.assetsReceived, null, 2));
}
