import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "src", "data", "nfl", "trades.json");
const OUT_DIR = path.join(ROOT, "audits", "nfl-verdict-grade-consistency-active-fix");
fs.mkdirSync(OUT_DIR, { recursive: true });

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findTrade(data, slug) {
  const trade = data.find((row) => row && row.slug === slug);
  if (!trade) throw new Error("Missing slug in active trades.json: " + slug);
  return trade;
}

function check(checks, slug, field, rule, pass, value) {
  checks.push({
    slug,
    field,
    rule,
    status: pass ? "pass" : "fail",
    value: normalizeSpaces(value),
  });
}

const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const checks = [];

// 1978 Archie Reese
{
  const slug = "1978-fifth-round-pick-127-archie-reese-houston-oilers-1976";
  const t = findTrade(data, slug);
  const summary = normalizeSpaces(t.summary);

  check(checks, slug, "verdict", "verdict remains Even Trade", t.verdict === "Even Trade", t.verdict);
  check(checks, slug, "teams", "teams include houston-oilers", Array.isArray(t.teams) && t.teams.includes("houston-oilers"), JSON.stringify(t.teams));
  check(checks, slug, "teams", "teams do not include tennessee-titans", Array.isArray(t.teams) && !t.teams.includes("tennessee-titans"), JSON.stringify(t.teams));
  check(checks, slug, "summary", "summary no longer says narrow Chiefs win", !/narrow chiefs win/i.test(summary), summary);
  check(checks, slug, "summary", "summary supports even verdict", /\beven\b/i.test(summary), summary);
}

// 2006 Jaguars/49ers
{
  const slug = "2006-7th-round-pick-213th-overall-san-francisco-49ers-2006";
  const t = findTrade(data, slug);
  const combined = normalizeSpaces([t.summary, t.partnerSummary, t.analysis].join(" "));

  check(checks, slug, "verdict", "verdict remains Jacksonville Jaguars Win", t.verdict === "Jacksonville Jaguars Win", t.verdict);
  check(checks, slug, "combined prose", "prose no longer says clean even trade", !/clean even trade/i.test(combined), combined);
  check(checks, slug, "combined prose", "prose no longer says neither side extracted enough value", !/neither side extracted enough value/i.test(combined), combined);
  check(checks, slug, "combined prose", "prose supports Jaguars narrow edge", /jaguars? (the )?narrow edge|jacksonville .* narrow edge/i.test(combined), combined);
}

// 2023 Bills/Jaguars
{
  const slug = "2023-1st-round-pick-27th-overall-buffalo-bills-2023";
  const t = findTrade(data, slug);
  const partner = normalizeSpaces(t.partnerSummary);

  check(checks, slug, "partnerSummary", "partnerSummary says Grade: B", /Grade: B\b/.test(partner), partner);
  check(checks, slug, "partnerSummary", "partnerSummary no longer says Grade: C+", !/Grade: C\+/.test(partner), partner);
}

// Dan Arnold
{
  const slug = "dan-arnold-carolina-panthers-2021";
  const t = findTrade(data, slug);
  const partner = normalizeSpaces(t.partnerSummary);
  const analysis = normalizeSpaces(t.analysis);

  check(checks, slug, "partnerSummary", "partnerSummary says Grade: D", /Grade: D\b/.test(partner), partner);
  check(checks, slug, "analysis", "analysis says Grade: D", /Grade: D\b/.test(analysis), analysis);
  check(checks, slug, "partnerSummary", "partnerSummary no longer says Grade: C", !/Grade: C\b/.test(partner), partner);
  check(checks, slug, "analysis", "analysis no longer says Grade: C", !/Grade: C\b/.test(analysis), analysis);
}

// Joe Kopcha
{
  const slug = "rights-to-joe-kopcha-chicago-bears-1936-09-25";
  const t = findTrade(data, slug);
  const combined = normalizeSpaces([t.summary, t.partnerSummary, t.analysis].join(" "));

  check(checks, slug, "verdict", "verdict remains Detroit Lions Win", t.verdict === "Detroit Lions Win", t.verdict);
  check(checks, slug, "combined prose", "prose no longer supports even verdict", !/even verdict|comparable or limited realized value on both sides|not show enough durable separation|justify a directional win/i.test(combined), combined);
  check(checks, slug, "combined prose", "prose supports Detroit/Lions narrow edge", /lions? .*narrow edge|detroit .*narrow edge/i.test(combined), combined);
}

// Active-clean old-file-only false positives
{
  const slug = "2005-4th-round-pick-127th-overall-new-york-jets-2005";
  const t = findTrade(data, slug);
  const combined = normalizeSpaces([t.partnerSummary, t.analysis].join(" "));
  check(checks, slug, "combined prose", "active trades.json has no Grade: B token", !/Grade: B\b/.test(combined), combined);
}

{
  const slug = "david-jones-cincinnati-bengals-2010";
  const t = findTrade(data, slug);
  const combined = normalizeSpaces([t.partnerSummary, t.analysis].join(" "));
  check(checks, slug, "combined prose", "active trades.json has no Grade: B token", !/Grade: B\b/.test(combined), combined);
}

const failures = checks.filter((row) => row.status !== "pass");

const summary = [
  "# Task 2 active candidate post-fix verification",
  "",
  `Data file: ${rel(DATA_FILE)}`,
  `Checks: ${checks.length}`,
  `Failures: ${failures.length}`,
  "",
  "## Results",
  "",
  ...checks.map((row) => `- ${row.status.toUpperCase()}: ${row.slug} / ${row.field} - ${row.rule}`),
  "",
  failures.length ? "## Failures" : "## Failures",
  "",
  ...(failures.length
    ? failures.map((row) => `- ${row.slug} / ${row.field} - ${row.rule}\n  Value: ${row.value}`)
    : ["- None"]),
  "",
  "No build was run. No trade JSON was modified.",
  "",
].join("\n");

fs.writeFileSync(path.join(OUT_DIR, "post-fix-verification-summary.md"), summary, "utf8");
fs.writeFileSync(path.join(OUT_DIR, "post-fix-verification-report.json"), JSON.stringify({ checks, failures }, null, 2), "utf8");

console.log(summary);

if (failures.length) {
  process.exitCode = 1;
}
