const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "apply-zatkoff-repair-cardinals-suppression.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

const zatkoffSlug = "roger-zatkoff-rams-mutually-cancelled-by-browns-rams-after-zatkoff-refused-to-re";
const cardinalsSlug = "cardinals-1956-09-19-cardinals-tom-dahms-1957-sixth-round-pick-70-john-nisby-jack-nisby";
const packersKeeperSlug = "1957-sixth-round-pick-70-john-nisby-jack-nisby-green-bay-packers-1956";

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function find(slug) {
  return trades.find(t => slugOf(t) === slug);
}

const errors = [];
const applied = [];

const zatkoff = find(zatkoffSlug);
const cardinals = find(cardinalsSlug);
const packersKeeper = find(packersKeeperSlug);

if (!zatkoff) errors.push(`Missing Zatkoff target: ${zatkoffSlug}`);
if (!cardinals) errors.push(`Missing Cardinals target: ${cardinalsSlug}`);
if (!packersKeeper) errors.push(`Missing Packers keeper: ${packersKeeperSlug}`);

if (zatkoff && zatkoff.suppressed === true) errors.push("Zatkoff target already suppressed.");
if (cardinals && cardinals.suppressed === true) errors.push("Cardinals target already suppressed.");
if (packersKeeper && packersKeeper.suppressed === true) errors.push("Packers keeper is suppressed.");

if (cardinals && packersKeeper && dateOf(cardinals) !== dateOf(packersKeeper)) {
  errors.push("Cardinals and Packers keeper date mismatch.");
}

if (errors.length) {
  fs.writeFileSync(outPath, JSON.stringify({
    mode: "blocked",
    generatedAt: new Date().toISOString(),
    errors
  }, null, 2));

  console.error("");
  console.error("ZATKOFF / CARDINALS APPLY BLOCKED");
  console.error("=".repeat(80));
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

const zatkoffBefore = {
  teams: zatkoff.teams,
  assetsReceived: zatkoff.assetsReceived,
  summary: zatkoff.summary,
  qaNotes: zatkoff.qaNotes
};

zatkoff.teams = ["cleveland-browns", "los-angeles-rams"];
zatkoff.assetsReceived = {
  "cleveland-browns": [
    { type: "player", asset: "Rudy Bukich" }
  ],
  "los-angeles-rams": [
    { type: "player", asset: "Roger Zatkoff" }
  ]
};
zatkoff.summary = "The Cleveland Browns and Los Angeles Rams agreed to a Roger Zatkoff-for-Rudy Bukich trade, but the transaction was mutually cancelled after Zatkoff refused to report to the Rams. Administrative reversal/voided transaction retained for public archive rather than hidden.";

const zatkoffNote = "Repaired fake team-key contamination; removed imported cancellation-text team key and restored Browns/Rams two-team structure.";
zatkoff.qaNotes = zatkoff.qaNotes ? `${zatkoff.qaNotes} ${zatkoffNote}` : zatkoffNote;

applied.push({
  type: "repair-fake-team-key",
  slug: zatkoffSlug,
  id: zatkoff.id || null,
  tradeDate: dateOf(zatkoff),
  before: zatkoffBefore,
  after: {
    teams: zatkoff.teams,
    assetsReceived: zatkoff.assetsReceived,
    summary: zatkoff.summary,
    qaNotes: zatkoff.qaNotes
  }
});

const cardinalsBefore = {
  suppressed: cardinals.suppressed ?? null,
  publishStatus: cardinals.publishStatus || null,
  teams: cardinals.teams,
  assetsReceived: cardinals.assetsReceived,
  summary: cardinals.summary,
  qaNotes: cardinals.qaNotes
};

cardinals.suppressed = true;

const cardinalsNote = `Suppressed structurally wrong Cardinals/unknown-team duplicate after exact-name inspection; covered by ${packersKeeperSlug}. Cardinals page had no valid counterparty side and duplicated Tom Dahms / 1957 sixth round pick (#70-John Nisby / Jack Nisby) with wrong team framing.`;
cardinals.qaNotes = cardinals.qaNotes ? `${cardinals.qaNotes} ${cardinalsNote}` : cardinalsNote;

applied.push({
  type: "suppress-wrong-team-duplicate",
  slug: cardinalsSlug,
  id: cardinals.id || null,
  tradeDate: dateOf(cardinals),
  keeperSlug: packersKeeperSlug,
  before: cardinalsBefore,
  after: {
    suppressed: cardinals.suppressed,
    publishStatus: cardinals.publishStatus || null,
    qaNotes: cardinals.qaNotes
  }
});

const postErrors = [];

if (zatkoff.teams.length !== 2) postErrors.push("Zatkoff still has wrong team count.");
if (zatkoff.teams.includes("rams-mutually-cancelled-by-browns-rams-after-zatkoff-refused-to-report-to-rams")) {
  postErrors.push("Zatkoff fake team remains.");
}
if (cardinals.suppressed !== true) postErrors.push("Cardinals suppression failed.");
if (packersKeeper.suppressed === true) postErrors.push("Packers keeper was suppressed.");

const report = {
  mode: postErrors.length ? "post-apply-validation-failed" : "apply",
  generatedAt: new Date().toISOString(),
  appliedCount: applied.length,
  errors: postErrors,
  applied
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (postErrors.length) {
  console.error("");
  console.error("POST-APPLY VALIDATION FAILED. Data was not written.");
  for (const error of postErrors) console.error(`- ${error}`);
  console.error(`Report: ${outPath}`);
  process.exit(1);
}

fs.writeFileSync(dataPath, JSON.stringify(Array.isArray(raw) ? trades : raw, null, 2) + "\n");

console.log("");
console.log("ZATKOFF REPAIR + CARDINALS SUPPRESSION APPLY");
console.log("=".repeat(80));
console.log(`Applied actions: ${applied.length}`);
console.log(`Errors: ${postErrors.length}`);
console.log(`Report: ${outPath}`);

for (const row of applied) {
  console.log("-".repeat(80));
  console.log(`${row.type}: ${row.slug} | ${row.id} | ${row.tradeDate}`);
  if (row.keeperSlug) console.log(`keeper=${row.keeperSlug}`);
}
