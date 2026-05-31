const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.join(__dirname, "..", "data-imports", "TradeVerdicts_Seahawks.xlsx");

const OUTPUT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");

const DUPLICATE_REPORT_FILE = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "nfl",
  "possible-duplicates.json"
);

const SHEET_NAME = "trades";
const SOURCE_TEAM_FALLBACK = "Seattle Seahawks";

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

function formatDate(value) {
  if (!value) return "";

  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    const month = String(parsed.m).padStart(2, "0");
    const day = String(parsed.d).padStart(2, "0");
    return `${parsed.y}-${month}-${day}`;
  }

  const date = new Date(value);
  if (!isNaN(date)) {
    return date.toISOString().split("T")[0];
  }

  return clean(value);
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

  if (badPhrases.some((phrase) => lower.includes(phrase))) {
    return "";
  }

  return text;
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

function parseAssetList(value) {
  const text = clean(value);

  if (!text || text.toLowerCase() === "tbd") return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    const quotedMatches = [...text.matchAll(/'([^']+)'|"([^"]+)"/g)]
      .map((match) => clean(match[1] || match[2]))
      .filter(Boolean);

    if (quotedMatches.length > 0) return quotedMatches;
  }

  return text
    .split(/\n|;|\|/g)
    .map((item) => clean(item))
    .filter(Boolean);
}

function splitAssets(value) {
  return parseAssetList(value).map((asset) => ({
    type: inferAssetType(asset),
    asset,
  }));
}

function inferAssetType(asset) {
  const lower = asset.toLowerCase();

  if (
    lower.includes("pick") ||
    lower.includes("round") ||
    lower.includes("draft") ||
    /\b\d{4}\b/.test(lower)
  ) {
    return "pick";
  }

  if (
    lower.includes("cash") ||
    lower.includes("considerations") ||
    lower.includes("rights")
  ) {
    return "other";
  }

  return "player";
}

function normalizeConfidence(value) {
  const text = clean(value).toLowerCase();

  if (text.includes("high")) return "high";
  if (text.includes("medium")) return "medium";
  if (text.includes("low")) return "low";

  return text || "medium";
}

function normalizeTier(value) {
  const text = clean(value).toLowerCase();

  if (text.includes("major")) return "major";
  if (text.includes("standard")) return "standard";
  if (text.includes("minor")) return "minor";

  return "standard";
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

function buildCanonicalKey({ tradeDate, teams, assets }) {
  const normalizedTeams = [...teams].filter(Boolean).sort().join("|");

  const normalizedAssets = assets
    .map((item) => normalizeAssetText(item.asset))
    .filter(Boolean)
    .sort()
    .join("|");

  return `${tradeDate}|${normalizedTeams}|${normalizedAssets}`;
}

function buildDateTeamsKey({ tradeDate, teams }) {
  const normalizedTeams = [...teams].filter(Boolean).sort().join("|");
  return `${tradeDate}|${normalizedTeams}`;
}

function buildVerdictFromGrades(primaryTeamName, primaryGrade, partnerTeamName, partnerGrade) {
  const gradeRank = {
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

  const primaryScore = gradeRank[clean(primaryGrade)] || 0;
  const partnerScore = gradeRank[clean(partnerGrade)] || 0;

  if (primaryScore > partnerScore) return `${primaryTeamName} Win`;
  if (partnerScore > primaryScore) return `${partnerTeamName} Win`;

  return "Even Trade";
}

function buildAnalysis(row) {
  const seahawks = clean(row.summary);
  const partner = clean(row.partnerSummary);

  if (seahawks && partner) return `${seahawks} ${partner}`;
  return seahawks || partner || "";
}

function buildTrade(row, index) {
  const primaryTeam = toSlug(row.primaryTeamId || row.primaryTeam || SOURCE_TEAM_FALLBACK);
  const partnerTeam = toSlug(row.partnerTeamId || row.partnerTeam);
  const primaryTeamName = clean(row.primaryTeam || SOURCE_TEAM_FALLBACK);
  const partnerTeamName = clean(row.partnerTeam || partnerTeam);
  const tradeDate = formatDate(row.date);
  const season = tradeDate ? Number(tradeDate.slice(0, 4)) : null;

  const primaryReceived = splitAssets(row.seahawksReceived);
  const partnerReceived =
    splitAssets(row.partnerReceived).length > 0
      ? splitAssets(row.partnerReceived)
      : splitAssets(row.seahawksSent);

  const allAssets = [...primaryReceived, ...partnerReceived];
  const teams = [primaryTeam, partnerTeam].filter(Boolean);

  const canonicalKey = buildCanonicalKey({
    tradeDate,
    teams,
    assets: allAssets,
  });

  const dateTeamsKey = buildDateTeamsKey({
    tradeDate,
    teams,
  });

  const slug =
    toSlug(row.slug) ||
    `${partnerTeam || "unknown"}-${primaryTeam}-trade-${season || "unknown"}-${index + 1}`;

  const publishStatus = normalizePublishStatus(row.publishStatus);

  return {
    id:
      clean(row.id) ||
      `nfl-${primaryTeam}-${partnerTeam || "unknown"}-${season || "unknown"}-${index + 1}`,

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

    verdict: buildVerdictFromGrades(
      primaryTeamName,
      row.seahawksGrade,
      partnerTeamName,
      row.partnerGrade
    ),

    grades: {
      [primaryTeam]: clean(row.seahawksGrade),
      [partnerTeam]: clean(row.partnerGrade),
    },

    confidence: normalizeConfidence(row.confidence),

    summary: cleanPublicText(row.summary),
partnerSummary: cleanPublicText(row.partnerSummary),
analysis: cleanPublicText(buildAnalysis(row)),

    qaNotes: clean(row.finalQaNotes || row.cleanupNotes || row.reviewNote),

    sourceTeams: [primaryTeam],

    
          perspectives: [
      {
        sourceTeam: primaryTeam,
        sourceTradeId: clean(row.id),
        sourceRow: index + 2,
        primaryTeam,
        partnerTeam,
        primarySummary: cleanPublicText(row.summary),
        partnerSummary: cleanPublicText(row.partnerSummary),
        primaryGrade: clean(row.seahawksGrade),
        partnerGrade: clean(row.partnerGrade),
        publishStatus,
        qaNotes: clean(row.finalQaNotes || row.cleanupNotes || row.reviewNote),
      },
    ],
  };
}

function readExistingTrades() {
  if (!fs.existsSync(OUTPUT_FILE)) return [];

  try {
    const raw = fs.readFileSync(OUTPUT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeUniqueAssets(existingAssets = [], incomingAssets = []) {
  const seen = new Set(existingAssets.map((item) => normalizeAssetText(item.asset)));
  const merged = [...existingAssets];

  for (const item of incomingAssets) {
    const key = normalizeAssetText(item.asset);
    if (!seen.has(key)) {
      merged.push(item);
      seen.add(key);
    }
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
  ].join("|");
}

function mergeUniquePerspectives(existingPerspectives = [], incomingPerspectives = []) {
  const merged = [];
  const seen = new Set();

  for (const perspective of [...existingPerspectives, ...incomingPerspectives]) {
    const key = perspectiveKey(perspective);
    if (!seen.has(key)) {
      merged.push(perspective);
      seen.add(key);
    }
  }

  return merged;
}

function mergeUniqueText(...values) {
  return [...new Set(values.filter(Boolean).map(clean))]
    .filter(Boolean)
    .join(" | ");
}

function mergeGradesPreserveExisting(existingGrades = {}, incomingGrades = {}) {
  const merged = { ...existingGrades };

  for (const [team, grade] of Object.entries(incomingGrades)) {
    if (!merged[team] && grade) {
      merged[team] = grade;
    }
  }

  return merged;
}

function mergeTrade(existing, incoming) {
  const mergedTeams = Array.from(new Set([...(existing.teams || []), ...(incoming.teams || [])]));

  const mergedAssetsReceived = { ...(existing.assetsReceived || {}) };

  for (const team of Object.keys(incoming.assetsReceived || {})) {
    mergedAssetsReceived[team] = mergeUniqueAssets(
      mergedAssetsReceived[team] || [],
      incoming.assetsReceived[team] || []
    );
  }

  const mergedSourceTeams = Array.from(
    new Set([...(existing.sourceTeams || []), ...(incoming.sourceTeams || [])])
  );

  return {
    ...existing,

    canonicalKey: existing.canonicalKey || incoming.canonicalKey,
    dateTeamsKey: existing.dateTeamsKey || incoming.dateTeamsKey,

    teams: mergedTeams,
    assetsReceived: mergedAssetsReceived,

    grades: mergeGradesPreserveExisting(existing.grades || {}, incoming.grades || {}),

    sourceTeams: mergedSourceTeams,
    perspectives: mergeUniquePerspectives(existing.perspectives || [], incoming.perspectives || []),

    confidence:
      existing.confidence === "high" || incoming.confidence === "high"
        ? "high"
        : existing.confidence || incoming.confidence,

    publishStatus:
      existing.publishStatus === "ready" || incoming.publishStatus === "ready"
        ? "ready"
        : existing.publishStatus || incoming.publishStatus,

    qaNotes: mergeUniqueText(existing.qaNotes, incoming.qaNotes),
  };
}

function buildTradeIdentityKey(trade) {
  const date = clean(trade.tradeDate || trade.date);

  const teams = (trade.teams || [])
    .map((team) => toSlug(team))
    .filter(Boolean)
    .sort()
    .join("|");

  return `${date}|${teams}`;
}

function findExistingTrade(existingTrades, incoming) {
  const incomingIdentityKey = buildTradeIdentityKey(incoming);

  return existingTrades.find((trade) => {
    const existingIdentityKey = buildTradeIdentityKey(trade);

    if (trade.canonicalKey && trade.canonicalKey === incoming.canonicalKey) return true;
    if (trade.id && trade.id === incoming.id) return true;
    if (trade.slug && trade.slug === incoming.slug) return true;

    // Critical future-safe crossover rule:
    // Same date + same sorted teams = same real-world trade candidate.
    // This avoids relying on old/stale dateTeamsKey formats.
    if (existingIdentityKey && existingIdentityKey === incomingIdentityKey) return true;

    return false;
  });
}

function findPossibleDuplicate(existingTrades, incoming) {
  const incomingIdentityKey = buildTradeIdentityKey(incoming);

  return existingTrades.find((trade) => {
    const existingIdentityKey = buildTradeIdentityKey(trade);

    if (!existingIdentityKey || !incomingIdentityKey) return false;
    if (existingIdentityKey !== incomingIdentityKey) return false;
    if (trade.canonicalKey === incoming.canonicalKey) return false;

    return true;
  });
}

function findPossibleDuplicate(existingTrades, incoming) {
  return existingTrades.find((trade) => {
    if (!trade.dateTeamsKey || !incoming.dateTeamsKey) return false;
    if (trade.dateTeamsKey !== incoming.dateTeamsKey) return false;
    if (trade.canonicalKey === incoming.canonicalKey) return false;

    return true;
  });
  
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

  const beforePick = text.split(/\b\d{4}\b/)[0].trim();

  if (beforePick && beforePick.length > 3 && !beforePick.toLowerCase().includes("pick")) {
    names.push(cleanPlayerName(beforePick.replace(/\band\b$/i, "")));
  }

  const parenthesesMatches = [...text.matchAll(/\(([^)]*)\)/g)];

  for (const match of parenthesesMatches) {
    const inside = match[1];
    const parts = inside.split(",").map((part) => clean(part));
    const possibleName = parts[parts.length - 1];

    if (
      possibleName &&
      /^[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)+$/.test(possibleName)
    ) {
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

  const playersOutputFile = path.join(__dirname, "..", "src", "data", "nfl", "players.json");

  fs.writeFileSync(playersOutputFile, JSON.stringify(players, null, 2));
  console.log(`Generated ${players.length} NFL player records.`);
  console.log(`Saved players to ${playersOutputFile}`);
}

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Could not find input file: ${INPUT_FILE}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(INPUT_FILE);
  const sheet = workbook.Sheets[SHEET_NAME];

  if (!sheet) {
    console.error(`Could not find sheet named "${SHEET_NAME}".`);
    console.error("Available sheets:", workbook.SheetNames.join(", "));
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const incomingTrades = rows
    .map(buildTrade)
    .filter((trade) => trade.slug)
    .filter((trade) => trade.publishStatus !== "hold-conflict");

  const existingTrades = readExistingTrades();
  const finalTrades = [...existingTrades];
  const possibleDuplicates = [];

  let added = 0;
  let merged = 0;

  for (const incoming of incomingTrades) {
    const existing = findExistingTrade(finalTrades, incoming);

    if (existing) {
      const index = finalTrades.indexOf(existing);
      const wasDateTeamsMerge =
  buildTradeIdentityKey(existing) === buildTradeIdentityKey(incoming) &&
  existing.canonicalKey !== incoming.canonicalKey;

      finalTrades[index] = mergeTrade(existing, incoming);
      merged++;

      if (wasDateTeamsMerge) {
        possibleDuplicates.push({
          incomingSlug: incoming.slug,
          existingSlug: existing.slug,
          dateTeamsKey: incoming.dateTeamsKey,
          action: "merged-by-dateTeamsKey",
          reason:
            "Same trade date and same teams. Merged as crossover perspective while preserving existing canonical page.",
        });
      }

      continue;
    }

    const possibleDuplicate = findPossibleDuplicate(finalTrades, incoming);

    if (possibleDuplicate) {
      possibleDuplicates.push({
        incomingSlug: incoming.slug,
        existingSlug: possibleDuplicate.slug,
        dateTeamsKey: incoming.dateTeamsKey,
        action: "review-only",
        reason:
          "Same trade date and same teams, but different canonical asset fingerprint. Review manually.",
      });
    }

    finalTrades.push(incoming);
    added++;
  }

  finalTrades.sort((a, b) => new Date(a.tradeDate) - new Date(b.tradeDate));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalTrades, null, 2));
  generatePlayersFile(finalTrades);
  fs.writeFileSync(DUPLICATE_REPORT_FILE, JSON.stringify(possibleDuplicates, null, 2));

  console.log(`Incoming Seahawks trades: ${incomingTrades.length}`);
  console.log(`Existing trades before import: ${existingTrades.length}`);
  console.log(`Added: ${added}`);
  console.log(`Merged into existing trades: ${merged}`);
  console.log(`Duplicate/crossover report entries: ${possibleDuplicates.length}`);
  console.log(`Final trade count: ${finalTrades.length}`);
  console.log(`Saved trades to ${OUTPUT_FILE}`);
  console.log(`Saved duplicate report to ${DUPLICATE_REPORT_FILE}`);
}

main();