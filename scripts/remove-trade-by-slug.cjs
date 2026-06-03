const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");

const REMOVE_SLUG = "2022-1st-round-pick-29th-overall-subseq-miami-dolphins-2022";

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

const before = trades.length;
const filtered = trades.filter((trade) => trade.slug !== REMOVE_SLUG);
const after = filtered.length;

fs.writeFileSync(TRADES_FILE, JSON.stringify(filtered, null, 2));

console.log(`Removed ${before - after} trade(s).`);
console.log(`Before: ${before}`);
console.log(`After: ${after}`);