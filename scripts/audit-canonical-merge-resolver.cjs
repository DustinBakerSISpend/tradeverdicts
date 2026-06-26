const fs = require("fs");

const TRADES = "src/data/nfl/trades.json";
const AUDIT = "src/data/nfl/transaction-merge-audit.json";
const OUT = "src/data/nfl/canonical-merge-resolver-audit.json";

const trades = JSON.parse(fs.readFileSync(TRADES, "utf8"));
const audit = JSON.parse(fs.readFileSync(AUDIT, "utf8"));

function wordCount(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

function assetCount(t) {
  return Object.values(t.assetsReceived || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
}

function blankAssetSides(t) {
  return Object.values(t.assetsReceived || {}).filter(arr => Array.isArray(arr) && arr.length === 0).length;
}

function score(t) {
  let s = 0;
  const summaryWords = wordCount(t.summary);
  const analysisWords = wordCount(t.analysis);
  const assets = assetCount(t);
  const blankSides = blankAssetSides(t);

  s += Math.min(summaryWords, 80);
  s += Math.min(analysisWords, 120) / 2;
  s += assets * 10;
  s += (Array.isArray(t.perspectives) ? t.perspectives.length : 0) * 8;

  if (summaryWords === 0) s -= 50;
  if (analysisWords < 20) s -= 20;
  if (blankSides > 0) s -= blankSides * 35;
  if (String(t.slug || "").match(/unknown|undisclosed|unspecified|cash|consideration/i)) s -= 15;

  return Math.round(s);
}

const rows = [];

for (const c of audit.rows.filter(x => x.bucket === "mergeCandidate")) {
  const slugs = [
    ...c.suppressCandidates.map(x => x.slug),
    ...c.keepCandidates.map(x => x.slug)
  ];

  const records = slugs.map(slug => {
    const t = trades.find(x => x.slug === slug);
    return {
      id: t.id,
      slug: t.slug,
      score: score(t),
      verdict: t.verdict,
      grades: t.grades,
      summaryWords: wordCount(t.summary),
      analysisWords: wordCount(t.analysis),
      assetCount: assetCount(t),
      blankAssetSides: blankAssetSides(t),
      perspectives: Array.isArray(t.perspectives) ? t.perspectives.length : 0,
      suppressed: !!t.suppressed,
      assetsReceived: t.assetsReceived,
      summary: t.summary,
      analysis: t.analysis
    };
  }).sort((a,b) => b.score - a.score);

  rows.push({
    tradeDate: c.tradeDate,
    teams: c.teams,
    recommendedCanonical: records[0],
    recommendedDuplicate: records[1],
    scoreGap: records[0].score - records[1].score,
    recommendation:
      records[0].score - records[1].score >= 40
        ? "promote higher-quality record and suppress lower-quality duplicate"
        : "needs manual merge/research",
    records
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  total: rows.length,
  counts: {
    promoteAndSuppress: rows.filter(r => r.recommendation.startsWith("promote")).length,
    needsManualMergeResearch: rows.filter(r => r.recommendation.startsWith("needs")).length
  },
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log("Wrote", OUT);
console.table(report.counts);
console.table(rows.map(r => ({
  date: r.tradeDate,
  teams: r.teams.join(" / "),
  canonical: r.recommendedCanonical.slug,
  canonicalScore: r.recommendedCanonical.score,
  duplicate: r.recommendedDuplicate.slug,
  duplicateScore: r.recommendedDuplicate.score,
  gap: r.scoreGap,
  recommendation: r.recommendation
})));
