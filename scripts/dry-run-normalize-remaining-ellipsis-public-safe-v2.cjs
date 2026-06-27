const fs = require("fs");
const path = require("path");

const dataPath = path.join(process.cwd(), "src", "data", "nfl", "trades.json");
const outPath = path.join(process.cwd(), "audits", "ellipsis-public-safe-normalization-v2-dry-run.json");

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

function balancedParenCounts(s) {
  return {
    open: (String(s || "").match(/\(/g) || []).length,
    close: (String(s || "").match(/\)/g) || []).length
  };
}

function keepThroughLastCompleteParen(prefix) {
  const s = String(prefix || "").trim();
  const lastClose = s.lastIndexOf(")");

  if (lastClose === -1) return "";

  let kept = s.slice(0, lastClose + 1).trim();

  const counts = balancedParenCounts(kept);
  if (counts.open !== counts.close) return "";

  return kept;
}

function clipKnownPrefix(before, type) {
  const prefix = String(before || "").split("...")[0].trim().replace(/\s+/g, " ");
  const throughParen = keepThroughLastCompleteParen(prefix);

  if (throughParen.length >= 10) return throughParen;

  let cleaned = prefix
    .replace(/[,\-\/(]+$/g, "")
    .replace(/\s+(and|or)$/i, "")
    .trim();

  const badTail = /\b(roun|round|ov|over|overall|subsequently|traded|Sterl|Nick|Ja|99t|202|2017|2012|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)$/i;

  for (let i = 0; i < 10 && badTail.test(cleaned); i++) {
    const next = cleaned.replace(/\s+\S+$/, "").trim();
    if (next === cleaned) {
      cleaned = "";
      break;
    }
    cleaned = next;
  }

  const counts = balancedParenCounts(cleaned);
  if (counts.open !== counts.close) cleaned = "";

  // Player-only strings like "Jason Pierre-Paul" are OK. Tiny fragments like "Ja" are not.
  const playerOnly = /^[A-Z][A-Za-z .'\-]+( \/ [A-Z][A-Za-z .'\-]+)?$/.test(cleaned) && cleaned.split(/\s+/).length >= 2;

  if (type === "player" && playerOnly) return cleaned;

  // For pick strings, require at least one complete parenthetical to avoid "1978 second" garbage.
  if (type === "pick" && /\([^()]+\)/.test(cleaned)) return cleaned;

  // For old cash/consideration lines, this can still be meaningful.
  if (/\bcash|consideration|undisclosed|player to be named later\b/i.test(cleaned) && cleaned.length >= 10) return cleaned;

  return "";
}

function fallback(type) {
  if (type === "player") return "Player details unavailable from source data";
  if (type === "pick") return "Draft-pick compensation details unavailable from source data";
  return "Compensation details unavailable from source data";
}

function cleanAsset(before, type) {
  const kept = clipKnownPrefix(before, type);

  if (!kept) return {
    after: fallback(type),
    strategy: "generic-fallback"
  };

  const note = type === "player"
    ? "additional player details unavailable from source data"
    : type === "pick"
      ? "additional draft-pick details unavailable from source data"
      : "additional compensation details unavailable from source data";

  return {
    after: `${kept}; ${note}`.replace(/\s+/g, " ").trim(),
    strategy: "keep-last-complete-known-asset-plus-note"
  };
}

function validate(after) {
  const errors = [];
  if (!after) errors.push("empty");
  if (after.includes("...")) errors.push("ellipsis remains");

  const counts = balancedParenCounts(after);
  if (counts.open !== counts.close) errors.push("unbalanced parentheses");

  if (/\b(roun|ov|over|Sterl|Nick|Ja|99t)$/.test(after)) errors.push("clipped tail remains");
  return errors;
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

      const result = cleanAsset(before, item.type);
      const errors = validate(result.after);

      const row = {
        slug: slugOf(t),
        id: t.id || null,
        date: dateOf(t),
        publishStatus: t.publishStatus || null,
        team,
        assetIndex: index,
        type: item.type || null,
        before,
        after: result.after,
        strategy: result.strategy,
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

const byStrategy = {};
for (const row of planned) byStrategy[row.strategy] = (byStrategy[row.strategy] || 0) + 1;

console.log("");
console.log("PUBLIC-SAFE ELLIPSIS NORMALIZATION V2 DRY RUN");
console.log("=".repeat(70));
console.log(`planned replacements: ${planned.length}`);
console.log(`trades touched: ${new Set(planned.map(r => r.slug)).size}`);
console.log(`blocked: ${blocked.length}`);
console.log(`Report: ${outPath}`);

console.log("");
console.log("By strategy:");
for (const [k, v] of Object.entries(byStrategy).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`- ${k}: ${v}`);
}

console.log("");
console.log("First 20 planned:");
for (const r of planned.slice(0, 20)) {
  console.log("-".repeat(70));
  console.log(`${r.slug} | ${r.id} | ${r.date} | ${r.team}[${r.assetIndex}] | ${r.strategy}`);
  console.log(`BEFORE: ${r.before}`);
  console.log(`AFTER : ${r.after}`);
}

if (blocked.length) {
  console.log("");
  console.log("Blocked:");
  for (const r of blocked.slice(0, 10)) {
    console.log("-".repeat(70));
    console.log(`${r.slug} | ${r.id} | ${r.date} | ${r.team}[${r.assetIndex}]`);
    console.log(`BEFORE: ${r.before}`);
    console.log(`AFTER : ${r.after}`);
    console.log(`ERRORS: ${r.errors.join("; ")}`);
  }
}
