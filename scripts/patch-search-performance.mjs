import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const SEARCH_FILE = path.join(ROOT, "src", "pages", "search.astro");
const OUT_DIR = path.join(ROOT, "reports", "quality");
fs.mkdirSync(OUT_DIR, { recursive: true });

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function replaceOnce(text, from, to, label, changes) {
  if (!text.includes(from)) {
    throw new Error("Could not find patch target: " + label);
  }

  const next = text.replace(from, to);
  changes.push({ label, status: next === text ? "unchanged" : "changed" });
  return next;
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

const before = fs.readFileSync(SEARCH_FILE, "utf8");
let after = before;
const changes = [];

// Add compact search text builders before the publicTrades/searchIndex block.
// This keeps player names, pick names, teams, verdicts, summaries, and asset fields searchable,
// while avoiding the huge full safeJson(trade) blob and long analysis payload for every record.
after = replaceOnce(
  after,
  `const publicTrades = rows.filter(isPublicTrade);

const searchIndex = publicTrades.map((trade) => ({`,
  `function flattenSearchValue(value, depth = 0) {
  if (value == null || depth > 4) return "";

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => flattenSearchValue(item, depth + 1)).join(" ");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, child]) => key + " " + flattenSearchValue(child, depth + 1))
      .join(" ");
  }

  return "";
}

function compactSearchText(trade) {
  const assetText = flattenSearchValue(trade.assetsReceived || trade.assets || trade.assetsSent || trade.tradeAssets);
  const teamText = [
    ...(Array.isArray(trade.teams) ? trade.teams : []),
    trade.teamA,
    trade.teamB,
    trade.winningTeam,
    trade.losingTeam,
  ].filter(Boolean).join(" ");

  return normalize([
    trade.slug,
    trade.id,
    trade.canonicalTradeSlug,
    trade.title,
    getSearchTitle(trade),
    getSearchSummaryText(trade),
    getSummary(trade),
    trade.partnerSummary,
    trade.verdict,
    trade.winner,
    trade.tier,
    trade.confidence,
    getTradeDate(trade),
    teamText,
    assetText,
  ].filter(Boolean).join(" "));
}

const publicTrades = rows.filter(isPublicTrade);

const searchIndex = publicTrades.map((trade) => ({`,
  "Add compact search text helpers",
  changes
);

// Replace full safeJson(trade) searchText with compactSearchText(trade).
after = replaceOnce(
  after,
  `  searchText: normalize(safeJson(trade)),`,
  `  searchText: compactSearchText(trade),`,
  "Use compactSearchText instead of safeJson(trade)",
  changes
);

const validations = [];

function check(rule, pass, detail = "") {
  validations.push({ rule, status: pass ? "pass" : "fail", detail });
}

check("compactSearchText helper exists", /function compactSearchText\(trade\)/.test(after));
check("flattenSearchValue helper exists", /function flattenSearchValue\(value/.test(after));
check("searchIndex uses compactSearchText", /searchText:\s*compactSearchText\(trade\)/.test(after));
check("searchIndex no longer uses normalize(safeJson(trade))", !/searchText:\s*normalize\(safeJson\(trade\)\)/.test(after));
check("tier still included for landmark boost", /tier:\s*String\(trade\.tier/.test(after));
check("confidence still included", /confidence:\s*String\(trade\.confidence/.test(after));
check("scoreSearchResult still exists", /function scoreSearchResult\(item, query\)/.test(after));
check("landmark boost still exists", /toLowerCase\(\)\s*===\s*["']landmark["'][\s\S]*score \+= 1250/.test(after));

const failures = validations.filter((row) => row.status !== "pass");

const report = {
  mode: APPLY ? "apply" : "dry-run",
  file: rel(SEARCH_FILE),
  changed: before !== after,
  beforeBytes: byteLength(before),
  afterBytes: byteLength(after),
  changes,
  validations,
  failures,
};

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "search-performance-patch-apply-report.json" : "search-performance-patch-dry-run-report.json"), JSON.stringify(report, null, 2), "utf8");

const summary = [
  "# Search performance patch",
  "",
  `Mode: ${APPLY ? "APPLY" : "DRY RUN"}`,
  `File: ${rel(SEARCH_FILE)}`,
  `Would change file: ${before !== after}`,
  `search.astro bytes before: ${byteLength(before)}`,
  `search.astro bytes after: ${byteLength(after)}`,
  `Validation failures: ${failures.length}`,
  "",
  "## Changes",
  "",
  ...changes.map((row) => `- ${row.status.toUpperCase()}: ${row.label}`),
  "",
  "## Validation",
  "",
  ...validations.map((row) => `- ${row.status.toUpperCase()}: ${row.rule}`),
  "",
  failures.length ? "## Failures" : "## Failures",
  "",
  ...(failures.length ? failures.map((row) => `- ${row.rule}: ${row.detail}`) : ["- None"]),
  "",
  "No build was run. No trade JSON was modified.",
  "",
].join("\n");

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "search-performance-patch-apply-summary.md" : "search-performance-patch-dry-run-summary.md"), summary, "utf8");

if (failures.length) {
  console.log(summary);
  throw new Error("Validation failed. See " + rel(path.join(OUT_DIR, APPLY ? "search-performance-patch-apply-report.json" : "search-performance-patch-dry-run-report.json")));
}

if (APPLY) {
  const backup = path.join(OUT_DIR, "search.before-performance-patch.astro");
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, before, "utf8");
  fs.writeFileSync(SEARCH_FILE, after, "utf8");
}

console.log(summary);
console.log("Wrote reports to " + rel(OUT_DIR));
