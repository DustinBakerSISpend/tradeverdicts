const fs = require("fs");
const path = require("path");

const AUDIT = path.join(process.cwd(), "src", "data", "nfl", "unknown-partner-audit.json");
const OUT = path.join(process.cwd(), "src", "data", "nfl", "unknown-partner-suppression-dry-run.json");

const audit = JSON.parse(fs.readFileSync(AUDIT, "utf8"));

const candidates = audit.buckets.safeSuppressCandidates.map(r => ({
  suppressId: r.suppressId,
  suppressSlug: r.suppressCandidate,
  keepId: r.keepId,
  keepSlug: r.keepCandidate,
  tradeDate: r.tradeDate,
  reason: r.reason
}));

const report = {
  generatedAt: new Date().toISOString(),
  dryRun: true,
  count: candidates.length,
  candidates
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`Wrote ${OUT}`);
console.log(`Dry-run suppress count: ${report.count}`);
console.table(candidates.slice(0, 25).map(x => ({
  date: x.tradeDate,
  keep: x.keepSlug,
  suppress: x.suppressSlug
})));
