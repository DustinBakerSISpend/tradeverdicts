const fs = require("fs");
const path = require("path");

const samplePerBucket = Number(process.argv[2] || 50);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const candidatesPath = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.json");
const outTxt = path.join("reports", "quality", "nfl-s1-s2-strict-multipick-split-preview-v2.txt");
const outJson = path.join("reports", "quality", "nfl-s1-s2-strict-multipick-split-preview-v2.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf8"));

function getTrades(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trades)) return raw.trades;
  throw new Error("Could not find trades array.");
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

function cloneAsset(asset) {
  if (asset == null || typeof asset !== "object") return asset;
  return JSON.parse(JSON.stringify(asset));
}

function setAssetText(asset, nextText) {
  if (asset == null || typeof asset === "string" || typeof asset !== "object") return nextText;
  const out = cloneAsset(asset);
  const keys = ["asset", "label", "name", "player", "pick", "description", "value", "title", "displayName", "display", "text"];
  let touched = false;
  for (const key of keys) {
    if (typeof out[key] === "string" && out[key].trim()) {
      out[key] = nextText;
      touched = true;
      break;
    }
  }
  if (!touched) out.asset = nextText;
  if (!out.type) out.type = "pick";
  return out;
}

function summarizeAsset(asset) {
  return {
    type: asset && typeof asset === "object" && asset.type ? asset.type : "",
    text: textOf(asset),
    raw: asset
  };
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[â€“â€”]/g, "-")
    .replace(/[;:|()[\]{}.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\d{1,3}\b/i.test(String(s || ""));
}

function countPickMentions(s) {
  const rawText = String(s || "");
  const n = norm(rawText);
  const roundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick\b/g) || [];
  const hashMatches = rawText.match(/#\s*\d{1,3}\b/g) || [];
  return Math.max(roundPickMatches.length, hashMatches.length);
}

function startsLikePick(s) {
  return /^\s*(?:\d{4}|draft pick|conditional|future|past|undisclosed|unspecified)/i.test(String(s || ""));
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

function strictBlockReason(s) {
  const rawText = String(s || "");
  const n = norm(rawText);

  if (/\band\/or\b/i.test(rawText)) return "blocked_and_or";
  if (/\b(?:and|or)\b/i.test(rawText)) return "blocked_and_or_word";
  if (/-\s*OR\s*-/i.test(rawText)) return "blocked_dash_or";
  if (/\s\/\s/.test(rawText)) return "blocked_slash_alias_or_alternative";
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably)\b/i.test(rawText)) return "blocked_explanatory_or_parenthetical_pick_reference";
  if (/\b(?:cash|future considerations|past considerations|considerations|player to be named later|ptbnl|option|conditional on|if )\b/i.test(rawText)) return "blocked_cash_consideration_ptbnl_or_conditional";
  if (!balancedParens(rawText)) return "blocked_unbalanced_parentheses";
  if (/[,;]\s*(?:and|or)\b/i.test(rawText)) return "blocked_delimiter_followed_by_connector";
  if (/\b(?:and|or)\s*$/i.test(rawText.trim())) return "blocked_trailing_connector";

  return "";
}

function topLevelStrictSplit(text) {
  const rawText = String(text || "").replace(/\s+/g, " ").trim();
  const blocker = strictBlockReason(rawText);
  if (blocker) return { ok: false, reason: blocker, parts: [] };

  if (!hasPickSignal(rawText) || countPickMentions(rawText) < 2) {
    return { ok: false, reason: "not_multi_pick", parts: [] };
  }

  const parts = [];
  let start = 0;
  let depth = 0;
  let sawDelimiter = false;

  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];

    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);

    if (depth !== 0) continue;

    if (ch === ";" || ch === ",") {
      const next = rawText.slice(i + 1).trim();
      if (/^(?:\d{4}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick|draft pick\s*\(|conditional\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick)\b/i.test(next)) {
        const part = rawText.slice(start, i).trim().replace(/[;,]\s*$/g, "");
        if (part) parts.push(part);
        start = i + 1;
        sawDelimiter = true;
      }
    }
  }

  if (!sawDelimiter) return { ok: false, reason: "no_top_level_semicolon_or_comma_pick_delimiter", parts: [] };

  const last = rawText.slice(start).trim().replace(/[;,]\s*$/g, "");
  if (last) parts.push(last);

  if (parts.length < 2) return { ok: false, reason: "split_produced_too_few_parts", parts };

  for (const part of parts) {
    if (strictBlockReason(part)) return { ok: false, reason: `part_${strictBlockReason(part)}`, parts };
    if (!balancedParens(part)) return { ok: false, reason: "part_unbalanced_parentheses", parts };
    if (!startsLikePick(part)) return { ok: false, reason: "part_does_not_start_like_pick", parts };
    if (!hasPickSignal(part)) return { ok: false, reason: "part_missing_pick_signal", parts };
    if (countPickMentions(part) !== 1) return { ok: false, reason: "part_not_single_pick", parts };
    if (/\b(?:and|or)\s*$/i.test(part.trim()) || /-\s*OR\s*-?\s*$/i.test(part.trim())) return { ok: false, reason: "part_trailing_connector", parts };
  }

  return { ok: true, reason: "strict_top_level_delimited_pick_split", parts };
}

function isSinglePurePickText(s) {
  const rawText = String(s || "");
  if (!startsLikePick(rawText)) return false;
  if (!hasPickSignal(rawText)) return false;
  if (countPickMentions(rawText) !== 1) return false;
  if (strictBlockReason(rawText)) return false;
  return true;
}

function pickKeyText(s) {
  const rawText = String(s || "");
  const n = norm(rawText);
  if (!hasPickSignal(rawText)) return "";
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

function scorePickText(s) {
  let score = String(s || "").length;
  if (/\bexact selection unknown\b/i.test(s)) score += 10;
  if (/[)]\s*$/.test(s)) score += 5;
  if (/\?-\?/.test(s)) score -= 3;
  return score;
}

function dedupeAssets(assets) {
  const removals = [];

  const exactSeen = new Map();
  const exactOut = [];
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const key = norm(textOf(asset));
    if (key && exactSeen.has(key)) {
      removals.push({
        reason: "exact_normalized_duplicate_after_strict_split",
        index: i,
        removed: summarizeAsset(asset),
        kept: summarizeAsset(exactSeen.get(key).asset)
      });
    } else {
      exactSeen.set(key, { asset, index: i });
      exactOut.push(asset);
    }
  }

  const pickSeen = new Map();
  const out = [];
  for (let i = 0; i < exactOut.length; i++) {
    const asset = exactOut[i];
    const text = textOf(asset);
    const key = isSinglePurePickText(text) ? pickKeyText(text) : "";
    if (key && pickSeen.has(key)) {
      const existing = pickSeen.get(key);
      const keepNew = scorePickText(text) > scorePickText(textOf(existing.asset));
      const keep = keepNew ? { asset, index: i } : existing;
      const drop = keepNew ? existing : { asset, index: i };

      removals.push({
        reason: keepNew ? "same_single_pure_pick_duplicate_after_strict_split_replaced_by_better_single_pick" : "same_single_pure_pick_duplicate_after_strict_split",
        pickKey: key,
        index: drop.index,
        removed: summarizeAsset(drop.asset),
        kept: summarizeAsset(keep.asset)
      });

      if (keepNew) {
        const idx = out.findIndex(x => x === existing.asset);
        if (idx >= 0) out[idx] = asset;
        pickSeen.set(key, { asset, index: i });
      }
    } else {
      if (key) pickSeen.set(key, { asset, index: i });
      out.push(asset);
    }
  }

  return { out, removals };
}

function transformStrictPreview(arr) {
  const before = arr.map(summarizeAsset);
  const splitActions = [];
  const blockedAssets = [];
  let afterSplit = [];

  for (let i = 0; i < arr.length; i++) {
    const asset = arr[i];
    const text = textOf(asset);
    const split = topLevelStrictSplit(text);

    if (split.ok) {
      const splitAssets = split.parts.map(part => setAssetText(asset, part));
      splitActions.push({
        index: i,
        original: summarizeAsset(asset),
        parts: split.parts,
        segments: splitAssets.map(summarizeAsset)
      });
      afterSplit.push(...splitAssets);
    } else {
      if (hasPickSignal(text) && countPickMentions(text) >= 2) {
        blockedAssets.push({
          index: i,
          reason: split.reason,
          asset: summarizeAsset(asset),
          attemptedParts: split.parts
        });
      }
      afterSplit.push(asset);
    }
  }

  const { out, removals } = dedupeAssets(afterSplit);
  const after = out.map(summarizeAsset);

  const unsafePreviewSegments = splitActions.flatMap(a => a.segments).filter(seg => {
    const t = seg.text || "";
    return strictBlockReason(t) || /\b(?:and|or)\s*$/i.test(t.trim()) || /-\s*OR\s*-?\s*$/i.test(t.trim()) || !balancedParens(t);
  });

  return { before, after, splitActions, blockedAssets, removals, unsafePreviewSegments };
}

const trades = getTrades(raw);
const byTradeId = new Map(trades.map(t => [t.id, t]));

let targetItems = [
  ...((((candidates || {}).buckets || {})["S1_clean_multi_pick_split_plus_dedupe_candidate"]) || []).map(x => ({ ...x, splitBucket: "S1" })),
  ...((((candidates || {}).buckets || {})["S2_clean_multi_pick_split_candidate"]) || []).map(x => ({ ...x, splitBucket: "S2" }))
];

const seenTargets = new Set();
targetItems = targetItems.filter(item => {
  const key = `${item.id}|||${item.team}`;
  if (seenTargets.has(key)) return false;
  seenTargets.add(key);
  return true;
});

const changes = [];
const blocked = [];
const skips = [];
const counts = {
  targetItems: targetItems.length,
  targetBucketsFound: 0,
  strictBucketsWithPreviewedChange: 0,
  tradesWithPreviewedChange: 0,
  strictMultiPickAssetsSplit: 0,
  strictSplitSegmentsCreated: 0,
  duplicateAssetsRemovedAfterStrictSplit: 0,
  exactDuplicateRemovalsAfterStrictSplit: 0,
  sameSinglePurePickDuplicateRemovalsAfterStrictSplit: 0,
  unsafePreviewSegments: 0,
  blockedAssetsTotal: 0,
  blocked_and_or: 0,
  blocked_and_or_word: 0,
  blocked_dash_or: 0,
  blocked_slash_alias_or_alternative: 0,
  blocked_explanatory_or_parenthetical_pick_reference: 0,
  blocked_cash_consideration_ptbnl_or_conditional: 0,
  blocked_unbalanced_parentheses: 0,
  no_top_level_semicolon_or_comma_pick_delimiter: 0,
  otherBlocked: 0,
  skippedMissingTrade: 0,
  skippedMissingTeamAssets: 0,
  skippedNoStrictChange: 0,
  errors: 0
};

const tradeIdsChanged = new Set();

for (const item of targetItems) {
  try {
    const trade = byTradeId.get(item.id);
    if (!trade) {
      counts.skippedMissingTrade++;
      skips.push({ reason: "missing_trade", id: item.id, team: item.team, slug: item.slug });
      continue;
    }

    const teamAssets = trade.assetsReceived && trade.assetsReceived[item.team];
    if (!Array.isArray(teamAssets)) {
      counts.skippedMissingTeamAssets++;
      skips.push({ reason: "missing_team_assets", id: item.id, team: item.team, slug: item.slug });
      continue;
    }

    counts.targetBucketsFound++;
    const result = transformStrictPreview(teamAssets);

    for (const b of result.blockedAssets) {
      counts.blockedAssetsTotal++;
      if (Object.prototype.hasOwnProperty.call(counts, b.reason)) counts[b.reason]++;
      else counts.otherBlocked++;
      blocked.push({
        id: item.id,
        slug: item.slug || trade.slug || "",
        team: item.team,
        splitBucket: item.splitBucket,
        ...b
      });
    }

    const changed = result.splitActions.length > 0 && JSON.stringify(result.before) !== JSON.stringify(result.after);
    if (!changed) {
      counts.skippedNoStrictChange++;
      continue;
    }

    changes.push({
      id: item.id,
      slug: item.slug || trade.slug || "",
      team: item.team,
      splitBucket: item.splitBucket,
      sourceBucket: item.sourceBucket || "",
      before: result.before,
      after: result.after,
      splitActions: result.splitActions,
      removals: result.removals,
      unsafePreviewSegments: result.unsafePreviewSegments
    });

    counts.strictBucketsWithPreviewedChange++;
    counts.strictMultiPickAssetsSplit += result.splitActions.length;
    counts.strictSplitSegmentsCreated += result.splitActions.reduce((sum, a) => sum + a.segments.length, 0);
    counts.duplicateAssetsRemovedAfterStrictSplit += result.removals.length;
    counts.exactDuplicateRemovalsAfterStrictSplit += result.removals.filter(r => r.reason === "exact_normalized_duplicate_after_strict_split").length;
    counts.sameSinglePurePickDuplicateRemovalsAfterStrictSplit += result.removals.filter(r => r.reason.includes("same_single_pure_pick_duplicate_after_strict_split")).length;
    counts.unsafePreviewSegments += result.unsafePreviewSegments.length;
    tradeIdsChanged.add(item.id);
  } catch (err) {
    counts.errors++;
    skips.push({ reason: "error", id: item.id, team: item.team, slug: item.slug, error: String(err && err.stack || err) });
  }
}

counts.tradesWithPreviewedChange = tradeIdsChanged.size;

const lines = [];
lines.push("# NFL S1/S2 Strict Multi-Pick Split Preview v2");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: DRY-RUN ONLY");
lines.push("");
lines.push("Purpose:");
lines.push("- Preview only. No trade data is changed.");
lines.push("- Much stricter than v1 after v1 proved unsafe.");
lines.push("- Only previews top-level semicolon/comma splits where every resulting segment is a complete standalone pick.");
lines.push("- Blocks strings containing and, or, and/or, -OR-, slash aliases, awarded/replaced/because/after/later/subsequently, cash, considerations, PTBNL, and conditional-if language.");
lines.push("- Anything blocked remains in review/specialized split workflow; it is not ignored.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Strict Previewed Changes");
if (!changes.length) lines.push("- None");
for (const c of changes.slice(0, samplePerBucket)) {
  lines.push(`### ${c.id} / ${c.team}`);
  lines.push(`- slug: ${c.slug}`);
  lines.push(`- bucket: ${c.splitBucket}`);
  for (const split of c.splitActions) {
    lines.push(`- split original: ${split.original.text}`);
    for (const seg of split.segments) lines.push(`  - segment: ${seg.text}`);
  }
  for (const r of c.removals) {
    lines.push(`- removed after strict split: ${r.reason} :: ${r.removed.text}`);
  }
  if (c.unsafePreviewSegments.length) {
    lines.push("- UNSAFE PREVIEW SEGMENTS DETECTED:");
    for (const u of c.unsafePreviewSegments) lines.push(`  - ${u.text}`);
  }
  lines.push("");
}
if (changes.length > samplePerBucket) {
  lines.push(`... ${changes.length - samplePerBucket} more strict previewed changes. See JSON for complete list.`);
  lines.push("");
}
lines.push("## Blocked Asset Samples");
for (const b of blocked.slice(0, samplePerBucket)) {
  lines.push(`### ${b.id} / ${b.team}`);
  lines.push(`- reason: ${b.reason}`);
  lines.push(`- slug: ${b.slug}`);
  lines.push(`- asset: ${b.asset.text}`);
  if (b.attemptedParts && b.attemptedParts.length) {
    for (const p of b.attemptedParts) lines.push(`  - attemptedPart: ${p}`);
  }
  lines.push("");
}
if (blocked.length > samplePerBucket) {
  lines.push(`... ${blocked.length - samplePerBucket} more blocked assets. See JSON for complete list.`);
  lines.push("");
}
lines.push("## Skips");
for (const s of skips.slice(0, samplePerBucket)) {
  lines.push(`- ${s.reason}: id=${s.id} team=${s.team} slug=${s.slug || ""}`);
}
if (skips.length > samplePerBucket) lines.push(`... ${skips.length - samplePerBucket} more skips. See JSON for complete list.`);

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, changes, blocked, skips }, null, 2) + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
