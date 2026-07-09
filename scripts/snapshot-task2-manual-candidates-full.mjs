import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "src", "data", "nfl", "trades.json");
const OUT_DIR = path.join(ROOT, "audits", "nfl-verdict-grade-consistency-manual-top-level-review");
const OUT_FILE = path.join(OUT_DIR, "active-manual-candidates-full-snapshot.txt");
const DOWNLOADS_OUT = path.join(process.env.USERPROFILE || ROOT, "Downloads", "task2-active-manual-candidates-full-snapshot.txt");

fs.mkdirSync(OUT_DIR, { recursive: true });

const SLUGS = [
  "1984-first-round-pick-28-brian-blados-las-vegas-raiders-1983",
  "1996-1st-round-pick-6th-overall-lawrence-phillips-washington-redskins-1996",
  "2002-3rd-round-pick-89th-overall-washington-redskins-commanders-2002",
  "2022-1st-round-pick-27th-overall-tampa-bay-buccaneers-2022",
  "don-brown-a-arizona-st-louis-cardinals-1960",
  "henry-reed-new-york-giants-1975",
  "jim-germany-arizona-st-louis-cardinals-1975",
  "jim-whalen-new-england-patriots-1970",
  "larry-hickman-arizona-st-louis-cardinals-1960",
  "regan-upshaw-tampa-bay-buccaneers-1999",
];

function normalizeSpaces(value) {
  return String(value ?? "(missing)").replace(/\s+/g, " ").trim();
}

function safeJson(value) {
  if (value === undefined) return "(missing)";
  return JSON.stringify(value, null, 2);
}

const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const bySlug = new Map(data.map((trade, index) => [trade.slug, { trade, index }]));

const lines = [];
lines.push("Task 2 remaining active manual candidates - full snapshot");
lines.push("=========================================================");
lines.push("Source: src/data/nfl/trades.json");
lines.push("Count requested: " + SLUGS.length);
lines.push("");

for (const slug of SLUGS) {
  const hit = bySlug.get(slug);

  lines.push("============================================================");
  lines.push("SLUG: " + slug);

  if (!hit) {
    lines.push("MISSING IN ACTIVE TRADES.JSON");
    lines.push("");
    continue;
  }

  const { trade, index } = hit;

  lines.push("INDEX: " + index);
  lines.push("ID: " + normalizeSpaces(trade.id));
  lines.push("DATE: " + normalizeSpaces(trade.date));
  lines.push("TITLE: " + normalizeSpaces(trade.title));
  lines.push("VERDICT: " + normalizeSpaces(trade.verdict));
  lines.push("WINNER: " + normalizeSpaces(trade.winner));
  lines.push("CONFIDENCE: " + normalizeSpaces(trade.confidence));
  lines.push("TIER: " + normalizeSpaces(trade.tier));
  lines.push("TEAMS: " + safeJson(trade.teams));
  lines.push("TEAM GRADES: " + safeJson(trade.teamGrades || trade.grades || trade.teamGradeCards));
  lines.push("");
  lines.push("ASSETS RECEIVED:");
  lines.push(safeJson(trade.assetsReceived));
  lines.push("");
  lines.push("SUMMARY:");
  lines.push(normalizeSpaces(trade.summary));
  lines.push("");
  lines.push("PARTNER SUMMARY:");
  lines.push(normalizeSpaces(trade.partnerSummary));
  lines.push("");
  lines.push("ANALYSIS:");
  lines.push(normalizeSpaces(trade.analysis));
  lines.push("");
}

fs.writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
fs.writeFileSync(DOWNLOADS_OUT, lines.join("\n"), "utf8");

console.log("Wrote full manual candidate snapshot:");
console.log(OUT_FILE);
console.log("Also wrote:");
console.log(DOWNLOADS_OUT);
console.log("");
console.log("Upload this file if needed:");
console.log(DOWNLOADS_OUT);
console.log("");
console.log("No build was run. No trade JSON was modified.");
