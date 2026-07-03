import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const REPORT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const EXPECTED = {
  "RAM-2004-0434": {
    label: "Steven Jackson Rams/Bengals",
    grades: {
      "los-angeles-rams": "A",
      "cincinnati-bengals": "C+"
    },
    requiredPublicTerms: ["Steven Jackson", "Rams win", "Chris Perry", "Stacy Andrews"]
  },
  "CAR-2021-0079": {
    label: "Chuba Hubbard Panthers/Titans",
    grades: {
      "carolina-panthers": "B+",
      "tennessee-titans": "D"
    },
    requiredPublicTerms: ["Chuba Hubbard", "Panthers win", "Keith Taylor", "Phil Hoskins", "Dez Fitzpatrick"]
  },
  "MIA-2016-0262": {
    label: "Laremy Tunsil Dolphins/Eagles",
    grades: {
      "miami-dolphins": "A-",
      "philadelphia-eagles": "C"
    },
    requiredPublicTerms: ["Laremy Tunsil", "Dolphins win", "Byron Maxwell", "Kiko Alonso", "Jack Conklin"]
  }
};

const PUBLIC_LEAK_TERMS = [
  "second pass",
  "the second pass treats",
  "partner side",
  "from the partner side",
  "partner assessment",
  "partner assessment mirrors",
  "opposite value judgment",
  "revised outcome",
  "priority GSC",
  "GSC indexing",
  "manual indexing",
  "priority indexing",
  "indexing page",
  "Status:",
  "Tier:",
  "Confidence:"
];

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

function getId(t) {
  return t.id || t.tradeId || "";
}

function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function publicText(t) {
  const keys = [
    "title","headline","summary","partnerSummary","analysis","description",
    "verdictSummary","shortSummary","longSummary","seoTitle","seoDescription",
    "metaTitle","metaDescription","winnerSummary","loserSummary","excerpt",
    "intro","takeaway"
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

function has(text, term) {
  return String(text || "").toLowerCase().includes(term.toLowerCase());
}

function snippet(text, term, radius = 140) {
  const source = String(text || "");
  const idx = source.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return "";
  return norm(source.slice(Math.max(0, idx - radius), Math.min(source.length, idx + term.length + radius)));
}

const rows = [];
const failures = [];

for (const [id, spec] of Object.entries(EXPECTED)) {
  const t = trades.find(x => getId(x) === id || x.slug === id);

  if (!t) {
    failures.push({ id, issue: "missing record" });
    continue;
  }

  const pub = publicText(t);
  const gradeProblems = [];

  for (const [team, expectedGrade] of Object.entries(spec.grades)) {
    const actual = t.grades?.[team];
    if (actual !== expectedGrade) {
      gradeProblems.push(`${team}: expected ${expectedGrade}, found ${actual}`);
    }
  }

  const missingTerms = spec.requiredPublicTerms.filter(term => !has(pub, term));
  const leaks = PUBLIC_LEAK_TERMS.filter(term => has(pub, term));

  if (gradeProblems.length) failures.push({ id, issue: "grade mismatch", details: gradeProblems });
  if (missingTerms.length) failures.push({ id, issue: "missing public terms", details: missingTerms });
  if (leaks.length) failures.push({ id, issue: "public leak remains", details: leaks });

  rows.push({
    id,
    label: spec.label,
    slug: t.slug,
    grades: t.grades,
    gradeProblems,
    missingTerms,
    publicLeaks: leaks,
    summary: t.summary || "",
    partnerSummary: t.partnerSummary || "",
    analysis: t.analysis || "",
    snippets: Object.fromEntries(spec.requiredPublicTerms.map(term => [term, snippet(pub, term)]))
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
    const hay = `${f.id || ""} ${f.slug || ""} ${f.reason || ""} ${f.evidence || ""}`;
    return Object.keys(EXPECTED).some(id => hay.includes(id));
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  latestAudit,
  failures,
  rows,
  latestFindingsForTargets
};

const jsonPath = path.join(REPORT_DIR, `confirmed-grade-fixes-verification-${RUN_ID}.json`);
const mdPath = path.join(REPORT_DIR, `confirmed-grade-fixes-verification-${RUN_ID}.md`);

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

function cell(v, n = 340) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

fs.writeFileSync(mdPath, [
  "# Confirmed Grade Fixes Verification",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Failures: ${failures.length}`,
  `Latest v2 audit: ${latestAudit || "none found"}`,
  `Latest target findings: ${latestFindingsForTargets.length}`,
  "",
  "## Fixed Records",
  "",
  "| ID | Label | Grades | Grade Problems | Missing Terms | Public Leaks | Summary |",
  "|---|---|---|---|---|---|---|",
  ...rows.map(r => `| ${cell(r.id)} | ${cell(r.label)} | ${cell(JSON.stringify(r.grades), 220)} | ${cell(r.gradeProblems.join("; ") || "none")} | ${cell(r.missingTerms.join("; ") || "none")} | ${cell(r.publicLeaks.join("; ") || "none")} | ${cell(r.summary)} |`),
  "",
  "## Remaining Latest-v2 Findings for Fixed IDs",
  "",
  "| Score | Category | ID/Slug | Reason |",
  "|---:|---|---|---|",
  ...latestFindingsForTargets.map(f => `| ${f.score} | ${cell(f.category)} | ${cell(f.id || f.slug)} | ${cell(f.reason)} |`)
].join("\n"));

console.log(`\nConfirmed grade fixes verification complete.`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${mdPath}\n`);

console.log("Fixed-record verification:");
console.table(rows.map(r => ({
  id: r.id,
  grades: JSON.stringify(r.grades),
  grade_problems: r.gradeProblems.join("; ") || "none",
  missing_terms: r.missingTerms.join("; ") || "none",
  public_leaks: r.publicLeaks.join("; ") || "none"
})));

console.log("\nFailures:");
console.table(failures);

console.log("\nRemaining latest-v2 findings for fixed IDs:");
console.table(latestFindingsForTargets.slice(0, 30).map((f, i) => ({
  rank: i + 1,
  score: f.score,
  category: f.category,
  id_or_slug: f.id || f.slug,
  reason: String(f.reason || "").slice(0, 130)
})));
