const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const classPath = path.join(process.cwd(), "audits", "active-suspicious-next-action-classification.json");
const outPath = path.join(process.cwd(), "audits", "inspect-modern-active-suspicious.json");

const trades = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const classified = JSON.parse(fs.readFileSync(classPath, "utf8"));

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const rows = classified.rows || classified.classified || [];

const targets = rows
  .filter(r => {
    const y = Number(String(r.tradeDate || "").slice(0, 4));
    return y >= 1990 || r.bucket === "B1 modern multi-team aggregate";
  })
  .map(r => {
    const t = find(r.slug);
    return {
      bucket: r.bucket,
      id: t?.id || null,
      slug: r.slug,
      tradeDate: dateOf(t) || r.tradeDate || null,
      publishStatus: t?.publishStatus || null,
      suppressed: t?.suppressed ?? null,
      teams: t?.teams || null,
      assetsReceived: t?.assetsReceived || null,
      grades: t?.grades || null,
      verdict: t?.verdict || null,
      summary: t?.summary || null,
      qaNotes: t?.qaNotes || null
    };
  });

fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  count: targets.length,
  targets
}, null, 2));

console.log("");
console.log("MODERN ACTIVE SUSPICIOUS INSPECTION");
console.log("=".repeat(80));
console.log(`count: ${targets.length}`);
console.log(`Report: ${outPath}`);

for (const row of targets) {
  console.log("");
  console.log("-".repeat(80));
  console.log(`BUCKET: ${row.bucket}`);
  console.log(`${row.slug} | ${row.id} | ${row.tradeDate} | status=${row.publishStatus} | suppressed=${row.suppressed}`);
  console.log(`teams=${JSON.stringify(row.teams)}`);
  console.log("");
  console.log("assetsReceived:");
  console.dir(row.assetsReceived, { depth: null });
  console.log("");
  console.log("summary:");
  console.log(row.summary || "(none)");
  console.log("");
  console.log("qaNotes:");
  console.log(row.qaNotes || "(none)");
}
