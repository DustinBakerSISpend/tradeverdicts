import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "014";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-final-15-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-final-15-${apply ? "apply" : "dry-run"}-v1.json`;

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const teamNames = {
  "atlanta-falcons": "Atlanta Falcons",
  "baltimore-ravens": "Baltimore Ravens",
  "chicago-bears": "Chicago Bears",
  "cleveland-browns": "Cleveland Browns",
  "dallas-cowboys": "Dallas Cowboys",
  "denver-broncos": "Denver Broncos",
  "detroit-lions": "Detroit Lions",
  "houston-texans": "Houston Texans",
  "las-vegas-raiders": "Las Vegas Raiders",
  "miami-dolphins": "Miami Dolphins",
  "new-york-jets": "New York Jets",
  "pittsburgh-steelers": "Pittsburgh Steelers",
  "seattle-seahawks": "Seattle Seahawks",
  "tampa-bay-buccaneers": "Tampa Bay Buccaneers",
  "tennessee-titans": "Tennessee Titans"
};

const decisions = {
  "SEA-2007-09-11-0135": {
    lane: "grade_verdict_review",
    note: "Keep as even; Bryce Fisher for a fifth-round pick is low-separation.",
    teams: ["seattle-seahawks", "tennessee-titans"],
    verdict: "Even Trade",
    grades: { "seattle-seahawks": "C", "tennessee-titans": "C" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "2007 5th round pick" }],
      "tennessee-titans": [{ type: "player", asset: "Bryce Fisher" }]
    }
  },
  "SEA-2008-04-26-0137": {
    lane: "grade_verdict_review",
    note: "Baltimore clearly won after moving down and landing Ray Rice plus Tom Zbikowski.",
    teams: ["baltimore-ravens", "seattle-seahawks"],
    verdict: "Baltimore Ravens Win",
    grades: { "baltimore-ravens": "A", "seattle-seahawks": "D" },
    assetsReceived: {
      "baltimore-ravens": [{ type: "pick", asset: "2008 2nd round pick (55th overall, Ray Rice) and 2008 3rd round pick (86th overall, Tom Zbikowski)" }],
      "seattle-seahawks": [{ type: "pick", asset: "2008 2nd round pick (38th overall, John Carlson)" }]
    }
  },
  "PIT-2008-0342": {
    lane: "grade_verdict_review",
    note: "Keep a slight Steelers edge; Tampa Bay received Sean Mahan while Pittsburgh recovered draft value.",
    teams: ["pittsburgh-steelers", "tampa-bay-buccaneers"],
    verdict: "Pittsburgh Steelers Win",
    grades: { "pittsburgh-steelers": "C+", "tampa-bay-buccaneers": "C" },
    assetsReceived: {
      "pittsburgh-steelers": [{ type: "pick", asset: "undisclosed 2008 draft pick" }],
      "tampa-bay-buccaneers": [{ type: "player", asset: "Sean Mahan" }]
    }
  },
  "SEA-2008-09-02-0138": {
    lane: "grade_verdict_review",
    note: "Flip to Denver; Keary Colbert did not give Seattle enough return for the pick cost.",
    teams: ["denver-broncos", "seattle-seahawks"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "seattle-seahawks": "D+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "undisclosed 2008 draft pick" }],
      "seattle-seahawks": [{ type: "player", asset: "Keary Colbert" }]
    }
  },
  "SEA-2009-03-16-0139": {
    lane: "grade_verdict_review",
    note: "Keep Seattle edge on the Cory Redding plus pick return for Julian Peterson.",
    teams: ["seattle-seahawks", "detroit-lions"],
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "B", "detroit-lions": "C" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "player", asset: "Cory Redding and 2009 5th round pick (137th overall subsequently traded, Jason Phillips)" }],
      "detroit-lions": [{ type: "player", asset: "Julian Peterson" }]
    }
  },

  "DEN-2008-03-17-0296": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Houston won the Chris Myers trade.",
    teams: ["denver-broncos", "houston-texans"],
    verdict: "Houston Texans Win",
    grades: { "denver-broncos": "C+", "houston-texans": "B+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2008 6th round pick (183rd overall, Spencer Larsen)" }],
      "houston-texans": [{ type: "player", asset: "Chris Myers" }]
    }
  },
  "DEN-2008-04-26-0297": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Denver gets the useful-player edge on Dewayne Robertson.",
    teams: ["denver-broncos", "new-york-jets"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B", "new-york-jets": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Dewayne Robertson" }],
      "new-york-jets": [{ type: "pick", asset: "undisclosed 2008 draft pick" }]
    }
  },
  "DAL-2008-0292": {
    lane: "structural_hold",
    note: "Collapse four contaminated perspectives and remove the separate 2009 Jason Williams asset.",
    teams: ["dallas-cowboys", "cleveland-browns"],
    verdict: "Dallas Cowboys Win",
    grades: { "dallas-cowboys": "B-", "cleveland-browns": "C-" },
    assetsReceived: {
      "dallas-cowboys": [{ type: "pick", asset: "2008 4th round pick (122nd overall, Tashard Choice) and 2008 5th round pick (155th overall subsequently traded, Thomas Williams)" }],
      "cleveland-browns": [{ type: "pick", asset: "2008 4th round pick (104th overall, Beau Bell)" }]
    }
  },
  "RAI-2008-0331": {
    lane: "structural_hold",
    note: "Remove unrelated Dolphins/Bears contamination; Raiders won the Tyvon Branch trade.",
    teams: ["las-vegas-raiders", "dallas-cowboys"],
    verdict: "Las Vegas Raiders Win",
    grades: { "las-vegas-raiders": "B+", "dallas-cowboys": "D+" },
    assetsReceived: {
      "las-vegas-raiders": [{ type: "pick", asset: "2008 4th round pick (100th overall, Tyvon Branch)" }],
      "dallas-cowboys": [{ type: "pick", asset: "2008 4th round pick (104th overall subsequently traded, Beau Bell) and 2008 7th round pick (213th overall subsequently traded, Chauncey Washington)" }]
    }
  },
  "DEN-2008-08-28-0298": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Denver gets the pick-value edge for Montrae Holland.",
    teams: ["denver-broncos", "dallas-cowboys"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B", "dallas-cowboys": "C-" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2010 5th round pick (158th overall subsequently traded, Matt Tennant)" }],
      "dallas-cowboys": [{ type: "player", asset: "Montrae Holland" }]
    }
  },
  "DEN-2008-09-02-0299": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Atlanta received Domonique Foxworth and wins slightly.",
    teams: ["denver-broncos", "atlanta-falcons"],
    verdict: "Atlanta Falcons Win",
    grades: { "denver-broncos": "C", "atlanta-falcons": "C+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "undisclosed 2008 draft pick" }],
      "atlanta-falcons": [{ type: "player", asset: "Domonique Foxworth" }]
    }
  },
  "DEN-2009-04-03-0301": {
    lane: "structural_hold",
    note: "Collapse duplicate Jay Cutler perspectives; Denver keeps the overall value edge.",
    teams: ["denver-broncos", "chicago-bears"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B+", "chicago-bears": "B-" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "Kyle Orton, 2009 1st round pick (18th overall, Robert Ayers), 2009 3rd round pick (84th overall subsequently traded, Mike Wallace) and 2010 1st round pick (11th overall subsequently traded, Anthony Davis)" }],
      "chicago-bears": [{ type: "player", asset: "Jay Cutler and 2009 5th round pick (140th overall, Johnny Knox)" }]
    }
  },
  "DEN-2009-04-25-0303": {
    lane: "structural_hold",
    note: "Correct the visible grade split; Pittsburgh landed Mike Wallace value while Denver's return failed.",
    teams: ["denver-broncos", "pittsburgh-steelers"],
    verdict: "Pittsburgh Steelers Win",
    grades: { "denver-broncos": "F", "pittsburgh-steelers": "A" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2009 2nd round pick (64th overall, Richard Quinn) and 2009 4th round pick (132nd overall, Seth Olsen)" }],
      "pittsburgh-steelers": [{ type: "pick", asset: "2009 3rd round pick (79th overall, Kraig Urbik) and 2009 3rd round pick (84th overall, Mike Wallace)" }]
    }
  },
  "DEN-2009-04-26-0304": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Baltimore gets the stronger late-pick package.",
    teams: ["denver-broncos", "baltimore-ravens"],
    verdict: "Baltimore Ravens Win",
    grades: { "denver-broncos": "C-", "baltimore-ravens": "B" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2009 5th round pick (141st overall, Kenny McKinley)" }],
      "baltimore-ravens": [{ type: "pick", asset: "2009 5th round pick (149th overall, Davon Drew) and 2009 6th round pick (185th overall, Cedric Peerman)" }]
    }
  },
  "DEN-2009-04-26-0305": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Detroit gets the better realized value from the extra pick package.",
    teams: ["denver-broncos", "detroit-lions"],
    verdict: "Detroit Lions Win",
    grades: { "denver-broncos": "C", "detroit-lions": "B+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2009 6th round pick (174th overall, Tom Brandstater)" }],
      "detroit-lions": [{ type: "pick", asset: "2009 7th round pick (235th overall, Zack Follett) and 2010 5th round pick (146th overall subsequently traded, Cam Thomas)" }]
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
    .replace(/same hindsight value curve/gi, "same final review")
    .replace(/same value curve/gi, "same final review")
    .replace(/hindsight value curve/gi, "final review")
    .replace(/hindsight curve/gi, "final review")
    .replace(/rebalanced curve/gi, "reviewed grade split")
    .replace(/receives the edge/gi, "wins the review")
    .replace(/received the edge/gi, "won the review")
    .replace(/Houston Oilers\/Tennessee Titans/g, "Tennessee Titans")
    .replace(/Oakland Raiders/g, "Las Vegas Raiders")
    .replace(/Denver Broncos's/g, "Denver Broncos'")
    .replace(/Cleveland Browns's/g, "Cleveland Browns'")
    .replace(/Bears's/g, "Bears'")
    .replace(/Jets's/g, "Jets'")
    .replace(/Falcons's/g, "Falcons'")
    .replace(/Vikings's/g, "Vikings'")
    .replace(/Patriots's/g, "Patriots'")
    .replace(/Raiders's/g, "Raiders'")
    .replace(/Titans's/g, "Titans'")
    .replace(/Eagles's/g, "Eagles'")
    .replace(/Seahawks's/g, "Seahawks'")
    .replace(/Dolphins's/g, "Dolphins'")
    .replace(/Rams's/g, "Rams'")
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
      summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 014 review keeps this as an even trade because neither return separates enough for a win/loss label.`),
      partnerSummary: clean(`The grade profile is ${an} ${ag}, ${bn} ${bg}. The visible verdict is Even Trade.`),
      analysis: clean(`The final TradeVerdicts outcome is Even Trade after comparing player impact, pick value, roster usefulness, and retained value from the exchange.`)
    };
  }

  const wn = name(winner);
  return {
    summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 014 review favors ${wn} because that return produced stronger practical football value.`),
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

const badPublic = /Partner-side|\bpartner side\b|\bpartner grade\b|\bPartner Win\b|\bPartner Even\b|\bpartner outcome\b|\btrade partner\b|\bpartner\b|same strict-hindsight value curve|same hindsight value curve|same value curve|hindsight value curve|hindsight curve|rebalanced curve|receives the edge|received the edge|Unknown\/undisclosed partner|Bears's|Jets's|Falcons's|Vikings's|Cardinals's|Patriots's|Raiders's|Titans's|Eagles's|Seahawks's|Chiefs's|Dolphins's|Rams's|Colts's|Broncos's|Ravens's|49ers's|Browns's/i;

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
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-final-15-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Final 15 ${apply ? "Apply" : "Dry Run"} v1\n\n`;
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
