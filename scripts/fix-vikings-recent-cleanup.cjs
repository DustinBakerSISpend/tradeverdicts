const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "src", "data", "nfl", "trades.json");

const PATCHES = {
  "MIN-2024-04-25-0312": {
    verdict: "New York Jets Win",
    grades: { "minnesota-vikings": "B-", "new-york-jets": "B" },
    confidence: "medium",
    summary:
      "Minnesota moved up one slot to secure J.J. McCarthy and added Will Reichard, but the Jets collected extra draft capital while still landing Olumuyiwa Fashanu. The added pick value gives New York the slight edge.",
    partnerSummary:
      "New York moved back one spot, still landed Olumuyiwa Fashanu, and added useful mid-round value. Minnesota got its quarterback target, but the Jets came away with the cleaner asset return.",
  },

  "MIN-2024-0306": {
    verdict: "Jacksonville Jaguars Win",
    grades: { "minnesota-vikings": "B-", "jacksonville-jaguars": "B+" },
    confidence: "high",
    summary:
      "Minnesota moved up for Dallas Turner, a premium defensive prospect, but Jacksonville moved down and still landed Brian Thomas Jr. while adding extra draft capital. The total return gives the Jaguars the better value.",
    partnerSummary:
      "Jacksonville traded down, landed Brian Thomas Jr., and added multiple picks. Turner remains a valuable Vikings asset, but Jacksonville’s return was stronger on the full hindsight curve.",
  },

  "MIN-2024-08-09-0314": {
    verdict: "Even Trade",
    grades: { "minnesota-vikings": "C", "dallas-cowboys": "C" },
    confidence: "medium",
    summary:
      "Minnesota swapped Andrew Booth for Nahshon Wright in a depth-cornerback exchange. Neither side created a meaningful long-term edge, making this a low-impact even trade.",
    partnerSummary:
      "Dallas took a depth swing on Andrew Booth while sending out Nahshon Wright. The exchange did not create a clear winner for either side.",
  },

  "MIN-2024-10-29-0316": {
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "B", "jacksonville-jaguars": "C-" },
    confidence: "medium",
    summary:
      "Minnesota acquired Cam Robinson for needed tackle help and paid a future fourth-round pick. Robinson gave the Vikings useful short-term protection value, while Jacksonville’s return was modest.",
    partnerSummary:
      "Jacksonville recovered a future fourth-round pick for Cam Robinson, but Minnesota received the more useful football value in the deal.",
  },

  "MIN-2025-03-18-0318": {
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "B", "san-francisco-49ers": "C+" },
    confidence: "medium",
    summary:
      "Minnesota added Jordan Mason as a useful backfield piece while moving down in 2025 draft value and sending a future sixth. The Vikings get the edge because Mason had clearer immediate roster value.",
    partnerSummary:
      "San Francisco gained draft flexibility, but Minnesota received the more useful near-term player value with Jordan Mason.",
  },

  "MIN-2025-0313": {
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "B-", "seattle-seahawks": "C" },
    confidence: "medium",
    summary:
      "Minnesota acquired Sam Howell and a 2025 fifth-round pick while sending Seattle a higher fifth-rounder. The Vikings gained quarterback depth and preserved useful draft value.",
    partnerSummary:
      "Seattle moved up in the fifth round, but Minnesota’s combination of Sam Howell and draft value gives the Vikings the stronger side.",
  },

  "MIN-2025-08-20-0322": {
    verdict: "New York Jets Win",
    grades: { "minnesota-vikings": "D", "new-york-jets": "A-" },
    confidence: "high",
    summary:
      "Minnesota moved Harrison Phillips and a future seventh for late-round draft return. Given Phillips’ proven defensive value, the Jets received the stronger side of the exchange.",
    partnerSummary:
      "New York acquired Harrison Phillips for a modest pick package, making this a clear partner win on immediate roster value.",
  },

  "MIN-2025-08-24-0323": {
    verdict: "Even Trade",
    grades: { "minnesota-vikings": "B", "philadelphia-eagles": "B" },
    confidence: "medium",
    summary:
      "Minnesota moved Sam Howell and a 2026 sixth for a 2026 fifth and a future seventh. The Vikings improved their draft position, while Philadelphia added quarterback depth, leaving the value close.",
    partnerSummary:
      "Philadelphia added Sam Howell while paying a modest pick premium. Minnesota gained draft flexibility, making the exchange close to even.",
  },

  "MIN-2025-0317": {
    verdict: "Indianapolis Colts Win",
    grades: { "minnesota-vikings": "D", "indianapolis-colts": "A" },
    confidence: "high",
    summary:
      "Minnesota moved Mekhi Blackmon for a 2026 sixth-round pick. Blackmon still carried young cornerback value, making the return too light for the Vikings.",
    partnerSummary:
      "Indianapolis acquired Mekhi Blackmon for a modest future pick, giving the Colts the stronger value side.",
  },

  "MIN-2025-08-27-0325": {
    verdict: "Carolina Panthers Win",
    grades: { "minnesota-vikings": "D", "carolina-panthers": "A-" },
    confidence: "high",
    summary:
      "Minnesota brought Adam Thielen back but paid meaningful future draft value to do it. The emotional fit made sense, but Carolina extracted the better asset return.",
    partnerSummary:
      "Carolina moved Adam Thielen and collected stronger draft value, making this a clear Panthers win.",
  },

  "MIN-2026-04-24-0326": {
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "B-", "carolina-panthers": "C" },
    confidence: "medium",
    summary:
      "Minnesota moved down two spots in the second round while adding fifth-round value. The Vikings gained the cleaner draft-capital side of the exchange.",
    partnerSummary:
      "Carolina moved up slightly but paid extra draft value to do it. Minnesota came away with the better capital balance.",
  },

  "MIN-2026-04-24-0327": {
    verdict: "Philadelphia Eagles Win",
    grades: { "minnesota-vikings": "C", "philadelphia-eagles": "B" },
    confidence: "medium",
    summary:
      "Minnesota moved Jonathan Greenard and a seventh-round pick for a third-rounder and a future third. The draft return was real, but Philadelphia received the proven impact player.",
    partnerSummary:
      "Philadelphia acquired Jonathan Greenard, the best immediate asset in the trade. Minnesota recovered draft capital, but the Eagles get the stronger roster-value side.",
  },
};

const BANNED_PATTERNS = [
  /Too early for a final verdict\.?/gi,
  /grade should stay TBD\s*until the assets develop\.?/gi,
  /grade should stay TBDuntil the assets develop\.?/gi,
  /TBD\s*until the assets develop\.?/gi,
  /until the assets develop\.?/gi,
  /this should remain a provisional verdict\.?/gi,
  /should remain a provisional verdict\.?/gi,
  /provisional verdict\.?/gi,
  /source data\.?/gi,
  /the final grade depends on[^.]+\.?/gi,
  /final grade depends on[^.]+\.?/gi,
  /until Turner’s impact is established\.?/gi,
  /because the longer-term player outcomes were still developing[^.]+\.?/gi,
];

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function sanitizeText(value) {
  let text = clean(value);

  for (const pattern of BANNED_PATTERNS) {
    text = text.replace(pattern, "");
  }

  return text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .replace(/\.{2,}/g, ".")
    .trim();
}

function rebuildAnalysis(trade) {
  return [trade.summary, trade.partnerSummary].map(clean).filter(Boolean).join(" ");
}

function applyPatch(trade, patch) {
  trade.verdict = patch.verdict;
  trade.grades = {
    ...(trade.grades || {}),
    ...patch.grades,
  };
  trade.confidence = patch.confidence || trade.confidence || "medium";
  trade.summary = patch.summary;
  trade.partnerSummary = patch.partnerSummary;
  trade.analysis = rebuildAnalysis(trade);
  trade.qaNotes = "";

  for (const perspective of trade.perspectives || []) {
    perspective.qaNotes = "";
    perspective.publishStatus = "ready";

    const primaryTeam = clean(perspective.primaryTeam);
    const partnerTeam = clean(perspective.partnerTeam);

    if (patch.grades[primaryTeam]) {
      perspective.primaryGrade = patch.grades[primaryTeam];
    }

    if (patch.grades[partnerTeam]) {
      perspective.partnerGrade = patch.grades[partnerTeam];
    }

    perspective.verdict = patch.verdict;

    if (primaryTeam === "minnesota-vikings") {
      perspective.primarySummary = patch.summary;
      perspective.partnerSummary = patch.partnerSummary;
    } else {
      perspective.primarySummary = patch.partnerSummary;
      perspective.partnerSummary = patch.summary;
    }
  }
}

const trades = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));

let patched = 0;
let sanitized = 0;

for (const trade of trades) {
  const patch = PATCHES[trade.id];

  if (patch) {
    applyPatch(trade, patch);
    patched++;
  }

  const before = JSON.stringify(trade);

  trade.summary = sanitizeText(trade.summary);
  trade.partnerSummary = sanitizeText(trade.partnerSummary);
  trade.analysis = sanitizeText(trade.analysis);
  trade.qaNotes = sanitizeText(trade.qaNotes);

  for (const perspective of trade.perspectives || []) {
    perspective.primarySummary = sanitizeText(perspective.primarySummary);
    perspective.partnerSummary = sanitizeText(perspective.partnerSummary);
    perspective.qaNotes = sanitizeText(perspective.qaNotes);
  }

  if (JSON.stringify(trade) !== before) sanitized++;
}

// Remove stray TBD grade entries from one known multi-team/non-Vikings cleanup artifact.
for (const trade of trades) {
  if (trade.id === "LAC-2025-0375") {
    if (trade.grades) {
      for (const [team, grade] of Object.entries({ ...trade.grades })) {
        if (String(grade).toUpperCase() === "TBD") {
          delete trade.grades[team];
        }
      }
    }
  }
}

fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));

console.log("Fixed recent Vikings cleanup issues.");
console.log(`Rows patched: ${patched}`);
console.log(`Rows sanitized: ${sanitized}`);
console.log(`Saved trades to ${TRADES_FILE}`);