const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "resolve-baker-dawson-4-record-cluster-apply-report.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

function dateOf(t) {
  return t?.tradeDate || t?.date || "";
}

function sameTeamSet(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

const keeperSlug = "mike-dawson-arizona-st-louis-cardinals-1983-07-18";

const suppressSlugs = [
  "1984-third-round-pick-62-eric-williams-michael-arizona-st-louis-cardinals-1983-0",
  "cardinals-1983-07-19-unknown-partner-al-baker-bubba-baker-unknown-not-disclosed",
  "not-specified-unknown-partner-1983-07-19"
];

const errors = [];
const applied = [];

const keeper = find(keeperSlug);
if (!keeper) errors.push(`Missing keeper: ${keeperSlug}`);
if (keeper?.suppressed === true) errors.push(`Keeper already suppressed: ${keeperSlug}`);

for (const slug of suppressSlugs) {
  const t = find(slug);
  if (!t) errors.push(`Missing suppress target: ${slug}`);
  if (t?.suppressed === true) errors.push(`Suppress target already suppressed: ${slug}`);
}

const ericRow = find("1984-third-round-pick-62-eric-williams-michael-arizona-st-louis-cardinals-1983-0");
const unknownCardinals = find("cardinals-1983-07-19-unknown-partner-al-baker-bubba-baker-unknown-not-disclosed");
const unknownDetroit = find("not-specified-unknown-partner-1983-07-19");

if (keeper && ericRow && !sameTeamSet(keeper.teams || [], ericRow.teams || [])) {
  errors.push("Keeper and Eric Williams row do not have same concrete team set.");
}

if (keeper && dateOf(keeper) !== "1983-07-18") {
  errors.push(`Unexpected keeper date: ${dateOf(keeper)}`);
}

if (unknownCardinals && dateOf(unknownCardinals) !== "1983-07-19") {
  errors.push(`Unexpected Cardinals unknown row date: ${dateOf(unknownCardinals)}`);
}

if (unknownDetroit && dateOf(unknownDetroit) !== "1983-07-19") {
  errors.push(`Unexpected Detroit unknown row date: ${dateOf(unknownDetroit)}`);
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("RESOLVE BAKER/DAWSON 4-RECORD CLUSTER APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const e of errors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

const before = {
  keeper: JSON.parse(JSON.stringify(keeper)),
  suppressTargets: suppressSlugs.map(slug => JSON.parse(JSON.stringify(find(slug))))
};

// Canonicalize keeper and preserve every unique piece of information.
keeper.teams = ["arizona-cardinals", "detroit-lions"];
keeper.publishStatus = "ready";

keeper.assetsReceived = {
  "detroit-lions": [
    { type: "player", asset: "Mike Dawson" },
    { type: "pick", asset: "1984 third round pick (#62-Eric Williams (Michael))" },
    { type: "pick", asset: "1984 eighth round pick (?-?)" }
  ],
  "arizona-cardinals": [
    { type: "player", asset: "Player to be named later (Al Baker / Bubba Baker on 1983-07-19)" }
  ]
};

keeper.summary = "Detroit acquired Mike Dawson, 1984 third round pick (#62-Eric Williams (Michael)), and 1984 eighth round pick (?-?) from Arizona/St. Louis Cardinals for a player to be named later, later identified as Al Baker / Bubba Baker on 1983-07-19. Detroit comes out slightly ahead on the hindsight curve because the Lions preserved the clearer multi-asset return, while Arizona acquired Baker as the named player component.";

keeper.qaNotes = keeper.qaNotes
  ? `${keeper.qaNotes} Resolved Baker/Dawson four-record duplicate cluster: retained as canonical keeper and merged unique 1984 eighth-round pick detail from duplicate pick-slug row.`
  : "Resolved Baker/Dawson four-record duplicate cluster: retained as canonical keeper and merged unique 1984 eighth-round pick detail from duplicate pick-slug row.";

keeper.updatedAt = new Date().toISOString();

for (const slug of suppressSlugs) {
  const t = find(slug);

  t.suppressed = true;
  t.qaNotes = t.qaNotes
    ? `${t.qaNotes} Suppressed as duplicate member of Baker/Dawson four-record cluster; canonical keeper is ${keeperSlug}. Unique details preserved in keeper.`
    : `Suppressed as duplicate member of Baker/Dawson four-record cluster; canonical keeper is ${keeperSlug}. Unique details preserved in keeper.`;

  t.updatedAt = new Date().toISOString();

  applied.push({
    suppressed: {
      id: t.id || null,
      slug: slugOf(t),
      tradeDate: dateOf(t),
      publishStatus: t.publishStatus || null,
      suppressed: t.suppressed
    },
    keeper: {
      id: keeper.id || null,
      slug: slugOf(keeper),
      tradeDate: dateOf(keeper),
      publishStatus: keeper.publishStatus || null,
      suppressed: keeper.suppressed ?? null
    }
  });
}

const postErrors = [];

if (keeper.suppressed === true) postErrors.push("Keeper was suppressed.");
if (keeper.publishStatus !== "ready") postErrors.push(`Keeper not ready: ${keeper.publishStatus}`);

for (const slug of suppressSlugs) {
  const t = find(slug);
  if (t.suppressed !== true) postErrors.push(`Suppress target not suppressed: ${slug}`);
}

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  keeperSlug,
  suppressSlugs,
  errors: postErrors,
  before,
  after: {
    keeper: {
      id: keeper.id || null,
      slug: slugOf(keeper),
      tradeDate: dateOf(keeper),
      teams: keeper.teams || [],
      publishStatus: keeper.publishStatus || null,
      suppressed: keeper.suppressed ?? null,
      assetsReceived: keeper.assetsReceived || null,
      summary: keeper.summary || null,
      qaNotes: keeper.qaNotes || null
    },
    applied
  }
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (postErrors.length) {
  console.error("");
  console.error("POST-APPLY VALIDATION FAILED. Data was not written.");
  for (const e of postErrors) console.error(`- ${e}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

fs.writeFileSync(dataPath, JSON.stringify(Array.isArray(raw) ? trades : raw, null, 2) + "\n");

console.log("");
console.log("RESOLVE BAKER/DAWSON 4-RECORD CLUSTER APPLY");
console.log("=".repeat(80));
console.log(`Applied suppressions: ${applied.length}`);
console.log("Keeper repaired: 1");
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);
console.log("");
console.log(`KEEPER: ${keeperSlug} | ${keeper.id}`);
console.log("Merged/preserved:");
console.log("- Mike Dawson");
console.log("- 1984 third round pick (#62-Eric Williams)");
console.log("- 1984 eighth round pick (?-?)");
console.log("- PTBNL Al Baker / Bubba Baker on 1983-07-19");
console.log("");
console.log("SUPPRESSED:");
for (const a of applied) {
  console.log(`- ${a.suppressed.slug} | ${a.suppressed.id}`);
}
