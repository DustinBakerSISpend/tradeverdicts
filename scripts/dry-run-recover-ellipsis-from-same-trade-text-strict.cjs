const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(outDir, "ellipsis-same-trade-text-recovery-strict-dry-run.json");

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];

if (!Array.isArray(trades) || trades.length === 0) {
  console.error("Could not find trades array.");
  process.exit(1);
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || t.transactionDate || null;
}

function keysOf(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
}

function assetKeys(t) {
  return keysOf(t.assetsReceived).sort();
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function prefixBeforeEllipsis(s) {
  return String(s || "").split("...")[0].trim();
}

function flattenAssets(t) {
  const rows = [];

  for (const team of assetKeys(t)) {
    const assets = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];

    for (const [assetIndex, item] of assets.entries()) {
      rows.push({
        team,
        assetIndex,
        type: item && item.type ? item.type : null,
        asset: item && item.asset ? item.asset : ""
      });
    }
  }

  return rows;
}

function sentenceFragments(text) {
  const rawText = String(text || "");
  if (!rawText || rawText.includes("...")) return [];

  return rawText
    .split(/(?<=[.!?])\s+|\s+\|\s+|;\s+/g)
    .map(s => s.trim())
    .filter(Boolean);
}

function possibleAssetSubstring(fragment, prefix) {
  const normPrefix = normalize(prefix);

  const candidates = [
    fragment,
    fragment.replace(/^[A-Z][A-Za-z .'-]+ acquired\s+/i, ""),
    fragment.replace(/^[A-Z][A-Za-z .'-]+ received\s+/i, ""),
    fragment.replace(/^received\s+/i, ""),
    fragment.replace(/^acquired\s+/i, "")
  ].map(s => s.trim());

  for (const candidateRaw of candidates) {
    if (!normalize(candidateRaw).startsWith(normPrefix)) continue;

    const candidate = candidateRaw
      .replace(/\s+from\s+[A-Z].*$/i, "")
      .replace(/\s+while\s+sending\s+.*$/i, "")
      .replace(/\s+and gave up\s+.*$/i, "")
      .replace(/\s+for\s+.*$/i, "")
      .trim();

    return candidate;
  }

  return null;
}

function looksCompleteAsset(after) {
  const s = String(after || "").trim();
  const lower = s.toLowerCase();

  if (!s) return false;
  if (s.includes("...")) return false;

  // Reject obvious clipped fragments from summaries.
  const badEndings = [
    /\broun\.$/i,
    /\bover\.$/i,
    /\bov\.$/i,
    /\bp\.$/i,
    /\bP\.$/,
    /\bSterl\.$/i,
    /\bJa\.$/i,
    /\b99t\.$/i,
    /\broun$/i,
    /\bover$/i,
    /\bov$/i,
    /\(\?\.$/,
    /\(\?$/,
    /\($/,
    /,$/,
    /\band$/i,
    /\bsubsequently traded$/i,
    /\boverall subsequently traded$/i
  ];

  if (badEndings.some(rx => rx.test(s))) return false;

  // Require either a closed parenthetical, a player-only name, or a standard compensation phrase.
  const hasOpen = (s.match(/\(/g) || []).length;
  const hasClose = (s.match(/\)/g) || []).length;
  if (hasOpen !== hasClose) return false;

  const looksLikePick = /\b(19|20)\d{2}\b.*\bround pick\b/i.test(s);
  const looksLikePlayerOnly = /^[A-Z][A-Za-z .'\-]+( \/ [A-Z][A-Za-z .'\-]+)?$/.test(s);
  const looksLikeConditional = /\bconditional\b/i.test(s) && /\b(not exercised|exercised|overall|round pick)\b/i.test(s);
  const looksLikeCash = /\bcash|consideration|undisclosed/i.test(s);

  if (!(looksLikePick || looksLikePlayerOnly || looksLikeConditional || looksLikeCash)) return false;

  // Guard against prose.
  const proseBad = [
    "the trade",
    "the deal",
    "the move",
    "grade",
    "verdict",
    "database",
    "belongs as",
    "public-facing"
  ];

  if (proseBad.some(p => lower.includes(p))) return false;

  return true;
}

function isSafeCandidate(before, after) {
  if (!after) return false;

  const prefix = prefixBeforeEllipsis(before);
  if (!normalize(after).startsWith(normalize(prefix))) return false;
  if (after.length <= before.replace("...", "").length) return false;
  if (after.length > 350) return false;
  if (!looksCompleteAsset(after)) return false;

  return true;
}

const planned = [];
const rejectedCandidates = [];
const ambiguous = [];
const noCandidate = [];

for (const t of trades) {
  if (t.suppressed === true) continue;

  const ellipsisAssets = flattenAssets(t).filter(row => String(row.asset || "").includes("..."));
  if (!ellipsisAssets.length) continue;

  const fields = [
    ["summary", t.summary],
    ["partnerSummary", t.partnerSummary],
    ["analysis", t.analysis],
    ["qaNotes", t.qaNotes]
  ].filter(([, value]) => typeof value === "string" && value && !value.includes("..."));

  for (const row of ellipsisAssets) {
    const prefix = prefixBeforeEllipsis(row.asset);
    const safeCandidates = [];
    const rejected = [];

    for (const [field, value] of fields) {
      for (const fragment of sentenceFragments(value)) {
        const candidate = possibleAssetSubstring(fragment, prefix);
        if (!candidate) continue;

        if (isSafeCandidate(row.asset, candidate)) {
          safeCandidates.push({
            field,
            candidate,
            fragment
          });
        } else {
          rejected.push({
            field,
            candidate,
            fragment
          });
        }
      }
    }

    const uniqueByCandidate = new Map();
    for (const c of safeCandidates) {
      if (!uniqueByCandidate.has(c.candidate)) uniqueByCandidate.set(c.candidate, []);
      uniqueByCandidate.get(c.candidate).push({
        field: c.field,
        fragment: c.fragment
      });
    }

    const uniqueCandidates = [...uniqueByCandidate.entries()].map(([candidate, evidence]) => ({
      candidate,
      evidence: evidence.slice(0, 4)
    }));

    const base = {
      slug: slugOf(t),
      id: t.id || null,
      date: dateOf(t),
      publishStatus: t.publishStatus || null,
      team: row.team,
      assetIndex: row.assetIndex,
      type: row.type,
      before: row.asset,
      prefix
    };

    if (uniqueCandidates.length === 1) {
      planned.push({
        ...base,
        after: uniqueCandidates[0].candidate,
        evidence: uniqueCandidates[0].evidence
      });
    } else if (uniqueCandidates.length > 1) {
      ambiguous.push({
        ...base,
        candidateCount: uniqueCandidates.length,
        candidates: uniqueCandidates.slice(0, 8)
      });
    } else {
      noCandidate.push({
        ...base,
        reason: "No strict same-trade text candidate found"
      });
    }

    if (rejected.length) {
      rejectedCandidates.push({
        ...base,
        rejected: rejected.slice(0, 8)
      });
    }
  }
}

const touched = [...new Set(planned.map(row => row.slug))];

const report = {
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  dataPath,
  plannedReplacementCount: planned.length,
  plannedTradeCount: touched.length,
  ambiguousCount: ambiguous.length,
  noCandidateCount: noCandidate.length,
  rejectedCandidateRows: rejectedCandidates.length,
  planned,
  ambiguous,
  noCandidate,
  rejectedCandidates
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("");
console.log("STRICT ELLIPSIS SAME-TRADE TEXT RECOVERY DRY RUN");
console.log("=".repeat(80));
console.log(`planned safe replacements: ${planned.length}`);
console.log(`trades touched if applied: ${touched.length}`);
console.log(`ambiguous: ${ambiguous.length}`);
console.log(`no candidate: ${noCandidate.length}`);
console.log(`rows with rejected candidates: ${rejectedCandidates.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("Planned replacements:");
for (const row of planned.slice(0, 20)) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.date} | ${row.team}[${row.assetIndex}]`);
  console.log(`BEFORE: ${row.before}`);
  console.log(`AFTER : ${row.after}`);
  console.log(`evidence field: ${row.evidence[0] ? row.evidence[0].field : "none"}`);
}

console.log("");
console.log("First 10 rejected examples:");
for (const row of rejectedCandidates.slice(0, 10)) {
  console.log("-".repeat(80));
  console.log(`${row.slug} | ${row.id} | ${row.date} | ${row.team}[${row.assetIndex}]`);
  console.log(`BEFORE: ${row.before}`);
  for (const r of row.rejected.slice(0, 3)) {
    console.log(`REJECTED from ${r.field}: ${r.candidate}`);
  }
}
