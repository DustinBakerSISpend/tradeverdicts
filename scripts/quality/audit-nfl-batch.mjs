import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const batchNumber = Number(process.argv[2] || 1);
const batchSize = Number(process.argv[3] || 100);
const startIndex = (batchNumber - 1) * batchSize;
const endIndex = startIndex + batchSize - 1;

const batchLabel = String(batchNumber).padStart(3, "0");

const jsonOut = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-audit.json`);
const mdOut = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-audit.md`);
const csvOut = path.join(REPORT_DIR, `nfl-batch-${batchLabel}-audit.csv`);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compact(value, max = 260) {
  const s = safeString(value).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function getByKeys(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) {
      return obj[key];
    }
  }
  return "";
}

function collectTextFields(obj, pathParts = [], out = []) {
  if (obj == null) return out;

  if (typeof obj === "string") {
    const keyPath = pathParts.join(".");
    const lower = keyPath.toLowerCase();

    const publicish =
      lower.includes("summary") ||
      lower.includes("analysis") ||
      lower.includes("description") ||
      lower.includes("content") ||
      lower.includes("body") ||
      lower.includes("verdict") ||
      lower.includes("title") ||
      lower.includes("slug");

    if (publicish) out.push({ path: keyPath, text: obj });
    return out;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectTextFields(item, [...pathParts, String(i)], out));
    return out;
  }

  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      collectTextFields(v, [...pathParts, k], out);
    }
  }

  return out;
}

function collectAllStrings(obj, pathParts = [], out = []) {
  if (obj == null) return out;

  if (typeof obj === "string") {
    out.push({ path: pathParts.join("."), text: obj });
    return out;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectAllStrings(item, [...pathParts, String(i)], out));
    return out;
  }

  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      collectAllStrings(v, [...pathParts, k], out);
    }
  }

  return out;
}

function collectLikelyAssets(obj, pathParts = [], out = []) {
  if (obj == null) return out;

  const pathText = pathParts.join(".").toLowerCase();

  if (typeof obj === "string") {
    if (
      pathText.includes("asset") ||
      pathText.includes("pick") ||
      pathText.includes("received") ||
      pathText.includes("sent") ||
      pathText.includes("player")
    ) {
      out.push({
        path: pathParts.join("."),
        text: obj
      });
    }
    return out;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectLikelyAssets(item, [...pathParts, String(i)], out));
    return out;
  }

  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      collectLikelyAssets(v, [...pathParts, k], out);
    }
  }

  return out;
}

function normalizeAssetText(s) {
  return safeString(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s#.-]/g, "")
    .trim();
}

function extractGrades(trade) {
  const candidates = [];

  function walk(obj, pathParts = []) {
    if (obj == null) return;

    if (typeof obj === "string") {
      const p = pathParts.join(".").toLowerCase();
      if (p.includes("grade")) {
        candidates.push({
          path: pathParts.join("."),
          value: obj
        });
      }
      return;
    }

    if (typeof obj === "number") {
      const p = pathParts.join(".").toLowerCase();
      if (p.includes("grade")) {
        candidates.push({
          path: pathParts.join("."),
          value: String(obj)
        });
      }
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, [...pathParts, String(i)]));
      return;
    }

    if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        walk(v, [...pathParts, k]);
      }
    }
  }

  walk(trade);
  return candidates;
}

function gradeRank(g) {
  const cleaned = safeString(g).trim().toUpperCase();
  const map = {
    "A+": 13, "A": 12, "A-": 11,
    "B+": 10, "B": 9, "B-": 8,
    "C+": 7, "C": 6, "C-": 5,
    "D+": 4, "D": 3, "D-": 2,
    "F": 1
  };
  return map[cleaned] ?? null;
}

function verdictGradeMismatchHeuristic(trade) {
  const verdict = safeString(getByKeys(trade, ["verdict", "winner", "outcome"]));
  const grades = extractGrades(trade);
  const letterGrades = grades
    .map(g => ({ ...g, rank: gradeRank(g.value) }))
    .filter(g => g.rank != null);

  if (!verdict || letterGrades.length < 2) return null;

  const sorted = [...letterGrades].sort((a, b) => b.rank - a.rank);
  const top = sorted[0];
  const second = sorted[1];

  if (/even trade/i.test(verdict) && top.rank - second.rank >= 3) {
    return {
      verdict,
      reason: `Verdict says Even Trade but visible grade spread appears large: ${top.value} vs ${second.value}.`,
      grades: letterGrades
    };
  }

  return null;
}

function classifyTrade(trade, index) {
  const id = safeString(getByKeys(trade, ["id", "tradeId", "trade_id"]));
  const slug = safeString(getByKeys(trade, ["slug", "urlSlug"]));
  const title = safeString(getByKeys(trade, ["title", "headline", "name"]));
  const date = safeString(getByKeys(trade, ["date", "tradeDate", "year"]));
  const verdict = safeString(getByKeys(trade, ["verdict", "winner", "outcome"]));

  const publicTextFields = collectTextFields(trade);
  const allStrings = collectAllStrings(trade);
  const publicText = publicTextFields.map(x => x.text).join("\n");
  const allText = allStrings.map(x => x.text).join("\n");

  const issues = [];

  const backendPatterns = [
    /second pass/i,
    /partner side/i,
    /partner assessment/i,
    /opposite value judgment/i,
    /revised outcome/i,
    /original C-/i,
    /\bregrade\b/i,
    /priority GSC/i,
    /manual indexing/i,
    /\bStatus\b\s*:/i,
    /\bTier\b\s*:/i,
    /\bConfidence\b\s*:/i
  ];

  for (const pattern of backendPatterns) {
    if (pattern.test(publicText)) {
      issues.push({
        bucket: "copy-only fix",
        severity: "P0/P1",
        type: "backend/process language in public copy",
        pattern: String(pattern),
        sample: compact(publicText.match(pattern)?.input || publicText)
      });
    }
  }

  const contradictionPatterns = [
    /clearer football value/i,
    /slight .* lean/i,
    /even grade/i,
    /even trade/i,
    /original [A-F][+-]?/i,
    /second pass/i
  ];

  for (const pattern of contradictionPatterns) {
    if (pattern.test(publicText)) {
      issues.push({
        bucket: "grade/verdict fix candidate",
        severity: "P1",
        type: "possible summary/analysis vs visible grade/verdict contradiction",
        pattern: String(pattern),
        verdict,
        sample: compact(publicText.match(pattern)?.input || publicText)
      });
    }
  }

  const weirdCharPatterns = [
    /ï¿½/,
    /�/,
    /Ã/,
    /Â/,
    /Arizonast Louis/i
  ];

  for (const pattern of weirdCharPatterns) {
    if (pattern.test(allText)) {
      issues.push({
        bucket: "weird character/encoding issue",
        severity: "P1",
        type: "weird character or malformed franchise text",
        pattern: String(pattern),
        sample: compact(allText.match(pattern)?.input || allText)
      });
    }
  }

  const spacingPatterns = [
    /\b\d{4}\d+(st|nd|rd|th)\b/i,
    /\b\d+overall\b/i,
    /\s+\)/,
    /\(\s+/
  ];

  for (const pattern of spacingPatterns) {
    if (pattern.test(allText)) {
      issues.push({
        bucket: "asset duplication/broken asset text",
        severity: "P2",
        type: "broken spacing/truncation candidate",
        pattern: String(pattern),
        sample: compact(allText.match(pattern)?.input || allText)
      });
    }
  }

  if (/unknown-team/i.test(allText)) {
    issues.push({
      bucket: "structure/team-key issue",
      severity: "P1",
      type: "unknown-team leak",
      sample: compact(allText)
    });
  }

  const assets = collectLikelyAssets(trade);
  const seenAssets = new Map();

  for (const asset of assets) {
    const norm = normalizeAssetText(asset.text);
    if (!norm || norm.length < 4) continue;

    if (!seenAssets.has(norm)) {
      seenAssets.set(norm, []);
    }
    seenAssets.get(norm).push(asset.path);
  }

  for (const [assetText, paths] of seenAssets.entries()) {
    if (paths.length > 1) {
      issues.push({
        bucket: "asset duplication/broken asset text",
        severity: "P1/P2",
        type: "possible duplicate asset text within trade",
        assetText,
        paths
      });
    }
  }

  const gradeMismatch = verdictGradeMismatchHeuristic(trade);
  if (gradeMismatch) {
    issues.push({
      bucket: "stale verdict field",
      severity: "P1",
      type: "possible stale verdict field",
      ...gradeMismatch
    });
  }

  const likelyNotable =
    /herschel|walker|ricky williams|moss|favre|rodgers|wilson|watson|stafford|tunsil|ramsey|mack|khalil|parsons|jackson|elway|young|montana|cutler|palmer|vick|wheatley|dickerson|faulk|mcnair|eli|rivers|vick/i.test(
      `${slug} ${title} ${allText}`
    );

  const publicCopyWordCount = publicText
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  if (likelyNotable && publicCopyWordCount < 180) {
    issues.push({
      bucket: "notable trade needs beefed-up analysis",
      severity: "P2",
      type: "notable/semi-notable trade may be too thin",
      publicCopyWordCount,
      sample: compact(`${title} ${slug} ${publicText}`)
    });
  }

  let status = "clean";
  if (issues.length) {
    const bucketPriority = [
      "duplicate/merge candidate",
      "structure/team-key issue",
      "stale verdict field",
      "grade/verdict fix candidate",
      "copy-only fix",
      "asset duplication/broken asset text",
      "weird character/encoding issue",
      "notable trade needs beefed-up analysis",
      "needs manual source/context",
      "hold/current-future trade"
    ];
    status = bucketPriority.find(b => issues.some(i => i.bucket === b)) || issues[0].bucket;
  }

  return {
    batchNumber,
    index,
    recordNumber: index + 1,
    id,
    slug,
    title,
    date,
    verdict,
    status,
    issueCount: issues.length,
    issues,
    gradeFields: extractGrades(trade),
    textFieldCount: publicTextFields.length
  };
}

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;

if (!Array.isArray(trades)) {
  throw new Error("Could not find trades array in src/data/nfl/trades.json");
}

const batch = trades.slice(startIndex, startIndex + batchSize);
const audited = batch.map((trade, offset) => classifyTrade(trade, startIndex + offset));

const staleVerdictChecks = [
  {
    id: "RAM-2004-0434",
    expectedNot: "Cincinnati Bengals Win"
  },
  {
    id: "MIA-2016-0262",
    expectedNot: "Even Trade"
  }
].map(check => {
  const trade = trades.find(t => safeString(getByKeys(t, ["id", "tradeId", "trade_id"])) === check.id);
  if (!trade) {
    return {
      ...check,
      found: false,
      currentVerdict: null,
      looksPatched: null
    };
  }

  const currentVerdict = safeString(getByKeys(trade, ["verdict", "winner", "outcome"]));

  return {
    ...check,
    found: true,
    currentVerdict,
    looksPatched: currentVerdict !== check.expectedNot
  };
});

const bucketCounts = {};
for (const item of audited) {
  bucketCounts[item.status] = (bucketCounts[item.status] || 0) + 1;
}

const issueCountsByType = {};
for (const item of audited) {
  for (const issue of item.issues) {
    const key = `${issue.bucket} | ${issue.type}`;
    issueCountsByType[key] = (issueCountsByType[key] || 0) + 1;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath: DATA_PATH,
  batchNumber,
  batchLabel,
  batchSize,
  startIndex,
  endIndex: startIndex + batch.length - 1,
  requestedEndIndex: endIndex,
  totalTrades: trades.length,
  actualBatchCount: batch.length,
  tradeIdsAndSlugs: audited.map(x => ({
    index: x.index,
    recordNumber: x.recordNumber,
    id: x.id,
    slug: x.slug,
    title: x.title
  })),
  staleVerdictPatchCheck: staleVerdictChecks,
  bucketCounts,
  issueCountsByType,
  audited
};

fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));

function csvEscape(value) {
  const s = safeString(value);
  return `"${s.replace(/"/g, '""')}"`;
}

const csvRows = [
  [
    "batch",
    "index",
    "recordNumber",
    "id",
    "slug",
    "title",
    "date",
    "verdict",
    "status",
    "issueCount",
    "topIssue"
  ].join(",")
];

for (const item of audited) {
  csvRows.push([
    item.batchNumber,
    item.index,
    item.recordNumber,
    csvEscape(item.id),
    csvEscape(item.slug),
    csvEscape(item.title),
    csvEscape(item.date),
    csvEscape(item.verdict),
    csvEscape(item.status),
    item.issueCount,
    csvEscape(item.issues[0] ? `${item.issues[0].bucket}: ${item.issues[0].type}` : "")
  ].join(","));
}

fs.writeFileSync(csvOut, csvRows.join("\n"));

const topIssues = audited
  .filter(x => x.issues.length)
  .slice(0, 25)
  .map(x => {
    const issueLines = x.issues.slice(0, 5).map(issue => {
      const sample = issue.sample ? ` — ${issue.sample}` : "";
      return `  - ${issue.severity || ""} ${issue.bucket}: ${issue.type}${sample}`;
    }).join("\n");

    return `### ${x.recordNumber}. ${x.title || x.slug || x.id || "(untitled trade)"}
- Index: ${x.index}
- ID: ${x.id || "(missing)"}
- Slug: ${x.slug || "(missing)"}
- Verdict: ${x.verdict || "(missing)"}
- Status: ${x.status}
${issueLines}`;
  })
  .join("\n\n");

const md = `# NFL Batch ${batchLabel} Read-Only QA Audit

Generated: ${report.generatedAt}

Source: \`src/data/nfl/trades.json\`

Batch definition:
- Batch number: ${batchNumber}
- Start index: ${startIndex}
- End index: ${startIndex + batch.length - 1}
- Actual trade objects reviewed: ${batch.length}
- Total NFL trades in file: ${trades.length}

## Stale Verdict Patch Check

${staleVerdictChecks.map(x => `- ${x.id}: found=${x.found}; currentVerdict="${x.currentVerdict ?? "N/A"}"; looksPatched=${x.looksPatched}`).join("\n")}

## Bucket Counts

${Object.entries(bucketCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Issue Counts by Type

${Object.entries(issueCountsByType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Trade IDs / Slugs in Batch

${audited.map(x => `- ${x.recordNumber}. index ${x.index}: ${x.id || "(missing id)"} — ${x.slug || "(missing slug)"} — ${x.title || "(missing title)"}`).join("\n")}

## Top Issues for Review

${topIssues || "No issues detected by this read-only heuristic audit."}

## Output Files

- JSON: \`${path.relative(ROOT, jsonOut)}\`
- Markdown: \`${path.relative(ROOT, mdOut)}\`
- CSV: \`${path.relative(ROOT, csvOut)}\`
`;

fs.writeFileSync(mdOut, md);

console.log("");
console.log(`NFL Batch ${batchLabel} read-only QA audit complete.`);
console.log(`Trade indexes: ${startIndex}-${startIndex + batch.length - 1}`);
console.log(`Actual trade objects reviewed: ${batch.length}`);
console.log("");
console.log("Stale verdict patch check:");
for (const x of staleVerdictChecks) {
  console.log(`- ${x.id}: found=${x.found}; currentVerdict="${x.currentVerdict ?? "N/A"}"; looksPatched=${x.looksPatched}`);
}
console.log("");
console.log("Bucket counts:");
for (const [bucket, count] of Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`- ${bucket}: ${count}`);
}
console.log("");
console.log("Reports:");
console.log(`- ${path.relative(ROOT, mdOut)}`);
console.log(`- ${path.relative(ROOT, jsonOut)}`);
console.log(`- ${path.relative(ROOT, csvOut)}`);
console.log("");
console.log("Top issue records:");
for (const x of audited.filter(x => x.issues.length).slice(0, 12)) {
  console.log(`- #${x.recordNumber} index ${x.index}: ${x.id || "(missing id)"} / ${x.slug || "(missing slug)"} => ${x.status} (${x.issueCount})`);
}
