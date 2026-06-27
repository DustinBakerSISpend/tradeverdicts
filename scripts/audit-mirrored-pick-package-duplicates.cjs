const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "mirrored-pick-package-duplicate-audit.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const knownSlugs = [
  "2019-2nd-round-pick-61st-overall-taylor-rapp-and-2019-5th-round-pick-167th-overa",
  "2019-2nd-round-pick-56th-overall-los-angeles-st-louis-rams-2019"
];

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ordinalRoundToNum(s) {
  const x = String(s || "").toLowerCase();
  const map = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
    eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12
  };
  if (map[x]) return map[x];
  const m = x.match(/\d+/);
  return m ? Number(m[0]) : null;
}

function splitAssetText(asset) {
  return String(asset || "")
    .replace(/\band\s+(?=\d{4}\s+\d)/gi, "|||")
    .replace(/,\s*(?=\d{4}\s+\d)/g, "|||")
    .replace(/;\s*(?=\d{4}\s+\d)/g, "|||")
    .split("|||")
    .map(s => s.trim())
    .filter(Boolean);
}

function pickSigsFromAsset(asset) {
  const chunks = splitAssetText(asset);
  const sigs = [];

  for (const chunk of chunks) {
    const text = norm(chunk);

    const y = text.match(/\b(19|20)\d{2}\b/);
    const round = text.match(/\b(1st|2nd|3rd|[4-9]th|10th|11th|12th|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+round\b/);
    const overall = text.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/);

    if (y && round && overall) {
      sigs.push(`${y[0]}-R${ordinalRoundToNum(round[1])}-P${Number(overall[1])}`);
      continue;
    }

    if (y && round) {
      sigs.push(`${y[0]}-R${ordinalRoundToNum(round[1])}-P?-${text}`);
      continue;
    }

    if (/draft pick|round pick/.test(text)) {
      sigs.push(`GENERIC-PICK-${text}`);
    }
  }

  return sigs;
}

function allPickSigs(t) {
  const sigs = [];

  for (const [team, assets] of Object.entries(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;

    for (const item of assets) {
      const asset = String(item.asset || "");
      if (item.type === "pick" || /round pick|draft pick|overall/.test(asset.toLowerCase())) {
        for (const sig of pickSigsFromAsset(asset)) {
          sigs.push(sig);
        }
      }
    }
  }

  return [...new Set(sigs)].sort();
}

function teamKey(t) {
  return [...new Set(t.teams || Object.keys(t.assetsReceived || {}))].sort().join("|");
}

function active(t) {
  return t && t.suppressed !== true;
}

function hasBothSides(t) {
  const teams = t.teams || [];
  const ar = t.assetsReceived || {};
  return teams.length === 2 && teams.every(team => Array.isArray(ar[team]) && ar[team].length > 0);
}

function summaryScore(t) {
  const s = String(t.summary || "");
  let score = s.length;
  if (/\.\s+[A-Z]/.test(s)) score += 100;
  if (/from .* for /i.test(s)) score += 100;
  if (/\bf\.?$/i.test(s.trim())) score -= 500;
  if (s.includes("...")) score -= 500;
  if (/unknown|undisclosed|review needed/i.test(s)) score -= 25;
  return score;
}

function keeperPick(group) {
  return [...group].sort((a, b) => {
    const sideDiff = Number(hasBothSides(b)) - Number(hasBothSides(a));
    if (sideDiff) return sideDiff;

    const scoreDiff = summaryScore(b) - summaryScore(a);
    if (scoreDiff) return scoreDiff;

    return slugOf(a).localeCompare(slugOf(b));
  })[0];
}

const activeTrades = trades.filter(active);

const exactGroups = new Map();

for (const t of activeTrades) {
  const sigs = allPickSigs(t);
  if (sigs.length < 2) continue;

  const key = [
    dateOf(t),
    teamKey(t),
    sigs.join("|")
  ].join("::");

  if (!exactGroups.has(key)) exactGroups.set(key, []);
  exactGroups.get(key).push(t);
}

const exactDuplicateGroups = [];

for (const [key, group] of exactGroups.entries()) {
  if (group.length < 2) continue;

  const keeper = keeperPick(group);

  exactDuplicateGroups.push({
    key,
    type: "exact-same-date-teams-pick-package",
    count: group.length,
    keeperSuggestion: slugOf(keeper),
    date: dateOf(keeper),
    teams: teamKey(keeper).split("|"),
    pickSigs: allPickSigs(keeper),
    trades: group.map(t => ({
      id: t.id || null,
      slug: slugOf(t),
      tradeDate: dateOf(t),
      publishStatus: t.publishStatus || null,
      suppressed: t.suppressed ?? null,
      teams: t.teams || null,
      pickSigs: allPickSigs(t),
      hasBothSides: hasBothSides(t),
      summaryScore: summaryScore(t),
      summary: t.summary || null,
      assetsReceived: t.assetsReceived || null
    }))
  });
}

const knownPair = knownSlugs.map(slug => {
  const t = trades.find(x => slugOf(x) === slug);
  return t ? {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: dateOf(t),
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    teams: t.teams || null,
    teamKey: teamKey(t),
    pickSigs: allPickSigs(t),
    hasBothSides: hasBothSides(t),
    summaryScore: summaryScore(t),
    summary: t.summary || null,
    assetsReceived: t.assetsReceived || null
  } : {
    slug,
    error: "not found"
  };
});

const knownGroupKey = knownPair.every(x => !x.error)
  ? [knownPair[0].tradeDate, knownPair[0].teamKey, knownPair[0].pickSigs.join("|")].join("::")
  : null;

const knownMatchedGroup = exactDuplicateGroups.find(g => g.key === knownGroupKey) || null;

exactDuplicateGroups.sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  activeTradesScanned: activeTrades.length,
  exactDuplicateGroupCount: exactDuplicateGroups.length,
  exactDuplicateTradeCount: exactDuplicateGroups.reduce((sum, g) => sum + g.count, 0),
  knownPair,
  knownGroupKey,
  knownMatchedGroup,
  exactDuplicateGroups
}, null, 2));

console.log("");
console.log("MIRRORED PICK-PACKAGE DUPLICATE AUDIT");
console.log("=".repeat(80));
console.log(`active trades scanned: ${activeTrades.length}`);
console.log(`exact duplicate groups: ${exactDuplicateGroups.length}`);
console.log(`exact duplicate trades inside groups: ${exactDuplicateGroups.reduce((sum, g) => sum + g.count, 0)}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Known Rams example:");
for (const row of knownPair) {
  console.log("-".repeat(80));
  if (row.error) {
    console.log(`${row.slug}: ${row.error}`);
    continue;
  }
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate} | status=${row.publishStatus} | suppressed=${row.suppressed}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log(`pickSigs=${JSON.stringify(row.pickSigs)}`);
  console.log(`hasBothSides=${row.hasBothSides} summaryScore=${row.summaryScore}`);
  console.log("summary:");
  console.log(row.summary || "(none)");
}

console.log("");
console.log("Known matched group:");
if (!knownMatchedGroup) {
  console.log("(not found as exact group — will need containment/lower-threshold audit)");
} else {
  console.log(`keeperSuggestion=${knownMatchedGroup.keeperSuggestion}`);
  console.log(`group count=${knownMatchedGroup.count}`);
  for (const t of knownMatchedGroup.trades) {
    console.log(`- ${t.slug} | ${t.id} | ${t.tradeDate} | score=${t.summaryScore}`);
  }
}

console.log("");
console.log("First 25 exact duplicate groups:");
for (const g of exactDuplicateGroups.slice(0, 25)) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`date=${g.date} teams=${JSON.stringify(g.teams)} count=${g.count}`);
  console.log(`keeperSuggestion=${g.keeperSuggestion}`);
  console.log(`pickSigs=${JSON.stringify(g.pickSigs)}`);
  for (const t of g.trades) {
    console.log(`- ${t.slug} | ${t.id} | status=${t.publishStatus} | bothSides=${t.hasBothSides} | score=${t.summaryScore}`);
  }
}
