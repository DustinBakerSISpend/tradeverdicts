import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const REPORT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const latestAudit = fs.readdirSync(REPORT_DIR)
  .filter(f => /^asset-outcome-sanity-v2-.*\.json$/.test(f))
  .sort()
  .at(-1);

if (!latestAudit) {
  throw new Error("No asset-outcome-sanity-v2 JSON report found in reports/quality.");
}

const findings = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latestAudit), "utf8"));

const TARGET_TERMS = [
  "Steven Jackson",
  "Chris Perry",
  "Stacy Andrews",
  "Chuba Hubbard",
  "Keith Taylor",
  "Phil Hoskins",
  "Dez Fitzpatrick",
  "2014 3rd-round pick",
  "67th overall",
  "Raiders",
  "Dolphins",
  "second pass",
  "partner side",
  "partner assessment",
  "opposite value judgment",
  "revised outcome",
  "Status:",
  "Tier:",
  "Confidence:",
  "priority GSC",
  "manual indexing",
  "priority indexing"
];

const EXACT_WATCH_IDS = new Set([
  "CLE-2009-0360",
  "DEN-2010-04-22-0312",
  "DEN-2000-04-13-0263",
  "IND-2018-0351",
  "CLE-2017-0406",
  "DEN-2019-04-25-0354",
  "MIA-2013-0250",
  "KC-2002-0203"
]);

function allText(obj) {
  const seen = new Set();
  const out = [];
  function walk(x) {
    if (x == null) return;
    if (typeof x === "string" || typeof x === "number") {
      out.push(String(x));
      return;
    }
    if (typeof x !== "object") return;
    if (seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) x.forEach(walk);
    else Object.values(x).forEach(walk);
  }
  walk(obj);
  return out.join("\n");
}

function norm(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function snippet(text, term, radius = 180) {
  const low = text.toLowerCase();
  const idx = low.indexOf(term.toLowerCase());
  if (idx < 0) return "";
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  return norm(text.slice(start, end));
}

function getId(t) {
  return t.id || t.tradeId || "";
}

function getSlug(t) {
  return t.slug || "";
}

function getTitle(t) {
  return t.title || t.headline || "";
}

function getWinner(t) {
  return t.winner || t.winningTeam || t.verdictWinner || t.verdict?.winner || t.outcome?.winner || t.result?.winner || "";
}

function getGrades(t) {
  if (t.grades) return t.grades;
  if (t.teamGrades) return t.teamGrades;
  if (t.visibleGrades) return t.visibleGrades;
  return {};
}

function matchedTerms(text) {
  return TARGET_TERMS.filter(term => text.toLowerCase().includes(term.toLowerCase()));
}

const reviewTrades = [];

for (const t of trades) {
  const text = allText(t);
  const terms = matchedTerms(text);
  const id = getId(t);
  const slug = getSlug(t);

  const exactKnown =
    /Steven Jackson|Chris Perry|Stacy Andrews/i.test(text) ||
    /Chuba Hubbard|Keith Taylor|Phil Hoskins|Dez Fitzpatrick/i.test(text) ||
    (/Raiders|Oakland/i.test(text) && /Dolphins|Miami/i.test(text) && /67th overall|2014 3rd|C-|B-|second pass|partner side/i.test(text)) ||
    EXACT_WATCH_IDS.has(id) ||
    EXACT_WATCH_IDS.has(slug);

  if (!exactKnown && terms.length === 0) continue;

  reviewTrades.push({
    id,
    slug,
    title: getTitle(t),
    winner: getWinner(t),
    grades: getGrades(t),
    terms,
    stevenJacksonSnippet: snippet(text, "Steven Jackson"),
    chubaSnippet: snippet(text, "Chuba Hubbard"),
    processSnippet:
      snippet(text, "second pass") ||
      snippet(text, "partner side") ||
      snippet(text, "partner assessment") ||
      snippet(text, "opposite value judgment") ||
      snippet(text, "revised outcome"),
    metadataSnippet:
      snippet(text, "Status:") ||
      snippet(text, "Tier:") ||
      snippet(text, "Confidence:") ||
      snippet(text, "priority GSC") ||
      snippet(text, "manual indexing"),
    gradeSnippet:
      snippet(text, "C-") ||
      snippet(text, "B-") ||
      snippet(text, "D+") ||
      snippet(text, "grade"),
    rawTextPreview: norm(text).slice(0, 1000)
  });
}

const findingBuckets = {
  stevenJackson: findings.filter(f => /Steven Jackson|Chris Perry|Stacy Andrews/i.test(`${f.reason} ${f.evidence} ${f.title} ${f.slug} ${f.id}`)),
  chubaHubbard: findings.filter(f => /Chuba Hubbard|Keith Taylor|Phil Hoskins|Dez Fitzpatrick/i.test(`${f.reason} ${f.evidence} ${f.title} ${f.slug} ${f.id}`)),
  bodyGradeContradictions: findings.filter(f => f.category === "body grade contradiction").slice(0, 75),
  processLeaks: findings.filter(f => f.category === "process-language leak").slice(0, 75),
  metadataLeaks: findings.filter(f => f.category === "metadata/indexing leak").slice(0, 75),
  wrongSideVerdicts: findings.filter(f => f.category === "likely wrong-side verdict").slice(0, 75),
  lowWinnerGrades: findings.filter(f => f.category === "winner/useful outcome grade too low"),
  highValueNameProblems: findings.filter(f => /high-value name|Steven Jackson|Chuba Hubbard/.test(f.category)).slice(0, 100)
};

const out = {
  generatedAt: new Date().toISOString(),
  sourceAudit: latestAudit,
  reviewTradeCount: reviewTrades.length,
  reviewTrades,
  findingBuckets
};

const jsonPath = path.join(REPORT_DIR, `launch-blocker-review-pack-${RUN_ID}.json`);
const mdPath = path.join(REPORT_DIR, `launch-blocker-review-pack-${RUN_ID}.md`);

fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

function mdCell(v) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 260);
}

function table(rows) {
  return [
    "| ID | Slug | Title | Winner | Grades | Terms | Key Snippet |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(r => `| ${mdCell(r.id)} | ${mdCell(r.slug)} | ${mdCell(r.title)} | ${mdCell(r.winner)} | ${mdCell(JSON.stringify(r.grades))} | ${mdCell(r.terms.join(", "))} | ${mdCell(r.stevenJacksonSnippet || r.chubaSnippet || r.processSnippet || r.metadataSnippet || r.gradeSnippet || r.rawTextPreview)} |`)
  ].join("\n");
}

function findingTable(rows) {
  return [
    "| Score | Category | ID/Slug | Winner | Reason | Evidence |",
    "|---:|---|---|---|---|---|",
    ...rows.map(f => `| ${f.score} | ${mdCell(f.category)} | ${mdCell(f.id || f.slug)} | ${mdCell(f.winner)} | ${mdCell(f.reason)} | ${mdCell(f.evidence)} |`)
  ].join("\n");
}

fs.writeFileSync(mdPath, [
  "# TradeVerdicts Launch Blocker Review Pack",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Source audit: ${latestAudit}`,
  `Review trades found: ${reviewTrades.length}`,
  "",
  "## Exact / Known Target Trade Records",
  "",
  table(reviewTrades),
  "",
  "## Steven Jackson Findings",
  "",
  findingTable(findingBuckets.stevenJackson.slice(0, 50)),
  "",
  "## Chuba Hubbard Findings",
  "",
  findingTable(findingBuckets.chubaHubbard.slice(0, 50)),
  "",
  "## Winner Useful Outcome Grade Too Low",
  "",
  findingTable(findingBuckets.lowWinnerGrades.slice(0, 50)),
  "",
  "## Top Body Grade Contradictions",
  "",
  findingTable(findingBuckets.bodyGradeContradictions.slice(0, 50)),
  "",
  "## Top Process Language Leaks",
  "",
  findingTable(findingBuckets.processLeaks.slice(0, 50)),
  "",
  "## Top Metadata / Indexing Leaks",
  "",
  findingTable(findingBuckets.metadataLeaks.slice(0, 50)),
  "",
  "## Top Likely Wrong-Side Verdicts",
  "",
  findingTable(findingBuckets.wrongSideVerdicts.slice(0, 50))
].join("\n"));

console.log(`\nLaunch-blocker review pack created.`);
console.log(`Source audit: ${latestAudit}`);
console.log(`Review trades found: ${reviewTrades.length}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${mdPath}\n`);

console.log("Exact / known target records:");
console.table(reviewTrades.slice(0, 30).map((r, i) => ({
  rank: i + 1,
  id: r.id,
  slug: r.slug,
  title: r.title.slice(0, 60),
  winner: String(r.winner).slice(0, 32),
  grades: JSON.stringify(r.grades).slice(0, 80),
  terms: r.terms.join(", ").slice(0, 90)
})));

console.log("\nSteven Jackson findings:");
console.table(findingBuckets.stevenJackson.slice(0, 15).map((f, i) => ({
  rank: i + 1,
  score: f.score,
  category: f.category,
  id_or_slug: f.id || f.slug,
  winner: f.winner,
  reason: f.reason.slice(0, 130)
})));

console.log("\nChuba Hubbard findings:");
console.table(findingBuckets.chubaHubbard.slice(0, 15).map((f, i) => ({
  rank: i + 1,
  score: f.score,
  category: f.category,
  id_or_slug: f.id || f.slug,
  winner: f.winner,
  reason: f.reason.slice(0, 130)
})));

console.log("\nWinner/useful outcome grade too low:");
console.table(findingBuckets.lowWinnerGrades.slice(0, 20).map((f, i) => ({
  rank: i + 1,
  score: f.score,
  category: f.category,
  id_or_slug: f.id || f.slug,
  winner: f.winner,
  reason: f.reason.slice(0, 130)
})));

console.log("\nTop public-copy leaks to inspect first:");
console.table([
  ...findingBuckets.processLeaks.slice(0, 10),
  ...findingBuckets.metadataLeaks.slice(0, 10)
].map((f, i) => ({
  rank: i + 1,
  score: f.score,
  category: f.category,
  id_or_slug: f.id || f.slug,
  reason: f.reason.slice(0, 130)
})));
