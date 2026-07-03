import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const OUT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const PATCHES = {
  "RAM-2004-0434": {
    grades: {
      "los-angeles-rams": "A",
      "cincinnati-bengals": "C+"
    },
    summary:
      "The St. Louis Rams acquired the 2004 1st-round pick that became Steven Jackson from the Cincinnati Bengals. Cincinnati moved down two spots for Chris Perry and added Stacy Andrews, but Jackson became the clear best player and long-term value in the deal.",
    partnerSummary:
      "Cincinnati received the 2004 1st-round pick that became Chris Perry and a 2004 4th-round pick that became Stacy Andrews. That returned some usable value, but it did not match the Rams landing Steven Jackson.",
    analysis:
      "The Rams win this trade because Steven Jackson became the defining asset in the deal. Cincinnati did not leave empty-handed with Chris Perry and Stacy Andrews, but Jackson's production and longevity made the Rams' side substantially stronger.",
    qaNotesAppend:
      "Manual QA 2026-07-03: Corrected Steven Jackson Rams/Bengals outcome. Rams received the Steven Jackson pick; Bengals received Chris Perry and Stacy Andrews."
  },

  "CAR-2021-0079": {
    grades: {
      "carolina-panthers": "B+",
      "tennessee-titans": "D"
    },
    summary:
      "Carolina received the picks that became Chuba Hubbard, Keith Taylor, and Phil Hoskins, while Tennessee received Dez Fitzpatrick. Hubbard became the useful multiyear player in the group, giving Carolina the clear value edge.",
    partnerSummary:
      "Tennessee received Dez Fitzpatrick, who caught 12 passes over two seasons. Carolina turned the return into Chuba Hubbard, Keith Taylor, and Phil Hoskins, making the Panthers' side clearly stronger.",
    analysis:
      "The Panthers win this trade. Chuba Hubbard gave Carolina real multiyear production, while Keith Taylor and Phil Hoskins added extra swings from the same return. Tennessee's side did not produce enough to offset that value.",
    qaNotesAppend:
      "Manual QA 2026-07-03: Raised Carolina grade for Chuba Hubbard useful multiyear outcome. Panthers received Chuba Hubbard, Keith Taylor, and Phil Hoskins; Titans received Dez Fitzpatrick."
  }
};

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function getId(t) {
  return t.id || t.tradeId || "";
}

function hasString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function cleanProcessLanguage(s) {
  if (typeof s !== "string") return s;

  return s
    .replace(/\bthe second pass treats\b/gi, "the final review treats")
    .replace(/\bsecond pass\b/gi, "final review")
    .replace(/\bfrom the partner side\b/gi, "from the other side")
    .replace(/\bpartner side\b/gi, "other side")
    .replace(/\bpartner assessment mirrors\b/gi, "the other assessment reflects")
    .replace(/\bpartner assessment\b/gi, "other-side assessment")
    .replace(/\bopposite value judgment\b/gi, "opposing value read")
    .replace(/\brevised outcome\b/gi, "updated outcome");
}

function replacePublicCopyFields(t, patch) {
  const publicFields = ["summary", "partnerSummary", "analysis"];

  for (const field of publicFields) {
    if (hasString(t[field]) && patch[field]) {
      t[field] = patch[field];
    }
  }

  // These usually feed the trade-page cards. Keep them aligned without assuming every record has the same count.
  if (Array.isArray(t.perspectives)) {
    for (const p of t.perspectives) {
      const team = String(p.team || p.teamKey || p.franchise || "").toLowerCase();

      if (p.primarySummary && /rams|carolina|panthers|los-angeles-rams|carolina-panthers/i.test(team + " " + p.primarySummary)) {
        p.primarySummary = patch.summary;
      } else if (p.primarySummary) {
        p.primarySummary = cleanProcessLanguage(p.primarySummary);
      }

      if (p.partnerSummary && /bengals|cincinnati|titans|tennessee|cincinnati-bengals|tennessee-titans/i.test(team + " " + p.partnerSummary)) {
        p.partnerSummary = patch.partnerSummary;
      } else if (p.partnerSummary) {
        p.partnerSummary = cleanProcessLanguage(p.partnerSummary);
      }

      for (const k of ["summary", "analysis", "verdictSummary", "description"]) {
        if (typeof p[k] === "string") p[k] = cleanProcessLanguage(p[k]);
      }
    }
  }

  // Clean process language in any remaining obvious public copy strings on the target records.
  for (const field of [
    "title","headline","description","verdictSummary","shortSummary","longSummary",
    "seoTitle","seoDescription","metaTitle","metaDescription","winnerSummary",
    "loserSummary","excerpt","intro","takeaway"
  ]) {
    if (typeof t[field] === "string") t[field] = cleanProcessLanguage(t[field]);
  }
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

  if (!t.grades || typeof t.grades !== "object" || Array.isArray(t.grades)) {
    t.grades = {};
  }

  for (const [team, grade] of Object.entries(patch.grades)) {
    t.grades[team] = grade;
  }

  replacePublicCopyFields(t, patch);
  appendQaNote(t, patch.qaNotesAppend);

  const after = clone(t);

  changed.push({
    id,
    before: {
      grades: before.grades,
      summary: before.summary,
      partnerSummary: before.partnerSummary,
      analysis: before.analysis,
      qaNotes: before.qaNotes
    },
    after: {
      grades: after.grades,
      summary: after.summary,
      partnerSummary: after.partnerSummary,
      analysis: after.analysis,
      qaNotes: after.qaNotes
    }
  });
}

if (changed.length) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(trades, null, 2) + "\n");
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath: DATA_PATH,
  changedCount: changed.length,
  missing,
  changed
};

const jsonPath = path.join(OUT_DIR, `targeted-outcome-grade-patch-${RUN_ID}.json`);
const mdPath = path.join(OUT_DIR, `targeted-outcome-grade-patch-${RUN_ID}.md`);

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

function cell(v, n = 360) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

fs.writeFileSync(mdPath, [
  "# Targeted Outcome / Grade Patch",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Changed records: ${changed.length}`,
  missing.length ? `Missing records: ${missing.join(", ")}` : "Missing records: none",
  "",
  "| ID | Before Grades | After Grades | After Summary |",
  "|---|---|---|---|",
  ...changed.map(c => `| ${cell(c.id)} | ${cell(JSON.stringify(c.before.grades))} | ${cell(JSON.stringify(c.after.grades))} | ${cell(c.after.summary)} |`)
].join("\n"));

console.log(`\nTargeted patch complete. Changed records: ${changed.length}`);
if (missing.length) console.log(`Missing records: ${missing.join(", ")}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${mdPath}\n`);

console.table(changed.map(c => ({
  id: c.id,
  before_grades: JSON.stringify(c.before.grades),
  after_grades: JSON.stringify(c.after.grades),
  after_summary: c.after.summary.slice(0, 120)
})));
