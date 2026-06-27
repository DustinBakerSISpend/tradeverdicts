const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "apply-safe-unknown-partner-near-date-v2-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function dateOf(t) {
  return t?.tradeDate || t?.date || "";
}

function textOf(t) {
  return [
    t?.id,
    t?.slug,
    t?.tradeDate,
    t?.date,
    t?.summary,
    t?.qaNotes,
    JSON.stringify(t?.teams || []),
    JSON.stringify(t?.assetsReceived || {})
  ].join(" ").toLowerCase();
}

const safeSuppressions = [
  {
    label: "1958 Packers/Giants John Skibinski duplicate",
    keeperSlug: "undisclosed-consideration-green-bay-packers-1958",
    suppressSlug: "draft-pick-new-york-giants-1958",
    requiredKeeperTerms: ["john skibinski", "1959 seventh round pick"],
    reason: "Keeper preserves John Skibinski plus the fuller Packers/Giants player-pick package; suppress row is a thinner near-date duplicate."
  },
  {
    label: "1970 Bears/Saints Jim Hester duplicate",
    keeperSlug: "saints-1970-03-02-chicago-bears-loyd-phillips",
    suppressSlug: "jim-hester-jimmy-hester-unknown-partner-1970",
    requiredKeeperTerms: ["loyd phillips", "jim hester"],
    reason: "Keeper identifies the Saints side and preserves Jim Hester plus undisclosed pick detail; suppress row is unknown-partner partial."
  },
  {
    label: "1977 Bears/Browns Robert Sims duplicate",
    keeperSlug: "1977-fourth-round-pick-110-robert-sims-mickey-sims-1978-first-round-pick-20-elvi",
    suppressSlug: "1977-fourth-round-pick-110-robert-sims-mickey-sims-unknown-partner-197",
    requiredKeeperTerms: ["1977 fourth round pick", "1978 first round pick", "mike phipps"],
    reason: "Keeper preserves the concrete Bears/Browns Mike Phipps package; suppress row is unknown-partner partial for pick #110 only."
  },
  {
    label: "1978 Bears Bob Moore duplicate",
    keeperSlug: "player-to-be-named-later-bob-moore-on-1978-04-14-unknown-partner-1978",
    suppressSlug: "bob-moore-unknown-partner-1978",
    requiredKeeperTerms: ["bob moore", "1978-04-14"],
    reason: "Keeper preserves the player-to-be-named-later timing; suppress row is a thinner Bob Moore duplicate."
  },
  {
    label: "1984 Kenny Neil duplicate",
    keeperSlug: "kenny-neil-los-angeles-san-diego-chargers-1984",
    suppressSlug: "1985-fifth-round-pick-unknown-1984",
    requiredKeeperTerms: ["kenny neil", "1985 fifth round pick"],
    reason: "Keeper preserves Kenny Neil and the voided/conditional 1985 fifth-round pick sequence; suppress row is an unknown-partner duplicate."
  },
  {
    label: "1984 Chuck Muncie duplicate",
    keeperSlug: "chuck-muncie-chargers-1984",
    suppressSlug: "1985-second-round-pick-unknown-partner-1984",
    requiredKeeperTerms: ["chuck muncie", "1985 second round pick", "voided"],
    reason: "Keeper preserves Chuck Muncie and the voided 1985 second-round pick detail; suppress row is a directionally suspect duplicate."
  }
];

const blockedRows = [
  {
    bucket: "blocked-likely-distinct",
    keeperSlug: "mel-triplett-new-york-giants-1961",
    suppressSlug: "undisclosed-consideration-chicago-bears-1961",
    reason: "Dave Whitsell overlap only; counterpart teams differ, likely separate chain transaction."
  },
  {
    bucket: "blocked-likely-distinct",
    keeperSlug: "undisclosed-consideration-green-bay-packers-1963",
    suppressSlug: "eagles-1963-04-25-new-york-giants-0068",
    reason: "Bill Quinlan overlap only; counterpart teams differ, likely separate transaction."
  },
  {
    bucket: "blocked-likely-distinct",
    keeperSlug: "dick-capp-green-bay-packers-1968",
    suppressSlug: "cardinals-1968-08-25-green-bay-packers-dick-capp-draft-pick",
    reason: "Dick Capp overlap with different counterpart teams; likely chain movement, not duplicate."
  },
  {
    bucket: "blocked-repair-review",
    keeperSlug: "draft-pick-new-york-giants-1975",
    suppressSlug: "henry-reed-new-york-giants-1975",
    reason: "Same teams/player set, but keeper has contaminated-looking Henry Reed assets on both sides. Needs repair review before suppression."
  },
  {
    bucket: "blocked-repair-review",
    keeperSlug: "rich-grimmett-cowboys-voided-when-grimmett-failed-physical-1979",
    suppressSlug: "houston-oilers-1979",
    reason: "Likely duplicate, but keeper has bad team slug/team key and voided-physical detail. Repair before suppression."
  },
  {
    bucket: "blocked-false-positive",
    keeperSlug: "unspecified-consideration-new-orleans-saints-1980-lac-1980-0188",
    suppressSlug: "unspecified-consideration-new-york-giants-1980-lac-1980-0189",
    reason: "Bad token overlap from unspecified/LAC; players and counterpart teams differ."
  },
  {
    bucket: "blocked-manual-review",
    keeperSlug: "john-stephens-milton-green-bay-packers-1993",
    suppressSlug: "1994-conditional-seventh-round-pick-return-of-previously-traded-pick-unknown-par",
    reason: "Potential administrative return-pick duplicate, but not safe enough from current evidence. Manual review required."
  }
];

const errors = [];
const applied = [];

for (const p of safeSuppressions) {
  const keeper = find(p.keeperSlug);
  const suppress = find(p.suppressSlug);

  if (!keeper) errors.push(`Missing keeper: ${p.keeperSlug}`);
  if (!suppress) errors.push(`Missing suppress target: ${p.suppressSlug}`);

  if (keeper?.suppressed === true) errors.push(`Keeper already suppressed: ${p.keeperSlug}`);
  if (suppress?.suppressed === true) errors.push(`Suppress target already suppressed: ${p.suppressSlug}`);

  if (keeper) {
    const txt = textOf(keeper);
    for (const term of p.requiredKeeperTerms) {
      if (!txt.includes(term.toLowerCase())) {
        errors.push(`Keeper missing required preserved term "${term}" for ${p.label}`);
      }
    }
  }
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors,
    blockedRows
  }, null, 2));

  console.error("");
  console.error("APPLY SAFE UNKNOWN-PARTNER NEAR-DATE V2 BLOCKED");
  console.error("=".repeat(80));
  for (const e of errors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

for (const p of safeSuppressions) {
  const keeper = find(p.keeperSlug);
  const suppress = find(p.suppressSlug);

  const beforeSuppress = JSON.parse(JSON.stringify(suppress));
  const beforeKeeper = JSON.parse(JSON.stringify(keeper));

  suppress.suppressed = true;
  suppress.qaNotes = suppress.qaNotes
    ? `${suppress.qaNotes} Suppressed as safe unknown-partner near-date duplicate; canonical keeper is ${p.keeperSlug}. ${p.reason}`
    : `Suppressed as safe unknown-partner near-date duplicate; canonical keeper is ${p.keeperSlug}. ${p.reason}`;
  suppress.updatedAt = new Date().toISOString();

  keeper.qaNotes = keeper.qaNotes
    ? `${keeper.qaNotes} Retained as canonical keeper for safe unknown-partner near-date duplicate ${p.suppressSlug}.`
    : `Retained as canonical keeper for safe unknown-partner near-date duplicate ${p.suppressSlug}.`;
  keeper.updatedAt = new Date().toISOString();

  applied.push({
    label: p.label,
    reason: p.reason,
    keeper: {
      before: {
        id: beforeKeeper.id || null,
        slug: slugOf(beforeKeeper),
        tradeDate: dateOf(beforeKeeper),
        publishStatus: beforeKeeper.publishStatus || null,
        suppressed: beforeKeeper.suppressed ?? null
      },
      after: {
        id: keeper.id || null,
        slug: slugOf(keeper),
        tradeDate: dateOf(keeper),
        publishStatus: keeper.publishStatus || null,
        suppressed: keeper.suppressed ?? null
      }
    },
    suppress: {
      before: {
        id: beforeSuppress.id || null,
        slug: slugOf(beforeSuppress),
        tradeDate: dateOf(beforeSuppress),
        publishStatus: beforeSuppress.publishStatus || null,
        suppressed: beforeSuppress.suppressed ?? null
      },
      after: {
        id: suppress.id || null,
        slug: slugOf(suppress),
        tradeDate: dateOf(suppress),
        publishStatus: suppress.publishStatus || null,
        suppressed: suppress.suppressed
      }
    }
  });
}

const postErrors = [];

for (const a of applied) {
  const keeper = find(a.keeper.after.slug);
  const suppress = find(a.suppress.after.slug);

  if (!keeper) postErrors.push(`Keeper missing after apply: ${a.keeper.after.slug}`);
  if (!suppress) postErrors.push(`Suppress missing after apply: ${a.suppress.after.slug}`);
  if (keeper?.suppressed === true) postErrors.push(`Keeper was suppressed: ${a.keeper.after.slug}`);
  if (suppress?.suppressed !== true) postErrors.push(`Suppress target not suppressed: ${a.suppress.after.slug}`);
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  appliedSuppressionCount: applied.length,
  errors: postErrors,
  applied,
  explicitlyBlockedCount: blockedRows.length,
  blockedRows
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (postErrors.length) {
  console.error("");
  console.error("POST-APPLY VALIDATION FAILED. Data was not written.");
  for (const e of postErrors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

fs.writeFileSync(dataPath, JSON.stringify(Array.isArray(raw) ? trades : raw, null, 2) + "\n");

console.log("");
console.log("APPLY SAFE UNKNOWN-PARTNER NEAR-DATE V2");
console.log("=".repeat(80));
console.log(`Applied suppressions: ${applied.length}`);
console.log(`Explicitly blocked/documented: ${blockedRows.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("SUPPRESSED:");
for (const a of applied) {
  console.log(`- ${a.suppress.after.slug} | ${a.suppress.after.id} -> keeper ${a.keeper.after.slug}`);
}

console.log("");
console.log("BLOCKED / KEPT FOR TOMORROW:");
for (const b of blockedRows) {
  console.log(`- ${b.bucket}: ${b.suppressSlug}`);
  console.log(`  reason: ${b.reason}`);
}
