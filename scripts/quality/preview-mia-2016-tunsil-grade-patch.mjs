import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const OUT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const TARGET_ID = "MIA-2016-0262";

const PATCH_PREVIEW = {
  grades: {
    "miami-dolphins": "A-",
    "philadelphia-eagles": "C"
  },
  summary:
    "Miami acquired Byron Maxwell, Kiko Alonso, and the 2016 1st-round pick that became Laremy Tunsil from Philadelphia. Tunsil became the clear long-term prize of the deal, giving the Dolphins a major value edge.",
  partnerSummary:
    "Philadelphia moved up in the 2016 first round, but Miami landed the pick that became Laremy Tunsil while also adding Byron Maxwell and Kiko Alonso. The Eagles gained positioning, but the player outcome favored Miami.",
  analysis:
    "The Dolphins win this trade because Laremy Tunsil became the defining asset. Philadelphia's move up had strategic value, but Miami's return produced the best player and the stronger long-term outcome."
};

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function getId(t) {
  return t.id || t.tradeId || "";
}

function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
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

function termPaths(obj, terms) {
  const hits = [];
  const seen = new Set();

  function walk(x, p) {
    if (x == null) return;

    if (typeof x === "string" || typeof x === "number") {
      const value = String(x);
      for (const term of terms) {
        const idx = value.toLowerCase().indexOf(term.toLowerCase());
        if (idx >= 0) {
          hits.push({
            path: p,
            term,
            value: norm(value.slice(Math.max(0, idx - 160), Math.min(value.length, idx + term.length + 220)))
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

const trade = trades.find(t => getId(t) === TARGET_ID || t.slug === TARGET_ID);

if (!trade) {
  throw new Error(`Target not found: ${TARGET_ID}`);
}

const before = clone(trade);
const after = clone(trade);

after.grades = {
  ...(after.grades || {}),
  ...PATCH_PREVIEW.grades
};

after.summary = PATCH_PREVIEW.summary;
after.partnerSummary = PATCH_PREVIEW.partnerSummary;
after.analysis = PATCH_PREVIEW.analysis;

if (Array.isArray(after.perspectives)) {
  for (const p of after.perspectives) {
    if (typeof p.primarySummary === "string") p.primarySummary = PATCH_PREVIEW.summary;
    if (typeof p.partnerSummary === "string") p.partnerSummary = PATCH_PREVIEW.partnerSummary;
  }
}

const qaNote = "Manual QA 2026-07-03 preview: proposed Miami grade correction for Laremy Tunsil outcome. Dolphins received Byron Maxwell, Kiko Alonso, and the pick that became Laremy Tunsil.";
if (typeof after.qaNotes === "string") {
  after.qaNotes = after.qaNotes.includes(qaNote) ? after.qaNotes : `${after.qaNotes} | ${qaNote}`;
} else if (Array.isArray(after.qaNotes)) {
  if (!after.qaNotes.includes(qaNote)) after.qaNotes.push(qaNote);
} else {
  after.qaNotes = qaNote;
}

const report = {
  generatedAt: new Date().toISOString(),
  noChange: true,
  target: TARGET_ID,
  before: {
    id: getId(before),
    slug: before.slug,
    grades: before.grades,
    assetsReceived: before.assetsReceived,
    summary: before.summary,
    partnerSummary: before.partnerSummary,
    analysis: before.analysis,
    perspectives: before.perspectives,
    qaNotes: before.qaNotes
  },
  afterPreview: {
    id: getId(after),
    slug: after.slug,
    grades: after.grades,
    assetsReceived: after.assetsReceived,
    summary: after.summary,
    partnerSummary: after.partnerSummary,
    analysis: after.analysis,
    perspectives: after.perspectives,
    qaNotes: after.qaNotes
  },
  evidencePaths: termPaths(before, [
    "Laremy Tunsil",
    "Byron Maxwell",
    "Kiko Alonso",
    "Pro Bowl",
    "1st round pick",
    "13th overall",
    "8th overall"
  ])
};

const jsonPath = path.join(OUT_DIR, `mia-2016-0262-grade-patch-preview-${RUN_ID}.json`);
const mdPath = path.join(OUT_DIR, `mia-2016-0262-grade-patch-preview-${RUN_ID}.md`);

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

function cell(v, n = 420) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

fs.writeFileSync(mdPath, [
  "# MIA-2016-0262 Grade Patch Preview",
  "",
  `Generated: ${new Date().toISOString()}`,
  "No-change preview only.",
  "",
  "## Grade Change",
  "",
  "| Team | Before | After Preview |",
  "|---|---:|---:|",
  ...Object.keys(PATCH_PREVIEW.grades).map(team => `| ${cell(team)} | ${cell(before.grades?.[team])} | ${cell(after.grades?.[team])} |`),
  "",
  "## Assets Received",
  "",
  "```json",
  JSON.stringify(before.assetsReceived, null, 2),
  "```",
  "",
  "## Before / After Copy",
  "",
  "| Field | Before | After Preview |",
  "|---|---|---|",
  `| summary | ${cell(before.summary)} | ${cell(after.summary)} |`,
  `| partnerSummary | ${cell(before.partnerSummary)} | ${cell(after.partnerSummary)} |`,
  `| analysis | ${cell(before.analysis)} | ${cell(after.analysis)} |`,
  "",
  "## Evidence Paths",
  "",
  "| Term | Path | Value |",
  "|---|---|---|",
  ...report.evidencePaths.map(h => `| ${cell(h.term)} | ${cell(h.path)} | ${cell(h.value)} |`)
].join("\n"));

console.log(`\nNo-change patch preview created for ${TARGET_ID}.`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${mdPath}\n`);

console.log("Grade preview:");
console.table(Object.keys(PATCH_PREVIEW.grades).map(team => ({
  team,
  before: before.grades?.[team],
  after_preview: after.grades?.[team]
})));

console.log("\nAssets received:");
console.dir(before.assetsReceived, { depth: 8 });

console.log("\nEvidence paths:");
console.table(report.evidencePaths.map(h => ({
  term: h.term,
  path: h.path,
  value: h.value.slice(0, 140)
})));

console.log("\nCopy preview:");
console.table([
  { field: "summary", before: before.summary, after: after.summary },
  { field: "partnerSummary", before: before.partnerSummary, after: after.partnerSummary },
  { field: "analysis", before: before.analysis, after: after.analysis }
].map(r => ({
  field: r.field,
  before: cell(r.before, 120),
  after: cell(r.after, 120)
})));
