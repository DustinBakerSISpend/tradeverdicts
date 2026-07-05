import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "017";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-final-15-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-final-15-${apply ? "apply" : "dry-run"}-v1.json`;

const originalText = fs.readFileSync(dataPath, "utf8");
const data = JSON.parse(originalText);
const trades = Array.isArray(data) ? data : (data.trades || []);

const teamNames = {
  "arizona-cardinals": "Arizona Cardinals",
  "carolina-panthers": "Carolina Panthers",
  "chicago-bears": "Chicago Bears",
  "cincinnati-bengals": "Cincinnati Bengals",
  "denver-broncos": "Denver Broncos",
  "detroit-lions": "Detroit Lions",
  "green-bay-packers": "Green Bay Packers",
  "jacksonville-jaguars": "Jacksonville Jaguars",
  "new-england-patriots": "New England Patriots",
  "philadelphia-eagles": "Philadelphia Eagles",
  "pittsburgh-steelers": "Pittsburgh Steelers",
  "san-francisco-49ers": "San Francisco 49ers",
  "seattle-seahawks": "Seattle Seahawks",
  "washington-commanders": "Washington Commanders"
};

const quarantine = {
  "PHI-2004-0296": {
    reason: "unknown-team / unknown partner placeholder with no reliable counterparty or assets"
  }
};

const decisions = {
  "DEN-2003-04-26-0271": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Carolina keeps the Ricky Manning edge.",
    teams: ["carolina-panthers", "denver-broncos"],
    verdict: "Carolina Panthers Win",
    grades: { "carolina-panthers": "B", "denver-broncos": "B-" },
    assetsReceived: {
      "carolina-panthers": [{ type: "pick", asset: "2003 3rd round pick (82nd overall, Ricky Manning)" }],
      "denver-broncos": [{ type: "pick", asset: "2003 4th round pick (108th overall, Quentin Griffin), 2003 4th round pick (120th overall subsequently traded, Asante Samuel) and 2003 7th round pick (227th overall, Clint Mitchell)" }]
    }
  },
  "DEN-2003-04-27-0272": {
    lane: "structural_hold",
    note: "Collapse three perspectives; New England clearly won by landing Asante Samuel.",
    teams: ["new-england-patriots", "denver-broncos"],
    verdict: "New England Patriots Win",
    grades: { "new-england-patriots": "A", "denver-broncos": "C" },
    assetsReceived: {
      "new-england-patriots": [{ type: "pick", asset: "2003 4th round pick (120th overall, Asante Samuel)" }],
      "denver-broncos": [{ type: "pick", asset: "2003 4th round pick (128th overall, Bryant McNeal) and 2003 5th round pick (157th overall, Ben Claxton)" }]
    }
  },
  "DET-2003-0308": {
    lane: "grade_verdict_review",
    note: "Normalize Arizona naming and keep slight Detroit edge.",
    teams: ["detroit-lions", "arizona-cardinals"],
    verdict: "Detroit Lions Win",
    grades: { "detroit-lions": "B-", "arizona-cardinals": "C+" },
    assetsReceived: {
      "detroit-lions": [{ type: "pick", asset: "2003 7th round pick (220th overall, Blue Adams)" }],
      "arizona-cardinals": [{ type: "player", asset: "Larry Foster" }]
    }
  },
  "PHI-2003-0292": {
    lane: "structural_hold",
    note: "Remove separate 2004 pick contamination; keep the 2003 Eagles/Packers swap.",
    teams: ["philadelphia-eagles", "green-bay-packers"],
    verdict: "Philadelphia Eagles Win",
    grades: { "philadelphia-eagles": "B-", "green-bay-packers": "C+" },
    assetsReceived: {
      "philadelphia-eagles": [{ type: "pick", asset: "2003 6th round pick (185th overall, Jeremy Bridges) and 2003 7th round pick (244th overall, Norman LeJeune)" }],
      "green-bay-packers": [{ type: "pick", asset: "2003 5th round pick (166th overall, Hunter Hillenmeyer)" }]
    }
  },
  "SEA-2003-04-27-0119": {
    lane: "grade_verdict_review",
    note: "Keep Seattle edge for receiving two picks while moving down.",
    teams: ["seattle-seahawks", "green-bay-packers"],
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "B+", "green-bay-packers": "C+" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "2003 5th round pick (165th overall, Chris Davis) and 2003 6th round pick (203rd overall subsequently traded, Kareem Kelly)" }],
      "green-bay-packers": [{ type: "pick", asset: "2003 5th round pick (147th overall, James Lee)" }]
    }
  },
  "DEN-2003-08-13-0273": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Denver gets the Nate Jackson edge because the conditional pick was not conveyed.",
    teams: ["denver-broncos", "san-francisco-49ers"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "san-francisco-49ers": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Nate Jackson" }],
      "san-francisco-49ers": [{ type: "pick", asset: "conditional 2004 pick not conveyed" }]
    }
  },
  "SEA-2003-08-23-0121": {
    lane: "grade_verdict_review",
    note: "Keep Seattle edge on Mat McBriar with the conditional pick not conveyed.",
    teams: ["seattle-seahawks", "denver-broncos"],
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "B", "denver-broncos": "C" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "player", asset: "Mat McBriar" }],
      "denver-broncos": [{ type: "pick", asset: "conditional 2004 pick not conveyed" }]
    }
  },
  "CHI-2003-0423": {
    lane: "grade_verdict_review",
    note: "Keep as even; Jamil Soriano for an undisclosed pick is too thin for a winner.",
    teams: ["chicago-bears", "new-england-patriots"],
    verdict: "Even Trade",
    grades: { "chicago-bears": "C", "new-england-patriots": "C" },
    assetsReceived: {
      "chicago-bears": [{ type: "pick", asset: "undisclosed 2004 draft pick" }],
      "new-england-patriots": [{ type: "player", asset: "Jamil Soriano" }]
    }
  },
  "DEN-2003-08-26-0275": {
    lane: "structural_hold",
    note: "Collapse four perspectives and normalize Washington naming.",
    teams: ["washington-commanders", "denver-broncos"],
    verdict: "Washington Commanders Win",
    grades: { "washington-commanders": "C+", "denver-broncos": "C" },
    assetsReceived: {
      "washington-commanders": [{ type: "player", asset: "Lionel Dalton" }],
      "denver-broncos": [{ type: "pick", asset: "undisclosed 2004 draft pick" }]
    }
  },
  "PIT-2003-0333": {
    lane: "grade_verdict_review",
    note: "Keep slight Pittsburgh edge on Freddie Milons.",
    teams: ["pittsburgh-steelers", "philadelphia-eagles"],
    verdict: "Pittsburgh Steelers Win",
    grades: { "pittsburgh-steelers": "C+", "philadelphia-eagles": "C" },
    assetsReceived: {
      "pittsburgh-steelers": [{ type: "player", asset: "Freddie Milons" }],
      "philadelphia-eagles": [{ type: "pick", asset: "undisclosed 2004 draft pick" }]
    }
  },
  "DEN-2004-03-04-0276": {
    lane: "structural_hold",
    note: "Collapse three perspectives; preserve the Champ Bailey major-trade read.",
    teams: ["denver-broncos", "washington-commanders"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "A+", "washington-commanders": "B" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Champ Bailey and 2004 2nd round pick (41st overall, Tatum Bell)" }],
      "washington-commanders": [{ type: "player", asset: "Clinton Portis" }]
    },
    customCopy: {
      summary: "Denver received Champ Bailey and the 2004 2nd round pick that became Tatum Bell. Washington received Clinton Portis. The final Batch 017 review favors Denver because Bailey became a Hall of Fame cornerback, the Broncos also received premium draft capital, and Portis' strong Washington production still did not match the long-term positional value Denver secured.",
      partnerSummary: "The grade profile is Denver Broncos A+, Washington Commanders B. The visible verdict is Denver Broncos Win.",
      analysis: "Denver earns the stronger review because the Broncos turned Clinton Portis into a Hall of Fame cornerback plus an extra second-round pick. Washington still received a productive feature back, so this is not graded as a one-sided disaster, but Denver controlled the harder-to-find asset and the better long-term value."
    }
  },
  "DEN-2004-04-09-0277": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Cincinnati gets the package-value edge.",
    teams: ["cincinnati-bengals", "denver-broncos"],
    verdict: "Cincinnati Bengals Win",
    grades: { "cincinnati-bengals": "B+", "denver-broncos": "C+" },
    assetsReceived: {
      "cincinnati-bengals": [{ type: "player", asset: "Deltha O'Neal, 2004 1st round pick (24th overall subsequently traded, Steven Jackson) and 2004 4th round pick (117th overall, Robert Geathers)" }],
      "denver-broncos": [{ type: "pick", asset: "2004 1st round pick (17th overall, D.J. Williams)" }]
    }
  },
  "JAX-2004-0023": {
    lane: "structural_hold",
    note: "Remove separate Jaguars/Packers contamination; use the 87-for-70-and-102 record.",
    teams: ["green-bay-packers", "jacksonville-jaguars"],
    verdict: "Green Bay Packers Win",
    grades: { "green-bay-packers": "A-", "jacksonville-jaguars": "C" },
    assetsReceived: {
      "green-bay-packers": [{ type: "pick", asset: "2004 3rd round pick (70th overall, Joey Thomas) and 2004 4th round pick (102nd overall subsequently traded, Will Poole)" }],
      "jacksonville-jaguars": [{ type: "pick", asset: "2004 3rd round pick (87th overall subsequently traded, B.J. Sander)" }]
    }
  },
  "PHI-2004-0298": {
    lane: "structural_hold",
    note: "Resolve unknown partner to 49ers and clean the Shawn Andrews trade-up.",
    teams: ["philadelphia-eagles", "san-francisco-49ers"],
    verdict: "Philadelphia Eagles Win",
    grades: { "philadelphia-eagles": "A-", "san-francisco-49ers": "C-" },
    assetsReceived: {
      "philadelphia-eagles": [{ type: "pick", asset: "2004 1st round pick (16th overall, Shawn Andrews)" }],
      "san-francisco-49ers": [{ type: "pick", asset: "2004 1st round pick (28th overall subsequently traded, Chris Gamble) and 2004 2nd round pick (58th overall, Shawntae Spencer)" }]
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
    .replace(/rebalanced curve/gi, "reviewed grade split")
    .replace(/receives the edge/gi, "wins the review")
    .replace(/received the edge/gi, "won the review")
    .replace(/Arizona\/St\. Louis Cardinals/g, "Arizona Cardinals")
    .replace(/Washington Redskins\/Commanders/g, "Washington Commanders")
    .replace(/Washington Redskins/g, "Washington Commanders")
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
  if (d.customCopy) {
    return {
      summary: clean(d.customCopy.summary),
      partnerSummary: clean(d.customCopy.partnerSummary),
      analysis: clean(d.customCopy.analysis)
    };
  }

  const [a, b] = d.teams;
  const an = name(a), bn = name(b);
  const ag = d.grades[a], bg = d.grades[b];
  const aa = assetText(d, a), ba = assetText(d, b);
  const winner = winnerTeam(d);

  if (!winner) {
    return {
      summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 017 review keeps this as an even trade because neither return separates enough for a win/loss label.`),
      partnerSummary: clean(`The grade profile is ${an} ${ag}, ${bn} ${bg}. The visible verdict is Even Trade.`),
      analysis: clean(`The final TradeVerdicts outcome is Even Trade after comparing player impact, pick value, roster usefulness, and retained value from the exchange.`)
    };
  }

  const wn = name(winner);
  return {
    summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 017 review favors ${wn} because that return produced stronger practical football value.`),
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

const badPublic = /Partner-side|\bpartner side\b|\bpartner grade\b|\bPartner Win\b|\bPartner Even\b|\bpartner outcome\b|\btrade partner\b|\bpartner\b|same strict-hindsight value curve|same hindsight\/value standard|same hindsight value curve|same football-value curve|same value curve|hindsight value curve|hindsight curve|rebalanced curve|receives the edge|received the edge|Unknown\/undisclosed partner|Not clearly specified in source|Bears's|Jets's|Falcons's|Vikings's|Cardinals's|Patriots's|Raiders's|Titans's|Eagles's|Seahawks's|Chiefs's|Dolphins's|Rams's|Colts's|Broncos's|Ravens's|49ers's|Browns's|Bengals's/i;

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
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-final-15-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, originalText);
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Final 15 ${apply ? "Apply" : "Dry Run"} v1\n\n`;
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
