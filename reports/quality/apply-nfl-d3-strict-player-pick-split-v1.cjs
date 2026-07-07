const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");

const dataPath = path.join("src", "data", "nfl", "trades.json");
const reviewPath = path.join("reports", "quality", "nfl-d3-player-pick-remaining-lanes-review-v1.json");
const outTxt = path.join("reports", "quality", "nfl-d3-strict-player-pick-split-apply-v1.txt");
const outJson = path.join("reports", "quality", "nfl-d3-strict-player-pick-split-apply-v1.json");

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
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) risks.push("explanatory_or_contingent");

  return [...new Set(risks)];
}

function roleCheck(role) {
  const text = String(role && role.text ? role.text : "").trim();
  const roleName = String(role && role.role ? role.role : "");
  const errors = [];

  if (!text) errors.push("empty_text");

  if (roleName === "clean_pick") {
    const risks = hardRiskFlags(text);
    if (risks.length > 0) errors.push(`pick_hardRisk=${risks.join("|")}`);
    if (!startsLikePick(text)) errors.push("pick_does_not_start_like_pick");
    if (!hasPickSignal(text)) errors.push("pick_missing_pick_signal");
    const picks = countPickMentions(text);
    if (picks !== 1) errors.push(`pickMentions=${picks}`);
  } else if (roleName === "clean_player") {
    if (hasPickSignal(text)) errors.push("player_has_pick_signal");
    if (hardRiskFlags(text).length > 0) errors.push(`player_hardRisk=${hardRiskFlags(text).join("|")}`);
    if (!/^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4}$/.test(text)) errors.push("player_name_shape_failed");
  } else {
    errors.push(`unexpected_role=${roleName}`);
  }

  return { text, role: roleName, ok: errors.length === 0, errors };
}

function makeAsset(originalAsset, role) {
  const roleName = role.role;
  const partText = role.text;
  const type = roleName === "clean_player" ? "player" : "pick";

  if (originalAsset && typeof originalAsset === "object" && !Array.isArray(originalAsset)) {
    return {
      ...originalAsset,
      type,
      asset: partText
    };
  }

  return {
    type,
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

const strictItems = reviewed.filter((item) => item.reviewClass === "candidate_strict");
const warningItems = reviewed.filter((item) => item.reviewClass === "candidate_warning");
const manualItems = reviewed.filter((item) => item.reviewClass === "manual");
const blockedItems = reviewed.filter((item) => item.reviewClass === "blocked");

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
  bundledAssetsReplaced: 0,
  standaloneAssetsCreated: 0,
  playerAssetsCreated: 0,
  pickAssetsCreated: 0,
  netAssetIncrease: 0,
  applied: false,
  errors: [],
  warnings: [],
  changes: []
};

if (strictItems.length === 0) {
  result.errors.push("No candidate_strict items found. Refusing to run.");
}

for (const item of strictItems) {
  const roles = Array.isArray(item.roles) ? item.roles : [];

  const change = {
    ordinal: item.ordinal,
    id: item.id,
    team: item.team,
    slug: item.slug,
    lane: item.lane,
    sourceLaneKey: item.sourceLaneKey,
    assetIndex: item.assetIndex,
    before: item.before,
    roles,
    parts: roles.map((r) => r.text),
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

      if (roles.length < 2 || roles.length > 4) {
        change.errors.push(`unexpected_role_count=${roles.length}`);
      }

      const checks = roles.map(roleCheck);

      for (const check of checks) {
        if (!check.ok) change.errors.push(`unsafe_role=[${check.role} :: ${check.text}] ${check.errors.join("|")}`);
      }

      const playerCount = checks.filter((check) => check.role === "clean_player").length;
      const pickCount = checks.filter((check) => check.role === "clean_pick").length;

      if (playerCount !== 1) change.errors.push(`expected_one_player_found=${playerCount}`);
      if (pickCount < 1) change.errors.push(`expected_at_least_one_pick_found=${pickCount}`);

      const partKeys = new Set();

      for (const role of roles) {
        const key = normalizeForDupe(role.text);
        if (partKeys.has(key)) change.errors.push(`duplicate_proposed_part=${role.text}`);
        partKeys.add(key);
      }

      const otherAssetTexts = new Set(bucket
        .filter((_, index) => index !== item.assetIndex)
        .map((asset) => normalizeForDupe(textOf(asset))));

      const duplicateAgainstExisting = roles
        .map((role) => role.text)
        .filter((part) => otherAssetTexts.has(normalizeForDupe(part)));

      if (duplicateAgainstExisting.length > 0) {
        change.errors.push(`split_part_already_exists_elsewhere=${duplicateAgainstExisting.join(" | ")}`);
      }

      if (change.errors.length === 0) {
        const afterAssets = roles.map((role) => makeAsset(currentAsset, role));
        change.afterAssetsPreview = afterAssets.map(summarize);
        change.afterAssets = afterAssets;
        change.status = "ready";
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
  result.standaloneAssetsCreated = readyChanges.reduce((sum, change) => sum + change.roles.length, 0);
  result.playerAssetsCreated = readyChanges.reduce((sum, change) => sum + change.roles.filter((role) => role.role === "clean_player").length, 0);
  result.pickAssetsCreated = readyChanges.reduce((sum, change) => sum + change.roles.filter((role) => role.role === "clean_pick").length, 0);
  result.netAssetIncrease = result.standaloneAssetsCreated - result.bundledAssetsReplaced;
  result.tradesTouched = new Set(readyChanges.map((change) => change.id)).size;
  result.teamBucketsTouched = new Set(readyChanges.map((change) => `${change.id}|||${change.team}`)).size;

  if (apply) {
    const backupPath = dataPath + `.d3-strict-player-pick-split-backup-${Date.now()}.bak`;
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

      appendQaNote(trade, "D3 cleanup: split strict player-plus-pick bundle assets into standalone player and pick assets.");
    }

    writeJson(dataPath, setTrades(raw, trades));
    result.applied = true;
    result.backupPath = backupPath;
  }
}

const laneCounts = {};
for (const change of readyChanges) {
  laneCounts[change.lane] = (laneCounts[change.lane] || 0) + 1;
}

result.laneCounts = laneCounts;

const lines = [];
lines.push("# NFL D3 Strict Player+Pick Split Apply v1");
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
lines.push(`- bundledAssetsReplaced: ${result.bundledAssetsReplaced}`);
lines.push(`- standaloneAssetsCreated: ${result.standaloneAssetsCreated}`);
lines.push(`- playerAssetsCreated: ${result.playerAssetsCreated}`);
lines.push(`- pickAssetsCreated: ${result.pickAssetsCreated}`);
lines.push(`- netAssetIncrease: ${result.netAssetIncrease}`);
lines.push(`- applied: ${result.applied}`);
lines.push(`- errors: ${result.errors.length}`);
lines.push(`- warnings: ${result.warnings.length}`);
if (result.backupPath) lines.push(`- backupPath: ${result.backupPath}`);
lines.push("");
lines.push("## Lane Counts Applied");
if (Object.keys(laneCounts).length === 0) {
  lines.push("- none");
} else {
  for (const [k, v] of Object.entries(laneCounts).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${k}: ${v}`);
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
  lines.push(`- lane: ${change.lane}`);
  lines.push(`- slug: ${change.slug}`);
  lines.push(`- assetIndex: ${change.assetIndex}`);
  lines.push(`- before: ${change.before}`);
  for (const role of change.roles) lines.push(`- after: ${role.role} :: ${role.text}`);
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify(result, null, 2) + "\n");

console.log(lines.join("\n"));

if (result.errors.length > 0) {
  console.error("\nSTOP: Errors found. No data was written.");
  process.exit(1);
}
