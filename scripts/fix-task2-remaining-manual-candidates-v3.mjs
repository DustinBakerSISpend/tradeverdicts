import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const DATA_FILE = path.join(ROOT, "src", "data", "nfl", "trades.json");
const OUT_DIR = path.join(ROOT, "audits", "nfl-verdict-grade-consistency-remaining-manual-fix");

fs.mkdirSync(OUT_DIR, { recursive: true });

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findTrade(data, slug) {
  const index = data.findIndex((trade) => trade && trade.slug === slug);
  if (index === -1) throw new Error("Could not find trade slug: " + slug);
  return { trade: data[index], index };
}

function setField(trade, field, value, changes, reason) {
  const before = trade[field];

  if (before === value) {
    changes.push({ slug: trade.slug, field, status: "unchanged", reason, before, after: value });
    return;
  }

  trade[field] = value;
  changes.push({ slug: trade.slug, field, status: "changed", reason, before, after: value });
}

function replaceInField(trade, field, from, to, changes, reason) {
  const before = trade[field];

  if (typeof before !== "string") {
    changes.push({ slug: trade.slug, field, status: "skipped", reason: reason + " (field is not a string)", before, after: before });
    return;
  }

  if (!before.includes(from)) {
    changes.push({ slug: trade.slug, field, status: "skipped", reason: reason + " (target text not found)", before, after: before });
    return;
  }

  const after = before.replace(from, to);
  trade[field] = after;
  changes.push({ slug: trade.slug, field, status: before === after ? "unchanged" : "changed", reason, before, after });
}

function replaceRegexInField(trade, field, pattern, to, changes, reason) {
  const before = trade[field];

  if (typeof before !== "string") {
    changes.push({ slug: trade.slug, field, status: "skipped", reason: reason + " (field is not a string)", before, after: before });
    return;
  }

  if (!pattern.test(before)) {
    changes.push({ slug: trade.slug, field, status: "skipped", reason: reason + " (regex target not found)", before, after: before });
    return;
  }

  const after = before.replace(pattern, to);
  trade[field] = after;
  changes.push({ slug: trade.slug, field, status: before === after ? "unchanged" : "changed", reason, before, after });
}

function changedCount(changes) {
  return changes.filter((change) => change.status === "changed").length;
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

const raw = fs.readFileSync(DATA_FILE, "utf8");
const data = JSON.parse(raw);
const changes = [];

// 1984 Raiders/Mike Haynes.
// Verdict/grades are correct. Remove legacy "even trade" wording from analysis final verdict.
// v2 uses a flexible regex because the active data has occasional missing spaces.
{
  const slug = "1984-first-round-pick-28-brian-blados-las-vegas-raiders-1983";
  const { trade } = findTrade(data, slug);

  replaceRegexInField(
    trade,
    "analysis",
    /Final Verdict[\s\S]{0,180}?even trade\./i,
    "Final Verdict This belongs as a clear Raiders win.",
    changes,
    "Remove legacy even-trade wording from a clear Raiders Win record."
  );
}

// 1996 Washington/Rams Lawrence Phillips.
// Verdict/grades are correct. Remove legacy "even trade" wording from analysis final verdict.
// v2 uses a flexible regex because the active data has occasional missing spaces.
{
  const slug = "1996-1st-round-pick-6th-overall-lawrence-phillips-washington-redskins-1996";
  const { trade } = findTrade(data, slug);

  replaceRegexInField(
    trade,
    "analysis",
    /Final Verdict[\s\S]{0,180}?even trade\./i,
    "Final Verdict This belongs as a clear Washington win.",
    changes,
    "Remove legacy even-trade wording from a clear Washington Win record."
  );
}

// 2002 Jaguars/Washington.
// Verdict is a minor Jaguars Win. Remove "not a true even trade" wording that triggers consistency scanners.
{
  const slug = "2002-3rd-round-pick-89th-overall-washington-redskins-commanders-2002";
  const { trade } = findTrade(data, slug);

  replaceInField(
    trade,
    "summary",
    "This is a minor Jacksonville lean, not a true even trade",
    "This is a minor Jacksonville lean and supports the Jaguars Win label",
    changes,
    "Align summary wording with Jacksonville Jaguars Win without using even-trade negation."
  );

  replaceInField(
    trade,
    "analysis",
    "This is a minor Jacksonville lean, not a true even trade.",
    "This is a minor Jacksonville lean and supports the Jaguars Win label.",
    changes,
    "Align analysis wording with Jacksonville Jaguars Win without using even-trade negation."
  );
}

// 2022 Bucs/Jaguars Devin Lloyd.
// Actual contradiction: verdict/grades favor Tampa Bay, summary says even and Grade token says B instead of B-.
{
  const slug = "2022-1st-round-pick-27th-overall-tampa-bay-buccaneers-2022";
  const { trade } = findTrade(data, slug);

  setField(
    trade,
    "summary",
    "Jacksonville traded back into Round 1 (from 33rd to 27th overall) to select LB Devin Lloyd, sending Tampa Bay a 2nd (Logan Hall, 33rd), 4th (Cade Otton, 106th), and 6th. Lloyd became a useful starting linebacker but not a dominant force. Tampa Bay received Logan Hall and Cade Otton, both of whom became starters, giving the Buccaneers the slightly stronger return.",
    changes,
    "Replace even-trade summary with Tampa Bay edge matching Bucs Win and B- / C+ grades."
  );

  replaceInField(
    trade,
    "partnerSummary",
    "The Bucs executed the trade-down perfectly. Grade: B",
    "The Bucs executed the trade-down well. Grade: B-",
    changes,
    "Align literal partner Grade token with Tampa Bay B- team card."
  );

  replaceInField(
    trade,
    "analysis",
    "The Bucs executed the trade-down perfectly. Grade: B",
    "The Bucs executed the trade-down well. Grade: B-",
    changes,
    "Align literal analysis Grade token with Tampa Bay B- team card."
  );
}

// Don Brown.
// Even Trade is correct. Replace broken Partner Partner Win artifact.
{
  const slug = "don-brown-a-arizona-st-louis-cardinals-1960";
  const { trade } = findTrade(data, slug);

  setField(
    trade,
    "partnerSummary",
    "Arizona/St. Louis Cardinals received an undisclosed draft pick and gave up Don Brown (a). The available record points to a balanced, low-leverage exchange without enough separation for a directional winner.",
    changes,
    "Replace Partner Partner Win artifact with even-trade partner language."
  );
}

// Henry Reed.
// Even Trade is correct. Remove "win" wording from no-clear-win sentence.
{
  const slug = "henry-reed-new-york-giants-1975";
  const { trade } = findTrade(data, slug);

  replaceInField(
    trade,
    "summary",
    "not a clear franchise-changing win",
    "not a clear franchise-changing outcome",
    changes,
    "Avoid win wording in an Even Trade summary."
  );

  replaceInField(
    trade,
    "analysis",
    "not a clear franchise-changing win",
    "not a clear franchise-changing outcome",
    changes,
    "Avoid win wording in an Even Trade analysis."
  );
}

// Jim Germany.
// Even Trade is correct. Replace broken Partner Partner Win artifact.
{
  const slug = "jim-germany-arizona-st-louis-cardinals-1975";
  const { trade } = findTrade(data, slug);

  setField(
    trade,
    "partnerSummary",
    "Arizona/St. Louis Cardinals received a conditional draft pick and gave up Jim Germany. The available record points to a balanced, low-leverage exchange without enough separation for a directional winner.",
    changes,
    "Replace Partner Partner Win artifact with even-trade partner language."
  );
}

// Jim Whalen.
// Even Trade is correct. Remove winner wording from analysis.
{
  const slug = "jim-whalen-new-england-patriots-1970";
  const { trade } = findTrade(data, slug);

  replaceInField(
    trade,
    "analysis",
    "does not create a clear long-term winner",
    "does not create clear long-term separation",
    changes,
    "Avoid winner wording in an Even Trade analysis."
  );
}

// Larry Hickman.
// Even Trade is correct. Replace broken Partner Partner Win artifact.
{
  const slug = "larry-hickman-arizona-st-louis-cardinals-1960";
  const { trade } = findTrade(data, slug);

  setField(
    trade,
    "partnerSummary",
    "Arizona/St. Louis Cardinals received a conditional draft pick and gave up Larry Hickman. The available record points to a balanced, low-leverage exchange without enough separation for a directional winner.",
    changes,
    "Replace Partner Partner Win artifact with even-trade partner language."
  );
}

// Regan Upshaw.
// Actual contradiction: prose says Jaguars win, verdict/grades favored Tampa Bay. Align verdict/grades to prose.
{
  const slug = "regan-upshaw-tampa-bay-buccaneers-1999";
  const { trade } = findTrade(data, slug);

  setField(
    trade,
    "verdict",
    "Jacksonville Jaguars Win",
    changes,
    "Align verdict with active prose showing a slight Jaguars win and Tampa Bay player-value loss."
  );

  const beforeGrades = trade.teamGrades;
  trade.teamGrades = {
    "jacksonville-jaguars": "B-",
    "tampa-bay-buccaneers": "C+",
  };
  changes.push({
    slug,
    field: "teamGrades",
    status: JSON.stringify(beforeGrades) === JSON.stringify(trade.teamGrades) ? "unchanged" : "changed",
    reason: "Align grade cards with Jacksonville Jaguars Win.",
    before: beforeGrades,
    after: trade.teamGrades,
  });

  replaceInField(
    trade,
    "summary",
    "Getting a proven edge player in his prime for a late 6th-round pick is a slight Jaguars win, not an even trade.",
    "Getting a proven edge player in his prime for a late 6th-round pick supports a slight Jaguars Win label.",
    changes,
    "Remove even-trade negation from a Jaguars Win summary."
  );
}

const checks = [];

function t(slug) {
  return findTrade(data, slug).trade;
}

{
  const slug = "1984-first-round-pick-28-brian-blados-las-vegas-raiders-1983";
  const trade = t(slug);
  check(checks, slug, "analysis", "analysis should not include even trade wording", !/even trade/i.test(trade.analysis), trade.analysis);
}

{
  const slug = "1996-1st-round-pick-6th-overall-lawrence-phillips-washington-redskins-1996";
  const trade = t(slug);
  check(checks, slug, "analysis", "analysis should not include even trade wording", !/even trade/i.test(trade.analysis), trade.analysis);
}

{
  const slug = "2002-3rd-round-pick-89th-overall-washington-redskins-commanders-2002";
  const trade = t(slug);
  check(checks, slug, "summary", "summary should not include true even trade wording", !/true even trade/i.test(trade.summary), trade.summary);
  check(checks, slug, "analysis", "analysis should not include true even trade wording", !/true even trade/i.test(trade.analysis), trade.analysis);
}

{
  const slug = "2022-1st-round-pick-27th-overall-tampa-bay-buccaneers-2022";
  const trade = t(slug);
  const combined = [trade.summary, trade.partnerSummary, trade.analysis].join(" ");
  check(checks, slug, "summary", "summary should not say C+/C+ even trade", !/C\+\/C\+ even trade|even trade is accurate|neither dramatically outperformed/i.test(trade.summary), trade.summary);
  check(checks, slug, "partnerSummary", "partnerSummary should say Grade: B-", /Grade: B-/.test(trade.partnerSummary), trade.partnerSummary);
  check(checks, slug, "analysis", "analysis should say Grade: B-", /Grade: B-/.test(trade.analysis), trade.analysis);
  check(checks, slug, "combined", "combined prose should not say Grade: B without minus", !/Grade: B(?![-+])/.test(combined), combined);
}

for (const slug of [
  "don-brown-a-arizona-st-louis-cardinals-1960",
  "jim-germany-arizona-st-louis-cardinals-1975",
  "larry-hickman-arizona-st-louis-cardinals-1960",
]) {
  const trade = t(slug);
  check(checks, slug, "partnerSummary", "partnerSummary should not contain Partner Partner Win", !/Partner Partner Win/i.test(trade.partnerSummary), trade.partnerSummary);
  check(checks, slug, "partnerSummary", "partnerSummary should support no directional winner", /without enough separation for a directional winner/i.test(trade.partnerSummary), trade.partnerSummary);
}

{
  const slug = "henry-reed-new-york-giants-1975";
  const trade = t(slug);
  check(checks, slug, "summary", "summary should not say clear franchise-changing win", !/clear franchise-changing win/i.test(trade.summary), trade.summary);
  check(checks, slug, "analysis", "analysis should not say clear franchise-changing win", !/clear franchise-changing win/i.test(trade.analysis), trade.analysis);
}

{
  const slug = "jim-whalen-new-england-patriots-1970";
  const trade = t(slug);
  check(checks, slug, "analysis", "analysis should not say clear long-term winner", !/clear long-term winner/i.test(trade.analysis), trade.analysis);
}

{
  const slug = "regan-upshaw-tampa-bay-buccaneers-1999";
  const trade = t(slug);
  check(checks, slug, "verdict", "verdict should be Jacksonville Jaguars Win", trade.verdict === "Jacksonville Jaguars Win", trade.verdict);
  check(checks, slug, "teamGrades", "Jacksonville should be B- and Tampa Bay C+", trade.teamGrades?.["jacksonville-jaguars"] === "B-" && trade.teamGrades?.["tampa-bay-buccaneers"] === "C+", JSON.stringify(trade.teamGrades));
  check(checks, slug, "summary", "summary should not include even trade wording", !/even trade/i.test(trade.summary), trade.summary);
}

const failures = checks.filter((row) => row.status !== "pass");

const report = {
  mode: APPLY ? "apply" : "dry-run",
  dataFile: rel(DATA_FILE),
  changedCount: changedCount(changes),
  changes,
  checks,
  failures,
};

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "apply-report-v3.json" : "dry-run-report-v3.json"), JSON.stringify(report, null, 2), "utf8");

const summary = [
  "# Task 2 remaining manual candidate fix v3",
  "",
  `Mode: ${APPLY ? "APPLY" : "DRY RUN"}`,
  `Data file: ${rel(DATA_FILE)}`,
  `Changed fields if applied: ${changedCount(changes)}`,
  `Validation failures: ${failures.length}`,
  "",
  "## Changes",
  "",
  ...changes.map((change) => `- ${change.status.toUpperCase()}: ${change.slug} / ${change.field} - ${change.reason}`),
  "",
  "## Validation",
  "",
  ...checks.map((row) => `- ${row.status.toUpperCase()}: ${row.slug} / ${row.field} - ${row.rule}`),
  "",
  failures.length ? "## Failures" : "## Failures",
  "",
  ...(failures.length
    ? failures.map((row) => `- ${row.slug} / ${row.field} - ${row.rule}\n  Value: ${row.value}`)
    : ["- None"]),
  "",
  "No build was run.",
  "",
].join("\n");

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "apply-summary-v3.md" : "dry-run-summary-v3.md"), summary, "utf8");

if (failures.length) {
  console.log(summary);
  throw new Error("Validation failed. See " + rel(path.join(OUT_DIR, APPLY ? "apply-report-v3.json" : "dry-run-report-v3.json")));
}

if (APPLY) {
  const backup = path.join(OUT_DIR, "trades.before-task2-remaining-manual-fix-v3.json");
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, raw, "utf8");
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

console.log(summary);
console.log("Wrote reports to " + rel(OUT_DIR));
