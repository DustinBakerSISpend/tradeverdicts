const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");

const dataPath = path.join("src", "data", "nfl", "trades.json");
const reviewPath = path.join("reports", "quality", "nfl-c2-and-delimited-pick-list-review-v1.json");
const outTxt = path.join("reports", "quality", "nfl-c2-and-delimited-pick-list-apply-v1.txt");
const outJson = path.join("reports", "quality", "nfl-c2-and-delimited-pick-list-apply-v1.json");

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
    .replace(/[;:|()[\]{}.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countPickMentions(s) {
  const raw = String(s || "");
  const n = norm(raw);
  const roundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b/g) || [];
  const hashMatches = raw.match(/#\s*\d{1,3}\b/g) || [];
  const overallMatches = raw.match(/\b\d{1,3}(?:st|nd|rd|th)\s+overall\b/gi) || [];
  return Math.max(roundPickMatches.length, hashMatches.length, overallMatches.length);
}

function hasRiskText(s) {
  const raw = String(s || "");
  const risks = [];
  if (/\band\/or\b/i.test(raw)) risks.push("and_or");
  if (/-\s*OR\s*-/i.test(raw)) risks.push("dash_or");
  if (/\bor\b/i.test(raw)) risks.push("or_word");
  if (/\s\/\s/.test(raw)) risks.push("slash");
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) risks.push("explanatory");
  if (/\b(?:cash|future considerations|past considerations|considerations|player to be named later|ptbnl|conditional on|if )\b/i.test(raw)) risks.push("cash_consideration_ptbnl_conditional");
  if (/[([][^)\]]*$/.test(raw)) risks.push("unclosed_paren_or_bracket");
  if (/^[^([]*[)\]]/.test(raw)) risks.push("leading_close_paren_or_bracket");
  return risks;
}

function partLooksSafe(part) {
  const text = String(part || "").trim();
  const risks = hasRiskText(text);
  const pickMentions = countPickMentions(text);
  const startsLikePick = /^\s*(?:\d{4}|draft pick|conditional|future)/i.test(text);
  const hasPickSignal = /\bpick\b|\bround\b|\boverall\b|#\d{1,3}\b/i.test(text);

  return risks.length === 0 && pickMentions === 1 && startsLikePick && hasPickSignal;
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

function appendQaNote(trade, note) {
  const existing = String(trade.qaNotes || "");
  if (existing.includes(note)) return;
  trade.qaNotes = existing ? `${existing} | ${note}` : note;
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const review = readJson(reviewPath);

const reviewed = Array.isArray(review.reviewed) ? review.reviewed : [];
const clean = reviewed.filter((item) => item.reviewClass === "C2A_clean_review_candidate");

const result = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "APPLY" : "DRY-RUN",
  sourceReview: reviewPath,
  plannedCandidates: clean.length,
  tradesScanned: trades.length,
  tradesTouched: 0,
  teamBucketsTouched: 0,
  bundledAssetsReplaced: 0,
  standalonePickAssetsCreated: 0,
  netAssetIncrease: 0,
  applied: false,
  errors: [],
  warnings: [],
  changes: []
};

const byId = new Map(trades.map((trade) => [trade.id, trade]));
const touchedTrades = new Set();
const touchedBuckets = new Set();

if (!Array.isArray(reviewed) || reviewed.length === 0) {
  result.errors.push("Review JSON did not contain reviewed candidates. Re-run review-c2-and-delimited-pick-list-v1.ps1 first.");
}

if (clean.length === 0) {
  result.errors.push("No C2A clean candidates found. Refusing to run.");
}

for (const item of clean) {
  const change = {
    ordinal: item.ordinal,
    id: item.id,
    slug: item.slug,
    team: item.team,
    sourceBucket: item.sourceBucket,
    assetIndex: item.assetIndex,
    before: item.before,
    proposedParts: item.proposedParts,
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
    } else if (item.assetIndex < 0 || item.assetIndex >= bucket.length) {
      change.errors.push(`asset_index_out_of_range_currentLength=${bucket.length}`);
    } else {
      const currentAsset = bucket[item.assetIndex];
      const currentText = textOf(currentAsset);

      if (norm(currentText) !== norm(item.before)) {
        change.errors.push(`asset_text_mismatch_current=${currentText}`);
      }

      const parts = Array.isArray(item.proposedParts) ? item.proposedParts.map((x) => String(x || "").trim()).filter(Boolean) : [];

      if (parts.length !== 2) {
        change.errors.push(`expected_two_parts_found_${parts.length}`);
      }

      for (const part of parts) {
        if (!partLooksSafe(part)) {
          change.errors.push(`unsafe_part=${part}`);
        }
      }

      if (new Set(parts.map(normalizeForDupe)).size !== parts.length) {
        change.errors.push("duplicate_split_parts");
      }

      const otherAssets = bucket.filter((_, idx) => idx !== item.assetIndex);
      const otherAssetTexts = new Set(otherAssets.map((asset) => normalizeForDupe(textOf(asset))));

      const duplicateAgainstExisting = parts.filter((part) => otherAssetTexts.has(normalizeForDupe(part)));
      if (duplicateAgainstExisting.length > 0) {
        change.warnings.push(`split_part_already_exists_elsewhere=${duplicateAgainstExisting.join(" | ")}`);
      }

      if (change.errors.length === 0) {
        change.status = "ready";
        change.beforeAsset = currentAsset;
        change.afterAssets = parts.map((part) => makePickAsset(currentAsset, part));
      }
    }
  }

  if (change.errors.length > 0) result.errors.push(`${item.id}/${item.team}/assetIndex ${item.assetIndex}: ${change.errors.join("; ")}`);
  if (change.warnings.length > 0) result.warnings.push(`${item.id}/${item.team}/assetIndex ${item.assetIndex}: ${change.warnings.join("; ")}`);

  result.changes.push(change);
}

const readyChanges = result.changes.filter((change) => change.status === "ready");

if (result.errors.length === 0) {
  result.bundledAssetsReplaced = readyChanges.length;
  result.standalonePickAssetsCreated = readyChanges.reduce((sum, change) => sum + change.afterAssets.length, 0);
  result.netAssetIncrease = result.standalonePickAssetsCreated - result.bundledAssetsReplaced;

  for (const change of readyChanges) {
    touchedTrades.add(change.id);
    touchedBuckets.add(`${change.id}|||${change.team}`);
  }

  result.tradesTouched = touchedTrades.size;
  result.teamBucketsTouched = touchedBuckets.size;

  if (apply) {
    const backupPath = dataPath + `.c2-and-delimited-pick-list-backup-${Date.now()}.bak`;
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

      appendQaNote(trade, "C2 cleanup: split clean and-delimited multi-pick bundle assets into standalone pick assets.");
    }

    writeJson(dataPath, setTrades(raw, trades));
    result.applied = true;
    result.backupPath = backupPath;
  }
}

const lines = [];
lines.push("# NFL C2 And-Delimited Pick List Apply v1");
lines.push(`Generated: ${result.generatedAt}`);
lines.push(`Mode: ${result.mode}`);
lines.push("");
lines.push("## Summary");
lines.push(`- sourceReview: ${result.sourceReview}`);
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
lines.push("## Expected Effect");
lines.push("- Each ready C2 candidate replaces one bundled pick-list asset with two standalone pick assets.");
lines.push("- No player assets, cash assets, PTBNL assets, OR alternatives, slash alternatives, or explanatory/conditional clauses are targeted.");
lines.push("");
lines.push("## Errors");
if (result.errors.length === 0) lines.push("- none");
for (const error of result.errors.slice(0, 200)) lines.push(`- ${error}`);
if (result.errors.length > 200) lines.push(`- ... ${result.errors.length - 200} more`);
lines.push("");
lines.push("## Warnings");
if (result.warnings.length === 0) lines.push("- none");
for (const warning of result.warnings.slice(0, 200)) lines.push(`- ${warning}`);
if (result.warnings.length > 200) lines.push(`- ... ${result.warnings.length - 200} more`);
lines.push("");
lines.push("## Change Samples");
for (const change of readyChanges.slice(0, 120)) {
  lines.push("");
  lines.push(`### ${change.id} / ${change.team}`);
  lines.push(`- slug: ${change.slug}`);
  lines.push(`- assetIndex: ${change.assetIndex}`);
  lines.push(`- before: ${change.before}`);
  for (const part of change.proposedParts) lines.push(`- after: ${part}`);
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify(result, null, 2) + "\n");

console.log(lines.join("\n"));

if (result.errors.length > 0) {
  console.error("\nSTOP: Errors found. No data was written.");
  process.exit(1);
}
