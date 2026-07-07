const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");

const dataPath = path.join("src", "data", "nfl", "trades.json");
const outTxt = path.join("reports", "quality", "nfl-min-2017-c3a-single-multipick-split-v1.txt");
const outJson = path.join("reports", "quality", "nfl-min-2017-c3a-single-multipick-split-v1.json");

const target = {
  id: "MIN-2017-04-28-0262",
  slug: "draft-pick-trade-san-francisco-49ers-2017",
  team: "minnesota-vikings",
  assetIndex: 0,
  before: "2017 4th-round pick (#109 Jaleel Johnson) and 2017 7th-round pick (#219 Stacy Coley)",
  parts: [
    "2017 4th-round pick (#109 Jaleel Johnson)",
    "2017 7th-round pick (#219 Stacy Coley)"
  ],
  qaNote: "C3A cleanup: split one clean two-part multi-pick bundle into standalone pick assets."
};

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

function countPickMentions(s) {
  const raw = String(s || "");
  const n = norm(raw);
  const roundPickMatches = n.match(/\b(19|20)\d{2}\s+(?:conditional\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)[-\s]+round\s+pick\b/g) || [];
  const hashMatches = raw.match(/#\s*\d{1,3}\b/g) || [];
  const overallMatches = raw.match(/\b\d{1,3}(?:st|nd|rd|th)\s+overall\b/gi) || [];
  return Math.max(roundPickMatches.length, hashMatches.length, overallMatches.length);
}

function riskFlags(s) {
  const raw = String(s || "");
  const risks = [];
  let depth = 0;

  for (const ch of raw) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) risks.push("unbalanced_parentheses");
  }

  if (depth !== 0) risks.push("unbalanced_parentheses");
  if (/\band\/or\b/i.test(raw)) risks.push("and_or");
  if (/-\s*OR\s*-/i.test(raw)) risks.push("dash_or");
  if (/\bor\b/i.test(raw)) risks.push("or_word");
  if (/\s\/\s/.test(raw)) risks.push("slash_alternative");
  if (/\b(?:awarded|replaced|because|after|later|subsequently|property of|ruled property|probably|instead|void|forfeited)\b/i.test(raw)) risks.push("explanatory_or_contingent");
  if (/\b(?:cash|future considerations|past considerations|considerations|player to be named later|ptbnl|conditional on|if )\b/i.test(raw)) risks.push("cash_consideration_ptbnl_conditional");
  return [...new Set(risks)];
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
    text: textOf(asset),
    raw: asset
  };
}

function appendQaNote(trade, note) {
  const existing = String(trade.qaNotes || "");
  if (existing.includes(note)) return;
  trade.qaNotes = existing ? `${existing} | ${note}` : note;
}

const raw = readJson(dataPath);
const trades = getTrades(raw);
const trade = trades.find((item) => item.id === target.id || item.slug === target.slug);

const result = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "APPLY" : "DRY-RUN",
  target,
  foundTrade: false,
  foundTeamBucket: false,
  beforeAssets: [],
  afterAssets: [],
  plannedBeforeAsset: null,
  plannedAfterAssets: [],
  applied: false,
  changed: false,
  errors: [],
  warnings: []
};

if (!trade) {
  result.errors.push(`Target trade not found: ${target.id} / ${target.slug}`);
} else {
  result.foundTrade = true;

  if (trade.slug !== target.slug) {
    result.errors.push(`Slug mismatch. Expected ${target.slug}; current ${trade.slug}`);
  }

  const bucket = trade.assetsReceived && trade.assetsReceived[target.team];

  if (!Array.isArray(bucket)) {
    result.errors.push(`Target team bucket missing or not array: ${target.team}`);
  } else {
    result.foundTeamBucket = true;
    result.beforeAssets = bucket.map(summarize);

    if (target.assetIndex < 0 || target.assetIndex >= bucket.length) {
      result.errors.push(`Asset index out of range: ${target.assetIndex}; bucket length ${bucket.length}`);
    } else {
      const currentAsset = bucket[target.assetIndex];
      const currentText = textOf(currentAsset);
      result.plannedBeforeAsset = summarize(currentAsset, target.assetIndex);

      if (norm(currentText) !== norm(target.before)) {
        result.errors.push(`Asset text mismatch. Expected [${target.before}], current [${currentText}]`);
      }

      const partNorms = new Set();

      for (const part of target.parts) {
        const risks = riskFlags(part);
        if (risks.length > 0) {
          result.errors.push(`Unsafe part risks for [${part}]: ${risks.join(", ")}`);
        }

        if (countPickMentions(part) !== 1) {
          result.errors.push(`Expected one pick mention in part [${part}], found ${countPickMentions(part)}`);
        }

        if (!/^\s*(19|20)\d{2}\s+.+pick\b/i.test(part)) {
          result.errors.push(`Part does not start like year pick: [${part}]`);
        }

        const key = normalizeForDupe(part);
        if (partNorms.has(key)) result.errors.push(`Duplicate proposed part: [${part}]`);
        partNorms.add(key);
      }

      const otherAssets = bucket.filter((_, idx) => idx !== target.assetIndex);
      const otherTextSet = new Set(otherAssets.map((asset) => normalizeForDupe(textOf(asset))));
      const duplicateAgainstExisting = target.parts.filter((part) => otherTextSet.has(normalizeForDupe(part)));

      if (duplicateAgainstExisting.length > 0) {
        result.warnings.push(`Proposed part already exists elsewhere in bucket: ${duplicateAgainstExisting.join(" | ")}`);
      }

      if (result.errors.length === 0) {
        const afterAssets = target.parts.map((part) => makePickAsset(currentAsset, part));
        result.plannedAfterAssets = afterAssets.map(summarize);
        const afterBucket = [
          ...bucket.slice(0, target.assetIndex),
          ...afterAssets,
          ...bucket.slice(target.assetIndex + 1)
        ];

        result.afterAssets = afterBucket.map(summarize);
        result.changed = JSON.stringify(bucket) !== JSON.stringify(afterBucket);

        if (!result.changed) {
          result.errors.push("Computed after bucket is unchanged; refusing to apply.");
        } else if (apply) {
          const backupPath = dataPath + `.min-2017-c3a-single-multipick-split-backup-${Date.now()}.bak`;
          fs.copyFileSync(dataPath, backupPath);
          trade.assetsReceived[target.team] = afterBucket;
          appendQaNote(trade, target.qaNote);
          writeJson(dataPath, setTrades(raw, trades));
          result.applied = true;
          result.backupPath = backupPath;
        }
      } else {
        result.afterAssets = result.beforeAssets;
      }
    }
  }
}

const lines = [];
lines.push("# MIN-2017 C3A Single Multi-Pick Split v1");
lines.push(`Generated: ${result.generatedAt}`);
lines.push(`Mode: ${result.mode}`);
lines.push("");
lines.push("## Summary");
lines.push(`- id: ${target.id}`);
lines.push(`- slug: ${target.slug}`);
lines.push(`- team: ${target.team}`);
lines.push(`- assetIndex: ${target.assetIndex}`);
lines.push(`- foundTrade: ${result.foundTrade}`);
lines.push(`- foundTeamBucket: ${result.foundTeamBucket}`);
lines.push(`- changed: ${result.changed}`);
lines.push(`- applied: ${result.applied}`);
lines.push(`- errors: ${result.errors.length}`);
lines.push(`- warnings: ${result.warnings.length}`);
if (result.backupPath) lines.push(`- backupPath: ${result.backupPath}`);
lines.push("");
lines.push("## Planned Split");
lines.push(`- before: ${target.before}`);
for (const part of target.parts) lines.push(`- after: ${part}`);
lines.push("");
lines.push("## Errors");
if (result.errors.length === 0) lines.push("- none");
for (const error of result.errors) lines.push(`- ${error}`);
lines.push("");
lines.push("## Warnings");
if (result.warnings.length === 0) lines.push("- none");
for (const warning of result.warnings) lines.push(`- ${warning}`);
lines.push("");
lines.push("## Before Assets");
for (const asset of result.beforeAssets) lines.push(`- [${asset.index}] ${asset.type || "asset"} :: ${asset.text}`);
lines.push("");
lines.push("## After Assets");
for (const asset of result.afterAssets) lines.push(`- [${asset.index}] ${asset.type || "asset"} :: ${asset.text}`);

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify(result, null, 2) + "\n");
console.log(lines.join("\n"));

if (result.errors.length > 0) {
  console.error("\nSTOP: Errors found. No data was written.");
  process.exit(1);
}
