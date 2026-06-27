const fs = require("fs");
const path = require("path");

const reportPath = path.join(process.cwd(), "audits", "audit-fast-player-duplicate-pages.json");
const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "suppress-strict-player-duplicate-pages-dry-run.json");

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function sorted(x) {
  return [...(x || [])].sort();
}

function sameSet(a, b) {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function badTeamSet(teams) {
  return (teams || []).some(t =>
    String(t || "").includes("unknown") ||
    String(t || "").includes("not-specified") ||
    String(t || "").includes("mutually") ||
    String(t || "").includes("cancelled")
  );
}

function subset(a, b) {
  const B = new Set(b || []);
  return (a || []).every(x => B.has(x));
}

function pickSafeToSuppress(suppressRow, keeperRow) {
  const suppressSigs = suppressRow.pickSigs || [];
  const keeperSigs = keeperRow.pickSigs || [];

  if (suppressSigs.length === 0) return true;
  return subset(suppressSigs, keeperSigs);
}

function rowScore(row) {
  const playerScore = (row.players || []).length * 10;
  const pickScore = (row.pickSigs || []).length * 4;
  const teamScore = Object.keys(row.assetsReceived || {}).length * 3;
  const summaryScore = String(row.summary || "").length / 80;
  const readyScore = row.publishStatus === "ready" ? 2 : 0;
  return playerScore + pickScore + teamScore + summaryScore + readyScore;
}

function compact(row) {
  return {
    slug: row.slug,
    id: row.id,
    tradeDate: row.tradeDate,
    teams: row.teams || [],
    publishStatus: row.publishStatus || null,
    suppressed: row.suppressed ?? null,
    players: row.players || [],
    pickSigs: row.pickSigs || [],
    summary: row.summary || null,
    assetsReceived: row.assetsReceived || null
  };
}

const plannedBySuppressSlug = new Map();
const conflicts = [];
const blocked = [];
const review = [];

for (const c of report.candidates || []) {
  const a = c.a;
  const b = c.b;

  if (!a || !b) continue;

  const exactDate = !!c.exactDate;
  const exactTeams = sameSet(a.teams, b.teams);
  const playerOverlap = c.playerOverlap || [];
  const teams = a.teams || b.teams || [];

  const keeperSlug = c.recommendedKeeper?.slug;
  const suppressSlug = c.recommendedSuppress?.slug;

  if (!keeperSlug || !suppressSlug) continue;

  const keeperRow = keeperSlug === a.slug ? a : b;
  const suppressRow = suppressSlug === a.slug ? a : b;

  const basicSafe =
    exactDate &&
    exactTeams &&
    playerOverlap.length >= 2 &&
    !badTeamSet(teams) &&
    pickSafeToSuppress(suppressRow, keeperRow);

  const basicBlocked =
    exactDate &&
    exactTeams &&
    playerOverlap.length >= 2 &&
    !basicSafe;

  const isKnownMcGill =
    a.slug.includes("mike-mcgill") ||
    b.slug.includes("mike-mcgill") ||
    a.slug.includes("jim-tolbert") ||
    b.slug.includes("jim-tolbert");

  if (basicSafe || isKnownMcGill) {
    const keepTrade = find(keeperSlug);
    const suppressTrade = find(suppressSlug);

    const row = {
      classification: c.classification,
      confidence: c.confidence,
      knownMatch: c.knownMatch || isKnownMcGill,
      reason: isKnownMcGill
        ? "Known McGill/Tolbert duplicate: same date, same teams, same transaction; suppress thinner Mike McGill/player-slug duplicate."
        : "Strict player duplicate: exact date, exact teams, overlapping player set, and suppress row has no unique pick-signature coverage.",
      dateGapDays: c.dateGapDays,
      playerOverlap,
      teamSet: sorted(a.teams),
      keeper: compact(keeperRow),
      suppress: compact(suppressRow),
      keeperExists: !!keepTrade,
      suppressExists: !!suppressTrade
    };

    if (plannedBySuppressSlug.has(suppressSlug)) {
      const existing = plannedBySuppressSlug.get(suppressSlug);
      if (existing.keeper.slug !== keeperSlug) {
        conflicts.push({
          suppressSlug,
          existingKeeper: existing.keeper.slug,
          newKeeper: keeperSlug,
          row
        });
      }
    } else {
      plannedBySuppressSlug.set(suppressSlug, row);
    }
  } else if (basicBlocked) {
    blocked.push({
      reason: badTeamSet(teams)
        ? "Bad/unknown team key in exact-team duplicate candidate."
        : "Suppress row may have unique pick-signature coverage or failed strict safety gate.",
      classification: c.classification,
      confidence: c.confidence,
      dateGapDays: c.dateGapDays,
      playerOverlap,
      teamSet: sorted(a.teams),
      recommendedKeeper: c.recommendedKeeper,
      recommendedSuppress: c.recommendedSuppress,
      a: compact(a),
      b: compact(b)
    });
  } else if (c.confidence === "high" || c.confidence === "known") {
    review.push({
      reason: "Not in strict apply lane, usually because team sets differ, player overlap is noisy, or this is a pick-chain overlap rather than a true duplicate page.",
      classification: c.classification,
      confidence: c.confidence,
      exactDate,
      exactTeams,
      dateGapDays: c.dateGapDays,
      playerOverlap,
      teamOverlap: c.teamOverlap || [],
      recommendedKeeper: c.recommendedKeeper,
      recommendedSuppress: c.recommendedSuppress,
      a: compact(a),
      b: compact(b)
    });
  }
}

const planned = [...plannedBySuppressSlug.values()].sort((x, y) => {
  if ((y.knownMatch ? 1 : 0) !== (x.knownMatch ? 1 : 0)) return (y.knownMatch ? 1 : 0) - (x.knownMatch ? 1 : 0);
  return x.suppress.tradeDate.localeCompare(y.suppress.tradeDate);
});

const errors = [];

for (const p of planned) {
  if (!p.keeperExists) errors.push(`Missing keeper trade: ${p.keeper.slug}`);
  if (!p.suppressExists) errors.push(`Missing suppress trade: ${p.suppress.slug}`);

  const st = find(p.suppress.slug);
  if (st && st.suppressed === true) errors.push(`Suppress target already suppressed: ${p.suppress.slug}`);

  const kt = find(p.keeper.slug);
  if (kt && kt.suppressed === true) errors.push(`Keeper already suppressed: ${p.keeper.slug}`);
}

if (conflicts.length) {
  errors.push(`Conflicting keeper recommendations for ${conflicts.length} suppress targets.`);
}

const output = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  sourceReport: reportPath,
  plannedSuppressionCount: planned.length,
  conflictCount: conflicts.length,
  blockedCount: blocked.length,
  reviewCount: review.length,
  errorCount: errors.length,
  errors,
  plannedSuppressions: planned,
  conflicts,
  blocked,
  review
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log("");
console.log("SUPPRESS STRICT PLAYER DUPLICATE PAGES DRY RUN");
console.log("=".repeat(80));
console.log(`planned suppressions: ${planned.length}`);
console.log(`conflicts: ${conflicts.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`review: ${review.length}`);
console.log(`errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

if (errors.length) {
  console.log("");
  console.log("Errors:");
  for (const e of errors) console.log(`- ${e}`);
}

console.log("");
console.log("Planned suppressions:");
for (const p of planned.slice(0, 80)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${p.knownMatch ? "KNOWN/SAFE" : "SAFE"} | ${p.reason}`);
  console.log(`date=${p.suppress.tradeDate} | teams=${JSON.stringify(p.teamSet)} | players=${JSON.stringify(p.playerOverlap)}`);
  console.log(`KEEP:     ${p.keeper.slug} | ${p.keeper.id} | status=${p.keeper.publishStatus}`);
  console.log(`SUPPRESS: ${p.suppress.slug} | ${p.suppress.id} | status=${p.suppress.publishStatus}`);
  console.log(`suppressPickSigs=${JSON.stringify(p.suppress.pickSigs)} keeperPickSigs=${JSON.stringify(p.keeper.pickSigs)}`);
}

console.log("");
console.log("Review sample:");
for (const r of review.slice(0, 30)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`${r.classification} | ${r.reason}`);
  console.log(`exactDate=${r.exactDate} exactTeams=${r.exactTeams} teamOverlap=${JSON.stringify(r.teamOverlap)} players=${JSON.stringify(r.playerOverlap)}`);
  console.log(`KEEP? ${r.recommendedKeeper?.slug} | ${r.recommendedKeeper?.id}`);
  console.log(`SUPPRESS? ${r.recommendedSuppress?.slug} | ${r.recommendedSuppress?.id}`);
}
