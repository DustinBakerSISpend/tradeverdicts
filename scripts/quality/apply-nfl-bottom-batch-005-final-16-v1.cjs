const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

const applyMode = process.argv.includes("--apply");
const batchLabel = "005";

const OUT_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-16-${applyMode ? "apply" : "dry-run"}-v1.json`);
const OUT_TXT = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-final-16-${applyMode ? "apply" : "dry-run"}-v1.txt`);
const QUARANTINE_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-${batchLabel}-quarantined-records-v1.json`);

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

function compact(v, max = 340) {
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
    primarySummary: `${primary} acquired ${primaryAssets} from ${other} for ${otherAssets}. The stronger recorded return sits with ${winner}, matching the ${t.verdict} verdict.`,
    partnerSummary: `${other} received ${otherAssets} and gave up ${primaryAssets}. The overall value edge goes to ${winner}.`,
    analysis: `The edge goes to ${winner} because the recorded return is stronger than what it gave up.`
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
  "DEN-2021-04-30-0366": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Atlanta Falcons Win C+/C.",
    verdict: "Atlanta Falcons Win",
    grades: { "denver-broncos": "C", "atlanta-falcons": "C+" },
    teamKeys: ["denver-broncos", "atlanta-falcons"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2021-04-30-0366", sourceRow: 357, primaryTeam: "denver-broncos", partnerTeam: "atlanta-falcons" },
      { sourceTeam: "atlanta-falcons", sourceTradeId: "ATL-2021-0283", sourceRow: 284, primaryTeam: "atlanta-falcons", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2021-04-30-0367": {
    action: "patch",
    reason: "Structural cleanup: collapse duplicate Denver-only perspectives and preserve Denver Broncos Win C+/C.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "new-york-giants": "C" },
    teamKeys: ["denver-broncos", "new-york-giants"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2021-04-30-0367", sourceRow: 358, primaryTeam: "denver-broncos", partnerTeam: "new-york-giants" }
    ]
  },

  "DEN-2021-04-30-0368": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective and preserve Denver Broncos Win B/D.",
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B", "new-orleans-saints": "D" },
    teamKeys: ["denver-broncos", "new-orleans-saints"],
    summary: "Denver moved down with New Orleans and still landed Quinn Meinerz, while also adding the pick that became Baron Browning. Meinerz developed into a high-end interior lineman, giving Denver the stronger outcome.",
    partnerSummary: "New Orleans received 2021 3rd round pick (76th overall, Paulson Adebo) and gave up 2021 3rd round pick (98th overall, Quinn Meinerz) and 2021 3rd round pick (105th overall, Baron Browning). The value edge belongs to Denver.",
    analysis: "Denver gets the edge because it turned the move down into Quinn Meinerz plus another third-round asset. Paulson Adebo helped New Orleans, but the combined Denver return proved stronger.",
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2021-04-30-0368", sourceRow: 359, primaryTeam: "denver-broncos", partnerTeam: "new-orleans-saints" },
      { sourceTeam: "new-orleans-saints", sourceTradeId: "NO-2021-0323", sourceRow: 324, primaryTeam: "new-orleans-saints", partnerTeam: "denver-broncos" }
    ]
  },

  "CLE-2021-0442": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Detroit Lions Win and replace stale Even copy.",
    verdict: "Detroit Lions Win",
    grades: { "cleveland-browns": "D+", "detroit-lions": "A" },
    teamKeys: ["cleveland-browns", "detroit-lions"],
    perspectives: [
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2021-0442", sourceRow: 440, primaryTeam: "cleveland-browns", partnerTeam: "detroit-lions" },
      { sourceTeam: "detroit-lions", sourceTradeId: "DET-2021-0388", sourceRow: 388, primaryTeam: "detroit-lions", partnerTeam: "cleveland-browns" }
    ]
  },

  "SEA-2021-08-24-0222": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to Seattle Seahawks Win because Seattle received John Reid and the conditional pick was not conveyed.",
    assetsReceived: {
      "seattle-seahawks": [
        { type: "player", asset: "John Reid" }
      ],
      "houston-texans": [
        { type: "pick", asset: "Conditional 2023 7th round pick (not conveyed)" }
      ]
    },
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "C+", "houston-texans": "C-" },
    teamKeys: ["seattle-seahawks", "houston-texans"],
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2021-08-24-0222", sourceRow: 213, primaryTeam: "seattle-seahawks", partnerTeam: "houston-texans" },
      { sourceTeam: "houston-texans", sourceTradeId: "HOU-2021-0077", sourceRow: 78, primaryTeam: "houston-texans", partnerTeam: "seattle-seahawks" }
    ]
  },

  "DEN-2021-08-31-0369": {
    action: "patch",
    reason: "Structural cleanup: split malformed conditional asset, remove duplicate Denver perspectives, and preserve Denver Broncos Win B+/D.",
    assetsReceived: {
      "denver-broncos": [
        { type: "pick", asset: "2022 5th round pick (145th overall subsequently traded, Darian Kinnard)" },
        { type: "pick", asset: "Conditional 2022 7th round pick (not conveyed)" }
      ],
      "detroit-lions": [
        { type: "player", asset: "Trinity Benson" },
        { type: "pick", asset: "2023 6th round pick (183rd overall subsequently traded, JL Skinner)" }
      ]
    },
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B+", "detroit-lions": "D" },
    teamKeys: ["denver-broncos", "detroit-lions"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2021-08-31-0369", sourceRow: 360, primaryTeam: "denver-broncos", partnerTeam: "detroit-lions" },
      { sourceTeam: "detroit-lions", sourceTradeId: "DET-2021-0389", sourceRow: 389, primaryTeam: "detroit-lions", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2021-08-31-0370": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to Denver Broncos Win; Jonas Griffith plus the late pick carried a small but real edge.",
    assetsReceived: {
      "denver-broncos": [
        { type: "player", asset: "Jonas Griffith" },
        { type: "pick", asset: "2022 7th round pick (250th overall subsequently traded, Brittain Brown)" }
      ],
      "san-francisco-49ers": [
        { type: "pick", asset: "2022 6th round pick (187th overall, Nick Zakelj)" },
        { type: "pick", asset: "2023 7th round pick (222nd overall subsequently traded, DeWayne McBride)" }
      ]
    },
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "san-francisco-49ers": "C-" },
    teamKeys: ["denver-broncos", "san-francisco-49ers"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2021-08-31-0370", sourceRow: 361, primaryTeam: "denver-broncos", partnerTeam: "san-francisco-49ers" },
      { sourceTeam: "san-francisco-49ers", sourceTradeId: "SF-2021-0410", sourceRow: 411, primaryTeam: "san-francisco-49ers", partnerTeam: "denver-broncos" }
    ]
  },

  "SEA-2021-09-03-0224": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Pittsburgh Steelers Win and remove provisional Seattle-side copy.",
    verdict: "Pittsburgh Steelers Win",
    grades: { "seattle-seahawks": "C", "pittsburgh-steelers": "C+" },
    teamKeys: ["seattle-seahawks", "pittsburgh-steelers"],
    perspectives: [
      { sourceTeam: "seattle-seahawks", sourceTradeId: "SEA-2021-09-03-0224", sourceRow: 215, primaryTeam: "seattle-seahawks", partnerTeam: "pittsburgh-steelers" },
      { sourceTeam: "pittsburgh-steelers", sourceTradeId: "PIT-2021-0372", sourceRow: 373, primaryTeam: "pittsburgh-steelers", partnerTeam: "seattle-seahawks" }
    ]
  },

  "MIN-2021-10-23-0291": {
    action: "patch",
    reason: "Grade/verdict decision: flip Even Trade to Denver Broncos Win; Denver received Stephen Weatherly plus a later pick for a single seventh-rounder.",
    assetsReceived: {
      "minnesota-vikings": [
        { type: "pick", asset: "2022 7th round pick (250th overall subsequently traded, Brittain Brown)" }
      ],
      "denver-broncos": [
        { type: "player", asset: "Stephen Weatherly" },
        { type: "pick", asset: "2023 7th round pick (241st overall subsequently traded, Cory Trice)" }
      ]
    },
    verdict: "Denver Broncos Win",
    grades: { "minnesota-vikings": "C+", "denver-broncos": "B" },
    teamKeys: ["minnesota-vikings", "denver-broncos"],
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2021-0284", sourceRow: 285, primaryTeam: "minnesota-vikings", partnerTeam: "denver-broncos" },
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2021-10-23-0371", sourceRow: 362, primaryTeam: "denver-broncos", partnerTeam: "minnesota-vikings" }
    ]
  },

  "DEN-2021-10-25-0372": {
    action: "patch",
    reason: "Structural cleanup: remove stale Rams-win perspective and preserve Even Trade B-/B-.",
    assetsReceived: {
      "denver-broncos": [
        { type: "player", asset: "Kenny Young" },
        { type: "pick", asset: "2024 7th round pick (239th overall subsequently traded, Josiah Ezirim)" }
      ],
      "los-angeles-rams": [
        { type: "pick", asset: "2024 6th round pick (189th overall subsequently traded, Mekhi Wingo)" }
      ]
    },
    verdict: "Even Trade",
    grades: { "denver-broncos": "B-", "los-angeles-rams": "B-" },
    teamKeys: ["denver-broncos", "los-angeles-rams"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2021-10-25-0372", sourceRow: 363, primaryTeam: "denver-broncos", partnerTeam: "los-angeles-rams" },
      { sourceTeam: "los-angeles-rams", sourceTradeId: "RAM-2021-0519", sourceRow: 520, primaryTeam: "los-angeles-rams", partnerTeam: "denver-broncos" }
    ]
  },

  "DEN-2021-11-02-0373": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspective, preserve Rams Win A/B, and strip internal landmark/GSC notes.",
    verdict: "Los Angeles Rams Win",
    grades: { "los-angeles-rams": "A", "denver-broncos": "B" },
    teamKeys: ["denver-broncos", "los-angeles-rams"],
    summary: "The Rams acquired Von Miller from Denver for a 2022 second-round pick and a 2022 third-round pick, then watched him become a finishing piece on a Super Bowl champion. Denver received meaningful draft capital, but Los Angeles got exactly what contenders hope to buy: immediate championship impact.",
    partnerSummary: "Denver received a second-round pick that became Nik Bonitto and a third-round pick later tied to Nick Cross. That was fair market value for an aging star, but the Rams got Von Miller's postseason pass rush and a Super Bowl payoff.",
    analysis: "This is a Rams win, not a Broncos failure. Denver handled the situation well and received real draft capital. Los Angeles paid for a short-term title piece, and Miller helped deliver the championship result the Rams wanted.",
    perspectives: [
      {
        sourceTeam: "denver-broncos",
        sourceTradeId: "DEN-2021-11-02-0373",
        sourceRow: 364,
        primaryTeam: "denver-broncos",
        partnerTeam: "los-angeles-rams",
        primarySummary: "Denver received a second-round pick that became Nik Bonitto and a third-round pick later tied to Nick Cross. That was fair market value for an aging star, but Los Angeles got Von Miller's postseason pass rush and a Super Bowl payoff.",
        partnerSummary: "The Rams acquired Von Miller from Denver for a 2022 second-round pick and a 2022 third-round pick, then watched him become a finishing piece on a Super Bowl champion."
      },
      {
        sourceTeam: "los-angeles-rams",
        sourceTradeId: "RAM-2021-0520",
        sourceRow: 521,
        primaryTeam: "los-angeles-rams",
        partnerTeam: "denver-broncos",
        primarySummary: "The Rams acquired Von Miller from Denver for a 2022 second-round pick and a 2022 third-round pick, then watched him become a finishing piece on a Super Bowl champion.",
        partnerSummary: "Denver received meaningful draft capital, but Los Angeles got the immediate championship impact it wanted."
      }
    ]
  },

  "PHI-2021-0431": {
    action: "quarantine_remove",
    reason: "Unknown-team/undisclosed-partner placeholder with no usable assets; remove from live data and save to quarantine report."
  },

  "ARI-2022-0327": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Baltimore Ravens Win and replace stale Arizona Even copy.",
    assetsReceived: {
      "arizona-cardinals": [
        { type: "player", asset: "Marquise Brown" },
        { type: "pick", asset: "2022 3rd round pick (100th overall, Myjai Sanders)" }
      ],
      "baltimore-ravens": [
        { type: "pick", asset: "2022 1st round pick (23rd overall subsequently traded, Kaiir Elam)" }
      ]
    },
    verdict: "Baltimore Ravens Win",
    grades: { "arizona-cardinals": "C-", "baltimore-ravens": "B" },
    teamKeys: ["arizona-cardinals", "baltimore-ravens"],
    perspectives: [
      { sourceTeam: "arizona-cardinals", sourceTradeId: "ARI-2022-0327", sourceRow: 328, primaryTeam: "arizona-cardinals", partnerTeam: "baltimore-ravens" },
      { sourceTeam: "baltimore-ravens", sourceTradeId: "BAL-2022-0101", sourceRow: 102, primaryTeam: "baltimore-ravens", partnerTeam: "arizona-cardinals" }
    ]
  },

  "CLE-2022-0447": {
    action: "patch",
    reason: "Grade/verdict cleanup: preserve Cleveland Browns Win and replace stale Even copy/truncated Houston perspective.",
    assetsReceived: {
      "cleveland-browns": [
        { type: "pick", asset: "2022 3rd round pick (68th overall, Martin Emerson)" },
        { type: "pick", asset: "2022 4th round pick (108th overall, Perrion Winfrey)" },
        { type: "pick", asset: "2022 4th round pick (124th overall, Cade York)" }
      ],
      "houston-texans": [
        { type: "pick", asset: "2022 2nd round pick (44th overall, John Metchie)" }
      ]
    },
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "B+", "houston-texans": "C" },
    teamKeys: ["cleveland-browns", "houston-texans"],
    perspectives: [
      { sourceTeam: "cleveland-browns", sourceTradeId: "CLE-2022-0447", sourceRow: 445, primaryTeam: "cleveland-browns", partnerTeam: "houston-texans" },
      { sourceTeam: "houston-texans", sourceTradeId: "HOU-2022-0086", sourceRow: 87, primaryTeam: "houston-texans", partnerTeam: "cleveland-browns" }
    ]
  },

  "DEN-2022-04-29-0377": {
    action: "patch",
    reason: "Structural cleanup: remove duplicate Denver perspectives and preserve Colts Win B-/C+.",
    assetsReceived: {
      "denver-broncos": [
        { type: "pick", asset: "2022 5th round pick (179th overall subsequently traded, Kingsley Enagbare)" },
        { type: "pick", asset: "2023 3rd round pick (67th overall, Drew Sanders)" }
      ],
      "indianapolis-colts": [
        { type: "pick", asset: "2022 3rd round pick (96th overall, Nick Cross)" }
      ]
    },
    verdict: "Indianapolis Colts Win",
    grades: { "indianapolis-colts": "B-", "denver-broncos": "C+" },
    teamKeys: ["denver-broncos", "indianapolis-colts"],
    perspectives: [
      { sourceTeam: "denver-broncos", sourceTradeId: "DEN-2022-04-29-0377", sourceRow: 367, primaryTeam: "denver-broncos", partnerTeam: "indianapolis-colts" },
      { sourceTeam: "indianapolis-colts", sourceTradeId: "IND-2022-0376", sourceRow: 377, primaryTeam: "indianapolis-colts", partnerTeam: "denver-broncos" }
    ]
  },

  "MIN-2022-0286": {
    action: "patch",
    reason: "Grade/verdict decision: preserve Even Trade and neutralize stale Minnesota-side Green Bay win copy.",
    assetsReceived: {
      "minnesota-vikings": [
        { type: "pick", asset: "2022 2nd round pick (53rd overall subsequently traded, Alec Pierce)" },
        { type: "pick", asset: "2022 2nd round pick (59th overall, Ed Ingram)" }
      ],
      "green-bay-packers": [
        { type: "pick", asset: "2022 2nd round pick (34th overall, Christian Watson)" }
      ]
    },
    verdict: "Even Trade",
    grades: { "minnesota-vikings": "C+", "green-bay-packers": "C+" },
    teamKeys: ["minnesota-vikings", "green-bay-packers"],
    perspectives: [
      { sourceTeam: "minnesota-vikings", sourceTradeId: "MIN-2022-0286", sourceRow: 287, primaryTeam: "minnesota-vikings", partnerTeam: "green-bay-packers" },
      { sourceTeam: "green-bay-packers", sourceTradeId: "GB-2022-0441", sourceRow: 442, primaryTeam: "green-bay-packers", partnerTeam: "minnesota-vikings" }
    ]
  }
};

const data = readJson(DATA_PATH);
const trades = Array.isArray(data) ? data : data.trades;
if (!Array.isArray(trades)) throw new Error("Could not find trades array.");

const byId = new Map(trades.map((t, i) => [getId(t), { t, i }]));
const records = [];
const quarantine = [];
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

  if (spec.action === "quarantine_remove") {
    rec.changes.push({
      path: "(record)",
      type: "quarantine",
      before: "present in live data",
      after: "removed from live data and saved to quarantine report"
    });
    quarantine.push({ id, index: found.i, slug: t.slug, reason: spec.reason, trade: t });
    records.push(rec);
    continue;
  }

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
  backupPath = path.join(path.dirname(DATA_PATH), `trades.backup-before-bottom-batch-005-final-16-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.copyFileSync(DATA_PATH, backupPath);

  if (quarantine.length) {
    writeJson(QUARANTINE_JSON, {
      generatedAt: new Date().toISOString(),
      bottomBatchNumber: 5,
      records: quarantine
    });
  }

  const removeIds = new Set(quarantine.map(q => q.id));
  const filtered = trades.filter(t => !removeIds.has(getId(t)));

  if (Array.isArray(data)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(filtered, null, 2) + "\n");
  } else {
    data.trades = filtered;
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
  }
}

if (applyMode && blocked > 0) {
  for (const r of records) {
    if (r.status === "applied") r.status = "blocked_no_write";
  }
}

const statusCounts = {};
for (const r of records) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

const trueFlips = [
  "SEA-2021-08-24-0222: Even Trade -> Seattle Seahawks Win, Seahawks C+ / Texans C-",
  "DEN-2021-08-31-0370: Even Trade -> Denver Broncos Win, Broncos C+ / 49ers C-",
  "MIN-2021-10-23-0291: Even Trade -> Denver Broncos Win, Broncos B / Vikings C+"
];

const report = {
  generatedAt: new Date().toISOString(),
  mode: applyMode ? "apply" : "dry-run",
  bottomBatchNumber: 5,
  recordsTargeted: records.length,
  blockedRecords: blocked,
  quarantineRemovals: quarantine.length,
  trueGradeVerdictFlips: trueFlips,
  backupPath,
  quarantinePath: quarantine.length ? QUARANTINE_JSON : null,
  statusCounts,
  records
};

writeJson(OUT_JSON, report);

const txt = `# NFL Bottom Batch 005 Final 16 ${applyMode ? "Apply" : "Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

Purpose:
- Resolve the 10 structural holds and 6 grade/verdict reviews left after the copy-only pass.
- Remove duplicate/stale perspectives.
- Remove public backend/provisional/internal language from perspectives.
- Quarantine the malformed Eagles unknown-partner placeholder.
- Preserve or update visible grades/verdicts according to reviewed decisions.

## Summary
- Records targeted: ${records.length}
- Blocked records: ${blocked}
- Quarantine removals: ${quarantine.length}
${backupPath ? `- Backup created: ${backupPath}` : "- Backup created: no, dry-run only"}
${quarantine.length ? `- Quarantine file: ${QUARANTINE_JSON}` : "- Quarantine file: no quarantine records"}

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
- JSON: reports/quality/nfl-bottom-batch-005-final-16-${applyMode ? "apply" : "dry-run"}-v1.json
- TXT: reports/quality/nfl-bottom-batch-005-final-16-${applyMode ? "apply" : "dry-run"}-v1.txt
`;

fs.writeFileSync(OUT_TXT, txt);

console.log("");
console.log(`NFL Bottom Batch 005 final 16 ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blocked}`);
console.log(`Quarantine removals: ${quarantine.length}`);
console.log("Status counts:");
for (const [k, v] of Object.entries(statusCounts)) console.log(`- ${k}: ${v}`);
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-005-final-16-${applyMode ? "apply" : "dry-run"}-v1.txt`);
