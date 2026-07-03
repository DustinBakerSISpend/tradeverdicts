import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const OUT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const PATCHES = {
  "RAM-2004-0434": {
    verdict: "Los Angeles Rams Win",
    note: "Manual QA 2026-07-03: Corrected stale verdict field from Cincinnati Bengals Win to Los Angeles Rams Win after Steven Jackson outcome fix."
  },
  "MIA-2016-0262": {
    verdict: "Miami Dolphins Win",
    note: "Manual QA 2026-07-03: Corrected stale verdict field from Even Trade to Miami Dolphins Win after Laremy Tunsil outcome fix."
  }
};

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function getId(t) {
  return t.id || t.tradeId || "";
}

function appendQaNote(t, note) {
  if (!note) return;

  if (typeof t.qaNotes === "string") {
    if (!t.qaNotes.includes(note)) t.qaNotes = `${t.qaNotes} | ${note}`;
  } else if (Array.isArray(t.qaNotes)) {
    if (!t.qaNotes.includes(note)) t.qaNotes.push(note);
  } else {
    t.qaNotes = note;
  }
}

const changed = [];
const missing = [];

for (const [id, patch] of Object.entries(PATCHES)) {
  const t = trades.find(x => getId(x) === id || x.slug === id);

  if (!t) {
    missing.push(id);
    continue;
  }

  const before = clone(t);

  t.verdict = patch.verdict;

  if (Array.isArray(t.perspectives)) {
    for (const p of t.perspectives) {
      if (typeof p.verdict === "string") {
        p.verdict = patch.verdict;
      }
    }
  }

  appendQaNote(t, patch.note);

  const after = clone(t);

  changed.push({
    id,
    before: {
      verdict: before.verdict,
      perspectiveVerdicts: Array.isArray(before.perspectives) ? before.perspectives.map((p, i) => ({ index: i, verdict: p.verdict })) : [],
      grades: before.grades,
      qaNotes: before.qaNotes
    },
    after: {
      verdict: after.verdict,
      perspectiveVerdicts: Array.isArray(after.perspectives) ? after.perspectives.map((p, i) => ({ index: i, verdict: p.verdict })) : [],
      grades: after.grades,
      qaNotes: after.qaNotes
    }
  });
}

fs.writeFileSync(DATA_PATH, JSON.stringify(trades, null, 2) + "\n");

const report = {
  generatedAt: new Date().toISOString(),
  changedCount: changed.length,
  missing,
  changed
};

const jsonPath = path.join(OUT_DIR, `stale-verdict-field-patch-${RUN_ID}.json`);
const mdPath = path.join(OUT_DIR, `stale-verdict-field-patch-${RUN_ID}.md`);

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

function cell(v, n = 360) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

fs.writeFileSync(mdPath, [
  "# Stale Verdict Field Patch",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Changed records: ${changed.length}`,
  missing.length ? `Missing: ${missing.join(", ")}` : "Missing: none",
  "",
  "| ID | Before Verdict | After Verdict | Before Perspective Verdicts | After Perspective Verdicts |",
  "|---|---|---|---|---|",
  ...changed.map(c => `| ${cell(c.id)} | ${cell(c.before.verdict)} | ${cell(c.after.verdict)} | ${cell(JSON.stringify(c.before.perspectiveVerdicts), 500)} | ${cell(JSON.stringify(c.after.perspectiveVerdicts), 500)} |`)
].join("\n"));

console.log(`\nStale verdict patch complete. Changed records: ${changed.length}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${mdPath}\n`);

console.table(changed.map(c => ({
  id: c.id,
  before_verdict: c.before.verdict,
  after_verdict: c.after.verdict,
  before_perspectives: c.before.perspectiveVerdicts.map(x => x.verdict).join(" | "),
  after_perspectives: c.after.perspectiveVerdicts.map(x => x.verdict).join(" | ")
})));
