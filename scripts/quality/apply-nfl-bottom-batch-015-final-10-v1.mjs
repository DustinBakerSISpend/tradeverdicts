import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "015";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-final-10-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-final-10-${apply ? "apply" : "dry-run"}-v1.json`;

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const teamNames = {
  "atlanta-falcons": "Atlanta Falcons",
  "chicago-bears": "Chicago Bears",
  "cleveland-browns": "Cleveland Browns",
  "dallas-cowboys": "Dallas Cowboys",
  "denver-broncos": "Denver Broncos",
  "detroit-lions": "Detroit Lions",
  "jacksonville-jaguars": "Jacksonville Jaguars",
  "las-vegas-raiders": "Las Vegas Raiders",
  "los-angeles-rams": "Los Angeles Rams",
  "minnesota-vikings": "Minnesota Vikings",
  "new-england-patriots": "New England Patriots",
  "pittsburgh-steelers": "Pittsburgh Steelers",
  "tampa-bay-buccaneers": "Tampa Bay Buccaneers"
};

const decisions = {
  "CHI-2007-0439": {
    lane: "grade_verdict_review",
    note: "Keep as even; Dante Wesley for an undisclosed pick is too low-separation for a win label.",
    teams: ["chicago-bears", "new-england-patriots"],
    verdict: "Even Trade",
    grades: { "chicago-bears": "C", "new-england-patriots": "C" },
    assetsReceived: {
      "chicago-bears": [{ type: "pick", asset: "undisclosed 2007 draft pick" }],
      "new-england-patriots": [{ type: "player", asset: "Dante Wesley" }]
    }
  },
  "PIT-2007-0340": {
    lane: "grade_verdict_review",
    note: "Keep slight Pittsburgh edge; Allen Rossum gave the Steelers useful return-game value.",
    teams: ["pittsburgh-steelers", "atlanta-falcons"],
    verdict: "Pittsburgh Steelers Win",
    grades: { "pittsburgh-steelers": "C+", "atlanta-falcons": "C" },
    assetsReceived: {
      "pittsburgh-steelers": [{ type: "player", asset: "Allen Rossum" }],
      "atlanta-falcons": [{ type: "pick", asset: "undisclosed 2007 draft pick" }]
    }
  },

  "DEN-2006-08-18-0288": {
    lane: "structural_hold",
    note: "Treat failed-physical/non-exercised transaction as a historical note, not a Denver win.",
    teams: ["denver-broncos", "dallas-cowboys"],
    verdict: "Even Trade",
    grades: { "denver-broncos": "C", "dallas-cowboys": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "voided conditional 2007 5th-round pick; trade not exercised after Charlie Adams failed physical" }],
      "dallas-cowboys": [{ type: "player", asset: "Charlie Adams rights in a trade not exercised after failed physical" }]
    }
  },
  "DEN-2007-03-02-0290": {
    lane: "structural_hold",
    note: "Flip to Denver; Dre' Bly gave Denver more practical value than the outgoing Detroit package.",
    teams: ["denver-broncos", "detroit-lions"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B", "detroit-lions": "C-" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Dre' Bly and 2007 6th round pick (176th overall subsequently traded, Rufus Alexander)" }],
      "detroit-lions": [{ type: "player", asset: "Tatum Bell, George Foster and 2007 5th round pick (158th overall, Johnny Baldwin)" }]
    }
  },
  "DEN-2007-03-03-0291": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Denver monetized Jake Plummer rights better than Tampa Bay's return.",
    teams: ["denver-broncos", "tampa-bay-buccaneers"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "tampa-bay-buccaneers": "C+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "undisclosed 2007 draft pick" }],
      "tampa-bay-buccaneers": [{ type: "player", asset: "Jake Plummer rights" }]
    }
  },
  "DAL-2007-0282": {
    lane: "structural_hold",
    note: "Remove separate Browns/Cowboys contamination; Dallas clearly won the Brady Quinn trade.",
    teams: ["dallas-cowboys", "cleveland-browns"],
    verdict: "Dallas Cowboys Win",
    grades: { "dallas-cowboys": "A", "cleveland-browns": "D" },
    assetsReceived: {
      "dallas-cowboys": [{ type: "pick", asset: "2007 2nd round pick (36th overall subsequently traded, Kevin Kolb) and 2008 1st round pick (22nd overall, Felix Jones)" }],
      "cleveland-browns": [{ type: "pick", asset: "2007 1st round pick (22nd overall, Brady Quinn)" }]
    }
  },
  "DEN-2007-04-28-0292": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Jacksonville won the Jarvis Moss trade-up clearly.",
    teams: ["denver-broncos", "jacksonville-jaguars"],
    verdict: "Jacksonville Jaguars Win",
    grades: { "denver-broncos": "F", "jacksonville-jaguars": "A" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2007 1st round pick (17th overall, Jarvis Moss)" }],
      "jacksonville-jaguars": [{ type: "pick", asset: "2007 1st round pick (21st overall, Reggie Nelson), 2007 3rd round pick (86th overall subsequently traded, Marshal Yanda) and 2007 6th round pick (198th overall subsequently traded, Doug Datish)" }]
    }
  },
  "MIN-2007-04-29-0220": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Minnesota received the stronger pick package.",
    teams: ["minnesota-vikings", "denver-broncos"],
    verdict: "Minnesota Vikings Win",
    grades: { "minnesota-vikings": "A+", "denver-broncos": "D" },
    assetsReceived: {
      "minnesota-vikings": [{ type: "pick", asset: "2007 6th round pick (176th overall, Rufus Alexander), 2007 7th round pick (233rd overall, Chandler Williams) and 2008 3rd round pick (73rd overall subsequently traded, Jamaal Charles)" }],
      "denver-broncos": [{ type: "pick", asset: "2007 4th round pick (121st overall, Marcus Thomas)" }]
    }
  },
  "DEN-2007-06-08-0294": {
    lane: "structural_hold",
    note: "Collapse four perspectives; keep Denver edge on the Jimmy Kennedy acquisition.",
    teams: ["denver-broncos", "los-angeles-rams"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B", "los-angeles-rams": "C+" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Jimmy Kennedy" }],
      "los-angeles-rams": [{ type: "pick", asset: "undisclosed 2007 draft pick" }]
    }
  },
  "RAI-2007-0329": {
    lane: "structural_hold",
    note: "Collapse four perspectives and normalize Raiders naming; Raiders won the Gerard Warren deal.",
    teams: ["las-vegas-raiders", "denver-broncos"],
    verdict: "Las Vegas Raiders Win",
    grades: { "las-vegas-raiders": "B-", "denver-broncos": "C" },
    assetsReceived: {
      "las-vegas-raiders": [{ type: "player", asset: "Gerard Warren" }],
      "denver-broncos": [{ type: "pick", asset: "undisclosed 2007 draft pick" }]
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
    .replace(/hindsight\/value standard/gi, "final review standard")
    .replace(/hindsight value curve/gi, "final review")
    .replace(/hindsight curve/gi, "final review")
    .replace(/rebalanced curve/gi, "reviewed grade split")
    .replace(/receives the edge/gi, "wins the review")
    .replace(/received the edge/gi, "won the review")
    .replace(/Los Angeles\/Cleveland\/St\. Louis Rams/g, "Los Angeles Rams")
    .replace(/Los Angeles\/St\. Louis Rams/g, "Los Angeles Rams")
    .replace(/Oakland\/Las Vegas Raiders/g, "Las Vegas Raiders")
    .replace(/Oakland Raiders/g, "Las Vegas Raiders")
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
      summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 015 review keeps this as an even trade because neither return separates enough for a win/loss label.`),
      partnerSummary: clean(`The grade profile is ${an} ${ag}, ${bn} ${bg}. The visible verdict is Even Trade.`),
      analysis: clean(`The final TradeVerdicts outcome is Even Trade after comparing player impact, pick value, roster usefulness, and retained value from the exchange.`)
    };
  }

  const wn = name(winner);
  return {
    summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 015 review favors ${wn} because that return produced stronger practical football value.`),
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
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-final-10-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Final 10 ${apply ? "Apply" : "Dry Run"} v1\n\n`;
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
