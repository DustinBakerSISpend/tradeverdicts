const fs = require("fs");

const trades = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));

const fields = ["summary", "analysis", "longAnalysis", "description", "tradeAnalysis"];

function cleanText(text) {
  if (typeof text !== "string") return text;

  return text
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/â€™/g, "’")
    .replace(/â€œ/g, "“")
    .replace(/â€\u009d/g, "”")
    .replace(/ï¿½/g, "’")

    .replace(/cash\.([A-Z])/g, "cash. $1")
    .replace(/asset\.([A-Z])/g, "asset. $1")
    .replace(/elsewhere\.([A-Z])/g, "elsewhere. $1")
    .replace(/shift\.([A-Z])/g, "shift. $1")
    .replace(/D\.([A-Z])/g, "D. $1")

    .replace(/rightsto/g, "rights to")
    .replace(/thisplayer/g, "this player")
    .replace(/wenton/g, "went on")
    .replace(/thana/g, "than a")
    .replace(/toChicago/g, "to Chicago")
    .replace(/fromthe/g, "from the")
    .replace(/oppositeside/g, "opposite side")
    .replace(/subsequentLayne/g, "subsequent Layne")
    .replace(/cashoutlay/g, "cash outlay")
    .replace(/receivedcash/g, "received cash")
    .replace(/gave upJohn/g, "gave up John")
    .replace(/solddecade/g, "sold decade")
    .replace(/becamenotable/g, "became notable")
    .replace(/Giantsreceived/g, "Giants received")
    .replace(/Rams1963/g, "Rams 1963")
    .replace(/pick#87/g, "pick #87")

    .replace(/roundpick/g, "round pick")
    .replace(/roundwith/g, "round with")
    .replace(/roundfrom/g, "round from")
    .replace(/roundto/g, "round to")
    .replace(/sixth-roundpick/g, "sixth-round pick")

    .replace(/BayPackers/g, "Bay Packers")
    .replace(/DallasCowboys/g, "Dallas Cowboys")
    .replace(/Patriotsreceived/g, "Patriots received")
    .replace(/Billsreceived/g, "Bills received")
    .replace(/andreceived/g, "and received")
    .replace(/andsent/g, "and sent")

    .replace(/(\d)(st|nd|rd|th)round/g, "$1$2 round")
    .replace(/(\d{4})(\d)(st|nd|rd|th)/g, "$1 $2$3")
    .replace(/(\d{4})([A-Z][a-z])/g, "$1 $2")

    .replace(/\s+/g, " ")
    .trim();
}

const changes = [];

for (const trade of trades) {
  for (const field of fields) {
    if (typeof trade[field] !== "string") continue;

    const before = trade[field];
    const after = cleanText(before);

    if (before !== after) {
      changes.push({
        id: trade.id,
        slug: trade.slug,
        field,
        before,
        after
      });
    }
  }
}

fs.writeFileSync(
  "src/data/nfl/text-cleanup-narrow-dry-run.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      changes: changes.length,
      records: changes
    },
    null,
    2
  )
);

console.log("Potential narrow text cleanup changes:", changes.length);
console.log("Wrote src/data/nfl/text-cleanup-narrow-dry-run.json");
