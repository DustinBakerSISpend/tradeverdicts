import fs from "node:fs";
import path from "node:path";
import {
  REPORT_DIR,
  parseArgs,
  readManifest,
  run,
  segmentRange,
  writeJson,
  makeCompactGenericText,
  aggregateChunkJsons,
  label
} from "./nfl-bottom-wrapper-lib.mjs";

const args = parseArgs();
const bottom = Number(args.bottom || args._[0] || 1);
const manifest = readManifest(bottom);
const bottomLabel = label(bottom);
const chunks = segmentRange(manifest.startIndex, manifest.count);

for (const c of chunks) {
  run("node", ["scripts\\quality\\create-nfl-batch-structural-decision-packet-v1.mjs", String(c.batchArg), String(c.batchSizeArg)]);
}

const agg = aggregateChunkJsons(chunks, "structural-decision-packet-v1");
const outJson = path.join(REPORT_DIR, `nfl-bottom-batch-${bottomLabel}-structural-decision-packet-v1.json`);
const outTxt = path.join(REPORT_DIR, `nfl-bottom-batch-${bottomLabel}-structural-decision-packet-v1.txt`);

writeJson(outJson, { generatedAt: new Date().toISOString(), manifest, chunks, sources: agg.sources, records: agg.records });

fs.writeFileSync(outTxt, makeCompactGenericText({
  title: `NFL Bottom Batch ${bottomLabel} Structural Decision Packet v1`,
  bottomLabel,
  manifest,
  chunks,
  records: agg.records,
  countKeys: ["suggestedAction", "action"],
  nonCleanPredicate: () => true
}));

console.log("");
console.log(`Structural packet wrapper complete for Bottom Batch ${bottomLabel}.`);
console.log(`Records aggregated: ${agg.records.length}`);
console.log(`Open: reports\\quality\\nfl-bottom-batch-${bottomLabel}-structural-decision-packet-v1.txt`);
