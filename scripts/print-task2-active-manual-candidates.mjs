import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CSV = path.join(ROOT, "audits", "nfl-verdict-grade-consistency-manual-top-level-review", "active-manual-candidates.csv");
const OUT_DIR = path.join(ROOT, "audits", "nfl-verdict-grade-consistency-manual-top-level-review");
const OUT = path.join(OUT_DIR, "active-manual-candidates-readable.txt");
const DOWNLOADS_OUT = path.join(process.env.USERPROFILE || ROOT, "Downloads", "task2-active-manual-candidates-readable.txt");

if (!fs.existsSync(CSV)) {
  throw new Error("Missing active manual candidates CSV: " + path.relative(ROOT, CSV));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (quote) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quote = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') quote = true;
      else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch !== "\r") {
        cell += ch;
      }
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows
    .filter((r) => r.length && r.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])));
}

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const rows = parseCsv(fs.readFileSync(CSV, "utf8"));

const grouped = new Map();
for (const row of rows) {
  if (!grouped.has(row.slug)) grouped.set(row.slug, []);
  grouped.get(row.slug).push(row);
}

const lines = [];
lines.push("Task 2 active manual candidates");
lines.push("================================");
lines.push("Rows: " + rows.length);
lines.push("Unique slugs: " + grouped.size);
lines.push("");

for (const [slug, flags] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push("============================================================");
  lines.push("SLUG: " + slug);
  lines.push("Rows: " + flags.length);
  lines.push("");

  for (const flag of flags) {
    lines.push("Active bucket: " + flag.activeBucket);
    lines.push("Refined bucket: " + flag.refinedBucket);
    lines.push("Issue: " + flag.issue);
    lines.push("Field: " + flag.field);
    lines.push("Top verdict from scanner: " + flag.topVerdict);
    lines.push("Active verdict: " + flag.activeVerdict);
    lines.push("Active team grades: " + flag.activeTeamGrades);
    lines.push("Reason: " + flag.reason);
    lines.push("");
    lines.push("Flag snippet:");
    lines.push(normalizeSpaces(flag.flagSnippet));
    lines.push("");
    lines.push("Active field text:");
    lines.push(normalizeSpaces(flag.activeFieldText));
    lines.push("");
  }
}

fs.writeFileSync(OUT, lines.join("\n"), "utf8");
fs.writeFileSync(DOWNLOADS_OUT, lines.join("\n"), "utf8");

console.log(fs.readFileSync(OUT, "utf8"));
console.log("");
console.log("Wrote " + path.relative(ROOT, OUT).replaceAll(path.sep, "/"));
console.log("Also wrote " + DOWNLOADS_OUT);
console.log("No build was run. No trade JSON was modified.");
