const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");

const dataPath = path.join("src", "data", "nfl", "trades.json");
const reviewPath = path.join("reports", "quality", "nfl-cex-candidate-pick-parts-strict-review-v1.json");
const outTxt = path.join("reports", "quality", "nfl-cex-strict-ready-pick-parts-apply-v1.txt");
const outJson = path.join("reports", "quality", "nfl-cex-strict-ready-pick-parts-apply-v1.json");

const allowedSublanes = new Set([
  "CEXS1_punct_clean_no_explanatory_flags",
  "CEXS3_punct_subsequently_traded_to_only",
  "CEXS4_and_subsequently_traded_to_only"
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

function getTrades(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trades)) return raw.trades;
  throw new Error("Could not find trades array.");
}

function setTrades(raw, trades) {
  if (Array.isArray(raw)) return trades;
  raw.trades = trades;
  return raw;
}

function textOf(asset) {
  if (asset == null) return "";
  if (typeof asset === "string") return asset;
  if (typeof asset !== "object") return String(asset);
  return asset.asset || asset.name || asset.label || asset.description || asset.value || asset.title || "";
}

function typeOf(asset) {
  if (asset && typeof asset === "object" && asset.type) return String(asset.type);
  return "";
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[â€“â€”]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForDupe(s) {
  return norm(s)
    .replace(/[;:|()[\]{}.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function balancedParens(s) {
  let depth = 0;
  for (const ch of String(s || "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\s*\d{1,3}\b/i.test(String(s || ""));
}

function startsLikePick(s) {
  return /^\s*(?:\d{4}|draft pick|conditional|future|past|undisclosed|unspecified)/i.test(String(s || ""));
}

function countPickMentions(s) {
  const raw = String(s || "");
  const n = norm(raw);

  const yearRoundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)[-\s]+round\s+pick\b/g) || [];
  const noYearRoundPickMatches = n.match(/\b(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)[-\s]+round\s+pick\b/g) || [];
  const draftPickParentheticalMatches = raw.match(/\bdraft pick\s*\(/gi) || [];
  const hashMatches = raw.match(/#\s*\d{1,3}\b/g) || [];
  const overallMatches = raw.match(/\b\d{1,3}(?:st|nd|rd|th)\s+overall\b/gi) || [];

  return Math.max(
    yearRoundPickMatches.length,
    noYearRoundPickMatches.length,
    draftPickParentheticalMatches.length,
    hashMatches.length,
    overallMatches.length
  );
}

function hardRiskFlags(s) {
  const raw = String(s || "");
  const risks = [];

  if (!balancedParens(raw)) risks.push("unbalanced_parentheses");
  if (/\band\/or\b/i.test(raw)) risks.push("and_or");
  if (/-\s*OR\s*-/i.test(raw)) risks.push("dash_or");
  if (/\bor\b/i.test(raw)) risks.push("or_word");
  if (/\s\/\s/.test(raw)) risks.push("slash_alternative");
  if (/\b(?:cash|future considerations|past considerations|considerations|player to be named later|ptbnl|conditional on|if )\b/i.test(raw)) risks.push("cash_consideration_ptbnl_conditional");

  return [...new Set(risks)];
}

function partStrictCheck(part) {
  const text = String(part || "").trim();
  const errors = [];

  const risks = hardRiskFlags(text);
  if (risks.length > 0) errors.push(`hardRisk=${risks.join("|")}`);
  if (!startsLikePick(text)) errors.push("does_not_start_like_pick");
  if (!hasPickSignal(text)) errors.push("missing_pick_signal");

  const picks = countPickMentions(text);
  if (picks !== 1) errors.push(`pickMentions=${picks}`);

  return {
    text,
    ok: errors.length === 0,
    errors,
    risks,
    pickMentions: picks
  };
}

function makePickAsset(originalAsset, partText) {
  if (originalAsset && typeof originalAsset === "object" && !Array.isArray(originalAsset)) {
    return {
      ...originalAsset,
      type: "pick",
      asset: partText
    };
  }

  return {
    type: "pick",
    asset: partText
  };
}

function summarize(asset, index) {
  return {
    index,
    type: typeOf(asset),
    text: textOf(asset)
  };
}

function appendQaNote(trade, note) {
  const existing = String(trade.qaNotes || "");
  if (existing.includes(note)) return;
  trade.qaNotes = existing ? `${existing} | ${note}` : note;
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const review = readJson(reviewPath);
const reviewed = Array.isArray(review.reviewed) ? review.reviewed : [];

const readyNoWarnings = reviewed.filter((item) => item.strictClass === "ready_no_warnings");
const readyWithWarnings = reviewed.filter((item) => item.strictClass === "ready_with_warnings");
const blocked = reviewed.filter((item) => item.strictClass === "blocked");

const targetItems = readyNoWarnings.filter((item) => allowedSublanes.has(item.sublane));
const excludedReadyNoWarnings = readyNoWarnings.filter((item) => !allowedSublanes.has(item.sublane));

const result = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "APPLY" : "DRY-RUN",
  sourceReview: reviewPath,
  allowedSublanes: [...allowedSublanes],
  readyNoWarningsTotal: readyNoWarnings.length,
  readyWithWarningsExcluded: readyWithWarnings.length,
  blockedExcluded: blocked.length,
  readyNoWarningsExcludedBySublane: excludedReadyNoWarnings.length,
  plannedCandidates: targetItems.length,
  tradesScanned: trades.length,
  tradesTouched: 0,
  teamBucketsTouched: 0,
  bundledAssetsReplaced: 0,
  standalonePickAssetsCreated: 0,
  netAssetIncrease: 0,
  applied: false,
  errors: [],
  warnings: [],
  changes: [],
  excludedReadyNoWarnings
};

if (targetItems.length === 0) {
  result.errors.push("No target candidates found. Refusing to run.");
}

for (const item of targetItems) {
  const change = {
    ordinal: item.ordinal,
    id: item.id,
    team: item.team,
    slug: item.slug,
    sublane: item.sublane,
    sourceLane: item.sourceLane,
    assetIndex: item.assetIndex,
    before: item.before,
    parts: item.parts || [],
    status: "pending",
    errors: [],
    warnings: [],
    beforeAssets: [],
    afterAssetsPreview: []
  };

  const trade = byId.get(item.id);

  if (!trade) {
    change.errors.push("trade_not_found");
  } else if (trade.slug !== item.slug) {
    change.errors.push(`slug_mismatch_current=${trade.slug}`);
  } else {
    const bucket = trade.assetsReceived && trade.assetsReceived[item.team];

    if (!Array.isArray(bucket)) {
      change.errors.push("team_bucket_missing_or_not_array");
    } else if (item.assetIndex < 0 || item.assetIndex >= bucket.length) {
      change.errors.push(`asset_index_out_of_range_currentLength=${bucket.length}`);
    } else {
      change.beforeAssets = bucket.map(summarize);

      const currentAsset = bucket[item.assetIndex];
      const currentText = textOf(currentAsset);

      if (norm(currentText) !== norm(item.before)) {
        change.errors.push(`asset_text_mismatch_current=${currentText}`);
      }

      const parts = Array.isArray(item.parts) ? item.parts.map((part) => String(part || "").trim()).filter(Boolean) : [];

      if (parts.length < 2 || parts.length > 4) {
        change.errors.push(`unexpected_part_count=${parts.length}`);
      }

      const partKeys = new Set();

      for (const part of parts) {
        const check = partStrictCheck(part);
        if (!check.ok) change.errors.push(`unsafe_part=[${part}] ${check.errors.join("|")}`);

        const key = normalizeForDupe(part);
        if (partKeys.has(key)) change.errors.push(`duplicate_proposed_part=${part}`);
        partKeys.add(key);
      }

      const otherAssetTexts = new Set(bucket
        .filter((_, index) => index !== item.assetIndex)
        .map((asset) => normalizeForDupe(textOf(asset))));

      const duplicateAgainstExisting = parts.filter((part) => otherAssetTexts.has(normalizeForDupe(part)));

      if (duplicateAgainstExisting.length > 0) {
        change.errors.push(`split_part_already_exists_elsewhere=${duplicateAgainstExisting.join(" | ")}`);
      }

      if (change.errors.length === 0) {
        const afterAssets = parts.map((part) => makePickAsset(currentAsset, part));
        change.afterAssetsPreview = afterAssets.map(summarize);
        change.status = "ready";
        change.afterAssets = afterAssets;
      }
    }
  }

  if (change.errors.length > 0) {
    result.errors.push(`${item.id}/${item.team}/assetIndex ${item.assetIndex}: ${change.errors.join("; ")}`);
  }

  if (change.warnings.length > 0) {
    result.warnings.push(`${item.id}/${item.team}/assetIndex ${item.assetIndex}: ${change.warnings.join("; ")}`);
  }

  result.changes.push(change);
}

const readyChanges = result.changes.filter((change) => change.status === "ready");

if (result.errors.length === 0) {
  result.bundledAssetsReplaced = readyChanges.length;
  result.standalonePickAssetsCreated = readyChanges.reduce((sum, change) => sum + change.parts.length, 0);
  result.netAssetIncrease = result.standalonePickAssetsCreated - result.bundledAssetsReplaced;
  result.tradesTouched = new Set(readyChanges.map((change) => change.id)).size;
  result.teamBucketsTouched = new Set(readyChanges.map((change) => `${change.id}|||${change.team}`)).size;

  if (apply) {
    const backupPath = dataPath + `.cex-strict-ready-pick-parts-backup-${Date.now()}.bak`;
    fs.copyFileSync(dataPath, backupPath);

    const changeGroups = new Map();

    for (const change of readyChanges) {
      const key = `${change.id}|||${change.team}`;
      if (!changeGroups.has(key)) changeGroups.set(key, []);
      changeGroups.get(key).push(change);
    }

    for (const [key, changes] of changeGroups) {
      const [id, team] = key.split("|||");
      const trade = byId.get(id);
      const bucket = trade.assetsReceived[team];

      changes.sort((a, b) => b.assetIndex - a.assetIndex);

      for (const change of changes) {
        bucket.splice(change.assetIndex, 1, ...change.afterAssets);
      }

      appendQaNote(trade, "CEX cleanup: split strict ready explanatory multi-pick bundle assets into standalone pick assets.");
    }

    writeJson(dataPath, setTrades(raw, trades));
    result.applied = true;
    result.backupPath = backupPath;
  }
}

const lines = [];
lines.push("# NFL CEX Strict Ready Pick Parts Apply v1");
lines.push(`Generated: ${result.generatedAt}`);
lines.push(`Mode: ${result.mode}`);
lines.push("");
lines.push("## Summary");
lines.push(`- sourceReview: ${result.sourceReview}`);
lines.push(`- readyNoWarningsTotal: ${result.readyNoWarningsTotal}`);
lines.push(`- readyWithWarningsExcluded: ${result.readyWithWarningsExcluded}`);
lines.push(`- blockedExcluded: ${result.blockedExcluded}`);
lines.push(`- readyNoWarningsExcludedBySublane: ${result.readyNoWarningsExcludedBySublane}`);
lines.push(`- plannedCandidates: ${result.plannedCandidates}`);
lines.push(`- tradesScanned: ${result.tradesScanned}`);
lines.push(`- tradesTouched: ${result.tradesTouched}`);
lines.push(`- teamBucketsTouched: ${result.teamBucketsTouched}`);
lines.push(`- bundledAssetsReplaced: ${result.bundledAssetsReplaced}`);
lines.push(`- standalonePickAssetsCreated: ${result.standalonePickAssetsCreated}`);
lines.push(`- netAssetIncrease: ${result.netAssetIncrease}`);
lines.push(`- applied: ${result.applied}`);
lines.push(`- errors: ${result.errors.length}`);
lines.push(`- warnings: ${result.warnings.length}`);
if (result.backupPath) lines.push(`- backupPath: ${result.backupPath}`);
lines.push("");
lines.push("## Allowed Sublanes");
for (const sublane of result.allowedSublanes) lines.push(`- ${sublane}`);
lines.push("");
lines.push("## Excluded Ready No-Warnings By Sublane");
if (result.excludedReadyNoWarnings.length === 0) {
  lines.push("- none");
} else {
  for (const item of result.excludedReadyNoWarnings) {
    lines.push(`- ${item.id} / ${item.team} / ${item.sublane} / ${item.before}`);
  }
}
lines.push("");
lines.push("## Errors");
if (result.errors.length === 0) lines.push("- none");
for (const error of result.errors.slice(0, 300)) lines.push(`- ${error}`);
if (result.errors.length > 300) lines.push(`- ... ${result.errors.length - 300} more`);
lines.push("");
lines.push("## Warnings");
if (result.warnings.length === 0) lines.push("- none");
for (const warning of result.warnings.slice(0, 300)) lines.push(`- ${warning}`);
if (result.warnings.length > 300) lines.push(`- ... ${result.warnings.length - 300} more`);
lines.push("");
lines.push("## Change Samples");
for (const change of readyChanges.slice(0, 140)) {
  lines.push("");
  lines.push(`### ${change.id} / ${change.team}`);
  lines.push(`- sublane: ${change.sublane}`);
  lines.push(`- slug: ${change.slug}`);
  lines.push(`- assetIndex: ${change.assetIndex}`);
  lines.push(`- before: ${change.before}`);
  for (const part of change.parts) lines.push(`- after: ${part}`);
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify(result, null, 2) + "\n");

console.log(lines.join("\n"));

if (result.errors.length > 0) {
  console.error("\nSTOP: Errors found. No data was written.");
  process.exit(1);
}
