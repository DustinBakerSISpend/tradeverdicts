import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "019";
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-final-26-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-final-26-${apply ? "apply" : "dry-run"}-v1.json`;

const text = fs.readFileSync(dataPath, "utf8");
const data = JSON.parse(text);
const trades = Array.isArray(data) ? data : data.trades;

const names = {
  "baltimore-ravens":"Baltimore Ravens","buffalo-bills":"Buffalo Bills","carolina-panthers":"Carolina Panthers",
  "chicago-bears":"Chicago Bears","cleveland-browns":"Cleveland Browns","dallas-cowboys":"Dallas Cowboys",
  "denver-broncos":"Denver Broncos","detroit-lions":"Detroit Lions","green-bay-packers":"Green Bay Packers",
  "indianapolis-colts":"Indianapolis Colts","jacksonville-jaguars":"Jacksonville Jaguars","las-vegas-raiders":"Las Vegas Raiders",
  "los-angeles-rams":"Los Angeles Rams","miami-dolphins":"Miami Dolphins","minnesota-vikings":"Minnesota Vikings",
  "new-york-jets":"New York Jets","pittsburgh-steelers":"Pittsburgh Steelers","san-francisco-49ers":"San Francisco 49ers",
  "seattle-seahawks":"Seattle Seahawks","washington-commanders":"Washington Commanders"
};

const rows = `
DEN-1998-08-19-0252|denver-broncos|dallas-cowboys|Denver Broncos Win|B|C-|1999 5th round pick (158th overall, David Bowens)|Kendall Watkins
DEN-1998-08-25-0253|san-francisco-49ers|denver-broncos|San Francisco 49ers Win|C+|C|Steve Gordon and David Richie|past considerations
DEN-1998-08-30-0254|dallas-cowboys|denver-broncos|Dallas Cowboys Win|C+|C-|Patrick Jeffers|past considerations
DEN-1998-08-30-0255|green-bay-packers|denver-broncos|Green Bay Packers Win|A|D|Seth Joyner|past considerations
PIT-1998-0323|pittsburgh-steelers|indianapolis-colts|Pittsburgh Steelers Win|C+|C|1999 5th round pick (136th overall, Jerame Tuman)|Steve Conley
BUF-1999-0251|buffalo-bills|cleveland-browns|Even Trade|C|C|past considerations|Chris Spielman
DEN-1999-03-02-0256|denver-broncos|carolina-panthers|Denver Broncos Win|B|F|1999 3rd round pick (67th overall, Chris Watson)|Jeff Lewis
SEA-1999-03-19-0101|seattle-seahawks|new-york-jets|Even Trade|C|C|Glenn Foley|1999 7th round pick (223rd overall, Ryan Young)
PIT-1999-0324|pittsburgh-steelers|new-york-jets|Pittsburgh Steelers Win|C+|C|Alex Van Dyke|1999 6th round pick (183rd overall, Marc Megna)
MIA-1999-0173|miami-dolphins|detroit-lions|Miami Dolphins Win|A-|C-|1999 2nd round pick (39th overall, J.J. Johnson), 1999 3rd round pick (72nd overall, Grey Ruegamer) and 1999 5th round pick (142nd overall, Bryan Jones)|1999 1st round pick (27th overall, Aaron Gibson)
WAS-1999-0354|washington-commanders|chicago-bears|Washington Commanders Win|A+|F|1999 1st round pick (7th overall, Champ Bailey)|1999 1st round pick (12th overall, Cade McNown), 1999 3rd round pick (71st overall, D'Wayne Bates), 1999 4th round pick (106th overall, Warrick Holdman), 1999 5th round pick (143rd overall, Jerry Wisne) and 2000 3rd round pick (87th overall, Dustin Lyman)
CLE-1999-0313|chicago-bears|cleveland-browns|Chicago Bears Win|B+|C-|1999 6th round pick (184th overall, Rashard Cook) and 1999 7th round pick (221st overall, Sulecio Sanford)|1999 6th round pick (174th overall, Marcus Spriggs)
DEN-1999-04-18-0257|denver-broncos|washington-commanders|Even Trade|C|C|1999 6th round pick (179th overall, Desmond Clark) and 1999 7th round pick (218th overall, Billy Miller)|1999 5th round pick (165th overall, Derek Smith)
MIN-1999-0189|minnesota-vikings|baltimore-ravens|Minnesota Vikings Win|B-|C|1999 6th round pick (185th overall, Talance Sawyer)|Everett Lindsay
RAI-1999-0299|las-vegas-raiders|pittsburgh-steelers|Las Vegas Raiders Win|B+|C|1999 5th round pick (146th overall, Eric Barton) and 1999 5th round pick (163rd overall subsequently traded, Craig Heimburger)|2000 3rd round pick (77th overall, Hank Poteat)
SEA-1999-06-25-0105|seattle-seahawks|dallas-cowboys|Seattle Seahawks Win|A-|D+|2000 3rd round pick (80th overall, Darrell Jackson)|James McKnight
PIT-1999-0328|pittsburgh-steelers|washington-commanders|Pittsburgh Steelers Win|C+|C|Shar Pourdanesh|2000 7th round pick (216th overall, Delbert Cowsette)
RAM-1999-0412|green-bay-packers|los-angeles-rams|Green Bay Packers Win|C+|C|Aaron Laing|undisclosed draft pick
DEN-1999-08-24-0258|washington-commanders|denver-broncos|Washington Commanders Win|C+|C|Tito Paul|2000 7th round pick (231st overall subsequently traded, Clifton Black) and 2001 7th round pick (215th overall subsequently traded, Corey Hall)
SEA-1999-08-31-0106|seattle-seahawks|green-bay-packers|Even Trade|C|C|Derrick Mayes|2000 7th round pick (229th overall, Ron Moore)
SEA-1999-09-05-0107|seattle-seahawks|jacksonville-jaguars|Seattle Seahawks Win|B|C|Cordell Taylor|undisclosed 2001 draft pick
DEN-1999-09-21-0259|denver-broncos|miami-dolphins|Even Trade|C|C|John Avery|Marcus Nash
DEN-2000-02-24-0260|denver-broncos|green-bay-packers|Even Trade|C|C|2001 7th round pick (219th overall subsequently traded, Kynan Forney)|David Bowens
DEN-2000-03-07-0261|los-angeles-rams|denver-broncos|Los Angeles Rams Win|B|C+|2000 5th round pick (139th overall, Brian Young) and 2001 5th round pick (154th overall subsequently traded, Darnerien McCants)|Billy Jenkins
DEN-2000-04-04-0262|denver-broncos|los-angeles-rams|Denver Broncos Win|A+|D|2000 6th round pick (189th overall, Mike Anderson)|Derek Loville
DEN-2000-04-13-0263|denver-broncos|baltimore-ravens|Denver Broncos Win|A|D|2000 1st round pick (15th overall, Deltha O'Neal) and 2000 2nd round pick (45th overall, Kenoy Kennedy)|2000 1st round pick (10th overall, Travis Taylor)
`.trim().split(/\r?\n/).map(line => {
  const [id, a, b, verdict, ga, gb, aa, ba] = line.split("|");
  return { id, a, b, verdict, ga, gb, aa, ba };
});

function nm(t) { return names[t] || t; }
function typ(x) {
  if (/pick/i.test(x)) return "pick";
  if (/considerations|undisclosed/i.test(x)) return "other";
  return "player";
}
function winner(r) {
  if (r.verdict === "Even Trade") return null;
  if (r.verdict.includes(nm(r.a))) return r.a;
  if (r.verdict.includes(nm(r.b))) return r.b;
  return r.a;
}
function makeTradeCopy(r) {
  const A = nm(r.a), B = nm(r.b), w = winner(r);
  if (!w) {
    return {
      summary: `${A} received ${r.aa}. ${B} received ${r.ba}. The final Batch 019 review keeps this as an even trade because neither return separates enough for a win/loss label.`,
      partnerSummary: `The grade profile is ${A} ${r.ga}, ${B} ${r.gb}. The visible verdict is Even Trade.`,
      analysis: `The final TradeVerdicts outcome is Even Trade after comparing player impact, pick value, roster usefulness, and retained value from the exchange.`
    };
  }
  return {
    summary: `${A} received ${r.aa}. ${B} received ${r.ba}. The final Batch 019 review favors ${nm(w)} because that return produced stronger practical football value.`,
    partnerSummary: `The grade profile is ${A} ${r.ga}, ${B} ${r.gb}. The visible verdict is ${r.verdict}.`,
    analysis: `${nm(w)} earns the stronger review after comparing actual player outcomes, draft-slot cost, roster usefulness, and retained value from the exchange. The final TradeVerdicts outcome is ${r.verdict}.`
  };
}
function makePerspectives(r) {
  return [
    {
      primaryTeam: r.a,
      partnerTeam: r.b,
      primaryGrade: r.ga,
      partnerGrade: r.gb,
      verdict: r.verdict,
      publishStatus: "ready",
      primarySummary: `${nm(r.a)} received ${r.aa}. This side grades ${r.ga}, and the visible verdict is ${r.verdict}.`,
      partnerSummary: `${nm(r.b)} received ${r.ba}. That return grades ${r.gb}, and the visible verdict is ${r.verdict}.`
    },
    {
      primaryTeam: r.b,
      partnerTeam: r.a,
      primaryGrade: r.gb,
      partnerGrade: r.ga,
      verdict: r.verdict,
      publishStatus: "ready",
      primarySummary: `${nm(r.b)} received ${r.ba}. This side grades ${r.gb}, and the visible verdict is ${r.verdict}.`,
      partnerSummary: `${nm(r.a)} received ${r.aa}. That return grades ${r.ga}, and the visible verdict is ${r.verdict}.`
    }
  ];
}

const badPublic = /Partner-side|\bpartner side\b|\bpartner grade\b|\bPartner Win\b|\bPartner Even\b|\bpartner outcome\b|\btrade partner\b|\bpartner\b|same strict-hindsight value curve|same hindsight\/value standard|same hindsight value curve|same football-value curve|same value curve|hindsight value curve|hindsight curve|Strict hindsight|strict hindsight|rebalanced curve|receives the edge|received the edge|Unknown\/undisclosed partner|Not clearly specified in source|Bears's|Jets's|Falcons's|Vikings's|Cardinals's|Patriots's|Raiders's|Titans's|Eagles's|Seahawks's|Chiefs's|Dolphins's|Rams's|Colts's|Broncos's|Ravens's|49ers's|Browns's|Bengals's|Bills's/i;

const results = [];
const flips = [];
const collapses = [];
let blocked = 0, changed = 0;

for (const r of rows) {
  const t = trades.find(x => x.id === r.id);
  if (!t) {
    blocked++;
    results.push({ id: r.id, status: "blocked", reason: "missing trade" });
    continue;
  }

  const beforeVerdict = t.verdict;
  const beforeGrades = JSON.stringify(t.grades || {});
  const beforeCount = Array.isArray(t.perspectives) ? t.perspectives.length : 0;
  const c = makeTradeCopy(r);

  const next = {
    ...t,
    teams: [r.a, r.b],
    sourceTeams: [r.a, r.b],
    verdict: r.verdict,
    grades: { [r.a]: r.ga, [r.b]: r.gb },
    assetsReceived: {
      [r.a]: [{ type: typ(r.aa), asset: r.aa }],
      [r.b]: [{ type: typ(r.ba), asset: r.ba }]
    },
    summary: c.summary,
    partnerSummary: c.partnerSummary,
    analysis: c.analysis,
    perspectives: makePerspectives(r)
  };

  const blob = [next.summary, next.partnerSummary, next.analysis, ...next.perspectives.flatMap(p => [p.primarySummary, p.partnerSummary])].join("\n");
  if (badPublic.test(blob)) {
    blocked++;
    results.push({ id: r.id, status: "blocked", reason: "bad public artifact remains" });
    continue;
  }

  if (JSON.stringify(t) !== JSON.stringify(next)) {
    changed++;
    if (beforeVerdict !== next.verdict || beforeGrades !== JSON.stringify(next.grades)) {
      flips.push(`${r.id}: ${beforeVerdict} ${beforeGrades} -> ${next.verdict} ${JSON.stringify(next.grades)}`);
    }
    if (beforeCount !== 2) collapses.push(`${r.id}: ${beforeCount} perspectives -> 2 perspectives`);
    if (apply) Object.assign(t, next);
    results.push({ id: r.id, status: apply ? "applied" : "would_apply" });
  } else {
    results.push({ id: r.id, status: "no_change" });
  }
}

let backup = "";
if (apply && changed) {
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-final-26-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, text);
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let report = `# NFL Bottom Batch ${label} Final 26 ${apply ? "Apply" : "Dry Run"} v1\n\n`;
report += `Generated: ${new Date().toISOString()}\nMode: ${apply ? "apply" : "dry-run"}\n\n`;
report += `## Summary\n- Patch records targeted: ${rows.length}\n- Blocked records: ${blocked}\n- Changed records: ${changed}\n`;
if (backup) report += `- Backup created: ${backup}\n`;
report += `\n## Status Counts\n`;
for (const [k,v] of Object.entries(counts)) report += `- ${k}: ${v}\n`;
report += `\n## Visible Top-Level Grade/Verdict Changes\n${flips.length ? flips.map(x => `- ${x}`).join("\n") : "- None"}\n`;
report += `\n## Structural Perspective Collapses\n${collapses.length ? collapses.map(x => `- ${x}`).join("\n") : "- None"}\n`;
report += `\n## Records\n${results.map(r => `- ${r.id}: ${r.status}${r.reason ? " — " + r.reason : ""}`).join("\n")}\n`;

fs.writeFileSync(outJson, JSON.stringify({ mode: apply ? "apply" : "dry-run", blocked, changed, counts, flips, collapses, results }, null, 2) + "\n");
fs.writeFileSync(outTxt, report);
console.log(report);
console.log(`Wrote: ${outTxt}`);
