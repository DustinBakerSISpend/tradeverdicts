const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const applyMode = process.argv.includes("--apply");
const batchLabel = "007";

const OUT_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-22-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-22-${applyMode ? "apply" : "dry-run"}-v1.txt`);

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
  "washington-commanders": "Washington Commanders"
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
  "PIT-2019-0362": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Pittsburgh Steelers Win C+/C and remove stale Arizona-win/internal copy.",
    verdict: "Pittsburgh Steelers Win",
    grades: { "pittsburgh-steelers": "C+", "arizona-cardinals": "C" },
    teamKeys: ["pittsburgh-steelers", "arizona-cardinals"],
    summary: "Pittsburgh moved Marcus Gilbert for the sixth-round pick that became Ulysees Gilbert. Arizona received veteran tackle help, but the cleaner long-term asset value stays slightly with Pittsburgh.",
    partnerSummary: "Arizona received Marcus Gilbert and gave up 2019 6th round pick (207th overall, Ulysees Gilbert). The Cardinals got short-term veteran help, but Pittsburgh keeps the narrow hindsight edge.",
    analysis: "Pittsburgh holds a narrow edge because it converted Marcus Gilbert into draft value while Arizona did not get enough durable return from the veteran side.",
    perspectives: [
      { sourceTeam: "pittsburgh-steelers", sourceTradeId: "PIT-2019-0362", sourceRow: 363, primaryTeam: "pittsburgh-steelers", partnerTeam: "arizona-cardinals" },
      { sourceTeam: "arizona-cardinals", sourceTradeId: "ARI-2019-0316", sourceRow: 317, primaryTeam: "arizona-cardinals", partnerTeam: "pittsburgh-steelers" }
    ]
  },

  "TB-2019-0244": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to Tampa Bay Buccaneers Win and repair malformed duplicated assets.",
    assetsReceived: {
      "tampa-bay-buccaneers": [
        { type: "pick", asset: "2019 6th round pick (208th overall, Scott Miller)" }
      ],
      "philadelphia-eagles": [
        { type: "player", asset: "DeSean Jackson" },
        { type: "pick", asset: "2020 7th round pick (228th overall subsequently traded, Sterling Hofrichter)" }
      ]
    },
    verdict: "Tampa Bay Buccaneers Win",
    grades: { "tampa-bay-buccaneers": "B-", "philadelphia-eagles": "C+" },
    teamKeys: ["tampa-bay-buccaneers", "philadelphia-eagles"],
    summary: "Tampa Bay moved DeSean Jackson and a future seventh for the pick that became Scott Miller. Jackson's second Eagles stint was limited, while Miller became a useful role receiver on a Super Bowl roster.",
    partnerSummary: "Philadelphia received DeSean Jackson and 2020 7th round pick (228th overall subsequently traded, Sterling Hofrichter) while giving up 2019 6th round pick (208th overall, Scott Miller). The return was useful but did not beat Tampa Bay's side.",
    analysis: "Tampa Bay holds the edge because Scott Miller supplied more practical value than Philadelphia received from Jackson's limited return and the later seventh-round pick.",
    perspectives: [
      { sourceTeam: "tampa-bay-buccaneers", sourceTradeId: "TB-2019-0244", sourceRow: 245, primaryTeam: "tampa-bay-buccaneers", partnerTeam: "philadelphia-eagles" },
      { sourceTeam: "philadelphia-eagles", sourceTradeId: "PHI-2019-0406", sourceRow: 407, primaryTeam: "philadelphia-eagles", partnerTeam: "tampa-bay-buccaneers" }
    ]
  },

  "DEN-2019-04-25-0354": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Denver Broncos Win B+/D.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B+", "pittsburgh-steelers": "D" },
    teamKeys: ["denver-broncos", "pittsburgh-steelers"],
    summary: "Denver traded down from No. 10, passed on Devin Bush, and collected the picks tied to Noah Fant, Drew Sample, and Lloyd Cushenberry. The full return was mixed, but Denver clearly gained more value than Pittsburgh did from the costly trade-up.",
    partnerSummary: "Pittsburgh received 2019 1st round pick (10th overall, Devin Bush) while giving up the pick package tied to Noah Fant, Drew Sample, and Lloyd Cushenberry. The trade-up cost outweighed the return.",
    analysis: "Denver holds the edge because Pittsburgh paid a first, second, and future third to select Devin Bush, while Denver's trade-down package produced more total value.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2019-04-25-0354", sourceRow: 345, primaryTeam: "denver-broncos", partnerTeam: "pittsburgh-steelers" },
      { sourceTeam: "pittsburgh-steelers", sourceTradeId: "PIT-2019-0363", sourceRow: 364, primaryTeam: "pittsburgh-steelers", partnerTeam: "denver-broncos" }
    ]
  },

  "SEA-2019-04-25-0202": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Seattle Seahawks Win B-/C+ and remove stale provisional/even copy.",
    assetsReceived: {
      "seattle-seahawks": [
        { type: "pick", asset: "2019 1st round pick (30th overall subsequently traded, Deandre Baker)" },
        { type: "pick", asset: "2019 4th round pick (114th overall subsequently traded, Dru Samia)" },
        { type: "pick", asset: "2019 4th round pick (118th overall subsequently traded, Hjalte Froholdt)" }
      ],
      "green-bay-packers": [
        { type: "pick", asset: "2019 1st round pick (21st overall, Darnell Savage)" }
      ]
    },
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "B-", "green-bay-packers": "C+" },
    teamKeys: ["seattle-seahawks", "green-bay-packers"],
    summary: "Seattle moved down from No. 21 to No. 30 and added two fourth-round picks while Green Bay moved up for Darnell Savage. The Packers got a starter, but Seattle created the stronger draft-capital position.",
    partnerSummary: "Green Bay received 2019 1st round pick (21st overall, Darnell Savage) and gave up pick Nos. 30, 114, and 118. Savage helped, but the cost keeps the Packers behind Seattle.",
    analysis: "Seattle holds the edge because it converted the No. 21 slot into a broader pick package while Green Bay's move up for Darnell Savage did not create enough separation.",
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2019-04-25-0202", sourceRow: 193, primaryTeam: "seattle-seahawks", partnerTeam: "green-bay-packers" },
      { sourceTeam: "green-bay-packers", sourceTradeId: "GB-2019-0429", sourceRow: 430, primaryTeam: "green-bay-packers", partnerTeam: "seattle-seahawks" }
    ]
  },

  "BUF-2019-0309": {
    action: "patch",
    reason: "Structural cleanup: remove unrelated Cleveland/Indianapolis contamination and flip the actual Buffalo/Raiders trade to Las Vegas Raiders Win.",
    assetsReceived: {
      "buffalo-bills": [
        { type: "pick", asset: "2019 2nd round pick (38th overall, Cody Ford)" }
      ],
      "las-vegas-raiders": [
        { type: "pick", asset: "2019 2nd round pick (40th overall, Trayvon Mullen)" },
        { type: "pick", asset: "2019 5th round pick (158th overall subsequently traded, Michael Jackson)" }
      ]
    },
    verdict: "Las Vegas Raiders Win",
    grades: { "buffalo-bills": "C", "las-vegas-raiders": "B-" },
    teamKeys: ["buffalo-bills", "las-vegas-raiders"],
    summary: "Buffalo moved up two spots for Cody Ford, while the Raiders landed Trayvon Mullen and an additional fifth-round asset. Ford did not deliver enough value to justify the small trade-up cost.",
    partnerSummary: "Las Vegas received 2019 2nd round pick (40th overall, Trayvon Mullen) and 2019 5th round pick (158th overall subsequently traded, Michael Jackson) while giving up 2019 2nd round pick (38th overall, Cody Ford). The Raiders kept the stronger side of the exchange.",
    analysis: "Las Vegas holds the edge because it moved down only two spots, added a fifth-round asset, and still received a better realized return than Buffalo received from Cody Ford.",
    perspectives: [
      { sourceTeam: "buffalo-bills", sourceTradeId: "BUF-2019-0309", sourceRow: 310, primaryTeam: "buffalo-bills", partnerTeam: "las-vegas-raiders" },
      { sourceTeam: "las-vegas-raiders", sourceTradeId: "RAI-2019-0386", sourceRow: 387, primaryTeam: "las-vegas-raiders", partnerTeam: "buffalo-bills" }
    ]
  },

  "DEN-2019-04-26-0355": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspectives and preserve Cincinnati Bengals Win D+/B.",
    verdict: "Cincinnati Bengals Win",
    grades: { "denver-broncos": "D+", "cincinnati-bengals": "B" },
    teamKeys: ["denver-broncos", "cincinnati-bengals"],
    summary: "Denver traded up for Drew Lock, an understandable quarterback swing that did not become a long-term answer. Cincinnati gained extra draft volume and kept the better overall hindsight position.",
    partnerSummary: "Cincinnati received 2019 2nd round pick (52nd overall, Drew Sample), 2019 4th round pick (125th overall, Renell Wren), and 2019 6th round pick (182nd overall, Trayveon Williams) while giving up the Drew Lock pick.",
    analysis: "Cincinnati holds the edge because Denver's quarterback bet did not land, while the Bengals gained additional draft volume from moving down.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2019-04-26-0355", sourceRow: 346, primaryTeam: "denver-broncos", partnerTeam: "cincinnati-bengals" },
      { sourceTeam: "cincinnati-bengals", sourceTradeId: "CIN-2019-0140", sourceRow: 141, primaryTeam: "cincinnati-bengals", partnerTeam: "denver-broncos" }
    ]
  },

  "MIN-2019-0265": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Seattle Seahawks Win B-/C and remove provisional/even copy.",
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "B-", "minnesota-vikings": "C" },
    teamKeys: ["minnesota-vikings", "seattle-seahawks"],
    summary: "Minnesota moved down from Cody Barton's slot and received later picks tied to Chuma Edoga and Byron Cowart. Seattle's side kept the cleaner realized value, giving the Seahawks the edge.",
    partnerSummary: "Seattle received 2019 3rd round pick (88th overall, Cody Barton) and 2019 6th round pick (209th overall, Demarcus Christmas) while giving up the later package. Cody Barton carried the stronger return.",
    analysis: "Seattle holds the edge because Cody Barton became the best realized asset in the exchange, while Minnesota's return did not match that value.",
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2019-0265", sourceRow: 266, primaryTeam: "minnesota-vikings", partnerTeam: "seattle-seahawks" },
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2019-04-26-0205", sourceRow: 196, primaryTeam: "seattle-seahawks", partnerTeam: "minnesota-vikings" }
    ]
  },

  "RAM-2019-0501": {
    action: "patch",
    reason: "Structural cleanup: keep the primary Rams/Patriots No. 45 trade and remove the separate No. 97/No. 101 contamination.",
    assetsReceived: {
      "los-angeles-rams": [
        { type: "pick", asset: "2019 2nd round pick (56th overall subsequently traded, Mecole Hardman)" },
        { type: "pick", asset: "2019 3rd round pick (101st overall subsequently traded, Yodny Cajuste)" }
      ],
      "new-england-patriots": [
        { type: "pick", asset: "2019 2nd round pick (45th overall, Joejuan Williams)" }
      ]
    },
    verdict: "Los Angeles Rams Win",
    grades: { "los-angeles-rams": "C+", "new-england-patriots": "C-" },
    teamKeys: ["los-angeles-rams", "new-england-patriots"],
    summary: "The Rams moved down from No. 45 and collected the picks tied to Mecole Hardman and Yodny Cajuste, while New England moved up for Joejuan Williams. The Patriots did not get enough from Williams to justify the move.",
    partnerSummary: "New England received 2019 2nd round pick (45th overall, Joejuan Williams) and gave up the package tied to Mecole Hardman and Yodny Cajuste. The trade-up return lagged behind the Rams' value.",
    analysis: "Los Angeles holds the edge because New England's move up for Joejuan Williams produced limited value, while the Rams created more flexibility and better total asset value.",
    perspectives: [
      { sourceTeam: "los-angeles-rams", sourceTradeId: "RAM-2019-0501", sourceRow: 502, primaryTeam: "los-angeles-rams", partnerTeam: "new-england-patriots" },
      { sourceTeam: "new-england-patriots", sourceTradeId: "NE-2019-0398", sourceRow: 399, primaryTeam: "new-england-patriots", partnerTeam: "los-angeles-rams" }
    ]
  },

  "SEA-2019-04-26-0206": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to Seattle Seahawks Win for the D.K. Metcalf trade.",
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "A+", "new-england-patriots": "C-" },
    teamKeys: ["seattle-seahawks", "new-england-patriots"],
    summary: "Seattle traded up to No. 64 for D.K. Metcalf, sending New England the picks tied to Chase Winovich and Hjalte Froholdt. Metcalf became a true top-tier receiver, making this a clear Seahawks win.",
    partnerSummary: "New England received 2019 3rd round pick (77th overall, Chase Winovich) and 2019 4th round pick (118th overall, Hjalte Froholdt) while giving up the pick that became D.K. Metcalf. The return did not approach Metcalf's value.",
    analysis: "Seattle wins clearly because D.K. Metcalf became a high-end receiver while New England's return remained limited by comparison.",
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2019-04-26-0206", sourceRow: 197, primaryTeam: "seattle-seahawks", partnerTeam: "new-england-patriots" },
      { sourceTeam: "new-england-patriots", sourceTradeId: "NE-2019-0401", sourceRow: 402, primaryTeam: "new-england-patriots", partnerTeam: "seattle-seahawks" }
    ]
  },

  "DEN-2019-04-27-0356": {
    action: "patch",
    reason: "Structural cleanup and grade/verdict decision: flip Even Trade to San Francisco 49ers Win after Dre Greenlaw outcome.",
    assetsReceived: {
      "denver-broncos": [
        { type: "player", asset: "Dekoda Watson" },
        { type: "pick", asset: "2019 6th round pick (212th overall subsequently traded, Dennis Daley)" }
      ],
      "san-francisco-49ers": [
        { type: "pick", asset: "2019 5th round pick (148th overall, Dre Greenlaw)" }
      ]
    },
    verdict: "San Francisco 49ers Win",
    grades: { "denver-broncos": "F", "san-francisco-49ers": "A+" },
    teamKeys: ["denver-broncos", "san-francisco-49ers"],
    summary: "Denver received Dekoda Watson and a sixth-round pick, while San Francisco moved up for the pick that became Dre Greenlaw. Greenlaw's career made the 49ers' side a clear win.",
    partnerSummary: "San Francisco received 2019 5th round pick (148th overall, Dre Greenlaw) and gave up Dekoda Watson plus 2019 6th round pick (212th overall subsequently traded, Dennis Daley). Greenlaw became the decisive asset.",
    analysis: "San Francisco wins clearly because Dre Greenlaw became a major defensive contributor, far outpacing Denver's return.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2019-04-27-0356", sourceRow: 347, primaryTeam: "denver-broncos", partnerTeam: "san-francisco-49ers" },
      { sourceTeam: "san-francisco-49ers", sourceTradeId: "SF-2019-0397", sourceRow: 398, primaryTeam: "san-francisco-49ers", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2019-04-27-0357": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Carolina Panthers Win B-/C.",
    verdict: "Carolina Panthers Win",
    grades: { "denver-broncos": "C", "carolina-panthers": "B-" },
    teamKeys: ["denver-broncos", "carolina-panthers"],
    summary: "Denver moved up for Juwann Winfree, while Carolina collected the picks tied to Dennis Daley and Terry Godwin. Carolina received the stronger depth return.",
    partnerSummary: "Carolina received 2019 6th round pick (212th overall, Dennis Daley) and 2019 7th round pick (237th overall, Terry Godwin) while giving up 2019 6th round pick (187th overall, Juwann Winfree).",
    analysis: "Carolina holds the edge because Dennis Daley and the extra pick created more value than Denver received from Juwann Winfree.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2019-04-27-0357", sourceRow: 348, primaryTeam: "denver-broncos", partnerTeam: "carolina-panthers" },
      { sourceTeam: "carolina-panthers", sourceTradeId: "CAR-2019-0068", sourceRow: 68, primaryTeam: "carolina-panthers", partnerTeam: "denver-broncos" }
    ]
  },

  "MIN-2019-0269": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to New England Patriots Win.",
    verdict: "New England Patriots Win",
    grades: { "minnesota-vikings": "C", "new-england-patriots": "B-" },
    teamKeys: ["minnesota-vikings", "new-england-patriots"],
    summary: "Minnesota moved down from Byron Cowart's slot and added a seventh-round pick. New England received the cleaner single asset and the better realized value.",
    partnerSummary: "New England received 2019 5th round pick (159th overall, Byron Cowart) and gave up 2019 5th round pick (162nd overall, Cameron Smith) and 2019 7th round pick (239th overall, Dillon Mitchell).",
    analysis: "New England holds the edge because Byron Cowart became the best realized asset in a minor pick swap.",
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2019-0269", sourceRow: 270, primaryTeam: "minnesota-vikings", partnerTeam: "new-england-patriots" },
      { sourceTeam: "new-england-patriots", sourceTradeId: "NE-2019-0403", sourceRow: 404, primaryTeam: "new-england-patriots", partnerTeam: "minnesota-vikings" }
    ]
  },

  "SEA-2019-04-29-0209": {
    action: "patch",
    reason: "Grade/verdict decision: flip New England Patriots Win to Seattle Seahawks Win for Jacob Hollister return.",
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "B-", "new-england-patriots": "C" },
    teamKeys: ["seattle-seahawks", "new-england-patriots"],
    summary: "Seattle acquired Jacob Hollister for a future seventh-round pick. Hollister gave the Seahawks useful tight end production, while New England's pick return stayed minor.",
    partnerSummary: "New England received 2020 7th round pick (241st overall subsequently traded, Chapelle Russell) and gave up Jacob Hollister. The pick value did not match Hollister's Seattle production.",
    analysis: "Seattle holds the edge because Hollister gave the Seahawks useful offensive snaps for a low acquisition price.",
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2019-04-29-0209", sourceRow: 200, primaryTeam: "seattle-seahawks", partnerTeam: "new-england-patriots" },
      { sourceTeam: "new-england-patriots", sourceTradeId: "NE-2019-0405", sourceRow: 406, primaryTeam: "new-england-patriots", partnerTeam: "seattle-seahawks" }
    ]
  },

  "PHI-2019-0413": {
    action: "patch",
    reason: "Grade/verdict decision: flip Arizona/St. Louis Cardinals Win to Philadelphia Eagles Win.",
    verdict: "Philadelphia Eagles Win",
    grades: { "philadelphia-eagles": "C+", "arizona-cardinals": "C" },
    teamKeys: ["philadelphia-eagles", "arizona-cardinals"],
    summary: "Philadelphia acquired Rudy Ford for Bruce Hector. Ford provided the more useful NFL return, giving the Eagles the edge in a small player-for-player move.",
    partnerSummary: "Arizona received Bruce Hector and sent Rudy Ford. The Cardinals' return did not match the value Philadelphia got from Ford.",
    analysis: "Philadelphia holds the edge because Rudy Ford became the more useful player in the exchange.",
    perspectives: [
      { sourceTeam: "philadelphia-eagles", sourceTradeId: "PHI-2019-0413", sourceRow: 414, primaryTeam: "philadelphia-eagles", partnerTeam: "arizona-cardinals" },
      { sourceTeam: "arizona-cardinals", sourceTradeId: "ARI-2019-0318", sourceRow: 319, primaryTeam: "arizona-cardinals", partnerTeam: "philadelphia-eagles" }
    ]
  },

  "CLE-2019-0432": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Detroit Lions Win B-/C+ and remove stale Even copy.",
    verdict: "Detroit Lions Win",
    grades: { "cleveland-browns": "C+", "detroit-lions": "B-" },
    teamKeys: ["cleveland-browns", "detroit-lions"],
    summary: "Cleveland received the future seventh tied to Isaiah Thomas, while Detroit received David Blough and a future seventh tied to Jonathan Ford. The Lions kept the better value side.",
    partnerSummary: "Detroit received David Blough and 2022 7th round pick (234th overall subsequently traded, Jonathan Ford) while giving up 2022 7th round pick (223rd overall, Isaiah Thomas).",
    analysis: "Detroit holds the edge because it received the more useful overall package in a minor depth trade.",
    perspectives: [
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2019-0432", sourceRow: 432, primaryTeam: "cleveland-browns", partnerTeam: "detroit-lions" },
      { sourceTeam: "detroit-lions", sourceTradeId: "DET-2019-0378", sourceRow: 378, primaryTeam: "detroit-lions", partnerTeam: "cleveland-browns" }
    ]
  },

  "DEN-2019-08-30-0358": {
    action: "patch",
    reason: "Structural cleanup: split Duke Dawson/pick asset, remove duplicate Denver perspective, and preserve Even Trade C/C.",
    assetsReceived: {
      "denver-broncos": [
        { type: "player", asset: "Duke Dawson" },
        { type: "pick", asset: "2020 7th round pick (237th overall subsequently traded, Thakarius Keyes)" }
      ],
      "new-england-patriots": [
        { type: "pick", asset: "2020 6th round pick (195th overall, Justin Herron)" }
      ]
    },
    verdict: "Even Trade",
    grades: { "denver-broncos": "C", "new-england-patriots": "C" },
    teamKeys: ["denver-broncos", "new-england-patriots"],
    summary: "Denver acquired Duke Dawson and a future seventh-round pick for the future sixth-round pick tied to Justin Herron. The exchange remains close enough for an Even Trade grade.",
    partnerSummary: "New England received 2020 6th round pick (195th overall, Justin Herron) and gave up Duke Dawson plus 2020 7th round pick (237th overall subsequently traded, Thakarius Keyes).",
    analysis: "This remains an Even Trade because neither side created enough durable separation from a minor player-and-pick exchange.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2019-08-30-0358", sourceRow: 349, primaryTeam: "denver-broncos", partnerTeam: "new-england-patriots" },
      { sourceTeam: "new-england-patriots", sourceTradeId: "NE-2019-0408", sourceRow: 409, primaryTeam: "new-england-patriots", partnerTeam: "denver-broncos" }
    ]
  },

  "MIA-2019-0283": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Miami Dolphins Win and align stale Minnesota copy.",
    verdict: "Miami Dolphins Win",
    grades: { "miami-dolphins": "C", "minnesota-vikings": "D+" },
    teamKeys: ["miami-dolphins", "minnesota-vikings"],
    summary: "Miami acquired Danny Isidora from Minnesota for a future seventh-round pick. The move was minor, but Miami's immediate player return gives it the modest edge.",
    partnerSummary: "Minnesota received 2020 7th round pick (219th overall subsequently traded, Geno Stone) and gave up Danny Isidora. The Vikings' return stayed limited in the direct exchange.",
    analysis: "Miami holds a modest edge because it received the usable player in a low-stakes trade, while Minnesota's future pick return did not create enough direct value.",
    perspectives: [
      { sourceTeam: "miami-dolphins", sourceTradeId: "MIA-2019-0283", sourceRow: 284, primaryTeam: "miami-dolphins", partnerTeam: "minnesota-vikings" },
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2019-0274", sourceRow: 275, primaryTeam: "minnesota-vikings", partnerTeam: "miami-dolphins" }
    ]
  },

  "CLE-2019-0434": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Cleveland Browns Win B/C+ and remove stale Even copy.",
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "B", "green-bay-packers": "C+" },
    teamKeys: ["cleveland-browns", "green-bay-packers"],
    summary: "Cleveland received Jordan McCray and the future seventh-round asset tied to Nate Stanley, while Green Bay received the future seventh tied to Vernon Scott. The Browns kept the stronger package.",
    partnerSummary: "Green Bay received 2020 7th round pick (236th overall, Vernon Scott) and gave up Jordan McCray plus 2020 7th round pick (244th overall subsequently traded, Nate Stanley).",
    analysis: "Cleveland holds the edge because its incoming package carried more value than the single late pick Green Bay received.",
    perspectives: [
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2019-0434", sourceRow: 434, primaryTeam: "cleveland-browns", partnerTeam: "green-bay-packers" },
      { sourceTeam: "green-bay-packers", sourceTradeId: "GB-2019-0431", sourceRow: 431, primaryTeam: "green-bay-packers", partnerTeam: "cleveland-browns" }
    ]
  },

  "SEA-2019-08-31-0210": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to Seattle Seahawks Win and repair not-conveyed conditional asset.",
    assetsReceived: {
      "seattle-seahawks": [
        { type: "player", asset: "Parry Nickerson" }
      ],
      "new-york-jets": [
        { type: "pick", asset: "conditional 2021 7th round pick (not conveyed)" }
      ]
    },
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "C+", "new-york-jets": "C" },
    teamKeys: ["seattle-seahawks", "new-york-jets"],
    summary: "Seattle acquired Parry Nickerson while the conditional seventh-round pick to New York was not conveyed. The stakes were minor, but Seattle received the only realized asset.",
    partnerSummary: "New York's conditional 2021 seventh-round pick was not conveyed, leaving the Jets without a realized return for Parry Nickerson.",
    analysis: "Seattle holds a small edge because it received Parry Nickerson and the conditional pick did not convey to New York.",
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2019-08-31-0210", sourceRow: 201, primaryTeam: "seattle-seahawks", partnerTeam: "new-york-jets" },
      { sourceTeam: "new-york-jets", sourceTradeId: "NYJ-2019-0271", sourceRow: 272, primaryTeam: "new-york-jets", partnerTeam: "seattle-seahawks" }
    ]
  },

  "PIT-2019-0365": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Jacksonville Jaguars Win C+/C and remove stale Even copy.",
    verdict: "Jacksonville Jaguars Win",
    grades: { "pittsburgh-steelers": "C", "jacksonville-jaguars": "C+" },
    teamKeys: ["pittsburgh-steelers", "jacksonville-jaguars"],
    summary: "Pittsburgh received the future fifth-round pick tied to Jason Strowbridge, while Jacksonville received Joshua Dobbs. The Jaguars keep a slight edge because they received the usable quarterback depth in the direct deal.",
    partnerSummary: "Jacksonville received Joshua Dobbs and gave up 2020 5th round pick (154th overall subsequently traded, Jason Strowbridge). The trade remains a narrow Jaguars win.",
    analysis: "Jacksonville holds a small edge because Joshua Dobbs gave it the more useful immediate return in a minor deal.",
    perspectives: [
      { sourceTeam: "pittsburgh-steelers", sourceTradeId: "PIT-2019-0365", sourceRow: 366, primaryTeam: "pittsburgh-steelers", partnerTeam: "jacksonville-jaguars" },
      { sourceTeam: "jacksonville-jaguars", sourceTradeId: "JAX-2019-0073", sourceRow: 73, primaryTeam: "jacksonville-jaguars", partnerTeam: "pittsburgh-steelers" }
    ]
  },

  "DEN-2019-10-22-0359": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve San Francisco 49ers Win B/B-.",
    assetsReceived: {
      "denver-broncos": [
        { type: "pick", asset: "2020 3rd round pick (95th overall, McTelvin Agim)" },
        { type: "pick", asset: "2020 4th round pick (137th overall subsequently traded, Josiah Scott)" }
      ],
      "san-francisco-49ers": [
        { type: "player", asset: "Emmanuel Sanders" },
        { type: "pick", asset: "2020 5th round pick (156th overall subsequently traded)" }
      ]
    },
    verdict: "San Francisco 49ers Win",
    grades: { "denver-broncos": "B-", "san-francisco-49ers": "B" },
    teamKeys: ["denver-broncos", "san-francisco-49ers"],
    summary: "Denver received third- and fourth-round draft capital for Emmanuel Sanders, while San Francisco added Sanders and a fifth-round pick for a Super Bowl push. The 49ers' immediate return gives them the narrow edge.",
    partnerSummary: "San Francisco received Emmanuel Sanders and a 2020 fifth-round pick while giving up the picks tied to McTelvin Agim and Josiah Scott. Sanders' impact on a contender gives San Francisco the edge.",
    analysis: "San Francisco holds a narrow edge because Sanders helped a Super Bowl run, while Denver's pick return did not create enough long-term value to overtake it.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2019-10-22-0359", sourceRow: 350, primaryTeam: "denver-broncos", partnerTeam: "san-francisco-49ers" },
      { sourceTeam: "san-francisco-49ers", sourceTradeId: "SF-2019-0400", sourceRow: 401, primaryTeam: "san-francisco-49ers", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2020-03-03-0360": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to Jacksonville Jaguars Win and remove duplicate Denver perspective.",
    verdict: "Jacksonville Jaguars Win",
    grades: { "denver-broncos": "C", "jacksonville-jaguars": "C+" },
    teamKeys: ["denver-broncos", "jacksonville-jaguars"],
    summary: "Denver acquired A.J. Bouye for the fourth-round pick that became Josiah Scott. Bouye did not provide enough Denver value, making Jacksonville's draft-capital return the better side.",
    partnerSummary: "Jacksonville received 2020 4th round pick (137th overall, Josiah Scott) and gave up A.J. Bouye. The Jaguars converted a veteran into useful draft capital.",
    analysis: "Jacksonville holds the edge because Bouye's Denver stint did not justify the pick cost, while the Jaguars successfully converted him into draft capital.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2020-03-03-0360", sourceRow: 351, primaryTeam: "denver-broncos", partnerTeam: "jacksonville-jaguars" },
      { sourceTeam: "jacksonville-jaguars", sourceTradeId: "JAX-2020-0075", sourceRow: 76, primaryTeam: "jacksonville-jaguars", partnerTeam: "denver-broncos" }
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
  backupPath = path.join(path.dirname(DATA_PATH), `trades.backup-before-bottom-batch-007-final-22-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
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
  "TB-2019-0244: Even Trade -> Tampa Bay Buccaneers Win, Buccaneers B- / Eagles C+",
  "BUF-2019-0309: Even Trade -> Las Vegas Raiders Win, Raiders B- / Bills C",
  "SEA-2019-04-26-0206: Even Trade -> Seattle Seahawks Win, Seahawks A+ / Patriots C-",
  "DEN-2019-04-27-0356: Even Trade -> San Francisco 49ers Win, 49ers A+ / Broncos F",
  "MIN-2019-0269: Even Trade -> New England Patriots Win, Patriots B- / Vikings C",
  "SEA-2019-04-29-0209: New England Patriots Win -> Seattle Seahawks Win, Seahawks B- / Patriots C",
  "PHI-2019-0413: Arizona/St. Louis Cardinals Win -> Philadelphia Eagles Win, Eagles C+ / Cardinals C",
  "SEA-2019-08-31-0210: Even Trade -> Seattle Seahawks Win, Seahawks C+ / Jets C",
  "DEN-2020-03-03-0360: Even Trade -> Jacksonville Jaguars Win, Jaguars C+ / Broncos C"
];

const report = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  bottomBatchNumber: 7,
  recordsTargeted: records.length,
  blockedRecords: blocked,
  quarantineRemovals: 0,
  trueGradeVerdictFlips: trueFlips,
  backupPath,
  statusCounts,
  records
};

writeJson(OUT_JSON, report);

const txt = `# NFL Bottom Batch 007 Final 22 ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

Purpose:
- Resolve the 9 structural holds and 13 grade/verdict reviews left after the copy-only pass.
- Remove duplicate/stale perspectives and unrelated trade contamination.
- Remove public backend/provisional/internal language from perspectives.
- Repair malformed duplicated assets on DeSean Jackson/Scott Miller, D.K. Metcalf, Parry Nickerson, and several Denver/SF draft-pick rows.
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
- JSON: reports/quality/nfl-bottom-batch-007-final-22-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-bottom-batch-007-final-22-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Bottom Batch 007 final 22 ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blocked}`);
console.log(`Quarantine removals: 0`);
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-007-final-22-${applyMode ? "apply" : "dry-run"}-v1.txt`);
