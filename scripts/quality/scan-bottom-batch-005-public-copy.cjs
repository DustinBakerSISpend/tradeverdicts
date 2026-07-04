const fs = require("fs");

const data = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

const ids = [
  "DEN-2021-04-30-0366",
  "DEN-2021-04-30-0367",
  "DEN-2021-04-30-0368",
  "CLE-2021-0442",
  "SEA-2021-08-24-0222",
  "DEN-2021-08-31-0369",
  "DEN-2021-08-31-0370",
  "SEA-2021-09-03-0224",
  "MIN-2021-10-23-0291",
  "DEN-2021-10-25-0372",
  "DEN-2021-11-02-0373",
  "ARI-2022-0327",
  "CLE-2022-0447",
  "DEN-2022-04-29-0377",
  "MIN-2022-0286"
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
  return /publishStatus|qaNotes|provisional|GSC|manually indexed|indexing|landmark expanded|VSC import|hold-review|public import/i.test(text || "");
}

function hasBadGrammar(text) {
  return /\bgets the edge\b/i.test(text || "");
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
    if (hasBadGrammar(text)) hits.push({ id, field, issue: "bad grammar: gets the edge", text: text.slice(0, 240) });
    if (hasSemicolonJoin(text)) hits.push({ id, field, issue: "semicolon asset join", text: text.slice(0, 240) });
    if (hasBackendLanguage(text)) hits.push({ id, field, issue: "backend/internal language", text: text.slice(0, 240) });
  }
}

const outPath = "reports/quality/nfl-bottom-batch-005-public-copy-sanity-scan.txt";

let out = "NFL Bottom Batch 005 Public Copy Sanity Scan\n\n";
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
