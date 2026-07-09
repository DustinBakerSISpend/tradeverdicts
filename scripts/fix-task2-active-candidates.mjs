import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const DATA_FILE = path.join(ROOT, "src", "data", "nfl", "trades.json");
const OUT_DIR = path.join(ROOT, "audits", "nfl-verdict-grade-consistency-active-fix");

fs.mkdirSync(OUT_DIR, { recursive: true });

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function renameTeamSlugDeep(value, from, to) {
  if (Array.isArray(value)) {
    return value.map((item) => renameTeamSlugDeep(item, from, to));
  }

  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const nextKey = key === from ? to : key;
      out[nextKey] = renameTeamSlugDeep(child, from, to);
    }
    return out;
  }

  if (value === from) return to;
  return value;
}

function findTrade(data, slug) {
  if (!Array.isArray(data)) {
    throw new Error("Expected src/data/nfl/trades.json to be a top-level array.");
  }

  const index = data.findIndex((trade) => trade && trade.slug === slug);
  if (index === -1) throw new Error("Could not find trade slug: " + slug);

  return { trade: data[index], index };
}

function setField(trade, field, value, changes, reason) {
  const before = trade[field];

  if (before === value) {
    changes.push({
      slug: trade.slug,
      field,
      status: "unchanged",
      reason,
      before,
      after: value,
    });
    return;
  }

  trade[field] = value;

  changes.push({
    slug: trade.slug,
    field,
    status: "changed",
    reason,
    before,
    after: value,
  });
}

function replaceInField(trade, field, from, to, changes, reason) {
  const before = trade[field];

  if (typeof before !== "string") {
    changes.push({
      slug: trade.slug,
      field,
      status: "skipped",
      reason: reason + " (field is not a string)",
      before,
      after: before,
    });
    return;
  }

  if (!before.includes(from)) {
    changes.push({
      slug: trade.slug,
      field,
      status: "skipped",
      reason: reason + " (target text not found)",
      before,
      after: before,
    });
    return;
  }

  const after = before.replace(from, to);
  trade[field] = after;

  changes.push({
    slug: trade.slug,
    field,
    status: before === after ? "unchanged" : "changed",
    reason,
    before,
    after,
  });
}

function changedCount(changes) {
  return changes.filter((change) => change.status === "changed").length;
}

function validateTrade(data, slug, checks, validations) {
  const { trade } = findTrade(data, slug);

  for (const check of checks) {
    const value = normalizeSpaces(trade[check.field] ?? "");
    const pass = check.pass(value, trade);

    validations.push({
      slug,
      field: check.field,
      status: pass ? "pass" : "fail",
      rule: check.rule,
      value,
    });
  }
}

const raw = fs.readFileSync(DATA_FILE, "utf8");
const data = JSON.parse(raw);
const original = clone(data);
const changes = [];
const notes = [];

// 1978 Chiefs/Oilers.
// Keep Even Trade, remove "narrow Chiefs win" wording, and repair Titans alias contamination in the active record.
{
  const slug = "1978-fifth-round-pick-127-archie-reese-houston-oilers-1976";
  const { trade, index } = findTrade(data, slug);

  const before = clone(trade);
  const repaired = renameTeamSlugDeep(trade, "tennessee-titans", "houston-oilers");
  data[index] = repaired;

  if (JSON.stringify(before) !== JSON.stringify(repaired)) {
    changes.push({
      slug,
      field: "team alias",
      status: "changed",
      reason: "Replace active-record Tennessee Titans contamination with Houston Oilers for this Oilers-era trade.",
      before: {
        teams: before.teams,
        teamGrades: before.teamGrades,
        assetsReceivedKeys: before.assetsReceived ? Object.keys(before.assetsReceived) : [],
      },
      after: {
        teams: repaired.teams,
        teamGrades: repaired.teamGrades,
        assetsReceivedKeys: repaired.assetsReceived ? Object.keys(repaired.assetsReceived) : [],
      },
    });
  } else {
    changes.push({
      slug,
      field: "team alias",
      status: "unchanged",
      reason: "No Tennessee Titans slug found inside active record.",
      before: null,
      after: null,
    });
  }

  const t = data[index];

  if (t.teamGrades) {
    t.teamGrades = {
      "kansas-city-chiefs": "C",
      "houston-oilers": "C",
    };
    changes.push({
      slug,
      field: "teamGrades",
      status: "changed",
      reason: "Keep Even Trade grade profile aligned after Houston Oilers alias repair.",
      before: repaired.teamGrades,
      after: t.teamGrades,
    });
  }

  setField(
    t,
    "summary",
    "Kansas City acquired 1978 fifth round pick (#127-Archie Reese) from Houston Oilers for Otis Taylor. Kansas City received the more useful confirmed asset, but the overall stakes remained limited enough to keep the verdict even.",
    changes,
    "Remove narrow-win prose from an Even Trade record."
  );
}

// 2005 Jets/Jaguars.
// Active trades.json is already clean. The bad Grade: B tokens were in old reimport files only.
{
  const slug = "2005-4th-round-pick-127th-overall-new-york-jets-2005";
  const { trade } = findTrade(data, slug);
  const hay = normalizeSpaces([trade.partnerSummary, trade.analysis].join(" "));
  notes.push({
    slug,
    status: hay.includes("Grade: B") ? "needs-active-review" : "skipped-active-clean",
    reason: "Bad Grade: B tokens were found in old reimport files; active trades.json has no Grade: B token to patch.",
  });
}

// 2006 Jaguars/49ers.
// Keep Jaguars Win because active grades are C+ / C-. Remove even-trade wording from partner and analysis.
{
  const slug = "2006-7th-round-pick-213th-overall-san-francisco-49ers-2006";
  const { trade } = findTrade(data, slug);

  setField(
    trade,
    "summary",
    "Jacksonville traded a 6th-round pick to San Francisco for two 7th-round picks, taking James Wyche and Dee Webb. This was a small draft-board reshuffle with limited long-term impact. Jacksonville gained two swings instead of one, and that extra volume gives the Jaguars the narrow edge.",
    changes,
    "Align summary with Jaguars Win and C+ / C- grade spread."
  );

  setField(
    trade,
    "partnerSummary",
    "San Francisco consolidated two 7th-rounders into a 6th-round pick. The 49ers improved their slot slightly, but Jacksonville gained extra volume; that volume gives the Jaguars the narrow edge in a low-stakes exchange.",
    changes,
    "Remove clean-even wording from partnerSummary."
  );

  setField(
    trade,
    "analysis",
    "San Francisco consolidated two 7th-rounders into a 6th-round pick. The 49ers improved their slot slightly, but Jacksonville gained extra volume; that volume gives the Jaguars the narrow edge in a low-stakes exchange.",
    changes,
    "Remove clean-even wording from analysis."
  );
}

// 2023 Bills/Jaguars.
// Even Trade with B/B team cards. Partner token should be Grade: B.
{
  const slug = "2023-1st-round-pick-27th-overall-buffalo-bills-2023";
  const { trade } = findTrade(data, slug);

  replaceInField(
    trade,
    "partnerSummary",
    "Grade: C+",
    "Grade: B",
    changes,
    "Align literal partner Grade token with Buffalo B team card."
  );
}

// Dan Arnold.
// Panthers card is D. Partner-side text should say Grade: D.
{
  const slug = "dan-arnold-carolina-panthers-2021";
  const { trade } = findTrade(data, slug);

  replaceInField(
    trade,
    "partnerSummary",
    "Grade: C",
    "Grade: D",
    changes,
    "Align Panthers literal Grade token with Carolina D team card."
  );

  replaceInField(
    trade,
    "analysis",
    "Grade: C",
    "Grade: D",
    changes,
    "Align Panthers literal Grade token with Carolina D team card."
  );
}

// David Jones.
// Active trades.json is already clean. The bad Grade: B tokens were in old reimport files only.
{
  const slug = "david-jones-cincinnati-bengals-2010";
  const { trade } = findTrade(data, slug);
  const hay = normalizeSpaces([trade.partnerSummary, trade.analysis].join(" "));
  notes.push({
    slug,
    status: hay.includes("Grade: B") ? "needs-active-review" : "skipped-active-clean",
    reason: "Bad Grade: B tokens were found in old reimport files; active trades.json has no Grade: B token to patch.",
  });
}

// Joe Kopcha.
// Keep Detroit Lions Win and B/C grades; remove even-verdict prose.
{
  const slug = "rights-to-joe-kopcha-chicago-bears-1936-09-25";
  const { trade } = findTrade(data, slug);

  setField(
    trade,
    "summary",
    "Detroit acquired rights to Joe Kopcha from Chicago Bears for cash. The available record is thin, but Detroit received the identifiable football asset, which gives the Lions a narrow edge over a cash-only return.",
    changes,
    "Align summary with Detroit Lions Win and B / C grade spread."
  );

  setField(
    trade,
    "partnerSummary",
    "Chicago Bears received cash and gave up rights to Joe Kopcha. The cash return keeps the grade respectable, but Detroit held the narrow edge because it received the identifiable football asset.",
    changes,
    "Remove even-verdict wording from partnerSummary."
  );

  setField(
    trade,
    "analysis",
    "Chicago Bears received cash and gave up rights to Joe Kopcha. The cash return keeps the grade respectable, but Detroit held the narrow edge because it received the identifiable football asset.",
    changes,
    "Remove even-verdict wording from analysis."
  );
}

const validations = [];

validateTrade(data, "1978-fifth-round-pick-127-archie-reese-houston-oilers-1976", [
  {
    field: "summary",
    rule: "summary must not say narrow Chiefs win",
    pass: (value) => !/narrow chiefs win/i.test(value),
  },
  {
    field: "summary",
    rule: "summary should still support even verdict",
    pass: (value) => /\bverdict even\b|\bkeep the verdict even\b|\beven\b/i.test(value),
  },
  {
    field: "teams",
    rule: "teams must include houston-oilers and not tennessee-titans",
    pass: (_value, trade) => Array.isArray(trade.teams) && trade.teams.includes("houston-oilers") && !trade.teams.includes("tennessee-titans"),
  },
], validations);

validateTrade(data, "2006-7th-round-pick-213th-overall-san-francisco-49ers-2006", [
  {
    field: "summary",
    rule: "summary must not say no clear win",
    pass: (value) => !/no clear win|claim a clear win/i.test(value),
  },
  {
    field: "partnerSummary",
    rule: "partnerSummary must not say clean even trade",
    pass: (value) => !/clean even trade/i.test(value),
  },
  {
    field: "analysis",
    rule: "analysis must not say clean even trade",
    pass: (value) => !/clean even trade/i.test(value),
  },
], validations);

validateTrade(data, "2023-1st-round-pick-27th-overall-buffalo-bills-2023", [
  {
    field: "partnerSummary",
    rule: "partnerSummary must say Grade: B, not Grade: C+",
    pass: (value) => /Grade: B\b/.test(value) && !/Grade: C\+/.test(value),
  },
], validations);

validateTrade(data, "dan-arnold-carolina-panthers-2021", [
  {
    field: "partnerSummary",
    rule: "partnerSummary must say Grade: D, not Grade: C",
    pass: (value) => /Grade: D\b/.test(value) && !/Grade: C\b/.test(value),
  },
  {
    field: "analysis",
    rule: "analysis must say Grade: D, not Grade: C",
    pass: (value) => /Grade: D\b/.test(value) && !/Grade: C\b/.test(value),
  },
], validations);

validateTrade(data, "rights-to-joe-kopcha-chicago-bears-1936-09-25", [
  {
    field: "summary",
    rule: "summary must not say no directional win",
    pass: (value) => !/justify a directional win|not show enough durable separation/i.test(value),
  },
  {
    field: "partnerSummary",
    rule: "partnerSummary must not say even verdict",
    pass: (value) => !/even verdict|comparable or limited realized value on both sides/i.test(value),
  },
  {
    field: "analysis",
    rule: "analysis must not say even verdict",
    pass: (value) => !/even verdict|comparable or limited realized value on both sides/i.test(value),
  },
], validations);

const report = {
  mode: APPLY ? "apply" : "dry-run",
  dataFile: rel(DATA_FILE),
  changedCount: changedCount(changes),
  changes,
  notes,
  validations,
  validationFailures: validations.filter((row) => row.status !== "pass"),
};

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "apply-report.json" : "dry-run-report.json"), JSON.stringify(report, null, 2), "utf8");

const summary = [
  "# Task 2 active candidate fix",
  "",
  `Mode: ${APPLY ? "APPLY" : "DRY RUN"}`,
  `Data file: ${rel(DATA_FILE)}`,
  `Changed fields if applied: ${changedCount(changes)}`,
  `Validation failures: ${report.validationFailures.length}`,
  "",
  "## Changes",
  "",
  ...changes.map((change) => `- ${change.status.toUpperCase()}: ${change.slug} / ${change.field} - ${change.reason}`),
  "",
  "## Notes",
  "",
  ...notes.map((note) => `- ${note.status}: ${note.slug} - ${note.reason}`),
  "",
  "## Validation",
  "",
  ...validations.map((row) => `- ${row.status.toUpperCase()}: ${row.slug} / ${row.field} - ${row.rule}`),
  "",
  "No build was run.",
  "",
].join("\n");

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "apply-summary.md" : "dry-run-summary.md"), summary, "utf8");

if (report.validationFailures.length) {
  console.log(summary);
  throw new Error("Validation failed. See " + rel(path.join(OUT_DIR, APPLY ? "apply-report.json" : "dry-run-report.json")));
}

if (APPLY) {
  const backup = path.join(OUT_DIR, "trades.before-task2-active-candidate-fix.json");
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, raw, "utf8");
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

console.log(summary);
console.log("Wrote reports to " + rel(OUT_DIR));
