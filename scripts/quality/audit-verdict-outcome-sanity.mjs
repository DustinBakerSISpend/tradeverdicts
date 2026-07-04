import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const OUT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const STAR_NAMES = [
  "Steven Jackson","Jalen Ramsey","Micah Parsons","Myles Garrett","Aaron Rodgers",
  "Brett Favre","Herschel Walker","Marshall Faulk","Randy Moss","Khalil Mack",
  "Christian McCaffrey","Tyreek Hill","Davante Adams","DeAndre Hopkins","Julio Jones",
  "Stefon Diggs","Trent Williams","Laremy Tunsil","Matthew Stafford","Russell Wilson",
  "Deshaun Watson","Jay Cutler","Eli Manning","Philip Rivers","John Elway",
  "Eric Dickerson","Clinton Portis","Champ Bailey","Jared Allen","Tony Gonzalez",
  "Rob Gronkowski","Jason Peters","Jerome Bettis","Marshawn Lynch","Amari Cooper",
  "Brandin Cooks","A.J. Brown","Chuba Hubbard"
];

const PROCESS_LEAKS = [
  "second pass",
  "partner side",
  "partner assessment",
  "assessment mirrors",
  "opposite value judgment",
  "revised outcome",
  "from the partner side",
  "the second pass treats"
];

const META_LEAKS = [
  "Status:",
  "Tier:",
  "Confidence:",
  "priority GSC",
  "priority indexing",
  "manual indexing",
  "GSC indexing",
  "indexing page"
];

const GRADE_POINTS = {
  "A+": 12, "A": 11, "A-": 10,
  "B+": 9, "B": 8, "B-": 7,
  "C+": 6, "C": 5, "C-": 4,
  "D+": 3, "D": 2, "D-": 1,
  "F": 0
};

function gradeValue(g) {
  if (!g) return null;
  const clean = String(g).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(GRADE_POINTS, clean) ? GRADE_POINTS[clean] : null;
}

function normalizeTeam(s) {
  return String(s || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function allText(obj) {
  const seen = new Set();
  const parts = [];
  function walk(x) {
    if (x == null) return;
    if (typeof x === "string" || typeof x === "number") {
      parts.push(String(x));
      return;
    }
    if (typeof x !== "object") return;
    if (seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) x.forEach(walk);
    else Object.values(x).forEach(walk);
  }
  walk(obj);
  return parts.join(" \n ");
}

function publicCopyText(t) {
  const keys = [
    "title","headline","slug","summary","description","verdictSummary","analysis",
    "body","content","shortSummary","longSummary","seoTitle","seoDescription",
    "metaTitle","metaDescription","winnerSummary","loserSummary","excerpt"
  ];
  const parts = [];
  for (const k of keys) {
    if (t[k]) parts.push(typeof t[k] === "string" ? t[k] : allText(t[k]));
  }
  if (t.perspectives) parts.push(allText(t.perspectives));
  if (t.sections) parts.push(allText(t.sections));
  if (t.copy) parts.push(allText(t.copy));
  return parts.join(" \n ");
}

function findGrades(t) {
  const out = {};
  function add(team, grade) {
    const val = gradeValue(grade);
    if (team && val != null) out[normalizeTeam(team)] = String(grade).trim().toUpperCase();
  }

  if (t.grades && typeof t.grades === "object") {
    for (const [team, grade] of Object.entries(t.grades)) {
      if (typeof grade === "string") add(team, grade);
      else if (grade && typeof grade === "object") add(team, grade.grade || grade.letter || grade.value);
    }
  }

  for (const key of ["teamGrades","visibleGrades","gradeCards"]) {
    if (t[key] && typeof t[key] === "object") {
      if (Array.isArray(t[key])) {
        for (const row of t[key]) add(row.team || row.name || row.teamName, row.grade || row.letter || row.value);
      } else {
        for (const [team, grade] of Object.entries(t[key])) add(team, grade?.grade || grade?.letter || grade);
      }
    }
  }

  if (Array.isArray(t.perspectives)) {
    for (const p of t.perspectives) add(p.team || p.teamName || p.franchise, p.grade || p.letterGrade || p.value);
  }

  return out;
}

function findWinner(t, text) {
  const candidates = [
    t.winner, t.winningTeam, t.verdictWinner, t.verdict?.winner, t.outcome?.winner,
    t.result?.winner, t.teamWinner
  ].filter(Boolean).map(normalizeTeam);

  if (candidates.length) return candidates[0];

  const m = text.match(/\b([A-Z][A-Za-z .'-]*(?:Cardinals|Falcons|Ravens|Bills|Panthers|Bears|Bengals|Browns|Cowboys|Broncos|Lions|Packers|Texans|Colts|Jaguars|Chiefs|Raiders|Chargers|Rams|Dolphins|Vikings|Patriots|Saints|Giants|Jets|Eagles|Steelers|49ers|Seahawks|Buccaneers|Titans|Commanders|Redskins|Football Team))\s+Win\b/i);
  if (m) return normalizeTeam(m[1]);

  const v = String(t.verdict || t.result || t.outcome || "");
  const vm = v.match(/\b(.+?)\s+Win\b/i);
  if (vm) return normalizeTeam(vm[1]);

  return "";
}

function teamNamesFromTrade(t, grades, text) {
  const teams = new Set(Object.keys(grades));

  for (const key of ["teams","teamNames","franchises"]) {
    const v = t[key];
    if (Array.isArray(v)) v.forEach(x => teams.add(normalizeTeam(typeof x === "string" ? x : x?.team || x?.name || x?.teamName)));
  }

  for (const key of ["teamA","teamB","fromTeam","toTeam","buyer","seller"]) {
    if (t[key]) teams.add(normalizeTeam(typeof t[key] === "string" ? t[key] : t[key]?.team || t[key]?.name || t[key]?.teamName));
  }

  const teamRegex = /\b(Arizona Cardinals|St\.? Louis Cardinals|Los Angeles Rams|St\.? Louis Rams|Cincinnati Bengals|Carolina Panthers|Tennessee Titans|Miami Dolphins|Las Vegas Raiders|Oakland Raiders|Los Angeles Chargers|San Diego Chargers|Minnesota Vikings|Green Bay Packers|Dallas Cowboys|Buffalo Bills|Kansas City Chiefs|Houston Texans|Indianapolis Colts|Philadelphia Eagles|New York Jets|New York Giants|New England Patriots|Seattle Seahawks|San Francisco 49ers|Washington Redskins|Washington Commanders|Washington Football Team|Pittsburgh Steelers|Chicago Bears|Detroit Lions|Denver Broncos|Cleveland Browns|Baltimore Ravens|Atlanta Falcons|New Orleans Saints|Tampa Bay Buccaneers|Jacksonville Jaguars)\b/gi;
  for (const m of text.matchAll(teamRegex)) teams.add(normalizeTeam(m[1]));

  return [...teams].filter(Boolean);
}

function inferAssetsByTeam(t, teams) {
  const text = allText(t);
  const assets = Object.fromEntries(teams.map(team => [team, ""]));

  function add(team, chunk) {
    const nt = normalizeTeam(team);
    const matched = teams.find(x => x.toLowerCase() === nt.toLowerCase() || nt.toLowerCase().includes(x.toLowerCase()) || x.toLowerCase().includes(nt.toLowerCase()));
    if (matched) assets[matched] += " " + allText(chunk);
  }

  for (const key of ["received","receives","assetsReceived","tradeAssets","assets","sides"]) {
    const v = t[key];
    if (!v) continue;
    if (Array.isArray(v)) {
      for (const row of v) add(row.team || row.teamName || row.franchise || row.recipient, row);
    } else if (typeof v === "object") {
      for (const [team, chunk] of Object.entries(v)) add(team, chunk);
    }
  }

  for (const team of teams) {
    const pattern = new RegExp(`${team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n.]{0,240}`, "ig");
    const snippets = text.match(pattern);
    if (snippets) assets[team] += " " + snippets.join(" ");
  }

  return assets;
}

function assetScore(s) {
  const txt = String(s || "");
  let score = 0;
  const hits = [];

  for (const name of STAR_NAMES) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(txt)) {
      score += name === "Chuba Hubbard" ? 18 : 45;
      hits.push(name);
    }
  }

  const pickMatches = [...txt.matchAll(/\b(?:pick|selection|overall)\b[^.\n]{0,80}/gi)].map(m => m[0]);
  for (const p of pickMatches) {
    const n = p.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/i)?.[1];
    if (n) {
      const overall = Number(n);
      if (overall <= 5) score += 35;
      else if (overall <= 15) score += 28;
      else if (overall <= 32) score += 22;
      else if (overall <= 100) score += 10;
      else score += 3;
      hits.push(`${overall}th overall pick`);
    } else if (/1st|first round|round 1/i.test(p)) {
      score += 20;
      hits.push("1st-round pick");
    } else if (/2nd|second round|round 2/i.test(p)) {
      score += 12;
      hits.push("2nd-round pick");
    }
  }

  if (/\bPro Bowl|All-Pro|Hall of Fame|MVP|rookie of the year|starter|multi[- ]year starter\b/i.test(txt)) {
    score += 20;
    hits.push("career-value language");
  }

  return { score, hits: [...new Set(hits)] };
}

function gradeMentionsNotVisible(copy, grades) {
  const visible = new Set(Object.values(grades).map(g => g.toUpperCase()));
  const mentions = [...copy.matchAll(/\b[A-DF][+-]?\b/g)].map(m => m[0].toUpperCase());
  return [...new Set(mentions.filter(g => GRADE_POINTS[g] !== undefined && !visible.has(g)))];
}

function containsAny(copy, terms) {
  const low = copy.toLowerCase();
  return terms.filter(term => low.includes(term.toLowerCase()));
}

const findings = [];

for (const t of trades) {
  const copy = publicCopyText(t);
  const text = allText(t);
  const grades = findGrades(t);
  const teams = teamNamesFromTrade(t, grades, text);
  const winner = findWinner(t, copy || text);
  const assets = inferAssetsByTeam(t, teams);

  const visibleGradeValues = Object.entries(grades).map(([team, grade]) => [team, grade, gradeValue(grade)]).filter(x => x[2] != null);
  const highGradeTeam = visibleGradeValues.length ? visibleGradeValues.sort((a,b) => b[2] - a[2])[0] : null;

  const assetRows = teams.map(team => ({ team, ...assetScore((assets[team] || "") + " " + copy) }))
    .filter(r => r.score > 0)
    .sort((a,b) => b.score - a.score);
  const bestAssetTeam = assetRows[0];

  const addFinding = (category, severity, reason, evidence = "") => {
    findings.push({
      score: severity,
      category,
      id: t.id || t.tradeId || t.slug || t.url || "",
      slug: t.slug || "",
      title: t.title || t.headline || "",
      winner,
      grades,
      reason,
      evidence: String(evidence).slice(0, 500)
    });
  };

  const processLeaks = containsAny(copy, PROCESS_LEAKS);
  if (processLeaks.length) addFinding("process-language leak", 85 + processLeaks.length, `Public copy contains process/backend terms: ${processLeaks.join(", ")}`, processLeaks.join(" | "));

  const metaLeaks = containsAny(copy, META_LEAKS);
  if (metaLeaks.length) addFinding("metadata/indexing leak", 90 + metaLeaks.length, `Public copy contains metadata/indexing terms: ${metaLeaks.join(", ")}`, metaLeaks.join(" | "));

  const missingGrades = gradeMentionsNotVisible(copy, grades);
  if (missingGrades.length) addFinding("body grade contradiction", 78 + missingGrades.length, `Copy mentions grade(s) not present in visible grades object: ${missingGrades.join(", ")}`, copy.match(/.{0,80}\b[A-DF][+-]?\b.{0,80}/g)?.slice(0, 4).join(" || ") || "");

  if (winner && highGradeTeam && !highGradeTeam[0].toLowerCase().includes(winner.toLowerCase()) && !winner.toLowerCase().includes(highGradeTeam[0].toLowerCase())) {
    addFinding("verdict vs grades mismatch", 88, `Verdict winner appears to be ${winner}, but highest visible grade is ${highGradeTeam[0]} ${highGradeTeam[1]}`, JSON.stringify(grades));
  }

  if (winner && bestAssetTeam && bestAssetTeam.score >= 40 && !bestAssetTeam.team.toLowerCase().includes(winner.toLowerCase()) && !winner.toLowerCase().includes(bestAssetTeam.team.toLowerCase())) {
    addFinding("likely wrong-side verdict", 100 + bestAssetTeam.score, `Best apparent asset outcome is on ${bestAssetTeam.team}, but verdict winner appears to be ${winner}`, bestAssetTeam.hits.join(", "));
  }

  if (bestAssetTeam && grades[bestAssetTeam.team]) {
    const gv = gradeValue(grades[bestAssetTeam.team]);
    if (bestAssetTeam.score >= 40 && gv != null && gv <= gradeValue("C+")) {
      addFinding("star/superior outcome on low-graded side", 95 + bestAssetTeam.score, `${bestAssetTeam.team} has high-value asset outcome but only grade ${grades[bestAssetTeam.team]}`, bestAssetTeam.hits.join(", "));
    }
    if (bestAssetTeam.score >= 18 && gv != null && gv <= gradeValue("D+")) {
      addFinding("winner/useful outcome grade too low", 82 + bestAssetTeam.score, `${bestAssetTeam.team} has useful/multiyear asset signal but very low grade ${grades[bestAssetTeam.team]}`, bestAssetTeam.hits.join(", "));
    }
  }

  for (const name of STAR_NAMES) {
    if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) continue;
    const starTeam = assetRows.find(r => r.hits.includes(name))?.team || "";
    if (starTeam && grades[starTeam]) {
      const gv = gradeValue(grades[starTeam]);
      if (gv != null && gv < gradeValue("B")) {
        addFinding("high-value name not high-graded", name === "Steven Jackson" ? 160 : 90, `${name} appears tied to ${starTeam}, but ${starTeam} grade is ${grades[starTeam]}`, name);
      }
      if (winner && !starTeam.toLowerCase().includes(winner.toLowerCase()) && !winner.toLowerCase().includes(starTeam.toLowerCase())) {
        addFinding("high-value name not on winner side", name === "Steven Jackson" ? 170 : 92, `${name} appears tied to ${starTeam}, but verdict winner appears to be ${winner}`, name);
      }
    }
  }

  if (/Steven Jackson/i.test(text)) {
    addFinding("Steven Jackson manual-review trigger", 200, "Steven Jackson appears anywhere in trade record; manually verify Rams/Bengals side, verdict, and grades.", "Known launch blocker example.");
  }
}

findings.sort((a,b) => b.score - a.score);

const jsonPath = path.join(OUT_DIR, `asset-outcome-sanity-${RUN_ID}.json`);
const mdPath = path.join(OUT_DIR, `asset-outcome-sanity-${RUN_ID}.md`);
const csvPath = path.join(OUT_DIR, `asset-outcome-sanity-${RUN_ID}.csv`);

fs.writeFileSync(jsonPath, JSON.stringify(findings, null, 2));

const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
fs.writeFileSync(csvPath, [
  ["score","category","id","slug","title","winner","grades","reason","evidence"].map(esc).join(","),
  ...findings.map(f => [f.score,f.category,f.id,f.slug,f.title,f.winner,JSON.stringify(f.grades),f.reason,f.evidence].map(esc).join(","))
].join("\n"));

fs.writeFileSync(mdPath, [
  "# TradeVerdicts Asset Outcome Sanity Audit",
  "",
  `Run: ${new Date().toISOString()}`,
  `Trades inspected: ${trades.length}`,
  `Findings: ${findings.length}`,
  "",
  "## Top Findings",
  "",
  "| Rank | Score | Category | ID/Slug | Winner | Reason |",
  "|---:|---:|---|---|---|---|",
  ...findings.slice(0, 75).map((f, i) => `| ${i+1} | ${f.score} | ${f.category} | ${f.id || f.slug} | ${f.winner || ""} | ${String(f.reason).replace(/\|/g, "/")} |`)
].join("\n"));

console.log(`\nNo-change audit complete. Trades inspected: ${trades.length}. Findings: ${findings.length}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${csvPath}`);
console.log(`- ${mdPath}\n`);

console.table(findings.slice(0, 25).map((f, i) => ({
  rank: i + 1,
  score: f.score,
  category: f.category,
  id_or_slug: f.id || f.slug,
  winner: f.winner,
  reason: f.reason.slice(0, 120)
})));
