const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");

const KEEP_SLUG = "eagles-2021-03-26-miami-dolphins-0422";
const HIDE_SLUG = "2021-1st-round-pick-6th-overall-eagles-2021";

function main() {
  const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

  let kept = false;
  let hidden = false;

  const updated = trades.map((trade) => {
    if (trade.slug === KEEP_SLUG) {
      kept = true;
      return {
        ...trade,
        publishStatus: "ready",
        qaNotes: trade.qaNotes
          ? `${trade.qaNotes} | Restored as Waddle canonical keeper.`
          : "Restored as Waddle canonical keeper.",
      };
    }

    if (trade.slug === HIDE_SLUG) {
      hidden = true;
      return {
        ...trade,
        publishStatus: "hold-conflict",
        qaNotes: trade.qaNotes
          ? `${trade.qaNotes} | Hidden as duplicate Waddle alias record.`
          : "Hidden as duplicate Waddle alias record.",
      };
    }

    return trade;
  });

  if (!kept) {
    console.error(`Could not find keeper slug: ${KEEP_SLUG}`);
    process.exit(1);
  }

  if (!hidden) {
    console.error(`Could not find duplicate slug: ${HIDE_SLUG}`);
    process.exit(1);
  }

  fs.writeFileSync(TRADES_FILE, JSON.stringify(updated, null, 2));

  console.log(`Kept public: ${KEEP_SLUG}`);
  console.log(`Hidden duplicate: ${HIDE_SLUG}`);
  console.log(`Saved ${TRADES_FILE}`);
}

main();