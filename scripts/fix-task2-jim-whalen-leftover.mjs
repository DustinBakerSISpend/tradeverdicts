import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const DATA_FILE = path.join(ROOT, "src", "data", "nfl", "trades.json");
const OUT_DIR = path.join(ROOT, "audits", "nfl-verdict-grade-consistency-jim-whalen-leftover-fix");

fs.mkdirSync(OUT_DIR, { recursive: true });

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const slug = "jim-whalen-new-england-patriots-1970";
const raw = fs.readFileSync(DATA_FILE, "utf8");
const data = JSON.parse(raw);

const index = data.findIndex((trade) => trade && trade.slug === slug);
if (index === -1) throw new Error("Missing slug: " + slug);

const trade = data[index];
const before = {
  summary: trade.summary,
  analysis: trade.analysis,
};

const changes = [];

function replaceInField(field, from, to, reason) {
  const oldValue = trade[field];

  if (typeof oldValue !== "string") {
    changes.push({ field, status: "skipped", reason: reason + " (field is not a string)", before: oldValue, after: oldValue });
    return;
  }

  if (!oldValue.includes(from)) {
    changes.push({ field, status: "skipped", reason: reason + " (target text not found)", before: oldValue, after: oldValue });
    return;
  }

  const newValue = oldValue.replace(from, to);
  trade[field] = newValue;
  changes.push({ field, status: oldValue === newValue ? "unchanged" : "changed", reason, before: oldValue, after: newValue });
}

replaceInField(
  "summary",
  "not a clear franchise-changing win",
  "not a clear franchise-changing outcome",
  "Remove win wording from the last remaining Even Trade false-positive field."
);

// In case this was not already changed by v3, keep it safe and idempotent.
replaceInField(
  "analysis",
  "does not create a clear long-term winner",
  "does not create clear long-term separation",
  "Remove winner wording from Even Trade analysis if still present."
);

const combined = normalizeSpaces([trade.summary, trade.partnerSummary, trade.analysis].join(" "));
const validations = [
  {
    rule: "verdict remains Even Trade",
    status: trade.verdict === "Even Trade" ? "pass" : "fail",
    value: trade.verdict,
  },
  {
    rule: "summary no longer says clear franchise-changing win",
    status: !/clear franchise-changing win/i.test(trade.summary || "") ? "pass" : "fail",
    value: trade.summary,
  },
  {
    rule: "analysis no longer says clear long-term winner",
    status: !/clear long-term winner/i.test(trade.analysis || "") ? "pass" : "fail",
    value: trade.analysis,
  },
  {
    rule: "combined Whalen prose has no obvious win/winner false-positive wording",
    status: !/clear franchise-changing win|clear long-term winner/i.test(combined) ? "pass" : "fail",
    value: combined,
  },
];

const failures = validations.filter((row) => row.status !== "pass");
const changedCount = changes.filter((row) => row.status === "changed").length;

const report = {
  mode: APPLY ? "apply" : "dry-run",
  dataFile: rel(DATA_FILE),
  slug,
  changedCount,
  changes,
  validations,
  failures,
  before,
  after: {
    summary: trade.summary,
    analysis: trade.analysis,
  },
};

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "apply-report.json" : "dry-run-report.json"), JSON.stringify(report, null, 2), "utf8");

const summary = [
  "# Task 2 Jim Whalen leftover fix",
  "",
  `Mode: ${APPLY ? "APPLY" : "DRY RUN"}`,
  `Data file: ${rel(DATA_FILE)}`,
  `Slug: ${slug}`,
  `Changed fields if applied: ${changedCount}`,
  `Validation failures: ${failures.length}`,
  "",
  "## Changes",
  "",
  ...changes.map((row) => `- ${row.status.toUpperCase()}: ${row.field} - ${row.reason}`),
  "",
  "## Validation",
  "",
  ...validations.map((row) => `- ${row.status.toUpperCase()}: ${row.rule}`),
  "",
  failures.length ? "## Failures" : "## Failures",
  "",
  ...(failures.length ? failures.map((row) => `- ${row.rule}\n  Value: ${row.value}`) : ["- None"]),
  "",
  "No build was run.",
  "",
].join("\n");

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "apply-summary.md" : "dry-run-summary.md"), summary, "utf8");

if (failures.length) {
  console.log(summary);
  throw new Error("Validation failed. See " + rel(path.join(OUT_DIR, APPLY ? "apply-report.json" : "dry-run-report.json")));
}

if (APPLY) {
  const backup = path.join(OUT_DIR, "trades.before-jim-whalen-leftover-fix.json");
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw, "utf8");
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

console.log(summary);
console.log("Wrote reports to " + rel(OUT_DIR));
