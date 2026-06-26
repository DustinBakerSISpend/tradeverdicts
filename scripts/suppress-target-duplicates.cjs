const fs = require("fs");
const path = require("path");

const tradesPath = path.join("src", "data", "nfl", "trades.json");
const trades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));

const suppressions = [
  {
    keepSlug: "jalen-ramsey-jacksonville-jaguars-2019",
    suppressSlug: "2020-1st-round-pick-20th-overall-los-angeles-st-louis-rams-2019",
    reason: "duplicate-canonical-record; Jalen Ramsey player-led record is canonical"
  },
  {
    keepSlug: "joe-dawkins-new-york-giants-1976",
    suppressSlug: "undisclosed-consideration-houston-oilers-tennessee-titans-1976",
    reason: "duplicate-canonical-record; named-player record is canonical over undisclosed-consideration synthetic record"
  }
];

const bySlug = new Map(trades.map(t => [t.slug, t]));
const report = [];

for (const item of suppressions) {
  const keep = bySlug.get(item.keepSlug);
  const suppress = bySlug.get(item.suppressSlug);

  if (!keep || !suppress) {
    report.push({
      ...item,
      status: "skipped-missing-record",
      keepFound: !!keep,
      suppressFound: !!suppress
    });
    continue;
  }

  keep.publishStatus = keep.publishStatus === "hold-conflict" ? "published" : keep.publishStatus;

  suppress.publishStatus = "hold-conflict";
  suppress.reviewReason = item.reason;
  suppress.canonicalTradeSlug = keep.slug;
  suppress.canonicalTradeId = keep.id;

  report.push({
    ...item,
    status: "suppressed",
    keepId: keep.id,
    suppressId: suppress.id,
    keepTeams: keep.teams,
    suppressTeams: suppress.teams,
    keepVerdict: keep.verdict,
    suppressVerdict: suppress.verdict
  });
}

fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + "\n");

fs.writeFileSync(
  path.join("src", "data", "nfl", "target-duplicate-suppression-report.json"),
  JSON.stringify(report, null, 2)
);

console.log("Wrote src/data/nfl/target-duplicate-suppression-report.json");
console.table(report.map(r => ({
  status: r.status,
  suppressSlug: r.suppressSlug,
  keepSlug: r.keepSlug
})));
