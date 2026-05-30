const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.join(
  __dirname,
  "..",
  "data-imports",
  "TradeVerdicts_Vikings_Website_Ready_Final_QA.xlsx"
);

const OUTPUT_FILE = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "nfl",
  "trades.json"
);

const SHEET_NAME = "Trade Database";

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

function splitAssets(value) {
  const text = clean(value);

  if (!text || text.toLowerCase() === "tbd") {
    return [];
  }

  return text
    .split(/\n|;|\|/g)
    .map((item) => clean(item))
    .filter(Boolean)
    .map((asset) => ({
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
  if (text.includes("hold")) return "hold-review";
  if (text.includes("ready")) return "ready";

  return text || "ready";
}

function buildTrade(row, index) {
  const primaryTeam = toSlug(row["Primary Team"] || "Minnesota Vikings");
  const partnerTeam = toSlug(row["Trade Partner"]);

  const slug =
    toSlug(row["Slug"]) ||
    `${toSlug(row["Trade Partner"])}-vikings-trade-${index + 1}`;

  const tradeDate = formatDate(row["Date"]);
  const season = tradeDate ? Number(tradeDate.slice(0, 4)) : null;

  const vikingsReceived = splitAssets(row["Vikings Received"]);
  const partnerReceived =
    splitAssets(row["Partner Received"]).length > 0
      ? splitAssets(row["Partner Received"])
      : splitAssets(row["Vikings Sent"]);

  return {
    id: clean(row["Trade ID"]) || `nfl-min-${partnerTeam}-${season || "unknown"}-${index + 1}`,
    slug,
    league: clean(row["League"]) || "NFL",
    tradeDate,
    season,

    teams: [primaryTeam, partnerTeam].filter(Boolean),

    assetsReceived: {
      [primaryTeam]: vikingsReceived,
      [partnerTeam]: partnerReceived,
    },

    tier: normalizeTier(row["Trade Tier"]),
    publishStatus: normalizePublishStatus(row["Publish Status"]),

    verdict: clean(row["Verdict"]) || buildVerdict(row),

    grades: {
      [primaryTeam]: clean(row["Vikings Grade"]),
      [partnerTeam]: clean(row["Partner Grade"]),
    },

    confidence: normalizeConfidence(row["Confidence"]),

    summary: clean(row["Vikings Outcome Synopsis"]),
    partnerSummary: clean(row["Partner Outcome Synopsis"]),
    analysis: buildAnalysis(row),

    qaNotes: clean(row["Final QA Notes"]),
  };
}

function buildVerdict(row) {
  const vikingsGrade = clean(row["Vikings Grade"]);
  const partnerGrade = clean(row["Partner Grade"]);
  const partner = clean(row["Trade Partner"]);

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

  const vikingsScore = gradeRank[vikingsGrade] || 0;
  const partnerScore = gradeRank[partnerGrade] || 0;

  if (vikingsScore > partnerScore) return "Vikings Win";
  if (partnerScore > vikingsScore) return `${partner} Win`;

  return "Even Trade";
}

function buildAnalysis(row) {
  const vikings = clean(row["Vikings Outcome Synopsis"]);
  const partner = clean(row["Partner Outcome Synopsis"]);

  if (vikings && partner) {
    return `${vikings} ${partner}`;
  }

  return vikings || partner || "";
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

  const trades = rows
    .map(buildTrade)
    .filter((trade) => trade.slug)
    .filter((trade) => trade.publishStatus !== "hold-conflict");

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(trades, null, 2));

  console.log(`Imported ${trades.length} Vikings trades.`);
  console.log(`Saved to ${OUTPUT_FILE}`);
}

main();