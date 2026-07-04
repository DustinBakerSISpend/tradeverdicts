const fs = require("fs");

const data = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

const ids = [
  "CLE-2018-0414",
  "CLE-2018-0416",
  "DEN-2018-03-14-0345",
  "MIN-2018-03-14-0266",
  "DEN-2018-03-29-0347",
  "DEN-2018-04-23-0348",
  "RAI-2018-0371",
  "DEN-2018-04-28-0350",
  "MIN-2018-0262",
  "DEN-2018-10-30-0351",
  "DEN-2019-03-13-0352",
  "DEN-2019-03-13-0353"
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
  return /publishStatus|qaNotes|provisional|GSC|manually indexed|indexing|hold-review|public import|Status: Ready|Calculated|Verification pending|Retained for TradeVerdicts|AI regrade|Final QA|Pass -|second-pass|import audit|Batch \d+/i.test(text || "");
}

function hasBadGrammar(text) {
  return /\breceives the edge\b|\bgets the edge\b|\bPartner the partner\b|\bPartner The partner\b/i.test(text || "");
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

const outPath = "reports/quality/nfl-bottom-batch-008-public-copy-sanity-scan.txt";

let out = "NFL Bottom Batch 008 Public Copy Sanity Scan\n\n";
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
