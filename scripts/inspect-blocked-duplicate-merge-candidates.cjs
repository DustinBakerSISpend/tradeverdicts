const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const planPath = path.join(process.cwd(), "audits", "safe-duplicate-page-suppression-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "blocked-duplicate-merge-inspection.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing data file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(planPath)) {
  console.error(`Missing dry-run plan: ${planPath}`);
  process.exit(1);
}

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

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

function sigsForAsset(asset) {
  const n = normalizeText(asset);

  if (!n) return [];

  if (
    n === "cash" ||
    n === "1 cash" ||
    n === "draft pick" ||
    n === "undisclosed draft pick" ||
    n === "past considerations" ||
    n.includes("details unavailable from source data") ||
    n.includes("unavailable from source data")
  ) {
    return [];
  }

  const picks = pickKeys(asset);
  if (picks.length) return picks;

  if (n.length >= 8) return [`ASSET:${n}`];

  return [];
}

function sigRows(t) {
  const rows = [];

  for (const row of assetRows(t)) {
    for (const sig of sigsForAsset(row.asset)) {
      rows.push({
        sig,
        team: row.team,
        index: row.index,
        type: row.type,
        asset: row.asset
      });
    }
  }

  return rows;
}

function uniqueBySig(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!map.has(row.sig)) map.set(row.sig, row);
  }

  return [...map.values()].sort((a, b) => a.sig.localeCompare(b.sig));
}

function compact(t) {
  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed === true,
    teams: t.teams || null,
    assetKeys: keysOf(t.assetsReceived).sort(),
    verdict: t.verdict || null,
    grades: t.grades || null,
    qaNotes: t.qaNotes || null,
    summary: t.summary || null,
    partnerSummary: t.partnerSummary || null,
    assetsReceived: t.assetsReceived || null
  };
}

function recommend(blocked, a, b, onlyA, onlyB, shared) {
  const reasons = [];
  let recommendation = "manual-inspect";

  const aBadStatus = a.publishStatus === "hold-conflict" || /unspecified|undisclosed|review-needed|cash/.test(slugOf(a));
  const bBadStatus = b.publishStatus === "hold-conflict" || /unspecified|undisclosed|review-needed|cash/.test(slugOf(b));

  if (onlyA.length && onlyB.length) {
    reasons.push("both pages have unique non-generic signatures");
  }

  if (aBadStatus && !bBadStatus) {
    recommendation = "possible-merge-A-unique-into-B-then-suppress-A";
    reasons.push("A looks weaker by status/slug pattern");
  } else if (bBadStatus && !aBadStatus) {
    recommendation = "possible-merge-B-unique-into-A-then-suppress-B";
    reasons.push("B looks weaker by status/slug pattern");
  } else if (a.publishStatus === "publish" && b.publishStatus !== "publish") {
    recommendation = "possible-merge-B-unique-into-A-then-suppress-B";
    reasons.push("A is publish and B is not");
  } else if (b.publishStatus === "publish" && a.publishStatus !== "publish") {
    recommendation = "possible-merge-A-unique-into-B-then-suppress-A";
    reasons.push("B is publish and A is not");
  } else {
    recommendation = "manual-compare-assets-no-auto-merge";
    reasons.push("no clear weak page by status/slug");
  }

  if (shared.length >= 4) {
    reasons.push("heavy shared-signature overlap confirms this is worth resolving");
  }

  return {
    recommendation,
    reasons
  };
}

const slugToTrade = new Map(trades.map(t => [slugOf(t), t]));

const rows = [];

for (const blocked of plan.blocked || []) {
  const aSlug = blocked.a && blocked.a.slug;
  const bSlug = blocked.b && blocked.b.slug;

  const a = slugToTrade.get(aSlug);
  const b = slugToTrade.get(bSlug);

  if (!a || !b) continue;

  const aSigRows = uniqueBySig(sigRows(a));
  const bSigRows = uniqueBySig(sigRows(b));

  const aSigSet = new Set(aSigRows.map(r => r.sig));
  const bSigSet = new Set(bSigRows.map(r => r.sig));

  const shared = aSigRows.filter(r => bSigSet.has(r.sig));
  const onlyA = aSigRows.filter(r => !bSigSet.has(r.sig));
  const onlyB = bSigRows.filter(r => !aSigSet.has(r.sig));

  rows.push({
    originalBlockedReason: blocked.reason,
    score: blocked.score || null,
    sharedSignatureCount: shared.length,
    onlyACount: onlyA.length,
    onlyBCount: onlyB.length,
    recommendation: recommend(blocked, a, b, onlyA, onlyB, shared),
    a: compact(a),
    b: compact(b),
    shared,
    onlyA,
    onlyB
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  planPath,
  inspectedBlockedPairCount: rows.length,
  rows
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("BLOCKED DUPLICATE MERGE/SPLIT INSPECTION");
console.log("=".repeat(80));
console.log(`Inspected blocked pairs: ${rows.length}`);
console.log(`Report: ${outPath}`);

for (const row of rows) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`score=${row.score} shared=${row.sharedSignatureCount} onlyA=${row.onlyACount} onlyB=${row.onlyBCount}`);
  console.log(`A: ${row.a.slug} | ${row.a.id} | ${row.a.tradeDate} | status=${row.a.publishStatus}`);
  console.log(`B: ${row.b.slug} | ${row.b.id} | ${row.b.tradeDate} | status=${row.b.publishStatus}`);
  console.log(`recommendation=${row.recommendation.recommendation}`);
  console.log(`reasons=${row.recommendation.reasons.join("; ")}`);

  console.log("");
  console.log("A-only signatures/assets:");
  for (const item of row.onlyA.slice(0, 12)) {
    console.log(`  - ${item.sig} | ${item.team}[${item.index}] | ${item.asset}`);
  }

  console.log("");
  console.log("B-only signatures/assets:");
  for (const item of row.onlyB.slice(0, 12)) {
    console.log(`  - ${item.sig} | ${item.team}[${item.index}] | ${item.asset}`);
  }

  console.log("");
  console.log("Shared signatures:");
  for (const item of row.shared.slice(0, 12)) {
    console.log(`  - ${item.sig}`);
  }
}
