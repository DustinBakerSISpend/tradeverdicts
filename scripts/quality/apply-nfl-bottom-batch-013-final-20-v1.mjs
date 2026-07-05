import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "013";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-final-20-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-final-20-${apply ? "apply" : "dry-run"}-v1.json`;

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const teamNames = {
  "baltimore-ravens": "Baltimore Ravens",
  "carolina-panthers": "Carolina Panthers",
  "cleveland-browns": "Cleveland Browns",
  "dallas-cowboys": "Dallas Cowboys",
  "denver-broncos": "Denver Broncos",
  "detroit-lions": "Detroit Lions",
  "jacksonville-jaguars": "Jacksonville Jaguars",
  "las-vegas-raiders": "Las Vegas Raiders",
  "los-angeles-chargers": "Los Angeles Chargers",
  "los-angeles-rams": "Los Angeles Rams",
  "miami-dolphins": "Miami Dolphins",
  "minnesota-vikings": "Minnesota Vikings",
  "new-england-patriots": "New England Patriots",
  "new-york-jets": "New York Jets",
  "philadelphia-eagles": "Philadelphia Eagles",
  "san-francisco-49ers": "San Francisco 49ers",
  "seattle-seahawks": "Seattle Seahawks",
  "tampa-bay-buccaneers": "Tampa Bay Buccaneers",
  "tennessee-titans": "Tennessee Titans",
  "unknown-team": "Unidentified Team"
};

const decisions = {
  "JAX-2009-0043": {
    lane: "grade_verdict_review",
    note: "Keep Detroit edge and align the Jacksonville perspective.",
    teams: ["detroit-lions", "jacksonville-jaguars"],
    verdict: "Detroit Lions Win",
    grades: { "detroit-lions": "B-", "jacksonville-jaguars": "C+" },
    assetsReceived: {
      "detroit-lions": [{ type: "player", asset: "Dennis Northcutt" }],
      "jacksonville-jaguars": [{ type: "player", asset: "Gerald Alexander" }]
    }
  },
  "CLE-2010-0365": {
    lane: "grade_verdict_review",
    note: "Keep Cleveland win and align both perspectives.",
    teams: ["cleveland-browns", "detroit-lions"],
    verdict: "Cleveland Browns Win",
    grades: { "cleveland-browns": "B+", "detroit-lions": "C" },
    assetsReceived: {
      "cleveland-browns": [{ type: "pick", asset: "2010 5th round pick (146th overall subsequently traded, Cam Thomas) and 2010 7th round pick (214th overall subsequently traded, Mickey Shuler)" }],
      "detroit-lions": [{ type: "player", asset: "Corey Williams and 2010 7th round pick" }]
    }
  },
  "SEA-2010-03-09-0143": {
    lane: "grade_verdict_review",
    note: "Flip slight edge to Cleveland for acquiring usable quarterback depth for a seventh-round pick.",
    teams: ["seattle-seahawks", "cleveland-browns"],
    verdict: "Cleveland Browns Win",
    grades: { "seattle-seahawks": "C", "cleveland-browns": "C+" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "2011 7th round pick (209th overall subsequently traded, Johnny Culbreath)" }],
      "cleveland-browns": [{ type: "player", asset: "Seneca Wallace" }]
    }
  },
  "LAC-2010-0352": {
    lane: "grade_verdict_review",
    note: "Keep Chargers win and normalize Chargers naming.",
    teams: ["los-angeles-chargers", "seattle-seahawks"],
    verdict: "Los Angeles Chargers Win",
    grades: { "los-angeles-chargers": "B", "seattle-seahawks": "C+" },
    assetsReceived: {
      "los-angeles-chargers": [{ type: "pick", asset: "2010 2nd round pick (40th overall subsequently traded, Koa Misi) and 2011 3rd round pick (89th overall, Shareece Wright)" }],
      "seattle-seahawks": [{ type: "player", asset: "Charlie Whitehurst and 2010 2nd round pick (60th overall, Golden Tate)" }]
    }
  },
  "RAI-2010-0342": {
    lane: "grade_verdict_review",
    note: "Keep Jacksonville win while cleaning Raiders copy and perspective language.",
    teams: ["las-vegas-raiders", "jacksonville-jaguars"],
    verdict: "Jacksonville Jaguars Win",
    grades: { "las-vegas-raiders": "C", "jacksonville-jaguars": "B" },
    assetsReceived: {
      "las-vegas-raiders": [{ type: "pick", asset: "2010 4th round pick (108th overall, Jacoby Ford)" }],
      "jacksonville-jaguars": [{ type: "player", asset: "Kirk Morrison and 2010 5th round pick (153rd overall, Austen Lane)" }]
    }
  },
  "SEA-2010-04-24-0147": {
    lane: "grade_verdict_review",
    note: "Keep Titans win and remove duplicated Seattle asset fragments.",
    teams: ["seattle-seahawks", "tennessee-titans"],
    verdict: "Tennessee Titans Win",
    grades: { "seattle-seahawks": "C+", "tennessee-titans": "A-" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "Kevin Vickerson, LenDale White, 2010 4th round pick (111th overall, Walter Thurmond) and 2010 6th round pick (185th overall, Anthony McCoy)" }],
      "tennessee-titans": [{ type: "pick", asset: "2010 4th round pick (104th overall, Alterraun Verner) and 2010 6th round pick (176th overall, Rusty Smith)" }]
    }
  },
  "SEA-2010-08-18-0150": {
    lane: "grade_verdict_review",
    note: "Keep Seattle win based on Byron Maxwell value.",
    teams: ["seattle-seahawks", "detroit-lions"],
    verdict: "Seattle Seahawks Win",
    grades: { "seattle-seahawks": "B+", "detroit-lions": "C" },
    assetsReceived: {
      "seattle-seahawks": [{ type: "pick", asset: "2011 6th round pick (173rd overall, Byron Maxwell)" }],
      "detroit-lions": [{ type: "player", asset: "Lawrence Jackson" }]
    }
  },
  "MIN-2010-08-25-0231": {
    lane: "grade_verdict_review",
    note: "Resolve conflicting Miami/Minnesota perspectives back to an even player-for-player trade.",
    teams: ["miami-dolphins", "minnesota-vikings"],
    verdict: "Even Trade",
    grades: { "miami-dolphins": "C+", "minnesota-vikings": "C+" },
    assetsReceived: {
      "miami-dolphins": [{ type: "player", asset: "Benny Sapp" }],
      "minnesota-vikings": [{ type: "player", asset: "Greg Camarillo" }]
    }
  },

  "DEN-2009-08-17-0306": {
    lane: "structural_hold",
    note: "Collapse three duplicate perspectives to two canonical perspectives.",
    teams: ["denver-broncos", "new-england-patriots"],
    verdict: "Even Trade",
    grades: { "denver-broncos": "C", "new-england-patriots": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Le Kevin Smith and 2010 7th round pick (231st overall subsequently traded, Selvish Capers)" }],
      "new-england-patriots": [{ type: "pick", asset: "2010 5th round pick (158th overall subsequently traded, Matt Tennant)" }]
    }
  },
  "DEN-2009-08-25-0307": {
    lane: "structural_hold",
    note: "Collapse four conflicting/provisional perspectives and give Denver the slight useful-player edge.",
    teams: ["denver-broncos", "new-england-patriots"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "C+", "new-england-patriots": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Russ Hochstein" }],
      "new-england-patriots": [{ type: "pick", asset: "undisclosed 2009 draft pick" }]
    }
  },
  "DEN-2010-03-15-0308": {
    lane: "structural_hold",
    note: "Flip wrong top-level call; Cleveland clearly won the Brady Quinn/Peyton Hillis package.",
    teams: ["denver-broncos", "cleveland-browns"],
    verdict: "Cleveland Browns Win",
    grades: { "denver-broncos": "D", "cleveland-browns": "A" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Brady Quinn" }],
      "cleveland-browns": [{ type: "player", asset: "Peyton Hillis, 2011 6th round pick (168th overall subsequently traded, Demarcus Love) and 2012 5th round pick (160th overall, Ryan Miller)" }]
    }
  },
  "DEN-2010-04-14-0309": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Brandon Marshall gives Miami the edge while Denver retained strong compensation.",
    teams: ["denver-broncos", "miami-dolphins"],
    verdict: "Miami Dolphins Win",
    grades: { "denver-broncos": "B", "miami-dolphins": "A-" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2010 2nd round pick (43rd overall subsequently traded, Sergio Kindle) and 2011 2nd round pick (46th overall, Orlando Franklin)" }],
      "miami-dolphins": [{ type: "player", asset: "Brandon Marshall" }]
    }
  },
  "PHI-2010-0334": {
    lane: "structural_hold",
    note: "Normalize unknown-team placeholder without public partner language.",
    teams: ["philadelphia-eagles", "unknown-team"],
    verdict: "Even Trade",
    grades: { "philadelphia-eagles": "C", "unknown-team": "C" },
    assetsReceived: {
      "philadelphia-eagles": [{ type: "player", asset: "details not clearly specified in source record" }],
      "unknown-team": [{ type: "player", asset: "details not clearly specified in source record" }]
    }
  },
  "DEN-2010-04-22-0311": {
    lane: "structural_hold",
    note: "Collapse four perspectives and remove extra Denver asset contamination.",
    teams: ["denver-broncos", "san-francisco-49ers"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B", "san-francisco-49ers": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2010 1st round pick (13th overall subsequently traded, Brandon Graham) and 2010 4th round pick (113th overall subsequently traded, Aaron Hernandez)" }],
      "san-francisco-49ers": [{ type: "pick", asset: "2010 1st round pick (11th overall, Anthony Davis)" }]
    }
  },
  "DEN-2010-04-22-0312": {
    lane: "structural_hold",
    note: "Collapse four perspectives; keep Philadelphia win based on Brandon Graham value.",
    teams: ["denver-broncos", "philadelphia-eagles"],
    verdict: "Philadelphia Eagles Win",
    grades: { "denver-broncos": "C", "philadelphia-eagles": "A" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2010 1st round pick (24th overall subsequently traded, Dez Bryant), 2010 3rd round pick (70th overall subsequently traded, Ed Dickson) and 2010 3rd round pick (87th overall, Eric Decker)" }],
      "philadelphia-eagles": [{ type: "pick", asset: "2010 1st round pick (13th overall, Brandon Graham)" }]
    }
  },
  "DEN-2010-04-22-0314": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Baltimore's returned package beats the Tebow trade-up.",
    teams: ["denver-broncos", "baltimore-ravens"],
    verdict: "Baltimore Ravens Win",
    grades: { "denver-broncos": "D", "baltimore-ravens": "A" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2010 1st round pick (25th overall, Tim Tebow)" }],
      "baltimore-ravens": [{ type: "pick", asset: "2010 2nd round pick (43rd overall, Sergio Kindle), 2010 3rd round pick (70th overall, Ed Dickson) and 2010 4th round pick (114th overall, Dennis Pitta)" }]
    }
  },
  "CAR-2010-0043": {
    lane: "structural_hold",
    note: "Remove contaminated Cardinals/Saints perspectives and keep the Panthers/Jets trade only.",
    teams: ["carolina-panthers", "new-york-jets"],
    verdict: "Carolina Panthers Win",
    grades: { "carolina-panthers": "B-", "new-york-jets": "C+" },
    assetsReceived: {
      "carolina-panthers": [{ type: "pick", asset: "2010 4th round pick (124th overall, Eric Norwood) and 2010 6th round pick (198th overall, David Gettis)" }],
      "new-york-jets": [{ type: "pick", asset: "2010 4th round pick (112th overall, Joe McKnight)" }]
    }
  },
  "DEN-2010-04-24-0315": {
    lane: "structural_hold",
    note: "Collapse three perspectives and remove broken duplicate asset fragments.",
    teams: ["denver-broncos", "tampa-bay-buccaneers"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "tampa-bay-buccaneers": "C+" },
    assetsReceived: {
      "denver-broncos": [{ type: "pick", asset: "2010 7th round pick (225th overall, Syd'Quan Thompson) and 2010 7th round pick (232nd overall, Jammie Kirlew)" }],
      "tampa-bay-buccaneers": [{ type: "pick", asset: "2011 5th round pick (135th overall subsequently traded, Ricky Stanzi)" }]
    }
  },
  "RAM-2010-0458": {
    lane: "structural_hold",
    note: "Collapse three perspectives; Bobby Carpenter/Alex Barron remains a low-separation player swap.",
    teams: ["los-angeles-rams", "dallas-cowboys"],
    verdict: "Even Trade",
    grades: { "los-angeles-rams": "C", "dallas-cowboys": "C" },
    assetsReceived: {
      "los-angeles-rams": [{ type: "player", asset: "Bobby Carpenter" }],
      "dallas-cowboys": [{ type: "player", asset: "Alex Barron" }]
    }
  },
  "DEN-2010-07-31-0316": {
    lane: "structural_hold",
    note: "Collapse four perspectives; Denver gets the modest Joe Mays edge.",
    teams: ["denver-broncos", "philadelphia-eagles"],
    verdict: "Denver Broncos Win",
    grades: { "denver-broncos": "B-", "philadelphia-eagles": "C" },
    assetsReceived: {
      "denver-broncos": [{ type: "player", asset: "Joe Mays" }],
      "philadelphia-eagles": [{ type: "pick", asset: "J.J. Arrington and 2012 6th round pick (194th overall, Marvin McNutt) (conditional pick for Arrington not making roster)" }]
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
    .replace(/Los Angeles\/San Diego Chargers/g, "Los Angeles Chargers")
    .replace(/Houston Oilers\/Tennessee Titans/g, "Tennessee Titans")
    .replace(/Cleveland Browns's/g, "Cleveland Browns'")
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
      summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 013 review keeps this as an even trade because the available record does not create a reliable separation.`),
      partnerSummary: clean(`The grade profile is ${an} ${ag}, ${bn} ${bg}. Neither return separates enough for a win/loss verdict.`),
      analysis: clean(`The final TradeVerdicts outcome is Even Trade after comparing player impact, pick value, roster usefulness, and retained asset value.`)
    };
  }

  const wn = name(winner);
  return {
    summary: clean(`${an} received ${aa}. ${bn} received ${ba}. The final Batch 013 review favors ${wn} because that return produced stronger practical football value.`),
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
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-final-20-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Final 20 ${apply ? "Apply" : "Dry Run"} v1\n\n`;
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
