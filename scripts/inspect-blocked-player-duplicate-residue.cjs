const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const blockPath = path.join(process.cwd(), "audits", "suppress-final-safe-player-duplicate-pages-dry-run.json");
const outPath = path.join(process.cwd(), "audits", "inspect-blocked-player-duplicate-residue.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const blockReport = JSON.parse(fs.readFileSync(blockPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function compact(t) {
  if (!t) return null;
  return {
    id: t.id || null,
    slug: slugOf(t),
    tradeDate: t.tradeDate || t.date || null,
    teams: t.teams || null,
    publishStatus: t.publishStatus || null,
    suppressed: t.suppressed ?? null,
    verdict: t.verdict || null,
    confidence: t.confidence || null,
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null
  };
}

const rows = [];

for (const b of blockReport.blocked || []) {
  const keeper = find(b.keeper?.slug);
  const suppress = find(b.suppress?.slug);

  rows.push({
    blockedReasons: b.blockedReasons || [],
    playerOverlap: b.playerOverlap || [],
    teamSet: b.teamSet || [],
    keeper: compact(keeper),
    suppress: compact(suppress)
  });
}

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  blockedCount: rows.length,
  rows
}, null, 2));

console.log("");
console.log("INSPECT BLOCKED PLAYER-DUPLICATE RESIDUE");
console.log("=".repeat(80));
console.log(`blocked rows: ${rows.length}`);
console.log(`Report: ${outPath}`);

for (const row of rows) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`BLOCKED: ${row.blockedReasons.join("; ")}`);
  console.log(`players=${JSON.stringify(row.playerOverlap)}`);
  console.log(`teamSet=${JSON.stringify(row.teamSet)}`);

  console.log("");
  console.log("KEEPER:");
  console.log(`${row.keeper?.slug} | ${row.keeper?.id} | ${row.keeper?.tradeDate} | status=${row.keeper?.publishStatus} | suppressed=${row.keeper?.suppressed}`);
  console.log(`teams=${JSON.stringify(row.keeper?.teams)}`);
  console.log("assetsReceived:");
  console.dir(row.keeper?.assetsReceived, { depth: null });
  console.log("summary:");
  console.log(row.keeper?.summary || "(none)");
  console.log("qaNotes:");
  console.log(row.keeper?.qaNotes || "(none)");

  console.log("");
  console.log("SUPPRESS CANDIDATE:");
  console.log(`${row.suppress?.slug} | ${row.suppress?.id} | ${row.suppress?.tradeDate} | status=${row.suppress?.publishStatus} | suppressed=${row.suppress?.suppressed}`);
  console.log(`teams=${JSON.stringify(row.suppress?.teams)}`);
  console.log("assetsReceived:");
  console.dir(row.suppress?.assetsReceived, { depth: null });
  console.log("summary:");
  console.log(row.suppress?.summary || "(none)");
  console.log("qaNotes:");
  console.log(row.suppress?.qaNotes || "(none)");
}
