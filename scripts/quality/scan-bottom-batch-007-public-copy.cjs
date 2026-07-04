const fs = require("fs");

const data = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

const ids = [
  "PIT-2019-0362",
  "TB-2019-0244",
  "DEN-2019-04-25-0354",
  "SEA-2019-04-25-0202",
  "BUF-2019-0309",
  "DEN-2019-04-26-0355",
  "MIN-2019-0265",
  "RAM-2019-0501",
  "SEA-2019-04-26-0206",
  "DEN-2019-04-27-0356",
  "DEN-2019-04-27-0357",
  "MIN-2019-0269",
  "SEA-2019-04-29-0209",
  "PHI-2019-0413",
  "CLE-2019-0432",
  "DEN-2019-08-30-0358",
  "MIA-2019-0283",
  "CLE-2019-0434",
  "SEA-2019-08-31-0210",
  "PIT-2019-0365",
  "DEN-2019-10-22-0359",
  "DEN-2020-03-03-0360"
];

function hasMojibake(text) {
  if (!text) return false;
  const badChars = [
    String.fromCharCode(0xfffd),
    String.fromCharCode(0x00e2),
    String.fromCharCode(0x00c2),
    String.fromCharCode(0x00c3)
  ];
  return badChars.some(ch => text.includes(ch));
}

function hasBackendLanguage(text) {
  return /publishStatus|qaNotes|provisional|GSC|manually indexed|indexing|hold-review|public import|Status: Ready|Calculated|Verification pending|Retained for TradeVerdicts|AI regrade|Final QA|Pass -|second-pass|import audit/i.test(text || "");
}

function hasBadGrammar(text) {
  return /\breceives the edge\b|\bgets the edge\b|\bPartner the partner\b/i.test(text || "");
}

function hasSemicolonJoin(text) {
  return /; /.test(text || "");
}

let hits = [];

for (const id of ids) {
  const t = trades.find(x => x.id === id);

  if (!t) {
    hits.push({ id, field: "record", issue: "missing", text: "" });
    continue;
  }

  const fields = [
    ["summary", t.summary || ""],
    ["partnerSummary", t.partnerSummary || ""],
    ["analysis", t.analysis || ""]
  ];

  if (Array.isArray(t.perspectives)) {
    t.perspectives.forEach((p, i) => {
      fields.push([`perspectives[${i}].primarySummary`, p.primarySummary || ""]);
      fields.push([`perspectives[${i}].partnerSummary`, p.partnerSummary || ""]);
      fields.push([`perspectives[${i}].qaNotes`, p.qaNotes || ""]);
      fields.push([`perspectives[${i}].publishStatus`, p.publishStatus || ""]);
    });
  }

  for (const [field, text] of fields) {
    if (hasMojibake(text)) hits.push({ id, field, issue: "mojibake", text: text.slice(0, 240) });
    if (hasBadGrammar(text)) hits.push({ id, field, issue: "bad grammar", text: text.slice(0, 240) });
    if (hasSemicolonJoin(text)) hits.push({ id, field, issue: "semicolon asset join", text: text.slice(0, 240) });
    if (hasBackendLanguage(text)) hits.push({ id, field, issue: "backend/internal language", text: text.slice(0, 240) });
  }
}

const outPath = "reports/quality/nfl-bottom-batch-007-public-copy-sanity-scan.txt";

let out = "NFL Bottom Batch 007 Public Copy Sanity Scan\n\n";
out += "Records checked: " + ids.length + "\n";
out += "Hits: " + hits.length + "\n\n";

if (!hits.length) {
  out += "PASS: no public-copy mojibake, bad grammar, semicolon joins, or backend/internal language found in the checked fields.\n";
} else {
  for (const h of hits) {
    out += "====================\n";
    out += "id: " + h.id + "\n";
    out += "field: " + h.field + "\n";
    out += "issue: " + h.issue + "\n";
    out += "text: " + h.text + "\n\n";
  }
}

fs.writeFileSync(outPath, out);
console.log(out);
