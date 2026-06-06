const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "public-copy-sanitize-report.json");

const BANNED_PHRASES = [
  "Eliminate Status: Final QA Hold",
  "Final QA Hold",
  "Provisional Hold",
  "Historical Unknown",
  "Historical Certainty",
  "Asset Quality",
  "Trade Verdicts Hindsight Scale",
  "Major Designation",
  "Available Historical Record",
  "Long-Term Player Value",
  "Draft Return",
  "Internal Review",
  "Pending Review",
  "Audit Status",
  "Public handling: retained and viewable, no Browns trade row is hidden from the finished product.",
  "Public handling: retained and viewable.",
  "retained and viewable, no Browns trade row is hidden from the finished product.",
  "retained and viewable.",
];

const BANNED_PATTERNS = [
  /Partner Grade is [A-F][+-]? compared with Team Grade [A-F][+-]?\.?/gi,
  /Verdict:\s*Provisional\s+Even\s+Trade\.?/gi,
  /Verdict:\s*[^.]+\.?/gi,
  /Public handling:[^.]+\.?/gi,
  /Audit Status:[^.]+\.?/gi,
  /Internal Review:[^.]+\.?/gi,
  /Pending Review:[^.]+\.?/gi,
  /Historical Certainty:[^.]+\.?/gi,
  /Historical Unknown:[^.]+\.?/gi,
  /Asset Quality:[^.]+\.?/gi,
  /Major Designation:[^.]+\.?/gi,
  /Available Historical Record:[^.]+\.?/gi,
  /Trade Verdicts Hindsight Scale:[^.]+\.?/gi,
];

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function sanitizeText(value) {
  let text = clean(value);
  if (!text) return "";

  for (const phrase of BANNED_PHRASES) {
    text = text.split(phrase).join("");
  }

  for (const pattern of BANNED_PATTERNS) {
    text = text.replace(pattern, "");
  }

  text = text
    .replace(/\bSummary:\s*/gi, "")
    .replace(/\bAnalysis:\s*/gi, "")
    .replace(/\s+\./g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+,/g, ",")
    .replace(/\s+;/g, ";")
    .replace(/;\s*;/g, ";")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}

function sanitizeTrade(trade) {
  const before = {
    summary: trade.summary,
    partnerSummary: trade.partnerSummary,
    analysis: trade.analysis,
    qaNotes: trade.qaNotes,
    perspectives: (trade.perspectives || []).map((p) => ({
      primarySummary: p.primarySummary,
      partnerSummary: p.partnerSummary,
      qaNotes: p.qaNotes,
    })),
  };

  trade.summary = sanitizeText(trade.summary);
  trade.partnerSummary = sanitizeText(trade.partnerSummary);
  trade.analysis = sanitizeText(trade.analysis);
  trade.qaNotes = sanitizeText(trade.qaNotes);

  for (const perspective of trade.perspectives || []) {
    perspective.primarySummary = sanitizeText(perspective.primarySummary);
    perspective.partnerSummary = sanitizeText(perspective.partnerSummary);
    perspective.qaNotes = sanitizeText(perspective.qaNotes);
  }

  const after = {
    summary: trade.summary,
    partnerSummary: trade.partnerSummary,
    analysis: trade.analysis,
    qaNotes: trade.qaNotes,
    perspectives: (trade.perspectives || []).map((p) => ({
      primarySummary: p.primarySummary,
      partnerSummary: p.partnerSummary,
      qaNotes: p.qaNotes,
    })),
  };

  return JSON.stringify(before) !== JSON.stringify(after);
}

function main() {
  const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

  const report = [];
  let changed = 0;

  for (const trade of trades) {
    const before = {
      id: trade.id,
      slug: trade.slug,
      summary: trade.summary,
      analysis: trade.analysis,
      qaNotes: trade.qaNotes,
    };

    if (sanitizeTrade(trade)) {
      changed++;
      report.push({
        id: trade.id,
        slug: trade.slug,
        before,
        after: {
          summary: trade.summary,
          analysis: trade.analysis,
          qaNotes: trade.qaNotes,
        },
      });
    }
  }

  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log("Sanitized public trade copy.");
  console.log(`Trades scanned: ${trades.length}`);
  console.log(`Trades changed: ${changed}`);
  console.log(`Saved trades to ${TRADES_FILE}`);
  console.log(`Saved report to ${REPORT_FILE}`);
}

main();