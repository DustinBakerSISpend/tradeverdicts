import fs from "node:fs";

const id = "PHI-2010-0334";
const dataPath = "src/data/nfl/trades.json";
const outTxt = "reports/quality/nfl-bottom-batch-013-quarantine-unknown-placeholder-v1.txt";
const outJson = "reports/quality/nfl-bottom-batch-013-quarantine-unknown-placeholder-v1.json";

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const trades = Array.isArray(data) ? data : data.trades;

if (!Array.isArray(trades)) {
  throw new Error("Could not find trades array");
}

const index = trades.findIndex(t => t.id === id);
if (index === -1) {
  console.log(`${id} already missing/quarantined from active trades.json`);
  process.exit(0);
}

const removed = trades[index];

const backup = `src/data/nfl/trades.backup-before-bottom-batch-013-quarantine-${id}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(backup, JSON.stringify(data, null, 2) + "\n");

trades.splice(index, 1);

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");

const report = {
  generatedAt: new Date().toISOString(),
  action: "quarantined_by_removal_from_active_trades_json",
  reason: "unknown-team / unknown partner placeholder with no reliable counterparty or assets",
  id,
  originalIndexInCurrentFile: index,
  backup,
  removed
};

fs.writeFileSync(outJson, JSON.stringify(report, null, 2) + "\n");

let txt = `# NFL Bottom Batch 013 Unknown Placeholder Quarantine v1\n\n`;
txt += `Generated: ${report.generatedAt}\n\n`;
txt += `- id: ${id}\n`;
txt += `- action: removed from active src/data/nfl/trades.json\n`;
txt += `- reason: unknown-team / unknown partner placeholder with no reliable counterparty or assets\n`;
txt += `- backup: ${backup}\n`;
txt += `- removed slug: ${removed.slug}\n`;

fs.writeFileSync(outTxt, txt);

console.log(txt);
