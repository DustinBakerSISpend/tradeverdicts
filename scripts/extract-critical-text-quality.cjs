const fs = require("fs");

const audit = JSON.parse(fs.readFileSync("src/data/nfl/text-quality-audit.json", "utf8"));

const criticalIssues = new Set([
  "truncated-ending",
  "encoding-corruption",
  "placeholder-text",
  "jammed-words",
  "summary-identical-to-analysis"
]);

const critical = audit.trades.filter((t) =>
  t.issues.some((issue) => criticalIssues.has(issue))
);

fs.writeFileSync(
  "src/data/nfl/text-quality-critical-audit.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      totalCriticalTrades: critical.length,
      issueCounts: critical.reduce((acc, t) => {
        for (const issue of t.issues) {
          if (criticalIssues.has(issue)) acc[issue] = (acc[issue] || 0) + 1;
        }
        return acc;
      }, {}),
      trades: critical
    },
    null,
    2
  )
);

console.log("Critical trades:", critical.length);
console.table(
  critical.reduce((acc, t) => {
    for (const issue of t.issues) {
      if (criticalIssues.has(issue)) acc[issue] = (acc[issue] || 0) + 1;
    }
    return acc;
  }, {})
);
