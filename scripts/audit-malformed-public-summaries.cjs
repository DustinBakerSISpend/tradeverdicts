const fs = require("fs");
const path = require("path");

const trades = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

function isSuppressedLike(trade) {
  const text = normalize([
    trade.status,
    trade.publicStatus,
    trade.visibility,
    trade.pageStatus,
    trade.state,
    safeJson(trade.flags),
    safeJson(trade.tags),
  ].join(" "));

  return (
    trade.suppressed === true ||
    trade.hidden === true ||
    trade.holdConflict === true ||
    text.includes("suppressed") ||
    text.includes("hidden") ||
    text.includes("hold conflict") ||
    text.includes("holdconflict")
  );
}

function getPublicFields(trade) {
  const fields = [
    ["summary", trade.summary],
    ["description", trade.description],
    ["shortSummary", trade.shortSummary],
  ];

  if (Array.isArray(trade.perspectives)) {
    trade.perspectives.forEach((p, index) => {
      fields.push([`perspectives[${index}].primarySummary`, p.primarySummary]);
      fields.push([`perspectives[${index}].partnerSummary`, p.partnerSummary]);
    });
  }

  return fields.filter(([, value]) => typeof value === "string" && value.trim());
}

const checks = [
  {
    key: "single-letter-team-fragment",
    re: /\b(?:from|to|for)\s+[A-Z]\.\s*$/g,
  },
  {
    key: "numeric-tail-fragment",
    re: /(?<!\d),\s*\d{1,3}\.(?:\s|$)/g,
  },
  {
    key: "round-abbrev-tail",
    re: /\b\d{4}\s+\d+(?:st|nd|rd|th)\s+r\.(?:\s|$)|\b\d+(?:st|nd|rd|th)\s+r\.(?:\s|$)/g,
  },
  {
    key: "true-missing-space-phrases",
    re: /\b(?:ofthe|forthe|fromthe|tothe|andthe|thepartner|sideof|valuecurve|careerimpact|rosterimpact|draftreturn|playerforplayer)\b/gi,
  },
  {
    key: "missing-space-round",
    re: /\b\d+(?:st|nd|rd|th)round\b/gi,
  },
  {
    key: "clipped-team-from",
    re: /\bfrom\s+(?:N|New|Los|San|Tampa|Green|Kansas|New England|New York)\.\s*$/g,
  },
  {
    key: "clipped-team-to",
    re: /\bto\s+(?:N|New|Los|San|Tampa|Green|Kansas|New England|New York)\.\s*$/g,
  },
  {
    key: "clipped-team-for",
    re: /\bfor\s+(?:N|New|Los|San|Tampa|Green|Kansas|New England|New York)\.\s*$/g,
  }
];

const findings = [];

for (const trade of trades) {
  if (isSuppressedLike(trade)) continue;

  for (const [field, value] of getPublicFields(trade)) {
    const text = String(value);

    for (const check of checks) {
      check.re.lastIndex = 0;
      const matches = [...text.matchAll(check.re)];

      if (!matches.length) continue;

      findings.push({
        slug: trade.slug,
        id: trade.id,
        tradeDate: trade.tradeDate || trade.date,
        teams: trade.teams || [],
        verdict: trade.verdict,
        field,
        key: check.key,
        matches: matches.map((m) => m[0]),
        text,
      });
    }
  }
}

const byKey = findings.reduce((acc, row) => {
  acc[row.key] = (acc[row.key] || 0) + 1;
  return acc;
}, {});

const byTrade = new Set(findings.map((row) => row.slug));

const reportPath = path.join(
  "audit",
  "reports",
  `malformed-public-summary-audit-v2-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);

fs.writeFileSync(reportPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  findingCount: findings.length,
  tradeCount: byTrade.size,
  byKey,
  findings,
}, null, 2));

console.log("MALFORMED PUBLIC SUMMARY AUDIT V2 COMPLETE");
console.log(JSON.stringify({
  findingCount: findings.length,
  tradeCount: byTrade.size,
  byKey,
  reportPath,
}, null, 2));

console.log("\n=== FIRST 80 FINDINGS ===");
for (const row of findings.slice(0, 80)) {
  console.log("\n============================================================");
  console.log("key:", row.key);
  console.log("slug:", row.slug);
  console.log("id:", row.id);
  console.log("date:", row.tradeDate);
  console.log("teams:", row.teams.join(" vs "));
  console.log("field:", row.field);
  console.log("matches:", row.matches.join(" | "));
  console.log("text:", row.text);
}


