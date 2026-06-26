const fs = require("fs");

const collisions = JSON.parse(fs.readFileSync("src/data/nfl/team-pair-date-collision-audit.json", "utf8")).rows;

function badSlug(slug) {
  return /unknown|undisclosed|unspecified|cash|terms|consideration/i.test(slug || "");
}

function assetKinds(record) {
  const text = String(record.assets || "").toLowerCase();
  return {
    hasPlayer: text.includes("player:"),
    hasPick: text.includes("pick") || text.includes("round"),
    hasCash: text.includes("cash"),
    hasUnknown: /unknown|undisclosed|unspecified|terms|consideration/.test(text)
  };
}

function scoreGroup(g) {
  let score = 0;
  const bad = g.records.filter(r => badSlug(r.slug));
  const good = g.records.filter(r => !badSlug(r.slug));

  if (bad.length >= 1 && good.length >= 1) score += 30;
  if (g.count === 2) score += 10;

  for (const r of bad) {
    const a = assetKinds(r);
    if (a.hasUnknown || a.hasCash) score += 15;
    if (!a.hasPlayer) score += 10;
  }

  for (const r of good) {
    const a = assetKinds(r);
    if (a.hasPlayer) score += 15;
    if (a.hasPick) score += 5;
  }

  return score;
}

const rows = collisions
  .filter(g => g.records.some(r => badSlug(r.slug)) && g.records.some(r => !badSlug(r.slug)))
  .map(g => {
    const badRecords = g.records.filter(r => badSlug(r.slug));
    const canonicalRecords = g.records.filter(r => !badSlug(r.slug));
    const score = scoreGroup(g);

    let bucket = "needsResearch";
    if (score >= 70) bucket = "likelyDuplicatePlaceholder";
    else if (score >= 50) bucket = "mergeCandidate";

    return {
      bucket,
      score,
      tradeDate: g.tradeDate,
      teams: g.teams,
      count: g.count,
      suppressCandidates: badRecords.map(r => ({
        id: r.id,
        slug: r.slug,
        verdict: r.verdict,
        grades: r.grades,
        assets: r.assets,
        summary: r.summary
      })),
      keepCandidates: canonicalRecords.map(r => ({
        id: r.id,
        slug: r.slug,
        verdict: r.verdict,
        grades: r.grades,
        assets: r.assets,
        summary: r.summary
      })),
      reason: "same team pair/date with placeholder-like record beside richer canonical record"
    };
  })
  .sort((a,b) => b.score - a.score || a.tradeDate.localeCompare(b.tradeDate));

const buckets = {
  likelyDuplicatePlaceholder: rows.filter(r => r.bucket === "likelyDuplicatePlaceholder"),
  mergeCandidate: rows.filter(r => r.bucket === "mergeCandidate"),
  needsResearch: rows.filter(r => r.bucket === "needsResearch")
};

const report = {
  generatedAt: new Date().toISOString(),
  totalGroups: rows.length,
  counts: Object.fromEntries(Object.entries(buckets).map(([k,v]) => [k,v.length])),
  buckets,
  rows
};

fs.writeFileSync("src/data/nfl/transaction-merge-audit.json", JSON.stringify(report, null, 2));

console.log("Wrote src/data/nfl/transaction-merge-audit.json");
console.table(report.counts);
console.table(rows.slice(0,30).map(r => ({
  bucket: r.bucket,
  score: r.score,
  date: r.tradeDate,
  teams: r.teams.join(" / "),
  suppress: r.suppressCandidates.map(x => x.slug).join(" || "),
  keep: r.keepCandidates.map(x => x.slug).join(" || ")
})));

