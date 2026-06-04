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
    ...(a || {}),
    ...(b || {}),
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

function chooseKeeper(trades) {
  return [...trades].sort((a, b) => {
    const aSourceCount = (a.sourceTeams || []).length;
    const bSourceCount = (b.sourceTeams || []).length;

    if (bSourceCount !== aSourceCount) return bSourceCount - aSourceCount;

    const aPerspectiveCount = (a.perspectives || []).length;
    const bPerspectiveCount = (b.perspectives || []).length;

    if (bPerspectiveCount !== aPerspectiveCount) return bPerspectiveCount - aPerspectiveCount;

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

  if (!clean(merged.summary) && clean(duplicate.summary)) merged.summary = duplicate.summary;
  if (!clean(merged.analysis) && clean(duplicate.analysis)) merged.analysis = duplicate.analysis;

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

function main() {
  if (!fs.existsSync(TRADES_FILE)) {
    console.error(`Could not find trades file: ${TRADES_FILE}`);
    process.exit(1);
  }

  const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

  if (!Array.isArray(trades)) {
    console.error("trades.json is not an array.");
    process.exit(1);
  }

  const groups = new Map();

  for (const trade of trades) {
    const key = clean(trade.dateTeamsKey);

    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }

  const duplicateGroups = Array.from(groups.entries()).filter(([, group]) => group.length > 1);

  const mergedByKey = new Map();
  const removedSlugs = new Set();
  const report = [];

  for (const [key, group] of duplicateGroups) {
    const keeper = chooseKeeper(group);
    let merged = keeper;

    for (const trade of group) {
      if (trade === keeper) continue;
      merged = mergeTrade(merged, trade);
      removedSlugs.add(trade.slug);
    }

    mergedByKey.set(key, merged);

    report.push({
      dateTeamsKey: key,
      keptSlug: keeper.slug,
      removedSlugs: group.filter((trade) => trade !== keeper).map((trade) => trade.slug),
      totalMergedRecords: group.length,
      teams: keeper.teams || [],
    });
  }

  const finalTrades = trades
    .filter((trade) => !removedSlugs.has(trade.slug))
    .map((trade) => mergedByKey.get(trade.dateTeamsKey) || trade)
    .sort((a, b) => new Date(a.tradeDate) - new Date(b.tradeDate));

  fs.writeFileSync(TRADES_FILE, JSON.stringify(finalTrades, null, 2));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  generatePlayersFile(finalTrades);

  console.log(`Merged duplicate trades.`);
  console.log(`Trades before merge: ${trades.length}`);
  console.log(`Duplicate groups found: ${duplicateGroups.length}`);
  console.log(`Trades removed: ${trades.length - finalTrades.length}`);
  console.log(`Final trade count: ${finalTrades.length}`);
  console.log(`Saved trades to ${TRADES_FILE}`);
  console.log(`Saved merge report to ${REPORT_FILE}`);
}

main();