const fs = require("fs");

const p = "src/data/nfl/trades.json";
const data = JSON.parse(fs.readFileSync(p, "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

const t = trades.find(x => x.id === "DEN-2021-04-30-0368");
if (!t) throw new Error("DEN-2021-04-30-0368 not found");

t.analysis = "Denver holds the edge because it turned the move down into Quinn Meinerz plus another third-round asset. Paulson Adebo helped New Orleans, but the combined Denver return proved stronger.";

fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
console.log("Patched DEN-2021-04-30-0368 analysis.");
