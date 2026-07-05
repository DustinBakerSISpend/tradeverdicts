import fs from "node:fs";

const apply = process.argv.includes("--apply");
const label = "010";

const previewPath = `reports/quality/nfl-bottom-batch-${label}-repair-preview-v1.json`;
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-partner-language-${apply ? "apply" : "dry-run"}-v1.txt`;

const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const teamNames = {
  "arizona-cardinals": "Arizona Cardinals",
  "atlanta-falcons": "Atlanta Falcons",
  "baltimore-ravens": "Baltimore Ravens",
  "buffalo-bills": "Buffalo Bills",
  "carolina-panthers": "Carolina Panthers",
  "chicago-bears": "Chicago Bears",
  "cincinnati-bengals": "Cincinnati Bengals",
  "cleveland-browns": "Cleveland Browns",
  "dallas-cowboys": "Dallas Cowboys",
  "denver-broncos": "Denver Broncos",
  "detroit-lions": "Detroit Lions",
  "houston-texans": "Houston Texans",
  "indianapolis-colts": "Indianapolis Colts",
  "jacksonville-jaguars": "Jacksonville Jaguars",
  "kansas-city-chiefs": "Kansas City Chiefs",
  "las-vegas-raiders": "Las Vegas Raiders",
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
  "washington-commanders": "Washington Commanders"
};

function walk(x, out = []) {
  if (Array.isArray(x)) {
    for (const item of x) walk(item, out);
    return out;
  }
  if (!x || typeof x !== "object") return out;
  if (x.id && x.lane === "copy_repair_candidate") out.push(x);
  for (const v of Object.values(x)) walk(v, out);
  return out;
}

function name(slug) {
  return teamNames[slug] || String(slug || "").split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/Percy Havin/g, "Percy Harvin")
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

function assetsFor(trade, team) {
  const items = trade.assetsReceived?.[team];
  if (!Array.isArray(items) || !items.length) return "the recorded return";
  return clean(items.map(x => x.asset || x.name || x.player || x.pick || "").filter(Boolean).join("; "));
}

function makePerspectiveCopy(trade, p) {
  const primaryTeam = p.primaryTeam;
  const otherTeam = p.partnerTeam;
  const primaryName = name(primaryTeam);
  const otherName = name(otherTeam);
  const primaryAssets = assetsFor(trade, primaryTeam);
  const otherAssets = assetsFor(trade, otherTeam);
  const primaryGrade = p.primaryGrade || trade.grades?.[primaryTeam] || "C";
  const otherGrade = p.partnerGrade || trade.grades?.[otherTeam] || "C";
  const verdict = clean(trade.verdict);

  return {
    ...p,
    verdict,
    publishStatus: "ready",
    primarySummary: clean(`${primaryName} received ${primaryAssets}. This view grades ${primaryGrade}, with the final verdict recorded as ${verdict}.`),
    partnerSummary: clean(`${otherName} received ${otherAssets}. That return grades ${otherGrade}, with the final verdict recorded as ${verdict}.`)
  };
}

const candidates = walk(preview);
let blocked = 0;
let changed = 0;
const rows = [];

for (const c of candidates) {
  const trade = trades.find(t => t.id === c.id);
  if (!trade) {
    blocked++;
    rows.push({ id: c.id, status: "blocked", reason: "missing trade" });
    continue;
  }

  if (!c.proposedCopy?.summary || !c.proposedCopy?.partnerSummary || !c.proposedCopy?.analysis) {
    blocked++;
    rows.push({ id: c.id, status: "blocked", reason: "missing proposedCopy" });
    continue;
  }

  if (!Array.isArray(trade.perspectives) || trade.perspectives.length !== 2) {
    blocked++;
    rows.push({ id: c.id, status: "blocked", reason: `expected 2 perspectives, found ${Array.isArray(trade.perspectives) ? trade.perspectives.length : "none"}` });
    continue;
  }

  const before = JSON.stringify({
    summary: trade.summary,
    partnerSummary: trade.partnerSummary,
    analysis: trade.analysis,
    perspectives: trade.perspectives
  });

  const next = {
    summary: clean(c.proposedCopy.summary),
    partnerSummary: clean(c.proposedCopy.partnerSummary),
    analysis: clean(c.proposedCopy.analysis),
    perspectives: trade.perspectives.map(p => makePerspectiveCopy(trade, p))
  };

  const after = JSON.stringify(next);

  if (before !== after) {
    changed++;
    rows.push({ id: c.id, status: apply ? "applied" : "would_apply" });

    if (apply) {
      trade.summary = next.summary;
      trade.partnerSummary = next.partnerSummary;
      trade.analysis = next.analysis;
      trade.perspectives = next.perspectives;
    }
  } else {
    rows.push({ id: c.id, status: "no_change" });
  }
}

let backup = "";
if (apply && changed) {
  backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-partner-language-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Partner-Language Patch ${apply ? "Apply" : "Dry Run"} v1\n\n`;
txt += `Generated: ${new Date().toISOString()}\n`;
txt += `Mode: ${apply ? "apply" : "dry-run"}\n\n`;
txt += `## Summary\n`;
txt += `- Targeted records: ${candidates.length}\n`;
txt += `- Blocked records: ${blocked}\n`;
txt += `- Changed records: ${changed}\n`;
if (backup) txt += `- Backup created: ${backup}\n`;
txt += `\n## Status Counts\n`;
for (const [k, v] of Object.entries(counts)) txt += `- ${k}: ${v}\n`;
txt += `\n## Records\n`;
for (const r of rows) txt += `- ${r.id}: ${r.status}${r.reason ? ` (${r.reason})` : ""}\n`;

fs.writeFileSync(outTxt, txt);
console.log(txt);
console.log(`Wrote: ${outTxt}`);
