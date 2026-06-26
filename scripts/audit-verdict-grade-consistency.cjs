const fs = require("fs");
const path = require("path");

const IN = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const OUT = path.join(process.cwd(), "src", "data", "nfl", "verdict-grade-consistency-audit.json");

const trades = JSON.parse(fs.readFileSync(IN, "utf8")).filter(t => !t.suppressed && t.publishStatus !== "hold-conflict");

const gradeValue = {
  "A+": 12, "A": 11, "A-": 10,
  "B+": 9, "B": 8, "B-": 7,
  "C+": 6, "C": 5, "C-": 4,
  "D+": 3, "D": 2, "D-": 1,
  "F": 0
};

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getGrades(t) {
  const out = {};

  for (const key of ["grades", "teamGrades", "gradeByTeam"]) {
    if (t[key] && typeof t[key] === "object") {
      for (const [team, grade] of Object.entries(t[key])) {
        if (gradeValue[String(grade).trim()] !== undefined) out[team] = String(grade).trim();
      }
    }
  }

  if (Array.isArray(t.perspectives)) {
    for (const p of t.perspectives) {
      const team = p.team || p.teamKey || p.slug;
      const grade = p.grade || p.tradeGrade;
      if (team && gradeValue[String(grade).trim()] !== undefined) out[team] = String(grade).trim();
    }
  }

  return out;
}

function getWinnerTeam(t) {
  const verdict = norm(t.verdict || t.winner || "");

  if (!verdict || verdict.includes("even") || verdict.includes("draw") || verdict.includes("push")) return null;

  for (const team of t.teams || []) {
    const compactTeam = norm(team).replace(/\b(st|louis|los|angeles|new|york|bay|city)\b/g, "").trim();
    const words = norm(team).split(" ");
    if (verdict.includes(norm(team))) return team;
    if (words.some(w => w.length > 4 && verdict.includes(w))) return team;
    if (compactTeam && compactTeam.length > 4 && verdict.includes(compactTeam)) return team;
  }

  return null;
}

function isEven(t) {
  const v = norm(t.verdict || "");
  return v.includes("even") || v.includes("draw") || v.includes("push");
}

const buckets = {
  winnerGradeLowerThanLoser: [],
  winnerGradeEqualToLoser: [],
  evenTradeHugeGradeGap: [],
  verdictWinnerMissingFromTeams: [],
  missingGrades: [],
  needsReview: []
};

for (const t of trades) {
  const grades = getGrades(t);
  const gradeEntries = Object.entries(grades).filter(([team, grade]) => gradeValue[grade] !== undefined);
  if (gradeEntries.length < 2) {
    buckets.missingGrades.push({ id: t.id, slug: t.slug, verdict: t.verdict, teams: t.teams, grades });
    continue;
  }

  const values = gradeEntries.map(([team, grade]) => ({ team, grade, value: gradeValue[grade] }));
  const sorted = [...values].sort((a, b) => b.value - a.value);
  const gap = sorted[0].value - sorted[sorted.length - 1].value;

  if (isEven(t)) {
    if (gap >= 4) {
      buckets.evenTradeHugeGradeGap.push({
        id: t.id,
        slug: t.slug,
        verdict: t.verdict,
        teams: t.teams,
        grades,
        gap,
        reason: "Even Trade verdict with large grade gap"
      });
    }
    continue;
  }

  const winner = getWinnerTeam(t);

  if (!winner) {
    buckets.verdictWinnerMissingFromTeams.push({
      id: t.id,
      slug: t.slug,
      verdict: t.verdict,
      teams: t.teams,
      grades,
      reason: "Could not map verdict winner to a team"
    });
    continue;
  }

  const winnerGrade = grades[winner];
  if (!winnerGrade) {
    buckets.needsReview.push({
      id: t.id,
      slug: t.slug,
      verdict: t.verdict,
      winner,
      teams: t.teams,
      grades,
      reason: "Winner mapped, but no grade found for winner"
    });
    continue;
  }

  const winnerValue = gradeValue[winnerGrade];
  const bestOther = values.filter(x => x.team !== winner).sort((a, b) => b.value - a.value)[0];

  if (!bestOther) continue;

  if (winnerValue < bestOther.value) {
    buckets.winnerGradeLowerThanLoser.push({
      id: t.id,
      slug: t.slug,
      verdict: t.verdict,
      winner,
      winnerGrade,
      bestOtherTeam: bestOther.team,
      bestOtherGrade: bestOther.grade,
      grades,
      reason: "Verdict winner has lower grade than another team"
    });
  } else if (winnerValue === bestOther.value) {
    buckets.winnerGradeEqualToLoser.push({
      id: t.id,
      slug: t.slug,
      verdict: t.verdict,
      winner,
      winnerGrade,
      bestOtherTeam: bestOther.team,
      bestOtherGrade: bestOther.grade,
      grades,
      reason: "Verdict winner has equal grade to another team"
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  totalTradesScanned: trades.length,
  counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  topIssues: [
    ...buckets.winnerGradeLowerThanLoser.slice(0, 25),
    ...buckets.evenTradeHugeGradeGap.slice(0, 25),
    ...buckets.winnerGradeEqualToLoser.slice(0, 25)
  ],
  buckets
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`Wrote ${OUT}`);
console.log(`totalTradesScanned: ${report.totalTradesScanned}`);
console.table(report.counts);
console.log("Top issues:");
console.table(report.topIssues.slice(0, 25).map(x => ({
  bucket: x.reason,
  slug: x.slug,
  verdict: x.verdict,
  winner: x.winner,
  winnerGrade: x.winnerGrade,
  other: x.bestOtherTeam,
  otherGrade: x.bestOtherGrade,
  gap: x.gap
})));
