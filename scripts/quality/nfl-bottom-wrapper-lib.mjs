import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const REPORT_DIR = path.join(ROOT, "reports", "quality");

function die(msg) {
  console.error("");
  console.error("ERROR: " + msg);
  console.error("");
  process.exit(1);
}

function label(n) {
  return String(Number(n || 1)).padStart(3, "0");
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function safe(v) {
  return v == null ? "" : String(v);
}

function manifestPath(batchNum) {
  return path.join(REPORT_DIR, `nfl-bottom-batch-${label(batchNum)}-manifest.json`);
}

function readManifest(batchNum) {
  const p = manifestPath(batchNum);
  if (!fs.existsSync(p)) die(`Manifest not found: ${p}`);
  return readJson(p);
}

function run(cmd, args) {
  console.log("");
  console.log("> " + [cmd, ...args].join(" "));
  const res = spawnSync(cmd, args, { cwd: ROOT, shell: false, stdio: "inherit" });
  if (res.status !== 0) die(`Command failed: ${cmd} ${args.join(" ")}`);
}

function segmentRange(startIndex, count) {
  const sizes = [100, 50, 25, 20, 10, 5, 4, 2, 1];
  const chunks = [];
  let current = Number(startIndex);
  let remaining = Number(count);

  while (remaining > 0) {
    const size = sizes.find(s => s <= remaining && current % s === 0);
    if (!size) die(`Could not segment start=${current}, remaining=${remaining}`);
    const batchArg = Math.floor(current / size) + 1;
    chunks.push({
      startIndex: current,
      endIndex: current + size - 1,
      batchArg,
      batchSizeArg: size,
      batchLabel: label(batchArg)
    });
    current += size;
    remaining -= size;
  }

  return chunks;
}

function readIfExists(p) {
  if (!fs.existsSync(p)) return null;
  try { return readJson(p); } catch { return null; }
}

function countBy(records, keyCandidates) {
  const counts = {};
  for (const r of records) {
    let key = "";
    for (const k of keyCandidates) {
      if (r && r[k] != null && String(r[k]).trim()) {
        key = String(r[k]).trim();
        break;
      }
    }
    if (!key) key = "(unknown)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function formatCounts(counts) {
  const entries = Object.entries(counts || {});
  return entries.length ? entries.map(([k,v]) => `- ${k}: ${v}`).join("\n") : "- None";
}

function makeCompactRepairText({ bottomLabel, manifest, chunks, records }) {
  const counts = countBy(records, ["lane", "repairLane", "repair_lane"]);
  const nonClean = records.filter(r => {
    const lane = String(r.lane || r.repairLane || r.repair_lane || "");
    return lane && lane !== "clean_after_v3";
  });

  return `# NFL Bottom Batch ${bottomLabel} Repair Preview v1

Generated: ${new Date().toISOString()}

READ-ONLY. Aggregated from old batch scripts using aligned chunks.

Manifest:
- Original start index: ${manifest.startIndex}
- Original end index: ${manifest.endIndex}
- Manifest records: ${manifest.count}

Chunks used:
${chunks.map(c => `- indexes ${c.startIndex}-${c.endIndex}: node ... ${c.batchArg} ${c.batchSizeArg}`).join("\n")}

## Repair Lane Counts

${formatCounts(counts)}

## Non-Clean Records

${nonClean.length ? nonClean.map((r, i) => {
  return `## ${i + 1}. ${r.id || r.tradeId || "(missing id)"}
- lane: ${r.lane || r.repairLane || r.repair_lane || ""}
- index: ${r.index ?? r.originalIndex ?? ""}
- slug: ${r.slug || ""}
- verdict: ${r.verdict || ""}
- grades: ${JSON.stringify(r.grades || {})}
- perspectives: ${r.perspectiveCount ?? r.perspectivesCount ?? ""}
- action: ${r.action || ""}
- summary: ${r.currentPublicCopy?.summary || r.summary || ""}
- partnerSummary: ${r.currentPublicCopy?.partnerSummary || r.partnerSummary || ""}
- analysis: ${r.currentPublicCopy?.analysis || r.analysis || ""}`;
}).join("\n\n") : "- None"}

## Output Files

- JSON: reports/quality/nfl-bottom-batch-${bottomLabel}-repair-preview-v1.json
- TXT: reports/quality/nfl-bottom-batch-${bottomLabel}-repair-preview-v1.txt
`;
}

function makeCompactGenericText({ title, bottomLabel, manifest, chunks, records, countKeys, nonCleanPredicate }) {
  const counts = countBy(records, countKeys);
  const nonClean = records.filter(nonCleanPredicate || (() => false));
  return `# ${title}

Generated: ${new Date().toISOString()}

Manifest:
- Original start index: ${manifest.startIndex}
- Original end index: ${manifest.endIndex}
- Manifest records: ${manifest.count}

Chunks used:
${chunks.map(c => `- indexes ${c.startIndex}-${c.endIndex}: node ... ${c.batchArg} ${c.batchSizeArg}`).join("\n")}

## Counts

${formatCounts(counts)}

## Flagged Records

${nonClean.length ? nonClean.map((r, i) => `## ${i + 1}. ${r.id || r.tradeId || "(missing id)"}
- index: ${r.index ?? r.originalIndex ?? ""}
- slug: ${r.slug || ""}
- class: ${r.classification || r.v2Class || r.v3Class || r.lane || ""}
- verdict: ${r.verdict || ""}
- grades: ${JSON.stringify(r.grades || {})}
- action: ${r.action || ""}`).join("\n\n") : "- None"}

## Output Files

- JSON: reports/quality/nfl-bottom-batch-${bottomLabel}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json
`;
}

function aggregateChunkJsons(chunks, suffix) {
  const records = [];
  const sources = [];

  for (const c of chunks) {
    const p = path.join(REPORT_DIR, `nfl-batch-${c.batchLabel}-${suffix}.json`);
    sources.push(p);
    const j = readIfExists(p);
    if (!j) continue;
    const arr = Array.isArray(j.records) ? j.records : [];
    for (const r of arr) {
      records.push({
        ...r,
        sourceOldBatchLabel: c.batchLabel,
        sourceOldBatchArg: c.batchArg,
        sourceOldBatchSizeArg: c.batchSizeArg,
        sourceChunkStartIndex: c.startIndex,
        sourceChunkEndIndex: c.endIndex
      });
    }
  }

  return { records, sources };
}

export {
  ROOT,
  REPORT_DIR,
  die,
  label,
  parseArgs,
  readJson,
  writeJson,
  safe,
  readManifest,
  run,
  segmentRange,
  countBy,
  formatCounts,
  makeCompactRepairText,
  makeCompactGenericText,
  aggregateChunkJsons
};
