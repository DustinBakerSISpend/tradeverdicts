const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");

const dataPath = path.join("src", "data", "nfl", "trades.json");
const reportTxt = path.join("reports", "quality", "fix-jax-1999-0012-split-malformed-dupe-pair.txt");
const reportJson = path.join("reports", "quality", "fix-jax-1999-0012-split-malformed-dupe-pair.json");

const target = {
  id: "JAX-1999-0012",
  slug: "1999-6th-round-pick-182nd-overall-tampa-bay-buccaneers-1999",
  team: "tampa-bay-buccaneers",
  keepExact: "1999 6th round pick (195th overall, Lamarr Glenn)",
  removeFragments: [
    { type: "pick", text: "1999 6th round pick (195th overall" },
    { type: "player", text: "Lamarr Glenn)" }
  ],
  expectedKeepAlsoPresent: [
    "1999 7th round pick (233rd overall, Autry Denson)",
    "Draft-pick compensation"
  ],
  qaNote: "Single safe asset-dupe cleanup: removed split malformed duplicate 1999 sixth-round pick/Lamarr Glenn fragments from Tampa Bay bucket."
};

function getTrades(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.trades)) return raw.trades;
  throw new Error("Could not locate trades array.");
}

function setTrades(raw, trades) {
  if (Array.isArray(raw)) return trades;
  raw.trades = trades;
  return raw;
}

function assetText(asset) {
  if (asset == null) return "";
  if (typeof asset === "string") return asset;
  if (typeof asset !== "object") return String(asset);
  return asset.asset || asset.name || asset.label || asset.description || asset.value || "";
}

function assetType(asset) {
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

function summarizeAsset(asset, index) {
  return {
    index,
    type: assetType(asset),
    text: assetText(asset),
    raw: asset
  };
}

function appendQaNote(trade, note) {
  const existing = String(trade.qaNotes || "");
  if (existing.includes(note)) return;
  trade.qaNotes = existing ? `${existing} | ${note}` : note;
}

function matchesFragment(asset, fragment) {
  return norm(assetType(asset)) === norm(fragment.type) && norm(assetText(asset)) === norm(fragment.text);
}

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
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
  keepMatches: [],
  fragmentMatches: [],
  expectedKeepAlsoPresentMatches: [],
  changed: false,
  applied: false,
  errors: [],
  warnings: []
};

if (!trade) {
  result.errors.push(`Target trade not found by id=${target.id} or slug=${target.slug}`);
} else {
  result.foundTrade = true;
  result.trade = {
    id: trade.id,
    slug: trade.slug,
    verdict: trade.verdict,
    confidence: trade.confidence,
    tier: trade.tier,
    teams: trade.teams
  };

  const bucket = trade.assetsReceived && trade.assetsReceived[target.team];

  if (!Array.isArray(bucket)) {
    result.errors.push(`Target team bucket not found or not array: ${target.team}`);
  } else {
    result.foundTeamBucket = true;
    result.beforeAssets = bucket.map(summarizeAsset);

    result.keepMatches = result.beforeAssets.filter((item) => norm(item.text) === norm(target.keepExact));

    for (const fragment of target.removeFragments) {
      const matches = result.beforeAssets.filter((item) => norm(item.type) === norm(fragment.type) && norm(item.text) === norm(fragment.text));
      result.fragmentMatches.push({
        fragment,
        count: matches.length,
        matches
      });
    }

    for (const keepText of target.expectedKeepAlsoPresent) {
      const matches = result.beforeAssets.filter((item) => norm(item.text) === norm(keepText));
      result.expectedKeepAlsoPresentMatches.push({
        text: keepText,
        count: matches.length,
        matches
      });
    }

    if (result.keepMatches.length !== 1) {
      result.errors.push(`Expected exactly 1 keeper asset [${target.keepExact}]; found ${result.keepMatches.length}.`);
    }

    for (const fragmentResult of result.fragmentMatches) {
      if (fragmentResult.count !== 1) {
        result.errors.push(`Expected exactly 1 fragment asset [${fragmentResult.fragment.type} :: ${fragmentResult.fragment.text}]; found ${fragmentResult.count}.`);
      }
    }

    for (const keepResult of result.expectedKeepAlsoPresentMatches) {
      if (keepResult.count !== 1) {
        result.warnings.push(`Expected supporting keep asset [${keepResult.text}] count 1; found ${keepResult.count}.`);
      }
    }

    if (result.errors.length === 0) {
      const after = bucket.filter((asset) => !target.removeFragments.some((fragment) => matchesFragment(asset, fragment)));
      result.afterAssets = after.map(summarizeAsset);
      result.changed = JSON.stringify(bucket) !== JSON.stringify(after);

      if (!result.changed) {
        result.errors.push("Computed after bucket is unchanged; refusing to apply.");
      } else if (apply) {
        const backupPath = dataPath + `.jax-1999-0012-split-malformed-dupe-pair-backup-${Date.now()}.bak`;
        fs.copyFileSync(dataPath, backupPath);
        trade.assetsReceived[target.team] = after;
        appendQaNote(trade, target.qaNote);
        fs.writeFileSync(dataPath, JSON.stringify(setTrades(raw, trades), null, 2) + "\n");
        result.applied = true;
        result.backupPath = backupPath;
      }
    } else {
      result.afterAssets = result.beforeAssets;
    }
  }
}

const lines = [];
lines.push("# JAX-1999-0012 Split Malformed Dupe Pair Cleanup");
lines.push(`Generated: ${result.generatedAt}`);
lines.push(`Mode: ${result.mode}`);
lines.push("");
lines.push("## Target");
lines.push(`- id: ${target.id}`);
lines.push(`- slug: ${target.slug}`);
lines.push(`- team: ${target.team}`);
lines.push(`- keep: ${target.keepExact}`);
for (const fragment of target.removeFragments) lines.push(`- remove fragment: ${fragment.type} :: ${fragment.text}`);
lines.push("");
lines.push("## Result");
lines.push(`- foundTrade: ${result.foundTrade}`);
lines.push(`- foundTeamBucket: ${result.foundTeamBucket}`);
lines.push(`- keepMatches: ${result.keepMatches.length}`);
for (const fragmentResult of result.fragmentMatches) {
  lines.push(`- fragmentMatches ${fragmentResult.fragment.type} :: ${fragmentResult.fragment.text}: ${fragmentResult.count}`);
}
for (const keepResult of result.expectedKeepAlsoPresentMatches) {
  lines.push(`- supportingKeepMatches ${keepResult.text}: ${keepResult.count}`);
}
lines.push(`- changed: ${result.changed}`);
lines.push(`- applied: ${result.applied}`);
lines.push(`- errors: ${result.errors.length}`);
lines.push(`- warnings: ${result.warnings.length}`);
if (result.backupPath) lines.push(`- backupPath: ${result.backupPath}`);
lines.push("");
lines.push("## Before Assets");
for (const asset of result.beforeAssets) lines.push(`- [${asset.index}] ${asset.type || "asset"} :: ${asset.text}`);
lines.push("");
lines.push("## After Assets");
for (const asset of result.afterAssets) lines.push(`- [${asset.index}] ${asset.type || "asset"} :: ${asset.text}`);
lines.push("");
lines.push("## Errors");
if (result.errors.length === 0) lines.push("- none");
for (const err of result.errors) lines.push(`- ${err}`);
lines.push("");
lines.push("## Warnings");
if (result.warnings.length === 0) lines.push("- none");
for (const warn of result.warnings) lines.push(`- ${warn}`);

fs.writeFileSync(reportTxt, lines.join("\n") + "\n");
fs.writeFileSync(reportJson, JSON.stringify(result, null, 2) + "\n");
console.log(lines.join("\n"));

if (result.errors.length > 0) {
  console.error("\nSTOP: Errors found. No data was written.");
  process.exit(1);
}
