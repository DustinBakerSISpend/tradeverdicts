const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");

function cleanText(value) {
  let text = String(value || "").trim();

  text = text.replace(/Summary:\s*/gi, "");
  text = text.replace(/Analysis:\s*/gi, "");

  text = text.replace(
    /Second-pass grading moved this from[^.]*\.\s*/gi,
    ""
  );

  text = text.replace(
    /This row should[^.]*\.\s*/gi,
    ""
  );

  text = text.replace(/MetaAI/gi, "");
  text = text.replace(/audit correction/gi, "later review");
  text = text.replace(/public-data QA complete\.?/gi, "");
  text = text.replace(/Final public-data QA complete\.?/gi, "");

  return text.replace(/\s+/g, " ").trim();
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

for (const trade of trades) {
  for (const field of ["summary", "partnerSummary", "analysis", "qaNotes"]) {
    if (trade[field]) trade[field] = cleanText(trade[field]);
  }

  if (Array.isArray(trade.perspectives)) {
    for (const p of trade.perspectives) {
      for (const field of ["primarySummary", "partnerSummary", "qaNotes"]) {
        if (p[field]) p[field] = cleanText(p[field]);
      }
    }
  }
}

fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));

console.log("Surgical public text cleanup complete.");