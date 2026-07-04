import fs from "node:fs";
import path from "node:path";
import {
  REPORT_DIR,
  parseArgs,
  readManifest,
  run,
  segmentRange,
  writeJson,
  makeCompactRepairText,
  makeCompactGenericText,
  aggregateChunkJsons,
  label
} from "./nfl-bottom-wrapper-lib.mjs";

const args = parseArgs();
const bottom = Number(args.bottom || args._[0] || 1);
const manifest = readManifest(bottom);
const bottomLabel = label(bottom);
const chunks = segmentRange(manifest.startIndex, manifest.count);

console.log("");
console.log(`# Running audit for NFL Bottom Batch ${bottomLabel}`);
console.log(`Manifest range: ${manifest.startIndex}-${manifest.endIndex}`);
console.log("");
console.log("Old-script chunks:");
for (const c of chunks) console.log(`- indexes ${c.startIndex}-${c.endIndex}: ${c.batchArg} ${c.batchSizeArg}`);

for (const c of chunks) {
  run("node", ["scripts\\quality\\audit-nfl-batch-master-v2.mjs", String(c.batchArg), String(c.batchSizeArg)]);
  run("node", ["scripts\\quality\\audit-nfl-batch-v3-calibration.mjs", String(c.batchArg), String(c.batchSizeArg)]);
  run("node", ["scripts\\quality\\create-nfl-batch-repair-preview-v1.mjs", String(c.batchArg), String(c.batchSizeArg)]);
}

const master = aggregateChunkJsons(chunks, "master-audit-v2");
const v3 = aggregateChunkJsons(chunks, "v3-calibration");
const repair = aggregateChunkJsons(chunks, "repair-preview-v1");

const masterJson = path.join(REPORT_DIR, `nfl-bottom-batch-${bottomLabel}-master-audit-v2.json`);
const masterTxt = path.join(REPORT_DIR, `nfl-bottom-batch-${bottomLabel}-master-audit-v2.txt`);
const v3Json = path.join(REPORT_DIR, `nfl-bottom-batch-${bottomLabel}-v3-calibration.json`);
const v3Txt = path.join(REPORT_DIR, `nfl-bottom-batch-${bottomLabel}-v3-calibration.txt`);
const repairJson = path.join(REPORT_DIR, `nfl-bottom-batch-${bottomLabel}-repair-preview-v1.json`);
const repairTxt = path.join(REPORT_DIR, `nfl-bottom-batch-${bottomLabel}-repair-preview-v1.txt`);
const runTxt = path.join(REPORT_DIR, `nfl-bottom-batch-${bottomLabel}-audit-run.txt`);

writeJson(masterJson, { generatedAt: new Date().toISOString(), manifest, chunks, sources: master.sources, records: master.records });
writeJson(v3Json, { generatedAt: new Date().toISOString(), manifest, chunks, sources: v3.sources, records: v3.records });
writeJson(repairJson, { generatedAt: new Date().toISOString(), manifest, chunks, sources: repair.sources, records: repair.records });

fs.writeFileSync(masterTxt, makeCompactGenericText({
  title: `NFL Bottom Batch ${bottomLabel} Master Audit v2`,
  bottomLabel,
  manifest,
  chunks,
  records: master.records,
  countKeys: ["classification", "v2Class", "class"],
  nonCleanPredicate: r => {
    const c = String(r.classification || r.v2Class || r.class || "");
    return c && !/clean/i.test(c);
  }
}));

fs.writeFileSync(v3Txt, makeCompactGenericText({
  title: `NFL Bottom Batch ${bottomLabel} V3 Calibration`,
  bottomLabel,
  manifest,
  chunks,
  records: v3.records,
  countKeys: ["v3Class", "class", "classification"],
  nonCleanPredicate: r => {
    const c = String(r.v3Class || r.class || r.classification || "");
    return c && !/clean/i.test(c);
  }
}));

fs.writeFileSync(repairTxt, makeCompactRepairText({ bottomLabel, manifest, chunks, records: repair.records }));

fs.writeFileSync(runTxt, `# NFL Bottom Batch ${bottomLabel} Audit Run

Generated: ${new Date().toISOString()}

Manifest range:
- ${manifest.startIndex}-${manifest.endIndex}

Why chunks were used:
- The original audit scripts accept batchNumber + batchSize, not startIndex + count.
- This wrapper split the bottom-up manifest into aligned old-script chunks and aggregated the results.

Chunks:
${chunks.map(c => `- indexes ${c.startIndex}-${c.endIndex}: node scripts\\quality\\... ${c.batchArg} ${c.batchSizeArg}`).join("\n")}

Aggregated outputs:
- reports\\quality\\nfl-bottom-batch-${bottomLabel}-master-audit-v2.txt
- reports\\quality\\nfl-bottom-batch-${bottomLabel}-v3-calibration.txt
- reports\\quality\\nfl-bottom-batch-${bottomLabel}-repair-preview-v1.txt
`);

console.log("");
console.log(`Audit wrapper complete for Bottom Batch ${bottomLabel}.`);
console.log(`Records aggregated from repair preview: ${repair.records.length}`);
console.log(`Open: reports\\quality\\nfl-bottom-batch-${bottomLabel}-repair-preview-v1.txt`);
