import fs from "node:fs";

const label = "010";
const apply = process.argv.includes("--apply");

const previewPath = `reports/quality/nfl-bottom-batch-${label}-repair-preview-v1.json`;
const dataPath = "src/data/nfl/trades.json";
const outTxt = `reports/quality/nfl-bottom-batch-${label}-stubborn-copy-${apply ? "apply" : "dry-run"}-v1.txt`;
const outJson = `reports/quality/nfl-bottom-batch-${label}-stubborn-copy-${apply ? "apply" : "dry-run"}-v1.json`;

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
  "washington-commanders": "Washington"
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

function assetsFor(trade, team) {
  const a = trade.assetsReceived?.[team];
  if (!Array.isArray(a) || !a.length) return "the recorded return";
  return a.map(x => x.asset || x.name || x.player || x.pick || "").filter(Boolean).join("; ") || "the recorded return";
}

function sentence(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function winnerSlug(trade) {
  const verdict = String(trade.verdict || "");
  if (/even/i.test(verdict)) return null;
  return (trade.teams || []).find(t => verdict.toLowerCase().includes(name(t).toLowerCase()));
}

function makeCopy(trade) {
  const teams = Array.isArray(trade.teams) ? trade.teams.slice(0, 2) : [];
  if (teams.length !== 2) throw new Error(`Need exactly two teams for ${trade.id}`);

  const [a, b] = teams;
  const an = name(a), bn = name(b);
  const ag = trade.grades?.[a] || "C";
  const bg = trade.grades?.[b] || "C";
  const aa = assetsFor(trade, a);
  const ba = assetsFor(trade, b);
  const w = winnerSlug(trade);

  let summary, partnerSummary, analysis;

  if (!w) {
    summary = `${an} received ${aa}, while ${bn} received ${ba}. The Batch 010 review keeps this as an even trade because the realized value stayed close after accounting for the player and pick outcomes.`;
    partnerSummary = `${bn} had a comparable value case from the opposite side of the deal, leaving the exchange in the neutral range rather than creating a clear winner.`;
    analysis = `This record is treated as a balanced exchange: ${an} grades ${ag}, and ${bn} grades ${bg}. The transaction had enough football logic on both sides to avoid a forced win/loss label, so the reviewed TradeVerdicts outcome remains Even Trade.`;
  } else {
    const l = w === a ? b : a;
    const wn = name(w), ln = name(l);
    const wg = trade.grades?.[w] || "C";
    const lg = trade.grades?.[l] || "C";
    const wa = assetsFor(trade, w);
    const la = assetsFor(trade, l);

    summary = `${wn} receives the reviewed edge in this trade after turning ${wa} into the stronger long-term value case. The final grade profile is ${wn} ${wg}, ${ln} ${lg}.`;
    partnerSummary = `${ln} received ${la}, but that side did not match the realized value credited to ${wn}. The reviewed verdict stays with ${wn}.`;
    analysis = `The Batch 010 review favors ${wn} because the final asset outcome created more practical football value than the return for ${ln}. The losing side had understandable roster or draft logic, but the grade split supports ${trade.verdict}.`;
  }

  const perspectives = teams.map(primary => {
    const partner = primary === a ? b : a;
    const pg = trade.grades?.[primary] || "C";
    const og = trade.grades?.[partner] || "C";
    const pn = name(primary), on = name(partner);
    const pa = assetsFor(trade, primary);
    const oa = assetsFor(trade, partner);

    const old = Array.isArray(trade.perspectives)
      ? trade.perspectives.find(p => p.primaryTeam === primary && p.partnerTeam === partner) || {}
      : {};

    const primarySummary = !w
      ? `${pn} received ${pa}. This side grades ${pg}, and the overall review keeps the trade even because ${on}'s return stayed close enough on the same hindsight scale.`
      : primary === w
        ? `${pn} received ${pa}. This side grades ${pg} and controls the final edge because its return produced the stronger reviewed value.`
        : `${pn} received ${pa}. This side grades ${pg}, but the return did not match ${name(w)}'s outcome after the Batch 010 review.`;

    const partnerSummary = `${on} received ${oa}. The partner side grades ${og}, using the same reviewed value standard applied to the full trade record.`;

    return {
      ...old,
      primaryTeam: primary,
      partnerTeam: partner,
      primaryGrade: pg,
      partnerGrade: og,
      verdict: trade.verdict,
      publishStatus: "ready",
      primarySummary,
      partnerSummary
    };
  });

  return {
    summary: sentence(summary),
    partnerSummary: sentence(partnerSummary),
    analysis: sentence(analysis),
    perspectives
  };
}

const candidates = walk(preview);
const results = [];
let blocked = 0;
let changed = 0;

for (const c of candidates) {
  const idx = trades.findIndex(t => t.id === c.id);
  if (idx < 0) {
    blocked++;
    results.push({ id: c.id, status: "blocked", reason: "missing trade" });
    continue;
  }

  const trade = trades[idx];

  try {
    const nextCopy = makeCopy(trade);
    const before = JSON.stringify({
      summary: trade.summary,
      partnerSummary: trade.partnerSummary,
      analysis: trade.analysis,
      perspectives: trade.perspectives
    });

    const after = JSON.stringify(nextCopy);

    if (before !== after) {
      changed++;
      if (apply) {
        trade.summary = nextCopy.summary;
        trade.partnerSummary = nextCopy.partnerSummary;
        trade.analysis = nextCopy.analysis;
        trade.perspectives = nextCopy.perspectives;
      }
      results.push({ id: c.id, status: apply ? "applied" : "would_apply" });
    } else {
      results.push({ id: c.id, status: "no_change" });
    }
  } catch (e) {
    blocked++;
    results.push({ id: c.id, status: "blocked", reason: e.message });
  }
}

if (apply && changed) {
  const backup = `src/data/nfl/trades.backup-before-bottom-batch-${label}-stubborn-copy-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
}

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

let txt = `# NFL Bottom Batch ${label} Stubborn Copy ${apply ? "Apply" : "Dry Run"} v1\n\n`;
txt += `Generated: ${new Date().toISOString()}\n`;
txt += `Mode: ${apply ? "apply" : "dry-run"}\n\n`;
txt += `## Summary\n`;
txt += `- Targeted copy candidates: ${candidates.length}\n`;
txt += `- Blocked records: ${blocked}\n`;
txt += `- Changed records: ${changed}\n\n`;
txt += `## Status Counts\n`;
for (const [k, v] of Object.entries(counts)) txt += `- ${k}: ${v}\n`;
txt += `\n## Records\n`;
for (const r of results) txt += `- ${r.id}: ${r.status}${r.reason ? ` (${r.reason})` : ""}\n`;

fs.writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), mode: apply ? "apply" : "dry-run", candidates: candidates.length, blocked, changed, counts, results }, null, 2) + "\n");
fs.writeFileSync(outTxt, txt);

console.log(txt);
console.log(`Wrote: ${outTxt}`);
