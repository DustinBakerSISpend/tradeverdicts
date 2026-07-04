const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const applyMode = process.argv.includes("--apply");
const batchLabel = "009";

const OUT_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-14-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-14-${applyMode ? "apply" : "dry-run"}-v1.txt`);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function safe(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function compact(v, max = 360) {
  const s = safe(v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function getId(t) {
  return safe(t.id || t.tradeId || t.trade_id);
}

function changed(rec, pathName, before, after, type) {
  if (safe(before) === safe(after)) return;
  rec.changes.push({
    path: pathName,
    type,
    before: compact(before),
    after: compact(after)
  });
}

const TEAM_NAMES = {
  "arizona-cardinals": "Arizona Cardinals",
  "atlanta-falcons": "Atlanta Falcons",
  "baltimore-ravens": "Baltimore Ravens",
  "buffalo-bills": "Buffalo Bills",
  "carolina-panthers": "Carolina Panthers",
  "chicago-bears": "Chicago Bears",
  "cincinnati-bengals": "Cincinnati Bengals",
  "cleveland-browns": "Cleveland Browns",
  "dallas-cowboys": "Dallas Cowboys",
  "denver-broncos": "Denver Broncos",
  "detroit-lions": "Detroit Lions",
  "green-bay-packers": "Green Bay Packers",
  "houston-texans": "Houston Texans",
  "indianapolis-colts": "Indianapolis Colts",
  "jacksonville-jaguars": "Jacksonville Jaguars",
  "kansas-city-chiefs": "Kansas City Chiefs",
  "las-vegas-raiders": "Las Vegas Raiders",
  "los-angeles-chargers": "Los Angeles Chargers",
  "los-angeles-rams": "Los Angeles Rams",
  "miami-dolphins": "Miami Dolphins",
  "minnesota-vikings": "Minnesota Vikings",
  "new-england-patriots": "New England Patriots",
  "new-orleans-saints": "New Orleans Saints",
  "new-york-giants": "New York Giants",
  "new-york-jets": "New York Jets",
  "philadelphia-eagles": "Philadelphia Eagles",
  "pittsburgh-steelers": "Pittsburgh Steelers",
  "san-francisco-49ers": "San Francisco 49ers",
  "seattle-seahawks": "Seattle Seahawks",
  "tampa-bay-buccaneers": "Tampa Bay Buccaneers",
  "tennessee-titans": "Tennessee Titans",
  "washington-commanders": "Washington Redskins"
};

function teamName(key) {
  return TEAM_NAMES[key] || safe(key).split("-").filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1)).join(" ");
}

function assetText(a) {
  if (a == null) return "";
  if (typeof a === "string") return a;
  return safe(a.asset || a.name || a.value || a.label || a.player || a.pick || a);
}

function listJoin(parts) {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] + " and " + parts[1];
  return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
}

function assetsFor(t, teamKey) {
  const list = t.assetsReceived && t.assetsReceived[teamKey];
  if (!Array.isArray(list) || !list.length) return "undisclosed consideration";
  const parts = list.map(assetText).map(s => s.trim()).filter(Boolean);
  return parts.length ? listJoin(parts) : "undisclosed consideration";
}

function winnerName(verdict) {
  const v = safe(verdict).trim();
  if (!v || /^even trade$/i.test(v)) return "";
  return v.replace(/\s+Win$/i, "").trim();
}

function sentenceFor(t, primaryKey, otherKey) {
  const primary = teamName(primaryKey);
  const other = teamName(otherKey);
  const primaryAssets = assetsFor(t, primaryKey);
  const otherAssets = assetsFor(t, otherKey);
  const winner = winnerName(t.verdict);

  if (!winner) {
    return {
      primarySummary: `${primary} acquired ${primaryAssets} from ${other} for ${otherAssets}. The recorded return stays close enough for an Even Trade verdict.`,
      partnerSummary: `${other} received ${otherAssets} and gave up ${primaryAssets}. The exchange remains balanced after the recorded assets are weighed.`,
      analysis: `This remains an Even Trade because the recorded assets do not create enough separation for either side.`
    };
  }

  return {
    primarySummary: `${primary} acquired ${primaryAssets} from ${other} for ${otherAssets}. The stronger recorded return belongs to ${winner}, matching the ${t.verdict} verdict.`,
    partnerSummary: `${other} received ${otherAssets} and gave up ${primaryAssets}. The overall value edge goes to ${winner}.`,
    analysis: `The value edge goes to ${winner} because the recorded return is stronger than what it gave up.`
  };
}

function makePerspective(t, p) {
  const s = sentenceFor(t, p.primaryTeam, p.partnerTeam);
  return {
    sourceTeam: p.sourceTeam,
    sourceTradeId: p.sourceTradeId,
    sourceRow: p.sourceRow,
    primaryTeam: p.primaryTeam,
    partnerTeam: p.partnerTeam,
    primarySummary: p.primarySummary || s.primarySummary,
    partnerSummary: p.partnerSummary || s.partnerSummary,
    primaryGrade: t.grades && t.grades[p.primaryTeam] ? t.grades[p.primaryTeam] : "",
    partnerGrade: t.grades && t.grades[p.partnerTeam] ? t.grades[p.partnerTeam] : "",
    verdict: t.verdict
  };
}

function applyPatchObject(t, patch) {
  if (patch.assetsReceived) t.assetsReceived = patch.assetsReceived;
  if (patch.verdict) t.verdict = patch.verdict;
  if (patch.grades) t.grades = patch.grades;

  const keys = patch.teamKeys || Object.keys(t.assetsReceived || {});
  const a = keys[0];
  const b = keys[1];

  const top = sentenceFor(t, a, b);
  t.summary = patch.summary || top.primarySummary;
  t.partnerSummary = patch.partnerSummary || top.partnerSummary;
  t.analysis = patch.analysis || top.analysis;

  t.perspectives = patch.perspectives.map(p => makePerspective(t, p));
}

const patchSpecs = {
  "DEN-2016-10-25-0339": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Denver Broncos Win C+/C.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "new-england-patriots": "C" },
    teamKeys: ["denver-broncos", "new-england-patriots"],
    summary: "Denver moved AJ Derby for a future fifth-round pick that was later tied to Matt Milano. The pick path made Denver's side the cleaner value, though the grade stays modest because the direct return was draft capital rather than an immediate star.",
    partnerSummary: "New England received AJ Derby and gave up 2017 5th round pick (163rd overall subsequently traded, Matt Milano). The Patriots received the player, but Denver kept the better asset value.",
    analysis: "Denver holds the edge because it converted AJ Derby into a fifth-round pick path that carried more long-term value.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2016-10-25-0339", sourceRow: 330, primaryTeam: "denver-broncos", partnerTeam: "new-england-patriots" },
      { sourceTeam: "new-england-patriots", sourceTradeId: "NE-2016-0368", sourceRow: 369, primaryTeam: "new-england-patriots", partnerTeam: "denver-broncos" }
    ]
  },

  "MIA-2017-0270": {
    action: "patch",
    reason: "Structural cleanup: remove bundled Julius Thomas/Marquez Williams subtrade and preserve the Branden Albert conditional-pick Even Trade.",
    assetsReceived: {
      "miami-dolphins": [
        { type: "pick", asset: "conditional 2018 pick (not conveyed)" }
      ],
      "jacksonville-jaguars": [
        { type: "player", asset: "Branden Albert" }
      ]
    },
    verdict: "Even Trade",
    grades: { "miami-dolphins": "C+", "jacksonville-jaguars": "C+" },
    teamKeys: ["miami-dolphins", "jacksonville-jaguars"],
    summary: "Miami's Branden Albert transaction with Jacksonville centered on a conditional 2018 pick that was not conveyed. With no draft value ultimately changing hands, the clean public treatment is an Even Trade.",
    partnerSummary: "Jacksonville received Branden Albert and gave up a conditional 2018 pick that was not conveyed. The conditional structure keeps the result near even.",
    analysis: "This remains an Even Trade because the conditional pick was not conveyed and the transaction did not create enough durable value separation.",
    perspectives: [
      { sourceTeam: "miami-dolphins", sourceTradeId: "MIA-2017-0270", sourceRow: 271, primaryTeam: "miami-dolphins", partnerTeam: "jacksonville-jaguars" },
      { sourceTeam: "jacksonville-jaguars", sourceTradeId: "JAX-2017-0064", sourceRow: 65, primaryTeam: "jacksonville-jaguars", partnerTeam: "miami-dolphins" }
    ]
  },

  "CLE-2017-0407": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Green Bay Packers Win B/C+ and replace stale Even copy.",
    verdict: "Green Bay Packers Win",
    grades: { "cleveland-browns": "C+", "green-bay-packers": "B" },
    teamKeys: ["cleveland-browns", "green-bay-packers"],
    summary: "Cleveland moved up for David Njoku, while Green Bay received Kevin King and Vince Biegel. Njoku gave Cleveland useful value, but the Packers' combined return keeps the edge with Green Bay.",
    partnerSummary: "Green Bay received 2017 2nd round pick (33rd overall, Kevin King) and 2017 4th round pick (108th overall, Vince Biegel) while giving up the pick used on David Njoku.",
    analysis: "Green Bay holds the edge because the combined Kevin King and Vince Biegel return outweighed Cleveland's move up for David Njoku on this trade tree.",
    perspectives: [
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2017-0407", sourceRow: 405, primaryTeam: "cleveland-browns", partnerTeam: "green-bay-packers" },
      { sourceTeam: "green-bay-packers", sourceTradeId: "GB-2017-0419", sourceRow: 420, primaryTeam: "green-bay-packers", partnerTeam: "cleveland-browns" }
    ]
  },

  "CAR-2017-0059": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Arizona Cardinals Win B+/C- and remove stale Even perspective.",
    verdict: "Arizona Cardinals Win",
    grades: { "carolina-panthers": "C-", "arizona-cardinals": "B+" },
    teamKeys: ["carolina-panthers", "arizona-cardinals"],
    summary: "Carolina moved up for Daeshon Hall, while Arizona received the picks used on Chad Williams and Dorian Johnson. Arizona's combined return produced more value.",
    partnerSummary: "Arizona received 2017 3rd round pick (98th overall, Chad Williams) and 2017 4th round pick (115th overall, Dorian Johnson) while giving up the pick used on Daeshon Hall.",
    analysis: "Arizona holds the edge because the two-player return outproduced Carolina's move up for Daeshon Hall.",
    perspectives: [
      { sourceTeam: "carolina-panthers", sourceTradeId: "CAR-2017-0059", sourceRow: 59, primaryTeam: "carolina-panthers", partnerTeam: "arizona-cardinals" },
      { sourceTeam: "arizona-cardinals", sourceTradeId: "ARI-2017-0310", sourceRow: 311, primaryTeam: "arizona-cardinals", partnerTeam: "carolina-panthers" }
    ]
  },

  "CLE-2017-0409": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Cleveland Browns Win C+/C and remove stale Even copy.",
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "C+", "new-york-jets": "C" },
    teamKeys: ["cleveland-browns", "new-york-jets"],
    summary: "Cleveland received the picks used on Roderick Johnson and Zane Gonzalez, while New York received the picks used on Dylan Donahue and Elijah McGuire. Cleveland kept the slightly better value side.",
    partnerSummary: "New York received 2017 5th round pick (181st overall, Dylan Donahue) and 2017 6th round pick (188th overall, Elijah McGuire) while giving up the picks used on Roderick Johnson and Zane Gonzalez.",
    analysis: "Cleveland holds the edge because the Roderick Johnson and Zane Gonzalez side provided the stronger combined value in a minor pick swap.",
    perspectives: [
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2017-0409", sourceRow: 407, primaryTeam: "cleveland-browns", partnerTeam: "new-york-jets" },
      { sourceTeam: "new-york-jets", sourceTradeId: "NYJ-2017-0251", sourceRow: 252, primaryTeam: "new-york-jets", partnerTeam: "cleveland-browns" }
    ]
  },

  "DEN-2017-04-29-0340": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspectives and preserve Denver Broncos Win C+/C.",
    assetsReceived: {
      "denver-broncos": [
        { type: "pick", asset: "2018 4th round pick (109th overall subsequently traded, Troy Apke)" }
      ],
      "san-francisco-49ers": [
        { type: "player", asset: "Kapri Bibbs" },
        { type: "pick", asset: "2017 5th round pick (177th overall, Trent Taylor)" }
      ]
    },
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "san-francisco-49ers": "C" },
    teamKeys: ["denver-broncos", "san-francisco-49ers"],
    summary: "Denver received a future fourth-round pick path, while San Francisco received Kapri Bibbs and the pick used on Trent Taylor. The Broncos' future pick value gives them a narrow edge.",
    partnerSummary: "San Francisco received Kapri Bibbs and 2017 5th round pick (177th overall, Trent Taylor) while giving up the future fourth-round pick tied to Troy Apke.",
    analysis: "Denver holds the edge because the future fourth-round asset carried slightly more value than San Francisco's player-and-fifth package.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2017-04-29-0340", sourceRow: 331, primaryTeam: "denver-broncos", partnerTeam: "san-francisco-49ers" },
      { sourceTeam: "san-francisco-49ers", sourceTradeId: "SF-2017-0386", sourceRow: 387, primaryTeam: "san-francisco-49ers", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2017-04-29-0341": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspectives and preserve Even Trade C/C.",
    verdict: "Even Trade",
    grades: { "denver-broncos": "C", "cleveland-browns": "C" },
    teamKeys: ["denver-broncos", "cleveland-browns"],
    summary: "Denver received the picks used on Jake Butt and DeAngelo Yancey, while Cleveland received the picks used on Howard Wilson and Matthew Dayes. The outcomes stay close enough for an Even Trade.",
    partnerSummary: "Cleveland received 2017 4th round pick (126th overall, Howard Wilson) and 2017 7th round pick (252nd overall, Matthew Dayes) while giving up the two fifth-round assets.",
    analysis: "This remains an Even Trade because neither side's pick package produced enough separation to force a clear winner.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2017-04-29-0341", sourceRow: 332, primaryTeam: "denver-broncos", partnerTeam: "cleveland-browns" },
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2017-0408", sourceRow: 406, primaryTeam: "cleveland-browns", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2017-04-29-0342": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Green Bay Packers Win B+/C+.",
    verdict: "Green Bay Packers Win",
    grades: { "denver-broncos": "C+", "green-bay-packers": "B+" },
    teamKeys: ["denver-broncos", "green-bay-packers"],
    summary: "Denver moved up for Isaiah McKenzie, while Green Bay received DeAngelo Yancey and Devante Mays. Green Bay's two-pick return gets the stronger grade on this ledger.",
    partnerSummary: "Green Bay received 2017 5th round pick (175th overall, DeAngelo Yancey) and 2017 7th round pick (238th overall, Devante Mays) while giving up the pick used on Isaiah McKenzie.",
    analysis: "Green Bay holds the edge because the two-pick return outweighed Denver's small move up for Isaiah McKenzie in the recorded outcome.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2017-04-29-0342", sourceRow: 333, primaryTeam: "denver-broncos", partnerTeam: "green-bay-packers" },
      { sourceTeam: "green-bay-packers", sourceTradeId: "GB-2017-0420", sourceRow: 421, primaryTeam: "green-bay-packers", partnerTeam: "denver-broncos" }
    ]
  },

  "TEN-2017-0236": {
    action: "patch",
    reason: "Grade/verdict cleanup: repair blank Tennessee assets/summary and preserve Even Trade C/C.",
    assetsReceived: {
      "tennessee-titans": [
        { type: "pick", asset: "2017 6th round pick (207th overall subsequently traded, Brandon Wilson)" },
        { type: "pick", asset: "2017 7th round pick (241st overall, Khalfani Muhammad)" }
      ],
      "new-york-giants": [
        { type: "pick", asset: "2017 6th round pick (200th overall, Adam Bisnowaty)" }
      ]
    },
    verdict: "Even Trade",
    grades: { "tennessee-titans": "C", "new-york-giants": "C" },
    teamKeys: ["tennessee-titans", "new-york-giants"],
    summary: "Tennessee received the picks tied to Brandon Wilson and Khalfani Muhammad, while New York moved up for Adam Bisnowaty. The low-stakes pick swap stays in the even range.",
    partnerSummary: "New York received 2017 6th round pick (200th overall, Adam Bisnowaty) while giving up the picks tied to Brandon Wilson and Khalfani Muhammad.",
    analysis: "This remains an Even Trade because the late-round asset outcomes do not create a reliable value gap.",
    perspectives: [
      { sourceTeam: "tennessee-titans", sourceTradeId: "TEN-2017-0236", sourceRow: 237, primaryTeam: "tennessee-titans", partnerTeam: "new-york-giants" }
    ]
  },

  "TEN-2017-0237": {
    action: "patch",
    reason: "Grade/verdict cleanup: repair blank Tennessee assets/summary and preserve Even Trade C/C.",
    assetsReceived: {
      "tennessee-titans": [
        { type: "pick", asset: "2017 6th round pick (217th overall, Corey Levin)" },
        { type: "pick", asset: "2017 7th round pick (227th overall, Josh Carraway)" }
      ],
      "cincinnati-bengals": [
        { type: "pick", asset: "2017 6th round pick (207th overall, Brandon Wilson)" }
      ]
    },
    verdict: "Even Trade",
    grades: { "tennessee-titans": "C", "cincinnati-bengals": "C" },
    teamKeys: ["tennessee-titans", "cincinnati-bengals"],
    summary: "Tennessee received the picks used on Corey Levin and Josh Carraway, while Cincinnati moved up for Brandon Wilson. The late-round value stayed close enough for an Even Trade.",
    partnerSummary: "Cincinnati received 2017 6th round pick (207th overall, Brandon Wilson) while giving up the picks used on Corey Levin and Josh Carraway.",
    analysis: "This remains an Even Trade because the late-round pick exchange did not produce enough separation for either side.",
    perspectives: [
      { sourceTeam: "tennessee-titans", sourceTradeId: "TEN-2017-0237", sourceRow: 238, primaryTeam: "tennessee-titans", partnerTeam: "cincinnati-bengals" }
    ]
  },

  "DEN-2017-07-26-0343": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspectives and preserve Philadelphia Eagles Win B-/C-.",
    verdict: "Philadelphia Eagles Win",
    grades: { "denver-broncos": "C-", "philadelphia-eagles": "B-" },
    teamKeys: ["denver-broncos", "philadelphia-eagles"],
    summary: "Denver acquired Allen Barbre for a future seventh-round pick, but the short-term veteran return did not create much value. Philadelphia recovered draft capital for a player it could move.",
    partnerSummary: "Philadelphia received 2019 7th round pick (222nd overall subsequently traded, Kerrith Whyte) and gave up Allen Barbre. The pick return gives the Eagles the edge.",
    analysis: "Philadelphia holds the edge because Denver paid draft capital for a short-lived veteran solution, while the Eagles recovered a future pick.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2017-07-26-0343", sourceRow: 334, primaryTeam: "denver-broncos", partnerTeam: "philadelphia-eagles" },
      { sourceTeam: "philadelphia-eagles", sourceTradeId: "PHI-2017-0393", sourceRow: 394, primaryTeam: "philadelphia-eagles", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2017-09-01-0344": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Denver Broncos Win C+/C.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "atlanta-falcons": "C" },
    teamKeys: ["denver-broncos", "atlanta-falcons"],
    summary: "Denver traded Ty Sambrailo to Atlanta for the future fifth-round pick tied to Tim Settle. The Broncos recovered the stronger draft-capital value.",
    partnerSummary: "Atlanta received Ty Sambrailo and gave up 2018 5th round pick (163rd overall subsequently traded, Tim Settle). The player return did not beat Denver's draft value.",
    analysis: "Denver holds the edge because it converted Ty Sambrailo into a future fifth-round asset that carried stronger recorded value.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2017-09-01-0344", sourceRow: 335, primaryTeam: "denver-broncos", partnerTeam: "atlanta-falcons" },
      { sourceTeam: "atlanta-falcons", sourceTradeId: "ATL-2017-0272", sourceRow: 273, primaryTeam: "atlanta-falcons", partnerTeam: "denver-broncos" }
    ]
  },

  "SEA-2017-09-01-0190": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve New York Jets Win C+/C and repair duplicated/malformed Jets assets.",
    assetsReceived: {
      "seattle-seahawks": [
        { type: "player", asset: "Sheldon Richardson" },
        { type: "pick", asset: "2018 7th round pick (226th overall subsequently traded, David Williams)" }
      ],
      "new-york-jets": [
        { type: "player", asset: "Jermaine Kearse" },
        { type: "pick", asset: "2018 2nd round pick (49th overall subsequently traded, Dallas Goedert)" },
        { type: "pick", asset: "2018 7th round pick (235th overall subsequently traded, Zaire Franklin)" }
      ]
    },
    verdict: "New York Jets Win",
    grades: { "seattle-seahawks": "C", "new-york-jets": "C+" },
    teamKeys: ["seattle-seahawks", "new-york-jets"],
    summary: "Seattle acquired Sheldon Richardson and a seventh-round pick, while New York received Jermaine Kearse, a second-round pick path, and a seventh-round pick path. The Jets kept the slightly stronger value side.",
    partnerSummary: "New York received Jermaine Kearse, 2018 2nd round pick (49th overall subsequently traded, Dallas Goedert), and 2018 7th round pick (235th overall subsequently traded, Zaire Franklin) while giving up Sheldon Richardson and a seventh-round pick.",
    analysis: "New York holds the edge because the Kearse-plus-picks return carried more lasting value than Seattle's short-term Sheldon Richardson move.",
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2017-09-01-0190", sourceRow: 181, primaryTeam: "seattle-seahawks", partnerTeam: "new-york-jets" },
      { sourceTeam: "new-york-jets", sourceTradeId: "NYJ-2017-0256", sourceRow: 257, primaryTeam: "new-york-jets", partnerTeam: "seattle-seahawks" }
    ]
  },

  "SEA-2017-09-02-0192": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Seattle Seahawks Win C+/C and remove stale provisional/even copy.",
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "C+", "new-england-patriots": "C" },
    teamKeys: ["seattle-seahawks", "new-england-patriots"],
    summary: "Seattle traded Cassius Marsh for the future fifth-round pick used on Jamarco Jones. The pick return gives Seattle a narrow value edge.",
    partnerSummary: "New England received Cassius Marsh and gave up 2018 5th round pick (168th overall, Jamarco Jones). The Patriots got the player, but Seattle's pick return was stronger.",
    analysis: "Seattle holds the edge because it converted Cassius Marsh into a fifth-round draft asset with slightly better recorded value.",
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2017-09-02-0192", sourceRow: 183, primaryTeam: "seattle-seahawks", partnerTeam: "new-england-patriots" },
      { sourceTeam: "new-england-patriots", sourceTradeId: "NE-2017-0381", sourceRow: 382, primaryTeam: "new-england-patriots", partnerTeam: "seattle-seahawks" }
    ]
  }
};

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;
if (!Array.isArray(trades)) throw new Error("Could not find trades array.");

const byId = new Map(trades.map((t, i) => [getId(t), { t, i }]));
const records = [];
let blocked = 0;

for (const [id, spec] of Object.entries(patchSpecs)) {
  const found = byId.get(id);
  const rec = {
    id,
    action: spec.action,
    index: found ? found.i : null,
    slug: found && found.t ? found.t.slug || "" : "",
    status: applyMode ? "applied" : "would_apply",
    reason: spec.reason,
    blockers: [],
    changes: []
  };

  if (!found) {
    rec.status = "blocked";
    rec.blockers.push("Trade ID not found.");
    blocked++;
    records.push(rec);
    continue;
  }

  const t = found.t;
  const beforeSnapshot = clone(t);
  const next = clone(t);
  applyPatchObject(next, spec);

  changed(rec, "assetsReceived", JSON.stringify(beforeSnapshot.assetsReceived || {}), JSON.stringify(next.assetsReceived || {}), "assets");
  changed(rec, "verdict", beforeSnapshot.verdict, next.verdict, "verdict");
  changed(rec, "grades", JSON.stringify(beforeSnapshot.grades || {}), JSON.stringify(next.grades || {}), "grades");
  changed(rec, "summary", beforeSnapshot.summary, next.summary, "copy");
  changed(rec, "partnerSummary", beforeSnapshot.partnerSummary, next.partnerSummary, "copy");
  changed(rec, "analysis", beforeSnapshot.analysis, next.analysis, "copy");
  changed(rec, "perspectives", `${Array.isArray(beforeSnapshot.perspectives) ? beforeSnapshot.perspectives.length : 0} perspectives`, `${Array.isArray(next.perspectives) ? next.perspectives.length : 0} cleaned perspectives`, "perspectives");

  if (applyMode) Object.assign(t, next);
  records.push(rec);
}

let backupPath = null;

if (applyMode && blocked === 0) {
  backupPath = path.join(path.dirname(DATA_PATH), `trades.backup-before-bottom-batch-009-final-14-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.copyFileSync(DATA_PATH, backupPath);
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
}

if (applyMode && blocked > 0) {
  for (const r of records) {
    if (r.status === "applied") r.status = "blocked_no_write";
  }
}

const statusCounts = {};
for (const r of records) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

const trueFlips = [];

const report = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  bottomBatchNumber: 9,
  recordsTargeted: records.length,
  blockedRecords: blocked,
  quarantineRemovals: 0,
  trueGradeVerdictFlips: trueFlips,
  backupPath,
  statusCounts,
  records
};

writeJson(OUT_JSON, report);

const trueFlipText = trueFlips.length ? trueFlips.map(x => `- ${x}`).join("\n") : "- None. This patch preserves the visible top-level verdicts/grades and fixes structural/copy/perspective alignment.";

const txt = `# NFL Bottom Batch 009 Final 14 ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

Purpose:
- Resolve the 7 structural holds and 7 grade/verdict reviews left after the copy-only pass.
- Remove duplicate/stale perspectives.
- Remove public backend/provisional/internal language from perspectives.
- Split malformed player-plus-pick assets into clean player/pick arrays.
- Repair blank Tennessee primary assets/summaries.
- Preserve visible top-level verdicts and grades while aligning public copy.

## Summary
- Records targeted: ${records.length}
- Blocked records: ${blocked}
- Quarantine removals: 0
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}

## True Grade/Verdict Flips
${trueFlipText}

## Status Counts
${Object.entries(statusCounts).map(([k,v]) => `- ${k}: ${v}`).join("\n") || "- None"}

## Blocked Records
${records.filter(r => r.status.startsWith("blocked")).length ? records.filter(r => r.status.startsWith("blocked")).map(r => `- ${r.id}: ${r.blockers.join(" | ")}`).join("\n") : "- None"}

## Records
${records.map(r => `## ${r.id}
- Index: ${r.index}
- Slug: ${r.slug}
- Action: ${r.action}
- Status: ${r.status}
- Reason: ${r.reason}

### Blockers
${r.blockers.length ? r.blockers.map(b => `- ${b}`).join("\n") : "- None"}

### Changes
${r.changes.length ? r.changes.map(c => `- ${c.path} [${c.type}]\n  before: ${c.before}\n  after: ${c.after}`).join("\n") : "- None"}
`).join("\n\n")}

## Output Files
- JSON: reports/quality/nfl-bottom-batch-009-final-14-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-bottom-batch-009-final-14-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Bottom Batch 009 final 14 ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blocked}`);
console.log(`Quarantine removals: 0`);
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-009-final-14-${applyMode ? "apply" : "dry-run"}-v1.txt`);
