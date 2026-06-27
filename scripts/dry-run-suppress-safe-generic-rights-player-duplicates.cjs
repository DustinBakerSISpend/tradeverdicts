const fs = require("fs");
const path = require("path");

const auditPath = path.join(process.cwd(), "audits", "audit-fast-generic-rights-player-duplicates.json");
const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "suppress-safe-generic-rights-player-duplicates-dry-run.json");

const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
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

function badSuppressStatus(status) {
  return status === "hold-conflict" || status === "provisional" || status === "ready" || status === "publish";
}

function saferKeeperStatus(status) {
  return status === "ready" || status === "publish";
}

function hasUnknownBadTeam(teams) {
  return (teams || []).some(t => String(t || "").includes("unknown") || String(t || "").includes("not-specified"));
}

function isBillMathisAlreadyResolvedPair(c) {
  const slugs = [c.generic?.slug, c.concrete?.slug].filter(Boolean);
  return slugs.includes("future-draft-rights-rights-to-undisclosed-player-new-york-titans-jets") ||
         slugs.includes("bill-mathis-houston-oilers-tennessee-titans-1960");
}

function choosePair(c) {
  const g = c.generic;
  const k = c.concrete;

  // Normal case: generic row is suppress, concrete row is keeper.
  let keeper = k;
  let suppress = g;

  // Reciprocal generic/generic case: keep the better page and suppress the more generic/lower-score row.
  if ((g.concretePlayers || []).length > 0 && (k.concretePlayers || []).length > 0) {
    const gStrength = g.genericStrength || 0;
    const kStrength = k.genericStrength || 0;
    const gScore = g.score || 0;
    const kScore = k.score || 0;

    if (gStrength < kStrength) {
      keeper = g;
      suppress = k;
    } else if (kStrength < gStrength) {
      keeper = k;
      suppress = g;
    } else if (gScore >= kScore) {
      keeper = g;
      suppress = k;
    } else {
      keeper = k;
      suppress = g;
    }
  }

  return { keeper, suppress };
}

const plannedMap = new Map();
const blocked = [];
const review = [];

for (const c of audit.candidates || []) {
  if (isBillMathisAlreadyResolvedPair(c)) {
    review.push({
      reason: "Bill Mathis example is already resolved or this is a noisy known-neighbor pair caused by generic-rights language inside the canonical keeper.",
      candidate: c
    });
    continue;
  }

  const exactSafeShape =
    c.sameDate === true &&
    c.exactTeams === true &&
    c.genericPickCovered === true &&
    !hasUnknownBadTeam(c.teamOverlap || []);

  if (!exactSafeShape) {
    review.push({
      reason: "Not exact same date/team or contains unknown-team risk.",
      candidate: c
    });
    continue;
  }

  const { keeper, suppress } = choosePair(c);

  const keeperTrade = find(keeper.slug);
  const suppressTrade = find(suppress.slug);

  const reasons = [];

  if (!keeperTrade) reasons.push(`missing keeper ${keeper.slug}`);
  if (!suppressTrade) reasons.push(`missing suppress ${suppress.slug}`);
  if (keeperTrade?.suppressed === true) reasons.push(`keeper already suppressed ${keeper.slug}`);
  if (suppressTrade?.suppressed === true) reasons.push(`suppress already suppressed ${suppress.slug}`);
  if (!saferKeeperStatus(keeper.publishStatus)) reasons.push(`keeper status ${keeper.publishStatus}`);
  if (!badSuppressStatus(suppress.publishStatus)) reasons.push(`unexpected suppress status ${suppress.publishStatus}`);
  if ((suppress.pickSigs || []).some(sig => !(keeper.pickSigs || []).includes(sig))) reasons.push("suppress row has unique pick signature");

  const row = {
    classification: c.classification,
    confidence: c.confidence,
    reason: "Safe generic-rights duplicate: exact same date/team set, suppress row is generic/undisclosed-rights version, keeper preserves the concrete player or cleaner asset path.",
    sameDate: c.sameDate,
    exactTeams: c.exactTeams,
    teamSet: sorted(c.teamOverlap || keeper.teams || suppress.teams || []),
    keeper,
    suppress,
    keeperExists: !!keeperTrade,
    suppressExists: !!suppressTrade
  };

  if (reasons.length) {
    blocked.push({ ...row, blockedReasons: reasons });
    continue;
  }

  if (!plannedMap.has(suppress.slug)) {
    plannedMap.set(suppress.slug, row);
  } else {
    const existing = plannedMap.get(suppress.slug);
    if (existing.keeper.slug !== keeper.slug) {
      blocked.push({
        ...row,
        blockedReasons: [`conflicting keeper: existing=${existing.keeper.slug} new=${keeper.slug}`]
      });
    }
  }
}

const planned = [...plannedMap.values()].sort((a, b) => String(a.suppress.tradeDate).localeCompare(String(b.suppress.tradeDate)));

const errors = [];

for (const p of planned) {
  if (!p.keeperExists) errors.push(`Missing keeper: ${p.keeper.slug}`);
  if (!p.suppressExists) errors.push(`Missing suppress target: ${p.suppress.slug}`);
}

const output = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  sourceAudit: auditPath,
  plannedSuppressionCount: planned.length,
  blockedCount: blocked.length,
  reviewCount: review.length,
  errorCount: errors.length,
  errors,
  plannedSuppressions: planned,
  blocked,
  review
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log("");
console.log("SUPPRESS SAFE GENERIC-RIGHTS PLAYER DUPLICATES DRY RUN");
console.log("=".repeat(80));
console.log(`planned suppressions: ${planned.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`review: ${review.length}`);
console.log(`errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

for (const e of errors) console.log(`ERROR: ${e}`);

console.log("");
console.log("Planned suppressions:");
for (const p of planned) {
  console.log("");
  console.log("-".repeat(80));
  console.log(p.reason);
  console.log(`date=${p.suppress.tradeDate} | teams=${JSON.stringify(p.teamSet)}`);
  console.log(`KEEP:     ${p.keeper.slug} | ${p.keeper.id} | status=${p.keeper.publishStatus} | strength=${p.keeper.genericStrength} | players=${JSON.stringify(p.keeper.concretePlayers)} | picks=${JSON.stringify(p.keeper.pickSigs)} | score=${p.keeper.score}`);
  console.log(`SUPPRESS: ${p.suppress.slug} | ${p.suppress.id} | status=${p.suppress.publishStatus} | strength=${p.suppress.genericStrength} | players=${JSON.stringify(p.suppress.concretePlayers)} | picks=${JSON.stringify(p.suppress.pickSigs)} | score=${p.suppress.score}`);
}

console.log("");
console.log("Blocked sample:");
for (const b of blocked.slice(0, 30)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`BLOCKED: ${b.blockedReasons.join("; ")}`);
  console.log(`KEEP:     ${b.keeper.slug} | ${b.keeper.id} | status=${b.keeper.publishStatus}`);
  console.log(`SUPPRESS: ${b.suppress.slug} | ${b.suppress.id} | status=${b.suppress.publishStatus}`);
}

console.log("");
console.log("Review sample:");
for (const r of review.slice(0, 20)) {
  const c = r.candidate;
  console.log("");
  console.log("-".repeat(80));
  console.log(`REVIEW: ${r.reason}`);
  console.log(`GENERIC:  ${c.generic?.slug} | ${c.generic?.id} | ${c.generic?.tradeDate}`);
  console.log(`CONCRETE: ${c.concrete?.slug} | ${c.concrete?.id} | ${c.concrete?.tradeDate}`);
}
