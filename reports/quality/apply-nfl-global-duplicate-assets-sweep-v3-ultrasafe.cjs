const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");

const dataPath = path.join("src", "data", "nfl", "trades.json");
const reportPath = path.join("reports", "quality", "nfl-global-duplicate-assets-sweep-v3-ultrasafe.txt");
const jsonReportPath = path.join("reports", "quality", "nfl-global-duplicate-assets-sweep-v3-ultrasafe.json");
const manualPath = path.join("reports", "quality", "nfl-global-asset-structure-holds-v3-ultrasafe.txt");
const manualJsonPath = path.join("reports", "quality", "nfl-global-asset-structure-holds-v3-ultrasafe.json");

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

function setAssetText(asset, nextText, nextType) {
  if (asset == null || typeof asset === "string" || typeof asset !== "object") return nextText;

  const out = cloneAsset(asset);
  const textKeys = ["asset", "label", "name", "player", "pick", "description", "value", "title", "displayName", "display", "text"];
  let touched = false;

  for (const key of textKeys) {
    if (typeof out[key] === "string") {
      if (key === "player" && nextType !== "player") continue;
      if (key === "pick" && nextType !== "pick") continue;
      out[key] = nextText;
      touched = true;
    }
  }

  if (!touched) out.asset = nextText;

  for (const key of ["type", "kind", "category"]) {
    if (typeof out[key] === "string") out[key] = nextType;
  }

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

function normalizeAssetText(s) {
  return normalize(s)
    .replace(/\bunknown pick\b/g, "?")
    .replace(/\bundisclosed pick\b/g, "?")
    .replace(/\bnot exercised\?\b/g, "not exercised")
    .replace(/\s+/g, " ")
    .trim();
}

function assetType(asset) {
  if (asset && typeof asset === "object") {
    for (const k of ["type", "kind", "category"]) {
      if (typeof asset[k] === "string") {
        const v = asset[k].toLowerCase();
        if (v.includes("player")) return "player";
        if (v.includes("pick") || v.includes("draft")) return "pick";
        if (v.includes("cash") || v.includes("other")) return "other";
      }
    }
  }
  const t = normalize(textOf(asset));
  if (/\b\d{4}\b/.test(t) && /\b(round|rd|pick|overall|#)\b/.test(t)) return "pick";
  if (/\bpick\b|\bround\b|\boverall\b/.test(t)) return "pick";
  if (t === "cash") return "other";
  return "player";
}

function summarizeAsset(asset) {
  return { type: assetType(asset), text: textOf(asset), raw: asset };
}

function isPlaceholderOnly(asset) {
  const t = normalize(textOf(asset));
  return (
    t === "player details unavailable from source data" ||
    t === "details unavailable from source data" ||
    t === "additional draft-pick details unavailable from source data"
  );
}

function cleanAssetJunkText(asset) {
  const raw = textOf(asset);
  let next = raw
    .replace(/\s*;\s*additional draft-pick details unavailable from source data\.?/gi, "")
    .replace(/\s*,\s*additional draft-pick details unavailable from source data\.?/gi, "")
    .replace(/\s+additional draft-pick details unavailable from source data\.?/gi, "")
    .replace(/\s*;\s*player details unavailable from source data\.?/gi, "")
    .replace(/\s*,\s*player details unavailable from source data\.?/gi, "")
    .replace(/\s+player details unavailable from source data\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (next === raw) return null;
  if (!next) return null;

  return setAssetText(asset, next, assetType(asset));
}

function isBareUnknownOrNotDisclosed(asset) {
  const t = normalize(textOf(asset));
  return t === "unknown" || t === "unknown player" || t === "unknown asset" || t === "not disclosed";
}

function isUsefulAsset(asset) {
  return !isPlaceholderOnly(asset) && !isBareUnknownOrNotDisclosed(asset);
}

function hasPickSignal(s) {
  const t = normalize(s);
  return /\bpick\b|\bround\b|\boverall\b|#\d{1,3}\b/.test(t);
}

function countPickMentions(s) {
  const t = normalize(s);
  const roundPickMatches = t.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b/g) || [];
  const draftPickMatches = t.match(/\bdraft pick\b/g) || [];
  const hashMatches = t.match(/#\s*\d{1,3}\b/g) || [];
  return Math.max(roundPickMatches.length + draftPickMatches.length, hashMatches.length);
}

function isSinglePurePickText(s) {
  const raw = String(s || "");
  const t = normalize(raw);
  if (!hasPickSignal(t)) return false;
  if (countPickMentions(raw) !== 1) return false;
  if (/\b(and|with|plus| or |cash|future considerations|past considerations|player to be named|ptbnl)\b/.test(t)) return false;
  if (/[;]|(?:\s\/\s.*\bpick\b)/i.test(raw)) return false;

  // Reject strings starting with names before the pick.
  if (!/^\s*(?:\d{4}|draft pick|conditional|future|past|undisclosed|unspecified)/i.test(raw)) return false;

  return true;
}

function pickKey(asset) {
  const original = textOf(asset);
  const t = normalizeAssetText(original);
  if (!isSinglePurePickText(original)) return "";

  const year = (t.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  const overall =
    (t.match(/#\s*(\d{1,3})\b/) || [])[1] ||
    (t.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/) || [])[1] ||
    "";

  const roundWord =
    (t.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+round\b/) || [])[1] ||
    (t.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+round\b/) || [])[1] ||
    "";

  if (year && (overall || roundWord)) return `pick:${year}:${roundWord || "r?"}:${overall || "o?"}`;
  return "";
}

function scorePick(asset) {
  const t = textOf(asset);
  let score = t.length;
  if (/\bexact selection unknown\b/i.test(t)) score += 10;
  if (/[)]\s*$/.test(t)) score += 5;
  if (/\?-\?/.test(t)) score -= 3;
  return score;
}

function isUnsafeBundle(asset) {
  const t = textOf(asset);
  const n = normalize(t);
  if (!hasPickSignal(t)) return false;
  if (countPickMentions(t) > 1) return true;
  if (/\b(and|with|plus| or |cash|future considerations|past considerations|player to be named|ptbnl)\b/.test(n)) return true;
  if (!isSinglePurePickText(t) && hasPickSignal(t)) return true;
  return false;
}

function cleanDetroitTampaTrade(trade) {
  if (!trade || !trade.assetsReceived) return null;
  if ((trade.slug || "") !== "2024-3rd-round-pick-92nd-overall-detroit-lions-2024") return null;

  const det = "detroit-lions";
  const tb = "tampa-bay-buccaneers";
  if (!Array.isArray(trade.assetsReceived[det]) || !Array.isArray(trade.assetsReceived[tb])) return null;

  const allAssets = [...trade.assetsReceived[det], ...trade.assetsReceived[tb]];
  const playerTemplate = allAssets.find(a => assetType(a) === "player") || {};
  const pickTemplate = allAssets.find(a => assetType(a) === "pick") || {};

  const before = {
    [det]: trade.assetsReceived[det].map(summarizeAsset),
    [tb]: trade.assetsReceived[tb].map(summarizeAsset),
    summary: trade.summary,
    partnerSummary: trade.partnerSummary,
    analysis: trade.analysis
  };

  trade.assetsReceived[det] = [
    setAssetText(playerTemplate, "Carlton Davis", "player"),
    setAssetText(pickTemplate, "2024 6th round pick (201st overall subsequently traded, Micah Abraham)", "pick"),
    setAssetText(pickTemplate, "2025 6th round pick (196th overall, Ahmed Hassanein)", "pick")
  ];

  trade.assetsReceived[tb] = [
    setAssetText(pickTemplate, "2024 3rd round pick (92nd overall, Jalen McMillan)", "pick")
  ];

  trade.summary = "Tampa Bay Buccaneers acquired 2024 3rd round pick (92nd overall, Jalen McMillan) from Detroit Lions for Carlton Davis; 2024 6th round pick (201st overall subsequently traded, Micah Abraham); and 2025 6th round pick (196th overall, Ahmed Hassanein). The overall result favors Detroit Lions over Tampa Bay Buccaneers.";
  trade.partnerSummary = "Detroit Lions received Carlton Davis; 2024 6th round pick (201st overall subsequently traded, Micah Abraham); and 2025 6th round pick (196th overall, Ahmed Hassanein) while giving up 2024 3rd round pick (92nd overall, Jalen McMillan).";
  trade.analysis = "Detroit's side carries the stronger recorded value because the Lions landed Carlton Davis and two day-three picks while Tampa Bay converted the return into Jalen McMillan.";

  if (Array.isArray(trade.perspectives)) {
    for (const p of trade.perspectives) {
      const primaryTeam = p.primaryTeam || p.sourceTeam || p.team;
      if (primaryTeam === det) {
        p.primarySummary = "Detroit Lions received Carlton Davis; 2024 6th round pick (201st overall subsequently traded, Micah Abraham); and 2025 6th round pick (196th overall, Ahmed Hassanein).";
        p.partnerSummary = "Tampa Bay Buccaneers received 2024 3rd round pick (92nd overall, Jalen McMillan).";
      } else if (primaryTeam === tb) {
        p.primarySummary = "Tampa Bay Buccaneers received 2024 3rd round pick (92nd overall, Jalen McMillan).";
        p.partnerSummary = "Detroit Lions received Carlton Davis; 2024 6th round pick (201st overall subsequently traded, Micah Abraham); and 2025 6th round pick (196th overall, Ahmed Hassanein).";
      }
      p.qaNotes = `${p.qaNotes || ""} | Global duplicate-asset sweep v3 fixed duplicated/split Detroit-Tampa assets.`.replace(/^\s*\|\s*/, "");
    }
  }

  trade.qaNotes = `${trade.qaNotes || ""} | Global duplicate-asset sweep v3 fixed Detroit/Tampa duplicate assets.`.replace(/^\s*\|\s*/, "");

  const after = {
    [det]: trade.assetsReceived[det].map(summarizeAsset),
    [tb]: trade.assetsReceived[tb].map(summarizeAsset),
    summary: trade.summary,
    partnerSummary: trade.partnerSummary,
    analysis: trade.analysis
  };

  return { before, after };
}

function processBucket(trade, team, arr, manualHolds) {
  const before = arr.map(summarizeAsset);
  const removals = [];
  const textChanges = [];
  let current = arr.map((asset, index) => ({ asset, index }));

  // Clean bad suffixes, but do not delete real assets containing valid pick/player text.
  current = current.map(item => {
    const cleaned = cleanAssetJunkText(item.asset);
    if (cleaned) {
      textChanges.push({
        reason: "cleaned_unavailable_source_data_suffix",
        index: item.index,
        before: summarizeAsset(item.asset),
        after: summarizeAsset(cleaned)
      });
      return { ...item, asset: cleaned };
    }
    return item;
  });

  // Remove placeholder-only junk.
  const noPlaceholderOnly = [];
  for (const item of current) {
    if (isPlaceholderOnly(item.asset)) {
      removals.push({
        reason: "placeholder_only_junk",
        index: item.index,
        removed: summarizeAsset(item.asset)
      });
    } else {
      noPlaceholderOnly.push(item);
    }
  }
  current = noPlaceholderOnly;

  // Remove bare not disclosed/unknown only if another useful asset remains.
  const usefulCount = current.filter(x => isUsefulAsset(x.asset)).length;
  const noBareUnknown = [];
  for (const item of current) {
    if (usefulCount > 0 && isBareUnknownOrNotDisclosed(item.asset)) {
      removals.push({
        reason: "bare_unknown_or_not_disclosed_with_real_asset_present",
        index: item.index,
        removed: summarizeAsset(item.asset)
      });
    } else {
      noBareUnknown.push(item);
    }
  }
  current = noBareUnknown;

  // Exact normalized duplicates.
  const seenNorm = new Map();
  const noExactDuplicates = [];
  for (const item of current) {
    const key = normalizeAssetText(textOf(item.asset));
    if (!key) {
      noExactDuplicates.push(item);
      continue;
    }
    if (seenNorm.has(key)) {
      const existing = seenNorm.get(key);
      removals.push({
        reason: "exact_normalized_duplicate",
        index: item.index,
        removed: summarizeAsset(item.asset),
        kept: summarizeAsset(existing.asset)
      });
    } else {
      seenNorm.set(key, item);
      noExactDuplicates.push(item);
    }
  }
  current = noExactDuplicates;

  // Same-pick duplicates only when both are single pure pick assets.
  const seenPick = new Map();
  const noPickDuplicates = [];
  for (const item of current) {
    const key = pickKey(item.asset);
    if (key && seenPick.has(key)) {
      const existing = seenPick.get(key);
      const keep = scorePick(item.asset) > scorePick(existing.asset) ? item : existing;
      const drop = keep === item ? existing : item;

      removals.push({
        reason: keep === item ? "same_single_pure_pick_duplicate_replaced_by_better_single_pick" : "same_single_pure_pick_duplicate",
        pickKey: key,
        index: drop.index,
        removed: summarizeAsset(drop.asset),
        kept: summarizeAsset(keep.asset)
      });

      if (keep === item) {
        const idx = noPickDuplicates.findIndex(x => x.index === existing.index);
        if (idx >= 0) noPickDuplicates[idx] = item;
        seenPick.set(key, item);
      }
    } else {
      if (key) seenPick.set(key, item);
      noPickDuplicates.push(item);
    }
  }
  current = noPickDuplicates;

  const unsafe = current.filter(x => isUnsafeBundle(x.asset));
  if (unsafe.length) {
    manualHolds.push({
      id: trade.id,
      slug: trade.slug,
      team,
      lane: "asset_structure_hold",
      reason: "unsafe_bundle_or_multi_pick_asset_detected_not_auto_split",
      assets: current.map(x => summarizeAsset(x.asset))
    });
  }

  const afterAssets = current.map(x => x.asset);
  const changed = removals.length > 0 || textChanges.length > 0 || afterAssets.length !== arr.length;

  return {
    changed,
    afterAssets,
    before,
    after: afterAssets.map(summarizeAsset),
    removals,
    textChanges
  };
}

const raw = readJson(dataPath);
const trades = getTrades(raw);

const changes = [];
const manualHolds = [];
const counts = {
  tradesScanned: trades.length,
  teamsScanned: 0,
  tradesChanged: 0,
  teamBucketsChanged: 0,
  assetsRemoved: 0,
  textCleanups: 0,
  placeholderOnlyRemovals: 0,
  bareUnknownNotDisclosedRemovals: 0,
  exactDuplicateRemovals: 0,
  sameSinglePurePickDuplicateRemovals: 0,
  specialCaseFixes: 0,
  manualAssetStructureHolds: 0
};

for (const trade of trades) {
  if (!trade || !trade.assetsReceived || typeof trade.assetsReceived !== "object") continue;

  let tradeChanged = false;

  const special = cleanDetroitTampaTrade(trade);
  if (special) {
    tradeChanged = true;
    counts.specialCaseFixes++;
    changes.push({
      id: trade.id,
      slug: trade.slug,
      type: "special_case_detroit_tampa_2024",
      before: special.before,
      after: special.after
    });
  }

  for (const [team, arr] of Object.entries(trade.assetsReceived)) {
    if (!Array.isArray(arr)) continue;
    counts.teamsScanned++;

    const result = processBucket(trade, team, arr, manualHolds);
    if (!result.changed) continue;

    trade.assetsReceived[team] = result.afterAssets;
    tradeChanged = true;
    counts.teamBucketsChanged++;
    counts.assetsRemoved += result.removals.length;
    counts.textCleanups += result.textChanges.length;

    for (const r of result.removals) {
      if (r.reason === "placeholder_only_junk") counts.placeholderOnlyRemovals++;
      else if (r.reason === "bare_unknown_or_not_disclosed_with_real_asset_present") counts.bareUnknownNotDisclosedRemovals++;
      else if (r.reason === "exact_normalized_duplicate") counts.exactDuplicateRemovals++;
      else if (r.reason.includes("same_single_pure_pick_duplicate")) counts.sameSinglePurePickDuplicateRemovals++;
    }

    changes.push({
      id: trade.id,
      slug: trade.slug,
      team,
      type: "safe_asset_dedupe_v3_ultrasafe",
      before: result.before,
      after: result.after,
      removals: result.removals,
      textChanges: result.textChanges
    });
  }

  if (tradeChanged) {
    counts.tradesChanged++;
    trade.qaNotes = `${trade.qaNotes || ""} | Global duplicate-asset sweep v3 ultrasafe cleanup.`.replace(/^\s*\|\s*/, "");
  }
}

counts.manualAssetStructureHolds = manualHolds.length;

const lines = [];
lines.push("# NFL Global Duplicate Assets Sweep v3 ULTRASAFE");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
lines.push("");
lines.push("Purpose:");
lines.push("- Ultra-safe before-build cleanup only.");
lines.push("- Directly fix the known Detroit/Tampa 2024 duplicate-assets page.");
lines.push("- Clean unavailable-source-data suffixes from real assets instead of deleting the asset.");
lines.push("- Remove placeholder-only junk.");
lines.push("- Remove bare unknown/not disclosed only when another real asset remains.");
lines.push("- Remove exact normalized duplicates.");
lines.push("- Remove same-pick duplicates only when both assets are unmistakably one single pure pick.");
lines.push("- Report bundles/multi-pick assets as asset_structure_hold; do not split them globally.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");

lines.push("## Changed Trades");
if (!changes.length) {
  lines.push("- None");
} else {
  for (const c of changes) {
    lines.push(`- id=${c.id || "unknown"} slug=${c.slug || ""} type=${c.type}${c.team ? ` team=${c.team}` : ""}`);
    if (Array.isArray(c.textChanges)) {
      for (const tc of c.textChanges) {
        lines.push(`  - text-cleaned: ${tc.reason} :: ${tc.before ? tc.before.text : ""} -> ${tc.after ? tc.after.text : ""}`);
      }
    }
    if (Array.isArray(c.removals)) {
      for (const r of c.removals) {
        lines.push(`  - removed: ${r.reason} :: ${r.removed ? r.removed.text : ""}`);
      }
    }
  }
}
lines.push("");

lines.push("## Manual asset_structure_hold");
if (!manualHolds.length) {
  lines.push("- None");
} else {
  for (const h of manualHolds) {
    lines.push(`- id=${h.id || "unknown"} team=${h.team || ""} slug=${h.slug || ""}`);
    lines.push(`  - reason: ${h.reason}`);
    for (const a of h.assets || []) lines.push(`  - asset: [${a.type}] ${a.text}`);
  }
}

const manualLines = [];
manualLines.push("# NFL Global Asset Structure Holds v3 ULTRASAFE");
manualLines.push(`Generated: ${new Date().toISOString()}`);
manualLines.push("");
manualLines.push("Purpose:");
manualLines.push("- These are unsafe to split/remove globally.");
manualLines.push("- Fold these into normal batch cleanup or targeted manual patches.");
manualLines.push("");
if (!manualHolds.length) {
  manualLines.push("- None");
} else {
  manualHolds.forEach((h, i) => {
    manualLines.push(`## ${i + 1}. ${h.id || "unknown"}`);
    manualLines.push(`- team: ${h.team || ""}`);
    manualLines.push(`- slug: ${h.slug || ""}`);
    manualLines.push(`- lane: ${h.lane}`);
    manualLines.push(`- reason: ${h.reason}`);
    for (const a of h.assets || []) manualLines.push(`- asset: [${a.type}] ${a.text}`);
    manualLines.push("");
  });
}

fs.writeFileSync(reportPath, lines.join("\n") + "\n");
fs.writeFileSync(jsonReportPath, JSON.stringify({ counts, changes }, null, 2) + "\n");
fs.writeFileSync(manualPath, manualLines.join("\n") + "\n");
fs.writeFileSync(manualJsonPath, JSON.stringify(manualHolds, null, 2) + "\n");

if (apply) {
  const backupPath = dataPath + `.global-duplicate-assets-sweep-v3-ultrasafe-backup-${Date.now()}.bak`;
  fs.copyFileSync(dataPath, backupPath);
  writeJson(dataPath, setTrades(raw, trades));
  console.log(`APPLIED. Backup created: ${backupPath}`);
} else {
  console.log("DRY-RUN only. No trade data written.");
}

console.log(lines.join("\n"));
console.log(`\nReport: ${reportPath}`);
console.log(`JSON: ${jsonReportPath}`);
console.log(`Manual holds: ${manualPath}`);
console.log(`Manual holds JSON: ${manualJsonPath}`);
