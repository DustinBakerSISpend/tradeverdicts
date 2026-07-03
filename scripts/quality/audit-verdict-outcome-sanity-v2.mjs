import fs from "node:fs";
import path from "node:path";

const DATA_PATH = "src/data/nfl/trades.json";
const OUT_DIR = "reports/quality";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const trades = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const GRADE_POINTS = {
  "A+": 12, "A": 11, "A-": 10,
  "B+": 9, "B": 8, "B-": 7,
  "C+": 6, "C": 5, "C-": 4,
  "D+": 3, "D": 2, "D-": 1,
  "F": 0
};

const TEAM_NAMES = [
  "Arizona Cardinals","St. Louis Cardinals","Chicago Cardinals","Phoenix Cardinals",
  "Atlanta Falcons","Baltimore Ravens","Buffalo Bills","Carolina Panthers","Chicago Bears",
  "Cincinnati Bengals","Cleveland Browns","Dallas Cowboys","Denver Broncos","Detroit Lions",
  "Green Bay Packers","Houston Texans","Indianapolis Colts","Jacksonville Jaguars",
  "Kansas City Chiefs","Las Vegas Raiders","Oakland Raiders","Los Angeles Raiders",
  "Los Angeles Chargers","San Diego Chargers","Los Angeles Rams","St. Louis Rams",
  "Miami Dolphins","Minnesota Vikings","New England Patriots","New Orleans Saints",
  "New York Giants","New York Jets","Philadelphia Eagles","Pittsburgh Steelers",
  "San Francisco 49ers","Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans",
  "Houston Oilers","Washington Commanders","Washington Redskins","Washington Football Team"
];

const HIGH_VALUE_NAMES = [
  { name: "Steven Jackson", weight: 100, floor: "A-" },
  { name: "Jalen Ramsey", weight: 80, floor: "A-" },
  { name: "Micah Parsons", weight: 90, floor: "A" },
  { name: "Myles Garrett", weight: 85, floor: "A-" },
  { name: "Aaron Rodgers", weight: 80, floor: "B+" },
  { name: "Brett Favre", weight: 100, floor: "A" },
  { name: "Herschel Walker", weight: 90, floor: "A" },
  { name: "Marshall Faulk", weight: 85, floor: "A-" },
  { name: "Randy Moss", weight: 90, floor: "A" },
  { name: "Khalil Mack", weight: 80, floor: "A-" },
  { name: "Christian McCaffrey", weight: 75, floor: "A-" },
  { name: "Tyreek Hill", weight: 80, floor: "A-" },
  { name: "Davante Adams", weight: 70, floor: "B+" },
  { name: "DeAndre Hopkins", weight: 70, floor: "B+" },
  { name: "Julio Jones", weight: 70, floor: "B+" },
  { name: "Stefon Diggs", weight: 70, floor: "B+" },
  { name: "Trent Williams", weight: 80, floor: "A-" },
  { name: "Laremy Tunsil", weight: 75, floor: "A-" },
  { name: "Matthew Stafford", weight: 80, floor: "A-" },
  { name: "Russell Wilson", weight: 80, floor: "A-" },
  { name: "Eli Manning", weight: 85, floor: "A-" },
  { name: "Philip Rivers", weight: 80, floor: "A-" },
  { name: "John Elway", weight: 100, floor: "A" },
  { name: "Eric Dickerson", weight: 90, floor: "A" },
  { name: "Champ Bailey", weight: 85, floor: "A-" },
  { name: "Clinton Portis", weight: 70, floor: "B+" },
  { name: "Jared Allen", weight: 80, floor: "A-" },
  { name: "Tony Gonzalez", weight: 75, floor: "A-" },
  { name: "Jason Peters", weight: 75, floor: "A-" },
  { name: "Jerome Bettis", weight: 75, floor: "A-" },
  { name: "Marshawn Lynch", weight: 75, floor: "A-" },
  { name: "Amari Cooper", weight: 65, floor: "B+" },
  { name: "Brandin Cooks", weight: 60, floor: "B" },
  { name: "A.J. Brown", weight: 80, floor: "A-" },
  { name: "Chuba Hubbard", weight: 35, floor: "B-" },
  { name: "Chris Perry", weight: 20, floor: "C+" },
  { name: "Stacy Andrews", weight: 18, floor: "C+" },
  { name: "Dez Fitzpatrick", weight: 10, floor: "C" }
];

const PROCESS_LEAKS = [
  "second pass",
  "the second pass treats",
  "partner side",
  "from the partner side",
  "partner assessment",
  "partner assessment mirrors",
  "assessment mirrors",
  "opposite value judgment",
  "revised outcome"
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

function gradeValue(g) {
  if (!g) return null;
  const clean = String(g).trim().toUpperCase();
  return Object.hasOwn(GRADE_POINTS, clean) ? GRADE_POINTS[clean] : null;
}

function normalize(s) {
  return String(s || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function compact(s, n = 220) {
  return normalize(String(s || "")).slice(0, n);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const copyKeys = [
    "title","headline","summary","description","verdictSummary","analysis","body","content",
    "shortSummary","longSummary","seoTitle","seoDescription","metaTitle","metaDescription",
    "winnerSummary","loserSummary","excerpt","intro","takeaway"
  ];
  const parts = [];
  for (const key of copyKeys) {
    if (t[key]) parts.push(typeof t[key] === "string" ? t[key] : allText(t[key]));
  }

  // Perspectives often feed public pages, so include them for leak/grade contradiction checks.
  if (t.perspectives) parts.push(allText(t.perspectives));
  if (t.sections) parts.push(allText(t.sections));
  if (t.copy) parts.push(allText(t.copy));

  return parts.join(" \n ");
}

function findGrades(t) {
  const grades = {};

  function add(team, grade) {
    const teamName = normalize(team);
    const g = normalize(grade).toUpperCase();
    if (teamName && gradeValue(g) != null) grades[teamName] = g;
  }

  if (t.grades && typeof t.grades === "object") {
    for (const [team, grade] of Object.entries(t.grades)) {
      if (typeof grade === "string") add(team, grade);
      else if (grade && typeof grade === "object") add(team, grade.grade || grade.letter || grade.value);
    }
  }

  for (const key of ["teamGrades","visibleGrades","gradeCards"]) {
    if (!t[key]) continue;
    if (Array.isArray(t[key])) {
      for (const row of t[key]) add(row.team || row.name || row.teamName || row.franchise, row.grade || row.letter || row.value);
    } else if (typeof t[key] === "object") {
      for (const [team, val] of Object.entries(t[key])) add(team, val?.grade || val?.letter || val?.value || val);
    }
  }

  if (Array.isArray(t.perspectives)) {
    for (const p of t.perspectives) add(p.team || p.teamName || p.franchise, p.grade || p.letterGrade || p.value);
  }

  return grades;
}

function detectTeams(t, grades, text) {
  const teams = new Set(Object.keys(grades).map(normalize));

  for (const key of ["teams","teamNames","franchises"]) {
    const v = t[key];
    if (Array.isArray(v)) {
      for (const item of v) teams.add(normalize(typeof item === "string" ? item : item?.team || item?.name || item?.teamName || item?.franchise));
    }
  }

  for (const key of ["teamA","teamB","fromTeam","toTeam","buyer","seller","winner","winningTeam"]) {
    const v = t[key];
    if (v) teams.add(normalize(typeof v === "string" ? v : v?.team || v?.name || v?.teamName || v?.franchise));
  }

  for (const name of TEAM_NAMES) {
    if (new RegExp(`\\b${escapeRegex(name)}\\b`, "i").test(text)) teams.add(name);
  }

  return [...teams].filter(Boolean);
}

function sameTeam(a, b) {
  const x = normalize(a).toLowerCase();
  const y = normalize(b).toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function findWinner(t, text) {
  const direct = [
    t.winner, t.winningTeam, t.verdictWinner, t.verdict?.winner, t.outcome?.winner,
    t.result?.winner, t.teamWinner
  ].filter(Boolean).map(v => normalize(typeof v === "string" ? v : v.team || v.name || v.teamName));

  if (direct.length) return direct[0];

  const verdictText = String(t.verdict || t.result || t.outcome || "");
  const directText = `${verdictText}\n${text}`;

  for (const team of TEAM_NAMES) {
    if (new RegExp(`\\b${escapeRegex(team)}\\s+Win\\b`, "i").test(directText)) return team;
    if (new RegExp(`\\b${escapeRegex(team)}\\s+Wins\\b`, "i").test(directText)) return team;
  }

  const m = directText.match(/\b([A-Z][A-Za-z .'-]{2,50})\s+Wins?\b/);
  return m ? normalize(m[1]) : "";
}

function addSideText(sideText, team, chunk) {
  const k = normalize(team);
  if (!k) return;
  sideText[k] ||= [];
  sideText[k].push(allText(chunk));
}

function collectStructuredSideText(t, teams) {
  const sideText = {};

  // Common direct structures.
  const directKeys = [
    "received","receives","assetsReceived","assets","tradeAssets","sides",
    "teamAssets","assetsByTeam","returnByTeam","compensation","draftPicks"
  ];

  for (const key of directKeys) {
    const v = t[key];
    if (!v) continue;

    if (Array.isArray(v)) {
      for (const row of v) {
        const team = row?.team || row?.teamName || row?.franchise || row?.recipient || row?.to || row?.acquiringTeam;
        if (team) addSideText(sideText, team, row);
      }
    } else if (typeof v === "object") {
      for (const [team, chunk] of Object.entries(v)) {
        if (teams.some(tn => sameTeam(tn, team))) addSideText(sideText, team, chunk);
      }
    }
  }

  // Recursively find nested objects that clearly belong to one team.
  const seen = new Set();
  function walk(x) {
    if (!x || typeof x !== "object") return;
    if (seen.has(x)) return;
    seen.add(x);

    if (!Array.isArray(x)) {
      const team = x.team || x.teamName || x.franchise || x.recipient || x.toTeam || x.acquiringTeam;
      const hasAssetishKey = Object.keys(x).some(k => /asset|receive|pick|player|sent|gave|acquired|return|compensation/i.test(k));
      if (team && hasAssetishKey) addSideText(sideText, team, x);
    }

    for (const val of Object.values(x)) walk(val);
  }
  walk(t);

  return sideText;
}

function addNarrativeSideText(t, teams, sideText) {
  const text = allText(t);

  for (const team of teams) {
    const patterns = [
      new RegExp(`\\b${escapeRegex(team)}\\b.{0,80}\\b(received|acquired|landed|got|selected|used|drafted)\\b.{0,320}`, "gi"),
      new RegExp(`.{0,240}\\b(to|by)\\s+the\\s+${escapeRegex(team)}\\b.{0,160}`, "gi"),
      new RegExp(`.{0,160}\\b${escapeRegex(team)}\\s+received\\b.{0,320}`, "gi")
    ];

    for (const re of patterns) {
      const hits = text.match(re);
      if (hits?.length) {
        sideText[team] ||= [];
        sideText[team].push(...hits.slice(0, 8));
      }
    }
  }

  return sideText;
}

function sideAssetScore(text) {
  const source = String(text || "");
  let score = 0;
  const hits = [];

  for (const item of HIGH_VALUE_NAMES) {
    if (new RegExp(`\\b${escapeRegex(item.name)}\\b`, "i").test(source)) {
      score += item.weight;
      hits.push(item.name);
    }
  }

  for (const m of source.matchAll(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/gi)) {
    const overall = Number(m[1]);
    if (overall <= 5) score += 45;
    else if (overall <= 15) score += 35;
    else if (overall <= 32) score += 25;
    else if (overall <= 100) score += 12;
    else score += 4;
    hits.push(`${overall} overall`);
  }

  if (/\bfirst[- ]round|1st[- ]round|round 1\b/i.test(source)) {
    score += 20;
    hits.push("1st-round pick");
  }
  if (/\bsecond[- ]round|2nd[- ]round|round 2\b/i.test(source)) {
    score += 12;
    hits.push("2nd-round pick");
  }
  if (/\bPro Bowl|All-Pro|Hall of Fame|MVP|franchise quarterback|multi[- ]year starter|longtime starter|1,000-yard|thousand-yard\b/i.test(source)) {
    score += 25;
    hits.push("career-value language");
  }

  return { score, hits: [...new Set(hits)] };
}

function detectGradeMentions(copy) {
  const mentions = [];

  const patterns = [
    /\bgrade(?:d|s)?\s+(?:as\s+|at\s+|out\s+as\s+|to\s+|is\s+|was\s+|becomes\s+|become\s+)?(?:an?\s+)?([A-DF][+-]?)\b/gi,
    /\b(?:earned|earns|received|receives|gets|got|lands|landed|draws|carries|shows|showed)\s+(?:an?\s+)?([A-DF][+-]?)\b/gi,
    /\b(?:this|that|deal|trade|side|assessment|verdict)\s+(?:becomes|became|is|was|as)\s+(?:an?\s+)?([A-DF][+-]?)\b/gi,
    /\b([A-DF][+-]?)\s+(?:grade|mark|assessment|verdict)\b/gi
  ];

  for (const re of patterns) {
    for (const m of copy.matchAll(re)) mentions.push(m[1].toUpperCase());
  }

  return [...new Set(mentions.filter(g => gradeValue(g) != null))];
}

function findTerms(copy, terms) {
  const low = String(copy || "").toLowerCase();
  return terms.filter(term => low.includes(term.toLowerCase()));
}

function slugOrId(t) {
  return t.id || t.tradeId || t.slug || t.url || "";
}

const findings = [];

function addFinding(t, category, severity, reason, evidence = "", extra = {}) {
  findings.push({
    score: severity,
    category,
    id: t.id || t.tradeId || "",
    slug: t.slug || "",
    title: t.title || t.headline || "",
    url: t.url || t.path || "",
    winner: extra.winner || "",
    grades: extra.grades || {},
    reason,
    evidence: compact(evidence, 600)
  });
}

for (const t of trades) {
  const text = allText(t);
  const copy = publicCopyText(t);
  const grades = findGrades(t);
  const teams = detectTeams(t, grades, text);
  const winner = findWinner(t, copy || text);

  let sideText = collectStructuredSideText(t, teams);
  sideText = addNarrativeSideText(t, teams, sideText);

  const sideRows = Object.entries(sideText)
    .map(([team, chunks]) => {
      const joined = chunks.join(" \n ");
      return { team, text: joined, ...sideAssetScore(joined) };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const gradeRows = Object.entries(grades)
    .map(([team, grade]) => ({ team, grade, value: gradeValue(grade) }))
    .filter(r => r.value != null)
    .sort((a, b) => b.value - a.value);

  const topGrade = gradeRows[0];
  const topAsset = sideRows[0];

  const processLeaks = findTerms(copy, PROCESS_LEAKS);
  if (processLeaks.length) {
    addFinding(t, "process-language leak", 95 + processLeaks.length, `Public copy contains backend/process language: ${processLeaks.join(", ")}`, processLeaks.join(" | "), { winner, grades });
  }

  const metaLeaks = findTerms(copy, META_LEAKS);
  if (metaLeaks.length) {
    addFinding(t, "metadata/indexing leak", 100 + metaLeaks.length, `Public copy contains metadata/indexing language: ${metaLeaks.join(", ")}`, metaLeaks.join(" | "), { winner, grades });
  }

  const visibleGrades = new Set(Object.values(grades).map(g => g.toUpperCase()));
  const mentionedGrades = detectGradeMentions(copy);
  const notVisible = mentionedGrades.filter(g => !visibleGrades.has(g));
  if (notVisible.length) {
    const snippets = copy.match(/.{0,100}\b(?:grade|graded|earned|earns|received|receives|gets|got|lands|landed|becomes|became|mark|assessment|verdict)\b.{0,100}/gi)?.slice(0, 5).join(" || ") || "";
    addFinding(t, "body grade contradiction", 90 + notVisible.length, `Copy mentions grade(s) not present in visible grades object: ${notVisible.join(", ")}`, snippets, { winner, grades });
  }

  if (winner && topGrade && !sameTeam(winner, topGrade.team)) {
    addFinding(t, "verdict vs grades mismatch", 105, `Verdict winner appears to be ${winner}, but highest visible grade is ${topGrade.team} ${topGrade.grade}`, JSON.stringify(grades), { winner, grades });
  }

  if (winner && topAsset && topAsset.score >= 60 && !sameTeam(winner, topAsset.team)) {
    addFinding(t, "likely wrong-side verdict", 115 + topAsset.score, `Best side-specific asset signal is on ${topAsset.team}, but verdict winner appears to be ${winner}`, `${topAsset.hits.join(", ")} :: ${topAsset.text}`, { winner, grades });
  }

  if (topAsset && grades[topAsset.team]) {
    const gv = gradeValue(grades[topAsset.team]);
    if (topAsset.score >= 60 && gv != null && gv <= gradeValue("C+")) {
      addFinding(t, "star/superior outcome on low-graded side", 110 + topAsset.score, `${topAsset.team} has strong side-specific asset signal but only grade ${grades[topAsset.team]}`, `${topAsset.hits.join(", ")} :: ${topAsset.text}`, { winner, grades });
    }
    if (winner && sameTeam(winner, topAsset.team) && topAsset.score >= 30 && gv != null && gv <= gradeValue("D+")) {
      addFinding(t, "winner/useful outcome grade too low", 105 + topAsset.score, `${topAsset.team} is the winner and has useful asset signal but very low grade ${grades[topAsset.team]}`, `${topAsset.hits.join(", ")} :: ${topAsset.text}`, { winner, grades });
    }
  }

  for (const item of HIGH_VALUE_NAMES) {
    if (!new RegExp(`\\b${escapeRegex(item.name)}\\b`, "i").test(text)) continue;

    const ownerRows = sideRows.filter(r => r.hits.includes(item.name));
    if (!ownerRows.length) {
      addFinding(t, "high-value name owner unclear", item.name === "Steven Jackson" ? 210 : 80, `${item.name} appears in record, but v2 could not confidently assign side owner`, compact(text, 500), { winner, grades });
      continue;
    }

    for (const owner of ownerRows) {
      const ownerGrade = grades[owner.team];
      const ownerGradeValue = gradeValue(ownerGrade);
      const requiredFloor = gradeValue(item.floor);

      if (winner && !sameTeam(winner, owner.team)) {
        addFinding(t, "high-value name not on winner side", item.name === "Steven Jackson" ? 240 : 120, `${item.name} appears tied to ${owner.team}, but verdict winner appears to be ${winner}`, `${owner.hits.join(", ")} :: ${owner.text}`, { winner, grades });
      }

      if (ownerGrade && ownerGradeValue != null && ownerGradeValue < requiredFloor) {
        addFinding(t, "high-value name below expected grade floor", item.name === "Steven Jackson" ? 230 : 112, `${item.name} appears tied to ${owner.team}, but ${owner.team} grade is ${ownerGrade}; expected review floor ${item.floor}`, `${owner.hits.join(", ")} :: ${owner.text}`, { winner, grades });
      }

      if (item.name === "Steven Jackson") {
        addFinding(t, "Steven Jackson manual-review trigger", 260, "Steven Jackson appears in trade record; verify Rams received Steven Jackson pick, Bengals received Chris Perry + Stacy Andrews, and verdict/grades reflect that.", `${owner.hits.join(", ")} :: ${owner.text}`, { winner, grades });
      }

      if (item.name === "Chuba Hubbard") {
        addFinding(t, "Chuba Hubbard manual-review trigger", 175, "Chuba Hubbard appears in trade record; verify Panthers winner grade is not artificially low for useful multiyear player outcome.", `${owner.hits.join(", ")} :: ${owner.text}`, { winner, grades });
      }
    }
  }

  // Direct known bad page text pattern: Raiders/Dolphins 2014 copy contradiction style.
  if (/2014.*3rd.*67th|Raiders.*Dolphins|second pass|partner side|C-|B-/i.test(`${t.slug || ""}\n${t.title || ""}\n${copy}`) && /Raiders|Dolphins/i.test(`${t.slug || ""}\n${t.title || ""}\n${copy}`)) {
    addFinding(t, "known-example style trigger", 160, "Record resembles the Raiders/Dolphins grade-copy contradiction example; manually inspect public body copy vs visible grades.", compact(copy, 500), { winner, grades });
  }
}

findings.sort((a, b) => b.score - a.score);

const jsonPath = path.join(OUT_DIR, `asset-outcome-sanity-v2-${RUN_ID}.json`);
const csvPath = path.join(OUT_DIR, `asset-outcome-sanity-v2-${RUN_ID}.csv`);
const mdPath = path.join(OUT_DIR, `asset-outcome-sanity-v2-${RUN_ID}.md`);

fs.writeFileSync(jsonPath, JSON.stringify(findings, null, 2));

const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
fs.writeFileSync(csvPath, [
  ["score","category","id","slug","title","winner","grades","reason","evidence"].map(esc).join(","),
  ...findings.map(f => [f.score,f.category,f.id,f.slug,f.title,f.winner,JSON.stringify(f.grades),f.reason,f.evidence].map(esc).join(","))
].join("\n"));

const counts = {};
for (const f of findings) counts[f.category] = (counts[f.category] || 0) + 1;

const targetFindings = findings.filter(f =>
  /Steven Jackson|Chuba Hubbard|2014.*3rd.*67th|Raiders.*Dolphins|Dolphins.*Raiders|second pass|partner side|partner assessment|opposite value judgment|revised outcome/i.test(
    `${f.id} ${f.slug} ${f.title} ${f.reason} ${f.evidence}`
  )
);

fs.writeFileSync(mdPath, [
  "# TradeVerdicts Asset Outcome Sanity Audit v2",
  "",
  `Run: ${new Date().toISOString()}`,
  `Trades inspected: ${trades.length}`,
  `Findings: ${findings.length}`,
  "",
  "## Category Counts",
  "",
  "| Category | Count |",
  "|---|---:|",
  ...Object.entries(counts).sort((a,b) => b[1] - a[1]).map(([k,v]) => `| ${k} | ${v} |`),
  "",
  "## Known Launch-Blocker Targets",
  "",
  "| Score | Category | ID/Slug | Winner | Reason |",
  "|---:|---|---|---|---|",
  ...targetFindings.slice(0, 60).map(f => `| ${f.score} | ${f.category} | ${f.id || f.slug} | ${f.winner || ""} | ${String(f.reason).replace(/\|/g, "/")} |`),
  "",
  "## Top Ranked Findings",
  "",
  "| Rank | Score | Category | ID/Slug | Winner | Reason |",
  "|---:|---:|---|---|---|---|",
  ...findings.slice(0, 100).map((f, i) => `| ${i + 1} | ${f.score} | ${f.category} | ${f.id || f.slug} | ${f.winner || ""} | ${String(f.reason).replace(/\|/g, "/")} |`)
].join("\n"));

console.log(`\nNo-change v2 audit complete. Trades inspected: ${trades.length}. Findings: ${findings.length}`);
console.log(`Reports written:`);
console.log(`- ${jsonPath}`);
console.log(`- ${csvPath}`);
console.log(`- ${mdPath}\n`);

console.log("Category counts:");
console.table(Object.entries(counts).sort((a,b) => b[1] - a[1]).map(([category, count]) => ({ category, count })));

console.log("\nKnown launch-blocker targets:");
console.table(targetFindings.slice(0, 20).map((f, i) => ({
  rank: i + 1,
  score: f.score,
  category: f.category,
  id_or_slug: f.id || f.slug,
  winner: f.winner,
  reason: f.reason.slice(0, 130)
})));

console.log("\nTop high-confidence findings:");
console.table(findings.slice(0, 30).map((f, i) => ({
  rank: i + 1,
  score: f.score,
  category: f.category,
  id_or_slug: f.id || f.slug,
  winner: f.winner,
  reason: f.reason.slice(0, 130)
})));
