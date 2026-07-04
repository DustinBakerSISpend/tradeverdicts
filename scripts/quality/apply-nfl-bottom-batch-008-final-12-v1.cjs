const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const applyMode = process.argv.includes("--apply");
const batchLabel = "008";

const OUT_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-12-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-12-${applyMode ? "apply" : "dry-run"}-v1.txt`);

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
  "CLE-2018-0414": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Cleveland Browns Win B/C+ and replace stale Even copy.",
    assetsReceived: {
      "cleveland-browns": [
        { type: "player", asset: "Damarious Randall" },
        { type: "pick", asset: "2018 4th round pick (114th overall subsequently traded, Da'Shawn Hand)" },
        { type: "pick", asset: "2018 5th round pick (150th overall, Genard Avery)" }
      ],
      "green-bay-packers": [
        { type: "player", asset: "DeShone Kizer" },
        { type: "pick", asset: "2018 4th round pick (101st overall subsequently traded, Ian Thomas)" },
        { type: "pick", asset: "2018 5th round pick (138th overall, Cole Madison)" }
      ]
    },
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "B", "green-bay-packers": "C+" },
    teamKeys: ["cleveland-browns", "green-bay-packers"],
    summary: "Cleveland landed Damarious Randall plus the later picks tied to Da'Shawn Hand and Genard Avery, while Green Bay received DeShone Kizer and two later pick outcomes. Cleveland's side produced the better value.",
    partnerSummary: "Green Bay received DeShone Kizer, the pick tied to Ian Thomas, and the pick tied to Cole Madison while giving up Damarious Randall plus the later Browns-side pick package.",
    analysis: "Cleveland holds the edge because Randall and the added pick value outperformed Green Bay's Kizer-centered return.",
    perspectives: [
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2018-0414", sourceRow: 412, primaryTeam: "cleveland-browns", partnerTeam: "green-bay-packers" },
      { sourceTeam: "green-bay-packers", sourceTradeId: "GB-2018-0421", sourceRow: 422, primaryTeam: "green-bay-packers", partnerTeam: "cleveland-browns" }
    ]
  },

  "CLE-2018-0416": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Cleveland Browns Win C+/C and replace stale Even copy.",
    assetsReceived: {
      "cleveland-browns": [
        { type: "pick", asset: "2019 3rd round pick (95th overall subsequently traded, Oshane Ximines)" }
      ],
      "new-england-patriots": [
        { type: "player", asset: "Danny Shelton" },
        { type: "pick", asset: "2018 5th round pick (159th overall subsequently traded, Daurice Fountain)" }
      ]
    },
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "C+", "new-england-patriots": "C" },
    teamKeys: ["cleveland-browns", "new-england-patriots"],
    summary: "Cleveland moved Danny Shelton and a fifth-rounder for a future third-round pick. New England received useful defensive-line depth, but Cleveland's draft-capital return was the stronger side.",
    partnerSummary: "New England received Danny Shelton and 2018 5th round pick (159th overall subsequently traded, Daurice Fountain) while giving up the future third-round pick tied to Oshane Ximines.",
    analysis: "Cleveland holds the edge because the future third-round value outweighed New England's player-and-fifth package.",
    perspectives: [
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2018-0416", sourceRow: 414, primaryTeam: "cleveland-browns", partnerTeam: "new-england-patriots" },
      { sourceTeam: "new-england-patriots", sourceTradeId: "NE-2018-0383", sourceRow: 384, primaryTeam: "new-england-patriots", partnerTeam: "cleveland-browns" }
    ]
  },

  "DEN-2018-03-14-0345": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Rams Win A-/C.",
    verdict: "Los Angeles/St. Louis Rams Win",
    grades: { "denver-broncos": "C", "los-angeles-rams": "A-" },
    teamKeys: ["denver-broncos", "los-angeles-rams"],
    summary: "Denver traded Aqib Talib to the Rams for a fifth-round pick, creating cap and roster flexibility but losing the better football asset. The Rams received useful veteran cornerback play.",
    partnerSummary: "Los Angeles received Aqib Talib and gave up 2018 5th round pick (160th overall subsequently traded, Ogbonnia Okoronkwo). The veteran return made the Rams the clear winner.",
    analysis: "The Rams hold the edge because Talib delivered veteran value for a modest fifth-round cost, while Denver's return stayed limited.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2018-03-14-0345", sourceRow: 336, primaryTeam: "denver-broncos", partnerTeam: "los-angeles-rams" },
      { sourceTeam: "los-angeles-rams", sourceTradeId: "RAM-2018-0491", sourceRow: 492, primaryTeam: "los-angeles-rams", partnerTeam: "denver-broncos" }
    ]
  },

  "MIN-2018-03-14-0266": {
    action: "patch",
    reason: "Structural cleanup and verdict alignment: flip Even Trade to Denver Broncos Win after Justin Hollins return.",
    assetsReceived: {
      "minnesota-vikings": [
        { type: "player", asset: "Trevor Siemian" },
        { type: "pick", asset: "2018 7th round pick (225th overall, Devante Downs)" }
      ],
      "denver-broncos": [
        { type: "pick", asset: "2019 5th round pick (156th overall, Justin Hollins)" }
      ]
    },
    verdict: "Denver Broncos Win",
    grades: { "minnesota-vikings": "C", "denver-broncos": "B-" },
    teamKeys: ["minnesota-vikings", "denver-broncos"],
    summary: "Minnesota acquired Trevor Siemian and a seventh-round pick, while Denver received the future fifth-rounder tied to Justin Hollins. The Broncos' draft return proved cleaner.",
    partnerSummary: "Denver received 2019 5th round pick (156th overall, Justin Hollins) and gave up Trevor Siemian plus 2018 7th round pick (225th overall, Devante Downs).",
    analysis: "Denver holds the edge because the fifth-round pick produced the cleaner realized value, while Minnesota's backup-quarterback return was limited.",
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2018-0259", sourceRow: 260, primaryTeam: "minnesota-vikings", partnerTeam: "denver-broncos" },
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2018-03-14-0346", sourceRow: 337, primaryTeam: "denver-broncos", partnerTeam: "minnesota-vikings" }
    ]
  },

  "DEN-2018-03-29-0347": {
    action: "patch",
    reason: "Structural cleanup: split malformed conditional pick, remove duplicate Denver perspective, and preserve Even Trade C/C.",
    assetsReceived: {
      "denver-broncos": [
        { type: "player", asset: "Su'a Cravens" },
        { type: "pick", asset: "2018 4th round pick (113th overall, DaeSean Hamilton)" },
        { type: "pick", asset: "2018 5th round pick (149th overall subsequently traded, Michael Dickson)" }
      ],
      "washington-commanders": [
        { type: "pick", asset: "2018 4th round pick (109th overall, Troy Apke)" },
        { type: "pick", asset: "2018 5th round pick (142nd overall subsequently traded, D.J. Reed)" },
        { type: "pick", asset: "2018 5th round pick (163rd overall, Tim Settle)" },
        { type: "pick", asset: "conditional 2020 7th round pick (not conveyed)" }
      ]
    },
    verdict: "Even Trade",
    grades: { "washington-commanders": "C", "denver-broncos": "C" },
    teamKeys: ["denver-broncos", "washington-commanders"],
    summary: "Denver acquired Su'a Cravens and two draft picks while Washington received three 2018 picks and a conditional 2020 seventh that was not conveyed. The mixed outcome keeps the trade close to even.",
    partnerSummary: "Washington received the picks tied to Troy Apke, D.J. Reed, and Tim Settle, plus a conditional 2020 seventh that was not conveyed, while giving up Su'a Cravens and two picks.",
    analysis: "This remains an Even Trade because both sides gained useful pieces but neither return created enough direct separation.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2018-03-29-0347", sourceRow: 338, primaryTeam: "denver-broncos", partnerTeam: "washington-commanders" },
      { sourceTeam: "washington-commanders", sourceTradeId: "WAS-2018-0435", sourceRow: 436, primaryTeam: "washington-commanders", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2018-04-23-0348": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver-only perspective and preserve New York Giants Win B/C.",
    verdict: "New York Giants Win",
    grades: { "denver-broncos": "C", "new-york-giants": "B" },
    teamKeys: ["denver-broncos", "new-york-giants"],
    summary: "Denver received a future seventh-round pick while New York acquired Riley Dixon. Dixon became the more useful realized asset, giving the Giants the edge.",
    partnerSummary: "New York received Riley Dixon and gave up 2019 7th round pick (220th overall subsequently traded, Cullen Gillaspia). The player return was stronger than the late pick.",
    analysis: "New York holds the edge because Riley Dixon provided useful punter value while Denver's late-round return stayed modest.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2018-04-23-0348", sourceRow: 339, primaryTeam: "denver-broncos", partnerTeam: "new-york-giants" },
      { sourceTeam: "new-york-giants", sourceTradeId: "NYG-2018-0281", sourceRow: 281, primaryTeam: "new-york-giants", partnerTeam: "denver-broncos" }
    ]
  },

  "RAI-2018-0371": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Pittsburgh Steelers Win B-/C+ and remove stale balanced copy.",
    verdict: "Pittsburgh Steelers Win",
    grades: { "pittsburgh-steelers": "B-", "las-vegas-raiders": "C+" },
    teamKeys: ["las-vegas-raiders", "pittsburgh-steelers"],
    summary: "Oakland acquired Martavis Bryant for a third-round pick, but Bryant did not deliver enough value to justify the cost. Pittsburgh kept the better side by converting him into premium draft capital.",
    partnerSummary: "Pittsburgh received 2018 3rd round pick (79th overall subsequently traded, Rasheem Green) and gave up Martavis Bryant.",
    analysis: "Pittsburgh holds the edge because the Raiders paid a third-round price for a player who did not provide matching value.",
    perspectives: [
      { sourceTeam: "las-vegas-raiders", sourceTradeId: "RAI-2018-0371", sourceRow: 372, primaryTeam: "las-vegas-raiders", partnerTeam: "pittsburgh-steelers" },
      { sourceTeam: "pittsburgh-steelers", sourceTradeId: "PIT-2018-0358", sourceRow: 359, primaryTeam: "pittsburgh-steelers", partnerTeam: "las-vegas-raiders" }
    ]
  },

  "DEN-2018-04-28-0350": {
    action: "patch",
    reason: "Structural cleanup and verdict alignment: flip Even Trade to Rams Win after Ogbonnia Okoronkwo return.",
    verdict: "Los Angeles/St. Louis Rams Win",
    grades: { "denver-broncos": "C+", "los-angeles-rams": "B" },
    teamKeys: ["denver-broncos", "los-angeles-rams"],
    summary: "Denver moved down from the Ogbonnia Okoronkwo slot for two sixth-round picks tied to Sam Jones and Keishawn Bierria. The Rams received the better realized player.",
    partnerSummary: "Los Angeles received 2018 5th round pick (160th overall, Ogbonnia Okoronkwo) and gave up the sixth-round picks tied to Sam Jones and Keishawn Bierria.",
    analysis: "The Rams hold the edge because Okoronkwo became the stronger realized asset compared with Denver's two sixth-round returns.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2018-04-28-0350", sourceRow: 341, primaryTeam: "denver-broncos", partnerTeam: "los-angeles-rams" },
      { sourceTeam: "los-angeles-rams", sourceTradeId: "RAM-2018-0496", sourceRow: 497, primaryTeam: "los-angeles-rams", partnerTeam: "denver-broncos" }
    ]
  },

  "MIN-2018-0262": {
    action: "patch",
    reason: "Structural cleanup: remove bundled Tyler Conklin subtrade and preserve Minnesota Vikings Win A/C- for the Daniel Carlson pick swap.",
    assetsReceived: {
      "minnesota-vikings": [
        { type: "pick", asset: "2018 5th round pick (167th overall, Daniel Carlson)" },
        { type: "pick", asset: "2018 7th round pick (225th overall, Devante Downs)" }
      ],
      "new-york-jets": [
        { type: "pick", asset: "2018 6th round pick (180th overall, Folorunso Fatukasi)" },
        { type: "pick", asset: "2018 6th round pick (204th overall, Trenton Cannon)" }
      ]
    },
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "A", "new-york-jets": "C-" },
    teamKeys: ["minnesota-vikings", "new-york-jets"],
    summary: "Minnesota received the picks tied to Daniel Carlson and Devante Downs while New York received the picks tied to Folorunso Fatukasi and Trenton Cannon. On the database's pick-outcome curve, Carlson gives Minnesota the stronger side.",
    partnerSummary: "New York received 2018 6th round pick (180th overall, Folorunso Fatukasi) and 2018 6th round pick (204th overall, Trenton Cannon) while giving up the picks tied to Daniel Carlson and Devante Downs.",
    analysis: "Minnesota holds the edge on the pick-outcome ledger because Daniel Carlson became the highest-value player tied to the exchange, even though most of that value came after his Vikings stint.",
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2018-0262", sourceRow: 263, primaryTeam: "minnesota-vikings", partnerTeam: "new-york-jets" },
      { sourceTeam: "new-york-jets", sourceTradeId: "NYJ-2018-0260", sourceRow: 261, primaryTeam: "new-york-jets", partnerTeam: "minnesota-vikings" }
    ]
  },

  "DEN-2018-10-30-0351": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and strip old batch QA language.",
    assetsReceived: {
      "denver-broncos": [
        { type: "pick", asset: "2019 4th round pick (125th overall subsequently traded, Renell Wren)" },
        { type: "pick", asset: "2019 7th round pick (237th overall subsequently traded, Terry Godwin)" }
      ],
      "houston-texans": [
        { type: "player", asset: "Demaryius Thomas" },
        { type: "pick", asset: "2019 7th round pick (220th overall, Cullen Gillaspia)" }
      ]
    },
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "houston-texans": "C+" },
    teamKeys: ["denver-broncos", "houston-texans"],
    summary: "Denver moved Demaryius Thomas and a seventh-round pick to Houston for fourth- and seventh-round selections. Thomas was past his peak, and Denver recovered useful mid-round value.",
    partnerSummary: "Houston received Demaryius Thomas and 2019 7th round pick (220th overall, Cullen Gillaspia) while giving up the picks tied to Renell Wren and Terry Godwin.",
    analysis: "Denver holds the edge because Houston did not get enough post-trade production from Thomas to outweigh the fourth-round value Denver recovered.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2018-10-30-0351", sourceRow: 342, primaryTeam: "denver-broncos", partnerTeam: "houston-texans" },
      { sourceTeam: "houston-texans", sourceTradeId: "HOU-2018-0053", sourceRow: 54, primaryTeam: "houston-texans", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2019-03-13-0352": {
    action: "patch",
    reason: "Structural cleanup and verdict alignment: flip Even Trade to Washington Redskins Win.",
    assetsReceived: {
      "denver-broncos": [
        { type: "pick", asset: "2020 6th round pick (181st overall, Netane Muti)" }
      ],
      "washington-commanders": [
        { type: "player", asset: "Case Keenum" },
        { type: "pick", asset: "2020 7th round pick (229th overall, James Smith-Williams)" }
      ]
    },
    verdict: "Washington Redskins Win",
    grades: { "washington-commanders": "B", "denver-broncos": "C" },
    teamKeys: ["denver-broncos", "washington-commanders"],
    summary: "Denver received a sixth-round pick while Washington received Case Keenum and the seventh-round pick tied to James Smith-Williams. Washington got the stronger practical return.",
    partnerSummary: "Washington received Case Keenum and 2020 7th round pick (229th overall, James Smith-Williams) while giving up 2020 6th round pick (181st overall, Netane Muti).",
    analysis: "Washington holds the edge because Keenum plus the later pick produced more practical value than Denver received from Netane Muti.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2019-03-13-0352", sourceRow: 343, primaryTeam: "denver-broncos", partnerTeam: "washington-commanders" },
      { sourceTeam: "washington-commanders", sourceTradeId: "WAS-2019-0439", sourceRow: 440, primaryTeam: "washington-commanders", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2019-03-13-0353": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Baltimore Ravens Win B/C-.",
    verdict: "Baltimore Ravens Win",
    grades: { "denver-broncos": "C-", "baltimore-ravens": "B" },
    teamKeys: ["denver-broncos", "baltimore-ravens"],
    summary: "Denver acquired Joe Flacco for a fourth-round pick, but the move did not solve the quarterback problem. Baltimore converted a departing veteran into useful draft value.",
    partnerSummary: "Baltimore received 2019 4th round pick (113th overall, Justice Hill) and gave up Joe Flacco. The Ravens captured the stronger long-term value.",
    analysis: "Baltimore holds the edge because Denver paid meaningful draft capital for a short-lived quarterback solution, while the Ravens recovered a fourth-round pick.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2019-03-13-0353", sourceRow: 344, primaryTeam: "denver-broncos", partnerTeam: "baltimore-ravens" },
      { sourceTeam: "baltimore-ravens", sourceTradeId: "BAL-2019-0082", sourceRow: 83, primaryTeam: "baltimore-ravens", partnerTeam: "denver-broncos" }
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
  backupPath = path.join(path.dirname(DATA_PATH), `trades.backup-before-bottom-batch-008-final-12-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
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

const trueFlips = [
  "MIN-2018-03-14-0266: Even Trade -> Denver Broncos Win, Broncos B- / Vikings C",
  "DEN-2018-04-28-0350: Even Trade -> Los Angeles/St. Louis Rams Win, Rams B / Broncos C+",
  "DEN-2019-03-13-0352: Even Trade -> Washington Redskins Win, Washington B / Denver C"
];

const report = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  bottomBatchNumber: 8,
  recordsTargeted: records.length,
  blockedRecords: blocked,
  quarantineRemovals: 0,
  trueGradeVerdictFlips: trueFlips,
  backupPath,
  statusCounts,
  records
};

writeJson(OUT_JSON, report);

const txt = `# NFL Bottom Batch 008 Final 12 ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

Purpose:
- Resolve the 9 structural holds and 3 grade/verdict reviews left after the copy-only pass.
- Remove duplicate/stale perspectives.
- Remove public backend/provisional/internal language from perspectives.
- Split malformed player-plus-pick assets into clean player/pick arrays.
- Preserve or update visible grades/verdicts according to reviewed decisions.

## Summary
- Records targeted: ${records.length}
- Blocked records: ${blocked}
- Quarantine removals: 0
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}

## True Grade/Verdict Flips
${trueFlips.map(x => `- ${x}`).join("\n")}

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
- JSON: reports/quality/nfl-bottom-batch-008-final-12-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-bottom-batch-008-final-12-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Bottom Batch 008 final 12 ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blocked}`);
console.log(`Quarantine removals: 0`);
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-008-final-12-${applyMode ? "apply" : "dry-run"}-v1.txt`);
