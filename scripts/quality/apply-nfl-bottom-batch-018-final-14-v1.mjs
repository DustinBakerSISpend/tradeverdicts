import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "018";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-final-14-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-final-14-${apply ? "apply" : "dry-run"}-v1.json`;

const originalText = fs.readFileSync(dataPath, "utf8");
const data = JSON.parse(originalText);
const trades = Array.isArray(data) ? data : (data.trades || []);

const teamNames = {
  "atlanta-falcons": "Atlanta Falcons",
  "baltimore-ravens": "Baltimore Ravens",
  "buffalo-bills": "Buffalo Bills",
  "carolina-panthers": "Carolina Panthers",
  "chicago-bears": "Chicago Bears",
  "cleveland-browns": "Cleveland Browns",
  "denver-broncos": "Denver Broncos",
  "green-bay-packers": "Green Bay Packers",
  "indianapolis-colts": "Indianapolis Colts",
  "las-vegas-raiders": "Las Vegas Raiders",
  "minnesota-vikings": "Minnesota Vikings",
  "new-england-patriots": "New England Patriots",
  "seattle-seahawks": "Seattle Seahawks",
  "tennessee-titans": "Tennessee Titans"
};

const quarantine = {
  "PHI-2000-0286": {
    reason: "unknown-team / unknown partner placeholder with incomplete Chargers trade text and no reliable incoming Philadelphia asset"
  }
};

const decisions = {
  "CLE-2000-0319": {
    lane: "grade_verdict_review",
    note: "Keep Chicago edge on the three-for-two seventh-round pick shuffle.",
    teams: ["chicago-bears", "cleveland-browns"],
    verdict: "Chicago Bears Win",
    grades: { "chicago-bears": "B+", "cleveland-browns": "C-" },
    assetsReceived: {
      "chicago-bears": [{ type: "pick", asset: "2000 7th round pick (223rd overall, James Cotton), 2000 7th round pick (232nd overall subsequently traded, Jeff Harris) and 2000 7th round pick (254th overall, Michael Green)" }],
      "cleveland-browns": [{ type: "pick", asset: "2000 7th round pick (209th overall, Eric Chandler) and 2000 7th round pick (225th overall, Rashidi Barnes)" }]
    }
  },
  "SEA-2000-04-16-0112": {
    lane: "structural_hold",
    note: "Remove Colts/49ers/Patriots contamination; keep the Seattle-Raiders late-pick exchange.",
    teams: ["seattle-seahawks", "las-vegas-raiders"],
    verdict: "Even Trade",
    grades: { "seattle-seahawks": "C", "las-vegas-raiders": "C" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "2001 6th round pick (191st overall subsequently traded, Menson Holloway)" }],
      "las-vegas-raiders": [{ type: "pick", asset: "2000 7th round pick (231st overall, Clifton Black)" }]
    }
  },
  "DEN-2000-08-15-0265": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Denver won by turning Nate Wayne into Ben Hamilton.",
    teams: ["denver-broncos", "green-bay-packers"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B+", "green-bay-packers": "C+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2001 4th round pick (113th overall, Ben Hamilton)" }],
      "green-bay-packers": [{ type: "player", asset: "Nate Wayne" }]
    }
  },
  "DEN-2001-04-21-0266": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Buffalo clearly won after Denver moved up for Paul Toviessi.",
    teams: ["buffalo-bills", "denver-broncos"],
    verdict: "Buffalo Bills Win",
    grades: { "buffalo-bills": "A", "denver-broncos": "F" },
    assetsReceived: {
      "buffalo-bills": [{ type: "pick", asset: "2001 2nd round pick (58th overall, Travis Henry) and 2001 4th round pick (110th overall, Brandon Spoon)" }],
      "denver-broncos": [{ type: "pick", asset: "2001 2nd round pick (51st overall, Paul Toviessi)" }]
    }
  },
  "DEN-2001-04-22-0267": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Denver gets the edge for a future fourth over three sevenths.",
    teams: ["denver-broncos", "atlanta-falcons"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "atlanta-falcons": "C-" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2002 4th round pick (112th overall subsequently traded, Dave Zastudil)" }],
      "atlanta-falcons": [{ type: "pick", asset: "2001 7th round pick (215th overall, Corey Hall), 2001 7th round pick (219th overall, Kynan Forney) and 2001 7th round pick (226th overall, Ronald Flemons)" }]
    }
  },
  "DEN-2001-08-02-0268": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Henri Crockett for a seventh stays even.",
    teams: ["denver-broncos", "atlanta-falcons"],
    verdict: "Even Trade",
    grades: { "denver-broncos": "C", "atlanta-falcons": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2002 7th round pick (228th overall, Chris Young)" }],
      "atlanta-falcons": [{ type: "player", asset: "Henri Crockett" }]
    }
  },
  "CAR-2001-0019": {
    lane: "grade_verdict_review",
    note: "Move off even; Carolina got the only exercised football value.",
    teams: ["carolina-panthers", "tennessee-titans"],
    verdict: "Carolina Panthers Win",
    grades: { "carolina-panthers": "B", "tennessee-titans": "C" },
    assetsReceived: {
      "carolina-panthers": [{ type: "player", asset: "Perry Phenix" }],
      "tennessee-titans": [{ type: "pick", asset: "2002 7th round pick not exercised" }]
    }
  },
  "GB-2001-0353": {
    lane: "grade_verdict_review",
    note: "Normalize Titans naming and keep Tennessee edge for Carlos Hall pick value.",
    teams: ["tennessee-titans", "green-bay-packers"],
    verdict: "Tennessee Titans Win",
    grades: { "tennessee-titans": "B-", "green-bay-packers": "D+" },
    assetsReceived: {
      "tennessee-titans": [{ type: "pick", asset: "2002 7th round pick (240th overall, Carlos Hall)" }],
      "green-bay-packers": [{ type: "player", asset: "Rod Walker" }]
    }
  },
  "MIN-2001-09-02-0200": {
    lane: "grade_verdict_review",
    note: "Move off even; Cleveland preserved the cleaner pick value.",
    teams: ["cleveland-browns", "minnesota-vikings"],
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "B-", "minnesota-vikings": "C" },
    assetsReceived: {
      "cleveland-browns": [{ type: "pick", asset: "2002 5th round pick" }],
      "minnesota-vikings": [{ type: "package", asset: "Spergon Wynn, Travis Prentice and 2002 7th round pick (218th overall, Chad Beasley)" }]
    }
  },
  "MIN-2001-10-16-0201": {
    lane: "grade_verdict_review",
    note: "Move off even; Cleveland got the stronger pick path with Ryan Pontbriand.",
    teams: ["cleveland-browns", "minnesota-vikings"],
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "B-", "minnesota-vikings": "C" },
    assetsReceived: {
      "cleveland-browns": [{ type: "pick", asset: "2003 5th round pick (142nd overall, Ryan Pontbriand)" }],
      "minnesota-vikings": [{ type: "package", asset: "Stalin Colinet and 2002 7th round pick" }]
    }
  },
  "IND-2002-0306": {
    lane: "grade_verdict_review",
    note: "Keep Seattle edge for Rocky Bernard pick value over Brock Huard.",
    teams: ["seattle-seahawks", "indianapolis-colts"],
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "B-", "indianapolis-colts": "C" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "2002 5th round pick (146th overall, Rocky Bernard)" }],
      "indianapolis-colts": [{ type: "player", asset: "Brock Huard" }]
    }
  },
  "DEN-2002-04-20-0269": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Baltimore keeps the pick-package edge.",
    teams: ["baltimore-ravens", "denver-broncos"],
    verdict: "Baltimore Ravens Win",
    grades: { "baltimore-ravens": "B", "denver-broncos": "C-" },
    assetsReceived: {
      "baltimore-ravens": [{ type: "pick", asset: "2002 4th round pick (112th overall, Dave Zastudil) and 2002 5th round pick (155th overall, Terry Jones)" }],
      "denver-broncos": [{ type: "pick", asset: "2002 3rd round pick (96th overall, Dorsett Davis)" }]
    }
  },
  "DEN-2002-04-21-0270": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Denver/New England pick shuffle stays even.",
    teams: ["denver-broncos", "new-england-patriots"],
    verdict: "Even Trade",
    grades: { "denver-broncos": "C", "new-england-patriots": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2002 4th round pick (131st overall, Sam Brandon) and 2002 5th round pick (144th overall, Herb Haygood)" }],
      "new-england-patriots": [{ type: "pick", asset: "2002 4th round pick (117th overall, Rohan Davey)" }]
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
    .replace(/same football-value curve/gi, "same final review")
    .replace(/same value curve/gi, "same final review")
    .replace(/hindsight\/value standard/gi, "final review")
    .replace(/hindsight value curve/gi, "final review")
    .replace(/hindsight curve/gi, "final review")
    .replace(/Strict hindsight/gi, "Final review")
    .replace(/strict hindsight/gi, "final review")
    .replace(/rebalanced curve/gi, "reviewed grade split")
    .replace(/receives the edge/gi, "wins the review")
    .replace(/received the edge/gi, "won the review")
    .replace(/Houston Oilers\/Tennessee Titans/g, "Tennessee Titans")
    .replace(/Las Vegas\/Oakland Raiders/g, "Las Vegas Raiders")
    .replace(/Oakland Raiders/g, "Las Vegas Raiders")
    .replace(/Indianapolis Colts \/ Baltimore Colts/g, "Indianapolis Colts")
    .replace(/Unknown\/undisclosed partner/gi, "unknown team")
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
    .replace(/Cincinnati Bengals's/g, "Cincinnati Bengals'")
    .replace(/Philadelphia Eagles's/g, "Philadelphia Eagles'")
    .replace(/Indianapolis Colts's/g, "Indianapolis Colts'")
    .replace(/Tennessee Titans's/g, "Tennessee Titans'")
    .replace(/Buffalo Bills's/g, "Buffalo Bills'")
    .replace(/Baltimore Ravens's/g, "Baltimore Ravens'")
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
    .replace(/Bengals's/g, "Bengals'")
    .replace(/Bills's/g, "Bills'")
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
      summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 018 review keeps this as an even trade because neither return separates enough for a win/loss label.`),
      partnerSummary: clean(`The grade profile is ${an} ${ag}, ${bn} ${bg}. The visible verdict is Even Trade.`),
      analysis: clean(`The final TradeVerdicts outcome is Even Trade after comparing player impact, pick value, roster usefulness, and retained value from the exchange.`)
    };
  }

  const wn = name(winner);
  return {
    summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 018 review favors ${wn} because that return produced stronger practical football value.`),
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

const badPublic = /Partner-side|\bpartner side\b|\bpartner grade\b|\bPartner Win\b|\bPartner Even\b|\bpartner outcome\b|\btrade partner\b|\bpartner\b|same strict-hindsight value curve|same hindsight\/value standard|same hindsight value curve|same football-value curve|same value curve|hindsight value curve|hindsight curve|Strict hindsight|strict hindsight|rebalanced curve|receives the edge|received the edge|Unknown\/undisclosed partner|Not clearly specified in source|Bears's|Jets's|Falcons's|Vikings's|Cardinals's|Patriots's|Raiders's|Titans's|Eagles's|Seahawks's|Chiefs's|Dolphins's|Rams's|Colts's|Broncos's|Ravens's|49ers's|Browns's|Bengals's|Bills's/i;

const results = [];
let blocked = 0;
let changed = 0;
let quarantined = 0;
const visibleFlips = [];
const structuralCollapses = [];

for (const [id, q] of Object.entries(quarantine)) {
  const idx = trades.findIndex(x => x.id === id);
  if (idx === -1) {
    results.push({ id, status: "already_quarantined_or_missing", reason: q.reason });
    continue;
  }

  quarantined++;
  changed++;
  if (apply) trades.splice(idx, 1);
  results.push({ id, status: apply ? "quarantined" : "would_quarantine", reason: q.reason });
}

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
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-final-14-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, originalText);
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Final 14 ${apply ? "Apply" : "Dry Run"} v1\n\n`;
txt += `Generated: ${new Date().toISOString()}\n`;
txt += `Mode: ${apply ? "apply" : "dry-run"}\n\n`;
txt += `## Summary\n`;
txt += `- Patch records targeted: ${Object.keys(decisions).length}\n`;
txt += `- Quarantine records targeted: ${Object.keys(quarantine).length}\n`;
txt += `- Blocked records: ${blocked}\n`;
txt += `- Changed records: ${changed}\n`;
txt += `- Quarantined records: ${quarantined}\n`;
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
  quarantined,
  counts,
  visibleFlips,
  structuralCollapses,
  results
}, null, 2) + "\n");
fs.writeFileSync(outTxt, txt);

console.log(txt);
console.log(`Wrote: ${outTxt}`);
