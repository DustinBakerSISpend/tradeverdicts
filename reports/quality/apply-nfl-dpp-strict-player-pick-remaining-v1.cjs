const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");

const dataPath = path.join("src", "data", "nfl", "trades.json");
const reviewPath = path.join("reports", "quality", "nfl-d-player-pick-remaining-strict-review-v1.json");
const outTxt = path.join("reports", "quality", "nfl-dpp-strict-player-pick-remaining-apply-v1.txt");
const outJson = path.join("reports", "quality", "nfl-dpp-strict-player-pick-remaining-apply-v1.json");

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

function cloneAssetWithText(original, type, text) {
  const base = original && typeof original === "object" && !Array.isArray(original)
    ? { ...original }
    : {};

  base.type = type;
  base.asset = text;

  // Remove common display fields that could conflict with asset.
  delete base.text;
  delete base.name;
  delete base.label;
  delete base.description;
  delete base.value;
  delete base.title;

  return base;
}

function makePlayerAsset(bundleAsset, text) {
  return cloneAssetWithText(bundleAsset, "player", text);
}

function makePickAsset(bundleAsset, text) {
  return cloneAssetWithText(bundleAsset, "pick", text);
}

function summarize(asset, index) {
  return {
    index,
    type: typeOf(asset),
    text: textOf(asset)
  };
}

function currentMatches(bucket, text, excludeIndex = null) {
  return bucket
    .map((asset, index) => ({ index, asset, type: typeOf(asset), text: textOf(asset) }))
    .filter((entry) => (excludeIndex === null || entry.index !== excludeIndex) && norm(entry.text) === norm(text));
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const review = readJson(reviewPath);
const strictItems = Array.isArray(review.candidateStrict) ? review.candidateStrict : [];
const warningItems = Array.isArray(review.candidateWarning) ? review.candidateWarning : [];
const manualItems = Array.isArray(review.manual) ? review.manual : [];
const blockedItems = Array.isArray(review.blocked) ? review.blocked : [];

const allowedLanes = new Set([
  "DPP1_strict_remove_bundle_player_and_pick_already_exist",
  "DPP2_strict_split_bundle_create_missing_part_dedupe_existing",
  "DPP3_strict_split_player_pick_bundle"
]);

const result = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "APPLY" : "DRY-RUN",
  sourceReview: reviewPath,
  candidateStrictTotal: strictItems.length,
  candidateWarningExcluded: warningItems.length,
  manualExcluded: manualItems.length,
  blockedExcluded: blockedItems.length,
  plannedCandidates: 0,
  tradesScanned: trades.length,
  tradesTouched: 0,
  teamBucketsTouched: 0,
  bundlesRemovedOrReplaced: 0,
  playerAssetsCreated: 0,
  pickAssetsCreated: 0,
  standaloneAssetsCreated: 0,
  existingPlayerAssetsVerified: 0,
  existingPickAssetsVerified: 0,
  netAssetChange: 0,
  applied: false,
  errors: [],
  warnings: [],
  changes: []
};

for (const item of strictItems) {
  const change = {
    ordinal: item.ordinal,
    id: item.id,
    team: item.team,
    slug: item.slug,
    lane: item.lane,
    reason: item.reason,
    bundleText: item.bundleAsset ? item.bundleAsset.text : "",
    playerText: item.playerText,
    pickText: item.pickText,
    bundleIndex: null,
    existingPlayerIndexes: [],
    existingPickIndexes: [],
    createPlayer: false,
    createPick: false,
    assetsToInsert: [],
    beforeAssets: [],
    afterAssets: [],
    status: "pending",
    errors: [],
    warnings: []
  };

  if (!allowedLanes.has(item.lane)) {
    change.errors.push(`lane_not_allowed=${item.lane}`);
  }

  if (!change.bundleText || !change.playerText || !change.pickText) {
    change.errors.push("missing_bundle_player_or_pick_text");
  }

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

      const bundleMatches = currentMatches(bucket, change.bundleText, null);
      if (bundleMatches.length !== 1) {
        change.errors.push(`bundle_match_count_${bundleMatches.length}`);
      } else {
        const bundleMatch = bundleMatches[0];
        change.bundleIndex = bundleMatch.index;

        const playerMatches = currentMatches(bucket, change.playerText, change.bundleIndex);
        const pickMatches = currentMatches(bucket, change.pickText, change.bundleIndex);

        change.existingPlayerIndexes = playerMatches.map((x) => x.index);
        change.existingPickIndexes = pickMatches.map((x) => x.index);

        if (playerMatches.length > 1) change.errors.push(`player_match_count_${playerMatches.length}`);
        if (pickMatches.length > 1) change.errors.push(`pick_match_count_${pickMatches.length}`);

        if (playerMatches.some((x) => x.type !== "player")) {
          change.errors.push(`existing_player_match_not_player_type=${playerMatches.map((x) => x.type).join("|")}`);
        }

        if (pickMatches.some((x) => x.type !== "pick")) {
          change.errors.push(`existing_pick_match_not_pick_type=${pickMatches.map((x) => x.type).join("|")}`);
        }

        change.createPlayer = playerMatches.length === 0;
        change.createPick = pickMatches.length === 0;

        if (item.lane === "DPP1_strict_remove_bundle_player_and_pick_already_exist") {
          if (change.createPlayer || change.createPick) {
            change.errors.push("DPP1_expected_both_parts_existing");
          }
        }

        if (item.lane === "DPP2_strict_split_bundle_create_missing_part_dedupe_existing") {
          if (Number(change.createPlayer) + Number(change.createPick) !== 1) {
            change.errors.push("DPP2_expected_exactly_one_missing_part");
          }
        }

        if (item.lane === "DPP3_strict_split_player_pick_bundle") {
          if (!change.createPlayer || !change.createPick) {
            change.errors.push("DPP3_expected_both_parts_missing");
          }
        }

        if (change.errors.length === 0) {
          if (change.createPlayer) {
            change.assetsToInsert.push(makePlayerAsset(bundleMatch.asset, change.playerText));
          }
          if (change.createPick) {
            change.assetsToInsert.push(makePickAsset(bundleMatch.asset, change.pickText));
          }

          const afterBucket = [
            ...bucket.slice(0, change.bundleIndex),
            ...change.assetsToInsert,
            ...bucket.slice(change.bundleIndex + 1)
          ];

          change.afterAssets = afterBucket.map(summarize);
          change.status = "ready";
        }
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
result.plannedCandidates = readyChanges.length;

if (result.errors.length === 0) {
  result.bundlesRemovedOrReplaced = readyChanges.length;
  result.playerAssetsCreated = readyChanges.reduce((sum, change) => sum + Number(change.createPlayer), 0);
  result.pickAssetsCreated = readyChanges.reduce((sum, change) => sum + Number(change.createPick), 0);
  result.standaloneAssetsCreated = result.playerAssetsCreated + result.pickAssetsCreated;
  result.existingPlayerAssetsVerified = readyChanges.reduce((sum, change) => sum + change.existingPlayerIndexes.length, 0);
  result.existingPickAssetsVerified = readyChanges.reduce((sum, change) => sum + change.existingPickIndexes.length, 0);
  result.netAssetChange = result.standaloneAssetsCreated - result.bundlesRemovedOrReplaced;
  result.tradesTouched = new Set(readyChanges.map((change) => change.id)).size;
  result.teamBucketsTouched = new Set(readyChanges.map((change) => `${change.id}|||${change.team}`)).size;

  if (apply) {
    const backupPath = dataPath + `.dpp-strict-player-pick-remaining-backup-${Date.now()}.bak`;
    fs.copyFileSync(dataPath, backupPath);

    // Apply descending by bucket index to avoid shifting within same bucket.
    const groups = new Map();

    for (const change of readyChanges) {
      const key = `${change.id}|||${change.team}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(change);
    }

    for (const [key, changes] of groups) {
      const [id, team] = key.split("|||");
      const trade = byId.get(id);
      const bucket = trade.assetsReceived[team];

      changes
        .sort((a, b) => b.bundleIndex - a.bundleIndex)
        .forEach((change) => {
          bucket.splice(change.bundleIndex, 1, ...change.assetsToInsert);
        });

      appendQaNote(trade, "DPP cleanup: split or removed strict player-plus-pick bundle already represented by standalone assets.");
    }

    writeJson(dataPath, setTrades(raw, trades));
    result.applied = true;
    result.backupPath = backupPath;
  }
}

const lines = [];
lines.push("# NFL DPP Strict Player+Pick Remaining Apply v1");
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
lines.push(`- bundlesRemovedOrReplaced: ${result.bundlesRemovedOrReplaced}`);
lines.push(`- playerAssetsCreated: ${result.playerAssetsCreated}`);
lines.push(`- pickAssetsCreated: ${result.pickAssetsCreated}`);
lines.push(`- standaloneAssetsCreated: ${result.standaloneAssetsCreated}`);
lines.push(`- existingPlayerAssetsVerified: ${result.existingPlayerAssetsVerified}`);
lines.push(`- existingPickAssetsVerified: ${result.existingPickAssetsVerified}`);
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
  lines.push(`- lane: ${change.lane}`);
  lines.push(`- reason: ${change.reason}`);
  lines.push(`- bundleIndex: ${change.bundleIndex}`);
  lines.push(`- removeOrReplaceBundle: ${change.bundleText}`);
  lines.push(`- playerText: ${change.playerText}`);
  lines.push(`- pickText: ${change.pickText}`);
  lines.push(`- createPlayer: ${change.createPlayer}`);
  lines.push(`- createPick: ${change.createPick}`);
  lines.push(`- existingPlayerIndexes: ${change.existingPlayerIndexes.join(", ") || "none"}`);
  lines.push(`- existingPickIndexes: ${change.existingPickIndexes.join(", ") || "none"}`);
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify(result, null, 2) + "\n");

console.log(lines.join("\n"));

if (result.errors.length > 0) {
  console.error("\nSTOP: Errors found. No data was written.");
  process.exit(1);
}
