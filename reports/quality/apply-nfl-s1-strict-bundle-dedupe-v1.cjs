const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");

const dataPath = path.join("src", "data", "nfl", "trades.json");
const reviewPath = path.join("reports", "quality", "nfl-s1-report-bundle-dedupe-review-v1.json");
const outTxt = path.join("reports", "quality", "nfl-s1-strict-bundle-dedupe-apply-v1.txt");
const outJson = path.join("reports", "quality", "nfl-s1-strict-bundle-dedupe-apply-v1.json");

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

function appendQaNote(trade, note) {
  const existing = String(trade.qaNotes || "");
  if (existing.includes(note)) return;
  trade.qaNotes = existing ? `${existing} | ${note}` : note;
}

function summarize(asset, index) {
  return {
    index,
    type: typeOf(asset),
    text: textOf(asset)
  };
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const review = readJson(reviewPath);
const strictItems = Array.isArray(review.candidateStrict) ? review.candidateStrict : [];
const warningItems = Array.isArray(review.candidateWarning) ? review.candidateWarning : [];
const manualItems = Array.isArray(review.manual) ? review.manual : [];
const blockedItems = Array.isArray(review.blocked) ? review.blocked : [];

const result = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "APPLY" : "DRY-RUN",
  sourceReview: reviewPath,
  candidateStrictTotal: strictItems.length,
  candidateWarningExcluded: warningItems.length,
  manualExcluded: manualItems.length,
  blockedExcluded: blockedItems.length,
  plannedCandidates: strictItems.length,
  tradesScanned: trades.length,
  tradesTouched: 0,
  teamBucketsTouched: 0,
  duplicateBundleAssetsRemoved: 0,
  standalonePickAssetsVerifiedKept: 0,
  netAssetChange: 0,
  applied: false,
  errors: [],
  warnings: [],
  changes: []
};

if (strictItems.length === 0) {
  result.errors.push("No candidate_strict items found. Refusing to run.");
}

for (const item of strictItems) {
  const change = {
    ordinal: item.ordinal,
    id: item.id,
    team: item.team,
    slug: item.slug,
    lane: item.lane,
    sourceBucket: item.sourceBucket,
    reason: item.reason,
    removeBundleTexts: (item.removalCandidates || []).map((x) => x.text),
    keepStandaloneTexts: (item.keepAssets || []).map((x) => x.text),
    removeIndexes: [],
    keepIndexes: [],
    beforeAssets: [],
    afterAssets: [],
    status: "pending",
    errors: [],
    warnings: []
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
    } else {
      change.beforeAssets = bucket.map(summarize);

      if (change.removeBundleTexts.length !== 1) {
        change.errors.push(`expected_one_bundle_remove_text_found=${change.removeBundleTexts.length}`);
      }

      if (change.keepStandaloneTexts.length < 2) {
        change.errors.push(`expected_at_least_two_keep_texts_found=${change.keepStandaloneTexts.length}`);
      }

      for (const removeText of change.removeBundleTexts) {
        const matches = bucket
          .map((asset, index) => ({ index, asset, text: textOf(asset), type: typeOf(asset) }))
          .filter((entry) => norm(entry.text) === norm(removeText));

        if (matches.length !== 1) {
          change.errors.push(`remove_bundle_match_count_${matches.length}=[${removeText}]`);
        } else {
          const match = matches[0];
          if (match.type !== "pick") change.errors.push(`remove_bundle_not_pick_type=${match.type} text=[${removeText}]`);
          change.removeIndexes.push(match.index);
        }
      }

      for (const keepText of change.keepStandaloneTexts) {
        const matches = bucket
          .map((asset, index) => ({ index, asset, text: textOf(asset), type: typeOf(asset) }))
          .filter((entry) => norm(entry.text) === norm(keepText));

        if (matches.length !== 1) {
          change.errors.push(`keep_standalone_match_count_${matches.length}=[${keepText}]`);
        } else {
          const match = matches[0];
          if (match.type !== "pick") change.errors.push(`keep_standalone_not_pick_type=${match.type} text=[${keepText}]`);
          change.keepIndexes.push(match.index);
        }
      }

      const removeSet = new Set(change.removeIndexes);
      for (const keepIndex of change.keepIndexes) {
        if (removeSet.has(keepIndex)) change.errors.push(`remove_index_also_keep_index=${keepIndex}`);
      }

      if (change.errors.length === 0) {
        const afterBucket = bucket.filter((_, index) => !removeSet.has(index));
        change.afterAssets = afterBucket.map(summarize);
        change.status = "ready";
      }
    }
  }

  if (change.errors.length > 0) {
    result.errors.push(`${item.id}/${item.team}: ${change.errors.join("; ")}`);
  }

  if (change.warnings.length > 0) {
    result.warnings.push(`${item.id}/${item.team}: ${change.warnings.join("; ")}`);
  }

  result.changes.push(change);
}

const readyChanges = result.changes.filter((change) => change.status === "ready");

if (result.errors.length === 0) {
  result.duplicateBundleAssetsRemoved = readyChanges.reduce((sum, change) => sum + change.removeIndexes.length, 0);
  result.standalonePickAssetsVerifiedKept = readyChanges.reduce((sum, change) => sum + change.keepIndexes.length, 0);
  result.netAssetChange = -1 * result.duplicateBundleAssetsRemoved;
  result.tradesTouched = new Set(readyChanges.map((change) => change.id)).size;
  result.teamBucketsTouched = new Set(readyChanges.map((change) => `${change.id}|||${change.team}`)).size;

  if (apply) {
    const backupPath = dataPath + `.s1-strict-bundle-dedupe-backup-${Date.now()}.bak`;
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

      const removeIndexes = [...new Set(changes.flatMap((change) => change.removeIndexes))].sort((a, b) => b - a);

      for (const index of removeIndexes) {
        bucket.splice(index, 1);
      }

      appendQaNote(trade, "S1 cleanup: removed duplicate combined pick bundle already represented by standalone pick assets.");
    }

    writeJson(dataPath, setTrades(raw, trades));
    result.applied = true;
    result.backupPath = backupPath;
  }
}

const lines = [];
lines.push("# NFL S1 Strict Bundle Dedupe Apply v1");
lines.push(`Generated: ${result.generatedAt}`);
lines.push(`Mode: ${result.mode}`);
lines.push("");
lines.push("## Summary");
lines.push(`- sourceReview: ${result.sourceReview}`);
lines.push(`- candidateStrictTotal: ${result.candidateStrictTotal}`);
lines.push(`- candidateWarningExcluded: ${result.candidateWarningExcluded}`);
lines.push(`- manualExcluded: ${result.manualExcluded}`);
lines.push(`- blockedExcluded: ${result.blockedExcluded}`);
lines.push(`- plannedCandidates: ${result.plannedCandidates}`);
lines.push(`- tradesScanned: ${result.tradesScanned}`);
lines.push(`- tradesTouched: ${result.tradesTouched}`);
lines.push(`- teamBucketsTouched: ${result.teamBucketsTouched}`);
lines.push(`- duplicateBundleAssetsRemoved: ${result.duplicateBundleAssetsRemoved}`);
lines.push(`- standalonePickAssetsVerifiedKept: ${result.standalonePickAssetsVerifiedKept}`);
lines.push(`- netAssetChange: ${result.netAssetChange}`);
lines.push(`- applied: ${result.applied}`);
lines.push(`- errors: ${result.errors.length}`);
lines.push(`- warnings: ${result.warnings.length}`);
if (result.backupPath) lines.push(`- backupPath: ${result.backupPath}`);
lines.push("");
lines.push("## Errors");
if (result.errors.length === 0) lines.push("- none");
for (const error of result.errors) lines.push(`- ${error}`);
lines.push("");
lines.push("## Warnings");
if (result.warnings.length === 0) lines.push("- none");
for (const warning of result.warnings) lines.push(`- ${warning}`);
lines.push("");
lines.push("## Change Details");
for (const change of readyChanges) {
  lines.push("");
  lines.push(`### ${change.id} / ${change.team}`);
  lines.push(`- slug: ${change.slug}`);
  lines.push(`- sourceBucket: ${change.sourceBucket}`);
  lines.push(`- reason: ${change.reason}`);
  for (const removeText of change.removeBundleTexts) lines.push(`- removeBundle: ${removeText}`);
  for (const keepText of change.keepStandaloneTexts) lines.push(`- keepStandalone: ${keepText}`);
  lines.push(`- removeIndexes: ${change.removeIndexes.join(", ")}`);
  lines.push(`- keepIndexes: ${change.keepIndexes.join(", ")}`);
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify(result, null, 2) + "\n");

console.log(lines.join("\n"));

if (result.errors.length > 0) {
  console.error("\nSTOP: Errors found. No data was written.");
  process.exit(1);
}
