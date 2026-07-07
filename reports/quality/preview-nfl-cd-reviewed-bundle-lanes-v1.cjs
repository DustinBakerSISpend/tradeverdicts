const fs = require("fs");
const path = require("path");

const samplePerBucket = Number(process.argv[2] || 40);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const splitPath = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.json");
const outTxt = path.join("reports", "quality", "nfl-cd-reviewed-bundle-lanes-preview-v1.txt");
const outJson = path.join("reports", "quality", "nfl-cd-reviewed-bundle-lanes-preview-v1.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getTrades(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trades)) return raw.trades;
  throw new Error("Could not find trades array.");
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

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\d{1,3}\b/i.test(String(s || ""));
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

function baseBlockReason(s, allowAndConnector = false) {
  const raw = String(s || "");

  if (!balancedParens(raw)) return "unbalanced_parentheses";
  if (/\band\/or\b/i.test(raw)) return "and_or_alternative";
  if (/-\s*OR\s*-/i.test(raw)) return "dash_or_alternative";
  if (/\s\/\s/.test(raw)) return "slash_alternative";
  if (/\bor\b/i.test(raw)) return "or_word_alternative";
  if (!allowAndConnector && /\band\b/i.test(raw)) return "and_word_connector_or_prose";
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) return "explanatory_or_contingent_pick_clause";
  if (/\b(?:cash|future considerations|past considerations|considerations|player to be named later|ptbnl|conditional on|if )\b/i.test(raw)) return "cash_consideration_ptbnl_or_conditional";
  return "";
}

function splitTopLevelByConnector(text, connector) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const parts = [];
  let start = 0;
  let depth = 0;

  function pushPart(end) {
    const part = raw.slice(start, end).trim().replace(/[;,]\s*$/g, "");
    if (part) parts.push(part);
  }

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);

    if (depth !== 0) continue;

    if (connector === "and") {
      const slice = raw.slice(i);
      const match = slice.match(/^\s+and\s+/i);
      if (match) {
        const next = raw.slice(i + match[0].length).trim();
        if (/^(?:\d{4}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick|draft pick\s*\(|conditional\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick)\b/i.test(next)) {
          pushPart(i);
          start = i + match[0].length;
          i = start - 1;
        }
      }
    }

    if (connector === "punct" && (ch === ";" || ch === ",")) {
      const next = raw.slice(i + 1).trim();
      if (/^(?:\d{4}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick|draft pick\s*\(|conditional\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)\s+round\s+pick)\b/i.test(next)) {
        pushPart(i);
        start = i + 1;
      }
    }
  }

  const last = raw.slice(start).trim().replace(/[;,]\s*$/g, "");
  if (last) parts.push(last);

  return parts;
}

function validateSinglePickParts(parts) {
  if (!Array.isArray(parts) || parts.length < 2) return { ok: false, reason: "too_few_parts" };

  for (const part of parts) {
    const blocker = baseBlockReason(part, false);
    if (blocker) return { ok: false, reason: `part_${blocker}`, part };
    if (!startsLikePick(part)) return { ok: false, reason: "part_does_not_start_like_pick", part };
    if (!hasPickSignal(part)) return { ok: false, reason: "part_missing_pick_signal", part };
    if (countPickMentions(part) !== 1) return { ok: false, reason: "part_not_single_pick", part };
    if (/\b(?:and|or)\s*$/i.test(part.trim()) || /-\s*OR\s*-?\s*$/i.test(part.trim())) {
      return { ok: false, reason: "part_trailing_connector", part };
    }
  }

  return { ok: true, reason: "valid_single_pick_parts" };
}

function classifyMultiPickAsset(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();

  if (!hasPickSignal(raw) || countPickMentions(raw) < 2) {
    return { bucket: "not_multi_pick", reason: "not_multi_pick", parts: [] };
  }

  const blockerAllowAnd = baseBlockReason(raw, true);
  if (blockerAllowAnd) {
    return { bucket: `C_blocked_${blockerAllowAnd}`, reason: blockerAllowAnd, parts: [] };
  }

  const punctParts = splitTopLevelByConnector(raw, "punct");
  const punctValid = validateSinglePickParts(punctParts);
  if (punctValid.ok) {
    return { bucket: "C1_safe_preview_punct_delimited_pick_list", reason: punctValid.reason, parts: punctParts };
  }

  const andParts = splitTopLevelByConnector(raw, "and");
  const andValid = validateSinglePickParts(andParts);
  if (andValid.ok) {
    return { bucket: "C2_next_lane_and_delimited_pick_list_preview", reason: andValid.reason, parts: andParts };
  }

  if (/\band\b/i.test(raw)) {
    return {
      bucket: "C3_and_word_multi_pick_review",
      reason: andValid.reason || "and_word_not_safely_split",
      parts: andParts
    };
  }

  return {
    bucket: "C4_multi_pick_other_review",
    reason: punctValid.reason || andValid.reason || "unclassified_multi_pick",
    parts: punctParts.length > 1 ? punctParts : andParts
  };
}

function firstTopLevelCommaBeforePick(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  let depth = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;

    if (ch === ",") {
      const before = raw.slice(0, i).trim();
      const after = raw.slice(i + 1).trim();
      if (before && after && !hasPickSignal(before) && startsLikePick(after)) {
        return { before, after };
      }
    }
  }

  return null;
}

function classifyPlayerPickAsset(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();

  if (!hasPickSignal(raw)) {
    return { bucket: "D_not_player_pick", reason: "missing_pick_signal", player: "", pickParts: [] };
  }

  if (startsLikePick(raw)) {
    return { bucket: "D_blocked_starts_like_pick", reason: "starts_like_pick_not_player_plus_pick", player: "", pickParts: [] };
  }

  const blocker = baseBlockReason(raw, true);
  if (blocker && blocker !== "and_word_connector_or_prose") {
    return { bucket: `D_blocked_${blocker}`, reason: blocker, player: "", pickParts: [] };
  }

  const comma = firstTopLevelCommaBeforePick(raw);
  if (!comma) {
    return { bucket: "D3_player_pick_review_no_clean_comma_split", reason: "no_clean_player_comma_pick_boundary", player: "", pickParts: [] };
  }

  const player = comma.before;
  const pickText = comma.after;

  const pickClass = classifyMultiPickAsset(pickText);

  if (countPickMentions(pickText) === 1) {
    const v = validateSinglePickParts([pickText, "1999 1st round pick"]); // hack only checks pickText in next lines? do manually below.
    const partBlocker = baseBlockReason(pickText, false);
    if (!partBlocker && startsLikePick(pickText) && hasPickSignal(pickText) && countPickMentions(pickText) === 1) {
      return {
        bucket: "D1_player_comma_single_pick_preview",
        reason: "player_then_single_pick_after_top_level_comma",
        player,
        pickParts: [pickText]
      };
    }
  }

  if (pickClass.bucket === "C1_safe_preview_punct_delimited_pick_list" || pickClass.bucket === "C2_next_lane_and_delimited_pick_list_preview") {
    return {
      bucket: "D2_player_comma_multi_pick_preview",
      reason: "player_then_multi_pick_list_after_top_level_comma",
      player,
      pickParts: pickClass.parts
    };
  }

  return {
    bucket: "D4_player_pick_complex_review",
    reason: pickClass.reason || "complex_player_pick",
    player,
    pickParts: pickClass.parts || []
  };
}

function collectCandidates(splitJson) {
  const buckets = splitJson.buckets || {};
  const out = [];

  for (const [bucketName, items] of Object.entries(buckets)) {
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      out.push({
        ...item,
        sourceBucket: bucketName
      });
    }
  }

  const seen = new Set();
  return out.filter((item) => {
    const key = `${item.id}|||${item.team}|||${item.sourceBucket}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const splitJson = readJson(splitPath);
const candidates = collectCandidates(splitJson);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const results = {};
const samples = {};
const counts = {
  totalCandidatesFromSplitJson: candidates.length,
  targetBucketsFound: 0,
  assetsExamined: 0,
  multiPickAssetsExamined: 0,
  playerPickAssetsExamined: 0,
  errors: 0
};

function addResult(bucket, item) {
  if (!results[bucket]) results[bucket] = [];
  results[bucket].push(item);
  if (!samples[bucket]) samples[bucket] = [];
  if (samples[bucket].length < samplePerBucket) samples[bucket].push(item);
}

for (const candidate of candidates) {
  try {
    const trade = byId.get(candidate.id);
    if (!trade) {
      addResult("missing_trade", { candidate });
      continue;
    }

    const assets = trade.assetsReceived && trade.assetsReceived[candidate.team];
    if (!Array.isArray(assets)) {
      addResult("missing_team_assets", { candidate, slug: trade.slug });
      continue;
    }

    counts.targetBucketsFound++;

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const text = textOf(asset);
      const type = typeOf(asset);
      counts.assetsExamined++;

      const base = {
        id: trade.id,
        slug: trade.slug,
        team: candidate.team,
        sourceBucket: candidate.sourceBucket,
        assetIndex: i,
        assetType: type,
        assetText: text
      };

      const looksMultiPick = hasPickSignal(text) && countPickMentions(text) >= 2;
      const sourceIsMulti = /^S[123]_/.test(candidate.sourceBucket);
      const sourceIsPlayerPick = /^S4_/.test(candidate.sourceBucket) || /^D_/.test(candidate.sourceBucket);

      if (sourceIsMulti && looksMultiPick) {
        counts.multiPickAssetsExamined++;
        const classified = classifyMultiPickAsset(text);
        addResult(classified.bucket, { ...base, reason: classified.reason, parts: classified.parts });
      }

      if (sourceIsPlayerPick && hasPickSignal(text)) {
        counts.playerPickAssetsExamined++;
        const classified = classifyPlayerPickAsset(text);
        addResult(classified.bucket, {
          ...base,
          reason: classified.reason,
          player: classified.player,
          pickParts: classified.pickParts
        });
      }
    }
  } catch (err) {
    counts.errors++;
    addResult("error", { candidate, error: String(err && err.stack || err) });
  }
}

const bucketCounts = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length]));

const lines = [];
lines.push("# NFL C/D Reviewed Bundle Lane Preview v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY PREVIEW");
lines.push("");
lines.push("Purpose:");
lines.push("- Break remaining asset-structure holds into workable reviewed cleanup lanes.");
lines.push("- Focus on C multi-pick bundles and D player+pick bundles.");
lines.push("- Does not write trades.json.");
lines.push("- Does not apply broad auto-splitting.");
lines.push("");
lines.push("## Overall Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Lane Counts");
for (const [k, v] of Object.entries(bucketCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("## Interpretation");
lines.push("- C1/C2 are possible next-lane preview candidates, but still require sample review before any apply script.");
lines.push("- D1/D2 are possible player+pick split preview candidates, but should be even more carefully sampled.");
lines.push("- C3/C4/D3/D4 and blocked buckets should remain manual or specialized-review lanes.");
lines.push("");
lines.push("## Samples By Lane");
for (const [bucket, items] of Object.entries(samples).sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push("");
  lines.push(`### ${bucket}`);
  if (!items.length) {
    lines.push("- none");
    continue;
  }

  for (const item of items) {
    lines.push(`- ${item.id} / ${item.team} / ${item.slug}`);
    lines.push(`  - sourceBucket: ${item.sourceBucket}`);
    lines.push(`  - asset[${item.assetIndex}] ${item.assetType || "asset"}: ${item.assetText}`);
    if (item.reason) lines.push(`  - reason: ${item.reason}`);
    if (item.player) lines.push(`  - playerPart: ${item.player}`);
    if (item.parts && item.parts.length) {
      for (const part of item.parts) lines.push(`  - splitPart: ${part}`);
    }
    if (item.pickParts && item.pickParts.length) {
      for (const part of item.pickParts) lines.push(`  - pickPart: ${part}`);
    }
  }
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, bucketCounts, results, samples }, null, 2) + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
