import fs from "node:fs";

const previewPath = "reports/quality/nfl-bottom-batch-010-repair-preview-v1.json";
const outTxt = "reports/quality/nfl-bottom-batch-010-remaining-copy-node-dump-v1.txt";

const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));

function walk(x, out = []) {
  if (Array.isArray(x)) {
    for (const item of x) walk(item, out);
    return out;
  }
  if (!x || typeof x !== "object") return out;
  if (x.id && x.lane === "copy_repair_candidate") out.push(x);
  for (const v of Object.values(x)) walk(v, out);
  return out;
}

const rows = walk(preview);

let txt = `# Bottom Batch 010 Remaining Copy Node Dump\n\nCount: ${rows.length}\n\n`;

for (const r of rows) {
  txt += `## ${r.id}\n`;
  txt += JSON.stringify(r, null, 2);
  txt += `\n\n`;
}

fs.writeFileSync(outTxt, txt);
console.log(`Remaining copy candidates: ${rows.length}`);
console.log(`Wrote: ${outTxt}`);
console.log(rows.map(r => r.id).join(", "));
