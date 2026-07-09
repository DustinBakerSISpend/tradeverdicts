import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "reports", "quality");
fs.mkdirSync(OUT_DIR, { recursive: true });

const includeExt = new Set([".astro", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const skipDirs = new Set([".git", "node_modules", "dist", ".astro", ".netlify", "reports", "audits"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (includeExt.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function lineWindow(lines, index, pad = 5) {
  const start = Math.max(0, index - pad);
  const end = Math.min(lines.length, index + pad + 1);
  return {
    start: start + 1,
    end,
    text: lines.slice(start, end).map((line, i) => String(start + i + 1).padStart(4, " ") + ": " + line).join("\n"),
  };
}

const patterns = [
  { name: "3-second timeout/debounce", re: /3000|3\s*\*\s*1000|setTimeout|setInterval|debounce|throttle/i },
  { name: "homepage search input/form", re: /search players|hero.*search|home.*search|q=|name=["']q["']|type=["']search["']|placeholder=.*search/i },
  { name: "client search rendering", re: /addEventListener\(["']input|addEventListener\(["']submit|results|innerHTML|preventDefault|URLSearchParams|window\.location/i },
  { name: "heavy index source", re: /safeJson\(trade\)|JSON\.stringify\(searchIndex\)|searchIndex|searchText|trades\.json|allTrades|publicTrades/i },
];

const hits = [];
const files = walk(path.join(ROOT, "src"));

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    for (const pattern of patterns) {
      if (pattern.re.test(line)) {
        const w = lineWindow(lines, i, 4);
        hits.push({
          file: rel(file),
          pattern: pattern.name,
          line: i + 1,
          start: w.start,
          end: w.end,
          text: w.text,
        });
      }
    }
  });
}

const grouped = new Map();
for (const hit of hits) {
  const key = hit.file;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(hit);
}

const priorityFiles = [...grouped.keys()].sort((a, b) => {
  const score = (file) => {
    let s = 0;
    if (file === "src/pages/index.astro") s += 100;
    if (/search/i.test(file)) s += 30;
    if (/component/i.test(file)) s += 10;
    return -s;
  };
  return score(a) - score(b) || a.localeCompare(b);
});

const lines = [];
lines.push("# Homepage search delay diagnostic");
lines.push("");
lines.push("Scanned src/**/*.{astro,js,jsx,ts,tsx,mjs,cjs}");
lines.push(`Files with hits: ${grouped.size}`);
lines.push(`Total hits: ${hits.length}`);
lines.push("");
lines.push("## Priority hit files");
lines.push("");
for (const file of priorityFiles.slice(0, 30)) lines.push("- " + file);
lines.push("");

for (const file of priorityFiles) {
  lines.push("============================================================");
  lines.push("FILE: " + file);
  lines.push("");

  for (const hit of grouped.get(file)) {
    lines.push(`--- ${hit.pattern} at lines ${hit.start}-${hit.end} ---`);
    lines.push(hit.text);
    lines.push("");
  }
}

lines.push("No build was run. No files were modified.");

const out = path.join(OUT_DIR, "homepage-search-delay-diagnostic.txt");
fs.writeFileSync(out, lines.join("\n"), "utf8");

console.log(lines.join("\n"));
console.log("");
console.log("Wrote reports/quality/homepage-search-delay-diagnostic.txt");
console.log("No build was run. No files were modified.");
