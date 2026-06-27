const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const dupPath = path.join(process.cwd(), "audits", "trade-page-duplicate-candidates.json");
const outPath = path.join(process.cwd(), "audits", "safe-duplicate-page-suppression-dry-run.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing data file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(dupPath)) {
  console.error(`Missing duplicate candidate report: ${dupPath}`);
  process.exit(1);
}

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const dupReport = JSON.parse(fs.readFileSync(dupPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || t.transactionDate || null;
}

function keysOf(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/houston oilers\/tennessee titans/g, "tennessee titans")
    .replace(/los angeles\/cleveland\/st\.? louis rams/g, "los angeles rams")
    .replace(/arizona\/st\.? louis cardinals/g, "arizona cardinals")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeam(team) {
  return normalizeText(team);
}

function assetRows(t) {
  const rows = [];

  for (const team of keysOf(t.assetsReceived)) {
    const assets = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];

    assets.forEach((item, index) => {
      rows.push({
        team,
        index,
        type: item && item.type ? item.type : null,
        asset: item && item.asset ? item.asset : ""
      });
    });
  }

  return rows;
}

function pickKeys(asset) {
  const text = String(asset || "");
  const keys = [];

  const rx1 = /\b((?:19|20)\d{2})\s+(\d+)(?:st|nd|rd|th)?\s+round pick\s*\((\d+)(?:st|nd|rd|th)?\s+overall/gi;
  let m;

  while ((m = rx1.exec(text))) {
    keys.push(`PICK:${m[1]}-${Number(m[2])}-${Number(m[3])}`);
  }

  const wordToRound = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12
  };

  const rx2 = /\b((?:19|20)\d{2})\s+([a-z]+)\s+round pick\s*\(#(\d+)/gi;

  while ((m = rx2.exec(text))) {
    const round = wordToRound[String(m[2]).toLowerCase()];
    if (round) keys.push(`PICK:${m[1]}-${round}-${Number(m[3])}`);
  }

  return [...new Set(keys)];
}

function assetSignaturesFromRows(rows) {
  const sigs = [];

  for (const row of rows) {
    const n = normalizeText(row.asset);

    if (!n) continue;

    if (
      n === "cash" ||
      n === "1 cash" ||
      n === "draft pick" ||
      n === "undisclosed draft pick" ||
      n === "past considerations" ||
      n.includes("details unavailable from source data") ||
      n.includes("unavailable from source data")
    ) {
      continue;
    }

    const picks = pickKeys(row.asset);
    if (picks.length) {
      for (const key of picks) sigs.push(key);
    } else if (n.length >= 8) {
      sigs.push(`ASSET:${n}`);
    }
  }

  return [...new Set(sigs)].sort();
}

function teamsOf(t) {
  return Array.isArray(t.teams) ? t.teams.map(normalizeTeam).filter(Boolean).sort() : [];
}

function setEq(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

function isSubset(sub, sup) {
  const supSet = new Set(sup);
  return sub.every(x => supSet.has(x));
}

function uglySlugScore(slug) {
  let score = 0;
  if (/review-needed/.test(slug)) score += 8;
  if (/unknown|undisclosed|unspecified/.test(slug)) score += 5;
  if (/cash|past-considerations/.test(slug)) score += 4;
  if (/subsequently-traded|draft-pick-trade/.test(slug)) score += 2;
  if (/reviewed-and-retained/.test(slug)) score += 8;
  return score;
}

function completenessScore(t) {
  let score = 0;

  if (t.publishStatus === "publish") score += 20;
  if (t.publishStatus === "ready") score += 12;
  if (t.publishStatus === "provisional") score += 3;
  if (t.publishStatus === "hold-conflict") score -= 10;

  const rows = assetRows(t);
  const sigs = assetSignaturesFromRows(rows);

  score += Math.min(rows.length, 12);
  score += sigs.length * 2;

  const emptyTeamArrays = keysOf(t.assetsReceived).filter(team => {
    const arr = t.assetsReceived[team];
    return Array.isArray(arr) && arr.length === 0;
  }).length;

  score -= emptyTeamArrays * 8;

  for (const row of rows) {
    const asset = String(row.asset || "");

    if (asset.includes("unavailable from source data")) score -= 2;
    if (/REVIEW NEEDED/i.test(asset)) score -= 10;
    if (asset.includes("...")) score -= 20;
  }

  if (t.summary) score += 2;
  if (t.partnerSummary) score += 1;
  if (Array.isArray(t.perspectives) && t.perspectives.length) score += 2;

  score -= uglySlugScore(slugOf(t));

  return score;
}

function compact(t) {
  const rows = assetRows(t);
  const sigs = assetSignaturesFromRows(rows);

  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed === true,
    teams: t.teams || null,
    normalizedTeams: teamsOf(t),
    assetKeys: keysOf(t.assetsReceived).sort(),
    assetCount: rows.length,
    signatureCount: sigs.length,
    signatures: sigs,
    completenessScore: completenessScore(t),
    uglySlugScore: uglySlugScore(slugOf(t)),
    emptyTeamArrays: keysOf(t.assetsReceived).filter(team => {
      const arr = t.assetsReceived[team];
      return Array.isArray(arr) && arr.length === 0;
    }),
    verdict: t.verdict || null,
    grades: t.grades || null,
    qaNotes: t.qaNotes || null,
    summary: t.summary || null,
    assetsReceived: t.assetsReceived || null
  };
}

function chooseKeeper(a, b) {
  const aSigs = assetSignaturesFromRows(assetRows(a));
  const bSigs = assetSignaturesFromRows(assetRows(b));

  const aCoveredByB = isSubset(aSigs, bSigs);
  const bCoveredByA = isSubset(bSigs, aSigs);

  const aScore = completenessScore(a);
  const bScore = completenessScore(b);

  const aSlug = slugOf(a);
  const bSlug = slugOf(b);

  if (aCoveredByB && !bCoveredByA) {
    return {
      keeper: b,
      suppress: a,
      reason: "A signatures are fully covered by B; B has additional non-generic signatures"
    };
  }

  if (bCoveredByA && !aCoveredByB) {
    return {
      keeper: a,
      suppress: b,
      reason: "B signatures are fully covered by A; A has additional non-generic signatures"
    };
  }

  if (aCoveredByB && bCoveredByA) {
    if (a.publishStatus === "publish" && b.publishStatus !== "publish") {
      return {
        keeper: a,
        suppress: b,
        reason: "same signature set; A is publish"
      };
    }

    if (b.publishStatus === "publish" && a.publishStatus !== "publish") {
      return {
        keeper: b,
        suppress: a,
        reason: "same signature set; B is publish"
      };
    }

    if (aScore !== bScore) {
      return {
        keeper: aScore > bScore ? a : b,
        suppress: aScore > bScore ? b : a,
        reason: `same signature set; completeness score favors ${aScore > bScore ? aSlug : bSlug}`
      };
    }
  }

  return null;
}

const slugToTrade = new Map(trades.map(t => [slugOf(t), t]));

const rawPlans = [];
const blocked = [];

for (const row of dupReport.rows || []) {
  const a = slugToTrade.get(row.a.slug);
  const b = slugToTrade.get(row.b.slug);

  if (!a || !b) continue;
  if (a.suppressed === true || b.suppressed === true) continue;

  const sameDate = dateOf(a) && dateOf(a) === dateOf(b);
  const sameTeamSet = setEq(teamsOf(a), teamsOf(b));

  if (!sameDate || !sameTeamSet) continue;
  if ((row.sharedSignatureCount || 0) < 4) continue;

  const choice = chooseKeeper(a, b);

  if (!choice) {
    blocked.push({
      reason: "No safe subset/same-signature coverage direction",
      score: row.score,
      sharedSignatureCount: row.sharedSignatureCount,
      a: compact(a),
      b: compact(b)
    });
    continue;
  }

  const keeper = choice.keeper;
  const suppress = choice.suppress;

  // Extra guard: do not suppress a publish page unless keeper is also publish.
  if (suppress.publishStatus === "publish" && keeper.publishStatus !== "publish") {
    blocked.push({
      reason: "Would suppress publish page without publish keeper",
      score: row.score,
      sharedSignatureCount: row.sharedSignatureCount,
      keeper: compact(keeper),
      suppress: compact(suppress)
    });
    continue;
  }

  rawPlans.push({
    score: row.score,
    sharedSignatureCount: row.sharedSignatureCount,
    sharedSignatures: row.sharedSignatures || [],
    sharedTeams: row.sharedTeams || [],
    reason: choice.reason,
    keeper: compact(keeper),
    suppress: compact(suppress)
  });
}

// Deduplicate suppressions and detect conflicts.
const bySuppressSlug = new Map();

for (const plan of rawPlans) {
  const suppressSlug = plan.suppress.slug;

  if (!bySuppressSlug.has(suppressSlug)) {
    bySuppressSlug.set(suppressSlug, []);
  }

  bySuppressSlug.get(suppressSlug).push(plan);
}

const planned = [];
const conflicts = [];

for (const [suppressSlug, plans] of bySuppressSlug.entries()) {
  const keeperSlugs = [...new Set(plans.map(p => p.keeper.slug))];

  if (keeperSlugs.length > 1) {
    conflicts.push({
      suppressSlug,
      keeperSlugs,
      plans
    });
    continue;
  }

  plans.sort((a, b) => b.score - a.score || b.sharedSignatureCount - a.sharedSignatureCount);
  planned.push(plans[0]);
}

planned.sort((a, b) =>
  b.score - a.score ||
  b.sharedSignatureCount - a.sharedSignatureCount ||
  a.suppress.tradeDate.localeCompare(b.suppress.tradeDate)
);

const report = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  dataPath,
  dupPath,
  rawPlanCount: rawPlans.length,
  plannedSuppressionCount: planned.length,
  conflictCount: conflicts.length,
  blockedCount: blocked.length,
  planned,
  conflicts,
  blocked
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("SAFE DUPLICATE-PAGE SUPPRESSION DRY RUN");
console.log("=".repeat(80));
console.log(`raw safe pair plans: ${rawPlans.length}`);
console.log(`planned unique suppressions: ${planned.length}`);
console.log(`conflicts: ${conflicts.length}`);
console.log(`blocked: ${blocked.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("First 25 planned suppressions:");
for (const plan of planned.slice(0, 25)) {
  console.log("-".repeat(80));
  console.log(`score=${plan.score} sharedSigs=${plan.sharedSignatureCount}`);
  console.log(`KEEP     : ${plan.keeper.slug} | ${plan.keeper.id} | ${plan.keeper.tradeDate} | status=${plan.keeper.publishStatus} | q=${plan.keeper.completenessScore}`);
  console.log(`SUPPRESS : ${plan.suppress.slug} | ${plan.suppress.id} | ${plan.suppress.tradeDate} | status=${plan.suppress.publishStatus} | q=${plan.suppress.completenessScore}`);
  console.log(`reason=${plan.reason}`);
  console.log(`suppress emptyTeamArrays=${JSON.stringify(plan.suppress.emptyTeamArrays)}`);
}

if (conflicts.length) {
  console.log("");
  console.log("First 5 conflicts:");
  for (const c of conflicts.slice(0, 5)) {
    console.log("-".repeat(80));
    console.log(`suppressSlug=${c.suppressSlug}`);
    console.log(`keeperSlugs=${JSON.stringify(c.keeperSlugs)}`);
  }
}

if (blocked.length) {
  console.log("");
  console.log("First 10 blocked examples:");
  for (const b of blocked.slice(0, 10)) {
    console.log("-".repeat(80));
    console.log(`reason=${b.reason}`);
    if (b.a && b.b) {
      console.log(`A=${b.a.slug} | ${b.a.id} | q=${b.a.completenessScore} | sigs=${b.a.signatureCount}`);
      console.log(`B=${b.b.slug} | ${b.b.id} | q=${b.b.completenessScore} | sigs=${b.b.signatureCount}`);
    } else {
      console.log(`keeper=${b.keeper.slug}`);
      console.log(`suppress=${b.suppress.slug}`);
    }
  }
}
