const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const INPUT_CANDIDATES = [
  path.join(__dirname, "..", "data-imports", "TradeVerdicts_Seahawks.xlsx"),
  path.join(__dirname, "..", "data-imports", "TradeVerdicts_Seahawks_Regraded.xlsx"),
  path.join(__dirname, "..", "data-imports", "TradeVerdicts_Seahawks(5).xlsx"),
];

const OUTPUT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");
const DUPLICATE_REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "possible-duplicates.json");
const PLAYERS_OUTPUT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "players.json");

const SHEET_NAME = "Trade Database";
const SOURCE_TEAM_NAME = "Seattle Seahawks";
const SOURCE_TEAM = "seattle-seahawks";

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function toSlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\//g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findInputFile() {
  const found = INPUT_CANDIDATES.find((file) => fs.existsSync(file));
  if (!found) {
    console.error("Could not find Seahawks import file. Tried:");
    INPUT_CANDIDATES.forEach((file) => console.error(`- ${file}`));
    process.exit(1);
  }
  return found;
}

function formatDate(value) {
  if (!value) return "";
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return "";
}

function normalizeHeader(header) {
  return clean(header).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[normalizeHeader(key)] = value;
  }

  return {
    id: clean(out.tradeid),
    date: out.date,
    league: clean(out.league) || "NFL",
    primaryTeam: clean(out.primaryteam) || SOURCE_TEAM_NAME,
    partnerTeam: clean(out.tradepartner),
    seahawksReceived: clean(out.seahawksreceived),
    seahawksSent: clean(out.seahawkssent),
    partnerReceived: clean(out.partnerreceived),
    partnerSent: clean(out.partnersent),
    summary: clean(out.seahawksoutcomesynopsis),
    partnerSummary: clean(out.partneroutcomesynopsis),
    seahawksGrade: clean(out.seahawksgrade),
    partnerGrade: clean(out.partnergrade),
    confidence: clean(out.confidence),
    reviewStatus: clean(out.reviewstatus),
    sourceRawText: clean(out.sourcerawtext),
    reviewStatusNote: clean(out.reviewstatusnote),
    cleanupNotes: clean(out.cleanupnotes),
    slug: clean(out.slug),
    tier: clean(out.tradetier),
    publishStatus: clean(out.publishstatus),
    finalQaNotes: clean(out.finalqanotes),
  };
}

function cleanPublicText(value) {
  const text = clean(value);
  const lower = text.toLowerCase();

  const badPhrases = [
    "first-pass neutral grade",
    "first-pass grade depends",
    "available raw trade text",
    "requiring outside verification",
    "pending deeper player-level verification",
    "needs human/stat pass-through",
    "created from raw franchise-history text",
  ];

  if (badPhrases.some((phrase) => lower.includes(phrase))) return "";
  return text;
}

function inferAssetType(asset) {
  const lower = clean(asset).toLowerCase();
  if (lower.includes("pick") || lower.includes("round") || lower.includes("draft") || /\b\d{4}\b/.test(lower)) return "pick";
  if (lower.includes("cash") || lower.includes("considerations") || lower.includes("rights")) return "other";
  return "player";
}

function parseAssetList(value) {
  const text = clean(value);
  if (!text || text.toLowerCase() === "tbd" || text.toLowerCase() === "n/a") return [];

  return text
    .split(/\n|;|\|/g)
    .map(clean)
    .filter(Boolean);
}

function splitAssets(value) {
  return parseAssetList(value).map((asset) => ({
    type: inferAssetType(asset),
    asset,
  }));
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

function normalizeTier(value) {
  const text = clean(value).toLowerCase();
  if (text.includes("historic")) return "major";
  if (text.includes("major")) return "major";
  if (text.includes("minor")) return "minor";
  return "standard";
}

function normalizeConfidence(value) {
  const text = clean(value).toLowerCase();
  if (text.includes("high")) return "high";
  if (text.includes("low")) return "low";
  return "medium";
}

function normalizePublishStatus(value) {
  const text = clean(value).toLowerCase();
  if (text.includes("conflict")) return "hold-conflict";
  if (text.includes("hold") && text.includes("provisional")) return "provisional";
  if (text.includes("provisional")) return "provisional";
  if (text.includes("review")) return "review";
  if (text.includes("hold")) return "hold-review";
  if (text.includes("ready")) return "ready";
  return text || "ready";
}

function gradeScore(grade) {
  const rank = {
    "A+": 13, A: 12, "A-": 11,
    "B+": 10, B: 9, "B-": 8,
    "C+": 7, C: 6, "C-": 5,
    "D+": 4, D: 3, "D-": 2,
    F: 1,
  };
  return rank[clean(grade).toUpperCase()] || 0;
}

function buildVerdict(primaryTeamName, primaryGrade, partnerTeamName, partnerGrade) {
  const primaryScore = gradeScore(primaryGrade);
  const partnerScore = gradeScore(partnerGrade);

  if (primaryScore > partnerScore) return `${primaryTeamName} Win`;
  if (partnerScore > primaryScore) return `${partnerTeamName} Win`;
  return "Even Trade";
}

function buildCanonicalKey({ tradeDate, teams, assets }) {
  const teamKey = teams.filter(Boolean).sort().join("|");
  const assetKey = assets
    .map((item) => normalizeAssetText(item.asset))
    .filter(Boolean)
    .sort()
    .join("|");

  return `${tradeDate}|${teamKey}|${assetKey}`;
}

function buildDateTeamsKey({ tradeDate, teams }) {
  return `${tradeDate}|${teams.filter(Boolean).sort().join("|")}`;
}

function isMalformedRow(row) {
  const tradeDate = formatDate(row.date);
  const partnerTeam = clean(row.partnerTeam);
  const hasAssets =
    clean(row.seahawksReceived) ||
    clean(row.seahawksSent) ||
    clean(row.partnerReceived) ||
    clean(row.partnerSent);

  return !tradeDate || !partnerTeam || !hasAssets;
}

function buildTrade(rawRow, index) {
  const row = normalizeRow(rawRow);
  if (isMalformedRow(row)) return null;

  const primaryTeamName = clean(row.primaryTeam) || SOURCE_TEAM_NAME;
  const partnerTeamName = clean(row.partnerTeam);
  const primaryTeam = toSlug(primaryTeamName);
  const partnerTeam = toSlug(partnerTeamName);
  const tradeDate = formatDate(row.date);
  const season = Number(tradeDate.slice(0, 4));

  const primaryReceived = splitAssets(row.seahawksReceived);
  const partnerReceived = splitAssets(row.partnerReceived || row.seahawksSent);
  const teams = [primaryTeam, partnerTeam].filter(Boolean);
  const allAssets = [...primaryReceived, ...partnerReceived];

  if (!teams.length || !allAssets.length) return null;

  const publishStatus = normalizePublishStatus(row.publishStatus);
  if (publishStatus === "hold-conflict") return null;

  const canonicalKey = buildCanonicalKey({ tradeDate, teams, assets: allAssets });
  const dateTeamsKey = buildDateTeamsKey({ tradeDate, teams });

  const slug =
    toSlug(row.slug) ||
    `${toSlug(row.seahawksReceived || row.seahawksSent || "seahawks-trade")}-${partnerTeam}-${season}-${index + 1}`;

  const qaNotes = [row.finalQaNotes, row.cleanupNotes, row.reviewStatusNote]
    .map(clean)
    .filter(Boolean)
    .join(" | ");

  const summary = cleanPublicText(row.summary);
  const partnerSummary = cleanPublicText(row.partnerSummary);
  const analysis = cleanPublicText([summary, partnerSummary].filter(Boolean).join(" "));

  return {
    id: clean(row.id) || `nfl-${primaryTeam}-${partnerTeam}-${season}-${index + 1}`,
    canonicalKey,
    dateTeamsKey,
    slug,
    league: clean(row.league) || "NFL",
    tradeDate,
    season,
    teams,

    assetsReceived: {
      [primaryTeam]: primaryReceived,
      [partnerTeam]: partnerReceived,
    },

    tier: normalizeTier(row.tier),
    publishStatus,

    verdict: buildVerdict(primaryTeamName, row.seahawksGrade, partnerTeamName, row.partnerGrade),

    grades: {
      [primaryTeam]: clean(row.seahawksGrade),
      [partnerTeam]: clean(row.partnerGrade),
    },

    confidence: normalizeConfidence(row.confidence),
    summary,
    partnerSummary,
    analysis,
    qaNotes,

    sourceTeams: [primaryTeam],

    perspectives: [
      {
        sourceTeam: primaryTeam,
        sourceTradeId: clean(row.id),
        sourceRow: index + 2,
        primaryTeam,
        partnerTeam,
        primarySummary: summary,
        partnerSummary,
        primaryGrade: clean(row.seahawksGrade),
        partnerGrade: clean(row.partnerGrade),
        publishStatus,
        qaNotes,
      },
    ],
  };
}

function readExistingTrades() {
  if (!fs.existsSync(OUTPUT_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isBadUnknownSeahawksRecord(trade) {
  const slug = clean(trade.slug);
  const teams = trade.teams || [];
  const assets = Object.values(trade.assetsReceived || {}).flat();

  if (slug === "unknown-seattle-seahawks-trade-unknown-1") return true;
  if (!clean(trade.tradeDate) && teams.includes(SOURCE_TEAM) && assets.length === 0) return true;

  return false;
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
  ].join("|");
}

function mergePerspectivesReplacingSeahawks(existing = [], incoming = []) {
  const incomingHasSeahawks = incoming.some((p) => p.sourceTeam === SOURCE_TEAM);

  const base = incomingHasSeahawks
    ? existing.filter((p) => p.sourceTeam !== SOURCE_TEAM)
    : existing;

  const merged = [];
  const seen = new Set();

  for (const perspective of [...base, ...incoming]) {
    const key = perspectiveKey(perspective);
    if (seen.has(key)) continue;
    merged.push(perspective);
    seen.add(key);
  }

  return merged;
}

function mergeUniqueText(...values) {
  return [...new Set(values.map(clean).filter(Boolean))].join(" | ");
}

function mergeGradesPreferIncoming(existing = {}, incoming = {}) {
  return { ...existing, ...incoming };
}

function buildTradeIdentityKey(trade) {
  const date = clean(trade.tradeDate || trade.date);
  const teams = (trade.teams || [])
    .map(toSlug)
    .filter(Boolean)
    .sort()
    .join("|");

  if (!date || !teams) return "";
  return `${date}|${teams}`;
}

function findExistingTrade(existingTrades, incoming) {
  const incomingIdentityKey = buildTradeIdentityKey(incoming);

  return existingTrades.find((trade) => {
    if (clean(trade.canonicalKey) && trade.canonicalKey === incoming.canonicalKey) return true;
    if (clean(trade.id) && trade.id === incoming.id) return true;
    if (clean(trade.slug) && trade.slug === incoming.slug) return true;

    const existingIdentityKey = buildTradeIdentityKey(trade);
    if (existingIdentityKey && incomingIdentityKey && existingIdentityKey === incomingIdentityKey) return true;

    return false;
  });
}

function isIncomingSeahawksTrade(incoming) {
  return incoming.sourceTeams?.includes(SOURCE_TEAM) || incoming.teams?.includes(SOURCE_TEAM);
}

function mergeTrade(existing, incoming) {
  const incomingIsSeahawks = isIncomingSeahawksTrade(incoming);

  const mergedTeams = Array.from(new Set([...(existing.teams || []), ...(incoming.teams || [])]));

  const assetsReceived = { ...(existing.assetsReceived || {}) };
  for (const [team, assets] of Object.entries(incoming.assetsReceived || {})) {
    assetsReceived[team] = mergeUniqueAssets(assetsReceived[team] || [], assets || []);
  }

  return {
    ...existing,

    canonicalKey: existing.canonicalKey || incoming.canonicalKey,
    dateTeamsKey: existing.dateTeamsKey || incoming.dateTeamsKey,
    teams: mergedTeams,
    assetsReceived,

    // IMPORTANT FIX:
    // For this Seahawks import, the spreadsheet is now the source of truth for
    // Seahawks grades, verdict, summaries, confidence, and public-facing analysis.
    verdict: incomingIsSeahawks ? incoming.verdict : existing.verdict || incoming.verdict,
    grades: incomingIsSeahawks
      ? mergeGradesPreferIncoming(existing.grades || {}, incoming.grades || {})
      : mergeGradesPreferIncoming(incoming.grades || {}, existing.grades || {}),

    summary: incomingIsSeahawks && incoming.summary ? incoming.summary : existing.summary || incoming.summary,
    partnerSummary:
      incomingIsSeahawks && incoming.partnerSummary
        ? incoming.partnerSummary
        : existing.partnerSummary || incoming.partnerSummary,
    analysis: incomingIsSeahawks && incoming.analysis ? incoming.analysis : existing.analysis || incoming.analysis,

    confidence: incomingIsSeahawks
      ? incoming.confidence || existing.confidence
      : existing.confidence === "high" || incoming.confidence === "high"
        ? "high"
        : existing.confidence || incoming.confidence,

    publishStatus: incomingIsSeahawks
      ? incoming.publishStatus || existing.publishStatus
      : existing.publishStatus === "ready" || incoming.publishStatus === "ready"
        ? "ready"
        : existing.publishStatus || incoming.publishStatus,

    sourceTeams: Array.from(new Set([...(existing.sourceTeams || []), ...(incoming.sourceTeams || [])])),
    perspectives: mergePerspectivesReplacingSeahawks(existing.perspectives || [], incoming.perspectives || []),

    qaNotes: incomingIsSeahawks
      ? mergeUniqueText(incoming.qaNotes, existing.qaNotes)
      : mergeUniqueText(existing.qaNotes, incoming.qaNotes),
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
  if (assetType === "player") names.push(cleanPlayerName(text));

  const parenMatches = [...text.matchAll(/\(([^)]*)\)/g)];
  for (const match of parenMatches) {
    const parts = match[1].split(",").map(clean);
    const maybeName = parts[parts.length - 1];

    if (/^[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)+$/.test(maybeName)) {
      names.push(cleanPlayerName(maybeName));
    }
  }

  return [...new Set(names)].filter(Boolean);
}

function generatePlayersFile(trades) {
  const playersMap = new Map();

  for (const trade of trades) {
    for (const [team, assets] of Object.entries(trade.assetsReceived || {})) {
      for (const item of assets || []) {
        for (const name of extractPlayerNamesFromAsset(item.asset, item.type)) {
          const slug = toSlug(name);
          if (!slug) continue;

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

  fs.writeFileSync(PLAYERS_OUTPUT_FILE, JSON.stringify(players, null, 2));
  console.log(`Generated ${players.length} NFL player records.`);
}

function main() {
  const inputFile = findInputFile();

  const workbook = XLSX.readFile(inputFile, { cellDates: true });
  const sheet = workbook.Sheets[SHEET_NAME];

  if (!sheet) {
    console.error(`Could not find sheet named "${SHEET_NAME}".`);
    console.error(`Available sheets: ${workbook.SheetNames.join(", ")}`);
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  const incomingTrades = rows.map(buildTrade).filter(Boolean);

  const existingTrades = readExistingTrades().filter((trade) => !isBadUnknownSeahawksRecord(trade));
  const finalTrades = [...existingTrades];
  const possibleDuplicates = [];

  let added = 0;
  let merged = 0;
  let refreshed = 0;

  for (const incoming of incomingTrades) {
    const existing = findExistingTrade(finalTrades, incoming);

    if (existing) {
      const index = finalTrades.indexOf(existing);
      const beforeVerdict = existing.verdict;

      const mergedByDateTeams =
        buildTradeIdentityKey(existing) === buildTradeIdentityKey(incoming) &&
        existing.canonicalKey !== incoming.canonicalKey;

      finalTrades[index] = mergeTrade(existing, incoming);
      merged++;

      if (beforeVerdict !== finalTrades[index].verdict) refreshed++;

      if (mergedByDateTeams) {
        possibleDuplicates.push({
          incomingSlug: incoming.slug,
          existingSlug: existing.slug,
          dateTeamsKey: incoming.dateTeamsKey,
          action: "merged-by-date-teams",
          reason: "Same date and same teams. Merged as crossover perspective while refreshing Seahawks data.",
        });
      }

      continue;
    }

    finalTrades.push(incoming);
    added++;
  }

  finalTrades.sort((a, b) => {
    const ad = clean(a.tradeDate);
    const bd = clean(b.tradeDate);
    if (!ad && !bd) return clean(a.slug).localeCompare(clean(b.slug));
    if (!ad) return 1;
    if (!bd) return -1;
    return new Date(ad) - new Date(bd);
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalTrades, null, 2));
  fs.writeFileSync(DUPLICATE_REPORT_FILE, JSON.stringify(possibleDuplicates, null, 2));
  generatePlayersFile(finalTrades);

  const seahawksTrades = finalTrades.filter((trade) => trade.teams?.includes(SOURCE_TEAM));
  const breakdown = {};
  for (const trade of seahawksTrades) {
    breakdown[trade.verdict] = (breakdown[trade.verdict] || 0) + 1;
  }

  console.log(`Input file: ${inputFile}`);
  console.log(`Raw spreadsheet rows: ${rows.length}`);
  console.log(`Incoming Seahawks trades: ${incomingTrades.length}`);
  console.log(`Existing trades before import: ${existingTrades.length}`);
  console.log(`Added: ${added}`);
  console.log(`Merged into existing trades: ${merged}`);
  console.log(`Top-level verdicts refreshed: ${refreshed}`);
  console.log(`Duplicate/crossover report entries: ${possibleDuplicates.length}`);
  console.log(`Final trade count: ${finalTrades.length}`);
  console.log("Seahawks verdict breakdown:", breakdown);
  console.log(`Saved trades to ${OUTPUT_FILE}`);
  console.log(`Saved duplicate report to ${DUPLICATE_REPORT_FILE}`);
  console.log(`Saved players to ${PLAYERS_OUTPUT_FILE}`);
}

main();