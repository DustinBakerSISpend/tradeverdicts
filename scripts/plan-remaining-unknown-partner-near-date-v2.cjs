const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const auditPath = path.join(process.cwd(), "audits", "audit-unknown-partner-near-date-duplicates-v2.json");
const outPath = path.join(process.cwd(), "audits", "plan-remaining-unknown-partner-near-date-v2.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;
const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function compact(t) {
  if (!t) return null;
  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: t.tradeDate || t.date || null,
    teams: t.teams || [],
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null
  };
}

const manualPlan = [
  {
    bucket: "inspect-safe-candidate",
    action: "likely-suppress",
    keeperSlug: "undisclosed-consideration-green-bay-packers-1958",
    suppressSlug: "draft-pick-new-york-giants-1958",
    reason: "Same teams, near date, John Skibinski overlap; keeper appears to preserve fuller player/pick package."
  },
  {
    bucket: "block-likely-distinct",
    action: "block",
    keeperSlug: "mel-triplett-new-york-giants-1961",
    suppressSlug: "undisclosed-consideration-chicago-bears-1961",
    reason: "Only New York Giants and Dave Whitsell overlap; counterpart teams differ, likely separate transaction chain."
  },
  {
    bucket: "block-likely-distinct",
    action: "block",
    keeperSlug: "undisclosed-consideration-green-bay-packers-1963",
    suppressSlug: "eagles-1963-04-25-new-york-giants-0068",
    reason: "Bill Quinlan overlap, but counterpart teams differ; likely separate transactions involving same player."
  },
  {
    bucket: "block-likely-distinct",
    action: "block",
    keeperSlug: "dick-capp-green-bay-packers-1968",
    suppressSlug: "cardinals-1968-08-25-green-bay-packers-dick-capp-draft-pick",
    reason: "Dick Capp overlap, but counterpart teams differ by one day; likely chain movement, not duplicate."
  },
  {
    bucket: "inspect-safe-candidate",
    action: "likely-suppress",
    keeperSlug: "saints-1970-03-02-chicago-bears-loyd-phillips",
    suppressSlug: "jim-hester-jimmy-hester-unknown-partner-1970",
    reason: "Same date, Bears overlap, Jim Hester overlap; keeper appears to identify Saints/Loyd Phillips side."
  },
  {
    bucket: "inspect-safe-candidate",
    action: "likely-suppress",
    keeperSlug: "draft-pick-new-york-giants-1975",
    suppressSlug: "henry-reed-new-york-giants-1975",
    reason: "Same teams, near date, same player set; suppress row already hold-conflict."
  },
  {
    bucket: "inspect-safe-candidate",
    action: "likely-suppress",
    keeperSlug: "1977-fourth-round-pick-110-robert-sims-mickey-sims-1978-first-round-pick-20-elvi",
    suppressSlug: "1977-fourth-round-pick-110-robert-sims-mickey-sims-unknown-partner-197",
    reason: "Keeper has concrete Bears/Browns package and overlapping pick/player detail."
  },
  {
    bucket: "inspect-safe-candidate",
    action: "likely-suppress",
    keeperSlug: "player-to-be-named-later-bob-moore-on-1978-04-14-unknown-partner-1978",
    suppressSlug: "bob-moore-unknown-partner-1978",
    reason: "Same unknown-partner Bears/Bob Moore cluster; keeper preserves PTBNL timing."
  },
  {
    bucket: "inspect-repair-candidate",
    action: "repair-then-suppress",
    keeperSlug: "rich-grimmett-cowboys-voided-when-grimmett-failed-physical-1979",
    suppressSlug: "houston-oilers-1979",
    reason: "Keeper has voided-physical detail but bad team string; suppress candidate may preserve correct Dallas/Tennessee team structure."
  },
  {
    bucket: "block-likely-false-positive",
    action: "block",
    keeperSlug: "unspecified-consideration-new-orleans-saints-1980-lac-1980-0188",
    suppressSlug: "unspecified-consideration-new-york-giants-1980-lac-1980-0189",
    reason: "Overlap is bad extracted token 'unspecified lac'; players and counterpart teams differ."
  },
  {
    bucket: "inspect-repair-candidate",
    action: "repair-then-suppress",
    keeperSlug: "kenny-neil-los-angeles-san-diego-chargers-1984",
    suppressSlug: "1985-fifth-round-pick-unknown-1984",
    reason: "Same player/team overlap, but suppress slug may preserve 1985 fifth-round pick detail."
  },
  {
    bucket: "inspect-repair-candidate",
    action: "repair-then-suppress",
    keeperSlug: "chuck-muncie-chargers-1984",
    suppressSlug: "1985-second-round-pick-unknown-partner-1984",
    reason: "Same teams/player, but suppress slug may preserve 1985 second-round pick detail."
  },
  {
    bucket: "inspect-uncertain",
    action: "manual-review",
    keeperSlug: "john-stephens-milton-green-bay-packers-1993",
    suppressSlug: "1994-conditional-seventh-round-pick-return-of-previously-traded-pick-unknown-par",
    reason: "Eric Dickerson overlap and Green Bay overlap, but relationship to John Stephens row is not safe from compact output."
  }
];

const rows = manualPlan.map(p => {
  const keeper = find(p.keeperSlug);
  const suppress = find(p.suppressSlug);

  return {
    ...p,
    keeper: compact(keeper),
    suppress: compact(suppress),
    missing: {
      keeper: !keeper,
      suppress: !suppress
    }
  };
});

const byBucket = rows.reduce((acc, r) => {
  acc[r.bucket] = (acc[r.bucket] || 0) + 1;
  return acc;
}, {});

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceAudit: auditPath,
  v2AuditSnapshot: {
    componentCount: audit.componentCount,
    pairCount: audit.pairCount,
    byConfidence: audit.byConfidence
  },
  totalPlannedRows: rows.length,
  byBucket,
  rows
}, null, 2));

console.log("");
console.log("PLAN REMAINING UNKNOWN-PARTNER NEAR-DATE V2");
console.log("=".repeat(80));
console.log(`source V2 components: ${audit.componentCount}`);
console.log(`source V2 pairs: ${audit.pairCount}`);
console.log(`source V2 confidence: ${JSON.stringify(audit.byConfidence)}`);
console.log(`planned rows: ${rows.length}`);
console.log(`by bucket: ${JSON.stringify(byBucket)}`);
console.log(`Report: ${outPath}`);

for (const r of rows) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${r.bucket} | action=${r.action}`);
  console.log(`KEEPER:   ${r.keeperSlug} | ${r.keeper?.id || "MISSING"} | status=${r.keeper?.publishStatus || "?"} | suppressed=${r.keeper?.suppressed}`);
  console.log(`SUPPRESS: ${r.suppressSlug} | ${r.suppress?.id || "MISSING"} | status=${r.suppress?.publishStatus || "?"} | suppressed=${r.suppress?.suppressed}`);
  console.log(`reason: ${r.reason}`);

  console.log("");
  console.log("keeper teams/assets/summary:");
  console.log(`teams=${JSON.stringify(r.keeper?.teams || [])}`);
  console.dir(r.keeper?.assetsReceived || {}, { depth: null });
  console.log(r.keeper?.summary || "(none)");

  console.log("");
  console.log("suppress teams/assets/summary:");
  console.log(`teams=${JSON.stringify(r.suppress?.teams || [])}`);
  console.dir(r.suppress?.assetsReceived || {}, { depth: null });
  console.log(r.suppress?.summary || "(none)");
}
