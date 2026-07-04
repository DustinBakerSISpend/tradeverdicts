import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const reportPath = path.join(ROOT, "reports", "quality", "nfl-batch-001-audit.json");
const outMd = path.join(ROOT, "reports", "quality", "nfl-batch-001-review-priority.md");
const outJson = path.join(ROOT, "reports", "quality", "nfl-batch-001-review-priority.json");

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

const priorityBuckets = new Set([
  "structure/team-key issue",
  "stale verdict field",
  "copy-only fix",
  "weird character/encoding issue"
]);

const priority = report.audited
  .filter(item =>
    item.issues.some(issue => priorityBuckets.has(issue.bucket)) ||
    item.issues.some(issue => /backend|process|unknown-team|stale verdict|weird character|malformed/i.test(issue.type || ""))
  )
  .map(item => ({
    index: item.index,
    recordNumber: item.recordNumber,
    id: item.id,
    slug: item.slug,
    title: item.title,
    date: item.date,
    verdict: item.verdict,
    status: item.status,
    issueCount: item.issueCount,
    issues: item.issues.filter(issue =>
      priorityBuckets.has(issue.bucket) ||
      /backend|process|unknown-team|stale verdict|weird character|malformed/i.test(issue.type || "")
    )
  }));

const possibleNoise = report.audited
  .filter(item =>
    item.status === "grade/verdict fix candidate" &&
    !item.issues.some(issue => priorityBuckets.has(issue.bucket))
  )
  .map(item => ({
    index: item.index,
    recordNumber: item.recordNumber,
    id: item.id,
    slug: item.slug,
    title: item.title,
    verdict: item.verdict,
    issueCount: item.issueCount,
    topIssues: item.issues.slice(0, 3)
  }));

const assetDupes = report.audited
  .filter(item => item.status === "asset duplication/broken asset text")
  .map(item => ({
    index: item.index,
    recordNumber: item.recordNumber,
    id: item.id,
    slug: item.slug,
    title: item.title,
    verdict: item.verdict,
    issues: item.issues.filter(issue => issue.bucket === "asset duplication/broken asset text").slice(0, 5)
  }));

const clean = report.audited
  .filter(item => item.status === "clean")
  .map(item => ({
    index: item.index,
    recordNumber: item.recordNumber,
    id: item.id,
    slug: item.slug,
    title: item.title
  }));

const review = {
  generatedAt: new Date().toISOString(),
  sourceReport: "reports/quality/nfl-batch-001-audit.json",
  batchNumber: report.batchNumber,
  startIndex: report.startIndex,
  endIndex: report.endIndex,
  totalReviewed: report.actualBatchCount,
  priorityCount: priority.length,
  possibleNoiseCount: possibleNoise.length,
  assetDuplicationReviewCount: assetDupes.length,
  cleanCount: clean.length,
  staleVerdictPatchCheck: report.staleVerdictPatchCheck,
  priority,
  assetDupes,
  possibleNoise,
  clean
};

fs.writeFileSync(outJson, JSON.stringify(review, null, 2));

function issueLine(issue) {
  const sample = issue.sample ? `\n    - Sample: ${issue.sample}` : "";
  const pattern = issue.pattern ? `\n    - Pattern: ${issue.pattern}` : "";
  const reason = issue.reason ? `\n    - Reason: ${issue.reason}` : "";
  return `  - ${issue.severity || "P?"} ${issue.bucket}: ${issue.type}${pattern}${reason}${sample}`;
}

const md = `# NFL Batch 001 Priority Review

Generated: ${review.generatedAt}

Source: \`reports/quality/nfl-batch-001-audit.json\`

Batch:
- Start index: ${review.startIndex}
- End index: ${review.endIndex}
- Total reviewed: ${review.totalReviewed}

## Stale Verdict Patch Check

${review.staleVerdictPatchCheck.map(x => `- ${x.id}: currentVerdict="${x.currentVerdict}", looksPatched=${x.looksPatched}`).join("\n")}

## Priority Counts

- High-confidence priority records: ${review.priorityCount}
- Asset duplication / broken text review records: ${review.assetDuplicationReviewCount}
- Possible noisy grade/verdict candidates set aside: ${review.possibleNoiseCount}
- Clean records: ${review.cleanCount}

## High-Confidence Priority Records

${priority.map(item => `### #${item.recordNumber} / index ${item.index}: ${item.id || "(missing id)"}
- Slug: ${item.slug || "(missing slug)"}
- Title: ${item.title || "(missing title)"}
- Verdict: ${item.verdict || "(missing verdict)"}
- Status: ${item.status}
${item.issues.map(issueLine).join("\n")}`).join("\n\n") || "None."}

## Asset Duplication / Broken Asset Text Review

${assetDupes.map(item => `### #${item.recordNumber} / index ${item.index}: ${item.id || "(missing id)"}
- Slug: ${item.slug || "(missing slug)"}
- Title: ${item.title || "(missing title)"}
- Verdict: ${item.verdict || "(missing verdict)"}
${item.issues.map(issueLine).join("\n")}`).join("\n\n") || "None."}

## Possible Noisy Grade/Verdict Candidates — Hold for Later

These were flagged by broad language heuristics and should not be patched without manual review.

${possibleNoise.slice(0, 40).map(item => `- #${item.recordNumber} index ${item.index}: ${item.id || "(missing id)"} — ${item.slug || "(missing slug)"} — verdict="${item.verdict || ""}"`).join("\n") || "None."}

## Clean Records

${clean.map(item => `- #${item.recordNumber} index ${item.index}: ${item.id || "(missing id)"} — ${item.slug || "(missing slug)"}`).join("\n") || "None."}

## Output Files

- JSON: \`reports/quality/nfl-batch-001-review-priority.json\`
- Markdown: \`reports/quality/nfl-batch-001-review-priority.md\`
`;

fs.writeFileSync(outMd, md);

console.log("");
console.log("Batch 001 priority review export complete.");
console.log(`High-confidence priority records: ${review.priorityCount}`);
console.log(`Asset duplication / broken text review records: ${review.assetDuplicationReviewCount}`);
console.log(`Possible noisy grade/verdict candidates set aside: ${review.possibleNoiseCount}`);
console.log(`Clean records: ${review.cleanCount}`);
console.log("");
console.log("Open this next:");
console.log("reports\\quality\\nfl-batch-001-review-priority.md");
