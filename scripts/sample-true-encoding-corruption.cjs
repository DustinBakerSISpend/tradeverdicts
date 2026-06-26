const fs = require("fs");

const audit = JSON.parse(fs.readFileSync("src/data/nfl/true-encoding-corruption.json", "utf8"));

for (const row of audit.rows.slice(0, 25)) {
  console.log("\n==============================");
  console.log(`${row.id} | ${row.field} | ${row.slug}`);
  console.log("HITS:", row.hits.join(", "));
  console.log(row.text);
}
