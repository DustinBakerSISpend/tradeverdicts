const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const summaryPath = path.join(process.cwd(), "audits", "same-date-team-duplicate-plan-summary-v2.json");
const outPath = path.join(process.cwd(), "audits", "inspect-final-4-same-date-team-blocked.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

function slugFromLine(line) {
  return String(line || "").split("|")[0].trim();
}

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
    grades: t.grades || null,
    assetsReceived: t.assetsReceived || null,
    summary: t.summary || null,
    qaNotes: t.qaNotes || null
  };
}

const rows = [];

for (const b of summary.blocked || []) {
  const keeperSlug = slugFromLine(b.keeper);
  const suppressSlug = slugFromLine(b.suppress);

  rows.push({
    flags: b.flags || [],
    keeperPicks: b.keeperPicks || [],
    suppressPicks: b.suppressPicks || [],
    keeper: compact(find(keeperSlug)),
    suppress: compact(find(suppressSlug))
  });
}

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  blockedCount: rows.length,
  rows
}, null, 2));

console.log("");
console.log("INSPECT FINAL 4 SAME-DATE/TEAM BLOCKED");
console.log("=".repeat(80));
console.log(`blocked rows: ${rows.length}`);
console.log(`Report: ${outPath}`);

for (const r of rows) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`FLAGS: ${r.flags.join(" | ")}`);
  console.log(`keeperPicks=${JSON.stringify(r.keeperPicks)}`);
  console.log(`suppressPicks=${JSON.stringify(r.suppressPicks)}`);

  console.log("");
  console.log("KEEPER:");
  console.log(`${r.keeper?.slug} | ${r.keeper?.id} | ${r.keeper?.tradeDate} | status=${r.keeper?.publishStatus} | suppressed=${r.keeper?.suppressed}`);
  console.log(`teams=${JSON.stringify(r.keeper?.teams)}`);
  console.log("assetsReceived:");
  console.dir(r.keeper?.assetsReceived, { depth: null });
  console.log("summary:");
  console.log(r.keeper?.summary || "(none)");
  console.log("qaNotes:");
  console.log(r.keeper?.qaNotes || "(none)");

  console.log("");
  console.log("SUPPRESS CANDIDATE:");
  console.log(`${r.suppress?.slug} | ${r.suppress?.id} | ${r.suppress?.tradeDate} | status=${r.suppress?.publishStatus} | suppressed=${r.suppress?.suppressed}`);
  console.log(`teams=${JSON.stringify(r.suppress?.teams)}`);
  console.log("assetsReceived:");
  console.dir(r.suppress?.assetsReceived, { depth: null });
  console.log("summary:");
  console.log(r.suppress?.summary || "(none)");
  console.log("qaNotes:");
  console.log(r.suppress?.qaNotes || "(none)");
}
