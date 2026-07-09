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

function changed(name, before, after, changes) {
  changes.push({
    name,
    status: before === after ? "unchanged" : "changed",
  });
}

function replaceOnce(text, from, to, label, changes) {
  if (!text.includes(from)) {
    throw new Error("Could not find patch target: " + label);
  }

  const next = text.replace(from, to);
  changed(label, text, next, changes);
  return next;
}

const before = fs.readFileSync(SEARCH_FILE, "utf8");
let after = before;
const changes = [];

// Add tier/confidence to the serialized client search index.
after = replaceOnce(
  after,
  `  summary: getSummary(trade),
  date: getTradeDate(trade),
  sortDate: getSortDate(trade),
  searchText: normalize(safeJson(trade)),
}));`,
  `  summary: getSummary(trade),
  date: getTradeDate(trade),
  sortDate: getSortDate(trade),
  tier: String(trade.tier || ""),
  confidence: String(trade.confidence || ""),
  searchText: normalize(safeJson(trade)),
}));`,
  "Add tier and confidence to searchIndex",
  changes
);

// Tighten token-includes-candidate fuzzy matching so "ramsey" no longer matches "rams".
after = replaceOnce(
  after,
  `        if (candidate.includes(token) || token.includes(candidate)) {
          return Math.min(candidate.length, token.length) >= 4;
        }`,
  `        if (candidate.includes(token)) {
          return token.length >= 4;
        }

        if (token.includes(candidate)) {
          return candidate.length >= 5 && token.length >= candidate.length + 2;
        }`,
  "Tighten fuzzy token substring matching",
  changes
);

// Add ranking helpers after includesTerm.
after = replaceOnce(
  after,
  `    function includesTerm(source, term) {
      return sourceMatchesQuery(source, term);
    }

    function matchesYear(item, value) {`,
  `    function includesTerm(source, term) {
      return sourceMatchesQuery(source, term);
    }

    function queryScoreTokens(value) {
      return normalizeBasic(value)
        .split(/\\s+/)
        .filter(Boolean)
        .filter((token) => !["the", "a", "an", "and", "or", "to", "for", "of", "in", "on"].includes(token));
    }

    function scoreSearchResult(item, query) {
      const fields = [
        item.title || "",
        item.summary || "",
        item.meta || "",
        item.searchText || "",
      ];

      const displayNorm = normalizeBasic([item.title || "", item.summary || "", item.meta || ""].join(" "));
      const fullNorm = normalizeBasic(fields.join(" "));
      const fullTokens = fullNorm.split(/\\s+/).filter(Boolean);
      const fullCompact = fullTokens.join("");
      const terms = [query.q, query.player, query.team, query.year, query.month, query.date].filter(Boolean);

      let score = 0;

      for (const term of terms) {
        const termNorm = normalizeBasic(term);
        if (!termNorm) continue;

        const tokens = queryScoreTokens(term);
        const phraseInDisplay = displayNorm.includes(termNorm);
        const phraseInFull = fullNorm.includes(termNorm);
        const allTokensPresent = tokens.length > 0 && tokens.every((token) => tokenMatches(fullTokens, fullCompact, token));
        const exactTokenHits = tokens.filter((token) => fullTokens.includes(token)).length;

        if (phraseInDisplay) score += 10000;
        else if (phraseInFull) score += 7000;

        if (tokens.length >= 2 && allTokensPresent) score += 3000;
        score += exactTokenHits * 500;

        if (String(item.tier || "").toLowerCase() === "landmark" && (phraseInDisplay || phraseInFull || allTokensPresent)) {
          score += 1250;
        }

        if (String(item.confidence || "").toLowerCase() === "high" && (phraseInDisplay || phraseInFull || allTokensPresent)) {
          score += 150;
        }
      }

      return score;
    }

    function matchesYear(item, value) {`,
  "Add search result scoring helpers",
  changes
);

// Sort by score before date.
after = replaceOnce(
  after,
  `        .filter((item) => (
          includesTerm(item.searchText, query.q) &&
          includesTerm(item.searchText, query.player) &&
          includesTerm(item.searchText, query.team) &&
          matchesYear(item, query.year) &&
          matchesMonth(item, query.month) &&
          matchesDate(item, query.date)
        ))
        .sort((a, b) => (b.sortDate || 0) - (a.sortDate || 0))
        .slice(0, 150);`,
  `        .filter((item) => (
          includesTerm(item.searchText, query.q) &&
          includesTerm(item.searchText, query.player) &&
          includesTerm(item.searchText, query.team) &&
          matchesYear(item, query.year) &&
          matchesMonth(item, query.month) &&
          matchesDate(item, query.date)
        ))
        .map((item) => ({
          ...item,
          searchScore: scoreSearchResult(item, query),
        }))
        .sort((a, b) => (b.searchScore || 0) - (a.searchScore || 0) || (b.sortDate || 0) - (a.sortDate || 0))
        .slice(0, 150);`,
  "Sort search results by relevance score before date",
  changes
);

const validations = [];

function check(rule, pass, detail = "") {
  validations.push({ rule, status: pass ? "pass" : "fail", detail });
}

check("searchIndex includes tier", /tier:\s*String\(trade\.tier/.test(after));
check("searchIndex includes confidence", /confidence:\s*String\(trade\.confidence/.test(after));
check("token.includes(candidate) now requires candidate length >= 5 and extra length", /candidate\.length >= 5 && token\.length >= candidate\.length \+ 2/.test(after));
check("scoreSearchResult helper exists", /function scoreSearchResult\(item, query\)/.test(after));
check("results are mapped with searchScore", /searchScore:\s*scoreSearchResult\(item, query\)/.test(after));
check("results sort by searchScore before sortDate", /\.sort\(\(a, b\) => \(b\.searchScore \|\| 0\) - \(a\.searchScore \|\| 0\) \|\| \(b\.sortDate \|\| 0\) - \(a\.sortDate \|\| 0\)\)/.test(after));
check("landmark boost exists", /item\.tier[\s\S]*landmark[\s\S]*score \+= 1250/.test(after));

const failures = validations.filter((row) => row.status !== "pass");

const report = {
  mode: APPLY ? "apply" : "dry-run",
  file: rel(SEARCH_FILE),
  changed: before !== after,
  changes,
  validations,
  failures,
};

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "ramsey-search-patch-apply-report.json" : "ramsey-search-patch-dry-run-report.json"), JSON.stringify(report, null, 2), "utf8");

const summary = [
  "# Ramsey search ranking patch",
  "",
  `Mode: ${APPLY ? "APPLY" : "DRY RUN"}`,
  `File: ${rel(SEARCH_FILE)}`,
  `Would change file: ${before !== after}`,
  `Validation failures: ${failures.length}`,
  "",
  "## Changes",
  "",
  ...changes.map((row) => `- ${row.status.toUpperCase()}: ${row.name}`),
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

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "ramsey-search-patch-apply-summary.md" : "ramsey-search-patch-dry-run-summary.md"), summary, "utf8");

if (failures.length) {
  console.log(summary);
  throw new Error("Validation failed. See " + rel(path.join(OUT_DIR, APPLY ? "ramsey-search-patch-apply-report.json" : "ramsey-search-patch-dry-run-report.json")));
}

if (APPLY) {
  const backup = path.join(OUT_DIR, "search.before-ramsey-ranking-patch.astro");
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, before, "utf8");
  }
  fs.writeFileSync(SEARCH_FILE, after, "utf8");
}

console.log(summary);
console.log("Wrote reports to " + rel(OUT_DIR));
