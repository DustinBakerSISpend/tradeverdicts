const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const PLAYERS_FILE = path.join(__dirname, "..", "src", "data", "nfl", "players.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "duplicate-merge-report.json");

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function toSlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeAssetText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/overall/g, "")
    .replace(/subsequently traded/g, "")
    .replace(/became/g, "")
    .replace(/reportedly/g, "")
    .replace(/conditional/g, "")
    .replace(/if [a-z0-9\s]+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueArray(values = []) {
  return Array.from(new Set((values || []).filter(Boolean))).sort();
}

function mergeUniqueText(...values) {
  return [...new Set(values.map(clean).filter(Boolean))].join(" | ");
}

function mergeAssets(existingAssets = [], incomingAssets = []) {
  const merged = [];
  const seen = new Set();

  for (const item of [...existingAssets, ...incomingAssets]) {
    if (!item || !item.asset) continue;
    const key = `${item.type || ""}|${normalizeAssetText(item.asset)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function mergeAssetsReceived(a = {}, b = {}) {
  const merged = { ...a };

  for (const [team, assets] of Object.entries(b || {})) {
    merged[team] = mergeAssets(merged[team] || [], assets || []);
  }

  return merged;
}

function mergeGrades(a = {}, b = {}) {
  return {
    ...(b || {}),
    ...(a || {}),
  };
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

function mergePerspectives(a = [], b = []) {
  const merged = [];
  const seen = new Set();

  for (const perspective of [...(a || []), ...(b || [])]) {
    if (!perspective) continue;
    const key = perspectiveKey(perspective);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(perspective);
  }

  return merged;
}

function confidenceRank(value) {
  const text = clean(value).toLowerCase();
  if (text === "high") return 3;
  if (text === "medium") return 2;
  if (text === "low") return 1;
  return 0;
}

function bestConfidence(a, b) {
  return confidenceRank(b) > confidenceRank(a) ? b : a;
}

function statusRank(value) {
  const text = clean(value).toLowerCase();
  if (text === "ready") return 4;
  if (text === "review") return 3;
  if (text === "provisional") return 2;
  if (text.includes("hold")) return 1;
  return 0;
}

function bestPublishStatus(a, b) {
  return statusRank(b) > statusRank(a) ? b : a;
}

function allAssetsKey(trade) {
  const assets = [];

  for (const assetList of Object.values(trade.assetsReceived || {})) {
    for (const item of assetList || []) {
      const normalized = normalizeAssetText(item.asset);
      if (normalized) assets.push(normalized);
    }
  }

  return assets.sort().join("|");
}

function dateAssetsKey(trade) {
  const date = clean(trade.tradeDate);
  const assets = allAssetsKey(trade);
  if (!date || !assets) return "";
  return `${date}::${assets}`;
}

function hasTeam(trade, teamSlug) {
  return (
    (trade.teams || []).includes(teamSlug) ||
    (trade.sourceTeams || []).includes(teamSlug) ||
    Object.keys(trade.assetsReceived || {}).includes(teamSlug) ||
    Object.keys(trade.grades || {}).includes(teamSlug)
  );
}

function knownTeamCount(trade) {
  return (trade.teams || []).filter((team) => team && team !== "unknown-partner").length;
}

function isGenericSlug(slug) {
  const text = clean(slug);
  return (
    text.startsWith("draft-pick-") ||
    text.startsWith("cash-") ||
    text.startsWith("future-considerations-") ||
    text === "unknown" ||
    text.includes("unknown")
  );
}

function keeperScore(trade) {
  let score = 0;

  score += knownTeamCount(trade) * 500;
  score += (trade.sourceTeams || []).length * 100;
  score += (trade.perspectives || []).length * 75;

  if ((trade.teams || []).length >= 2) score += 300;
  if (!isGenericSlug(trade.slug)) score += 250;
  if (trade.publishStatus === "ready") score += 50;
  if (clean(trade.summary)) score += 25;
  if (clean(trade.analysis)) score += 25;
  if (clean(trade.verdict) && !clean(trade.verdict).startsWith("?")) score += 50;

  if (hasTeam(trade, "las-vegas-raiders")) score += 1000;
  if (hasTeam(trade, "oakland-raiders")) score += 900;

  return score;
}

function chooseKeeper(trades) {
  return [...trades].sort((a, b) => {
    const scoreDiff = keeperScore(b) - keeperScore(a);
    if (scoreDiff !== 0) return scoreDiff;

    const aTextLength = clean(a.summary).length + clean(a.analysis).length;
    const bTextLength = clean(b.summary).length + clean(b.analysis).length;

    if (bTextLength !== aTextLength) return bTextLength - aTextLength;

    return clean(a.slug).localeCompare(clean(b.slug));
  })[0];
}

function mergeTrade(keeper, duplicate) {
  const merged = {
    ...keeper,

    teams: uniqueArray([...(keeper.teams || []), ...(duplicate.teams || [])]),
    sourceTeams: uniqueArray([...(keeper.sourceTeams || []), ...(duplicate.sourceTeams || [])]),
    assetsReceived: mergeAssetsReceived(keeper.assetsReceived || {}, duplicate.assetsReceived || {}),
    grades: mergeGrades(keeper.grades || {}, duplicate.grades || {}),
    perspectives: mergePerspectives(keeper.perspectives || [], duplicate.perspectives || []),

    summary: clean(keeper.summary) || clean(duplicate.summary),
    partnerSummary: clean(keeper.partnerSummary) || clean(duplicate.partnerSummary),
    analysis: clean(keeper.analysis) || clean(duplicate.analysis),

    qaNotes: mergeUniqueText(keeper.qaNotes, duplicate.qaNotes),

    confidence: bestConfidence(keeper.confidence, duplicate.confidence),
    publishStatus: bestPublishStatus(keeper.publishStatus, duplicate.publishStatus),
  };

  return merged;
}

function cleanPlayerName(value) {
  return clean(value)
    .replace(/^[^\w]+|[^\w]+$/g, "")
    .replace(/,$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPlayerNamesFromAsset(assetText, assetType) {
  const text = clean(assetText);
  const names = [];

  if (!text) return names;

  if (assetType === "player") names.push(cleanPlayerName(text));

  const beforePick = text.split(/\b\d{4}\b/)[0].trim();

  if (beforePick && beforePick.length > 3 && !beforePick.toLowerCase().includes("pick")) {
    names.push(cleanPlayerName(beforePick.replace(/\band\b$/i, "")));
  }

  const parenthesesMatches = [...text.matchAll(/\(([^)]*)\)/g)];

  for (const match of parenthesesMatches) {
    const inside = match[1];
    const parts = inside.split(",").map(clean);
    const possibleName = parts[parts.length - 1];

    if (possibleName && /^[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)+$/.test(possibleName)) {
      names.push(possibleName);
    }
  }

  return [...new Set(names)].filter(Boolean);
}

function generatePlayersFile(trades) {
  const playersMap = new Map();

  for (const trade of trades) {
    for (const [team, assets] of Object.entries(trade.assetsReceived || {})) {
      for (const item of assets || []) {
        const playerNames = extractPlayerNamesFromAsset(item.asset, item.type);

        for (const name of playerNames) {
          const slug = toSlug(name);
          if (!name || !slug) continue;

          if (!playersMap.has(slug)) {
            playersMap.set(slug, {
              name,
              slug,
              league: "NFL",
              teams: new Set(),
              tradeSlugs: new Set(),
            });
          }

          playersMap.get(slug).teams.add(team);
          playersMap.get(slug).tradeSlugs.add(trade.slug);
        }
      }
    }
  }

  const players = Array.from(playersMap.values())
    .map((player) => ({
      name: player.name,
      slug: player.slug,
      league: player.league,
      teams: Array.from(player.teams).sort(),
      tradeSlugs: Array.from(player.tradeSlugs).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));

  console.log(`Generated ${players.length} NFL player records.`);
  console.log(`Saved players to ${PLAYERS_FILE}`);
}

function mergeGroups(trades, keyBuilder, reason, report) {
  const groups = new Map();

  for (const trade of trades) {
    const key = keyBuilder(trade);
    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }

  const duplicateGroups = Array.from(groups.entries()).filter(([, group]) => group.length > 1);
  const removedIds = new Set();
  const mergedById = new Map();

  for (const [key, group] of duplicateGroups) {
    const activeGroup = group.filter((trade) => !removedIds.has(trade.id));
    if (activeGroup.length <= 1) continue;

    const keeper = chooseKeeper(activeGroup);
    let merged = keeper;

    for (const trade of activeGroup) {
      if (trade === keeper) continue;
      merged = mergeTrade(merged, trade);
      removedIds.add(trade.id);
    }

    mergedById.set(keeper.id, merged);

    report.push({
      reason,
      key,
      keptId: keeper.id,
      keptSlug: keeper.slug,
      removed: activeGroup
        .filter((trade) => trade !== keeper)
        .map((trade) => ({
          id: trade.id,
          slug: trade.slug,
          teams: trade.teams || [],
        })),
      totalMergedRecords: activeGroup.length,
      keptTeams: keeper.teams || [],
    });
  }

  const finalTrades = trades
    .filter((trade) => !removedIds.has(trade.id))
    .map((trade) => mergedById.get(trade.id) || trade);

  return {
    trades: finalTrades,
    groupsFound: duplicateGroups.length,
    removed: removedIds.size,
  };
}

function main() {
  if (!fs.existsSync(TRADES_FILE)) {
    console.error(`Could not find trades file: ${TRADES_FILE}`);
    process.exit(1);
  }

  const originalTrades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

  if (!Array.isArray(originalTrades)) {
    console.error("trades.json is not an array.");
    process.exit(1);
  }

  const report = [];

  const passOne = mergeGroups(
    originalTrades,
    (trade) => clean(trade.dateTeamsKey),
    "same-date-and-teams",
    report
  );

  const passTwo = mergeGroups(
    passOne.trades,
    dateAssetsKey,
    "same-date-and-assets",
    report
  );

  const finalTrades = passTwo.trades.sort((a, b) => new Date(a.tradeDate) - new Date(b.tradeDate));

  fs.writeFileSync(TRADES_FILE, JSON.stringify(finalTrades, null, 2));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  generatePlayersFile(finalTrades);

  console.log(`Merged duplicate trades.`);
  console.log(`Trades before merge: ${originalTrades.length}`);
  console.log(`Pass 1 duplicate groups found: ${passOne.groupsFound}`);
  console.log(`Pass 1 trades removed: ${passOne.removed}`);
  console.log(`Pass 2 duplicate groups found: ${passTwo.groupsFound}`);
  console.log(`Pass 2 trades removed: ${passTwo.removed}`);
  console.log(`Total trades removed: ${originalTrades.length - finalTrades.length}`);
  console.log(`Final trade count: ${finalTrades.length}`);
  console.log(`Saved trades to ${TRADES_FILE}`);
  console.log(`Saved merge report to ${REPORT_FILE}`);
}

main();