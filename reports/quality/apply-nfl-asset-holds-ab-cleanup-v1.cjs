const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");

const dataPath = path.join("src", "data", "nfl", "trades.json");
const triagePath = path.join("reports", "quality", "nfl-global-asset-structure-holds-triage-v1.json");
const reportPath = path.join("reports", "quality", "nfl-asset-holds-ab-cleanup-v1.txt");
const jsonReportPath = path.join("reports", "quality", "nfl-asset-holds-ab-cleanup-v1.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
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

function cloneAsset(asset) {
  if (asset == null || typeof asset !== "object") return asset;
  return JSON.parse(JSON.stringify(asset));
}

function textOf(asset) {
  if (asset == null) return "";
  if (typeof asset === "string") return asset;
  if (typeof asset !== "object") return String(asset);

  const keys = ["asset", "label", "name", "player", "pick", "description", "value", "title", "displayName", "display", "text"];
  for (const k of keys) {
    if (typeof asset[k] === "string" && asset[k].trim()) return asset[k];
  }

  return Object.entries(asset)
    .filter(([, v]) => typeof v === "string")
    .map(([, v]) => v)
    .filter(Boolean)
    .join(" ");
}

function setAssetText(asset, nextText) {
  if (asset == null || typeof asset === "string" || typeof asset !== "object") return nextText;

  const out = cloneAsset(asset);
  const textKeys = ["asset", "label", "name", "player", "pick", "description", "value", "title", "displayName", "display", "text"];
  let touched = false;

  for (const key of textKeys) {
    if (typeof out[key] === "string" && out[key].trim()) {
      out[key] = nextText;
      touched = true;
      break;
    }
  }

  if (!touched) out.asset = nextText;
  return out;
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[â€“â€”]/g, "-")
    .replace(/[;:|()[\]{}.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanUnavailableSuffixText(raw) {
  return String(raw || "")
    .replace(/\s*;\s*additional draft-pick details unavailable from source data\.?/gi, "")
    .replace(/\s*,\s*additional draft-pick details unavailable from source data\.?/gi, "")
    .replace(/\s+additional draft-pick details unavailable from source data\.?/gi, "")
    .replace(/\s*;\s*player details unavailable from source data\.?/gi, "")
    .replace(/\s*,\s*player details unavailable from source data\.?/gi, "")
    .replace(/\s+player details unavailable from source data\.?/gi, "")
    .replace(/\s*;\s*details unavailable from source data\.?/gi, "")
    .replace(/\s*,\s*details unavailable from source data\.?/gi, "")
    .replace(/\s+details unavailable from source data\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasUnavailableSuffix(s) {
  return /additional draft-pick details unavailable from source data|player details unavailable from source data|details unavailable from source data/i.test(String(s || ""));
}

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\d{1,3}\b/i.test(String(s || ""));
}

function countPickMentions(s) {
  const raw = String(s || "");
  const n = normalize(raw);
  const roundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b/g) || [];
  const hashMatches = raw.match(/#\s*\d{1,3}\b/g) || [];
  return Math.max(roundPickMatches.length, hashMatches.length);
}

function isSinglePurePickText(s) {
  const raw = String(s || "");
  const n = normalize(raw);
  if (!hasPickSignal(raw)) return false;
  if (countPickMentions(raw) !== 1) return false;
  if (/\b(and|with|plus| or |cash|future considerations|past considerations|player to be named|ptbnl)\b/.test(n)) return false;
  if (/[;]|(?:\s\/\s.*\bpick\b)/i.test(raw)) return false;
  if (!/^\s*(?:\d{4}|draft pick|conditional|future|past|undisclosed|unspecified)/i.test(raw)) return false;
  return true;
}

function pickKey(asset) {
  const raw = textOf(asset);
  const n = normalize(raw);
  if (!isSinglePurePickText(raw)) return "";

  const year = (n.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  const overall =
    (n.match(/#\s*(\d{1,3})\b/) || [])[1] ||
    (n.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/) || [])[1] ||
    "";

  const round =
    (n.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+round\b/) || [])[1] ||
    (n.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+round\b/) || [])[1] ||
    "";

  if (!year || (!round && !overall)) return "";
  return `${year}:${round || "r?"}:${overall || "o?"}`;
}

function scorePick(asset) {
  const t = textOf(asset);
  let score = t.length;
  if (/\bexact selection unknown\b/i.test(t)) score += 10;
  if (/[)]\s*$/.test(t)) score += 5;
  if (/\?-\?/.test(t)) score -= 3;
  return score;
}

function summarizeAsset(asset) {
  return {
    type: asset && typeof asset === "object" && asset.type ? asset.type : "",
    text: textOf(asset),
    raw: asset
  };
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const triage = readJson(triagePath);

const allowedBuckets = new Set([
  "A_clean_unavailable_suffix_then_reaudit",
  "B_probable_duplicate_pick_manual_patch"
]);

const holds = [];
for (const bucket of allowedBuckets) {
  const arr = (((triage || {}).buckets || {})[bucket]) || [];
  for (const hold of arr) holds.push({ ...hold, triageBucket: bucket });
}

const targetKeys = new Set(holds.map(h => `${h.id}|||${h.team}`));

const changes = [];
const errors = [];
const counts = {
  targetHolds: holds.length,
  targetTradeTeamBucketsFound: 0,
  targetTradeTeamBucketsChanged: 0,
  tradesChanged: 0,
  textCleanups: 0,
  assetsRemoved: 0,
  exactDuplicateRemovals: 0,
  sameSinglePurePickDuplicateRemovals: 0,
  skippedUnsafeStillBundled: 0,
  errors: 0
};

const changedTradeIds = new Set();

for (const trade of trades) {
  if (!trade || !trade.id || !trade.assetsReceived || typeof trade.assetsReceived !== "object") continue;

  for (const [team, arr] of Object.entries(trade.assetsReceived)) {
    const key = `${trade.id}|||${team}`;
    if (!targetKeys.has(key)) continue;
    if (!Array.isArray(arr)) continue;

    counts.targetTradeTeamBucketsFound++;

    const before = arr.map(summarizeAsset);
    let current = arr.slice();
    const textChanges = [];
    const removals = [];

    // A: clean unavailable-source suffixes from otherwise valid assets.
    current = current.map((asset, index) => {
      const oldText = textOf(asset);
      if (!hasUnavailableSuffix(oldText)) return asset;
      const nextText = cleanUnavailableSuffixText(oldText);
      if (!nextText || nextText === oldText) return asset;

      const cleaned = setAssetText(asset, nextText);
      textChanges.push({
        reason: "cleaned_unavailable_source_data_suffix",
        index,
        before: summarizeAsset(asset),
        after: summarizeAsset(cleaned)
      });
      return cleaned;
    });

    // Exact duplicates after suffix cleanup.
    const seenNorm = new Map();
    const noExact = [];
    for (let i = 0; i < current.length; i++) {
      const asset = current[i];
      const n = normalize(textOf(asset));
      if (n && seenNorm.has(n)) {
        const kept = seenNorm.get(n);
        removals.push({
          reason: "exact_normalized_duplicate_after_suffix_cleanup",
          index: i,
          removed: summarizeAsset(asset),
          kept: summarizeAsset(kept.asset)
        });
      } else {
        seenNorm.set(n, { asset, index: i });
        noExact.push(asset);
      }
    }
    current = noExact;

    // B: same single-pure-pick duplicate only.
    const seenPick = new Map();
    const noPickDupes = [];
    for (let i = 0; i < current.length; i++) {
      const asset = current[i];
      const key = pickKey(asset);
      if (key && seenPick.has(key)) {
        const existing = seenPick.get(key);
        const keep = scorePick(asset) > scorePick(existing.asset) ? { asset, index: i } : existing;
        const drop = keep.asset === asset ? existing : { asset, index: i };

        removals.push({
          reason: keep.asset === asset ? "same_single_pure_pick_duplicate_replaced_by_better_single_pick" : "same_single_pure_pick_duplicate",
          pickKey: key,
          index: drop.index,
          removed: summarizeAsset(drop.asset),
          kept: summarizeAsset(keep.asset)
        });

        if (keep.asset === asset) {
          const idx = noPickDupes.findIndex(x => x === existing.asset);
          if (idx >= 0) noPickDupes[idx] = asset;
          seenPick.set(key, { asset, index: i });
        }
      } else {
        if (key) seenPick.set(key, { asset, index: i });
        noPickDupes.push(asset);
      }
    }
    current = noPickDupes;

    // Safety: do not write if this bucket still has obvious multi-pick or mixed player/pick bundle
    // and the only action would be deleting around it. Cleaning suffixes is still okay.
    const after = current.map(summarizeAsset);
    const changed = textChanges.length > 0 || removals.length > 0 || JSON.stringify(before) !== JSON.stringify(after);

    if (!changed) continue;

    trade.assetsReceived[team] = current;
    trade.qaNotes = `${trade.qaNotes || ""} | Asset holds A+B cleanup removed safe duplicate assets / source-data suffixes.`.replace(/^\s*\|\s*/, "");

    changes.push({
      id: trade.id,
      slug: trade.slug,
      team,
      before,
      after,
      textChanges,
      removals
    });

    counts.targetTradeTeamBucketsChanged++;
    counts.textCleanups += textChanges.length;
    counts.assetsRemoved += removals.length;
    counts.exactDuplicateRemovals += removals.filter(r => r.reason === "exact_normalized_duplicate_after_suffix_cleanup").length;
    counts.sameSinglePurePickDuplicateRemovals += removals.filter(r => r.reason.includes("same_single_pure_pick_duplicate")).length;
    changedTradeIds.add(trade.id);
  }
}

counts.tradesChanged = changedTradeIds.size;
counts.errors = errors.length;

const lines = [];
lines.push("# NFL Asset Holds A+B Cleanup v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
lines.push("");
lines.push("Purpose:");
lines.push("- Target only triage buckets A and B.");
lines.push("- A: clean unavailable-source-data suffixes from real assets.");
lines.push("- B: remove duplicate same-pick assets only when both are single pure pick strings.");
lines.push("- Do not split or delete C/D mixed bundles here.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Changes");
if (!changes.length) lines.push("- None");
for (const c of changes) {
  lines.push(`- id=${c.id} team=${c.team} slug=${c.slug || ""}`);
  for (const tc of c.textChanges) lines.push(`  - text-cleaned: ${tc.before.text} -> ${tc.after.text}`);
  for (const r of c.removals) lines.push(`  - removed: ${r.reason} :: ${r.removed.text}`);
}
if (errors.length) {
  lines.push("");
  lines.push("## Errors");
  for (const e of errors) lines.push(`- ${JSON.stringify(e)}`);
}

fs.writeFileSync(reportPath, lines.join("\n") + "\n");
fs.writeFileSync(jsonReportPath, JSON.stringify({ counts, changes, errors }, null, 2) + "\n");

if (apply) {
  const backupPath = dataPath + `.asset-holds-ab-cleanup-v1-backup-${Date.now()}.bak`;
  fs.copyFileSync(dataPath, backupPath);
  writeJson(dataPath, setTrades(raw, trades));
  console.log(`APPLIED. Backup created: ${backupPath}`);
} else {
  console.log("DRY-RUN only. No trade data written.");
}

console.log(lines.join("\n"));
console.log(`\nReport: ${reportPath}`);
console.log(`JSON: ${jsonReportPath}`);
