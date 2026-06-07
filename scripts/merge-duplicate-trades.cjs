const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const PLAYERS_FILE = path.join(__dirname, "..", "src", "data", "nfl", "players.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "duplicate-merge-report.json");
const REVIEW_FILE = path.join(__dirname, "..", "src", "data", "nfl", "duplicate-review-needed.json");

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

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

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/subsequently traded/g, " ")
    .replace(/conditional/g, " ")
    .replace(/future considerations/g, "future consideration")
    .replace(/not specified in raw source/g, "unknown")
    .replace(/unknown unspecified partner/g, "unknown-team")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAssetText(value) {
  return normalizeText(value)
    .replace(/\boverall\b/g, " ")
    .replace(/\bround\b/g, "rd")
    .replace(/\bpick\b/g, "pk")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueArray(values = []) {
  return Array.from(new Set((values || []).map(clean).filter(Boolean))).sort();
}

function mergeUniqueText(...values) {
  return Array.from(new Set(values.map(clean).filter(Boolean))).join(" | ");
}

function isUnknownTeam(team) {
  const slug = toSlug(team);
  return !slug || slug === "unknown-team" || slug === "unknown-partner" || slug.includes("unknown");
}

function knownTeams(trade) {
  return uniqueArray(trade.teams || []).filter((team) => !isUnknownTeam(team));
}

function teamSetKey(teams = []) {
  return uniqueArray(teams).join("|");
}

function getAllTradeTeams(trade) {
  return uniqueArray([
    ...(trade.teams || []),
    ...(trade.sourceTeams || []),
    ...Object.keys(trade.assetsReceived || {}),
    ...Object.keys(trade.grades || {}),
    ...(trade.perspectives || []).flatMap((p) => [p.primaryTeam, p.partnerTeam]),
  ]).filter(Boolean);
}

function getKnownTradeTeams(trade) {
  return getAllTradeTeams(trade).filter((team) => !isUnknownTeam(team));
}

function assetKey(item) {
  if (!item || !item.asset) return "";
  return `${clean(item.type).toLowerCase()}::${normalizeAssetText(item.asset)}`;
}

function allAssetKeys(trade) {
  const keys = [];

  for (const assets of Object.values(trade.assetsReceived || {})) {
    for (const item of assets || []) {
      const key = assetKey(item);
      if (key) keys.push(key);
    }
  }

  return uniqueArray(keys);
}

function assetSetKey(trade) {
  return allAssetKeys(trade).join("|");
}

function hasMeaningfulAssets(trade) {
  return allAssetKeys(trade).some((key) => {
    const text = key.toLowerCase();
    return (
      text &&
      !text.includes("unknown") &&
      !text.includes("not specified") &&
      !text.includes("future consideration")
    );
  });
}

function canonicalStrongKey(trade) {
  const key = clean(trade.canonicalKey);
  if (!key) return "";
  if (key.includes("unknown")) return "";
  if (key.includes("not specified in raw source")) return "";
  if (key.includes("future-consideration")) return "";
  return key;
}

function dateTeamsStrongKey(trade) {
  const date = clean(trade.tradeDate);
  const teams = getKnownTradeTeams(trade);

  if (!date || teams.length < 2) return "";

  return `${date}::${teamSetKey(teams)}`;
}

function strictMirrorKey(trade) {
  const date = clean(trade.tradeDate);
  const teams = knownTeams(trade);
  const assets = assetSetKey(trade);

  if (!date || teams.length < 2 || !assets || !hasMeaningfulAssets(trade)) return "";

  return `${date}::${teamSetKey(teams)}::${assets}`;
}

function riskyGroupReason(group) {
  const dates = uniqueArray(group.map((t) => t.tradeDate));
  const teamKeys = uniqueArray(group.map((t) => teamSetKey(getKnownTradeTeams(t))));
  const assetKeys = uniqueArray(group.map((t) => assetSetKey(t)));
  const hasUnknown = group.some((t) => getAllTradeTeams(t).some(isUnknownTeam));

  if (dates.length > 1) return "different-dates";
  if (hasUnknown) return "contains-unknown-team";
  if (teamKeys.length > 1) return "different-team-sets";
  if (assetKeys.length > 1) return "different-asset-sets";
  return "";
}

function canAutoMerge(group) {
  if (!Array.isArray(group) || group.length < 2) return false;

  const reason = riskyGroupReason(group);
  if (reason) return false;

  const knownTeamCounts = group.map((trade) => getKnownTradeTeams(trade).length);
  if (knownTeamCounts.some((count) => count < 2)) return false;

  const assetKeys = uniqueArray(group.map((trade) => assetSetKey(trade)));
  if (assetKeys.length !== 1) return false;

  if (!assetKeys[0]) return false;

  return true;
}

function mergeAssets(existingAssets = [], incomingAssets = []) {
  const merged = [];
  const seen = new Set();

  for (const item of [...existingAssets, ...incomingAssets]) {
    if (!item || !clean(item.asset)) continue;

    const key = assetKey(item);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function mergeAssetsReceived(a = {}, b = {}) {
  const merged = { ...(a || {}) };

  for (const [team, assets] of Object.entries(b || {})) {
    if (!team) continue;
    merged[team] = mergeAssets(merged[team] || [], assets || []);
  }

  return merged;
}

function gradeRank(grade) {
  const g = clean(grade).toUpperCase();
  const ranks = {
    "A+": 13,
    A: 12,
    "A-": 11,
    "B+": 10,
    B: 9,
    "B-": 8,
    "C+": 7,
    C: 6,
    "C-": 5,
    "D+": 4,
    D: 3,
    "D-": 2,
    F: 1,
  };
  return ranks[g] || 0;
}

function mergeGrades(a = {}, b = {}) {
  const merged = { ...(a || {}) };

  for (const [team, grade] of Object.entries(b || {})) {
    if (!team) continue;

    const existing = clean(merged[team]);
    const incoming = clean(grade);

    if (!existing) {
      merged[team] = incoming;
      continue;
    }

    if (!incoming) continue;

    if (gradeRank(incoming) > gradeRank(existing)) {
      merged[team] = incoming;
    }
  }

  return merged;
}

function perspectiveKey(p) {
  return [
    clean(p.sourceTeam),
    clean(p.sourceTradeId),
    clean(p.sourceRow),
    clean(p.primaryTeam),
    clean(p.partnerTeam),
    clean(p.primaryGrade),
    clean(p.partnerGrade),
    normalizeText(p.verdict),
  ].join("|");
}

function mergePerspectives(a = [], b = []) {
  const merged = [];
  const seen = new Set();

  for (const p of [...(a || []), ...(b || [])]) {
    if (!p) continue;

    const key = perspectiveKey(p);
    if (seen.has(key)) continue;

    seen.add(key);
    merged.push(p);
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

function isGenericSlug(slug) {
  const text = clean(slug).toLowerCase();
  return (
    !text ||
    text.startsWith("draft-pick-") ||
    text.startsWith("cash-") ||
    text.startsWith("future-considerations-") ||
    text.includes("unknown") ||
    text === "trade"
  );
}

function keeperScore(trade) {
  let score = 0;

  score += getKnownTradeTeams(trade).length * 1000;
  score += (trade.sourceTeams || []).length * 250;
  score += (trade.perspectives || []).length * 250;
  score += allAssetKeys(trade).length * 50;

  if ((trade.teams || []).length >= 2) score += 500;
  if (!isGenericSlug(trade.slug)) score += 400;
  if (clean(trade.summary)) score += 100;
  if (clean(trade.analysis)) score += 100;
  if (clean(trade.verdict) && !clean(trade.verdict).startsWith("?")) score += 100;
  if (clean(trade.publishStatus).toLowerCase() === "ready") score += 75;
  if (clean(trade.confidence).toLowerCase() === "high") score += 50;

  return score;
}

function chooseKeeper(group) {
  return [...group].sort((a, b) => {
    const scoreDiff = keeperScore(b) - keeperScore(a);
    if (scoreDiff !== 0) return scoreDiff;

    const textA = clean(a.summary).length + clean(a.analysis).length;
    const textB = clean(b.summary).length + clean(b.analysis).length;
    if (textB !== textA) return textB - textA;

    return clean(a.id).localeCompare(clean(b.id));
  })[0];
}

function chooseBetterText(a, b) {
  const aa = clean(a);
  const bb = clean(b);

  if (!aa) return bb;
  if (!bb) return aa;

  if (bb.length > aa.length * 1.25) return bb;
  return aa;
}

function mergeTrade(keeper, duplicate) {
  return {
    ...keeper,
    teams: uniqueArray([...(keeper.teams || []), ...(duplicate.teams || [])]),
    sourceTeams: uniqueArray([...(keeper.sourceTeams || []), ...(duplicate.sourceTeams || [])]),
    assetsReceived: mergeAssetsReceived(keeper.assetsReceived || {}, duplicate.assetsReceived || {}),
    grades: mergeGrades(keeper.grades || {}, duplicate.grades || {}),
    perspectives: mergePerspectives(keeper.perspectives || [], duplicate.perspectives || []),

    summary: chooseBetterText(keeper.summary, duplicate.summary),
    partnerSummary: chooseBetterText(keeper.partnerSummary, duplicate.partnerSummary),
    analysis: chooseBetterText(keeper.analysis, duplicate.analysis),
    qaNotes: mergeUniqueText(keeper.qaNotes, duplicate.qaNotes),

    confidence: bestConfidence(keeper.confidence, duplicate.confidence),
    publishStatus: bestPublishStatus(keeper.publishStatus, duplicate.publishStatus),
  };
}

function buildGroups(trades, keyBuilder) {
  const groups = new Map();

  for (const trade of trades) {
    const key = keyBuilder(trade);
    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }

  return Array.from(groups.entries()).filter(([, group]) => group.length > 1);
}

function mergeGroups(trades, keyBuilder, reason, report, review) {
  const groups = buildGroups(trades, keyBuilder);
  const removedIds = new Set();
  const mergedById = new Map();

  for (const [key, group] of groups) {
    const activeGroup = group.filter((trade) => !removedIds.has(trade.id));
    if (activeGroup.length <= 1) continue;

    if (!canAutoMerge(activeGroup)) {
      review.push({
        reason,
        key,
        blockedBecause: riskyGroupReason(activeGroup) || "failed-auto-merge-safety-check",
        records: activeGroup.map((trade) => ({
          id: trade.id,
          slug: trade.slug,
          tradeDate: trade.tradeDate,
          teams: trade.teams || [],
          sourceTeams: trade.sourceTeams || [],
          canonicalKey: trade.canonicalKey || "",
          dateTeamsKey: trade.dateTeamsKey || "",
          assets: allAssetKeys(trade),
        })),
      });
      continue;
    }

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
          sourceTeams: trade.sourceTeams || [],
        })),
      totalMergedRecords: activeGroup.length,
      finalTeams: merged.teams || [],
    });
  }

  return {
    trades: trades
      .filter((trade) => !removedIds.has(trade.id))
      .map((trade) => mergedById.get(trade.id) || trade),
    groupsFound: groups.length,
    removed: removedIds.size,
  };
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

  if (assetType === "player") {
    names.push(cleanPlayerName(text));
  }

  const parenthesesMatches = [...text.matchAll(/\(([^)]*)\)/g)];

  for (const match of parenthesesMatches) {
    const inside = match[1];
    const parts = inside.split(",").map(clean);
    const possibleName = parts[parts.length - 1];

    if (possibleName && /^[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)+$/.test(possibleName)) {
      names.push(cleanPlayerName(possibleName));
    }
  }

  return Array.from(new Set(names)).filter((name) => {
    const lower = name.toLowerCase();
    return (
      name &&
      !lower.includes("round pick") &&
      !lower.includes("future consideration") &&
      !lower.includes("not specified") &&
      !lower.includes("unknown")
    );
  });
}

function generatePlayersFile(trades) {
  const playersMap = new Map();

  for (const trade of trades) {
    for (const [team, assets] of Object.entries(trade.assetsReceived || {})) {
      if (isUnknownTeam(team)) continue;

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

  if (!DRY_RUN) {
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));
  }

  console.log(`Generated ${players.length} NFL player records.`);
  if (!DRY_RUN) console.log(`Saved players to ${PLAYERS_FILE}`);
}

function sortTrades(trades) {
  return [...trades].sort((a, b) => {
    const dateDiff = new Date(a.tradeDate) - new Date(b.tradeDate);
    if (dateDiff !== 0) return dateDiff;
    return clean(a.id).localeCompare(clean(b.id));
  });
}

function main() {
  if (!DRY_RUN && !APPLY) {
    console.error("Safety stop: run with --dry-run or --apply.");
    console.error("Example: node scripts/merge-duplicate-trades.cjs --dry-run");
    console.error("Example: node scripts/merge-duplicate-trades.cjs --apply");
    process.exit(1);
  }

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
  const review = [];

  const passOne = mergeGroups(
    originalTrades,
    canonicalStrongKey,
    "same-strong-canonical-key",
    report,
    review
  );

  const passTwo = mergeGroups(
    passOne.trades,
    strictMirrorKey,
    "same-date-teams-and-assets",
    report,
    review
  );

  const finalTrades = sortTrades(passTwo.trades);

  if (!DRY_RUN) {
    fs.writeFileSync(TRADES_FILE, JSON.stringify(finalTrades, null, 2));
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  fs.writeFileSync(REVIEW_FILE, JSON.stringify(review, null, 2));

  generatePlayersFile(finalTrades);

  console.log(`Duplicate merge ${DRY_RUN ? "dry run" : "applied"}.`);
  console.log(`Trades before merge: ${originalTrades.length}`);
  console.log(`Pass 1 duplicate groups found: ${passOne.groupsFound}`);
  console.log(`Pass 1 trades removed: ${passOne.removed}`);
  console.log(`Pass 2 duplicate groups found: ${passTwo.groupsFound}`);
  console.log(`Pass 2 trades removed: ${passTwo.removed}`);
  console.log(`Total trades removed: ${originalTrades.length - finalTrades.length}`);
  console.log(`Final trade count: ${finalTrades.length}`);
  console.log(`Auto-merge report entries: ${report.length}`);
  console.log(`Manual-review groups: ${review.length}`);
  if (!DRY_RUN) console.log(`Saved trades to ${TRADES_FILE}`);
  console.log(`Saved merge report to ${REPORT_FILE}`);
  console.log(`Saved review report to ${REVIEW_FILE}`);
}

main();