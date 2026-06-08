const fs = require("fs");
const path = require("path");

const REVIEW_FILE = path.join(__dirname, "..", "src", "data", "nfl", "combined-asset-duplicate-review.json");
const SUPPRESSIONS_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trade-suppressions.json");
const OUT_REPORT_FILE = path.join(__dirname, "..", "src", "data", "nfl", "combined-asset-resolution-report.json");

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function hasBadTeamKey(record) {
  const text = JSON.stringify({
    teams: record.teams || [],
    sourceTeams: record.sourceTeams || [],
    canonicalKey: record.canonicalKey || "",
    dateTeamsKey: record.dateTeamsKey || "",
    assetsReceived: record.assetsReceived || {},
  }).toLowerCase();

  return (
    text.includes("los-angeles-cleveland-st-louis-rams") ||
    text.includes("oakland-los-angeles-las-vegas-raiders") ||
    text.includes("washington-commanders-redskins") ||
    text.includes("washington-redskins-commanders")
  );
}

function countAssetObjects(record) {
  let count = 0;
  for (const assets of Object.values(record.assetsReceived || {})) {
    count += Array.isArray(assets) ? assets.length : 0;
  }
  return count;
}

function countCombinedAssets(record) {
  let count = 0;
  for (const assets of Object.values(record.assetsReceived || {})) {
    for (const item of assets || []) {
      const asset = clean(item.asset).toLowerCase();
      if (
        asset.includes(" and ") &&
        asset.match(/\d{4}\s+\d+(st|nd|rd|th)\s+round\s+pick/g)?.length > 1
      ) {
        count++;
      }
    }
  }
  return count;
}

function gradeRank(grade) {
  const g = clean(grade).toUpperCase();
  const ranks = {
    "A+": 13,
    A: 12,
    "A-": 11,
    "B+": 10,
    B: 9,
    "B-": 8,
    "C+": 7,
    C: 6,
    "C-": 5,
    "D+": 4,
    D: 3,
    "D-": 2,
    F: 1,
  };
  return ranks[g] || 0;
}

function gradeScore(record) {
  return Object.values(record.grades || {}).reduce((sum, grade) => sum + gradeRank(grade), 0);
}

function recordScore(record) {
  let score = 0;

  // Prefer clean normalized team keys.
  if (!hasBadTeamKey(record)) score += 1000;

  // Prefer records with split asset objects over combined asset strings.
  score += countAssetObjects(record) * 100;
  score -= countCombinedAssets(record) * 250;

  // Prefer records with a source-team match and richer record structure.
  score += (record.sourceTeams || []).length * 50;

  // Prefer more useful slugs.
  if (!clean(record.slug).includes("unknown")) score += 25;
  if (clean(record.slug).length > 20) score += 10;

  // Prefer stronger reviewed grades if all else is close.
  score += gradeScore(record);

  return score;
}

function chooseKeeper(records) {
  const ranked = [...records].sort((a, b) => {
    const scoreDiff = recordScore(b) - recordScore(a);
    if (scoreDiff !== 0) return scoreDiff;

    const badA = hasBadTeamKey(a) ? 1 : 0;
    const badB = hasBadTeamKey(b) ? 1 : 0;
    if (badA !== badB) return badA - badB;

    const assetDiff = countAssetObjects(b) - countAssetObjects(a);
    if (assetDiff !== 0) return assetDiff;

    return clean(a.id).localeCompare(clean(b.id));
  });

  return ranked[0];
}

function normalizeExistingSuppressions(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") {
        return {
          id: item,
          reason: "legacy-string-suppression",
          keep: "",
          note: "",
        };
      }

      return {
        id: clean(item.id),
        reason: clean(item.reason) || "manual-suppression",
        keep: clean(item.keep),
        note: clean(item.note),
      };
    })
    .filter((item) => item.id);
}

function main() {
  if (!DRY_RUN && !APPLY) {
    console.error("Safety stop: run with --dry-run or --apply.");
    console.error("Example: node scripts/resolve-combined-asset-duplicates.cjs --dry-run");
    console.error("Example: node scripts/resolve-combined-asset-duplicates.cjs --apply");
    process.exit(1);
  }

  if (!fs.existsSync(REVIEW_FILE)) {
    console.error(`Missing review file: ${REVIEW_FILE}`);
    console.error("Run: node scripts/audit-combined-asset-duplicates.cjs");
    process.exit(1);
  }

  if (!fs.existsSync(SUPPRESSIONS_FILE)) {
    fs.writeFileSync(SUPPRESSIONS_FILE, JSON.stringify([], null, 2));
  }

  const reviewGroups = JSON.parse(fs.readFileSync(REVIEW_FILE, "utf8"));
  const existingSuppressions = normalizeExistingSuppressions(
    JSON.parse(fs.readFileSync(SUPPRESSIONS_FILE, "utf8"))
  );

  const byId = new Map(existingSuppressions.map((item) => [item.id, item]));
  const decisions = [];
  const skipped = [];

  for (const group of reviewGroups) {
    const records = group.records || [];

    if (records.length !== 2) {
      skipped.push({
        key: group.key || "",
        reason: "not-exactly-two-records",
        ids: records.map((record) => record.id),
      });
      continue;
    }

    const keeper = chooseKeeper(records);
    const losers = records.filter((record) => record.id !== keeper.id);

    for (const loser of losers) {
      const suppression = {
        id: loser.id,
        reason: "duplicate-combined-asset",
        keep: keeper.id,
        note: `Auto-resolved combined/split asset duplicate. Kept ${keeper.id}; suppressed ${loser.id}.`,
      };

      decisions.push({
        key: group.key || "",
        keeper: {
          id: keeper.id,
          slug: keeper.slug,
          score: recordScore(keeper),
          hasBadTeamKey: hasBadTeamKey(keeper),
          assetObjectCount: countAssetObjects(keeper),
          combinedAssetCount: countCombinedAssets(keeper),
        },
        suppressed: {
          id: loser.id,
          slug: loser.slug,
          score: recordScore(loser),
          hasBadTeamKey: hasBadTeamKey(loser),
          assetObjectCount: countAssetObjects(loser),
          combinedAssetCount: countCombinedAssets(loser),
        },
      });

      if (!byId.has(suppression.id)) {
        byId.set(suppression.id, suppression);
      }
    }
  }

  const nextSuppressions = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));

  const report = {
    dryRun: DRY_RUN,
    reviewGroups: reviewGroups.length,
    decisions: decisions.length,
    existingSuppressions: existingSuppressions.length,
    finalSuppressions: nextSuppressions.length,
    skipped,
    decisions,
  };

  fs.writeFileSync(OUT_REPORT_FILE, JSON.stringify(report, null, 2));

  if (APPLY) {
    fs.writeFileSync(SUPPRESSIONS_FILE, JSON.stringify(nextSuppressions, null, 2));
  }

  console.log(`Combined-asset duplicate resolver ${DRY_RUN ? "dry run" : "applied"}.`);
  console.log(`Review groups: ${reviewGroups.length}`);
  console.log(`Decisions: ${decisions.length}`);
  console.log(`Existing suppressions: ${existingSuppressions.length}`);
  console.log(`Final suppressions: ${nextSuppressions.length}`);
  console.log(`Skipped groups: ${skipped.length}`);
  console.log(`Saved report to ${OUT_REPORT_FILE}`);

  console.log("\nDecisions:");
  for (const decision of decisions) {
    console.log(
      `KEEP ${decision.keeper.id} | SUPPRESS ${decision.suppressed.id} | scores ${decision.keeper.score}/${decision.suppressed.score}`
    );
  }
}

main();