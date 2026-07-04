const fs = require("fs");
const path = require("path");

const applyMode = process.argv.includes("--apply");
const DATA_PATH = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(process.cwd(), "reports", "quality");
const OUT_TXT = path.join(REPORT_DIR, `nfl-bottom-batch-003-final-13-${applyMode ? "apply" : "dry-run"}-v1.txt`);
const OUT_JSON = path.join(REPORT_DIR, `nfl-bottom-batch-003-final-13-${applyMode ? "apply" : "dry-run"}-v1.json`);
const QUARANTINE_JSON = path.join(REPORT_DIR, "nfl-bottom-batch-003-quarantined-records-v1.json");

const TEAM_NAMES = {
  "philadelphia-eagles":"Philadelphia Eagles","houston-texans":"Houston Texans","minnesota-vikings":"Minnesota Vikings",
  "cleveland-browns":"Cleveland Browns","los-angeles-rams":"Los Angeles Rams","pittsburgh-steelers":"Pittsburgh Steelers",
  "denver-broncos":"Denver Broncos","new-orleans-saints":"New Orleans Saints","san-francisco-49ers":"San Francisco 49ers",
  "jacksonville-jaguars":"Jacksonville Jaguars","tennessee-titans":"Tennessee Titans","new-york-jets":"New York Jets"
};

function name(k){return TEAM_NAMES[k]||k.split("-").map(x=>x[0].toUpperCase()+x.slice(1)).join(" ");}
function idOf(t){return String(t.id||t.tradeId||t.trade_id||"");}
function clone(x){return JSON.parse(JSON.stringify(x));}
function assetText(a){return typeof a==="string"?a:String(a.asset||a.name||a.value||a.label||a);}
function assetsFor(t,k){const arr=t.assetsReceived&&t.assetsReceived[k]; return Array.isArray(arr)&&arr.length ? arr.map(assetText).join("; ") : "undisclosed consideration";}
function winner(verdict){const v=String(verdict||""); return /^Even Trade$/i.test(v)?"":v.replace(/\s+Win$/i,"");}

function textFor(t, primary, other){
  const p=name(primary), o=name(other), pa=assetsFor(t,primary), oa=assetsFor(t,other), w=winner(t.verdict);
  if(!w){
    return {
      primarySummary: `${p} acquired ${pa} from ${o} for ${oa}. The recorded return stays close enough for an Even Trade verdict.`,
      partnerSummary: `${o} received ${oa} and gave up ${pa}. The exchange remains balanced after the recorded assets are weighed.`,
      analysis: `This remains an Even Trade because the recorded assets do not create enough separation for either side.`
    };
  }
  return {
    primarySummary: `${p} acquired ${pa} from ${o} for ${oa}. The stronger recorded return sits with ${w}, matching the ${t.verdict} verdict.`,
    partnerSummary: `${o} received ${oa} and gave up ${pa}. The overall value edge goes to ${w}.`,
    analysis: `${w} gets the edge because the recorded return is stronger than what it gave up.`
  };
}

function perspective(t, sourceTeam, sourceTradeId, sourceRow, primaryTeam, partnerTeam){
  const txt=textFor(t, primaryTeam, partnerTeam);
  return {
    sourceTeam, sourceTradeId, sourceRow, primaryTeam, partnerTeam,
    primarySummary: txt.primarySummary,
    partnerSummary: txt.partnerSummary,
    primaryGrade: t.grades[primaryTeam] || "",
    partnerGrade: t.grades[partnerTeam] || "",
    verdict: t.verdict
  };
}

const specs = {
  "PHI-2023-0445": {
    verdict:"Even Trade", grades:{"philadelphia-eagles":"C+","houston-texans":"C+"},
    teamKeys:["philadelphia-eagles","houston-texans"],
    summary:"Philadelphia acquired 2023 4th round pick (105th overall, Kelee Ringo) and 2023 6th round pick (191st overall subsequently traded, Trey Palmer) from Houston for 2024 3rd round pick (86th overall subsequently traded, Dominick Puni), 2023 7th round pick (230th overall subsequently traded, Nick Broeker) and 2023 7th round pick (248th overall, Brandon Hill). The bundled asset stack stays close enough for an Even Trade verdict.",
    partnerSummary:"Houston received 2024 3rd round pick (86th overall subsequently traded, Dominick Puni), 2023 7th round pick (230th overall subsequently traded, Nick Broeker) and 2023 7th round pick (248th overall, Brandon Hill) while sending Kelee Ringo's slot and the later sixth-round slot. The value remains balanced.",
    analysis:"The combined Philadelphia-Houston pick exchange stays in Even Trade territory because both sides received usable draft value without decisive separation.",
    perspectives:[["philadelphia-eagles","PHI-2023-0445",446,"philadelphia-eagles","houston-texans"],["houston-texans","HOU-2023-0097",98,"houston-texans","philadelphia-eagles"]],
    decision:"Collapse four mixed PHI/HOU perspectives into two clean perspectives; preserve Even C+/C+."
  },
  "MIN-2023-05-16-0306": {
    verdict:"Cleveland Browns Win", grades:{"minnesota-vikings":"C+","cleveland-browns":"B+"},
    assetsReceived:{"minnesota-vikings":[{type:"pick",asset:"2025 5th round pick (139th overall, Tyrion Ingram-Dawkins)"},{type:"pick",asset:"2024 5th round pick (157th overall subsequently traded, Chau Smith-Wade)"}],"cleveland-browns":[{type:"player",asset:"Za'Darius Smith"},{type:"pick",asset:"2025 6th round pick (200th overall subsequently traded, Rayuan Lane)"},{type:"pick",asset:"2025 7th round pick (240th overall subsequently traded, Kaden Prather)"}]},
    teamKeys:["minnesota-vikings","cleveland-browns"],
    perspectives:[["minnesota-vikings","MIN-2023-0299",300,"minnesota-vikings","cleveland-browns"],["cleveland-browns","CLE-2023-0454",452,"cleveland-browns","minnesota-vikings"]],
    decision:"Flip stale Even B/B to Cleveland Browns Win B+/C+."
  },
  "RAM-2023-0532": {
    verdict:"Los Angeles Rams Win", grades:{"los-angeles-rams":"A","pittsburgh-steelers":"C-"},
    assetsReceived:{"los-angeles-rams":[{type:"player",asset:"Kevin Dotson"},{type:"pick",asset:"2024 5th round pick (155th overall subsequently traded, Jeremiah Trotter)"},{type:"pick",asset:"2025 6th round pick (195th overall subsequently traded, Luke Newman)"}],"pittsburgh-steelers":[{type:"pick",asset:"2024 4th round pick (120th overall subsequently traded, Jaylen Wright)"},{type:"pick",asset:"2025 5th round pick (162nd overall subsequently traded, Francisco Mauigoa)"}]},
    teamKeys:["los-angeles-rams","pittsburgh-steelers"],
    perspectives:[["los-angeles-rams","RAM-2023-0532",533,"los-angeles-rams","pittsburgh-steelers"],["pittsburgh-steelers","PIT-2023-0381",382,"pittsburgh-steelers","los-angeles-rams"]],
    decision:"Flip Steelers Win to Rams Win A/C-."
  },
  "DEN-2023-08-29-0386": {
    verdict:"Denver Broncos Win", grades:{"denver-broncos":"B","new-orleans-saints":"C"},
    teamKeys:["denver-broncos","new-orleans-saints"],
    perspectives:[["denver-broncos","DEN-2023-08-29-0386",376,"denver-broncos","new-orleans-saints"],["new-orleans-saints","NO-2023-0334",335,"new-orleans-saints","denver-broncos"]],
    decision:"Flip Saints Win to Broncos Win B/C."
  },
  "DEN-2023-08-29-0387": {
    verdict:"Denver Broncos Win", grades:{"denver-broncos":"C+","philadelphia-eagles":"C"},
    assetsReceived:{"denver-broncos":[{type:"pick",asset:"2025 6th round pick (208th overall subsequently traded, Jimmy Horn)"}],"philadelphia-eagles":[{type:"player",asset:"Albert Okwuegbunam"},{type:"pick",asset:"2025 7th round pick (236th overall subsequently traded, LeQuint Allen)"}]},
    teamKeys:["denver-broncos","philadelphia-eagles"],
    perspectives:[["denver-broncos","DEN-2023-08-29-0387",377,"denver-broncos","philadelphia-eagles"],["philadelphia-eagles","PHI-2023-0449",450,"philadelphia-eagles","denver-broncos"]],
    decision:"Remove duplicate Denver perspective; preserve Broncos Win C+/C."
  },
  "DEN-2023-10-06-0388": {
    verdict:"Denver Broncos Win", grades:{"denver-broncos":"C+","san-francisco-49ers":"C-"},
    assetsReceived:{"denver-broncos":[{type:"pick",asset:"2024 6th round pick (207th overall subsequently traded, Michael Jerrell)"}],"san-francisco-49ers":[{type:"player",asset:"Randy Gregory"},{type:"pick",asset:"2024 7th round pick (232nd overall subsequently traded, Levi Drake Rodriguez)"}]},
    teamKeys:["denver-broncos","san-francisco-49ers"],
    perspectives:[["denver-broncos","DEN-2023-10-06-0388",378,"denver-broncos","san-francisco-49ers"],["san-francisco-49ers","SF-2023-0417",418,"san-francisco-49ers","denver-broncos"]],
    decision:"Flip Even C/C to Broncos Win C+/C-."
  },
  "MIN-2023-10-31-0310": {
    verdict:"Jacksonville Jaguars Win", grades:{"minnesota-vikings":"C-","jacksonville-jaguars":"A-"},
    teamKeys:["minnesota-vikings","jacksonville-jaguars"],
    perspectives:[["minnesota-vikings","MIN-2023-0303",304,"minnesota-vikings","jacksonville-jaguars"],["jacksonville-jaguars","JAX-2023-0101",102,"jacksonville-jaguars","minnesota-vikings"]],
    decision:"Flip Even B/B to Jaguars Win A-/C-."
  },
  "DEN-2024-03-13-0389": {
    verdict:"Cleveland Browns Win", grades:{"denver-broncos":"C","cleveland-browns":"B+"},
    teamKeys:["denver-broncos","cleveland-browns"],
    perspectives:[["denver-broncos","DEN-2024-03-13-0389",379,"denver-broncos","cleveland-browns"],["cleveland-browns","CLE-2024-0459",457,"cleveland-browns","denver-broncos"]],
    decision:"Flip Broncos Win to Browns Win B+/C."
  },
  "MIN-2024-0304": {
    verdict:"Minnesota Vikings Win", grades:{"minnesota-vikings":"B+","houston-texans":"C"},
    teamKeys:["minnesota-vikings","houston-texans"],
    perspectives:[["minnesota-vikings","MIN-2024-0304",305,"minnesota-vikings","houston-texans"],["houston-texans","HOU-2024-0105",106,"houston-texans","minnesota-vikings"]],
    decision:"Preserve Vikings Win B+/C; replace stale Even copy and truncated Houston text."
  },
  "CLE-2024-0460": {
    verdict:"Cleveland Browns Win", grades:{"cleveland-browns":"C+","tennessee-titans":"C"},
    teamKeys:["cleveland-browns","tennessee-titans"],
    perspectives:[["cleveland-browns","CLE-2024-0460",458,"cleveland-browns","tennessee-titans"],["tennessee-titans","TEN-2024-0265",266,"tennessee-titans","cleveland-browns"]],
    decision:"Flip Even C/C to Browns Win C+/C."
  },
  "DEN-2024-04-22-0390": {
    verdict:"New York Jets Win", grades:{"denver-broncos":"C","new-york-jets":"C+"},
    assetsReceived:{"denver-broncos":[{type:"player",asset:"Zach Wilson"},{type:"pick",asset:"2024 7th round pick (256th overall, Nick Gargiulo)"}],"new-york-jets":[{type:"pick",asset:"2024 6th round pick (203rd overall subsequently traded, Will Reichard)"}]},
    teamKeys:["denver-broncos","new-york-jets"],
    perspectives:[["denver-broncos","DEN-2024-04-22-0390",380,"denver-broncos","new-york-jets"],["new-york-jets","NYJ-2024-0303",304,"new-york-jets","denver-broncos"]],
    decision:"Remove duplicate Denver perspective; preserve Jets Win C+/C."
  },
  "DEN-2024-04-27-0392": {
    verdict:"Denver Broncos Win", grades:{"denver-broncos":"A-","new-york-jets":"D+"},
    teamKeys:["denver-broncos","new-york-jets"],
    perspectives:[["denver-broncos","DEN-2024-04-27-0392",382,"denver-broncos","new-york-jets"],["new-york-jets","NYJ-2024-0310",311,"new-york-jets","denver-broncos"]],
    decision:"Remove duplicate Denver perspective; preserve Broncos Win A-/D+."
  }
};

const quarantineIds = {
  "PHI-2024-0456": "Unknown-team/undisclosed-partner placeholder with malformed trade text; remove from live data and save to quarantine report."
};

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const trades = Array.isArray(data) ? data : data.trades;
if(!Array.isArray(trades)) throw new Error("Could not find trades array.");
const byId = new Map(trades.map((t,i)=>[idOf(t),{t,i}]));

const records = [];
const quarantine = [];
let blocked = 0;

function beforeAfter(rec, label, before, after){
  const b=JSON.stringify(before), a=JSON.stringify(after);
  if(b!==a) rec.changes.push({label,before:b.slice(0,500),after:a.slice(0,500)});
}

for(const [id,s] of Object.entries(specs)){
  const found=byId.get(id);
  const rec={id, status:applyMode?"applied":"would_apply", decision:s.decision, index:found?found.i:null, changes:[], blockers:[]};
  if(!found){rec.status="blocked"; rec.blockers.push("not found"); blocked++; records.push(rec); continue;}
  const t=found.t, before=clone(t);
  if(s.assetsReceived) t.assetsReceived=clone(s.assetsReceived);
  t.verdict=s.verdict; t.grades=clone(s.grades);
  const keys=s.teamKeys;
  const top=textFor(t,keys[0],keys[1]);
  t.summary=s.summary||top.primarySummary;
  t.partnerSummary=s.partnerSummary||top.partnerSummary;
  t.analysis=s.analysis||top.analysis;
  t.perspectives=s.perspectives.map(p=>perspective(t,p[0],p[1],p[2],p[3],p[4]));
  beforeAfter(rec,"verdict",before.verdict,t.verdict);
  beforeAfter(rec,"grades",before.grades,t.grades);
  beforeAfter(rec,"assetsReceived",before.assetsReceived,t.assetsReceived);
  beforeAfter(rec,"summary",before.summary,t.summary);
  beforeAfter(rec,"partnerSummary",before.partnerSummary,t.partnerSummary);
  beforeAfter(rec,"analysis",before.analysis,t.analysis);
  beforeAfter(rec,"perspectivesCount",Array.isArray(before.perspectives)?before.perspectives.length:0,Array.isArray(t.perspectives)?t.perspectives.length:0);
  if(!applyMode) Object.assign(t,before);
  records.push(rec);
}

for(const [id,reason] of Object.entries(quarantineIds)){
  const found=byId.get(id);
  const rec={id,status:applyMode?"applied":"would_apply",decision:reason,index:found?found.i:null,changes:[{label:"quarantine",before:"present in live data",after:"removed from live data"}],blockers:[]};
  if(!found){rec.status="blocked"; rec.blockers.push("not found"); blocked++; records.push(rec); continue;}
  quarantine.push({id,index:found.i,slug:found.t.slug,reason,trade:found.t});
  records.push(rec);
}

let backupPath=null;
if(applyMode && blocked===0){
  backupPath=path.join(path.dirname(DATA_PATH),`trades.backup-before-bottom-batch-003-final-13-v1-${new Date().toISOString().replace(/[:.]/g,"-")}.json`);
  fs.copyFileSync(DATA_PATH,backupPath);
  if(quarantine.length) fs.writeFileSync(QUARANTINE_JSON,JSON.stringify({generatedAt:new Date().toISOString(),bottomBatchNumber:3,records:quarantine},null,2)+"\n");
  const removeIds=new Set(quarantine.map(q=>q.id));
  const filtered=trades.filter(t=>!removeIds.has(idOf(t)));
  if(Array.isArray(data)) fs.writeFileSync(DATA_PATH,JSON.stringify(filtered,null,2)+"\n");
  else { data.trades=filtered; fs.writeFileSync(DATA_PATH,JSON.stringify(data,null,2)+"\n"); }
}

const counts={}; records.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
const flips=[
"MIN-2023-05-16-0306: Even B/B -> Cleveland Browns Win, Browns B+ / Vikings C+",
"RAM-2023-0532: Pittsburgh Steelers Win -> Los Angeles Rams Win, Rams A / Steelers C-",
"DEN-2023-08-29-0386: New Orleans Saints Win -> Denver Broncos Win, Broncos B / Saints C",
"DEN-2023-10-06-0388: Even C/C -> Denver Broncos Win, Broncos C+ / 49ers C-",
"MIN-2023-10-31-0310: Even B/B -> Jacksonville Jaguars Win, Jaguars A- / Vikings C-",
"DEN-2024-03-13-0389: Denver Broncos Win -> Cleveland Browns Win, Browns B+ / Broncos C",
"CLE-2024-0460: Even C/C -> Cleveland Browns Win, Browns C+ / Titans C"
];

const report={generatedAt:new Date().toISOString(),mode:applyMode?"apply":"dry-run",recordsTargeted:records.length,blockedRecords:blocked,quarantineRemovals:quarantine.length,trueGradeVerdictFlips:flips,backupPath,statusCounts:counts,records};
fs.writeFileSync(OUT_JSON,JSON.stringify(report,null,2)+"\n");
fs.writeFileSync(OUT_TXT,`# NFL Bottom Batch 003 Final 13 ${applyMode?"Apply":"Dry Run"} v1

Generated: ${report.generatedAt}
Mode: ${report.mode}

## Summary
- Records targeted: ${records.length}
- Blocked records: ${blocked}
- Quarantine removals: ${quarantine.length}
${backupPath?`- Backup created: ${backupPath}`:"- Backup created: no, dry-run only"}

## True Grade/Verdict Flips
${flips.map(x=>`- ${x}`).join("\n")}

## Status Counts
${Object.entries(counts).map(([k,v])=>`- ${k}: ${v}`).join("\n")}

## Records
${records.map(r=>`## ${r.id}
- Status: ${r.status}
- Index: ${r.index}
- Decision: ${r.decision}
- Changes: ${r.changes.map(c=>c.label).join(", ") || "none"}
${r.blockers.length?`- Blockers: ${r.blockers.join(" | ")}`:""}
`).join("\n")}
`);
console.log("");
console.log(`NFL Bottom Batch 003 final 13 ${applyMode ? "APPLY" : "DRY RUN"} complete.`);
console.log(`Records targeted: ${records.length}`);
console.log(`Blocked records: ${blocked}`);
console.log(`Quarantine removals: ${quarantine.length}`);
console.log("Status counts:");
Object.entries(counts).forEach(([k,v])=>console.log(`- ${k}: ${v}`));
console.log("");
console.log(`Open: reports\\quality\\nfl-bottom-batch-003-final-13-${applyMode ? "apply" : "dry-run"}-v1.txt`);
