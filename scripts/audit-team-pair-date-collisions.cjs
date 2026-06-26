const fs = require("fs");

const trades = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"))
  .filter(t => !t.suppressed && t.publishStatus !== "hold-conflict");

function assetText(t) {
  const parts = [];
  for (const assets of Object.values(t.assetsReceived || {})) {
    if (!Array.isArray(assets)) continue;
    for (const a of assets) parts.push(`${a.type}:${a.asset}`);
  }
  return parts.join(" | ");
}

function teamKey(teams) {
  return [...new Set(teams || [])].sort().join("|");
}

const groups = new Map();

for (const t of trades) {
  const teams = t.teams || [];
  if (teams.length !== 2) continue;

  const key = `${t.tradeDate}|||${teamKey(teams)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(t);
}

const rows = [];

for (const [key, group] of groups.entries()) {
  if (group.length < 2) continue;

  rows.push({
    tradeDate: group[0].tradeDate,
    teams: group[0].teams,
    count: group.length,
    slugs: group.map(t => t.slug),
    records: group.map(t => ({
      id: t.id,
      slug: t.slug,
      verdict: t.verdict,
      grades: t.grades,
      assets: assetText(t),
      summary: t.summary
    }))
  });
}

rows.sort((a,b) => b.count - a.count || a.tradeDate.localeCompare(b.tradeDate));

const report = {
  generatedAt: new Date().toISOString(),
  totalGroups: rows.length,
  rows
};

fs.writeFileSync("src/data/nfl/team-pair-date-collision-audit.json", JSON.stringify(report, null, 2));

console.log("Wrote src/data/nfl/team-pair-date-collision-audit.json");
console.log("teamPairDateCollisionGroups:", rows.length);
console.table(rows.slice(0, 30).map(r => ({
  date: r.tradeDate,
  teams: r.teams.join(" / "),
  count: r.count,
  slugs: r.slugs.join(" || ")
})));
