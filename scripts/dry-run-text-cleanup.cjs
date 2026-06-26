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
    .replace(/â€/g, "”")
    .replace(/ï¿½/g, "’")

    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")

    .replace(/([a-z])([A-Z])/g, "$1 $2")

    .replace(/\broundpick\b/gi, "round pick")
    .replace(/\broundwith\b/gi, "round with")
    .replace(/\broundfrom\b/gi, "round from")
    .replace(/\broundto\b/gi, "round to")

    .replace(/\bBayPackers\b/g, "Bay Packers")
    .replace(/\bDallasCowboys\b/g, "Dallas Cowboys")
    .replace(/\bPatriotsreceived\b/g, "Patriots received")
    .replace(/\bandsent\b/g, "and sent")
    .replace(/\bfora\b/g, "for a")

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
  "src/data/nfl/text-cleanup-dry-run.json",
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

console.log("Potential text cleanup changes:", changes.length);
console.log("Wrote src/data/nfl/text-cleanup-dry-run.json");
