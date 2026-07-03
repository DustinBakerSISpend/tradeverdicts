import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const REPORT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const TARGET_IDS = new Set([
  "RAM-2004-0434",
  "CAR-2021-0079",
  "MIA-2016-0262"
]);

const TERMS = [
  "Cincinnati Bengals",
  "Bengals Win",
  "Bengals",
  "Los Angeles Rams",
  "St. Louis Rams",
  "Rams Win",
  "Carolina Panthers",
  "Panthers Win",
  "Tennessee Titans",
  "Titans Win",
  "Miami Dolphins",
  "Dolphins Win",
  "Philadelphia Eagles",
  "Eagles Win",
  "winner",
  "winning",
  "verdict",
  "outcome",
  "result"
];

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

function getId(t) {
  return t.id || t.tradeId || "";
}

function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function findPaths(obj, terms) {
  const hits = [];
  const seen = new Set();

  function walk(x, p) {
    if (x == null) return;

    if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") {
      const value = String(x);
      for (const term of terms) {
        const idx = value.toLowerCase().indexOf(term.toLowerCase());
        if (idx >= 0) {
          hits.push({
            path: p,
            term,
            value: norm(value.slice(Math.max(0, idx - 180), Math.min(value.length, idx + term.length + 240)))
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
      Object.entries(x).forEach(([k, v]) => {
        const nextPath = p ? `${p}.${k}` : k;

        // Also inspect key names, because fields like verdictWinner/winningTeam matter.
        for (const term of terms) {
          if (k.toLowerCase().includes(term.toLowerCase())) {
            hits.push({
              path: nextPath,
              term: `[key:${term}]`,
              value: norm(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 360)
            });
          }
        }

        walk(v, nextPath);
      });
    }
  }

  walk(obj, "");
  return hits;
}

const records = trades
  .filter(t => TARGET_IDS.has(getId(t)) || TARGET_IDS.has(t.slug))
  .map(t => ({
    id: getId(t),
    slug: t.slug,
    topLevelKeys: Object.keys(t).sort(),
    grades: t.grades,
    suspectedWinnerFields: Object.fromEntries(
      Object.entries(t).filter(([k]) => /winner|winning|verdict|outcome|result/i.test(k))
    ),
    pathHits: findPaths(t, TERMS)
  }));

const latestAudit = fs.readdirSync(REPORT_DIR)
  .filter(f => /^asset-outcome-sanity-v2-.*\.json$/.test(f))
  .sort()
  .at(-1);

let rawTargetFindings = [];
if (latestAudit) {
  const findings = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latestAudit), "utf8"));
  rawTargetFindings = findings.filter(f => {
    const hay = JSON.stringify(f);
    return [...TARGET_IDS].some(id => hay.includes(id));
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  latestAudit,
  records,
  rawTargetFindings
};

const jsonPath = path.join(REPORT_DIR, `fixed-record-verdict-source-locator-${RUN_ID}.json`);
const mdPath = path.join(REPORT_DIR, `fixed-record-verdict-source-locator-${RUN_ID}.md`);

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

function cell(v, n = 420) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

fs.writeFileSync(mdPath, [
  "# Fixed Record Verdict Source Locator",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Latest audit: ${latestAudit || "none"}`,
  "",
  "## Top-Level Suspected Winner Fields",
  "",
  "| ID | Slug | Grades | Suspected Winner Fields |",
  "|---|---|---|---|",
  ...records.map(r => `| ${cell(r.id)} | ${cell(r.slug)} | ${cell(JSON.stringify(r.grades), 220)} | ${cell(JSON.stringify(r.suspectedWinnerFields), 600)} |`),
  "",
  "## Path Hits",
  "",
  "| ID | Term | Path | Value |",
  "|---|---|---|---|",
  ...records.flatMap(r => r.pathHits.map(h => `| ${cell(r.id)} | ${cell(h.term)} | ${cell(h.path)} | ${cell(h.value, 600)} |`)),
  "",
  "## Raw Latest-v2 Findings for Fixed IDs",
  "",
  "| Category | ID/Slug | Score | Reason | Raw Keys |",
  "|---|---|---:|---|---|",
  ...rawTargetFindings.map(f => `| ${cell(f.category)} | ${cell(f.id || f.slug)} | ${cell(f.score)} | ${cell(f.reason, 600)} | ${cell(Object.keys(f).join(", "))} |`)
].join("\n"));

console.log(`\nFixed-record verdict source locator complete.`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${mdPath}\n`);

console.log("Suspected winner/verdict fields:");
console.table(records.map(r => ({
  id: r.id,
  slug: r.slug,
  grades: JSON.stringify(r.grades),
  suspectedWinnerFields: JSON.stringify(r.suspectedWinnerFields).slice(0, 220)
})));

console.log("\nRAM/Bengals/Rams/winner path hits:");
console.table(records.flatMap(r => r.pathHits.map(h => ({
  id: r.id,
  term: h.term,
  path: h.path,
  value: h.value.slice(0, 160)
}))).filter(x =>
  x.id === "RAM-2004-0434" ||
  /winner|verdict|outcome|result|Bengals|Rams/i.test(`${x.term} ${x.value} ${x.path}`)
).slice(0, 120));

console.log("\nRaw latest-v2 findings for fixed IDs:");
console.table(rawTargetFindings.slice(0, 30).map((f, i) => ({
  rank: i + 1,
  score: f.score,
  category: f.category,
  id_or_slug: f.id || f.slug,
  reason: String(f.reason || "").slice(0, 150),
  keys: Object.keys(f).join(", ")
})));
