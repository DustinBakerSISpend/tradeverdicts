const fs = require("fs");

const audit = JSON.parse(fs.readFileSync("src/data/nfl/text-quality-critical-audit.json", "utf8"));

for (const issue of Object.keys(audit.issueCounts)) {
  console.log("\n==============================");
  console.log(issue, audit.issueCounts[issue]);
  console.log("==============================");

  const rows = audit.trades
    .filter(t => t.issues.includes(issue))
    .slice(0, 12);

  for (const t of rows) {
    console.log(`${t.id} | ${t.tradeDate} | ${t.slug}`);
  }
}
