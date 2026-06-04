const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "ai-reference-cleanup-report.json");

const AI_PATTERNS = [
  /\bChatGPT\b/gi,
  /\bClaudeAI\b/gi,
  /\bClaude\b/gi,
  /\bMetaAI\b/gi,
  /\bMeta AI\b/gi,
  /\bMeta\b/gi,
  /\bGrok\b/gi,
  /\bGemini\b/gi,
  /\bCopilot\b/gi,
];

const PHRASE_PATTERNS = [
  /Post[- ]Copilot QA:?\s*/gi,
  /Post[- ][A-Za-z]+ QA:?\s*/gi,
  /[A-Za-z]+[- ]formula final package verified\.?/gi,
  /Initial [A-Za-z0-9\s-]+ pass complete;?\s*/gi,
  /final audit\.?/gi,
  /verify high-profile\/recent rows in final audit\.?/gi,
  /verify notable source details,?\s*/gi,
  /should verify notable source details,?\s*/gi,
  /audit confirmed existing grade\.?/gi,
  /regraded in realistic-curve pass;?\s*/gi,
  /no import blocker remains\.?/gi,
  /publish status normalized;?\s*/gi,
];

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function scrubText(value) {
  let text = clean(value);
  if (!text) return "";

  for (const pattern of PHRASE_PATTERNS) {
    text = text.replace(pattern, "");
  }

  for (const pattern of AI_PATTERNS) {
    text = text.replace(pattern, "");
  }

  text = text
    .replace(/\s+\./g, ".")
    .replace(/\s+,/g, ",")
    .replace(/:\s*\./g, ".")
    .replace(/;\s*;/g, ";")
    .replace(/\|\s*\|/g, "|")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*[:;,.|-]+\s*/g, "")
    .replace(/\s*[:;,.|-]+\s*$/g, "")
    .trim();

  return text;
}

function scrubTrade(trade, report) {
  const fields = ["summary", "partnerSummary", "analysis", "qaNotes"];

  for (const field of fields) {
    if (trade[field] === undefined) continue;

    const before = trade[field];
    const after = scrubText(before);

    if (before !== after) {
      report.push({
        slug: trade.slug,
        field,
        before,
        after,
      });

      trade[field] = after;
    }
  }

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives = trade.perspectives.map((perspective, index) => {
      const next = { ...perspective };
      const perspectiveFields = ["primarySummary", "partnerSummary", "qaNotes"];

      for (const field of perspectiveFields) {
        if (next[field] === undefined) continue;

        const before = next[field];
        const after = scrubText(before);

        if (before !== after) {
          report.push({
            slug: trade.slug,
            perspectiveIndex: index,
            field: `perspectives.${field}`,
            before,
            after,
          });

          next[field] = after;
        }
      }

      return next;
    });
  }

  return trade;
}

function main() {
  if (!fs.existsSync(TRADES_FILE)) {
    console.error(`Could not find trades file: ${TRADES_FILE}`);
    process.exit(1);
  }

  const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

  if (!Array.isArray(trades)) {
    console.error("trades.json is not an array.");
    process.exit(1);
  }

  const report = [];
  const cleanedTrades = trades.map((trade) => scrubTrade(trade, report));

  fs.writeFileSync(TRADES_FILE, JSON.stringify(cleanedTrades, null, 2));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log("Removed AI/tool references from public trade data.");
  console.log(`Trades scanned: ${trades.length}`);
  console.log(`Fields changed: ${report.length}`);
  console.log(`Saved trades to ${TRADES_FILE}`);
  console.log(`Saved report to ${REPORT_FILE}`);
}

main();