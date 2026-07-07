const fs = require("fs");
const path = require("path");

const apply = process.argv.includes("--apply");

const dataPath = path.join("src", "data", "nfl", "trades.json");
const outTxt = path.join("reports", "quality", "nfl-post-c2-warning-duplicate-split-parts-fix-v1.txt");
const outJson = path.join("reports", "quality", "nfl-post-c2-warning-duplicate-split-parts-fix-v1.json");

const targets = [
  {
    id: "SEA-1999-04-18-0104",
    team: "cleveland-browns",
    slug: "1999-6th-round-pick-170th-overall-steve-johnson-cleveland-browns-1999",
    duplicateText: "1999 6th round pick (187th overall, Kendall Ogle)",
    unlockedBySplit: "1999 6th round pick (191st overall, James Dearth)"
  },
  {
    id: "SEA-2025-03-09-0239",
    team: "seattle-seahawks",
    slug: "2025-2nd-round-pick-52nd-overall-subsequently-tra-pittsburgh-steelers-2025",
    duplicateText: "2025 7th round pick (223rd overall, Damien Martinez)",
    unlockedBySplit: "2025 2nd round pick (52nd overall, Oluwafemi Oladejo)"
  },
  {
    id: "ATL-1997-0219",
    team: "atlanta-falcons",
    slug: "1997-5th-round-pick-140th-overall-washington-commanders-1997",
    duplicateText: "1997 7th round pick (222nd overall, Chris Bayne)",
    unlockedBySplit: "1997 6th round pick (180th overall, Calvin Collins)"
  },
  {
    id: "TB-2008-0200",
    team: "tampa-bay-buccaneers",
    slug: "2008-7th-round-pick-new-england-patriots-2008",
    duplicateText: "2008 7th round pick",
    unlockedBySplit: "2008 5th round pick (160th overall, Josh Johnson)"
  }
];

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
const byId = new Map(trades.map((trade) => [trade.id, trade]));

const result = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "APPLY" : "DRY-RUN",
  targetCount: targets.length,
  bucketsExamined: 0,
  duplicateCopiesFound: 0,
  duplicateCopiesRemoved: 0,
  bucketsChanged: 0,
  tradesChanged: 0,
  applied: false,
  errors: [],
  warnings: [],
  changes: []
};

for (const target of targets) {
  const change = {
    target,
    foundTrade: false,
    foundTeamBucket: false,
    beforeAssets: [],
    afterAssets: [],
    duplicateMatches: [],
    unlockedMatches: [],
    removeIndex: null,
    status: "pending",
    errors: [],
    warnings: []
  };

  const trade = byId.get(target.id);

  if (!trade) {
    change.errors.push("trade_not_found");
  } else {
    change.foundTrade = true;

    if (trade.slug !== target.slug) {
      change.errors.push(`slug_mismatch_current=${trade.slug}`);
    }

    const bucket = trade.assetsReceived && trade.assetsReceived[target.team];

    if (!Array.isArray(bucket)) {
      change.errors.push("team_bucket_missing_or_not_array");
    } else {
      change.foundTeamBucket = true;
      result.bucketsExamined++;
      change.beforeAssets = bucket.map(summarize);

      change.duplicateMatches = change.beforeAssets.filter((asset) => norm(asset.text) === norm(target.duplicateText));
      change.unlockedMatches = change.beforeAssets.filter((asset) => norm(asset.text) === norm(target.unlockedBySplit));

      if (change.duplicateMatches.length !== 2) {
        change.errors.push(`expected_exactly_2_duplicate_matches_found_${change.duplicateMatches.length}`);
      }

      if (change.unlockedMatches.length !== 1) {
        change.errors.push(`expected_exactly_1_unlocked_split_asset_found_${change.unlockedMatches.length}`);
      }

      if (change.errors.length === 0) {
        // Keep the first occurrence for stability and remove the later duplicate.
        change.removeIndex = Math.max(...change.duplicateMatches.map((asset) => asset.index));

        const after = bucket.filter((_, index) => index !== change.removeIndex);
        change.afterAssets = after.map(summarize);
        change.status = "ready";

        result.duplicateCopiesFound += change.duplicateMatches.length;

        if (apply) {
          trade.assetsReceived[target.team] = after;
          appendQaNote(trade, "Post-C2 cleanup: removed exact duplicate split pick already present in team asset bucket.");
        }
      } else {
        change.afterAssets = change.beforeAssets;
      }
    }
  }

  if (change.errors.length > 0) {
    result.errors.push(`${target.id}/${target.team}: ${change.errors.join("; ")}`);
  }

  if (change.warnings.length > 0) {
    result.warnings.push(`${target.id}/${target.team}: ${change.warnings.join("; ")}`);
  }

  result.changes.push(change);
}

const readyChanges = result.changes.filter((change) => change.status === "ready");

if (result.errors.length === 0) {
  result.duplicateCopiesRemoved = readyChanges.length;
  result.bucketsChanged = new Set(readyChanges.map((change) => `${change.target.id}|||${change.target.team}`)).size;
  result.tradesChanged = new Set(readyChanges.map((change) => change.target.id)).size;

  if (apply) {
    const backupPath = dataPath + `.post-c2-warning-duplicate-split-parts-backup-${Date.now()}.bak`;
    fs.copyFileSync(dataPath, backupPath);
    writeJson(dataPath, setTrades(raw, trades));
    result.applied = true;
    result.backupPath = backupPath;
  }
}

const lines = [];
lines.push("# NFL Post-C2 Warning Duplicate Split Parts Fix v1");
lines.push(`Generated: ${result.generatedAt}`);
lines.push(`Mode: ${result.mode}`);
lines.push("");
lines.push("## Summary");
lines.push(`- targetCount: ${result.targetCount}`);
lines.push(`- bucketsExamined: ${result.bucketsExamined}`);
lines.push(`- duplicateCopiesFound: ${result.duplicateCopiesFound}`);
lines.push(`- duplicateCopiesRemoved: ${result.duplicateCopiesRemoved}`);
lines.push(`- bucketsChanged: ${result.bucketsChanged}`);
lines.push(`- tradesChanged: ${result.tradesChanged}`);
lines.push(`- applied: ${result.applied}`);
lines.push(`- errors: ${result.errors.length}`);
lines.push(`- warnings: ${result.warnings.length}`);
if (result.backupPath) lines.push(`- backupPath: ${result.backupPath}`);
lines.push("");
lines.push("## Meaning");
lines.push("- C2 split created standalone pick assets from clean and-delimited pick bundles.");
lines.push("- Four split parts were already present elsewhere in the same team bucket.");
lines.push("- This fix removes one exact duplicate copy per affected bucket and keeps the unique newly exposed split asset.");
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
for (const change of result.changes) {
  lines.push("");
  lines.push(`### ${change.target.id} / ${change.target.team}`);
  lines.push(`- slug: ${change.target.slug}`);
  lines.push(`- duplicateText: ${change.target.duplicateText}`);
  lines.push(`- unlockedBySplit: ${change.target.unlockedBySplit}`);
  lines.push(`- duplicateMatches: ${change.duplicateMatches.length}`);
  lines.push(`- unlockedMatches: ${change.unlockedMatches.length}`);
  lines.push(`- removeIndex: ${change.removeIndex}`);
  lines.push(`- status: ${change.status}`);

  lines.push("- before:");
  for (const asset of change.beforeAssets) lines.push(`  - [${asset.index}] ${asset.type || "asset"} :: ${asset.text}`);

  lines.push("- after:");
  for (const asset of change.afterAssets) lines.push(`  - [${asset.index}] ${asset.type || "asset"} :: ${asset.text}`);
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");
fs.writeFileSync(outJson, JSON.stringify(result, null, 2) + "\n");

console.log(lines.join("\n"));

if (result.errors.length > 0) {
  console.error("\nSTOP: Errors found. No data was written.");
  process.exit(1);
}
