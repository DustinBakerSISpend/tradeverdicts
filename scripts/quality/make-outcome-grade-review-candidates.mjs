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
  throw new Error("No asset-outcome-sanity-v2 JSON report found. Run audit-verdict-outcome-sanity-v2.mjs first.");
}

const findings = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latestAudit), "utf8"));

const GRADE_POINTS = {
  "A+": 12, "A": 11, "A-": 10,
  "B+": 9, "B": 8, "B-": 7,
  "C+": 6, "C": 5, "C-": 4,
  "D+": 3, "D": 2, "D-": 1,
  "F": 0
};

const REVIEW_CATEGORIES = new Set([
  "likely wrong-side verdict",
  "star/superior outcome on low-graded side",
  "winner/useful outcome grade too low",
  "high-value name not on winner side",
  "high-value name below expected grade floor",
  "high-value name owner unclear",
  "body grade contradiction",
  "verdict vs grades mismatch"
]);

const OUTCOME_TERMS = [
  "Pro Bowl", "All-Pro", "Hall of Fame", "MVP", "rookie of the year",
  "starter", "started", "multi-year starter", "longtime starter",
  "franchise quarterback", "primary back", "1,000-yard", "thousand-yard",
  "rushed for", "receiving yards", "passing yards", "sacks", "interceptions",
  "touchdowns", "played", "seasons", "career", "became the clear best player",
  "defining asset", "useful multiyear", "real multiyear production"
];

const HIGH_VALUE_NAMES = [
  "Steven Jackson","Jalen Ramsey","Micah Parsons","Myles Garrett","Aaron Rodgers",
  "Brett Favre","Herschel Walker","Marshall Faulk","Randy Moss","Khalil Mack",
  "Christian McCaffrey","Tyreek Hill","Davante Adams","DeAndre Hopkins","Julio Jones",
  "Stefon Diggs","Trent Williams","Laremy Tunsil","Matthew Stafford","Russell Wilson",
  "Eli Manning","Philip Rivers","John Elway","Eric Dickerson","Champ Bailey",
  "Clinton Portis","Jared Allen","Tony Gonzalez","Jason Peters","Jerome Bettis",
  "Marshawn Lynch","Amari Cooper","Brandin Cooks","A.J. Brown","Chuba Hubbard",
  "Nick Chubb","Dak Prescott","Lamar Jackson","Josh Allen","Patrick Mahomes",
  "T.J. Watt","Justin Jefferson","CeeDee Lamb","DK Metcalf","George Kittle",
  "Travis Kelce","Rob Gronkowski","Jason Taylor","Zach Thomas","Drew Brees",
  "LaDainian Tomlinson","Ed Reed","Troy Polamalu","Terrell Owens","Anquan Boldin"
];

function gradeValue(g) {
  const clean = String(g || "").trim().toUpperCase();
  return Object.hasOwn(GRADE_POINTS, clean) ? GRADE_POINTS[clean] : null;
}

function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

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

function getId(t) {
  return t.id || t.tradeId || "";
}

function getSlug(t) {
  return t.slug || "";
}

function keyForTrade(t) {
  return getId(t) || getSlug(t);
}

function getGrades(t) {
  return t.grades || t.teamGrades || t.visibleGrades || {};
}

function bestAndWorstGrades(grades) {
  const rows = Object.entries(grades)
    .map(([team, grade]) => ({ team, grade, value: gradeValue(grade) }))
    .filter(r => r.value != null)
    .sort((a, b) => b.value - a.value);

  return {
    best: rows[0] || null,
    worst: rows.at(-1) || null,
    rows
  };
}

function outcomeScore(text) {
  const source = String(text || "");
  let score = 0;
  const hits = [];

  for (const name of HIGH_VALUE_NAMES) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(source)) {
      score += 50;
      hits.push(name);
    }
  }

  for (const term of OUTCOME_TERMS) {
    if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(source)) {
      score += 18;
      hits.push(term);
    }
  }

  // Stat lines: catches things like "1,408 yards", "12 sacks", "45 starts".
  const statHits = source.match(/\b\d{2,3}(?:,\d{3})?\s+(?:yards|touchdowns|starts|games|sacks|interceptions|passes|receptions|tackles)\b/gi) || [];
  if (statHits.length) {
    score += Math.min(60, statHits.length * 15);
    hits.push(...statHits.slice(0, 6));
  }

  // High draft-pick signal.
  for (const m of source.matchAll(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/gi)) {
    const n = Number(m[1]);
    if (n <= 5) score += 35;
    else if (n <= 15) score += 25;
    else if (n <= 32) score += 18;
    else if (n <= 100) score += 8;
    hits.push(`${n} overall`);
  }

  if (/\b1st[- ]round|first[- ]round\b/i.test(source)) {
    score += 12;
    hits.push("1st-round pick");
  }

  return { score, hits: [...new Set(hits)] };
}

function snippetsForTerms(text, terms, max = 4) {
  const source = String(text || "");
  const snippets = [];

  for (const term of terms) {
    const idx = source.toLowerCase().indexOf(term.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 130);
      const end = Math.min(source.length, idx + term.length + 170);
      snippets.push(norm(source.slice(start, end)));
    }
    if (snippets.length >= max) break;
  }

  return snippets;
}

function sideAssetRows(t) {
  const rows = [];
  const assets = t.assetsReceived || t.received || t.assets || {};

  if (assets && typeof assets === "object" && !Array.isArray(assets)) {
    for (const [team, assetList] of Object.entries(assets)) {
      const txt = allText(assetList);
      const scored = outcomeScore(txt);
      if (scored.score > 0) rows.push({ team, score: scored.score, hits: scored.hits, text: txt });
    }
  }

  return rows.sort((a, b) => b.score - a.score);
}

const findingByKey = new Map();

for (const f of findings) {
  if (!REVIEW_CATEGORIES.has(f.category)) continue;
  const k = f.id || f.slug;
  if (!k) continue;
  if (!findingByKey.has(k)) findingByKey.set(k, []);
  findingByKey.get(k).push(f);
}

const candidates = [];

for (const t of trades) {
  const k = keyForTrade(t);
  const auditFindings = findingByKey.get(k) || [];
  const text = allText(t);
  const pub = publicText(t);
  const grades = getGrades(t);
  const gradeInfo = bestAndWorstGrades(grades);
  const sideRows = sideAssetRows(t);
  const pubOutcome = outcomeScore(pub);
  const fullOutcome = outcomeScore(text);

  const categories = [...new Set(auditFindings.map(f => f.category))];
  const reasons = auditFindings.map(f => f.reason).slice(0, 8);
  const auditScore = auditFindings.reduce((sum, f) => sum + Math.min(250, Number(f.score || 0)), 0);

  let score = auditScore;
  const flags = [];

  if (categories.includes("likely wrong-side verdict")) {
    score += 300;
    flags.push("wrong-side verdict candidate");
  }

  if (categories.includes("star/superior outcome on low-graded side")) {
    score += 260;
    flags.push("star/superior outcome low grade");
  }

  if (categories.includes("winner/useful outcome grade too low")) {
    score += 280;
    flags.push("winner useful outcome too low");
  }

  if (categories.includes("high-value name not on winner side")) {
    score += 240;
    flags.push("high-value name not winner side");
  }

  if (categories.includes("high-value name below expected grade floor")) {
    score += 220;
    flags.push("high-value name below grade floor");
  }

  if (categories.includes("body grade contradiction")) {
    score += 110;
    flags.push("body grade contradiction");
  }

  if (categories.includes("verdict vs grades mismatch")) {
    score += 140;
    flags.push("verdict/grades mismatch");
  }

  for (const row of sideRows) {
    const g = grades[row.team];
    const gv = gradeValue(g);

    if (gv != null && row.score >= 50 && gv <= gradeValue("C+")) {
      score += 220 + row.score;
      flags.push(`${row.team} asset score ${row.score} but grade ${g}`);
    }

    if (gv != null && row.score >= 35 && gv <= gradeValue("D+")) {
      score += 260 + row.score;
      flags.push(`${row.team} useful asset signal but very low grade ${g}`);
    }
  }

  if (pubOutcome.score >= 50 && gradeInfo.best && gradeInfo.best.value <= gradeValue("C+")) {
    score += 180 + pubOutcome.score;
    flags.push(`public copy has outcome signal but best grade only ${gradeInfo.best.grade}`);
  }

  if (fullOutcome.score >= 70 && gradeInfo.worst && gradeInfo.worst.value <= gradeValue("D+")) {
    score += 100 + fullOutcome.score;
    flags.push(`record has strong outcome signal and at least one D+/lower side`);
  }

  // Keep only meaningful candidates. This prevents the report from becoming the whole database.
  if (score < 300 && flags.length === 0) continue;

  const evidenceTerms = [
    ...pubOutcome.hits,
    ...fullOutcome.hits,
    ...sideRows.flatMap(r => r.hits),
    ...HIGH_VALUE_NAMES.filter(name => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))
  ];

  candidates.push({
    score,
    id: getId(t),
    slug: getSlug(t),
    title: t.title || t.headline || "",
    grades,
    bestGrade: gradeInfo.best,
    worstGrade: gradeInfo.worst,
    categories,
    flags: [...new Set(flags)],
    reasons: [...new Set(reasons)],
    assetSides: sideRows.slice(0, 4).map(r => ({
      team: r.team,
      assetScore: r.score,
      grade: grades[r.team],
      hits: r.hits.slice(0, 8),
      text: norm(r.text).slice(0, 260)
    })),
    evidenceTerms: [...new Set(evidenceTerms)].slice(0, 16),
    snippets: snippetsForTerms(pub || text, [...new Set(evidenceTerms)].slice(0, 12)),
    summary: t.summary || "",
    partnerSummary: t.partnerSummary || "",
    analysis: t.analysis || ""
  });
}

candidates.sort((a, b) => b.score - a.score);

const deduped = [];
const seen = new Set();

for (const c of candidates) {
  const k = c.id || c.slug;
  if (seen.has(k)) continue;
  seen.add(k);
  deduped.push(c);
}

const buckets = {
  wrongSideVerdicts: deduped.filter(c => c.categories.includes("likely wrong-side verdict")),
  starLowGrade: deduped.filter(c => c.categories.includes("star/superior outcome on low-graded side")),
  lowWinnerGrade: deduped.filter(c => c.categories.includes("winner/useful outcome grade too low") || c.flags.some(f => /very low grade|winner useful/i.test(f))),
  highValueNameProblems: deduped.filter(c => c.categories.some(cat => /high-value name/i.test(cat))),
  bodyGradeContradictions: deduped.filter(c => c.categories.includes("body grade contradiction")),
  verdictGradeMismatch: deduped.filter(c => c.categories.includes("verdict vs grades mismatch"))
};

const out = {
  generatedAt: new Date().toISOString(),
  sourceAudit: latestAudit,
  candidateCount: deduped.length,
  bucketCounts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  candidates: deduped
};

const jsonPath = path.join(REPORT_DIR, `outcome-grade-review-candidates-${RUN_ID}.json`);
const mdPath = path.join(REPORT_DIR, `outcome-grade-review-candidates-${RUN_ID}.md`);
const csvPath = path.join(REPORT_DIR, `outcome-grade-review-candidates-${RUN_ID}.csv`);

fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

function cell(v, n = 320) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

function table(rows, limit = 75) {
  return [
    "| Rank | Score | ID | Slug | Grades | Flags | Evidence |",
    "|---:|---:|---|---|---|---|---|",
    ...rows.slice(0, limit).map((c, i) => `| ${i + 1} | ${Math.round(c.score)} | ${cell(c.id)} | ${cell(c.slug)} | ${cell(JSON.stringify(c.grades), 220)} | ${cell(c.flags.join("; "), 360)} | ${cell(c.evidenceTerms.join(", "), 260)} |`)
  ].join("\n");
}

fs.writeFileSync(mdPath, [
  "# Outcome / Grade Review Candidates",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Source audit: ${latestAudit}`,
  `Deduped candidates: ${deduped.length}`,
  "",
  "## Bucket Counts",
  "",
  "| Bucket | Count |",
  "|---|---:|",
  ...Object.entries(out.bucketCounts).map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "## Top Overall Candidates",
  "",
  table(deduped, 100),
  "",
  "## Likely Wrong-Side Verdicts",
  "",
  table(buckets.wrongSideVerdicts, 75),
  "",
  "## Star / Superior Outcome on Low-Graded Side",
  "",
  table(buckets.starLowGrade, 75),
  "",
  "## Winner / Useful Outcome Grade Too Low",
  "",
  table(buckets.lowWinnerGrade, 75),
  "",
  "## High-Value Name Problems",
  "",
  table(buckets.highValueNameProblems, 75),
  "",
  "## Body Grade Contradictions",
  "",
  table(buckets.bodyGradeContradictions, 75)
].join("\n"));

const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
fs.writeFileSync(csvPath, [
  ["score","id","slug","grades","bestGrade","worstGrade","categories","flags","evidenceTerms","summary"].map(esc).join(","),
  ...deduped.map(c => [
    Math.round(c.score),
    c.id,
    c.slug,
    JSON.stringify(c.grades),
    c.bestGrade ? `${c.bestGrade.team} ${c.bestGrade.grade}` : "",
    c.worstGrade ? `${c.worstGrade.team} ${c.worstGrade.grade}` : "",
    c.categories.join("; "),
    c.flags.join("; "),
    c.evidenceTerms.join("; "),
    c.summary
  ].map(esc).join(","))
].join("\n"));

console.log(`\nOutcome / grade review candidates created.`);
console.log(`Source audit: ${latestAudit}`);
console.log(`Deduped candidates: ${deduped.length}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${csvPath}`);
console.log(`- ${mdPath}\n`);

console.log("Bucket counts:");
console.table(out.bucketCounts);

console.log("\nTop overall candidates:");
console.table(deduped.slice(0, 40).map((c, i) => ({
  rank: i + 1,
  score: Math.round(c.score),
  id: c.id,
  slug: c.slug,
  grades: JSON.stringify(c.grades),
  flags: c.flags.join("; ").slice(0, 110),
  evidence: c.evidenceTerms.join(", ").slice(0, 90)
})));

console.log("\nWinner/useful outcome grade-too-low candidates:");
console.table(buckets.lowWinnerGrade.slice(0, 30).map((c, i) => ({
  rank: i + 1,
  score: Math.round(c.score),
  id: c.id,
  slug: c.slug,
  grades: JSON.stringify(c.grades),
  flags: c.flags.join("; ").slice(0, 120),
  evidence: c.evidenceTerms.join(", ").slice(0, 90)
})));

console.log("\nStar/superior outcome on low-graded side candidates:");
console.table(buckets.starLowGrade.slice(0, 30).map((c, i) => ({
  rank: i + 1,
  score: Math.round(c.score),
  id: c.id,
  slug: c.slug,
  grades: JSON.stringify(c.grades),
  flags: c.flags.join("; ").slice(0, 120),
  evidence: c.evidenceTerms.join(", ").slice(0, 90)
})));
