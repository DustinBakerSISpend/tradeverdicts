import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REFINED_CSV = path.join(ROOT, "audits", "nfl-verdict-grade-consistency-refined-fix-queue", "all-refined-fix-queue.csv");
const TRADES_JSON = path.join(ROOT, "src", "data", "nfl", "trades.json");
const OUT_DIR = path.join(ROOT, "audits", "nfl-verdict-grade-consistency-manual-top-level-review");

fs.mkdirSync(OUT_DIR, { recursive: true });

if (!fs.existsSync(REFINED_CSV)) {
  throw new Error("Missing refined CSV. Run Task 2 refined fix queue first: " + path.relative(ROOT, REFINED_CSV));
}

if (!fs.existsSync(TRADES_JSON)) {
  throw new Error("Missing active trades data: " + path.relative(ROOT, TRADES_JSON));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (quote) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quote = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') quote = true;
      else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch !== "\r") {
        cell += ch;
      }
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows
    .filter((r) => r.length && r.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])));
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
  return s;
}

function writeCsv(file, rows) {
  const headers = [
    "activeBucket",
    "refinedBucket",
    "issue",
    "slug",
    "field",
    "topVerdict",
    "teamGrades",
    "activeVerdict",
    "activeTeamGrades",
    "reason",
    "flagSnippet",
    "activeFieldText",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ];

  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function short(value, n = 420) {
  const s = normalizeSpaces(value);
  return s.length > n ? s.slice(0, n - 3) + "..." : s;
}

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function getTeamGrades(trade) {
  const obj = trade.teamGrades || trade.grades || trade.teamGradeCards || {};
  return Object.entries(obj).map(([team, grade]) => `${team}:${grade}`).join(" | ");
}

function evenLanguage(text) {
  return /\b(even trade|clean even|near even|no clear winner|no-clear-winner|not enough separation|does not show enough|without enough separation|win\/loss verdict|too close to call|roughly equal|both sides near even|neither return separates enough)\b/i.test(text);
}

function winEdgeLanguage(text) {
  const cleaned = String(text || "")
    .replace(/win\/loss verdict/gi, "")
    .replace(/no clear win/gi, "")
    .replace(/no-clear-winner/gi, "");

  return /\b(narrow .* win|clear .* win|best framed as .* win|receives? the edge|gets? the edge|has the edge|held the edge|favou?rs? [A-Z][A-Za-z .'-]+|came out ahead|comes out ahead|got the better|landed the better|overall result favors|overall return favors)\b/i.test(cleaned);
}

const refinedRows = parseCsv(fs.readFileSync(REFINED_CSV, "utf8"));
const trades = JSON.parse(fs.readFileSync(TRADES_JSON, "utf8"));
const bySlug = new Map(trades.map((trade) => [trade.slug, trade]));

const manualRows = refinedRows.filter((row) =>
  row.refinedBucket === "manual-team-win-vs-even-review" ||
  row.refinedBucket === "manual-even-vs-win-review"
);

const reviewRows = manualRows.map((row) => {
  const trade = bySlug.get(row.slug);
  const activeText = trade ? normalizeSpaces(trade[row.field] ?? "") : "";
  const combined = trade ? normalizeSpaces([trade.summary, trade.partnerSummary, trade.analysis].join(" ")) : "";

  let activeBucket = "missing-active-trade";
  let reason = "Slug was not found in active src/data/nfl/trades.json.";

  if (trade) {
    if (row.refinedBucket === "manual-team-win-vs-even-review") {
      if (evenLanguage(activeText)) {
        activeBucket = "active-manual-team-win-vs-even";
        reason = "Active flagged field still contains even/no-clear-winner language under a team-win verdict.";
      } else if (evenLanguage(combined)) {
        activeBucket = "active-manual-team-win-vs-even-other-field";
        reason = "Active trade still contains even/no-clear-winner language elsewhere under a team-win verdict.";
      } else {
        activeBucket = "likely-stale-or-resolved-in-active-file";
        reason = "Active trade no longer contains obvious even/no-clear-winner language in the flagged field.";
      }
    } else if (row.refinedBucket === "manual-even-vs-win-review") {
      if (winEdgeLanguage(activeText)) {
        activeBucket = "active-manual-even-vs-win";
        reason = "Active flagged field still contains win/edge/favors language under an Even Trade verdict.";
      } else if (winEdgeLanguage(combined)) {
        activeBucket = "active-manual-even-vs-win-other-field";
        reason = "Active trade still contains win/edge/favors language elsewhere under an Even Trade verdict.";
      } else {
        activeBucket = "likely-stale-or-resolved-in-active-file";
        reason = "Active trade no longer contains obvious win/edge language in the flagged field.";
      }
    }
  }

  return {
    activeBucket,
    refinedBucket: row.refinedBucket,
    issue: row.issue,
    slug: row.slug,
    field: row.field,
    topVerdict: row.topVerdict,
    teamGrades: row.teamGrades,
    activeVerdict: trade ? trade.verdict || "" : "",
    activeTeamGrades: trade ? getTeamGrades(trade) : "",
    reason,
    flagSnippet: short(row.snippet, 360),
    activeFieldText: short(activeText, 520),
  };
});

const byBucket = reviewRows.reduce((acc, row) => {
  acc[row.activeBucket] = (acc[row.activeBucket] || 0) + 1;
  return acc;
}, {});

const uniqueSlugs = new Set(reviewRows.map((row) => row.slug));
const activeReviewSlugs = new Set(
  reviewRows
    .filter((row) => row.activeBucket.startsWith("active-manual"))
    .map((row) => row.slug)
);

writeCsv(path.join(OUT_DIR, "manual-top-level-active-review.csv"), reviewRows);
writeCsv(
  path.join(OUT_DIR, "active-manual-candidates.csv"),
  reviewRows.filter((row) => row.activeBucket.startsWith("active-manual"))
);
writeCsv(
  path.join(OUT_DIR, "likely-stale-or-resolved.csv"),
  reviewRows.filter((row) => row.activeBucket === "likely-stale-or-resolved-in-active-file")
);

const md = [];
md.push("# Task 2 manual top-level active review");
md.push("");
md.push(`Manual refined flags reviewed: ${reviewRows.length}`);
md.push(`Unique manual refined slugs: ${uniqueSlugs.size}`);
md.push(`Active manual candidate slugs: ${activeReviewSlugs.size}`);
md.push("");
md.push("## Buckets");
md.push("");
for (const [bucket, count] of Object.entries(byBucket).sort((a, b) => b[1] - a[1])) {
  md.push(`- ${bucket}: ${count}`);
}
md.push("");
md.push("## Active manual candidates");
md.push("");
for (const row of reviewRows.filter((r) => r.activeBucket.startsWith("active-manual"))) {
  md.push(`### ${row.slug}`);
  md.push("");
  md.push(`- Bucket: ${row.activeBucket}`);
  md.push(`- Refined bucket: ${row.refinedBucket}`);
  md.push(`- Issue: ${row.issue}`);
  md.push(`- Field: ${row.field}`);
  md.push(`- Active verdict: ${row.activeVerdict}`);
  md.push(`- Active grades: ${row.activeTeamGrades}`);
  md.push(`- Reason: ${row.reason}`);
  md.push("");
  md.push("Flag snippet:");
  md.push("> " + row.flagSnippet);
  md.push("");
  md.push("Active field text:");
  md.push("> " + row.activeFieldText);
  md.push("");
}
md.push("No build was run. No trade JSON was modified.");

fs.writeFileSync(path.join(OUT_DIR, "manual-top-level-active-review.md"), md.join("\n"), "utf8");

const summary = [
  "# Task 2 manual top-level active review",
  "",
  `Manual refined flags reviewed: ${reviewRows.length}`,
  `Unique manual refined slugs: ${uniqueSlugs.size}`,
  `Active manual candidate slugs: ${activeReviewSlugs.size}`,
  "",
  "## Buckets",
  "",
  ...Object.entries(byBucket).sort((a, b) => b[1] - a[1]).map(([bucket, count]) => `- ${bucket}: ${count}`),
  "",
  "## Active manual candidate slugs",
  "",
  ...(activeReviewSlugs.size
    ? [...activeReviewSlugs].sort().map((slug) => `- ${slug}`)
    : ["- None"]),
  "",
  `Wrote: ${rel(path.join(OUT_DIR, "manual-top-level-active-review.md"))}`,
  `Wrote: ${rel(path.join(OUT_DIR, "manual-top-level-active-review.csv"))}`,
  `Wrote: ${rel(path.join(OUT_DIR, "active-manual-candidates.csv"))}`,
  "",
  "No build was run. No trade JSON was modified.",
  "",
].join("\n");

fs.writeFileSync(path.join(OUT_DIR, "summary.md"), summary, "utf8");

console.log(summary);
