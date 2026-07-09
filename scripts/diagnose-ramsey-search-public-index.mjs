import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SEARCH_FILE = path.join(ROOT, "src", "pages", "search.astro");
const DATA_FILE = path.join(ROOT, "src", "data", "nfl", "trades.json");
const OUT_DIR = path.join(ROOT, "reports", "quality");
fs.mkdirSync(OUT_DIR, { recursive: true });

const TARGETS = [
  "2020-1st-round-pick-20th-overall-los-angeles-st-louis-rams-2019",
  "jalen-ramsey-rams-2023",
  "jalen-ramsey-jonnu-smith-miami-dolphins-2025",
];

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[â€™]/g, "'")
    .replace(/[^a-z0-9#'()+ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function flatText(value, seen = new Set()) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => flatText(item, seen)).join(" ");
  return Object.entries(value).map(([key, child]) => `${key} ${flatText(child, seen)}`).join(" ");
}

function safe(value) {
  return String(value ?? "(missing)").replace(/\s+/g, " ").trim();
}

function getFunctionSnippet(src, name) {
  const marker = `function ${name}`;
  const start = src.indexOf(marker);
  if (start === -1) return `(function ${name} not found)`;

  let i = start;
  let brace = -1;
  while (i < src.length) {
    if (src[i] === "{") {
      brace = i;
      break;
    }
    i++;
  }

  if (brace === -1) return src.slice(start, start + 500);

  let depth = 0;
  for (let j = brace; j < src.length; j++) {
    if (src[j] === "{") depth++;
    if (src[j] === "}") depth--;
    if (depth === 0) return src.slice(start, j + 1);
  }

  return src.slice(start, start + 1000);
}

const searchAstro = fs.readFileSync(SEARCH_FILE, "utf8");
const trades = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

const isPublicSnippet = getFunctionSnippet(searchAstro, "isPublicTrade");
const normalizeSnippet = getFunctionSnippet(searchAstro, "normalize");
const normalizeBasicSnippet = getFunctionSnippet(searchAstro, "normalizeBasic");
const sourceMatchesSnippet = getFunctionSnippet(searchAstro, "sourceMatchesQuery");

const lines = [];
lines.push("# Ramsey search/public diagnostic");
lines.push("");
lines.push("## search.astro function snippets");
lines.push("");
lines.push("### isPublicTrade");
lines.push("```js");
lines.push(isPublicSnippet);
lines.push("```");
lines.push("");
lines.push("### normalizeBasic");
lines.push("```js");
lines.push(normalizeBasicSnippet);
lines.push("```");
lines.push("");
lines.push("### sourceMatchesQuery");
lines.push("```js");
lines.push(sourceMatchesSnippet);
lines.push("```");
lines.push("");

lines.push("## Target Ramsey records in active trades.json");
lines.push("");

for (const slug of TARGETS) {
  const index = trades.findIndex((trade) => trade?.slug === slug);
  const trade = trades[index];

  lines.push("============================================================");
  lines.push("SLUG: " + slug);
  lines.push("INDEX: " + index);

  if (!trade) {
    lines.push("MISSING");
    lines.push("");
    continue;
  }

  const text = normalize(flatText(trade));
  const keys = Object.keys(trade).sort();
  const possiblePublicFields = Object.fromEntries(
    keys
      .filter((key) => /public|publish|published|visibility|hidden|status|draft|private|show|page|slug|tier|confidence/i.test(key))
      .map((key) => [key, trade[key]])
  );

  lines.push("ID: " + safe(trade.id));
  lines.push("VERDICT: " + safe(trade.verdict));
  lines.push("TIER: " + safe(trade.tier));
  lines.push("CONFIDENCE: " + safe(trade.confidence));
  lines.push("TEAMS: " + JSON.stringify(trade.teams || []));
  lines.push("POSSIBLE PUBLIC/VISIBILITY FIELDS:");
  lines.push(JSON.stringify(possiblePublicFields, null, 2));
  lines.push("EXACT JALEN RAMSEY IN FULL ACTIVE TEXT: " + text.includes("jalen ramsey"));
  lines.push("HAS JALEN TOKEN: " + text.split(/\s+/).includes("jalen"));
  lines.push("HAS RAMSEY TOKEN: " + text.split(/\s+/).includes("ramsey"));
  lines.push("SUMMARY: " + safe(trade.summary));
  lines.push("PARTNER SUMMARY: " + safe(trade.partnerSummary));
  lines.push("ANALYSIS: " + safe(trade.analysis).slice(0, 700));
  lines.push("");
}

const out = path.join(OUT_DIR, "ramsey-search-public-diagnostic.txt");
fs.writeFileSync(out, lines.join("\n"), "utf8");

console.log(lines.join("\n"));
console.log("");
console.log("Wrote reports/quality/ramsey-search-public-diagnostic.txt");
console.log("No build was run. No files were modified.");
