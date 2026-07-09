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

const before = fs.readFileSync(SEARCH_FILE, "utf8");
let after = before;
const changes = [];

// Add a fast exact/token matcher.
// This avoids fuzzy edit-distance scans for normal searches like "jalen ramsey", "herschel walker", "browns 2004".
after = replaceOnce(
  after,
  `    function includesTerm(source, term) {
      return sourceMatchesQuery(source, term);
    }

    function queryScoreTokens(value) {`,
  `    function includesTerm(source, term) {
      return sourceMatchesQuery(source, term);
    }

    function fastIncludesTerm(source, term) {
      if (!clean(term)) return true;

      const sourceNorm = normalizeBasic(source);
      const termNorm = normalizeBasic(term);
      if (!termNorm) return true;
      if (sourceNorm.includes(termNorm)) return true;

      const sourcePadded = " " + sourceNorm + " ";
      const tokens = termNorm
        .split(/\\s+/)
        .filter(Boolean)
        .filter((token) => !["the", "a", "an", "and", "or", "to", "for", "of", "in", "on"].includes(token));

      return tokens.length > 0 && tokens.every((token) => sourcePadded.includes(" " + token + " "));
    }

    function queryScoreTokens(value) {`,
  "Add fastIncludesTerm helper",
  changes
);

// Replace the one-pass fuzzy filter with fast pass plus fuzzy fallback only if fast pass is too thin.
after = replaceOnce(
  after,
  `      const results = searchIndex
        .filter((item) => (
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
  `      function itemMatchesSearch(item, useFuzzy) {
        const textMatcher = useFuzzy ? includesTerm : fastIncludesTerm;

        return (
          textMatcher(item.searchText, query.q) &&
          textMatcher(item.searchText, query.player) &&
          textMatcher(item.searchText, query.team) &&
          matchesYear(item, query.year) &&
          matchesMonth(item, query.month) &&
          matchesDate(item, query.date)
        );
      }

      function rankResults(items) {
        return items
          .map((item) => ({
            ...item,
            searchScore: scoreSearchResult(item, query),
          }))
          .sort((a, b) => (b.searchScore || 0) - (a.searchScore || 0) || (b.sortDate || 0) - (a.sortDate || 0))
          .slice(0, 150);
      }

      let matchedItems = searchIndex.filter((item) => itemMatchesSearch(item, false));

      if (matchedItems.length < 3) {
        matchedItems = searchIndex.filter((item) => itemMatchesSearch(item, true));
      }

      const results = rankResults(matchedItems);`,
  "Use fast pass before fuzzy fallback",
  changes
);

const validations = [];

function check(rule, pass, detail = "") {
  validations.push({ rule, status: pass ? "pass" : "fail", detail });
}

check("fastIncludesTerm helper exists", /function fastIncludesTerm\(source, term\)/.test(after));
check("itemMatchesSearch helper exists", /function itemMatchesSearch\(item, useFuzzy\)/.test(after));
check("rankResults helper exists", /function rankResults\(items\)/.test(after));
check("fast pass is used before fuzzy fallback", /matchedItems = searchIndex\.filter\(\(item\) => itemMatchesSearch\(item, false\)\)/.test(after));
check("fuzzy fallback only runs when fast result count is below 3", /if \(matchedItems\.length < 3\)[\s\S]*itemMatchesSearch\(item, true\)/.test(after));
check("scoreSearchResult still exists", /function scoreSearchResult\(item, query\)/.test(after));
check("landmark boost still exists", /toLowerCase\(\)\s*===\s*["']landmark["'][\s\S]*score \+= 1250/.test(after));
check("compactSearchText remains in use", /searchText:\s*compactSearchText\(trade\)/.test(after));

const failures = validations.filter((row) => row.status !== "pass");

const report = {
  mode: APPLY ? "apply" : "dry-run",
  file: rel(SEARCH_FILE),
  changed: before !== after,
  changes,
  validations,
  failures,
};

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "search-fast-path-patch-apply-report.json" : "search-fast-path-patch-dry-run-report.json"), JSON.stringify(report, null, 2), "utf8");

const summary = [
  "# Search fast-path patch",
  "",
  `Mode: ${APPLY ? "APPLY" : "DRY RUN"}`,
  `File: ${rel(SEARCH_FILE)}`,
  `Would change file: ${before !== after}`,
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

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "search-fast-path-patch-apply-summary.md" : "search-fast-path-patch-dry-run-summary.md"), summary, "utf8");

if (failures.length) {
  console.log(summary);
  throw new Error("Validation failed. See " + rel(path.join(OUT_DIR, APPLY ? "search-fast-path-patch-apply-report.json" : "search-fast-path-patch-dry-run-report.json")));
}

if (APPLY) {
  const backup = path.join(OUT_DIR, "search.before-fast-path-patch.astro");
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, before, "utf8");
  fs.writeFileSync(SEARCH_FILE, after, "utf8");
}

console.log(summary);
console.log("Wrote reports to " + rel(OUT_DIR));
