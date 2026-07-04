import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "nfl", "trades.json");
const REPORT_DIR = path.join(ROOT, "reports", "quality");

function die(msg) {
  console.error("");
  console.error("ERROR: " + msg);
  console.error("");
  process.exit(1);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function safe(v) {
  return v == null ? "" : String(v);
}

function getTrades() {
  const data = readJson(DATA_PATH);
  const trades = Array.isArray(data) ? data : data.trades;
  if (!Array.isArray(trades)) die("Could not find trades array in src/data/nfl/trades.json");
  return { data, trades };
}

function getId(t) {
  return safe(t.id || t.tradeId || t.trade_id);
}

function label(n) {
  return String(Number(n || 1)).padStart(3, "0");
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function manifestPath(batchNum) {
  return path.join(REPORT_DIR, `nfl-bottom-batch-${label(batchNum)}-manifest.json`);
}

function manifestTxtPath(batchNum) {
  return path.join(REPORT_DIR, `nfl-bottom-batch-${label(batchNum)}-manifest.txt`);
}

function readManifest(batchNum) {
  const p = manifestPath(batchNum);
  if (!fs.existsSync(p)) die(`Manifest not found: ${p}. Run start-nfl-bottom-batch-v1.cjs ${batchNum} 100 first.`);
  return readJson(p);
}

function run(cmd, args) {
  console.log("");
  console.log("> " + [cmd, ...args].join(" "));
  const res = spawnSync(cmd, args, { cwd: ROOT, shell: true, stdio: "inherit" });
  if (res.status !== 0) die(`Command failed: ${cmd} ${args.join(" ")}`);
}

function latestMatching(pattern) {
  const files = fs.readdirSync(REPORT_DIR)
    .map(name => path.join(REPORT_DIR, name))
    .filter(p => pattern.test(path.basename(p)))
    .map(p => ({ p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.p || null;
}

function copyLatest(pattern, destBase) {
  const found = latestMatching(pattern);
  if (!found) return null;
  const ext = path.extname(found);
  const dest = path.join(REPORT_DIR, destBase + ext);
  fs.copyFileSync(found, dest);
  return dest;
}

export {
  ROOT,
  DATA_PATH,
  REPORT_DIR,
  die,
  readJson,
  writeJson,
  safe,
  getTrades,
  getId,
  label,
  parseArgs,
  manifestPath,
  manifestTxtPath,
  readManifest,
  run,
  copyLatest
};
