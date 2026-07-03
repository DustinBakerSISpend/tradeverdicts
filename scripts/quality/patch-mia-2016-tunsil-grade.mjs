import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const OUT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const TARGET_ID = "MIA-2016-0262";

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function getId(t) {
  return t.id || t.tradeId || "";
}

function has(s, term) {
  return String(s || "").toLowerCase().includes(term.toLowerCase());
}

function cleanSpacing(s) {
  return String(s || "")
    .replace(/2016 1st roundpick/gi, "2016 1st-round pick")
    .replace(/1st round pick/gi, "1st-round pick")
    .replace(/\s+/g, " ")
    .trim();
}

const trade = trades.find(t => getId(t) === TARGET_ID || t.slug === TARGET_ID);

if (!trade) {
  throw new Error(`Target not found: ${TARGET_ID}`);
}

const before = clone(trade);

const miamiSummary =
  "Miami acquired Byron Maxwell, Kiko Alonso, and the 2016 1st-round pick that became Laremy Tunsil from Philadelphia. Tunsil became the clear long-term prize of the deal, giving the Dolphins a major value edge.";

const philadelphiaSummary =
  "Philadelphia moved up in the 2016 first round and received the pick that became Jack Conklin, but Miami landed Laremy Tunsil while also adding Byron Maxwell and Kiko Alonso. The Eagles gained draft position, but the player outcome favored Miami.";

const analysis =
  "The Dolphins win this trade because Laremy Tunsil became the defining asset. Philadelphia's move up had strategic value, but Miami's return produced the best player and the stronger long-term outcome.";

trade.grades = {
  ...(trade.grades || {}),
  "miami-dolphins": "A-",
  "philadelphia-eagles": "C"
};

trade.summary = miamiSummary;
trade.partnerSummary = philadelphiaSummary;
trade.analysis = analysis;

if (Array.isArray(trade.perspectives)) {
  for (const p of trade.perspectives) {
    const all = `${p.team || ""} ${p.teamKey || ""} ${p.franchise || ""} ${p.primarySummary || ""} ${p.partnerSummary || ""}`;

    if (typeof p.primarySummary === "string") {
      if (has(all, "miami") || has(p.primarySummary, "laremy tunsil") || has(p.primarySummary, "dolphins")) {
        p.primarySummary = miamiSummary;
      } else if (has(all, "philadelphia") || has(all, "eagles")) {
        p.primarySummary = philadelphiaSummary;
      } else {
        p.primarySummary = cleanSpacing(p.primarySummary);
      }
    }

    if (typeof p.partnerSummary === "string") {
      if (has(p.partnerSummary, "miami") || has(p.partnerSummary, "laremy tunsil") || has(p.partnerSummary, "dolphins")) {
        p.partnerSummary = miamiSummary;
      } else if (has(p.partnerSummary, "philadelphia") || has(p.partnerSummary, "eagles") || has(p.partnerSummary, "jack conklin")) {
        p.partnerSummary = philadelphiaSummary;
      } else {
        p.partnerSummary = cleanSpacing(p.partnerSummary);
      }
    }

    for (const key of ["summary", "analysis", "description", "verdictSummary"]) {
      if (typeof p[key] === "string") p[key] = cleanSpacing(p[key]);
    }
  }
}

const qaNote =
  "Manual QA 2026-07-03: Corrected Miami grade for Laremy Tunsil outcome. Dolphins received Byron Maxwell, Kiko Alonso, and the pick that became Tunsil; Eagles received the pick that became Jack Conklin.";

if (typeof trade.qaNotes === "string") {
  if (!trade.qaNotes.includes(qaNote)) trade.qaNotes = `${trade.qaNotes} | ${qaNote}`;
} else if (Array.isArray(trade.qaNotes)) {
  if (!trade.qaNotes.includes(qaNote)) trade.qaNotes.push(qaNote);
} else {
  trade.qaNotes = qaNote;
}

const after = clone(trade);

fs.writeFileSync(DATA_PATH, JSON.stringify(trades, null, 2) + "\n");

const report = {
  generatedAt: new Date().toISOString(),
  target: TARGET_ID,
  changed: true,
  before: {
    grades: before.grades,
    summary: before.summary,
    partnerSummary: before.partnerSummary,
    analysis: before.analysis,
    perspectives: before.perspectives,
    qaNotes: before.qaNotes
  },
  after: {
    grades: after.grades,
    summary: after.summary,
    partnerSummary: after.partnerSummary,
    analysis: after.analysis,
    perspectives: after.perspectives,
    qaNotes: after.qaNotes
  }
};

const jsonPath = path.join(OUT_DIR, `mia-2016-0262-grade-patch-applied-${RUN_ID}.json`);
const mdPath = path.join(OUT_DIR, `mia-2016-0262-grade-patch-applied-${RUN_ID}.md`);

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

function cell(v, n = 360) {
  return String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, n);
}

fs.writeFileSync(mdPath, [
  "# MIA-2016-0262 Grade Patch Applied",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "| Team | Before | After |",
  "|---|---:|---:|",
  `| miami-dolphins | ${cell(before.grades?.["miami-dolphins"])} | ${cell(after.grades?.["miami-dolphins"])} |`,
  `| philadelphia-eagles | ${cell(before.grades?.["philadelphia-eagles"])} | ${cell(after.grades?.["philadelphia-eagles"])} |`,
  "",
  "## After Copy",
  "",
  `- Summary: ${after.summary}`,
  `- Partner Summary: ${after.partnerSummary}`,
  `- Analysis: ${after.analysis}`
].join("\n"));

console.log(`\nApplied one-record patch: ${TARGET_ID}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${mdPath}\n`);

console.table([
  {
    team: "miami-dolphins",
    before: before.grades?.["miami-dolphins"],
    after: after.grades?.["miami-dolphins"]
  },
  {
    team: "philadelphia-eagles",
    before: before.grades?.["philadelphia-eagles"],
    after: after.grades?.["philadelphia-eagles"]
  }
]);

console.log("\nAfter summary:");
console.log(after.summary);
console.log("\nAfter partnerSummary:");
console.log(after.partnerSummary);
console.log("\nAfter analysis:");
console.log(after.analysis);
