const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "dedupe-report.json");

const HIDDEN_STATUS = "hold-conflict";
const MAX_DATE_DIFF_DAYS = 1;
const MIN_ASSET_OVERLAP = 2;

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeAssetText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/overall/g, "")
    .replace(/subsequently traded/g, "")
    .replace(/became/g, "")
    .replace(/received/g, "")
    .replace(/sent/g, "")
    .replace(/from/g, "")
    .replace(/to/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamKey(trade) {
  return (trade.teams || []).map(clean).filter(Boolean).sort().join("|");
}

function dateValue(trade) {
  const value = clean(trade.tradeDate || trade.date);
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateDiffDays(a, b) {
  const dateA = dateValue(a);
  const dateB = dateValue(b);
  if (!dateA || !dateB) return Infinity;
  return Math.abs(dateA.getTime() - dateB.getTime()) / 86400000;
}

function buildDateTeamsKey(trade) {
  const date = clean(trade.tradeDate || trade.date);
  return `${date}|${teamKey(trade)}`;
}

function allAssetKeys(trade) {
  return Object.values(trade.assetsReceived || {})
    .flat()
    .map((item) => normalizeAssetText(item.asset))
    .filter(Boolean);
}

function assetOverlapCount(a, b) {
  const aSet = new Set(allAssetKeys(a));
  const bSet = new Set(allAssetKeys(b));
  let overlap = 0;

  for (const key of aSet) {
    if (bSet.has(key)) overlap++;
  }

  return overlap;
}

function areLikelyDuplicates(a, b) {
  if (a === b) return false;
  if (clean(a.publishStatus) === HIDDEN_STATUS || clean(b.publishStatus) === HIDDEN_STATUS) return false;
  if (!teamKey(a) || teamKey(a) !== teamKey(b)) return false;
  if (dateDiffDays(a, b) > MAX_DATE_DIFF_DAYS) return false;

  const overlap = assetOverlapCount(a, b);
  if (overlap >= MIN_ASSET_OVERLAP) return true;

  const aCanonical = clean(a.canonicalKey);
  const bCanonical = clean(b.canonicalKey);
  if (aCanonical && bCanonical && aCanonical === bCanonical) return true;

  return false;
}

function assetCount(trade) {
  return Object.values(trade.assetsReceived || {}).flat().length;
}

function perspectiveCount(trade) {
  return Array.isArray(trade.perspectives) ? trade.perspectives.length : 0;
}

function textScore(trade) {
  return [trade.summary, trade.partnerSummary, trade.analysis]
    .map(clean)
    .filter(Boolean)
    .join(" ")
    .length;
}

function statusRank(status) {
  const value = clean(status).toLowerCase();

  if (value === "ready") return 5;
  if (value === "provisional") return 4;
  if (value === "review") return 3;
  if (value === "hold-review") return 2;
  if (value === HIDDEN_STATUS) return 0;

  return 1;
}

function chooseKeeper(group) {
  return [...group].sort((a, b) => {
    return (
      statusRank(b.publishStatus) - statusRank(a.publishStatus) ||
      perspectiveCount(b) - perspectiveCount(a) ||
      assetCount(b) - assetCount(a) ||
      textScore(b) - textScore(a) ||
      clean(a.slug).localeCompare(clean(b.slug))
    );
  })[0];
}

function mergeUniqueAssets(existingAssets = [], incomingAssets = []) {
  const seen = new Set(existingAssets.map((item) => normalizeAssetText(item.asset)));
  const merged = [...existingAssets];

  for (const item of incomingAssets) {
    const key = normalizeAssetText(item.asset);
    if (!key || seen.has(key)) continue;

    merged.push(item);
    seen.add(key);
  }

  return merged;
}

function perspectiveKey(perspective) {
  return [
    clean(perspective.sourceTeam),
    clean(perspective.sourceTradeId),
    clean(perspective.primaryTeam),
    clean(perspective.partnerTeam),
    clean(perspective.primaryGrade),
    clean(perspective.partnerGrade),
    clean(perspective.verdict),
  ].join("|");
}

function mergeUniquePerspectives(existingPerspectives = [], incomingPerspectives = []) {
  const merged = [];
  const seen = new Set();

  for (const perspective of [...existingPerspectives, ...incomingPerspectives]) {
    const key = perspectiveKey(perspective);
    if (seen.has(key)) continue;

    merged.push(perspective);
    seen.add(key);
  }

  return merged;
}

function mergeUniqueArray(...arrays) {
  return Array.from(new Set(arrays.flat().map(clean).filter(Boolean)));
}

function mergeGrades(existingGrades = {}, incomingGrades = {}) {
  return {
    ...existingGrades,
    ...Object.fromEntries(
      Object.entries(incomingGrades).filter(([, grade]) => clean(grade))
    ),
  };
}

function mergeText(existingValue, incomingValue) {
  const existing = clean(existingValue);
  const incoming = clean(incomingValue);

  if (existing) return existing;
  return incoming;
}

function mergeIntoKeeper(keeper, duplicate) {
  const mergedAssetsReceived = { ...(keeper.assetsReceived || {}) };

  for (const [team, assets] of Object.entries(duplicate.assetsReceived || {})) {
    mergedAssetsReceived[team] = mergeUniqueAssets(
      mergedAssetsReceived[team] || [],
      assets || []
    );
  }

  return {
    ...keeper,
    canonicalKey: keeper.canonicalKey || duplicate.canonicalKey,
    dateTeamsKey: keeper.dateTeamsKey || duplicate.dateTeamsKey || buildDateTeamsKey(keeper),
    teams: mergeUniqueArray(keeper.teams || [], duplicate.teams || []),
    assetsReceived: mergedAssetsReceived,
    grades: mergeGrades(keeper.grades || {}, duplicate.grades || {}),
    sourceTeams: mergeUniqueArray(keeper.sourceTeams || [], duplicate.sourceTeams || []),
    perspectives: mergeUniquePerspectives(keeper.perspectives || [], duplicate.perspectives || []),
    summary: mergeText(keeper.summary, duplicate.summary),
    partnerSummary: mergeText(keeper.partnerSummary, duplicate.partnerSummary),
    analysis: mergeText(keeper.analysis, duplicate.analysis),
    qaNotes: mergeUniqueArray([keeper.qaNotes], [duplicate.qaNotes]).join(" | "),
    confidence:
      keeper.confidence === "high" || duplicate.confidence === "high"
        ? "high"
        : keeper.confidence || duplicate.confidence,
    publishStatus:
      keeper.publishStatus === HIDDEN_STATUS && duplicate.publishStatus !== HIDDEN_STATUS
        ? duplicate.publishStatus
        : keeper.publishStatus,
  };
}

function buildDuplicateGroups(trades) {
  const publicTrades = trades.filter((trade) => clean(trade.publishStatus) !== HIDDEN_STATUS);
  const groups = [];
  const used = new Set();

  for (let i = 0; i < publicTrades.length; i++) {
    const root = publicTrades[i];
    if (used.has(root.slug)) continue;

    const group = [root];

    for (let j = i + 1; j < publicTrades.length; j++) {
      const candidate = publicTrades[j];
      if (used.has(candidate.slug)) continue;

      const matchesAnyInGroup = group.some((existing) => areLikelyDuplicates(existing, candidate));

      if (matchesAnyInGroup) {
        group.push(candidate);
      }
    }

    if (group.length > 1) {
      for (const trade of group) used.add(trade.slug);
      groups.push(group);
    }
  }

  return groups;
}

function main() {
  if (!fs.existsSync(TRADES_FILE)) {
    console.error(`Could not find ${TRADES_FILE}`);
    process.exit(1);
  }

  const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

  if (!Array.isArray(trades)) {
    console.error("trades.json is not an array.");
    process.exit(1);
  }

  const duplicateGroups = buildDuplicateGroups(trades);
  const report = [];
  const updatedBySlug = new Map();

  for (const group of duplicateGroups) {
    let keeper = chooseKeeper(group);
    const duplicates = group.filter((trade) => trade !== keeper);

    for (const duplicate of duplicates) {
      keeper = mergeIntoKeeper(keeper, duplicate);

      updatedBySlug.set(duplicate.slug, {
        ...duplicate,
        publishStatus: HIDDEN_STATUS,
        qaNotes: clean(duplicate.qaNotes)
          ? `${duplicate.qaNotes} | Hidden by dedupe-public-trades.cjs; merged into ${keeper.slug}.`
          : `Hidden by dedupe-public-trades.cjs; merged into ${keeper.slug}.`,
      });
    }

    updatedBySlug.set(keeper.slug, keeper);

    report.push({
      teamKey: teamKey(keeper),
      keptSlug: keeper.slug,
      hiddenSlugs: duplicates.map((trade) => trade.slug),
      keptId: keeper.id,
      hiddenIds: duplicates.map((trade) => trade.id),
      dates: group.map((trade) => trade.tradeDate),
      assetOverlapMinimum: MIN_ASSET_OVERLAP,
      maxDateDiffDays: MAX_DATE_DIFF_DAYS,
      reason:
        "Same teams, dates within one day, and overlapping assets. Public duplicate suppressed after merging assets, grades, sourceTeams, and perspectives into keeper.",
    });
  }

  const finalTrades = trades.map((trade) => updatedBySlug.get(trade.slug) || trade);

  fs.writeFileSync(TRADES_FILE, JSON.stringify(finalTrades, null, 2));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log(`Trades scanned: ${trades.length}`);
  console.log(`Duplicate groups fixed: ${report.length}`);
  console.log(
    `Public duplicate records hidden: ${report.reduce(
      (total, item) => total + item.hiddenSlugs.length,
      0
    )}`
  );
  console.log(`Saved trades to ${TRADES_FILE}`);
  console.log(`Saved report to ${REPORT_FILE}`);

  if (report.length) {
    console.log("");
    console.log("First 20 dedupe actions:");
    for (const item of report.slice(0, 20)) {
      console.log(`- Kept ${item.keptSlug}; hid ${item.hiddenSlugs.join(", ")}`);
    }
  }
}

main();