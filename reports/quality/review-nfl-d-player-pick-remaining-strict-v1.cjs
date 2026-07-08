const fs = require("fs");
const path = require("path");

const sample = Number(process.argv[2] || 120);

const dataPath = path.join("src", "data", "nfl", "trades.json");
const splitJsonPath = path.join("reports", "quality", "nfl-asset-bundle-split-candidates-v1.json");
const outTxt = path.join("reports", "quality", "nfl-d-player-pick-remaining-strict-review-v1.txt");
const outJson = path.join("reports", "quality", "nfl-d-player-pick-remaining-strict-review-v1.json");
const outCsv = path.join("reports", "quality", "nfl-d-player-pick-remaining-strict-review-v1.csv");

const S4 = "S4_player_plus_pick_bundle_review";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getTrades(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trades)) return raw.trades;
  throw new Error("Could not find trades array.");
}

function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
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

function compact(s) {
  return norm(s).replace(/[^a-z0-9]+/g, "").trim();
}

function looseKey(s) {
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

function countPickMentions(s) {
  const raw = String(s || "");
  const n = norm(raw);
  const yearRoundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)[-\s]+round\s+pick\b/g) || [];
  const noYearRoundPickMatches = n.match(/\b(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)[-\s]+round\s+pick\b/g) || [];
  const draftPickParentheticalMatches = raw.match(/\bdraft pick\s*\(/gi) || [];
  const hashMatches = raw.match(/#\s*\d{1,3}\b/g) || [];
  const overallMatches = raw.match(/\b\d{1,3}(?:st|nd|rd|th)\s+overall\b/gi) || [];
  return Math.max(yearRoundPickMatches.length, noYearRoundPickMatches.length, draftPickParentheticalMatches.length, hashMatches.length, overallMatches.length);
}

function hasPickSignal(s) {
  return /\bpick\b|\bround\b|\boverall\b|#\s*\d{1,3}\b/i.test(String(s || ""));
}

function startsLikePick(s) {
  return /^\s*(?:\d{4}|draft pick|conditional|future|past|undisclosed|unspecified)/i.test(String(s || ""));
}

function strictRiskFlags(s) {
  const raw = String(s || "");
  const risks = [];

  if (!balancedParens(raw)) risks.push("unbalanced_parentheses");
  if (/\band\/or\b/i.test(raw)) risks.push("and_or");
  if (/-\s*OR\s*-/i.test(raw)) risks.push("dash_or");
  if (/\bor\b/i.test(raw)) risks.push("or_word");
  if (/\s\/\s/.test(raw)) risks.push("slash_alternative");
  if (/\b(?:cash|future considerations|past considerations|considerations|player to be named later|ptbnl|conditional on|if )\b/i.test(raw)) risks.push("cash_consideration_ptbnl_conditional");
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) risks.push("explanatory_or_contingent");

  if (/\b(?:traded|trade|trades|sent|send|sends|received|receives|acquired|acquires|dealt|shipped)\b/i.test(raw)) risks.push("transaction_verb_leak");
  if (/\b(?:to|from|for|via)\s*$/i.test(raw)) risks.push("trailing_connector_fragment");
  if (/\)\s*(?:to|from|for|via)\b/i.test(raw)) risks.push("post_parenthetical_route_language");
  if (/[.]\s+[A-Z]/.test(raw)) risks.push("sentence_fragment_leak");

  return [...new Set(risks)];
}

function isStrictSinglePick(text) {
  const risks = strictRiskFlags(text);
  return {
    ok: countPickMentions(text) === 1 && hasPickSignal(text) && startsLikePick(text) && risks.length === 0,
    risks,
    pickMentions: countPickMentions(text)
  };
}

function isLikelyPlayerName(text) {
  const raw = String(text || "").trim();

  if (!raw) return { ok: false, risks: ["empty_player_text"] };
  const risks = [];

  if (strictRiskFlags(raw).length > 0) risks.push(...strictRiskFlags(raw).map((r) => `player_${r}`));
  if (hasPickSignal(raw)) risks.push("player_text_contains_pick_signal");
  if (/\d{4}|\boverall\b|#\s*\d+/i.test(raw)) risks.push("player_text_contains_pick_number_signal");

  const cleaned = raw
    .replace(/^(?:and|plus|,|;|\+|\|)\s+/i, "")
    .replace(/\s+(?:and|plus|,|;|\+|\|)$/i, "")
    .trim();

  // Permit initials, apostrophes, hyphens, suffixes.
  const nameRe = /^[A-Z][A-Za-z.'â€™-]*(?:\s+(?:[A-Z][A-Za-z.'â€™-]*|Jr\.?|Sr\.?|II|III|IV|V)){0,4}$/;

  if (!nameRe.test(cleaned)) risks.push("player_text_not_name_like");

  return {
    ok: risks.length === 0,
    risks: [...new Set(risks)],
    cleaned
  };
}

function findPickSpan(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const startRe = /\b(?:19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)[-\s]+round\s+pick\b/i;
  const m = startRe.exec(raw);
  if (!m) return null;
  return { start: m.index, marker: m[0], raw };
}

function parsePlayerPick(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const span = findPickSpan(raw);

  if (!span) {
    return { ok: false, reason: "no_pick_span", playerText: "", pickText: "", raw };
  }

  const before = raw.slice(0, span.start).trim();
  const pickText = raw.slice(span.start).trim();

  // Prefer player before pick. Example: "John Smith and 2027 7th round pick"
  let playerText = before
    .replace(/\s*(?:and|plus|,|;|\+|\|)\s*$/i, "")
    .trim();

  // Handle pick before player only if clean connector exists after the pick phrase and no transaction language.
  // Not aggressive; most safe D3 cases already got handled.
  if (!playerText) {
    return { ok: false, reason: "no_player_before_pick", playerText: "", pickText, raw };
  }

  return {
    ok: true,
    reason: "parsed_player_before_pick",
    playerText,
    pickText,
    raw
  };
}

function getCurrentMatches(bucket, text, excludeIndex = null) {
  const target = norm(text);
  return bucket
    .map((asset, index) => ({ index, type: typeOf(asset), text: textOf(asset), key: looseKey(textOf(asset)), compact: compact(textOf(asset)), pickMentions: countPickMentions(textOf(asset)) }))
    .filter((asset) => (excludeIndex === null || asset.index !== excludeIndex) && norm(asset.text) === target);
}

function collectS4Items(splitReport) {
  const arr = (((splitReport || {}).buckets || {})[S4]) || [];
  return Array.isArray(arr) ? arr : [];
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const splitReport = fs.existsSync(splitJsonPath) ? readJson(splitJsonPath) : null;
const s4Items = collectS4Items(splitReport);

const reviewed = [];

for (const [idx, item] of s4Items.entries()) {
  const trade = byId.get(item.id);
  const reportAssets = Array.isArray(item.assets) ? item.assets.map((a) => ({
    type: a.type || "",
    text: a.text || textOf(a.raw),
    raw: a.raw || a
  })) : [];

  const out = {
    ordinal: idx + 1,
    id: item.id || "",
    slug: item.slug || "",
    team: item.team || "",
    sourceBucket: item.sourceBucket || "",
    reviewClass: "pending",
    lane: "pending",
    reason: "",
    reportAssets,
    currentBucketFound: false,
    bundleAsset: null,
    playerText: "",
    pickText: "",
    playerCheck: null,
    pickCheck: null,
    existingPlayerMatches: [],
    existingPickMatches: [],
    projectedAssetsToCreate: 0,
    projectedNetAssetChange: 0,
    errors: [],
    warnings: []
  };

  if (!trade) {
    out.reviewClass = "blocked";
    out.lane = "DPP_blocked_trade_not_found";
    out.errors.push("trade_not_found");
    reviewed.push(out);
    continue;
  }

  if (out.slug && trade.slug !== out.slug) out.warnings.push(`slug_mismatch_current=${trade.slug}`);

  const bucket = trade.assetsReceived && trade.assetsReceived[out.team];
  if (!Array.isArray(bucket)) {
    out.reviewClass = "blocked";
    out.lane = "DPP_blocked_team_bucket_missing";
    out.errors.push("team_bucket_missing_or_not_array");
    reviewed.push(out);
    continue;
  }

  out.currentBucketFound = true;

  const hydrated = reportAssets.map((asset) => {
    const matches = getCurrentMatches(bucket, asset.text, null);
    const parse = parsePlayerPick(asset.text);
    return {
      ...asset,
      foundCurrent: matches.length > 0,
      currentMatches: matches,
      pickMentions: countPickMentions(asset.text),
      risks: strictRiskFlags(asset.text),
      parse
    };
  });

  out.reportAssets = hydrated;

  const bundleCandidates = hydrated.filter((asset) => asset.currentMatches.length === 1 && asset.pickMentions === 1 && asset.parse.ok);

  if (bundleCandidates.length !== 1) {
    out.reviewClass = "manual";
    out.lane = "DPP_manual_not_exactly_one_parseable_current_bundle";
    out.reason = `expected exactly one parseable current player+pick bundle, found ${bundleCandidates.length}`;
    reviewed.push(out);
    continue;
  }

  const bundle = bundleCandidates[0];
  out.bundleAsset = bundle;

  const parse = bundle.parse;
  out.playerText = parse.playerText;
  out.pickText = parse.pickText;
  out.playerCheck = isLikelyPlayerName(parse.playerText);
  out.pickCheck = isStrictSinglePick(parse.pickText);

  if ((bundle.type || "") !== "player" && (bundle.type || "") !== "pick" && bundle.type) {
    out.reviewClass = "manual";
    out.lane = "DPP_manual_bundle_type_unexpected";
    out.reason = `bundle type is ${bundle.type}`;
    reviewed.push(out);
    continue;
  }

  if (bundle.risks.length > 0) {
    out.reviewClass = "manual";
    out.lane = "DPP_manual_bundle_has_transaction_or_source_risks";
    out.reason = `bundle risks: ${bundle.risks.join("|")}`;
    reviewed.push(out);
    continue;
  }

  if (!out.playerCheck.ok) {
    out.reviewClass = "manual";
    out.lane = "DPP_manual_player_text_not_strict_name";
    out.reason = `player text risks: ${out.playerCheck.risks.join("|")}`;
    reviewed.push(out);
    continue;
  }

  if (!out.pickCheck.ok) {
    out.reviewClass = "manual";
    out.lane = "DPP_manual_pick_text_not_strict_single_pick";
    out.reason = `pick text risks: ${out.pickCheck.risks.join("|")}`;
    reviewed.push(out);
    continue;
  }

  const bundleIndex = bundle.currentMatches[0].index;
  out.existingPlayerMatches = getCurrentMatches(bucket, out.playerText, bundleIndex);
  out.existingPickMatches = getCurrentMatches(bucket, out.pickText, bundleIndex);

  if (out.existingPlayerMatches.length > 1 || out.existingPickMatches.length > 1) {
    out.reviewClass = "candidate_warning";
    out.lane = "DPP_warning_multiple_existing_part_matches";
    out.reason = "one or more split parts already exists more than once";
    reviewed.push(out);
    continue;
  }

  const playerMissing = out.existingPlayerMatches.length === 0;
  const pickMissing = out.existingPickMatches.length === 0;
  out.projectedAssetsToCreate = Number(playerMissing) + Number(pickMissing);
  out.projectedNetAssetChange = out.projectedAssetsToCreate - 1;

  if (!playerMissing && !pickMissing) {
    out.reviewClass = "candidate_strict";
    out.lane = "DPP1_strict_remove_bundle_player_and_pick_already_exist";
    out.reason = "player+pick bundle already represented by standalone player and pick assets";
  } else if (!playerMissing || !pickMissing) {
    out.reviewClass = "candidate_strict";
    out.lane = "DPP2_strict_split_bundle_create_missing_part_dedupe_existing";
    out.reason = "player+pick bundle splits cleanly; create only missing standalone part";
  } else {
    out.reviewClass = "candidate_strict";
    out.lane = "DPP3_strict_split_player_pick_bundle";
    out.reason = "player+pick bundle splits cleanly into standalone player and pick assets";
  }

  reviewed.push(out);
}

const strict = reviewed.filter((x) => x.reviewClass === "candidate_strict");
const warning = reviewed.filter((x) => x.reviewClass === "candidate_warning");
const manual = reviewed.filter((x) => x.reviewClass === "manual");
const blocked = reviewed.filter((x) => x.reviewClass === "blocked");

const counts = {
  sourceS4Items: s4Items.length,
  totalReviewed: reviewed.length,
  candidateStrictCount: strict.length,
  candidateWarningCount: warning.length,
  manualCount: manual.length,
  blockedCount: blocked.length,
  strictRemoveBundleAllPartsAlreadyExist: strict.filter((x) => x.lane === "DPP1_strict_remove_bundle_player_and_pick_already_exist").length,
  strictSplitCreateMissingDedupeExisting: strict.filter((x) => x.lane === "DPP2_strict_split_bundle_create_missing_part_dedupe_existing").length,
  strictSplitPlayerPickBundles: strict.filter((x) => x.lane === "DPP3_strict_split_player_pick_bundle").length,
  bundlesToReplaceOrRemoveIfStrictApplied: strict.length,
  standaloneAssetsToCreateIfStrictApplied: strict.reduce((sum, x) => sum + x.projectedAssetsToCreate, 0),
  netAssetChangeIfStrictApplied: strict.reduce((sum, x) => sum + x.projectedNetAssetChange, 0),
  errors: 0
};

const laneCounts = {};
const classCounts = {};
const sourceBucketCounts = {};
const warningCounts = {};
const errorCounts = {};
for (const item of reviewed) {
  laneCounts[item.lane] = (laneCounts[item.lane] || 0) + 1;
  classCounts[item.reviewClass] = (classCounts[item.reviewClass] || 0) + 1;
  sourceBucketCounts[item.sourceBucket || "(blank)"] = (sourceBucketCounts[item.sourceBucket || "(blank)"] || 0) + 1;
  for (const warning of item.warnings) warningCounts[warning.split("=")[0]] = (warningCounts[warning.split("=")[0]] || 0) + 1;
  for (const error of item.errors) errorCounts[error] = (errorCounts[error] || 0) + 1;
}

const lines = [];
lines.push("# NFL D Player+Pick Remaining Strict Review v1");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("Mode: READ-ONLY REVIEW PACK");
lines.push("");
lines.push("Purpose:");
lines.push("- Review remaining S4/D-style player+pick bundles after D3 strict lane was exhausted.");
lines.push("- Strict means one current bundle splits cleanly into a name-like player asset plus one strict single pick asset.");
lines.push("- Does not modify trades.json.");
lines.push("");
lines.push("## Counts");
for (const [k, v] of Object.entries(counts)) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Lane Counts");
for (const [k, v] of Object.entries(laneCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Review Class Counts");
for (const [k, v] of Object.entries(classCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Source Bucket Counts");
for (const [k, v] of Object.entries(sourceBucketCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Warning Counts");
if (Object.keys(warningCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(warningCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Error Counts");
if (Object.keys(errorCounts).length === 0) lines.push("- none");
for (const [k, v] of Object.entries(errorCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
lines.push("");
lines.push("## Recommendation");
if (strict.length > 0) {
  lines.push("- A later apply script may target candidate_strict only after sample inspection.");
  lines.push("- DPP1 removes a bundle when standalone player and pick already exist.");
  lines.push("- DPP2 replaces bundle with only missing split part.");
  lines.push("- DPP3 replaces bundle with standalone player and pick assets.");
  lines.push("- Do not apply warning/manual/blocked lanes without separate review.");
} else {
  lines.push("- No strict D player+pick lane found.");
}
lines.push("");
lines.push("## Strict Candidate Samples");
for (const item of strict.slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceBucket: ${item.sourceBucket}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- reason: ${item.reason}`);
  lines.push(`- before: ${item.bundleAsset.text}`);
  lines.push(`- playerText: ${item.playerText}`);
  lines.push(`- pickText: ${item.pickText}`);
  lines.push(`- projectedAssetsToCreate: ${item.projectedAssetsToCreate}`);
  lines.push(`- projectedNetAssetChange: ${item.projectedNetAssetChange}`);
  for (const match of item.existingPlayerMatches) lines.push(`  - existingPlayerMatch: [${match.index}] ${match.type} :: ${match.text}`);
  for (const match of item.existingPickMatches) lines.push(`  - existingPickMatch: [${match.index}] ${match.type} :: ${match.text}`);
}
lines.push("");
lines.push("## Manual/Warning Samples");
for (const item of warning.concat(manual).slice(0, sample)) {
  lines.push("");
  lines.push(`### ${item.ordinal}. ${item.id} / ${item.team}`);
  lines.push(`- class: ${item.reviewClass}`);
  lines.push(`- lane: ${item.lane}`);
  lines.push(`- sourceBucket: ${item.sourceBucket}`);
  lines.push(`- slug: ${item.slug}`);
  lines.push(`- reason: ${item.reason}`);
  for (const asset of item.reportAssets.slice(0, 8)) {
    lines.push(`- reportAsset: found=${asset.foundCurrent} matches=${asset.currentMatches.length} picks=${asset.pickMentions} risks=${asset.risks.join("|") || "none"} :: ${asset.text}`);
  }
  if (item.bundleAsset) {
    lines.push(`- bundle: ${item.bundleAsset.text}`);
    lines.push(`- parsedPlayer: ${item.playerText}`);
    lines.push(`- parsedPick: ${item.pickText}`);
    if (item.playerCheck) lines.push(`- playerCheck: ok=${item.playerCheck.ok} risks=${item.playerCheck.risks.join("|") || "none"}`);
    if (item.pickCheck) lines.push(`- pickCheck: ok=${item.pickCheck.ok} risks=${item.pickCheck.risks.join("|") || "none"}`);
  }
}

const csvRows = [];
csvRows.push([
  "ordinal",
  "reviewClass",
  "lane",
  "sourceBucket",
  "id",
  "team",
  "slug",
  "reason",
  "bundle",
  "playerText",
  "pickText",
  "projectedAssetsToCreate",
  "projectedNetAssetChange",
  "warnings",
  "errors"
].map(csvEscape).join(","));

for (const item of reviewed) {
  csvRows.push([
    item.ordinal,
    item.reviewClass,
    item.lane,
    item.sourceBucket,
    item.id,
    item.team,
    item.slug,
    item.reason,
    item.bundleAsset ? item.bundleAsset.text : "",
    item.playerText,
    item.pickText,
    item.projectedAssetsToCreate,
    item.projectedNetAssetChange,
    item.warnings.join("|"),
    item.errors.join("|")
  ].map(csvEscape).join(","));
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify({ counts, laneCounts, classCounts, sourceBucketCounts, warningCounts, errorCounts, reviewed, candidateStrict: strict, candidateWarning: warning, manual, blocked }, null, 2) + "\n");
fs.writeFileSync(outCsv, csvRows.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\nWrote: ${outTxt}`);
console.log(`Wrote: ${outJson}`);
console.log(`Wrote: ${outCsv}`);
