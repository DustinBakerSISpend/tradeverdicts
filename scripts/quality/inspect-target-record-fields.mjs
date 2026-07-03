import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const OUT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const TARGET_IDS = new Set([
  "DEN-2004-04-09-0277",
  "RAM-2004-0434",
  "CAR-2021-0079",
  "KC-2002-0203",
  "RAI-2010-0338"
]);

const TARGET_TERMS = [
  "Steven Jackson",
  "Chris Perry",
  "Stacy Andrews",
  "Chuba Hubbard",
  "Keith Taylor",
  "Phil Hoskins",
  "Dez Fitzpatrick",
  "second pass",
  "partner side",
  "partner assessment",
  "opposite value judgment",
  "revised outcome",
  "Status:",
  "Tier:",
  "Confidence:",
  "priority GSC",
  "manual indexing",
  "priority indexing",
  "GSC indexing",
  "indexing page"
];

function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function getId(t) {
  return t.id || t.tradeId || "";
}

function getSlug(t) {
  return t.slug || "";
}

function allText(obj) {
  const seen = new Set();
  const parts = [];
  function walk(x) {
    if (x == null) return;
    if (typeof x === "string" || typeof x === "number") {
      parts.push(String(x));
      return;
    }
    if (typeof x !== "object") return;
    if (seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) x.forEach(walk);
    else Object.values(x).forEach(walk);
  }
  walk(obj);
  return parts.join("\n");
}

function findTermPaths(obj, terms) {
  const hits = [];
  const seen = new Set();

  function walk(x, p) {
    if (x == null) return;

    if (typeof x === "string" || typeof x === "number") {
      const value = String(x);
      for (const term of terms) {
        const idx = value.toLowerCase().indexOf(term.toLowerCase());
        if (idx >= 0) {
          const start = Math.max(0, idx - 180);
          const end = Math.min(value.length, idx + term.length + 220);
          hits.push({
            path: p,
            term,
            value: norm(value.slice(start, end))
          });
        }
      }
      return;
    }

    if (typeof x !== "object") return;
    if (seen.has(x)) return;
    seen.add(x);

    if (Array.isArray(x)) {
      x.forEach((v, i) => walk(v, `${p}[${i}]`));
    } else {
      Object.entries(x).forEach(([k, v]) => walk(v, p ? `${p}.${k}` : k));
    }
  }

  walk(obj, "");
  return hits;
}

function summarize(t) {
  return {
    id: getId(t),
    slug: getSlug(t),
    title: t.title || t.headline || "",
    winner: t.winner || t.winningTeam || t.verdictWinner || t.verdict?.winner || t.outcome?.winner || t.result?.winner || "",
    verdict: t.verdict || t.result || t.outcome || "",
    grades: t.grades || t.teamGrades || t.visibleGrades || {},
    teams: t.teams || t.teamNames || t.franchises || "",
    date: t.date || t.tradeDate || t.year || "",
    keys: Object.keys(t).sort()
  };
}

const targetTrades = trades.filter(t => {
  const id = getId(t);
  const slug = getSlug(t);
  const text = allText(t);
  return (
    TARGET_IDS.has(id) ||
    TARGET_IDS.has(slug) ||
    /Steven Jackson|Chris Perry|Stacy Andrews|Chuba Hubbard|Keith Taylor|Phil Hoskins|Dez Fitzpatrick/i.test(text)
  );
});

const report = targetTrades.map(t => ({
  summary: summarize(t),
  termPaths: findTermPaths(t, TARGET_TERMS),
  fullRecord: t
}));

const jsonPath = path.join(OUT_DIR, `target-record-field-inspection-${RUN_ID}.json`);
const mdPath = path.join(OUT_DIR, `target-record-field-inspection-${RUN_ID}.md`);

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

function cell(v, n = 260) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

const md = [
  "# Target Record Field Inspection",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Records inspected: ${targetTrades.length}`,
  "",
  "## Records",
  "",
  "| ID | Slug | Winner | Grades | Keys |",
  "|---|---|---|---|---|",
  ...report.map(r => `| ${cell(r.summary.id)} | ${cell(r.summary.slug)} | ${cell(JSON.stringify(r.summary.winner))} | ${cell(JSON.stringify(r.summary.grades), 500)} | ${cell(r.summary.keys.join(", "), 500)} |`),
  "",
  "## Term Paths",
  "",
  "| ID | Term | JSON Path | Value Snippet |",
  "|---|---|---|---|",
  ...report.flatMap(r => r.termPaths.map(h => `| ${cell(r.summary.id)} | ${cell(h.term)} | ${cell(h.path)} | ${cell(h.value, 500)} |`))
].join("\n");

fs.writeFileSync(mdPath, md);

console.log(`\nTarget field inspection complete. Records inspected: ${targetTrades.length}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${mdPath}\n`);

console.log("Target records:");
console.table(report.map(r => ({
  id: r.summary.id,
  slug: r.summary.slug,
  winner: JSON.stringify(r.summary.winner),
  grades: JSON.stringify(r.summary.grades),
  key_count: r.summary.keys.length
})));

console.log("\nMatched term paths:");
console.table(report.flatMap(r => r.termPaths.map(h => ({
  id: r.summary.id,
  term: h.term,
  path: h.path,
  value: h.value.slice(0, 120)
}))).slice(0, 80));
