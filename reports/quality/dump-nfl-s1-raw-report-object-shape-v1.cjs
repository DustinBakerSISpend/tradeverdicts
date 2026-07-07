const fs = require("fs");

const sample = Number(process.argv[2] || 3);
const p = "reports/quality/nfl-asset-bundle-split-candidates-v1.json";
const out = "reports/quality/nfl-s1-raw-report-object-shape-v1.txt";
const S1 = "S1_clean_multi_pick_split_plus_dedupe_candidate";

const x = JSON.parse(fs.readFileSync(p, "utf8"));

function findS1(obj, path = []) {
  const out = [];
  if (!obj || typeof obj !== "object") return out;

  if (Array.isArray(obj)) {
    obj.forEach((v, i) => out.push(...findS1(v, path.concat(String(i)))));
    return out;
  }

  for (const [k, v] of Object.entries(obj)) {
    const next = path.concat(k);
    if (k === S1) {
      out.push({ path: next.join("."), value: v });
    }
    out.push(...findS1(v, next));
  }

  return out;
}

function preview(value, limit = 1600) {
  const s = JSON.stringify(value, null, 2);
  return s.length > limit ? s.slice(0, limit) + "\n...<truncated>" : s;
}

const hits = findS1(x);
const lines = [];

lines.push("# NFL S1 Raw Report Object Shape v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`File: ${p}`);
lines.push(`hits: ${hits.length}`);
lines.push("");

for (const hit of hits.slice(0, 10)) {
  lines.push(`## PATH: ${hit.path}`);

  if (Array.isArray(hit.value)) {
    lines.push(`array length: ${hit.value.length}`);

    for (const [idx, item] of hit.value.slice(0, sample).entries()) {
      lines.push("");
      lines.push(`### ITEM ${idx + 1}`);
      lines.push(`ITEM KEYS: ${Object.keys(item).join(", ")}`);
      lines.push("```json");
      lines.push(preview(item));
      lines.push("```");
    }
  } else {
    lines.push(`VALUE TYPE: ${hit.value === null ? "null" : Array.isArray(hit.value) ? "array" : typeof hit.value}`);
    if (hit.value && typeof hit.value === "object") lines.push(`VALUE KEYS: ${Object.keys(hit.value).join(", ")}`);
    lines.push("```json");
    lines.push(preview(hit.value));
    lines.push("```");
  }

  lines.push("");
}

fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`\nWrote: ${out}`);
