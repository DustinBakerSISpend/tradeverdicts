const fs = require("fs");
const path = require("path");

const IN = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const OUT = path.join(process.cwd(), "src", "data", "nfl", "perspective-conflict-audit.json");

const trades = JSON.parse(fs.readFileSync(IN, "utf8")).filter(t => !t.suppressed && t.publishStatus !== "hold-conflict");

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function gradeValue(g) {
  return {
    "A+": 12, "A": 11, "A-": 10,
    "B+": 9, "B": 8, "B-": 7,
    "C+": 6, "C": 5, "C-": 4,
    "D+": 3, "D": 2, "D-": 1,
    "F": 0
  }[String(g || "").trim()];
}

function verdictWinner(v) {
  const x = norm(v);
  if (!x || x.includes("even") || x.includes("draw") || x.includes("push")) return "even";
  return x.replace(/\bwin(s)?\b/g, "").trim();
}

const buckets = {
  conflictingPerspectiveVerdicts: [],
  perspectiveGradeContradiction: [],
  topLevelVerdictContradictsGrades: [],
  topLevelVerdictDiffersFromPerspectives: []
};

for (const t of trades) {
  const ps = Array.isArray(t.perspectives) ? t.perspectives : [];
  if (ps.length < 2) continue;

  const perspectiveVerdicts = [...new Set(ps.map(p => String(p.verdict || "").trim()).filter(Boolean))];

  if (perspectiveVerdicts.length > 1) {
    buckets.conflictingPerspectiveVerdicts.push({
      id: t.id,
      slug: t.slug,
      tradeDate: t.tradeDate,
      teams: t.teams,
      topLevelVerdict: t.verdict,
      topLevelGrades: t.grades,
      perspectiveVerdicts,
      perspectives: ps.map(p => ({
        sourceTeam: p.sourceTeam,
        primaryTeam: p.primaryTeam,
        partnerTeam: p.partnerTeam,
        primaryGrade: p.primaryGrade,
        partnerGrade: p.partnerGrade,
        verdict: p.verdict
      })),
      reason: "Perspectives disagree on verdict"
    });
  }

  for (const p of ps) {
    const pg = gradeValue(p.primaryGrade);
    const og = gradeValue(p.partnerGrade);
    if (pg === undefined || og === undefined) continue;

    const vw = verdictWinner(p.verdict);
    if (vw === "even" && Math.abs(pg - og) >= 4) {
      buckets.perspectiveGradeContradiction.push({
        id: t.id,
        slug: t.slug,
        sourceTeam: p.sourceTeam,
        verdict: p.verdict,
        primaryTeam: p.primaryTeam,
        partnerTeam: p.partnerTeam,
        primaryGrade: p.primaryGrade,
        partnerGrade: p.partnerGrade,
        reason: "Perspective says Even Trade but grades have large gap"
      });
    }

    if (vw !== "even") {
      const primaryName = norm(p.primaryTeam || "");
      const partnerName = norm(p.partnerTeam || "");

      const verdictNamesPrimary = primaryName.split(" ").some(w => w.length > 4 && vw.includes(w));
      const verdictNamesPartner = partnerName.split(" ").some(w => w.length > 4 && vw.includes(w));

      if (verdictNamesPrimary && pg < og) {
        buckets.perspectiveGradeContradiction.push({
          id: t.id,
          slug: t.slug,
          sourceTeam: p.sourceTeam,
          verdict: p.verdict,
          primaryTeam: p.primaryTeam,
          partnerTeam: p.partnerTeam,
          primaryGrade: p.primaryGrade,
          partnerGrade: p.partnerGrade,
          reason: "Perspective verdict favors primary team but primary grade is lower"
        });
      }

      if (verdictNamesPartner && og < pg) {
        buckets.perspectiveGradeContradiction.push({
          id: t.id,
          slug: t.slug,
          sourceTeam: p.sourceTeam,
          verdict: p.verdict,
          primaryTeam: p.primaryTeam,
          partnerTeam: p.partnerTeam,
          primaryGrade: p.primaryGrade,
          partnerGrade: p.partnerGrade,
          reason: "Perspective verdict favors partner team but partner grade is lower"
        });
      }
    }
  }

  const topVerdict = String(t.verdict || "").trim();
  if (topVerdict && perspectiveVerdicts.length && !perspectiveVerdicts.includes(topVerdict)) {
    buckets.topLevelVerdictDiffersFromPerspectives.push({
      id: t.id,
      slug: t.slug,
      tradeDate: t.tradeDate,
      topLevelVerdict: topVerdict,
      perspectiveVerdicts,
      reason: "Top-level verdict is not present in perspectives"
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  totalTradesScanned: trades.length,
  counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  topIssues: [
    ...buckets.conflictingPerspectiveVerdicts.slice(0, 25),
    ...buckets.perspectiveGradeContradiction.slice(0, 25),
    ...buckets.topLevelVerdictDiffersFromPerspectives.slice(0, 25)
  ],
  buckets
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`Wrote ${OUT}`);
console.log(`totalTradesScanned: ${report.totalTradesScanned}`);
console.table(report.counts);
console.table(report.topIssues.slice(0, 20).map(x => ({
  slug: x.slug,
  topLevelVerdict: x.topLevelVerdict,
  perspectiveVerdicts: Array.isArray(x.perspectiveVerdicts) ? x.perspectiveVerdicts.join(" | ") : x.verdict,
  reason: x.reason
})));
