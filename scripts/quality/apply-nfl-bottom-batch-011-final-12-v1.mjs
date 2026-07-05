import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "011";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-final-12-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-final-12-${apply ? "apply" : "dry-run"}-v1.json`;

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const teamNames = {
  "arizona-cardinals": "Arizona Cardinals",
  "baltimore-ravens": "Baltimore Ravens",
  "denver-broncos": "Denver Broncos",
  "detroit-lions": "Detroit Lions",
  "green-bay-packers": "Green Bay Packers",
  "indianapolis-colts": "Indianapolis Colts",
  "kansas-city-chiefs": "Kansas City Chiefs",
  "los-angeles-chargers": "Los Angeles Chargers",
  "miami-dolphins": "Miami Dolphins",
  "minnesota-vikings": "Minnesota Vikings",
  "san-francisco-49ers": "San Francisco 49ers",
  "seattle-seahawks": "Seattle Seahawks",
  "tennessee-titans": "Tennessee Titans"
};

const decisions = {
  "TEN-2012-0222": {
    lane: "grade_verdict_review",
    note: "Visible flip: Miami gained the stronger outcome after moving down and adding Rishard Matthews.",
    teams: ["tennessee-titans", "miami-dolphins"],
    verdict: "Miami Dolphins Win",
    grades: { "tennessee-titans": "D+", "miami-dolphins": "B" },
    assetsReceived: {
      "tennessee-titans": [{ type: "pick", asset: "2012 5th round pick (145th overall, Taylor Thompson)" }],
      "miami-dolphins": [{ type: "pick", asset: "2012 5th round pick (155th overall, Josh Kaddu) and 2012 7th round pick (227th overall, Rishard Matthews)" }]
    }
  },
  "MIN-2012-0234": {
    lane: "grade_verdict_review",
    note: "Normalize Vikings verdict and align both perspectives.",
    teams: ["minnesota-vikings", "arizona-cardinals"],
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "B-", "arizona-cardinals": "C" },
    assetsReceived: {
      "minnesota-vikings": [{ type: "pick", asset: "A.J. Jefferson and 2013 7th round pick (213th overall, Michael Mauti)" }],
      "arizona-cardinals": [{ type: "pick", asset: "2013 6th round pick (176th overall subsequently traded, David Quessenberry)" }]
    }
  },
  "LAC-2013-0358": {
    lane: "grade_verdict_review",
    note: "Visible flip: Arizona received Kevin Minter plus extra capital; Chargers got Manti Te'o.",
    teams: ["los-angeles-chargers", "arizona-cardinals"],
    verdict: "Arizona Cardinals Win",
    grades: { "los-angeles-chargers": "C", "arizona-cardinals": "B+" },
    assetsReceived: {
      "los-angeles-chargers": [{ type: "pick", asset: "2013 2nd round pick (38th overall, Manti Te'o)" }],
      "arizona-cardinals": [{ type: "pick", asset: "2013 2nd round pick (45th overall, Kevin Minter) and 2013 4th round pick (110th overall subsequently traded, Ryan Nassib)" }]
    }
  },
  "SEA-2013-04-26-0166": {
    lane: "grade_verdict_review",
    note: "Keep Seattle win and align the provisional Seattle perspective.",
    teams: ["seattle-seahawks", "baltimore-ravens"],
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "B", "baltimore-ravens": "C-" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "2013 2nd round pick (62nd overall, Christine Michael), 2013 5th round pick (165th overall subsequently traded, Sam Martin) and 2013 6th round pick (199th overall subsequently traded, Theo Riddick)" }],
      "baltimore-ravens": [{ type: "pick", asset: "2013 2nd round pick (56th overall, Arthur Brown)" }]
    }
  },
  "SEA-2013-04-27-0167": {
    lane: "grade_verdict_review",
    note: "Keep Detroit win based on Sam Martin/Theo Riddick value.",
    teams: ["seattle-seahawks", "detroit-lions"],
    verdict: "Detroit Lions Win",
    grades: { "seattle-seahawks": "C-", "detroit-lions": "A" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "2013 5th round pick (137th overall, Jesse Williams)" }],
      "detroit-lions": [{ type: "pick", asset: "2013 5th round pick (165th overall, Sam Martin) and 2013 6th round pick (199th overall, Theo Riddick)" }]
    }
  },
  "KC-2013-0231": {
    lane: "grade_verdict_review",
    note: "Keep Chiefs win; Anthony Sherman supplied the stronger long-term value.",
    teams: ["kansas-city-chiefs", "arizona-cardinals"],
    verdict: "Kansas City Chiefs Win",
    grades: { "kansas-city-chiefs": "A", "arizona-cardinals": "C" },
    assetsReceived: {
      "kansas-city-chiefs": [{ type: "player", asset: "Anthony Sherman" }],
      "arizona-cardinals": [{ type: "player", asset: "Javier Arenas" }]
    }
  },
  "MIN-2014-0239": {
    lane: "grade_verdict_review",
    note: "Normalize Vikings verdict and align Teddy Bridgewater trade-up perspectives.",
    teams: ["minnesota-vikings", "seattle-seahawks"],
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "B+", "seattle-seahawks": "B" },
    assetsReceived: {
      "minnesota-vikings": [{ type: "pick", asset: "2014 1st round pick (32nd overall, Teddy Bridgewater)" }],
      "seattle-seahawks": [{ type: "pick", asset: "2014 2nd round pick (40th overall subsequently traded, Kyle Van Noy) and 2014 4th round pick (108th overall, Cassius Marsh)" }]
    }
  },
  "SEA-2014-05-09-0171": {
    lane: "grade_verdict_review",
    note: "Keep Detroit win after comparing the moved-down package against Seattle's return.",
    teams: ["seattle-seahawks", "detroit-lions"],
    verdict: "Detroit Lions Win",
    grades: { "seattle-seahawks": "C-", "detroit-lions": "A-" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "2014 2nd round pick (45th overall, Paul Richardson), 2014 4th round pick (111th overall subsequently traded, Russell Bodine) and 2014 7th round pick (227th overall, Kiero Small)" }],
      "detroit-lions": [{ type: "pick", asset: "2014 2nd round pick (40th overall, Kyle Van Noy) and 2014 5th round pick (146th overall subsequently traded, Devin Street)" }]
    }
  },
  "DEN-2012-05-23-0328": {
    lane: "structural_hold",
    note: "Collapse three duplicate perspectives to two canonical team perspectives.",
    teams: ["denver-broncos", "indianapolis-colts"],
    verdict: "Even Trade",
    grades: { "denver-broncos": "C", "indianapolis-colts": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Chris Gronkowski" }],
      "indianapolis-colts": [{ type: "player", asset: "Cassius Vaughn" }]
    }
  },
  "SF-2013-0362": {
    lane: "structural_hold",
    note: "Collapse four conflicting perspectives to two canonical perspectives; overall package favors Green Bay.",
    teams: ["san-francisco-49ers", "green-bay-packers"],
    verdict: "Green Bay Packers Win",
    grades: { "san-francisco-49ers": "C+", "green-bay-packers": "B+" },
    assetsReceived: {
      "san-francisco-49ers": [{ type: "pick", asset: "2013 2nd round pick (55th overall, Vance McDonald) and 2013 3rd round pick (88th overall, Corey Lemonier)" }],
      "green-bay-packers": [{ type: "pick", asset: "2013 2nd round pick (61st overall, Eddie Lacy), 2013 6th round pick (173rd overall subsequently traded, Vinston Painter), 2013 3rd round pick (93rd overall subsequently traded, Will Davis) and 2013 7th round pick (216th overall, Charles Johnson)" }]
    }
  },
  "DEN-2013-04-27-0329": {
    lane: "structural_hold",
    note: "Collapse four duplicate Denver/Green Bay perspectives to two canonical team perspectives.",
    teams: ["denver-broncos", "green-bay-packers"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B", "green-bay-packers": "C+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2013 5th round pick (146th overall, Quanterus Smith) and 2013 6th round pick (173rd overall, Vinston Painter)" }],
      "green-bay-packers": [{ type: "pick", asset: "2013 4th round pick (125th overall, Johnathan Franklin)" }]
    }
  },
  "DEN-2014-05-09-0331": {
    lane: "structural_hold",
    note: "Collapse four duplicate/conflicting perspectives; top-level verdict favors San Francisco.",
    teams: ["denver-broncos", "san-francisco-49ers"],
    verdict: "San Francisco 49ers Win",
    grades: { "denver-broncos": "D", "san-francisco-49ers": "B+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2014 2nd round pick (56th overall, Cody Latimer) and 2014 7th round pick (242nd overall, Corey Nelson)" }],
      "san-francisco-49ers": [{ type: "pick", asset: "2014 2nd round pick (63rd overall subsequently traded, Jarvis Landry), 2014 5th round pick (171st overall subsequently traded, Jordan Tripp) and 2015 4th round pick (126th overall, Mike Davis)" }]
    }
  }
};

function name(team) {
  return teamNames[team] || String(team).split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/Partner-side/gi, "Opposite-side")
    .replace(/\bpartner side\b/gi, "opposite side")
    .replace(/\bpartner grade\b/gi, "opposite-side grade")
    .replace(/\bPartner Even\b/g, "Even")
    .replace(/\bpartner outcome\b/gi, "opposite-side outcome")
    .replace(/same hindsight value curve/gi, "same final value review")
    .replace(/same strict-hindsight value curve/gi, "same final value review")
    .replace(/same value curve/gi, "same final value review")
    .replace(/hindsight value curve/gi, "final value review")
    .replace(/receives the edge/gi, "wins the review")
    .replace(/received the edge/gi, "won the review")
    .replace(/Vikings Win/g, "Minnesota Vikings Win")
    .replace(/Los Angeles\/San Diego Chargers Win/g, "Los Angeles Chargers Win")
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
      summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 011 review keeps this as an even trade because the confirmed value stayed close.`),
      partnerSummary: clean(`The return on both sides stayed in the same range after accounting for player value, draft slot, and actual roster impact.`),
      analysis: clean(`The grade profile remains ${an} ${ag}, ${bn} ${bg}. The final TradeVerdicts outcome is Even Trade.`)
    };
  }

  const wn = name(winner);
  return {
    summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 011 review favors ${wn} because that return produced stronger long-term football value.`),
    partnerSummary: clean(`The grade profile is ${an} ${ag}, ${bn} ${bg}. The visible verdict remains ${d.verdict}.`),
    analysis: clean(`${wn} earns the stronger review after comparing the actual player outcomes, draft-slot cost, and retained value from the exchange. The final TradeVerdicts outcome is ${d.verdict}.`)
  };
}

function makePerspectives(oldTrade, d) {
  const [a, b] = d.teams;

  return d.teams.map(primary => {
    const other = primary === a ? b : a;
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
      primarySummary: clean(`${name(primary)} received ${assetText(d, primary)}. This perspective grades ${d.grades[primary]}, and the visible verdict is ${d.verdict}.`),
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

const badPublic = /Partner-side|\bpartner side\b|\bpartner grade\b|\bPartner Even\b|\bpartner outcome\b|same hindsight value curve|same strict-hindsight value curve|hindsight value curve|receives the edge|received the edge|Bears's|Jets's|Falcons's|Vikings's|Cardinals's|Patriots's|Raiders's|Titans's|Eagles's|Seahawks's|Chiefs's|Dolphins's|Rams's|Colts's|Broncos's|Ravens's/i;

const results = [];
let blocked = 0;
let changed = 0;
const visibleFlips = [];

for (const [id, d] of Object.entries(decisions)) {
  const t = trades.find(x => x.id === id);
  if (!t) {
    blocked++;
    results.push({ id, status: "blocked", reason: "missing trade" });
    continue;
  }

  const beforeVerdict = t.verdict;
  const beforeGrades = JSON.stringify(t.grades || {});
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

    if (apply) Object.assign(t, next);
    results.push({ id, status: apply ? "applied" : "would_apply", lane: d.lane, note: d.note });
  } else {
    results.push({ id, status: "no_change", lane: d.lane, note: d.note });
  }
}

let backup = "";
if (apply && changed) {
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-final-12-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Final 12 ${apply ? "Apply" : "Dry Run"} v1\n\n`;
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
if (visibleFlips.length) {
  for (const f of visibleFlips) txt += `- ${f}\n`;
} else {
  txt += `- None\n`;
}

txt += `\n## Records\n`;
for (const r of results) txt += `- ${r.id}: ${r.status}${r.lane ? ` (${r.lane})` : ""}${r.note ? ` — ${r.note}` : ""}${r.reason ? ` — ${r.reason}` : ""}\n`;

fs.writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), mode: apply ? "apply" : "dry-run", blocked, changed, counts, visibleFlips, results }, null, 2) + "\n");
fs.writeFileSync(outTxt, txt);

console.log(txt);
console.log(`Wrote: ${outTxt}`);
