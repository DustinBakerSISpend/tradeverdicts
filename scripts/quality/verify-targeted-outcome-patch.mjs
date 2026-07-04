import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const REPORT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const TARGETS = {
  "RAM-2004-0434": {
    expectedGrades: {
      "los-angeles-rams": "A",
      "cincinnati-bengals": "C+"
    },
    mustInclude: ["Steven Jackson", "Chris Perry", "Stacy Andrews", "Rams win"],
    mustNotIncludePublic: ["second pass", "partner side", "partner assessment", "opposite value judgment", "revised outcome", "Status:", "Tier:", "Confidence:", "priority GSC", "manual indexing", "priority indexing"]
  },
  "CAR-2021-0079": {
    expectedGrades: {
      "carolina-panthers": "B+",
      "tennessee-titans": "D"
    },
    mustInclude: ["Chuba Hubbard", "Keith Taylor", "Phil Hoskins", "Dez Fitzpatrick", "Panthers win"],
    mustNotIncludePublic: ["second pass", "partner side", "partner assessment", "opposite value judgment", "revised outcome", "Status:", "Tier:", "Confidence:", "priority GSC", "manual indexing", "priority indexing"]
  }
};

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

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

function publicText(t) {
  const keys = [
    "title","headline","summary","partnerSummary","analysis","description",
    "verdictSummary","shortSummary","longSummary","seoTitle","seoDescription",
    "metaTitle","metaDescription","winnerSummary","loserSummary","excerpt","intro","takeaway"
  ];

  const parts = [];
  for (const k of keys) {
    if (typeof t[k] === "string") parts.push(t[k]);
  }

  if (Array.isArray(t.perspectives)) {
    for (const p of t.perspectives) {
      for (const k of ["primarySummary","partnerSummary","summary","analysis","verdictSummary","description"]) {
        if (typeof p[k] === "string") parts.push(p[k]);
      }
    }
  }

  return parts.join("\n");
}

function getId(t) {
  return t.id || t.tradeId || "";
}

function hasTerm(text, term) {
  return text.toLowerCase().includes(term.toLowerCase());
}

function snippet(text, term, radius = 140) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return "";
  return text.slice(Math.max(0, i - radius), Math.min(text.length, i + term.length + radius)).replace(/\s+/g, " ").trim();
}

const rows = [];
const failures = [];

for (const [id, spec] of Object.entries(TARGETS)) {
  const t = trades.find(x => getId(x) === id || x.slug === id);
  if (!t) {
    failures.push({ id, issue: "missing target record" });
    continue;
  }

  const pub = publicText(t);
  const full = allText(t);
  const grades = t.grades || {};

  const gradeProblems = [];
  for (const [team, expected] of Object.entries(spec.expectedGrades)) {
    if (grades[team] !== expected) {
      gradeProblems.push(`${team}: expected ${expected}, found ${grades[team]}`);
    }
  }

  const missingRequired = spec.mustInclude.filter(term => !hasTerm(pub, term) && !hasTerm(full, term));
  const publicLeaks = spec.mustNotIncludePublic.filter(term => hasTerm(pub, term));

  if (gradeProblems.length) failures.push({ id, issue: "grade mismatch", details: gradeProblems });
  if (missingRequired.length) failures.push({ id, issue: "missing required terms", details: missingRequired });
  if (publicLeaks.length) failures.push({ id, issue: "public leak remains", details: publicLeaks });

  rows.push({
    id,
    slug: t.slug,
    grades,
    summary: t.summary || "",
    partnerSummary: t.partnerSummary || "",
    analysis: t.analysis || "",
    requiredTermsPresent: spec.mustInclude.filter(term => hasTerm(pub, term) || hasTerm(full, term)),
    publicLeaks,
    gradeProblems,
    snippets: Object.fromEntries(spec.mustInclude.map(term => [term, snippet(pub || full, term)]))
  });
}

const latestAudit = fs.readdirSync(REPORT_DIR)
  .filter(f => /^asset-outcome-sanity-v2-.*\.json$/.test(f))
  .sort()
  .at(-1);

let latestFindingsForTargets = [];
if (latestAudit) {
  const findings = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latestAudit), "utf8"));
  latestFindingsForTargets = findings.filter(f => {
    const hay = `${f.id} ${f.slug} ${f.title} ${f.reason} ${f.evidence}`;
    return Object.keys(TARGETS).some(id => hay.includes(id));
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  targetCount: Object.keys(TARGETS).length,
  failures,
  latestAudit,
  latestFindingsForTargets,
  rows
};

const jsonPath = path.join(REPORT_DIR, `post-targeted-patch-verification-${RUN_ID}.json`);
const mdPath = path.join(REPORT_DIR, `post-targeted-patch-verification-${RUN_ID}.md`);

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

function cell(v, n = 340) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

fs.writeFileSync(mdPath, [
  "# Post Targeted Patch Verification",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Failures: ${failures.length}`,
  `Latest v2 audit: ${latestAudit || "none found"}`,
  `Target findings still in latest v2 audit: ${latestFindingsForTargets.length}`,
  "",
  "## Target Records",
  "",
  "| ID | Grades | Public Leaks | Grade Problems | Summary |",
  "|---|---|---|---|---|",
  ...rows.map(r => `| ${cell(r.id)} | ${cell(JSON.stringify(r.grades))} | ${cell(r.publicLeaks.join(", ") || "none")} | ${cell(r.gradeProblems.join(", ") || "none")} | ${cell(r.summary)} |`),
  "",
  "## Remaining Latest-v2 Findings for Targets",
  "",
  "| Score | Category | ID/Slug | Reason |",
  "|---:|---|---|---|",
  ...latestFindingsForTargets.map(f => `| ${f.score} | ${cell(f.category)} | ${cell(f.id || f.slug)} | ${cell(f.reason)} |`)
].join("\n"));

console.log(`\nPost-patch verification written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${mdPath}\n`);

console.log("Target verification:");
console.table(rows.map(r => ({
  id: r.id,
  grades: JSON.stringify(r.grades),
  public_leaks: r.publicLeaks.join(", ") || "none",
  grade_problems: r.gradeProblems.join(", ") || "none",
  required_terms: r.requiredTermsPresent.join(", ")
})));

console.log("\nFailures:");
console.table(failures);

console.log("\nTarget findings still present in latest v2 report:");
console.table(latestFindingsForTargets.slice(0, 25).map((f, i) => ({
  rank: i + 1,
  score: f.score,
  category: f.category,
  id_or_slug: f.id || f.slug,
  reason: f.reason.slice(0, 130)
})));
