import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "012";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-final-14-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-final-14-${apply ? "apply" : "dry-run"}-v1.json`;

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const teamNames = {
  "chicago-bears": "Chicago Bears",
  "cleveland-browns": "Cleveland Browns",
  "denver-broncos": "Denver Broncos",
  "green-bay-packers": "Green Bay Packers",
  "jacksonville-jaguars": "Jacksonville Jaguars",
  "los-angeles-rams": "Los Angeles Rams",
  "minnesota-vikings": "Minnesota Vikings",
  "new-england-patriots": "New England Patriots",
  "new-york-jets": "New York Jets",
  "philadelphia-eagles": "Philadelphia Eagles",
  "san-francisco-49ers": "San Francisco 49ers",
  "tampa-bay-buccaneers": "Tampa Bay Buccaneers",
  "washington-commanders": "Washington Commanders"
};

const decisions = {
  "JAX-2010-0050": {
    lane: "grade_verdict_review",
    note: "Green Bay received Anthony Smith while Jacksonville's conditional pick did not convey.",
    teams: ["green-bay-packers", "jacksonville-jaguars"],
    verdict: "Green Bay Packers Win",
    grades: { "green-bay-packers": "B", "jacksonville-jaguars": "D+" },
    assetsReceived: {
      "green-bay-packers": [{ type: "player", asset: "Anthony Smith" }],
      "jacksonville-jaguars": [{ type: "pick", asset: "conditional 2011 pick (not conveyed)" }]
    }
  },
  "MIN-2011-04-30-0235": {
    lane: "grade_verdict_review",
    note: "Cleveland gets the slight edge after comparing Jason Pinkston against Minnesota's two sixth-rounders.",
    teams: ["cleveland-browns", "minnesota-vikings"],
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "B-", "minnesota-vikings": "C" },
    assetsReceived: {
      "cleveland-browns": [{ type: "pick", asset: "2011 5th round pick (150th overall, Jason Pinkston)" }],
      "minnesota-vikings": [{ type: "pick", asset: "2011 6th round pick (168th overall, Demarcus Love) and 2011 6th round pick (170th overall, Mistral Raymond)" }]
    }
  },
  "RAM-2011-0464": {
    lane: "grade_verdict_review",
    note: "Cleveland acquired John Greco while the Rams' conditional pick did not convey.",
    teams: ["cleveland-browns", "los-angeles-rams"],
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "A", "los-angeles-rams": "D" },
    assetsReceived: {
      "cleveland-browns": [{ type: "player", asset: "John Greco" }],
      "los-angeles-rams": [{ type: "pick", asset: "conditional 2012 pick (not conveyed)" }]
    }
  },
  "RAM-2012-0468": {
    lane: "grade_verdict_review",
    note: "Chicago landed Alshon Jeffery; the Rams return did not come close.",
    teams: ["chicago-bears", "los-angeles-rams"],
    verdict: "Chicago Bears Win",
    grades: { "chicago-bears": "A+", "los-angeles-rams": "D" },
    assetsReceived: {
      "chicago-bears": [{ type: "pick", asset: "2012 2nd round pick (45th overall, Alshon Jeffery)" }],
      "los-angeles-rams": [{ type: "pick", asset: "2012 2nd round pick (50th overall, Isaiah Pead) and 2012 5th round pick (150th overall, Rokevious Watkins)" }]
    }
  },
  "DEN-2010-09-15-0318": {
    lane: "structural_hold",
    note: "Collapse four perspectives; New England's fourth-round value beats Denver's Maroney return.",
    teams: ["denver-broncos", "new-england-patriots"],
    verdict: "New England Patriots Win",
    grades: { "denver-broncos": "D", "new-england-patriots": "B" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "Laurence Maroney and 2011 6th round pick (189th overall, Mike Mohamed)" }],
      "new-england-patriots": [{ type: "pick", asset: "2011 4th round pick (99th overall subsequently traded, K.J. Wright)" }]
    }
  },
  "DEN-2011-04-29-0319": {
    lane: "structural_hold",
    note: "Collapse four perspectives; San Francisco's Kaepernick move carries the strongest value.",
    teams: ["denver-broncos", "san-francisco-49ers"],
    verdict: "San Francisco 49ers Win",
    grades: { "denver-broncos": "C", "san-francisco-49ers": "B+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2011 2nd round pick (45th overall, Rahim Moore), 2011 4th round pick (108th overall, Quinton Carter) and 2011 5th round pick (141st overall subsequently traded, D.J. Williams)" }],
      "san-francisco-49ers": [{ type: "pick", asset: "2011 2nd round pick (36th overall, Colin Kaepernick)" }]
    }
  },
  "DEN-2011-04-30-0320": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Denver's Julius Thomas/Virgil Green return wins clearly.",
    teams: ["denver-broncos", "green-bay-packers"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "A", "green-bay-packers": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2011 4th round pick (129th overall, Julius Thomas) and 2011 7th round pick (204th overall, Virgil Green)" }],
      "green-bay-packers": [{ type: "pick", asset: "2011 5th round pick (141st overall, D.J. Williams) and 2011 6th round pick (186th overall, D.J. Smith)" }]
    }
  },
  "DEN-2011-07-27-0321": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Washington received the more useful player in Jabar Gaffney.",
    teams: ["denver-broncos", "washington-commanders"],
    verdict: "Washington Commanders Win",
    grades: { "denver-broncos": "D", "washington-commanders": "B" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Jeremy Jarmon" }],
      "washington-commanders": [{ type: "player", asset: "Jabar Gaffney" }]
    }
  },
  "DEN-2011-08-02-0322": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Denver received useful short-term value from Brodrick Bunkley.",
    teams: ["denver-broncos", "philadelphia-eagles"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "philadelphia-eagles": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Brodrick Bunkley" }],
      "philadelphia-eagles": [{ type: "pick", asset: "2013 6th round pick (196th overall subsequently traded, Jeff Baca)" }]
    }
  },
  "DEN-2012-03-26-0323": {
    lane: "structural_hold",
    note: "Collapse three duplicate Tebow perspectives; Denver's Danny Trevathan value keeps the win.",
    teams: ["denver-broncos", "new-york-jets"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B+", "new-york-jets": "D" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2012 4th round pick (108th overall, Philip Blake) and 2012 6th round pick (188th overall, Danny Trevathan)" }],
      "new-york-jets": [{ type: "pick", asset: "Tim Tebow and 2012 7th round pick (232nd overall subsequently traded, Greg Scruggs)" }]
    }
  },
  "DEN-2012-04-12-0324": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Brandon Lloyd rental value and Denver's pick return stay close.",
    teams: ["denver-broncos", "los-angeles-rams"],
    verdict: "Even Trade",
    grades: { "denver-broncos": "B-", "los-angeles-rams": "B-" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2012 5th round pick (167th overall subsequently traded, George Iloka)" }],
      "los-angeles-rams": [{ type: "player", asset: "Brandon Lloyd" }]
    }
  },
  "DEN-2012-04-26-0325": {
    lane: "structural_hold",
    note: "Collapse four perspectives; New England's Dont'a Hightower result wins the trade.",
    teams: ["denver-broncos", "new-england-patriots"],
    verdict: "New England Patriots Win",
    grades: { "denver-broncos": "C", "new-england-patriots": "A" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2012 1st round pick (31st overall subsequently traded, Doug Martin) and 2012 4th round pick (126th overall subsequently traded, Jared Crick)" }],
      "new-england-patriots": [{ type: "pick", asset: "2012 1st round pick (25th overall, Dont'a Hightower)" }]
    }
  },
  "DEN-2012-04-26-0326": {
    lane: "structural_hold",
    note: "Collapse four perspectives and remove broken duplicate asset fragments; Tampa Bay gets the slight edge from Doug Martin.",
    teams: ["denver-broncos", "tampa-bay-buccaneers"],
    verdict: "Tampa Bay Buccaneers Win",
    grades: { "denver-broncos": "B", "tampa-bay-buccaneers": "B+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2012 2nd round pick (36th overall, Derek Wolfe) and 2012 4th round pick (101st overall, Omar Bolden)" }],
      "tampa-bay-buccaneers": [{ type: "pick", asset: "2012 1st round pick (31st overall, Doug Martin) and 2012 4th round pick (126th overall subsequently traded, Jared Crick)" }]
    }
  },
  "DEN-2012-04-27-0327": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Denver's Ronnie Hillman return beats Cleveland's depth package.",
    teams: ["denver-broncos", "cleveland-browns"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B", "cleveland-browns": "C-" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2012 3rd round pick (67th overall, Ronnie Hillman)" }],
      "cleveland-browns": [{ type: "pick", asset: "2012 3rd round pick (87th overall, John Hughes) and 2012 4th round pick (120th overall, James-Michael Johnson)" }]
    }
  }
};

function name(team) {
  return teamNames[team] || String(team).split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/Partner-side/gi, "Counterparty")
    .replace(/\bpartner side\b/gi, "counterparty")
    .replace(/\bpartner grade\b/gi, "counterparty grade")
    .replace(/\bPartner Win\b/g, "Reviewed win")
    .replace(/\bPartner Even\b/g, "Even")
    .replace(/\bpartner outcome\b/gi, "counterparty outcome")
    .replace(/\btrade partner\b/gi, "counterparty")
    .replace(/\bpartner\b/gi, "counterparty")
    .replace(/same strict-hindsight value curve/gi, "same final review")
    .replace(/same hindsight value curve/gi, "same final review")
    .replace(/same value curve/gi, "same final review")
    .replace(/hindsight value curve/gi, "final review")
    .replace(/rebalanced curve/gi, "reviewed grade split")
    .replace(/receives the edge/gi, "wins the review")
    .replace(/received the edge/gi, "won the review")
    .replace(/Los Angeles\/Cleveland\/St\. Louis Rams/g, "Los Angeles/St. Louis Rams")
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
      summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 012 review keeps this as an even trade because both returns stayed in a similar value range.`),
      partnerSummary: clean(`The grade profile is ${an} ${ag}, ${bn} ${bg}. Neither return separates enough for a win/loss verdict.`),
      analysis: clean(`The final TradeVerdicts outcome is Even Trade after comparing player impact, pick value, roster usefulness, and retained asset value.`)
    };
  }

  const wn = name(winner);
  return {
    summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 012 review favors ${wn} because that return produced stronger practical football value.`),
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

const badPublic = /Partner-side|\bpartner side\b|\bpartner grade\b|\bPartner Win\b|\bPartner Even\b|\bpartner outcome\b|\btrade partner\b|\bpartner\b|same strict-hindsight value curve|same hindsight value curve|same value curve|hindsight value curve|rebalanced curve|receives the edge|received the edge|Bears's|Jets's|Falcons's|Vikings's|Cardinals's|Patriots's|Raiders's|Titans's|Eagles's|Seahawks's|Chiefs's|Dolphins's|Rams's|Colts's|Broncos's|Ravens's|49ers's/i;

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
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-final-14-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Final 14 ${apply ? "Apply" : "Dry Run"} v1\n\n`;
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
