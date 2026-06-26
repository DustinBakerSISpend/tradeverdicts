const fs = require("fs");
const path = require("path");

const IN = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const OUT = path.join(process.cwd(), "src", "data", "nfl", "strict-perspective-conflict-audit.json");

const trades = JSON.parse(fs.readFileSync(IN, "utf8")).filter(t => !t.suppressed && t.publishStatus !== "hold-conflict");

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function verdictKey(v, teams = []) {
  const x = norm(v);
  if (!x) return "";
  if (x.includes("even") || x.includes("draw") || x.includes("push")) return "even";

  for (const team of teams) {
    const slug = norm(team);
    const mascot = slug.split(" ").at(-1);
    const parts = slug.split(" ").filter(w => w.length > 3);

    if (x.includes(slug)) return team;
    if (mascot && mascot.length > 3 && x.includes(mascot)) return team;
    if (parts.some(w => x.includes(w)) && x.includes("win")) return team;
  }

  return x.replace(/\bwin(s)?\b/g, "").trim();
}

const buckets = {
  realPerspectiveVerdictConflict: [],
  topLevelVerdictNotInPerspectiveKeys: []
};

for (const t of trades) {
  const ps = Array.isArray(t.perspectives) ? t.perspectives : [];
  if (ps.length < 2) continue;

  const keys = [...new Set(ps.map(p => verdictKey(p.verdict, t.teams)).filter(Boolean))];

  if (keys.length > 1) {
    buckets.realPerspectiveVerdictConflict.push({
      id: t.id,
      slug: t.slug,
      tradeDate: t.tradeDate,
      teams: t.teams,
      topLevelVerdict: t.verdict,
      topLevelKey: verdictKey(t.verdict, t.teams),
      perspectiveKeys: keys,
      perspectives: ps.map(p => ({
        sourceTeam: p.sourceTeam,
        primaryTeam: p.primaryTeam,
        partnerTeam: p.partnerTeam,
        primaryGrade: p.primaryGrade,
        partnerGrade: p.partnerGrade,
        verdict: p.verdict,
        verdictKey: verdictKey(p.verdict, t.teams)
      })),
      reason: "Perspectives resolve to different actual winners"
    });
  }

  const topKey = verdictKey(t.verdict, t.teams);
  if (topKey && keys.length && !keys.includes(topKey)) {
    buckets.topLevelVerdictNotInPerspectiveKeys.push({
      id: t.id,
      slug: t.slug,
      tradeDate: t.tradeDate,
      teams: t.teams,
      topLevelVerdict: t.verdict,
      topLevelKey: topKey,
      perspectiveKeys: keys,
      reason: "Top-level verdict winner not found among normalized perspective winners"
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  totalTradesScanned: trades.length,
  counts: Object.fromEntries(Object.entries(buckets).map(([k,v]) => [k,v.length])),
  topIssues: [
    ...buckets.realPerspectiveVerdictConflict.slice(0, 50),
    ...buckets.topLevelVerdictNotInPerspectiveKeys.slice(0, 50)
  ],
  buckets
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`Wrote ${OUT}`);
console.log(`totalTradesScanned: ${report.totalTradesScanned}`);
console.table(report.counts);
console.table(report.topIssues.slice(0, 25).map(x => ({
  slug: x.slug,
  top: x.topLevelVerdict,
  topKey: x.topLevelKey,
  perspectiveKeys: x.perspectiveKeys.join(" | "),
  reason: x.reason
})));
