import fs from "node:fs";
import path from "node:path";

const REPORT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const latestSheet = fs.readdirSync(REPORT_DIR)
  .filter(f => /^manual-side-verification-sheet-.*\.json$/.test(f))
  .sort()
  .at(-1);

if (!latestSheet) {
  throw new Error("No manual-side-verification-sheet JSON found.");
}

const sheet = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latestSheet), "utf8"));
const rows = (sheet.rows || []).filter(r => String(r.recommendation || "").startsWith("POSSIBLE PATCH"));

const STAR_NAMES = [
  "Marshawn Lynch","Eric Dickerson","Brandin Cooks","Stefon Diggs","Jalen Ramsey",
  "Randy Moss","Laremy Tunsil","Champ Bailey","Khalil Mack","Julio Jones",
  "Chuba Hubbard","Steven Jackson","Brett Favre","Aaron Rodgers","Tristan Wirfs",
  "T.J. Watt","Patrick Mahomes","Walter Jones","Warren Sapp","Ryan Ramczyk",
  "Trey Hendrickson","DeForest Buckner"
];

const GRADE_POINTS = {
  "A+": 12, "A": 11, "A-": 10,
  "B+": 9, "B": 8, "B-": 7,
  "C+": 6, "C": 5, "C-": 4,
  "D+": 3, "D": 2, "D-": 1,
  "F": 0
};

function gv(g) {
  return GRADE_POINTS[String(g || "").toUpperCase()] ?? null;
}

function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function cell(v, n = 420) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

function assetText(row) {
  return (row.assetsFlat || []).join(" / ");
}

function evidenceText(row) {
  return (row.candidateEvidence || []).join(", ");
}

function gradeRows(grades) {
  return Object.entries(grades || {})
    .map(([team, grade]) => ({ team, grade, value: gv(grade) }))
    .filter(r => r.value !== null)
    .sort((a,b) => b.value - a.value);
}

function maxGrade(grades) {
  return gradeRows(grades)[0] || null;
}

function minGrade(grades) {
  return gradeRows(grades).at(-1) || null;
}

function teamAssetMap(row) {
  const map = {};
  for (const line of row.assetsFlat || []) {
    const idx = line.indexOf(":");
    if (idx > -1) {
      const team = line.slice(0, idx).trim();
      const assets = line.slice(idx + 1).trim();
      map[team] = assets;
    }
  }
  return map;
}

function starHits(text) {
  return STAR_NAMES.filter(name => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

function classify(row) {
  const assets = assetText(row);
  const evidence = evidenceText(row);
  const all = `${assets} ${evidence} ${row.summary || ""} ${row.partnerSummary || ""} ${row.analysis || ""}`;
  const stars = starHits(all);
  const best = maxGrade(row.grades);
  const worst = minGrade(row.grades);
  const teamAssets = teamAssetMap(row);

  const hasOnlyPickPackageSignal =
    !stars.length &&
    /\b\d{1,3}(?:st|nd|rd|th)? overall\b/i.test(all) &&
    !/\bAll-Pro|Pro Bowl|Hall of Fame|starter|rushed for|yards|touchdowns|sacks|career\b/i.test(all);

  const lowStarTeams = [];

  for (const [team, assetsForTeam] of Object.entries(teamAssets)) {
    const g = row.grades?.[team];
    const val = gv(g);
    const hits = starHits(assetsForTeam);

    if (hits.length && val !== null && val <= gv("C+")) {
      lowStarTeams.push({ team, grade: g, hits });
    }
  }

  if (/unknown-team|unknown-undisclosed|packers-involving/i.test(`${row.slug} ${JSON.stringify(row.grades)} ${assets}`)) {
    return {
      lane: "structure first",
      confidence: "do-not-patch-yet",
      reason: "Malformed or unknown team key/slug; fix structure before grading.",
      suggestedReview: "Audit team key and slug normalization."
    };
  }

  if (Number(row.year || 0) >= 2025) {
    return {
      lane: "hold",
      confidence: "do-not-patch-yet",
      reason: "Current/future outcome; grade should not move from projection.",
      suggestedReview: "Revisit after outcome data matures."
    };
  }

  if (lowStarTeams.length && (!best || best.value <= gv("C+"))) {
    return {
      lane: "strong grade-patch candidate",
      confidence: "medium-high",
      reason: `${lowStarTeams.map(x => `${x.team} ${x.grade} has ${x.hits.join("/")}`).join("; ")} and no side has a strong grade.`,
      suggestedReview: "Likely raise star/outcome side after one-record human check."
    };
  }

  if (lowStarTeams.length) {
    return {
      lane: "side-verification grade candidate",
      confidence: "medium",
      reason: `${lowStarTeams.map(x => `${x.team} ${x.grade} has ${x.hits.join("/")}`).join("; ")} but another side may already have a strong grade.`,
      suggestedReview: "Verify whether current grade logic intentionally favored the other side."
    };
  }

  if (hasOnlyPickPackageSignal) {
    return {
      lane: "pick-package source needed",
      confidence: "low",
      reason: "Signal comes mainly from pick position, not proven player outcome.",
      suggestedReview: "Do not raise grade unless body copy/player outcomes support it."
    };
  }

  if (worst && worst.value <= gv("D+") && /\bAll-Pro|Pro Bowl|Hall of Fame|starter|career|yards|touchdowns|sacks\b/i.test(all)) {
    return {
      lane: "possible low-side outcome patch",
      confidence: "medium",
      reason: `${worst.team} is graded ${worst.grade}, but record contains outcome language.`,
      suggestedReview: "Inspect full page copy; could be grade contradiction or legitimate losing grade."
    };
  }

  if (best && best.value <= gv("C+")) {
    return {
      lane: "no strong grade despite outcome signal",
      confidence: "medium-low",
      reason: "No side has B- or better despite notable evidence terms.",
      suggestedReview: "Manual grade calibration, not automatic patch."
    };
  }

  return {
    lane: "manual review",
    confidence: "low",
    reason: "Mixed signals.",
    suggestedReview: "Read record before changing grades."
  };
}

const cards = rows.map(row => {
  const cls = classify(row);
  return {
    rank: row.rank,
    id: row.id,
    slug: row.slug,
    year: row.year,
    grades: row.grades,
    lane: cls.lane,
    confidence: cls.confidence,
    reason: cls.reason,
    suggestedReview: cls.suggestedReview,
    evidence: row.candidateEvidence || [],
    assets: row.assetsFlat || [],
    summary: row.summary || "",
    partnerSummary: row.partnerSummary || "",
    analysis: row.analysis || "",
    recommendationFromPriorSheet: row.recommendation
  };
});

const buckets = {};
for (const card of cards) {
  buckets[card.lane] ||= [];
  buckets[card.lane].push(card);
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceSheet: latestSheet,
  possiblePatchCount: cards.length,
  bucketCounts: Object.fromEntries(Object.entries(buckets).map(([k,v]) => [k, v.length])),
  cards,
  buckets
};

const jsonPath = path.join(REPORT_DIR, `possible-grade-patch-review-cards-${RUN_ID}.json`);
const mdPath = path.join(REPORT_DIR, `possible-grade-patch-review-cards-${RUN_ID}.md`);
const csvPath = path.join(REPORT_DIR, `possible-grade-patch-review-cards-${RUN_ID}.csv`);

fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

function table(list, limit = 100) {
  return [
    "| Rank | ID | Year | Grades | Lane | Confidence | Reason | Assets | Summary |",
    "|---:|---|---:|---|---|---|---|---|---|",
    ...list.slice(0, limit).map(c =>
      `| ${c.rank} | ${cell(c.id)} | ${cell(c.year || "")} | ${cell(JSON.stringify(c.grades), 170)} | ${cell(c.lane)} | ${cell(c.confidence)} | ${cell(c.reason, 360)} | ${cell((c.assets || []).join(" / "), 460)} | ${cell(c.summary || c.analysis || c.partnerSummary, 460)} |`
    )
  ].join("\n");
}

fs.writeFileSync(mdPath, [
  "# Possible Grade Patch Review Cards",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Source sheet: ${latestSheet}`,
  `Possible patch rows: ${cards.length}`,
  "",
  "## Bucket Counts",
  "",
  "| Lane | Count |",
  "|---|---:|",
  ...Object.entries(out.bucketCounts).map(([k,v]) => `| ${k} | ${v} |`),
  "",
  "## Strong Grade-Patch Candidates",
  "",
  table(buckets["strong grade-patch candidate"] || []),
  "",
  "## Side-Verification Grade Candidates",
  "",
  table(buckets["side-verification grade candidate"] || []),
  "",
  "## Possible Low-Side Outcome Patch",
  "",
  table(buckets["possible low-side outcome patch"] || []),
  "",
  "## No Strong Grade Despite Outcome Signal",
  "",
  table(buckets["no strong grade despite outcome signal"] || []),
  "",
  "## Pick-Package Source Needed",
  "",
  table(buckets["pick-package source needed"] || []),
  "",
  "## Manual Review",
  "",
  table(buckets["manual review"] || [])
].join("\n"));

const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
fs.writeFileSync(csvPath, [
  ["rank","id","slug","year","grades","lane","confidence","reason","suggestedReview","evidence","assets","summary","partnerSummary","analysis"].map(esc).join(","),
  ...cards.map(c => [
    c.rank,
    c.id,
    c.slug,
    c.year || "",
    JSON.stringify(c.grades),
    c.lane,
    c.confidence,
    c.reason,
    c.suggestedReview,
    (c.evidence || []).join("; "),
    (c.assets || []).join(" / "),
    c.summary,
    c.partnerSummary,
    c.analysis
  ].map(esc).join(","))
].join("\n"));

console.log(`\nPossible grade patch review cards created.`);
console.log(`Source sheet: ${latestSheet}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${csvPath}`);
console.log(`- ${mdPath}\n`);

console.log("Bucket counts:");
console.table(out.bucketCounts);

for (const lane of [
  "strong grade-patch candidate",
  "side-verification grade candidate",
  "possible low-side outcome patch",
  "no strong grade despite outcome signal",
  "pick-package source needed",
  "manual review"
]) {
  const list = buckets[lane] || [];
  if (!list.length) continue;

  console.log(`\n${lane}:`);
  console.table(list.slice(0, 20).map(c => ({
    rank: c.rank,
    id: c.id,
    year: c.year,
    grades: JSON.stringify(c.grades),
    confidence: c.confidence,
    reason: c.reason.slice(0, 100),
    assets: (c.assets || []).join(" / ").slice(0, 130)
  })));
}
