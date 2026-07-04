import fs from "node:fs";
import path from "node:path";
import { REPORT_DIR, parseArgs, readManifest, getTrades, getId, safe, label } from "./nfl-batch-lib.mjs";

const args = parseArgs();
const bottom = Number(args.bottom || args._[0] || 1);
const m = readManifest(bottom);
const batchLabel = label(bottom);
const { trades } = getTrades();

const currentById = new Map(trades.map((t, i) => [getId(t), { t, i }]));

const banned = [
  /status:\s*ready/i,
  /publishStatus/i,
  /qaNotes/i,
  /trade verdicts hindsight scale/i,
  /trade verdicts scale/i,
  /strict-hindsight value curve/i,
  /same strict-hindsight value curve/i,
  /same hindsight curve/i,
  /partner grade reflects/i,
  /partner even/i,
  /minor designation/i,
  /standard designation/i,
  /oppositeside/i,
  /opposite sideof/i,
  /enoughto/i
];

function scanText(t) {
  const pieces = [
    t.summary,
    t.partnerSummary,
    t.analysis,
    ...(Array.isArray(t.perspectives) ? t.perspectives.flatMap(p => [p.primarySummary, p.partnerSummary, p.analysis, p.publishStatus, p.qaNotes]) : [])
  ].map(safe);
  const joined = pieces.join("\n");
  return banned.filter(rx => rx.test(joined)).map(rx => rx.source);
}

function classify(t) {
  const hits = scanText(t);
  const perspectiveCount = Array.isArray(t.perspectives) ? t.perspectives.length : 0;
  const teams = Object.keys(t.grades || {});
  const assetsTeams = Object.keys(t.assetsReceived || {});
  const unknownLeak = JSON.stringify(t).toLowerCase().includes("unknown-team") || JSON.stringify(t).toLowerCase().includes("unknown partner");
  const tooManyPerspectives = perspectiveCount > Math.max(2, teams.length || 2);
  const missingPublicCopy = !safe(t.summary).trim() || !safe(t.partnerSummary).trim() || !safe(t.analysis).trim();

  const issues = [];
  if (hits.length) issues.push("public_language_hits");
  if (tooManyPerspectives) issues.push("too_many_perspectives");
  if (unknownLeak) issues.push("unknown_team_or_partner");
  if (missingPublicCopy) issues.push("missing_public_copy");

  return { perspectiveCount, hits, issues, clean: issues.length === 0 };
}

const records = m.records.map(r => {
  const found = currentById.get(r.id);
  if (!found) return { ...r, currentIndex: null, finalState: "quarantined_or_missing", clean: true, issues: [] };

  const c = classify(found.t);
  return {
    ...r,
    currentIndex: found.i,
    finalState: c.clean ? "clean_after_manifest_scan" : "needs_review",
    clean: c.clean,
    issues: c.issues,
    hitPatterns: c.hits,
    currentPerspectiveCount: c.perspectiveCount,
    currentSlug: found.t.slug
  };
});

const counts = {};
for (const r of records) counts[r.finalState] = (counts[r.finalState] || 0) + 1;

const outJson = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-finalize-v1.json`);
const outTxt = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-finalize-v1.txt`);

fs.writeFileSync(outJson, JSON.stringify({
  generatedAt: new Date().toISOString(),
  bottomBatchNumber: bottom,
  manifestGeneratedAt: m.generatedAt,
  totalManifestRecords: records.length,
  counts,
  records
}, null, 2) + "\n");

const txt = `# NFL Bottom Batch ${batchLabel} Finalize v1

Generated: ${new Date().toISOString()}

Purpose:
- Verify the original manifest IDs, not whatever slid into the index range later.
- Missing/quarantined records are considered accounted for, not silent failures.
- Any needs_review rows should be fixed before closing the batch.

## Counts
${Object.entries(counts).map(([k,v]) => `- ${k}: ${v}`).join("\n")}

## Non-clean Records
${records.filter(r => r.finalState === "needs_review").length ? records.filter(r => r.finalState === "needs_review").map(r => `- id=${r.id} originalIndex=${r.originalIndex} currentIndex=${r.currentIndex} slug=${r.currentSlug} issues=${r.issues.join(", ")} hits=${(r.hitPatterns || []).join(" | ")}`).join("\n") : "- None"}

## Missing / Quarantined / Removed Records
${records.filter(r => r.finalState === "quarantined_or_missing").length ? records.filter(r => r.finalState === "quarantined_or_missing").map(r => `- id=${r.id} originalIndex=${r.originalIndex} slug=${r.slug}`).join("\n") : "- None"}

## All Records
${records.map((r, i) => `${String(i + 1).padStart(3, "0")}. id=${r.id} originalIndex=${r.originalIndex} currentIndex=${r.currentIndex} finalState=${r.finalState} issues=${(r.issues || []).join(",")}`).join("\n")}
`;

fs.writeFileSync(outTxt, txt);

console.log("");
console.log(`Finalize complete for Bottom Batch ${batchLabel}.`);
console.log("Counts:");
for (const [k,v] of Object.entries(counts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-${batchLabel}-finalize-v1.txt`);
