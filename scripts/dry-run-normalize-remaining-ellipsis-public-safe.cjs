const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "ellipsis-public-safe-normalization-dry-run.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(raw) ? raw : raw.trades;

function slugOf(t) {
  return String(t.slug || t.id || "").trim();
}

function dateOf(t) {
  return t.tradeDate || t.date || null;
}

function keysOf(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
}

function balanceParens(s) {
  let out = String(s || "").trim();
  while ((out.match(/\(/g) || []).length > (out.match(/\)/g) || []).length) {
    const i = out.lastIndexOf("(");
    if (i < 0) break;
    out = out.slice(0, i).trim();
  }
  return out;
}

function removeDanglingTail(s) {
  let out = String(s || "").trim();

  out = out
    .replace(/\s+/g, " ")
    .replace(/[,\-\/(]+$/g, "")
    .replace(/\s+(and|or)$/i, "")
    .trim();

  const badTail = /\b(roun|round|ov|over|overall|subsequently|traded|Sterl|Nick|Ja|99t|202|2017|2012)$/i;

  for (let i = 0; i < 8 && badTail.test(out); i++) {
    const next = out.replace(/\s+\S+$/, "").trim();
    if (next === out) {
      out = "";
      break;
    }
    out = next;
  }

  return out.trim();
}

function cleanAsset(before, type) {
  let kept = String(before || "").split("...")[0].trim();
  kept = balanceParens(removeDanglingTail(kept));

  const fallback = type === "player"
    ? "Player details unavailable from source data"
    : type === "pick"
      ? "Draft-pick compensation details unavailable from source data"
      : "Compensation details unavailable from source data";

  if (kept.length < 10) return fallback;

  const note = type === "player"
    ? "additional player details unavailable from source data"
    : type === "pick"
      ? "additional draft-pick details unavailable from source data"
      : "additional compensation details unavailable from source data";

  return `${kept}; ${note}`.replace(/\s+/g, " ").trim();
}

const planned = [];
const blocked = [];

for (const t of trades) {
  if (t.suppressed === true) continue;

  for (const team of keysOf(t.assetsReceived)) {
    const assets = Array.isArray(t.assetsReceived[team]) ? t.assetsReceived[team] : [];

    assets.forEach((item, index) => {
      const before = item && item.asset ? item.asset : "";
      if (!before.includes("...")) return;

      const after = cleanAsset(before, item.type);

      const errors = [];
      if (!after) errors.push("empty");
      if (after.includes("...")) errors.push("ellipsis remains");
      if ((after.match(/\(/g) || []).length !== (after.match(/\)/g) || []).length) errors.push("unbalanced parentheses");

      const row = {
        slug: slugOf(t),
        id: t.id || null,
        date: dateOf(t),
        publishStatus: t.publishStatus || null,
        team,
        assetIndex: index,
        type: item.type || null,
        before,
        after,
        errors
      };

      if (errors.length) blocked.push(row);
      else planned.push(row);
    });
  }
}

fs.writeFileSync(outPath, JSON.stringify({
  mode: "dry-run",
  generatedAt: new Date().toISOString(),
  plannedReplacementCount: planned.length,
  plannedTradeCount: new Set(planned.map(r => r.slug)).size,
  blockedCount: blocked.length,
  planned,
  blocked
}, null, 2));

console.log("");
console.log("PUBLIC-SAFE ELLIPSIS NORMALIZATION DRY RUN");
console.log("=".repeat(60));
console.log(`planned replacements: ${planned.length}`);
console.log(`trades touched: ${new Set(planned.map(r => r.slug)).size}`);
console.log(`blocked: ${blocked.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("First 15 planned:");
for (const r of planned.slice(0, 15)) {
  console.log("-".repeat(60));
  console.log(`${r.slug} | ${r.id} | ${r.date} | ${r.team}[${r.assetIndex}]`);
  console.log(`BEFORE: ${r.before}`);
  console.log(`AFTER : ${r.after}`);
}
