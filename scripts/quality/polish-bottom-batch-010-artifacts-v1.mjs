import fs from "node:fs";

const dataPath = "src/data/nfl/trades.json";
const previewPath = "reports/quality/nfl-bottom-batch-010-repair-preview-v1.json";

const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : (data.trades || []);

const ids = new Set();

function walk(x) {
  if (Array.isArray(x)) return x.forEach(walk);
  if (!x || typeof x !== "object") return;
  if (x.id) ids.add(x.id);
  for (const v of Object.values(x)) walk(v);
}

walk(preview);

let touched = 0;

function cleanString(s) {
  return String(s)
    .replace(/Chiefs's/g, "Chiefs'")
    .replace(/Bears's/g, "Bears'")
    .replace(/Jets's/g, "Jets'")
    .replace(/Falcons's/g, "Falcons'")
    .replace(/Vikings's/g, "Vikings'")
    .replace(/Cardinals's/g, "Cardinals'")
    .replace(/Patriots's/g, "Patriots'")
    .replace(/Raiders's/g, "Raiders'")
    .replace(/Titans's/g, "Titans'")
    .replace(/Eagles's/g, "Eagles'")
    .replace(/Seahawks's/g, "Seahawks'")
    .replace(/Dolphins's/g, "Dolphins'")
    .replace(/Rams's/g, "Rams'")
    .replace(/Colts's/g, "Colts'")
    .replace(/Broncos's/g, "Broncos'")
    .replace(/Ravens's/g, "Ravens'");
}

function cleanNode(node) {
  if (typeof node === "string") {
    const next = cleanString(node);
    return { value: next, changed: next !== node };
  }

  if (Array.isArray(node)) {
    let changed = false;
    const value = node.map(item => {
      const r = cleanNode(item);
      if (r.changed) changed = true;
      return r.value;
    });
    return { value, changed };
  }

  if (node && typeof node === "object") {
    let changed = false;
    const value = {};
    for (const [k, v] of Object.entries(node)) {
      const r = cleanNode(v);
      if (r.changed) changed = true;
      value[k] = r.value;
    }
    return { value, changed };
  }

  return { value: node, changed: false };
}

for (let i = 0; i < trades.length; i++) {
  if (!ids.has(trades[i].id)) continue;
  const r = cleanNode(trades[i]);
  if (r.changed) {
    trades[i] = r.value;
    touched++;
  }
}

if (touched) {
  const backup = `src/data/nfl/trades.backup-before-bottom-batch-010-artifact-polish-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`Polished possessive artifacts in ${touched} Batch 010 record(s).`);
  console.log(`Backup: ${backup}`);
} else {
  console.log("No Batch 010 possessive artifacts needed polishing.");
}
