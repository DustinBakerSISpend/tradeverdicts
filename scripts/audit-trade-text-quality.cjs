const fs = require("fs");

const trades = JSON.parse(
  fs.readFileSync("src/data/nfl/trades.json", "utf8")
).filter((t) => t.publishStatus !== "hold-conflict" && !t.suppressed);

const report = [];

const BAD_ENDINGS = [
  " gr.",
  " rece.",
  " condit.",
  " tra.",
  " ove.",
  " partn.",
  " trad.",
  " cons.",
  " pick."
];

const BAD_ENCODING = [
  "ï¿½",
  "â€™",
  "â€œ",
  "â€",
  "â€“"
];

const PLACEHOLDERS = [
  "UNKNOWN_PICK",
  "CONDITIONAL_VOIDED",
  "CASH_UNCONFIRMED"
];

function getText(trade) {
  return [
    trade.summary,
    trade.analysis,
    trade.longAnalysis,
    trade.description,
    trade.tradeAnalysis
  ]
    .filter(Boolean)
    .join("\n\n");
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

for (const trade of trades) {
  const summary = String(trade.summary || "").trim();
  const analysis =
    String(
      trade.analysis ||
      trade.longAnalysis ||
      trade.tradeAnalysis ||
      ""
    ).trim();

  const text = getText(trade);
  const issues = [];

  for (const ending of BAD_ENDINGS) {
    if (
      summary.toLowerCase().endsWith(ending) ||
      analysis.toLowerCase().endsWith(ending)
    ) {
      issues.push("truncated-ending");
    }
  }

  if (analysis && !/[.!?]$/.test(analysis)) {
    issues.push("missing-ending-punctuation");
  }

  if (analysis && wordCount(analysis) < 25) {
    issues.push("very-short-analysis");
  }

  if (summary && analysis && analysis.length < summary.length * 0.5) {
    issues.push("analysis-much-shorter-than-summary");
  }

  if (summary && analysis && summary.toLowerCase() === analysis.toLowerCase()) {
    issues.push("summary-identical-to-analysis");
  }

  for (const bad of BAD_ENCODING) {
    if (text.includes(bad)) {
      issues.push("encoding-corruption");
      break;
    }
  }

  for (const placeholder of PLACEHOLDERS) {
    if (text.includes(placeholder)) {
      issues.push("placeholder-text");
      break;
    }
  }

  if (/[a-z],[A-Z]/.test(text) || /\.[A-Z]/.test(text)) {
    issues.push("missing-space");
  }

  if (
    /[a-z][A-Z]{2,}/.test(text) ||
    /WashingtonRedskins/.test(text) ||
    /NewYork/.test(text)
  ) {
    issues.push("jammed-words");
  }

  if (/failed physical|voided|not exercised|subsequently traded/i.test(text)) {
    issues.push("synthetic-language");
  }

  if (issues.length) {
    report.push({
      id: trade.id,
      slug: trade.slug,
      tradeDate: trade.tradeDate,
      issues,
      summaryWords: wordCount(summary),
      analysisWords: wordCount(analysis)
    });
  }
}

const buckets = {};

for (const row of report) {
  for (const issue of row.issues) {
    buckets[issue] = (buckets[issue] || 0) + 1;
  }
}

fs.writeFileSync(
  "src/data/nfl/text-quality-audit.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      totalTradesFlagged: report.length,
      issueCounts: buckets,
      trades: report
    },
    null,
    2
  )
);

console.log("Trades flagged:", report.length);
console.table(buckets);

