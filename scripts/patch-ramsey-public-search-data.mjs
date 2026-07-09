import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const DATA_FILE = path.join(ROOT, "src", "data", "nfl", "trades.json");
const SEARCH_FILE = path.join(ROOT, "src", "pages", "search.astro");
const OUT_DIR = path.join(ROOT, "reports", "quality");

fs.mkdirSync(OUT_DIR, { recursive: true });

const RAMSEY_2019 = "2020-1st-round-pick-20th-overall-los-angeles-st-louis-rams-2019";
const RAMSEY_2023 = "jalen-ramsey-rams-2023";
const RAMSEY_2025 = "jalen-ramsey-jonnu-smith-miami-dolphins-2025";

const EXPECTED_PUBLIC_RAMSEY_SLUGS = [RAMSEY_2019, RAMSEY_2023, RAMSEY_2025];

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[â€™']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
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

function isPublicTrade(trade) {
  const text = normalize([
    trade.status,
    trade.publishStatus,
    trade.publicStatus,
    trade.visibility,
    trade.pageStatus,
    trade.state,
    safeJson(trade.flags),
    safeJson(trade.tags),
  ].join(" "));

  if (trade.suppressed === true) return false;
  if (trade.hidden === true) return false;
  if (trade.holdConflict === true) return false;
  if (trade.publishStatus === "hold-conflict") return false;
  if (text.includes("suppressed")) return false;
  if (text.includes("hidden")) return false;
  if (text.includes("hold conflict")) return false;
  if (text.includes("holdconflict")) return false;

  return true;
}

function findTrade(data, slug) {
  const index = data.findIndex((trade) => trade && trade.slug === slug);
  if (index === -1) throw new Error("Missing trade slug: " + slug);
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

const raw = fs.readFileSync(DATA_FILE, "utf8");
const data = JSON.parse(raw);
const beforeData = JSON.parse(raw);
const changes = [];

// 2019 Jaguars -> Rams Jalen Ramsey trade.
// User explicitly wants landmark treatment preserved. Active diagnostic showed tier was "major".
{
  const { trade } = findTrade(data, RAMSEY_2019);

  setField(
    trade,
    "publishStatus",
    "ready",
    changes,
    "Ensure the 2019 Jalen Ramsey landmark trade is public-searchable."
  );

  setField(
    trade,
    "tier",
    "landmark",
    changes,
    "Give the 2019 Jalen Ramsey Jaguars-Rams trade landmark treatment in search ranking."
  );

  if (trade.suppressed === true) {
    setField(trade, "suppressed", false, changes, "Remove boolean suppressed flag from 2019 Ramsey trade.");
  }

  if (trade.hidden === true) {
    setField(trade, "hidden", false, changes, "Remove boolean hidden flag from 2019 Ramsey trade.");
  }
}

// 2025 Dolphins -> Steelers Jalen Ramsey/Jonnu Smith/Minkah Fitzpatrick trade.
// Active diagnostic showed publishStatus was "suppressed", which excludes it from search.
{
  const { trade } = findTrade(data, RAMSEY_2025);

  setField(
    trade,
    "publishStatus",
    "ready",
    changes,
    "Make the 2025 Jalen Ramsey/Jonnu Smith/Minkah Fitzpatrick trade public-searchable."
  );

  setField(
    trade,
    "tier",
    "major",
    changes,
    "Keep the 2025 Ramsey trade major, not landmark."
  );

  if (trade.suppressed === true) {
    setField(trade, "suppressed", false, changes, "Remove boolean suppressed flag from 2025 Ramsey trade.");
  }

  if (trade.hidden === true) {
    setField(trade, "hidden", false, changes, "Remove boolean hidden flag from 2025 Ramsey trade.");
  }
}

const searchAstro = fs.existsSync(SEARCH_FILE) ? fs.readFileSync(SEARCH_FILE, "utf8") : "";
const publicExactRamsey = data
  .map((trade, index) => ({ trade, index }))
  .filter(({ trade }) => isPublicTrade(trade))
  .filter(({ trade }) => normalize(flatText(trade)).includes("jalen ramsey"))
  .map(({ trade, index }) => ({
    index,
    slug: trade.slug,
    publishStatus: trade.publishStatus || "",
    tier: trade.tier || "",
    confidence: trade.confidence || "",
    verdict: trade.verdict || "",
  }));

const publicRamseySlugSet = new Set(publicExactRamsey.map((row) => row.slug));

const validations = [];

function check(rule, pass, detail = "") {
  validations.push({ rule, status: pass ? "pass" : "fail", detail });
}

check("2019 Ramsey trade is public", isPublicTrade(findTrade(data, RAMSEY_2019).trade), JSON.stringify(findTrade(data, RAMSEY_2019).trade.publishStatus));
check("2019 Ramsey trade is landmark", findTrade(data, RAMSEY_2019).trade.tier === "landmark", findTrade(data, RAMSEY_2019).trade.tier);
check("2023 Ramsey trade remains public", isPublicTrade(findTrade(data, RAMSEY_2023).trade), JSON.stringify(findTrade(data, RAMSEY_2023).trade.publishStatus));
check("2025 Ramsey trade is public", isPublicTrade(findTrade(data, RAMSEY_2025).trade), JSON.stringify(findTrade(data, RAMSEY_2025).trade.publishStatus));
check("All three expected Ramsey slugs are public exact Jalen Ramsey matches", EXPECTED_PUBLIC_RAMSEY_SLUGS.every((slug) => publicRamseySlugSet.has(slug)), JSON.stringify(publicExactRamsey, null, 2));
check("Search page exposes tier to client index", /tier:\s*String\(trade\.tier/.test(searchAstro), "Run/apply the Ramsey search ranking patch if this fails.");
check("Search page scores results before date sorting", /searchScore:\s*scoreSearchResult\(item,\s*query\)/.test(searchAstro), "Run/apply the Ramsey search ranking patch if this fails.");

const failures = validations.filter((row) => row.status !== "pass");

const report = {
  mode: APPLY ? "apply" : "dry-run",
  dataFile: rel(DATA_FILE),
  changed: JSON.stringify(beforeData) !== JSON.stringify(data),
  changes,
  publicExactRamsey,
  validations,
  failures,
};

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "ramsey-public-search-data-apply-report.json" : "ramsey-public-search-data-dry-run-report.json"), JSON.stringify(report, null, 2), "utf8");

const summary = [
  "# Ramsey public search data patch",
  "",
  `Mode: ${APPLY ? "APPLY" : "DRY RUN"}`,
  `Data file: ${rel(DATA_FILE)}`,
  `Would change data file: ${JSON.stringify(beforeData) !== JSON.stringify(data)}`,
  `Validation failures: ${failures.length}`,
  "",
  "## Changes",
  "",
  ...changes.map((row) => `- ${row.status.toUpperCase()}: ${row.slug} / ${row.field} - ${row.reason} (${row.before ?? "(missing)"} -> ${row.after ?? "(missing)"})`),
  "",
  "## Public exact Jalen Ramsey records after patch",
  "",
  ...publicExactRamsey.map((row) => `- index ${row.index} | ${row.slug} | publishStatus=${row.publishStatus || "(missing)"} | tier=${row.tier || "(missing)"} | confidence=${row.confidence || "(missing)"}`),
  "",
  "## Validation",
  "",
  ...validations.map((row) => `- ${row.status.toUpperCase()}: ${row.rule}`),
  "",
  failures.length ? "## Failures" : "## Failures",
  "",
  ...(failures.length ? failures.map((row) => `- ${row.rule}: ${row.detail}`) : ["- None"]),
  "",
  "No build was run.",
  "",
].join("\n");

fs.writeFileSync(path.join(OUT_DIR, APPLY ? "ramsey-public-search-data-apply-summary.md" : "ramsey-public-search-data-dry-run-summary.md"), summary, "utf8");

if (failures.length) {
  console.log(summary);
  throw new Error("Validation failed. See " + rel(path.join(OUT_DIR, APPLY ? "ramsey-public-search-data-apply-report.json" : "ramsey-public-search-data-dry-run-report.json")));
}

if (APPLY) {
  const backup = path.join(OUT_DIR, "trades.before-ramsey-public-search-data-patch.json");
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw, "utf8");
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

console.log(summary);
console.log("Wrote reports to " + rel(OUT_DIR));
