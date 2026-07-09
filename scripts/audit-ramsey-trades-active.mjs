import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "src", "data", "nfl", "trades.json");
const OUT_DIR = path.join(ROOT, "reports", "quality");
fs.mkdirSync(OUT_DIR, { recursive: true });

const EXPECTED = [
  {
    key: "2019-jaguars-rams",
    expectedDate: "2019-10-16",
    teams: ["jacksonville-jaguars", "los-angeles-rams"],
    mustHaveAny: ["jalen ramsey", "k'lavon chaisson", "klavon chaisson", "travis etienne", "robert rochell"],
    description: "Jaguars traded Jalen Ramsey to Rams for 2020 1st, 2021 1st, and 2021 4th.",
  },
  {
    key: "2023-rams-dolphins",
    expectedDate: "2023-03-12",
    teams: ["los-angeles-rams", "miami-dolphins"],
    mustHaveAny: ["jalen ramsey", "hunter long", "byron young"],
    description: "Rams traded Jalen Ramsey to Dolphins for Hunter Long and 2023 3rd round pick (#77, Byron Young).",
  },
  {
    key: "2025-dolphins-steelers",
    expectedDate: "2025-06-30",
    teams: ["miami-dolphins", "pittsburgh-steelers"],
    mustHaveAny: ["jalen ramsey", "jonnu smith", "minkah fitzpatrick", "2027 5th", "2027 7th"],
    description: "Dolphins traded Jalen Ramsey, Jonnu Smith, and 2027 7th to Steelers for Minkah Fitzpatrick and 2027 5th.",
  },
];

const SEARCH_TERMS = [
  "jalen ramsey",
  "ramsey",
  "hunter long",
  "byron young",
  "k'lavon chaisson",
  "klavon chaisson",
  "travis etienne",
  "robert rochell",
  "jonnu smith",
  "minkah fitzpatrick",
  "jalen camp",
  "jalen",
];

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function norm(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
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
  return Object.entries(value)
    .map(([key, child]) => `${key} ${flatText(child, seen)}`)
    .join(" ");
}

function safe(value) {
  return String(value ?? "(missing)").replace(/\s+/g, " ").trim();
}

function teamMatch(trade, teams) {
  const actual = new Set(Array.isArray(trade.teams) ? trade.teams : []);
  return teams.every((team) => actual.has(team));
}

function dateClose(trade, expectedDate) {
  const d = safe(trade.date || trade.tradeDate || trade.timestamp);
  return d.includes(expectedDate) || d.startsWith(expectedDate.slice(0, 4));
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
  return s;
}

const raw = fs.readFileSync(DATA_FILE, "utf8");
const trades = JSON.parse(raw);

const rows = [];
const textMatches = [];
const exactRamseyMatches = [];
const expectedResults = [];

for (const [index, trade] of trades.entries()) {
  const text = norm(flatText(trade));

  const matchedTerms = SEARCH_TERMS.filter((term) => text.includes(norm(term)));
  if (matchedTerms.length) {
    const row = {
      index,
      slug: trade.slug || "",
      id: trade.id || "",
      date: trade.date || "",
      verdict: trade.verdict || "",
      teams: JSON.stringify(trade.teams || []),
      matchedTerms: matchedTerms.join(" | "),
      title: safe(trade.title),
      summary: safe(trade.summary),
    };
    textMatches.push(row);
    if (text.includes("jalen ramsey")) exactRamseyMatches.push(row);
  }
}

for (const expected of EXPECTED) {
  const hits = [];

  for (const [index, trade] of trades.entries()) {
    const text = norm(flatText(trade));
    const teamsOk = teamMatch(trade, expected.teams);
    const termHits = expected.mustHaveAny.filter((term) => text.includes(norm(term)));
    const exactRamsey = text.includes("jalen ramsey");

    if (teamsOk && (termHits.length || dateClose(trade, expected.expectedDate))) {
      hits.push({
        index,
        slug: trade.slug || "",
        id: trade.id || "",
        date: trade.date || "",
        verdict: trade.verdict || "",
        teams: JSON.stringify(trade.teams || []),
        termHits: termHits.join(" | "),
        exactRamsey,
        summary: safe(trade.summary),
      });
    }
  }

  expectedResults.push({
    expected,
    hits,
  });
}

const lines = [];

lines.push("# Ramsey active-data audit");
lines.push("");
lines.push(`Data file: ${rel(DATA_FILE)}`);
lines.push(`Trades scanned: ${trades.length}`);
lines.push(`Exact "Jalen Ramsey" matches: ${exactRamseyMatches.length}`);
lines.push(`Any Ramsey-related/search-term matches: ${textMatches.length}`);
lines.push("");
lines.push("## Expected Ramsey trade coverage");
lines.push("");

for (const { expected, hits } of expectedResults) {
  lines.push(`### ${expected.key}`);
  lines.push("");
  lines.push(`Expected date: ${expected.expectedDate}`);
  lines.push(`Expected teams: ${expected.teams.join(" vs ")}`);
  lines.push(`Expected description: ${expected.description}`);
  lines.push(`Candidate active records found: ${hits.length}`);
  lines.push("");

  if (!hits.length) {
    lines.push("STATUS: MISSING_OR_NOT_MATCHED");
    lines.push("");
  } else {
    for (const hit of hits) {
      lines.push(`- index ${hit.index} | slug: ${hit.slug}`);
      lines.push(`  id: ${hit.id}`);
      lines.push(`  date: ${hit.date || "(missing)"}`);
      lines.push(`  verdict: ${hit.verdict}`);
      lines.push(`  teams: ${hit.teams}`);
      lines.push(`  termHits: ${hit.termHits || "(date/team-only match)"}`);
      lines.push(`  exactJalenRamsey: ${hit.exactRamsey}`);
      lines.push(`  summary: ${hit.summary}`);
      lines.push("");
    }
  }
}

lines.push("## Exact Jalen Ramsey active matches");
lines.push("");
if (!exactRamseyMatches.length) {
  lines.push("- None");
} else {
  for (const row of exactRamseyMatches) {
    lines.push(`- index ${row.index} | slug: ${row.slug} | teams: ${row.teams} | terms: ${row.matchedTerms}`);
    lines.push(`  summary: ${row.summary}`);
  }
}
lines.push("");

lines.push("## All Ramsey-related/search-term active matches");
lines.push("");
for (const row of textMatches) {
  lines.push(`- index ${row.index} | slug: ${row.slug} | teams: ${row.teams} | terms: ${row.matchedTerms}`);
  lines.push(`  summary: ${row.summary}`);
}
lines.push("");

lines.push("No build was run. No trade JSON was modified.");

const outTxt = path.join(OUT_DIR, "ramsey-trades-active-audit.txt");
const outCsv = path.join(OUT_DIR, "ramsey-trades-active-audit.csv");

fs.writeFileSync(outTxt, lines.join("\n"), "utf8");

const headers = ["index", "slug", "id", "date", "verdict", "teams", "matchedTerms", "title", "summary"];
const csv = [
  headers.join(","),
  ...textMatches.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
].join("\n");
fs.writeFileSync(outCsv, csv, "utf8");

console.log(lines.join("\n"));
console.log("");
console.log("Wrote " + rel(outTxt));
console.log("Wrote " + rel(outCsv));
