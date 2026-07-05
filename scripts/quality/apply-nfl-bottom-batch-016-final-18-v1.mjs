import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "016";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-final-18-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-final-18-${apply ? "apply" : "dry-run"}-v1.json`;

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const teamNames = {
  "arizona-cardinals": "Arizona Cardinals",
  "atlanta-falcons": "Atlanta Falcons",
  "carolina-panthers": "Carolina Panthers",
  "chicago-bears": "Chicago Bears",
  "cleveland-browns": "Cleveland Browns",
  "dallas-cowboys": "Dallas Cowboys",
  "denver-broncos": "Denver Broncos",
  "detroit-lions": "Detroit Lions",
  "green-bay-packers": "Green Bay Packers",
  "jacksonville-jaguars": "Jacksonville Jaguars",
  "las-vegas-raiders": "Las Vegas Raiders",
  "los-angeles-chargers": "Los Angeles Chargers",
  "minnesota-vikings": "Minnesota Vikings",
  "new-england-patriots": "New England Patriots",
  "new-york-jets": "New York Jets",
  "pittsburgh-steelers": "Pittsburgh Steelers",
  "san-francisco-49ers": "San Francisco 49ers",
  "seattle-seahawks": "Seattle Seahawks",
  "tampa-bay-buccaneers": "Tampa Bay Buccaneers",
  "washington-commanders": "Washington Commanders"
};

const decisions = {
  "CHI-2004-0426": {
    lane: "grade_verdict_review",
    note: "Keep even; Quinn Dorsey for an undisclosed pick is too thin for a winner.",
    teams: ["chicago-bears", "new-england-patriots"],
    verdict: "Even Trade",
    grades: { "chicago-bears": "C", "new-england-patriots": "C" },
    assetsReceived: {
      "chicago-bears": [{ type: "player", asset: "Quinn Dorsey" }],
      "new-england-patriots": [{ type: "pick", asset: "undisclosed 2004 draft pick" }]
    }
  },
  "RAI-2004-0314": {
    lane: "grade_verdict_review",
    note: "Normalize Cardinals naming and keep Arizona edge for Troy Hambrick and Peppi Zellner.",
    teams: ["arizona-cardinals", "las-vegas-raiders"],
    verdict: "Arizona Cardinals Win",
    grades: { "arizona-cardinals": "B-", "las-vegas-raiders": "C" },
    assetsReceived: {
      "arizona-cardinals": [{ type: "player", asset: "Troy Hambrick and Peppi Zellner" }],
      "las-vegas-raiders": [{ type: "pick", asset: "undisclosed 2004 draft pick" }]
    }
  },
  "PIT-2004-0335": {
    lane: "grade_verdict_review",
    note: "Flip to Carolina; Todd Fordham gave the Panthers useful depth while the Steelers pick return was limited.",
    teams: ["carolina-panthers", "pittsburgh-steelers"],
    verdict: "Carolina Panthers Win",
    grades: { "carolina-panthers": "B-", "pittsburgh-steelers": "C" },
    assetsReceived: {
      "carolina-panthers": [{ type: "player", asset: "Todd Fordham" }],
      "pittsburgh-steelers": [{ type: "pick", asset: "undisclosed 2004 draft pick" }]
    }
  },
  "SEA-2005-03-07-0123": {
    lane: "grade_verdict_review",
    note: "Keep Seattle edge for converting Trent Dilfer into fourth-round value.",
    teams: ["seattle-seahawks", "cleveland-browns"],
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "C+", "cleveland-browns": "C" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "2005 4th round pick (126th overall subsequently traded, Todd Herremans)" }],
      "cleveland-browns": [{ type: "player", asset: "Trent Dilfer" }]
    }
  },
  "NYJ-2005-0189": {
    lane: "grade_verdict_review",
    note: "Move off even; the recorded pick path gives the Jets the stronger long-term asset.",
    teams: ["new-york-jets", "minnesota-vikings"],
    verdict: "New York Jets Win",
    grades: { "new-york-jets": "A-", "minnesota-vikings": "C" },
    assetsReceived: {
      "new-york-jets": [{ type: "pick", asset: "2005 7th round pick (230th overall subsequently traded, Matt Cassel)" }],
      "minnesota-vikings": [{ type: "player", asset: "Sam Cowart" }]
    }
  },
  "RAI-2005-0321": {
    lane: "grade_verdict_review",
    note: "Move to even; Fabian Washington versus Chris Spencer plus Ray Willis does not separate enough.",
    teams: ["las-vegas-raiders", "seattle-seahawks"],
    verdict: "Even Trade",
    grades: { "las-vegas-raiders": "C+", "seattle-seahawks": "C+" },
    assetsReceived: {
      "las-vegas-raiders": [{ type: "pick", asset: "2005 1st round pick (23rd overall, Fabian Washington)" }],
      "seattle-seahawks": [{ type: "pick", asset: "2005 1st round pick (26th overall, Chris Spencer) and 2005 4th round pick (105th overall, Ray Willis)" }]
    }
  },
  "JAX-2005-0028": {
    lane: "grade_verdict_review",
    note: "Move to even; Seth Marler for an undisclosed pick is too narrow for a Dallas win.",
    teams: ["jacksonville-jaguars", "dallas-cowboys"],
    verdict: "Even Trade",
    grades: { "jacksonville-jaguars": "C", "dallas-cowboys": "C" },
    assetsReceived: {
      "jacksonville-jaguars": [{ type: "pick", asset: "undisclosed 2005 draft pick" }],
      "dallas-cowboys": [{ type: "player", asset: "Seth Marler" }]
    }
  },
  "MIN-2005-09-03-0210": {
    lane: "grade_verdict_review",
    note: "Move to Minnesota; Melvin Fowler provided the cleaner practical return.",
    teams: ["minnesota-vikings", "cleveland-browns"],
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "B-", "cleveland-browns": "C" },
    assetsReceived: {
      "minnesota-vikings": [{ type: "player", asset: "Melvin Fowler" }],
      "cleveland-browns": [{ type: "player", asset: "Nat Dorsey" }]
    }
  },
  "MIN-2005-0204": {
    lane: "grade_verdict_review",
    note: "Normalize Chargers naming and keep Chargers edge on Tonio Fonoti.",
    teams: ["los-angeles-chargers", "minnesota-vikings"],
    verdict: "Los Angeles Chargers Win",
    grades: { "los-angeles-chargers": "B-", "minnesota-vikings": "C" },
    assetsReceived: {
      "los-angeles-chargers": [{ type: "pick", asset: "undisclosed 2006 draft pick" }],
      "minnesota-vikings": [{ type: "player", asset: "Tonio Fonoti" }]
    }
  },
  "MIN-2006-04-29-0213": {
    lane: "grade_verdict_review",
    note: "Move to Minnesota; Tarvaris Jackson gave the Vikings more useful value than Pittsburgh's two third-rounders.",
    teams: ["minnesota-vikings", "pittsburgh-steelers"],
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "B+", "pittsburgh-steelers": "C" },
    assetsReceived: {
      "minnesota-vikings": [{ type: "pick", asset: "2006 2nd round pick (64th overall, Tarvaris Jackson)" }],
      "pittsburgh-steelers": [{ type: "pick", asset: "2006 3rd round pick (83rd overall, Anthony Smith) and 2006 3rd round pick (95th overall, Willie Reid)" }]
    }
  },

  "DEN-2004-09-24-0278": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Denver gets a slight edge on Ellis Johnson.",
    teams: ["denver-broncos", "atlanta-falcons"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "atlanta-falcons": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Ellis Johnson" }],
      "atlanta-falcons": [{ type: "pick", asset: "undisclosed 2004 draft pick" }]
    }
  },
  "DEN-2005-03-03-0279": {
    lane: "structural_hold",
    note: "Flip to Denver; Gerard Warren produced more practical value than Cleveland's indirect pick return.",
    teams: ["denver-broncos", "cleveland-browns"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "cleveland-browns": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Gerard Warren" }],
      "cleveland-browns": [{ type: "pick", asset: "2005 4th round pick (126th overall subsequently traded, Todd Herremans)" }]
    }
  },
  "DEN-2005-03-18-0280": {
    lane: "structural_hold",
    note: "Collapse three perspectives; useful player-for-player exchange remains even.",
    teams: ["denver-broncos", "cleveland-browns"],
    verdict: "Even Trade",
    grades: { "denver-broncos": "C+", "cleveland-browns": "C+" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Ebenezer Ekuban and Michael Myers" }],
      "cleveland-browns": [{ type: "player", asset: "Reuben Droughns" }]
    }
  },
  "DEN-2005-04-20-0281": {
    lane: "structural_hold",
    note: "Collapse four perspectives and normalize Washington naming; Washington won the Jason Campbell slot.",
    teams: ["washington-commanders", "denver-broncos"],
    verdict: "Washington Commanders Win",
    grades: { "washington-commanders": "B+", "denver-broncos": "D+" },
    assetsReceived: {
      "washington-commanders": [{ type: "pick", asset: "2005 1st round pick (25th overall, Jason Campbell)" }],
      "denver-broncos": [{ type: "pick", asset: "undisclosed 2005 draft pick and 2005 3rd round pick (76th overall, Karl Paymah)" }]
    }
  },
  "DEN-2005-05-19-0282": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Carolina gets the edge on Jason Baker plus pick value.",
    teams: ["carolina-panthers", "denver-broncos"],
    verdict: "Carolina Panthers Win",
    grades: { "carolina-panthers": "B-", "denver-broncos": "C" },
    assetsReceived: {
      "carolina-panthers": [{ type: "player", asset: "Jason Baker and undisclosed 2005 draft pick" }],
      "denver-broncos": [{ type: "player", asset: "Todd Sauerbrun" }]
    }
  },
  "DEN-2005-07-15-0283": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Engelberger for Middlebrooks stays even.",
    teams: ["denver-broncos", "san-francisco-49ers"],
    verdict: "Even Trade",
    grades: { "denver-broncos": "C", "san-francisco-49ers": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "John Engelberger" }],
      "san-francisco-49ers": [{ type: "player", asset: "Willie Middlebrooks" }]
    }
  },
  "DEN-2006-04-19-0285": {
    lane: "structural_hold",
    note: "Collapse four perspectives; San Francisco keeps the Manny Lawson edge.",
    teams: ["san-francisco-49ers", "denver-broncos"],
    verdict: "San Francisco 49ers Win",
    grades: { "san-francisco-49ers": "B", "denver-broncos": "C-" },
    assetsReceived: {
      "san-francisco-49ers": [{ type: "pick", asset: "2006 1st round pick (22nd overall, Manny Lawson)" }],
      "denver-broncos": [{ type: "pick", asset: "2006 2nd round pick (37th overall subsequently traded, Jimmy Williams) and 2006 3rd round pick (68th overall subsequently traded, Claude Wroten)" }]
    }
  },
  "DEN-2006-04-29-0287": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Denver gets the Javon Walker edge.",
    teams: ["denver-broncos", "green-bay-packers"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B", "green-bay-packers": "C+" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Javon Walker" }],
      "green-bay-packers": [{ type: "pick", asset: "2006 2nd round pick (37th overall subsequently traded, Jimmy Williams)" }]
    }
  }
};

function name(team) {
  return teamNames[team] || String(team).split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/Partner-side/gi, "Other-side")
    .replace(/\bpartner side\b/gi, "other side")
    .replace(/\bpartner grade\b/gi, "other-side grade")
    .replace(/\bPartner Win\b/g, "Reviewed win")
    .replace(/\bPartner Even\b/g, "Even")
    .replace(/\bpartner outcome\b/gi, "other-side outcome")
    .replace(/\btrade partner\b/gi, "other team")
    .replace(/\bpartner\b/gi, "other team")
    .replace(/same strict-hindsight value curve/gi, "same final review")
    .replace(/same hindsight\/value standard/gi, "same final review")
    .replace(/same hindsight value curve/gi, "same final review")
    .replace(/same value curve/gi, "same final review")
    .replace(/hindsight\/value standard/gi, "final review")
    .replace(/hindsight value curve/gi, "final review")
    .replace(/hindsight curve/gi, "final review")
    .replace(/rebalanced curve/gi, "reviewed grade split")
    .replace(/receives the edge/gi, "wins the review")
    .replace(/received the edge/gi, "won the review")
    .replace(/Arizona\/St\. Louis Cardinals/g, "Arizona Cardinals")
    .replace(/Las Vegas\/Oakland Raiders/g, "Las Vegas Raiders")
    .replace(/Oakland\/Las Vegas Raiders/g, "Las Vegas Raiders")
    .replace(/Oakland Raiders/g, "Las Vegas Raiders")
    .replace(/Los Angeles\/San Diego Chargers/g, "Los Angeles Chargers")
    .replace(/Washington Redskins\/Commanders/g, "Washington Commanders")
    .replace(/Washington Redskins/g, "Washington Commanders")
    .replace(/Denver Broncos's/g, "Denver Broncos'")
    .replace(/Cleveland Browns's/g, "Cleveland Browns'")
    .replace(/New England Patriots's/g, "New England Patriots'")
    .replace(/Tampa Bay Buccaneers's/g, "Tampa Bay Buccaneers'")
    .replace(/Chicago Bears's/g, "Chicago Bears'")
    .replace(/Dallas Cowboys's/g, "Dallas Cowboys'")
    .replace(/Detroit Lions's/g, "Detroit Lions'")
    .replace(/Jacksonville Jaguars's/g, "Jacksonville Jaguars'")
    .replace(/Minnesota Vikings's/g, "Minnesota Vikings'")
    .replace(/Pittsburgh Steelers's/g, "Pittsburgh Steelers'")
    .replace(/Atlanta Falcons's/g, "Atlanta Falcons'")
    .replace(/Las Vegas Raiders's/g, "Las Vegas Raiders'")
    .replace(/Los Angeles Rams's/g, "Los Angeles Rams'")
    .replace(/Green Bay Packers's/g, "Green Bay Packers'")
    .replace(/San Francisco 49ers's/g, "San Francisco 49ers'")
    .replace(/Washington Commanders's/g, "Washington Commanders'")
    .replace(/Bears's/g, "Bears'")
    .replace(/Jets's/g, "Jets'")
    .replace(/Falcons's/g, "Falcons'")
    .replace(/Vikings's/g, "Vikings'")
    .replace(/Cardinals's/g, "Cardinals'")
    .replace(/Patriots's/g, "Patriots'")
    .replace(/Raiders's/g, "Raiders'")
    .replace(/Titans's/g, "Titans'")
    .replace(/Eagles's/g, "Eagles'")
    .replace(/Seahawks's/g, "Seahawks'")
    .replace(/Chiefs's/g, "Chiefs'")
    .replace(/Dolphins's/g, "Dolphins'")
    .replace(/Rams's/g, "Rams'")
    .replace(/Colts's/g, "Colts'")
    .replace(/Broncos's/g, "Broncos'")
    .replace(/Ravens's/g, "Ravens'")
    .replace(/49ers's/g, "49ers'")
    .replace(/Browns's/g, "Browns'")
    .trim();
}

function assetText(d, team) {
  const items = d.assetsReceived?.[team] || [];
  return clean(items.map(x => x.asset).filter(Boolean).join("; ")) || "the recorded return";
}

function winnerTeam(d) {
  if (/even trade/i.test(d.verdict)) return null;
  return d.teams.find(t => d.verdict.toLowerCase().includes(name(t).toLowerCase()));
}

function topCopy(d) {
  const [a, b] = d.teams;
  const an = name(a), bn = name(b);
  const ag = d.grades[a], bg = d.grades[b];
  const aa = assetText(d, a), ba = assetText(d, b);
  const winner = winnerTeam(d);

  if (!winner) {
    return {
      summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 016 review keeps this as an even trade because neither return separates enough for a win/loss label.`),
      partnerSummary: clean(`The grade profile is ${an} ${ag}, ${bn} ${bg}. The visible verdict is Even Trade.`),
      analysis: clean(`The final TradeVerdicts outcome is Even Trade after comparing player impact, pick value, roster usefulness, and retained value from the exchange.`)
    };
  }

  const wn = name(winner);
  return {
    summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 016 review favors ${wn} because that return produced stronger practical football value.`),
    partnerSummary: clean(`The grade profile is ${an} ${ag}, ${bn} ${bg}. The visible verdict is ${d.verdict}.`),
    analysis: clean(`${wn} earns the stronger review after comparing actual player outcomes, draft-slot cost, roster usefulness, and retained value from the exchange. The final TradeVerdicts outcome is ${d.verdict}.`)
  };
}

function makePerspectives(oldTrade, d) {
  return d.teams.map(primary => {
    const other = d.teams.find(t => t !== primary);
    const old = Array.isArray(oldTrade.perspectives)
      ? oldTrade.perspectives.find(p => p.primaryTeam === primary && p.partnerTeam === other) || {}
      : {};

    return {
      ...old,
      primaryTeam: primary,
      partnerTeam: other,
      primaryGrade: d.grades[primary],
      partnerGrade: d.grades[other],
      verdict: d.verdict,
      publishStatus: "ready",
      primarySummary: clean(`${name(primary)} received ${assetText(d, primary)}. This side grades ${d.grades[primary]}, and the visible verdict is ${d.verdict}.`),
      partnerSummary: clean(`${name(other)} received ${assetText(d, other)}. That return grades ${d.grades[other]}, and the visible verdict is ${d.verdict}.`)
    };
  });
}

function publicBlob(t) {
  return [
    t.summary,
    t.partnerSummary,
    t.analysis,
    ...(t.perspectives || []).flatMap(p => [p.primarySummary, p.partnerSummary])
  ].join("\n");
}

const badPublic = /Partner-side|\bpartner side\b|\bpartner grade\b|\bPartner Win\b|\bPartner Even\b|\bpartner outcome\b|\btrade partner\b|\bpartner\b|same strict-hindsight value curve|same hindsight\/value standard|same hindsight value curve|same value curve|hindsight value curve|hindsight curve|rebalanced curve|receives the edge|received the edge|Unknown\/undisclosed partner|Bears's|Jets's|Falcons's|Vikings's|Cardinals's|Patriots's|Raiders's|Titans's|Eagles's|Seahawks's|Chiefs's|Dolphins's|Rams's|Colts's|Broncos's|Ravens's|49ers's|Browns's/i;

const results = [];
let blocked = 0;
let changed = 0;
const visibleFlips = [];
const structuralCollapses = [];

for (const [id, d] of Object.entries(decisions)) {
  const t = trades.find(x => x.id === id);
  if (!t) {
    blocked++;
    results.push({ id, status: "blocked", reason: "missing trade" });
    continue;
  }

  const beforeVerdict = t.verdict;
  const beforeGrades = JSON.stringify(t.grades || {});
  const beforePerspectiveCount = Array.isArray(t.perspectives) ? t.perspectives.length : 0;
  const copy = topCopy(d);

  const next = {
    ...t,
    teams: d.teams,
    sourceTeams: d.teams,
    verdict: d.verdict,
    grades: d.grades,
    assetsReceived: d.assetsReceived,
    summary: copy.summary,
    partnerSummary: copy.partnerSummary,
    analysis: copy.analysis,
    perspectives: makePerspectives(t, d)
  };

  const blob = publicBlob(next);
  if (badPublic.test(blob)) {
    blocked++;
    results.push({ id, status: "blocked", reason: "bad public-language artifact remains" });
    continue;
  }

  const before = JSON.stringify(t);
  const after = JSON.stringify(next);

  if (before !== after) {
    changed++;
    if (beforeVerdict !== d.verdict || beforeGrades !== JSON.stringify(d.grades)) {
      visibleFlips.push(`${id}: ${beforeVerdict} ${beforeGrades} -> ${d.verdict} ${JSON.stringify(d.grades)}`);
    }
    if (beforePerspectiveCount !== next.perspectives.length) {
      structuralCollapses.push(`${id}: ${beforePerspectiveCount} perspectives -> ${next.perspectives.length} perspectives`);
    }
    if (apply) Object.assign(t, next);
    results.push({ id, status: apply ? "applied" : "would_apply", lane: d.lane, note: d.note });
  } else {
    results.push({ id, status: "no_change", lane: d.lane, note: d.note });
  }
}

let backup = "";
if (apply && changed) {
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-final-18-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Final 18 ${apply ? "Apply" : "Dry Run"} v1\n\n`;
txt += `Generated: ${new Date().toISOString()}\n`;
txt += `Mode: ${apply ? "apply" : "dry-run"}\n\n`;
txt += `## Summary\n`;
txt += `- Targeted records: ${Object.keys(decisions).length}\n`;
txt += `- Blocked records: ${blocked}\n`;
txt += `- Changed records: ${changed}\n`;
if (backup) txt += `- Backup created: ${backup}\n`;

txt += `\n## Status Counts\n`;
for (const [k, v] of Object.entries(counts)) txt += `- ${k}: ${v}\n`;

txt += `\n## Visible Top-Level Grade/Verdict Changes\n`;
if (visibleFlips.length) for (const f of visibleFlips) txt += `- ${f}\n`;
else txt += `- None\n`;

txt += `\n## Structural Perspective Collapses\n`;
if (structuralCollapses.length) for (const f of structuralCollapses) txt += `- ${f}\n`;
else txt += `- None\n`;

txt += `\n## Records\n`;
for (const r of results) {
  txt += `- ${r.id}: ${r.status}${r.lane ? ` (${r.lane})` : ""}${r.note ? ` — ${r.note}` : ""}${r.reason ? ` — ${r.reason}` : ""}\n`;
}

fs.writeFileSync(outJson, JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: apply ? "apply" : "dry-run",
  blocked,
  changed,
  counts,
  visibleFlips,
  structuralCollapses,
  results
}, null, 2) + "\n");
fs.writeFileSync(outTxt, txt);

console.log(txt);
console.log(`Wrote: ${outTxt}`);
