import fs from "node:fs";
import path from "node:path";

const REPORT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const latestCandidates = fs.readdirSync(REPORT_DIR)
  .filter(f => /^outcome-grade-review-candidates-.*\.json$/.test(f))
  .sort()
  .at(-1);

if (!latestCandidates) {
  throw new Error("No outcome-grade-review-candidates JSON found.");
}

const board = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latestCandidates), "utf8"));
const candidates = board.candidates || [];

const GRADE_POINTS = {
  "A+": 12, "A": 11, "A-": 10,
  "B+": 9, "B": 8, "B-": 7,
  "C+": 6, "C": 5, "C-": 4,
  "D+": 3, "D": 2, "D-": 1,
  "F": 0
};

const HIGH_CONFIDENCE_NAMES = [
  "Micah Parsons",
  "Herschel Walker",
  "Eric Dickerson",
  "Steven Jackson",
  "Randy Moss",
  "Aaron Rodgers",
  "Brett Favre",
  "Marshall Faulk",
  "Champ Bailey",
  "Jalen Ramsey",
  "Khalil Mack",
  "Tyreek Hill",
  "A.J. Brown",
  "Laremy Tunsil",
  "Trent Williams",
  "Russell Wilson",
  "Matthew Stafford",
  "Tony Gonzalez",
  "Jared Allen",
  "Marshawn Lynch",
  "Brandin Cooks",
  "Stefon Diggs",
  "Chuba Hubbard"
];

function gv(g) {
  const x = String(g || "").trim().toUpperCase();
  return Object.hasOwn(GRADE_POINTS, x) ? GRADE_POINTS[x] : null;
}

function bestGrade(grades) {
  const rows = Object.entries(grades || {})
    .map(([team, grade]) => ({ team, grade, value: gv(grade) }))
    .filter(r => r.value != null)
    .sort((a, b) => b.value - a.value);
  return rows[0] || null;
}

function worstGrade(grades) {
  const rows = Object.entries(grades || {})
    .map(([team, grade]) => ({ team, grade, value: gv(grade) }))
    .filter(r => r.value != null)
    .sort((a, b) => a.value - b.value);
  return rows[0] || null;
}

function hasAny(c, terms) {
  const hay = [
    c.id, c.slug, c.title, c.summary, c.partnerSummary, c.analysis,
    ...(c.evidenceTerms || []),
    ...(c.flags || []),
    ...(c.reasons || []),
    ...(c.snippets || [])
  ].join(" ").toLowerCase();

  return terms.some(t => hay.includes(t.toLowerCase()));
}

function classify(c) {
  const b = bestGrade(c.grades);
  const w = worstGrade(c.grades);
  const flags = c.flags || [];
  const cats = c.categories || [];
  const evidence = c.evidenceTerms || [];
  const assetSides = c.assetSides || [];
  const reasons = [];

  const bestIsStrong = b && b.value >= gv("A-");
  const worstIsBad = w && w.value <= gv("D+");
  const hasStar = hasAny(c, HIGH_CONFIDENCE_NAMES);
  const hasWrongSide = cats.includes("likely wrong-side verdict") || flags.some(f => /wrong-side/i.test(f));
  const hasLowGradeOutcome = cats.includes("star/superior outcome on low-graded side") || flags.some(f => /low grade|very low grade|below grade/i.test(f));
  const hasBodyContradiction = cats.includes("body grade contradiction");
  const hasVerdictGradeMismatch = cats.includes("verdict vs grades mismatch");

  const lowAssetSide = assetSides.find(s => {
    const val = gv(s.grade);
    return s.assetScore >= 50 && val != null && val <= gv("C+");
  });

  const highAssetSideAlreadyBest = assetSides.find(s => {
    const val = gv(s.grade);
    return s.assetScore >= 50 && b && s.team === b.team && val != null && val >= gv("A-");
  });

  // False positive: the star/high-value side already has A-/A/A+ and the bad side has D/C.
  if (hasStar && bestIsStrong && highAssetSideAlreadyBest && !hasBodyContradiction) {
    reasons.push("High-value asset appears to already be on the highest-graded side.");
    return { lane: "likely false positive / detector issue", reasons };
  }

  // Public-copy issue: grades look directionally right, but body/verdict wording conflicts.
  if (bestIsStrong && worstIsBad && (hasWrongSide || hasVerdictGradeMismatch || hasBodyContradiction)) {
    reasons.push("Grades look directionally plausible, but copy/verdict detector sees a conflict.");
    return { lane: "likely copy/verdict wording patch", reasons };
  }

  // Data-grade patch: useful/star asset side is actually low graded.
  if (lowAssetSide && hasLowGradeOutcome) {
    reasons.push(`${lowAssetSide.team} has asset score ${lowAssetSide.assetScore} but grade ${lowAssetSide.grade}.`);
    if (hasStar) reasons.push("High-value name appears in record.");
    return { lane: "likely data-grade patch", reasons };
  }

  // Low winner grade style, including Chuba-type.
  if (flags.some(f => /winner useful outcome|very low grade/i.test(f)) || cats.includes("winner/useful outcome grade too low")) {
    reasons.push("Winner/useful outcome grade-too-low signal.");
    return { lane: "likely data-grade patch", reasons };
  }

  // Body copy contradictions should usually be copy patches first.
  if (hasBodyContradiction || hasVerdictGradeMismatch) {
    reasons.push("Grade/copy mismatch needs copy inspection before grade changes.");
    return { lane: "likely copy/verdict wording patch", reasons };
  }

  reasons.push("Signals are mixed; needs manual context.");
  return { lane: "needs manual source/context", reasons };
}

const rows = candidates.map(c => {
  const cls = classify(c);
  return {
    ...c,
    triageLane: cls.lane,
    triageReasons: cls.reasons,
    bestGrade: bestGrade(c.grades),
    worstGrade: worstGrade(c.grades)
  };
});

const buckets = {
  "likely data-grade patch": rows.filter(r => r.triageLane === "likely data-grade patch"),
  "likely copy/verdict wording patch": rows.filter(r => r.triageLane === "likely copy/verdict wording patch"),
  "likely false positive / detector issue": rows.filter(r => r.triageLane === "likely false positive / detector issue"),
  "needs manual source/context": rows.filter(r => r.triageLane === "needs manual source/context")
};

for (const key of Object.keys(buckets)) {
  buckets[key].sort((a, b) => b.score - a.score);
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceCandidateBoard: latestCandidates,
  totalCandidates: rows.length,
  bucketCounts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  buckets,
  rows
};

const jsonPath = path.join(REPORT_DIR, `outcome-grade-patchability-triage-${RUN_ID}.json`);
const mdPath = path.join(REPORT_DIR, `outcome-grade-patchability-triage-${RUN_ID}.md`);
const csvPath = path.join(REPORT_DIR, `outcome-grade-patchability-triage-${RUN_ID}.csv`);

fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

function cell(v, n = 320) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

function table(list, limit = 50) {
  return [
    "| Rank | Score | ID | Slug | Grades | Triage Reasons | Evidence |",
    "|---:|---:|---|---|---|---|---|",
    ...list.slice(0, limit).map((r, i) => `| ${i + 1} | ${Math.round(r.score)} | ${cell(r.id)} | ${cell(r.slug)} | ${cell(JSON.stringify(r.grades), 180)} | ${cell(r.triageReasons.join("; "), 320)} | ${cell((r.evidenceTerms || []).join(", "), 260)} |`)
  ].join("\n");
}

fs.writeFileSync(mdPath, [
  "# Outcome / Grade Patchability Triage",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Source candidate board: ${latestCandidates}`,
  `Total candidates: ${rows.length}`,
  "",
  "## Bucket Counts",
  "",
  "| Lane | Count |",
  "|---|---:|",
  ...Object.entries(out.bucketCounts).map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "## Likely Data-Grade Patch",
  "",
  table(buckets["likely data-grade patch"], 100),
  "",
  "## Likely Copy / Verdict Wording Patch",
  "",
  table(buckets["likely copy/verdict wording patch"], 100),
  "",
  "## Likely False Positive / Detector Issue",
  "",
  table(buckets["likely false positive / detector issue"], 75),
  "",
  "## Needs Manual Source / Context",
  "",
  table(buckets["needs manual source/context"], 75)
].join("\n"));

const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
fs.writeFileSync(csvPath, [
  ["triageLane","score","id","slug","grades","bestGrade","worstGrade","triageReasons","flags","categories","evidenceTerms"].map(esc).join(","),
  ...rows.map(r => [
    r.triageLane,
    Math.round(r.score),
    r.id,
    r.slug,
    JSON.stringify(r.grades),
    r.bestGrade ? `${r.bestGrade.team} ${r.bestGrade.grade}` : "",
    r.worstGrade ? `${r.worstGrade.team} ${r.worstGrade.grade}` : "",
    r.triageReasons.join("; "),
    (r.flags || []).join("; "),
    (r.categories || []).join("; "),
    (r.evidenceTerms || []).join("; ")
  ].map(esc).join(","))
].join("\n"));

console.log(`\nOutcome / grade patchability triage created.`);
console.log(`Source board: ${latestCandidates}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${csvPath}`);
console.log(`- ${mdPath}\n`);

console.log("Bucket counts:");
console.table(out.bucketCounts);

console.log("\nLikely data-grade patches:");
console.table(buckets["likely data-grade patch"].slice(0, 35).map((r, i) => ({
  rank: i + 1,
  score: Math.round(r.score),
  id: r.id,
  slug: r.slug,
  grades: JSON.stringify(r.grades),
  reasons: r.triageReasons.join("; ").slice(0, 110),
  evidence: (r.evidenceTerms || []).join(", ").slice(0, 90)
})));

console.log("\nLikely copy/verdict wording patches:");
console.table(buckets["likely copy/verdict wording patch"].slice(0, 25).map((r, i) => ({
  rank: i + 1,
  score: Math.round(r.score),
  id: r.id,
  slug: r.slug,
  grades: JSON.stringify(r.grades),
  reasons: r.triageReasons.join("; ").slice(0, 110),
  evidence: (r.evidenceTerms || []).join(", ").slice(0, 90)
})));

console.log("\nLikely false positives / detector issues:");
console.table(buckets["likely false positive / detector issue"].slice(0, 25).map((r, i) => ({
  rank: i + 1,
  score: Math.round(r.score),
  id: r.id,
  slug: r.slug,
  grades: JSON.stringify(r.grades),
  reasons: r.triageReasons.join("; ").slice(0, 110),
  evidence: (r.evidenceTerms || []).join(", ").slice(0, 90)
})));
