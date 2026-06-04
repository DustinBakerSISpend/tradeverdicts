const fs = require("fs");
const path = require("path");

const PLAYERS_FILE = path.join(__dirname, "..", "src", "data", "nfl", "players.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "player-name-cleanup-report.json");

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

function isNonPlayerName(name) {
  const lower = clean(name).toLowerCase();

  return (
    !lower ||
    lower === "cash" ||
    lower === "undisclosed" ||
    lower === "unknown" ||
    lower.includes("future considerations") ||
    lower.includes("undisclosed terms") ||
    lower.includes("undisclosed compensation") ||
    lower.includes("unknown consideration") ||
    lower.includes("unknown/not disclosed") ||
    lower.includes("unknown/undisclosed") ||
    lower.includes("conditional draft choice") ||
    lower.includes("player to be named later") ||
    lower.includes("no additional compensation")
  );
}

function cleanupName(name) {
  let next = clean(name);

  next = next.replace(/^rights to\s+/i, "");
  next = next.replace(/^loan of\s+/i, "");

  next = next.replace(/^(Billy|Herschel|Jon|Ralph|William\))\)\s+/i, "");

  next = next.replace(/^Billy\)\s+/i, "");
  next = next.replace(/^Herschel\)\s+/i, "");
  next = next.replace(/^Jon\)\s+/i, "");
  next = next.replace(/^Ralph\)\s+/i, "");
  next = next.replace(/^William\)\s+/i, "");

  next = next.replace(/\s+\([abcdefABCDEF]\s*$/g, "");
  next = next.replace(/\s+\([abcdefABCDEF]\)\s*$/g, "");

  next = next.replace(/\s+\((formerly|later changed to|replaced with|replaced on|for|on)\s*$/i, "");

  next = next.replace(/\s{2,}/g, " ").trim();

  return next;
}

function mergePlayer(existing, incoming) {
  return {
    ...existing,
    name: existing.name,
    slug: existing.slug,
    league: existing.league || incoming.league || "NFL",
    teams: Array.from(new Set([...(existing.teams || []), ...(incoming.teams || [])])).sort(),
    tradeSlugs: Array.from(new Set([...(existing.tradeSlugs || []), ...(incoming.tradeSlugs || [])])).sort(),
  };
}

function main() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    console.error(`Could not find players file: ${PLAYERS_FILE}`);
    process.exit(1);
  }

  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8"));

  if (!Array.isArray(players)) {
    console.error("players.json is not an array.");
    process.exit(1);
  }

  const report = [];
  const playerMap = new Map();

  let removed = 0;
  let renamed = 0;
  let merged = 0;

  for (const player of players) {
    const originalName = clean(player.name);

    if (isNonPlayerName(originalName)) {
      removed++;
      report.push({
        action: "removed-non-player",
        originalName,
        slug: player.slug,
        tradeSlugs: player.tradeSlugs || [],
      });
      continue;
    }

    const cleanedName = cleanupName(originalName);

    if (!cleanedName || isNonPlayerName(cleanedName)) {
      removed++;
      report.push({
        action: "removed-after-cleanup",
        originalName,
        cleanedName,
        slug: player.slug,
        tradeSlugs: player.tradeSlugs || [],
      });
      continue;
    }

    const cleanedSlug = toSlug(cleanedName);

    const cleanedPlayer = {
      ...player,
      name: cleanedName,
      slug: cleanedSlug,
      league: player.league || "NFL",
      teams: Array.from(new Set(player.teams || [])).sort(),
      tradeSlugs: Array.from(new Set(player.tradeSlugs || [])).sort(),
    };

    if (cleanedName !== originalName || cleanedSlug !== player.slug) {
      renamed++;
      report.push({
        action: "renamed",
        originalName,
        cleanedName,
        originalSlug: player.slug,
        cleanedSlug,
      });
    }

    if (playerMap.has(cleanedSlug)) {
      const existing = playerMap.get(cleanedSlug);
      playerMap.set(cleanedSlug, mergePlayer(existing, cleanedPlayer));
      merged++;
      report.push({
        action: "merged-duplicate-player",
        originalName,
        cleanedName,
        mergedIntoSlug: cleanedSlug,
      });
    } else {
      playerMap.set(cleanedSlug, cleanedPlayer);
    }
  }

  const cleanedPlayers = Array.from(playerMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(cleanedPlayers, null, 2));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log("Cleaned player names.");
  console.log(`Players before cleanup: ${players.length}`);
  console.log(`Players after cleanup: ${cleanedPlayers.length}`);
  console.log(`Removed non-player records: ${removed}`);
  console.log(`Renamed player records: ${renamed}`);
  console.log(`Merged duplicate player records: ${merged}`);
  console.log(`Saved players to ${PLAYERS_FILE}`);
  console.log(`Saved report to ${REPORT_FILE}`);
}

main();