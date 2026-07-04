const fs = require("fs");

const data = JSON.parse(fs.readFileSync("src/data/nfl/trades.json", "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

const ids = [
  "MIN-2022-0287",
  "MIN-2022-0289",
  "TEN-2022-0258",
  "DEN-2022-08-30-0379",
  "MIN-2022-0293",
  "MIN-2022-08-30-0299",
  "DEN-2022-11-01-0381",
  "DEN-2023-01-31-0382",
  "CAR-2023-0093",
  "CLE-2023-0452",
  "DEN-2023-04-28-0383",
  "JAX-2023-0098",
  "DEN-2023-04-29-0385"
];

function hasMojibake(text) {
  if (!text) return false;

  // Replacement character or common UTF-8/Windows mojibake starters.
  const badChars = [
    String.fromCharCode(0xfffd),
    String.fromCharCode(0x00e2),
    String.fromCharCode(0x00c2),
    String.fromCharCode(0x00c3)
  ];

  return badChars.some(ch => text.includes(ch));
}

function hasBackendLanguage(text) {
  return /publishStatus|qaNotes|provisional|GSC|manually indexed|indexing/i.test(text || "");
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
    if (hasBackendLanguage(text)) hits.push({ id, field, issue: "backend language", text: text.slice(0, 240) });
  }
}

const outPath = "reports/quality/nfl-bottom-batch-004-public-copy-sanity-scan.txt";

let out = "NFL Bottom Batch 004 Public Copy Sanity Scan\n\n";
out += "Records checked: " + ids.length + "\n";
out += "Hits: " + hits.length + "\n\n";

if (!hits.length) {
  out += "PASS: no public-copy mojibake, bad grammar, semicolon joins, or backend language found in the checked fields.\n";
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
