import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "audits", "nfl-selected-player-dedupe");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SOURCE_DIRS = ["src/data", "src/content", "data", "public/data"]
  .map((p) => path.join(ROOT, p))
  .filter((p) => fs.existsSync(p));

const scanRoots = SOURCE_DIRS.length ? SOURCE_DIRS : [ROOT];

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".astro",
  ".netlify",
  "dist",
  "build",
  "coverage",
  "audits",
]);

const COMMON_NON_TEAM_KEYS = new Set([
  "assets",
  "asset",
  "players",
  "picks",
  "teams",
  "team",
  "teamGrades",
  "grades",
  "perspectives",
  "summary",
  "analysis",
  "trade",
  "trades",
  "items",
  "received",
  "sent",
  "gave",
  "got",
  "incoming",
  "outgoing",
]);

const NFL_TEAM_HINTS = [
  "ari", "cardinals", "atl", "falcons", "bal", "ravens", "buf", "bills",
  "car", "panthers", "chi", "bears", "cin", "bengals", "cle", "browns",
  "dal", "cowboys", "den", "broncos", "det", "lions", "gb", "packers",
  "hou", "texans", "oilers", "ind", "colts", "jax", "jaguars", "kc", "chiefs",
  "lv", "raiders", "oakland", "la", "lac", "chargers", "sd", "rams", "lar",
  "mia", "dolphins", "min", "vikings", "ne", "patriots", "no", "saints",
  "nyg", "giants", "nyj", "jets", "phi", "eagles", "pit", "steelers",
  "sf", "49ers", "sea", "seahawks", "tb", "buccaneers", "bucs",
  "ten", "titans", "was", "commanders", "redskins",
];

const TEAM_KEYS = [
  "team",
  "teamKey",
  "teamName",
  "franchise",
  "franchiseKey",
  "side",
  "ownerTeam",
  "receivingTeam",
  "recipientTeam",
  "acquiringTeam",
  "toTeam",
  "creditedTeam",
];

const TEXT_KEYS = [
  "name",
  "title",
  "label",
  "displayName",
  "description",
  "text",
  "value",
  "asset",
  "player",
  "playerName",
  "pick",
  "pickText",
  "summary",
  "notes",
];

const SELECTED_PLAYER_KEYS = [
  "selectedPlayer",
  "selected_player",
  "draftedPlayer",
  "drafted_player",
  "playerSelected",
  "player_selected",
  "usedToSelect",
  "used_to_select",
];

function walkJsonFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        walkJsonFiles(path.join(dir, entry.name), out);
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      out.push(path.join(dir, entry.name));
    }
  }

  return out;
}

function normalizeSpaces(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(s) {
  return normalizeSpaces(s)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase()
    .trim();
}

function normalizeTeam(s) {
  return normalizeSpaces(s)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase()
    .trim();
}

function cleanPlayerName(s) {
  let x = normalizeSpaces(s);
  if (!x) return null;

  x = x
    .replace(/^player\s*:\s*/i, "")
    .replace(/^PLAYER\s*-\s*/i, "")
    .replace(/\s+\((QB|RB|FB|WR|TE|OT|T|OG|G|C|DE|DT|DL|EDGE|LB|ILB|OLB|CB|S|FS|SS|K|P|LS)\)$/i, "")
    .replace(/,\s*(QB|RB|FB|WR|TE|OT|T|OG|G|C|DE|DT|DL|EDGE|LB|ILB|OLB|CB|S|FS|SS|K|P|LS)$/i, "")
    .replace(/\s+-\s+(QB|RB|FB|WR|TE|OT|T|OG|G|C|DE|DT|DL|EDGE|LB|ILB|OLB|CB|S|FS|SS|K|P|LS)$/i, "")
    .trim();

  if (!/[A-Za-z]/.test(x)) return null;

  const words = x.split(/\s+/);
  if (words.length < 2 || words.length > 6) return null;

  return x;
}

function safeStringValue(v) {
  return typeof v === "string" || typeof v === "number" ? normalizeSpaces(v) : "";
}

function getFirstString(obj, keys) {
  for (const key of keys) {
    if (typeof obj?.[key] === "string" || typeof obj?.[key] === "number") {
      const val = normalizeSpaces(obj[key]);
      if (val) return val;
    }
  }
  return "";
}

function getAssetText(obj) {
  const parts = [];

  for (const key of TEXT_KEYS) {
    const val = safeStringValue(obj?.[key]);
    if (val) parts.push(val);
  }

  return normalizeSpaces([...new Set(parts)].join(" | "));
}

function getTypeText(obj) {
  return normalizeSpaces([
    obj?.type,
    obj?.assetType,
    obj?.asset_type,
    obj?.kind,
    obj?.category,
    obj?.assetCategory,
  ].filter((v) => typeof v === "string").join(" "));
}

function looksTeamishKey(key) {
  const k = normalizeTeam(key);
  if (!k || COMMON_NON_TEAM_KEYS.has(key) || COMMON_NON_TEAM_KEYS.has(k)) return false;
  if (/^\d+$/.test(k)) return false;

  return NFL_TEAM_HINTS.some((hint) => k === hint || k.includes(hint));
}

function getObjectTeam(obj, inheritedTeam) {
  const direct = getFirstString(obj, TEAM_KEYS);
  if (direct) return direct;
  return inheritedTeam || "";
}

function inferTeamForChildKey(key, currentTeam) {
  if (looksTeamishKey(key)) return key;
  return currentTeam;
}

function extractSelectedPlayerFromPick(obj, text) {
  for (const key of SELECTED_PLAYER_KEYS) {
    if (typeof obj?.[key] === "string") {
      const cleaned = cleanPlayerName(obj[key]);
      if (cleaned) return cleaned;
    }
  }

  const patterns = [
    /\(\s*\d+(?:st|nd|rd|th)\s+overall,\s*([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,5})\s*\)/,
    /\(\s*No\.\s*\d+\s+overall,\s*([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,5})\s*\)/i,
    /used\s+to\s+select\s+([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,5})/i,
    /became\s+([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,5})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanPlayerName(match[1]);
      if (cleaned) return cleaned;
    }
  }

  return null;
}

function extractPlayerAssetName(obj, text) {
  const preferred = getFirstString(obj, ["playerName", "player", "name", "label", "title", "displayName"]);
  const cleanedPreferred = cleanPlayerName(preferred);
  if (cleanedPreferred) return cleanedPreferred;

  const cleanedText = cleanPlayerName(text);
  if (cleanedText) return cleanedText;

  return null;
}

function isPickAsset(typeText, text) {
  return /\bpick\b|\bdraft\b/i.test(typeText) ||
    /\b\d{4}\s+\d+(?:st|nd|rd|th)\s+round pick\b/i.test(text) ||
    /\b\d+(?:st|nd|rd|th)\s+round pick\b/i.test(text) ||
    /\b\d+(?:st|nd|rd|th)\s+overall\b/i.test(text) ||
    /\bdraft pick\b/i.test(text);
}

function isPlayerAsset(typeText, text, obj) {
  if (isPickAsset(typeText, text)) return false;

  if (/\bplayer\b/i.test(typeText)) return true;

  if (typeof obj?.playerName === "string") return true;

  return false;
}

function collectAssets(node, trail = [], inheritedTeam = "", out = []) {
  if (!node || typeof node !== "object") return out;

  if (Array.isArray(node)) {
    node.forEach((child, index) => {
      collectAssets(child, [...trail, String(index)], inheritedTeam, out);
    });
    return out;
  }

  const objectTeam = getObjectTeam(node, inheritedTeam);
  const typeText = getTypeText(node);
  const text = getAssetText(node);

  const pick = isPickAsset(typeText, text);
  const player = isPlayerAsset(typeText, text, node);

  if (pick || player) {
    const selectedPlayer = pick ? extractSelectedPlayerFromPick(node, text) : null;
    const playerName = player ? extractPlayerAssetName(node, text) : null;

    out.push({
      kind: pick ? "PICK" : "PLAYER",
      team: objectTeam,
      teamNorm: normalizeTeam(objectTeam),
      text,
      typeText,
      selectedPlayer,
      selectedNorm: selectedPlayer ? normalizeName(selectedPlayer) : "",
      playerName,
      playerNorm: playerName ? normalizeName(playerName) : "",
      path: trail.join("."),
    });
  }

  for (const [key, child] of Object.entries(node)) {
    if (!child || typeof child !== "object") continue;
    const nextTeam = inferTeamForChildKey(key, objectTeam);
    collectAssets(child, [...trail, key], nextTeam, out);
  }

  return out;
}

function tradeMarkers(node) {
  return normalizeSpaces([
    node?.id,
    node?.slug,
    node?.title,
    node?.date,
    node?.verdict,
    node?.winner,
    node?.summary,
    node?.analysis,
  ].filter((v) => typeof v === "string" || typeof v === "number").join(" "));
}

function looksExplicitlyNonNFL(node, file) {
  const hay = `${file} ${node?.league ?? ""} ${node?.sport ?? ""} ${node?.category ?? ""}`.toLowerCase();
  return /\b(nba|mlb|nhl|wnba|epl|soccer|baseball|basketball|hockey)\b/.test(hay) && !/\bnfl\b/.test(hay);
}

function findCandidateTrades(root, file) {
  const candidates = [];

  function visit(node, trail = []) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, [...trail, String(index)]));
      return;
    }

    if (looksExplicitlyNonNFL(node, file)) return;

    const markers = tradeMarkers(node);
    const hasTradeMarker = Boolean(markers);
    const assets = hasTradeMarker ? collectAssets(node) : [];

    const hasSelectedPick = assets.some((a) => a.kind === "PICK" && a.selectedNorm);
    const hasPlayer = assets.some((a) => a.kind === "PLAYER" && a.playerNorm);

    if (hasTradeMarker && hasSelectedPick && hasPlayer) {
      candidates.push({
        file,
        rootPath: trail.join("."),
        trade: node,
        assets,
      });
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (!child || typeof child !== "object") continue;
      visit(child, [...trail, key]);
    }
  }

  visit(root);
  return candidates;
}

function isSubsequentlyTradedText(...texts) {
  const hay = texts.join(" ").toLowerCase();
  return /subsequent|subsequently|later traded|then traded|eventually traded|ultimately traded|flipped|rerouted|trade tree|rights traded|draft rights|via another trade/.test(hay);
}

function isGenericCompensationText(...texts) {
  const hay = texts.join(" ").toLowerCase();
  return /draft[- ]pick compensation|compensatory|compensation pick|conditional compensation|future considerations|cash considerations|player to be named|ptbnl/.test(hay);
}

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function writeCsv(name, rows) {
  if (!rows.length) {
    fs.writeFileSync(path.join(OUT_DIR, name), "");
    return;
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ];

  fs.writeFileSync(path.join(OUT_DIR, name), lines.join("\n"));
}

const jsonFiles = [...new Set(scanRoots.flatMap((dir) => walkJsonFiles(dir)))];

const rows = [];
let tradeCandidateCount = 0;

for (const file of jsonFiles) {
  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    continue;
  }

  const candidates = findCandidateTrades(parsed, file);
  tradeCandidateCount += candidates.length;

  for (const candidate of candidates) {
    const trade = candidate.trade;
    const picks = candidate.assets.filter((a) => a.kind === "PICK" && a.selectedNorm);
    const players = candidate.assets.filter((a) => a.kind === "PLAYER" && a.playerNorm);

    for (const pick of picks) {
      const exactPlayerMatches = players.filter((p) => p.playerNorm === pick.selectedNorm);

      if (!exactPlayerMatches.length) continue;

      for (const player of exactPlayerMatches) {
        let lane = "";

        if (isGenericCompensationText(pick.text, player.text, pick.selectedPlayer, player.playerName)) {
          lane = "D_GENERIC_DRAFT_PICK_COMPENSATION";
        } else if (pick.teamNorm && player.teamNorm && pick.teamNorm === player.teamNorm) {
          lane = isSubsequentlyTradedText(pick.text, player.text)
            ? "B_SUBSEQUENTLY_TRADED_MANUAL"
            : "A_SAME_TEAM_EXACT_SELECTED_PLAYER_DUPLICATE";
        } else if (pick.teamNorm && player.teamNorm && pick.teamNorm !== player.teamNorm) {
          lane = "C_CROSS_TEAM_SELECTED_PLAYER_PLAYER_ASSET_MANUAL";
        } else {
          lane = "C_CROSS_TEAM_OR_UNKNOWN_TEAM_MANUAL";
        }

        rows.push({
          lane,
          file: rel(file),
          rootPath: candidate.rootPath,
          slug: trade.slug ?? "",
          id: trade.id ?? "",
          date: trade.date ?? "",
          title: trade.title ?? "",
          verdict: trade.verdict ?? trade.winner ?? "",
          selectedPlayer: pick.selectedPlayer,
          pickTeam: pick.team,
          playerTeam: player.team,
          pickText: pick.text,
          playerText: player.text,
          pickPath: pick.path,
          playerPath: player.path,
        });
      }
    }
  }
}

const byLane = rows.reduce((acc, row) => {
  acc[row.lane] = (acc[row.lane] ?? 0) + 1;
  return acc;
}, {});

const summaryLines = [
  "# NFL selected-player display dedupe audit",
  "",
  `JSON files scanned: ${jsonFiles.length}`,
  `Candidate trade objects inspected: ${tradeCandidateCount}`,
  `Total selected-player/player exact-name overlaps found: ${rows.length}`,
  "",
  "## Lane totals",
  "",
  ...Object.entries(byLane)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lane, count]) => `- ${lane}: ${count}`),
  "",
  "## Meaning",
  "",
  "- A = likely display-layer hide case: same team has PICK with selected player embedded and separate PLAYER asset of same name.",
  "- B = manual: looks like selected player may have been subsequently traded or draft rights were involved.",
  "- C = manual: selected player and PLAYER asset appear on different/unknown teams.",
  "- D = separate lane: generic compensation/future-consideration artifacts.",
  "",
  "No trade JSON was modified.",
  "",
];

fs.writeFileSync(path.join(OUT_DIR, "summary.md"), summaryLines.join("\n"));
fs.writeFileSync(path.join(OUT_DIR, "all-lanes.json"), JSON.stringify(rows, null, 2));

writeCsv("all-lanes.csv", rows);
writeCsv("lane-a-same-team-likely-safe.csv", rows.filter((r) => r.lane === "A_SAME_TEAM_EXACT_SELECTED_PLAYER_DUPLICATE"));
writeCsv("lane-b-subsequently-traded-manual.csv", rows.filter((r) => r.lane === "B_SUBSEQUENTLY_TRADED_MANUAL"));
writeCsv("lane-c-cross-team-manual.csv", rows.filter((r) => r.lane.startsWith("C_")));
writeCsv("lane-d-generic-compensation.csv", rows.filter((r) => r.lane === "D_GENERIC_DRAFT_PICK_COMPENSATION"));

console.log(summaryLines.join("\n"));
console.log(`\nWrote reports to: ${path.relative(ROOT, OUT_DIR)}`);
