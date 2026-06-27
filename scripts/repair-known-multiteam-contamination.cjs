const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outDir = path.join(process.cwd(), "audits");
const outPath = path.join(
  outDir,
  APPLY
    ? "repair-known-multiteam-contamination-apply-report.json"
    : "repair-known-multiteam-contamination-dry-run.json"
);

if (!fs.existsSync(dataPath)) {
  console.error(`Missing file: ${dataPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : Array.isArray(raw.trades) ? raw.trades : [];

if (!Array.isArray(trades) || trades.length === 0) {
  console.error("Could not find trades array.");
  console.error("Top-level keys:", Object.keys(raw || {}));
  process.exit(1);
}

function slugOf(t) {
  return String(t.slug || t.id || t.urlSlug || "").trim();
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function restrictObjectKeys(obj, allowedKeys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;

  const next = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      next[key] = obj[key];
    }
  }
  return next;
}

function maybeRestrictPerspectives(perspectives, allowedTeams) {
  if (!perspectives) return perspectives;

  if (Array.isArray(perspectives)) {
    return perspectives.filter(p => {
      const team = p && (p.team || p.teamSlug || p.slug);
      return !team || allowedTeams.includes(team);
    });
  }

  if (typeof perspectives === "object") {
    return restrictObjectKeys(perspectives, allowedTeams);
  }

  return perspectives;
}

const fixes = [
  {
    slug: "2020-7th-round-pick-251st-overall-stephen-sulliv-miami-dolphins-2020",
    reason: "Confirmed blended one-pick trade cluster. Repair to real Seahawks-Dolphins trade; do not suppress.",
    teams: ["miami-dolphins", "seattle-seahawks"],
    assetsReceived: {
      "seattle-seahawks": [
        {
          type: "pick",
          asset: "2020 7th round pick (251st overall, Stephen Sullivan)"
        }
      ],
      "miami-dolphins": [
        {
          type: "pick",
          asset: "2021 6th round pick (208th overall subsequently traded, Stone Forsythe)"
        }
      ]
    },
    grades: {
      "miami-dolphins": "C",
      "seattle-seahawks": "C"
    },
    verdict: "Even Trade"
  }
];

const repaired = [];
const missing = [];
const errors = [];

for (const fix of fixes) {
  const matches = trades.filter(t => slugOf(t) === fix.slug);

  if (matches.length !== 1) {
    errors.push({
      slug: fix.slug,
      reason: `Expected exactly 1 match, found ${matches.length}`
    });
    continue;
  }

  const trade = matches[0];

  const before = {
    slug: slugOf(trade),
    date: trade.date || trade.tradeDate || null,
    teams: clone(trade.teams || null),
    assetsReceived: clone(trade.assetsReceived || null),
    grades: clone(trade.grades || trade.teamGrades || null),
    verdict: clone(trade.verdict || null),
    perspectives: clone(trade.perspectives || null)
  };

  const availableAssetTeams = trade.assetsReceived && typeof trade.assetsReceived === "object"
    ? Object.keys(trade.assetsReceived)
    : [];

  for (const team of Object.keys(fix.assetsReceived)) {
    if (!availableAssetTeams.includes(team)) {
      missing.push({
        slug: fix.slug,
        reason: `Required team ${team} is missing from current assetsReceived`
      });
    }
  }

  if (missing.length || errors.length) continue;

  const after = {
    teams: fix.teams,
    assetsReceived: fix.assetsReceived,
    grades: fix.grades,
    verdict: fix.verdict,
    perspectives: maybeRestrictPerspectives(trade.perspectives, fix.teams)
  };

  repaired.push({
    slug: fix.slug,
    reason: fix.reason,
    before,
    after,
    removedTeams: (before.teams || []).filter(team => !fix.teams.includes(team)),
    removedAssetKeys: availableAssetTeams.filter(team => !Object.keys(fix.assetsReceived).includes(team)),
    removedGradeKeys: before.grades && typeof before.grades === "object"
      ? Object.keys(before.grades).filter(team => !Object.keys(fix.grades).includes(team))
      : []
  });

  if (APPLY) {
    trade.teams = clone(fix.teams);
    trade.assetsReceived = clone(fix.assetsReceived);
    trade.grades = clone(fix.grades);
    trade.verdict = fix.verdict;

    if (trade.perspectives) {
      trade.perspectives = maybeRestrictPerspectives(trade.perspectives, fix.teams);
    }
  }
}

const report = {
  mode: APPLY ? "apply" : "dry-run",
  generatedAt: new Date().toISOString(),
  dataPath,
  repairedCount: repaired.length,
  missing,
  errors,
  repaired
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (missing.length || errors.length) {
  console.error("");
  console.error("Repair blocked. Inspect missing/errors in report:");
  console.error(outPath);
  console.dir({ missing, errors }, { depth: null });
  process.exit(1);
}

if (APPLY) {
  const outputText = Array.isArray(raw)
    ? JSON.stringify(trades, null, 2) + "\n"
    : JSON.stringify(raw, null, 2) + "\n";

  fs.writeFileSync(dataPath, outputText);
}

console.log("");
console.log(APPLY ? "KNOWN MULTI-TEAM CONTAMINATION REPAIR APPLY" : "KNOWN MULTI-TEAM CONTAMINATION REPAIR DRY RUN");
console.log("=".repeat(80));
console.log(`Repairs: ${repaired.length}`);
console.log(`Missing required pieces: ${missing.length}`);
console.log(`Errors: ${errors.length}`);
console.log(`Report: ${outPath}`);

for (const row of repaired) {
  console.log("");
  console.log("-".repeat(80));
  console.log(row.slug);
  console.log(row.reason);
  console.log(`removed teams: ${JSON.stringify(row.removedTeams)}`);
  console.log(`removed asset keys: ${JSON.stringify(row.removedAssetKeys)}`);
  console.log(`removed grade keys: ${JSON.stringify(row.removedGradeKeys)}`);
  console.log("after teams:", JSON.stringify(row.after.teams));
  console.log("after asset keys:", JSON.stringify(Object.keys(row.after.assetsReceived || {})));
  console.log("after grade keys:", JSON.stringify(Object.keys(row.after.grades || {})));
  console.log("after verdict:", JSON.stringify(row.after.verdict));
}
