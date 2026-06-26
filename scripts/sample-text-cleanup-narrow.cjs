const fs = require("fs");

const dry = JSON.parse(fs.readFileSync("src/data/nfl/text-cleanup-narrow-dry-run.json", "utf8"));

for (const row of dry.records.slice(0, 40)) {
  console.log("\n==============================");
  console.log(`${row.id} | ${row.field} | ${row.slug}`);
  console.log("BEFORE:", row.before);
  console.log("AFTER :", row.after);
}
