const fs = require("fs");
const path = require("path");

const PLAYERS_FILE = path.join(__dirname, "..", "src", "data", "nfl", "players.json");
const REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "player-display-name-normalization-report.json");

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

function clean(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function toSlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeName(name) {
  let value = clean(name);
  if (!value) return value;

  const exact = {
    "Jon) Steve Young": "Steve Young"
  };
  if (exact[value]) return exact[value];

  value = value.split(" / ")[0];
  value = value.replace(/\s*\([^)]*$/g, "");
  value = value.replace(/\s*\([^)]*\)/g, "");
  value = value.replace(/^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?\)\s+/, "");

  return clean(value);
}

function mergePlayer(a, b) {
  return {
    name: a.name,
    slug: a.slug,
    league: a.league || b.league || "NFL",
    teams: Array.from(new Set([...(a.teams || []), ...(b.teams || [])])).sort(),
    tradeSlugs: Array.from(new Set([...(a.tradeSlugs || []), ...(b.tradeSlugs || [])])).sort()
  };
}

if (!DRY_RUN && !APPLY) {
  console.error("Safety stop: run with --dry-run or --apply.");
  process.exit(1);
}

const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8"));

const changes = [];
const map = new Map();

for (const player of players) {
  const oldName = clean(player.name);
  const newName = normalizeName(oldName);
  const newSlug = toSlug(newName);

  if (oldName !== newName || player.slug !== newSlug) {
    changes.push({
      from: oldName,
      to: newName,
      oldSlug: player.slug,
      newSlug
    });
  }

  const next = {
    ...player,
    name: newName,
    slug: newSlug
  };

  if (map.has(newSlug)) {
    map.set(newSlug, mergePlayer(map.get(newSlug), next));
  } else {
    map.set(newSlug, next);
  }
}

const nextPlayers = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));

const report = {
  dryRun: DRY_RUN,
  playerRecordsBefore: players.length,
  playerRecordsAfter: nextPlayers.length,
  changedNames: changes.length,
  changes
};

fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

if (APPLY) {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(nextPlayers, null, 2));
}

console.log(`Player display-name normalization ${DRY_RUN ? "dry run" : "applied"}.`);
console.log(`Player records before: ${players.length}`);
console.log(`Player records after: ${nextPlayers.length}`);
console.log(`Changed names: ${changes.length}`);
console.log(`Saved report to ${REPORT_FILE}`);

console.log("\nFirst 75 changes:");
for (const item of changes.slice(0, 75)) {
  console.log(`${item.from} -> ${item.to}`);
}